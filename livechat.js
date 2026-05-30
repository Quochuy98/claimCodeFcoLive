const { LiveChat } = require("youtube-chat");
const { THRESHOLD, RESET_INTERVAL, CODE_REGEX, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = require("./config");
const { getAccounts } = require("./db");

// =============================================
// STATE
// =============================================

let liveChat = null;
let resetTimer = null;
let codeCounter = new Map();
let confirmedCodes = new Set();
let isReady = false;
let firstBatchSkipped = false;

// Cache code đã redeem thành công — KHÔNG reset khi start/stop
const redeemedCodes = new Set();

// Cache các ID tin nhắn đã xử lý để tránh trùng lặp tin nhắn (double log)
const processedChatIds = new Set();

// =============================================
// HÀM HỖ TRỢ
// =============================================

/**
 * Helper: Escape HTML
 */
function escapeHTML(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Gửi tin nhắn Telegram
 */
async function sendTelegram(text) {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                chat_id: TELEGRAM_CHAT_ID, 
                text,
                parse_mode: "HTML"
            }),
        });
    } catch (err) {
        console.error("❌ Lỗi gửi Telegram:", err.message);
    }
}

/**
 * Tự động nhập code coupon trên Garena cho 1 account
 */
async function redeemCode(code, account) {
    try {
        const res = await fetch("https://coupon.fconline.garena.vn/api/user/get-reward", {
            method: "POST",
            headers: {
                "Content-Type": "text/plain;charset=UTF-8",
                "Origin": "https://coupon.fconline.garena.vn",
                "Referer": "https://coupon.fconline.garena.vn/",
                "X-CSRFToken": account.csrf,
                "Cookie": `csrftoken=${account.csrf}; sessionid=${account.session}`,
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
            },
            body: JSON.stringify({ code }),
        });

        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            const data = await res.json();
            return data;
        } else {
            const text = await res.text();
            const lowerText = text.toLowerCase();
            const isAuthError = res.status === 401 || 
                                res.status === 403 || 
                                res.status === 200 || // Nếu HTTP 200 nhưng không phải JSON thì là trang đăng nhập/redirect của Garena
                                lowerText.includes("login") || 
                                lowerText.includes("signin") || 
                                lowerText.includes("sso") ||
                                lowerText.includes("redirect") ||
                                lowerText.includes("đăng nhập");

            if (isAuthError) {
                return { status: "failed", msg: "Cookie/Session hết hạn hoặc không hợp lệ. Hãy dùng /set để cập nhật." };
            }
            return { status: "failed", msg: `Lỗi kết nối Garena (Mã: ${res.status}).` };
        }
    } catch (err) {
        return { error: true, message: err.message };
    }
}

/**
 * Phát hiện code → Nhập code trên tất cả account → Gửi kết quả lên Telegram
 */
async function triggerNotification(code) {
    // Đã redeem thành công trước đó → bỏ qua hoàn toàn
    if (redeemedCodes.has(code)) {
        console.log(`⏭️ Bỏ qua code ${code} — đã redeem thành công trước đó`);
        return;
    }

    if (confirmedCodes._processed?.has(code)) return;
    if (!confirmedCodes._processed) confirmedCodes._processed = new Set();
    confirmedCodes._processed.add(code);

    const time = new Date().toLocaleString("vi-VN");

    console.log("═══════════════════════════════════════");
    console.log(`🎁 GIFTCODE PHÁT HIỆN: ${code}`);
    console.log(`⏰ Thời gian: ${time}`);
    console.log("═══════════════════════════════════════");

    const results = [];
    let anySuccess = false;
    let allAlreadyClaimed = true;

    const accounts = await getAccounts();
    if (accounts.length === 0) {
        console.log("⚠️ Không tìm thấy tài khoản nào trong Supabase. Bỏ qua redeem.");
        return;
    }

    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        console.log(`🔄 Đang nhập code ${code} cho [${account.name}]...`);
        const result = await redeemCode(code, account);
        const json = JSON.stringify(result);
        const isSuccess = result.status === "successful";
        // Kiểm tra code đã được nhập trước đó (đã claim rồi)
        const isAlreadyClaimed = result.msg === "This coupon code has already been used."
            || result.msg === "Mã coupon này đã được sử dụng."
            || (result.status === "failed" && /already|claimed|used|redeemed/i.test(result.msg || result.message || ""));

        if (isSuccess) anySuccess = true;
        if (!isSuccess && !isAlreadyClaimed) allAlreadyClaimed = false;

        const status = isSuccess ? "✅ OK" : (isAlreadyClaimed ? "⚠️ ĐÃ DÙNG" : "❌ LỖI");
        const reward = result.payload?.reward?.replace(/<br\/>/g, "\n") || "";
        const detail = isSuccess ? reward : (result.payload || result.message || result.msg || json);
        console.log(`📨 [${account.name}] ${status}: ${json}`);
        results.push(`  • <b>${escapeHTML(account.name)}</b>: ${status}\n    <i>${escapeHTML(detail)}</i>`);

        // Tránh spam quá nhanh gây block IP / Rate Limit của Garena
        if (i < accounts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // Cache code nếu đã redeem thành công hoặc tất cả account đều đã claim rồi
    if (anySuccess || allAlreadyClaimed) {
        redeemedCodes.add(code);
        console.log(`💾 Đã cache code ${code} — sẽ không xử lý lại (tổng cache: ${redeemedCodes.size})`);
    }

    // Nếu tất cả account đều đã claim rồi → không cần gửi Telegram
    if (allAlreadyClaimed && !anySuccess) {
        console.log(`⏭️ Bỏ qua gửi Telegram — tất cả account đã claim code ${code} trước đó`);
        return;
    }

    const telegramMsg = [
        `🎁 Code FCO: <code>${code}</code>`,
        ``,
        `📊 Kết quả:`,
        ...results,
        ``,
        `⏰ ${time}`,
        `👉 Nhập code tại: https://coupon.fconline.garena.vn/`,
    ].join("\n");

    await sendTelegram(telegramMsg);
}

// =============================================
// LIVECHAT MODULE
// =============================================

/**
 * Bắt đầu theo dõi LiveChat YouTube
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<boolean>} - true nếu kết nối thành công
 */
async function startLiveChat(videoId) {
    // Bảo vệ: Dọn dẹp LiveChat cũ đang chạy nếu có để tránh trùng lặp
    cleanup();

    // Reset state sạch
    codeCounter = new Map();
    confirmedCodes = new Set();
    processedChatIds.clear();
    isReady = false;
    firstBatchSkipped = false;

    liveChat = new LiveChat({ liveId: videoId });

    liveChat.on("chat", (chatItem) => {
        // Skip batch tin nhắn cũ (batch đầu tiên khi mới kết nối)
        if (!firstBatchSkipped) {
            firstBatchSkipped = true;
            setTimeout(() => {
                isReady = true;
                console.log("🟢 Đã bỏ qua tin nhắn cũ. Bắt đầu theo dõi tin nhắn mới!");
            }, 2000);
            return;
        }
        if (!isReady) return;

        // Tránh trùng lặp tin nhắn (Deduplication)
        const chatId = chatItem.id;
        if (chatId) {
            if (processedChatIds.has(chatId)) return;
            processedChatIds.add(chatId);

            // Giới hạn kích thước cache để tránh rò rỉ bộ nhớ
            if (processedChatIds.size > 500) {
                const firstKey = processedChatIds.keys().next().value;
                processedChatIds.delete(firstKey);
            }
        }

        const rawMessage = chatItem.message?.[0]?.text?.trim();
        const message = rawMessage?.toUpperCase();
        if (!message) return;

        if (CODE_REGEX.test(message)) {
            if (confirmedCodes.has(message)) return;

            const count = (codeCounter.get(message) || 0) + 1;
            codeCounter.set(message, count);

            const username = chatItem.author?.name || "Unknown";
            const time = new Date().toLocaleTimeString("vi-VN");
            console.log(`[${time}] [Nghi vấn] ${username}: ${message} (${count}/${THRESHOLD} lần)`);

            if (count === THRESHOLD) {
                confirmedCodes.add(message);
                console.log(`📦 Đã cache code: ${message} (tổng: ${confirmedCodes.size} code)`);
                triggerNotification(message);
            }
        }
    });

    liveChat.on("error", (err) => {
        console.error("❌ Lỗi LiveChat:", err.message || err);
    });

    liveChat.on("end", (reason) => {
        console.log("⛔ LiveChat đã dừng:", reason || "Livestream kết thúc");
        cleanup();
    });

    // Reset bộ đếm định kỳ
    resetTimer = setInterval(() => {
        if (codeCounter.size > 0) {
            console.log(`--- Đã reset bộ đếm chat (${codeCounter.size} mục) ---`);
            codeCounter.clear();
        }
    }, RESET_INTERVAL);

    // Khởi chạy
    console.log("🚀 Đang kết nối tới livestream...");
    const ok = await liveChat.start();
    if (ok) {
        console.log("✅ Đã kết nối thành công! Đang theo dõi chat...");
    }
    return ok;
}

/**
 * Dọn dẹp tài nguyên
 */
function cleanup() {
    if (resetTimer) {
        clearInterval(resetTimer);
        resetTimer = null;
    }
    if (liveChat) {
        try {
            liveChat.stop();
        } catch (err) {
            console.error("⚠️ Lỗi dừng LiveChat:", err.message);
        }
        liveChat = null;
    }
    isReady = false;
    firstBatchSkipped = false;
}

/**
 * Dừng theo dõi LiveChat
 */
function stopLiveChat() {
    cleanup();
}

/**
 * Kiểm tra xem LiveChat có đang chạy không
 */
function isRunning() {
    return liveChat !== null;
}

/**
 * Lấy trạng thái hiện tại
 */
function getStatus() {
    return {
        running: isRunning(),
        confirmedCount: confirmedCodes.size,
        pendingCount: codeCounter.size
    };
}

/**
 * Kiểm tra trạng thái session của tài khoản bằng cách gọi API Lịch sử nhận quà
 */
async function checkSession(account) {
    try {
        const res = await fetch("https://coupon.fconline.garena.vn/api/user/history", {
            method: "GET",
            headers: {
                "Accept": "*/*",
                "Origin": "https://coupon.fconline.garena.vn",
                "Referer": "https://coupon.fconline.garena.vn/",
                "X-CSRFToken": account.csrf,
                "Cookie": `csrftoken=${account.csrf}; sessionid=${account.session}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
            }
        });

        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            const data = await res.json();
            return { success: true, msg: "Hoạt động tốt (Valid)" };
        } else {
            return { success: false, msg: "Hết hạn hoặc Cookie không hợp lệ" };
        }
    } catch (err) {
        return { success: false, msg: `Lỗi kết nối: ${err.message}` };
    }
}

module.exports = {
    startLiveChat,
    stopLiveChat,
    isRunning,
    getStatus,
    redeemCode,
    checkSession
};

