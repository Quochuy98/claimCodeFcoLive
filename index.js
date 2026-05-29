const { LiveChat } = require("youtube-chat");

// =============================================
// CẤU HÌNH
// =============================================

// Thay ID của video livestream FC Online vào đây
const LIVE_VIDEO_ID = "WWJU3NFgyzA";

const THRESHOLD = 5; // Cần xuất hiện đủ 5 lần để xác nhận là code
const RESET_INTERVAL = 60000; // Reset bộ đếm sau mỗi 60 giây
const CODE_REGEX = /^FCPRO[A-Z0-9]{4,15}$/; // Prefix FCPRO + chữ hoa/số (VD: FCPRO1QRTLNJ)

// Telegram
const TELEGRAM_BOT_TOKEN = "8952244269:AAFVK0Oy5w3Pb2wHHRDsxhc8x-SP-YnaaPI";
const TELEGRAM_CHAT_ID = "1280811243";

// Danh sách tài khoản Garena (cập nhật cookie khi hết hạn)
const ACCOUNTS = [
    {
        name: "Acc Chính",
        csrf: "y1mR2sRMy59z6TN5GL5CGN8JsWh6pt3Qcvlpnk0UaZZjHT7tz67Vm38yxAM3zIdt",
        session: "aheelp8ca6nfmsm6khpbwotlwo4o1sif",
    },
    {
        name: "Acc Nhỏ",
        csrf: "F1jDm8V5qFvuT6WvbLeG2GkhdaSqgc31L9FlNwfNgmghR1MvN5g2tvpQ2rjV1Duw",
        session: "ddut220qrvxqnq0ab9ckk60ce6ugbdi3",
    },
];

// =============================================
// HÀM XỬ LÝ
// =============================================

/**
 * Gửi tin nhắn Telegram
 */
async function sendTelegram(text) {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
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

        const data = await res.json();
        return data;
    } catch (err) {
        return { error: true, message: err.message };
    }
}

/**
 * Phát hiện code → Nhập code trên tất cả account → Gửi kết quả lên Telegram
 */
async function triggerNotification(code) {
    // Double guard: tránh gọi trùng nếu có race condition
    if (confirmedCodes.has(code) && confirmedCodes._processed?.has(code)) return;
    if (!confirmedCodes._processed) confirmedCodes._processed = new Set();
    confirmedCodes._processed.add(code);

    const time = new Date().toLocaleString("vi-VN");

    console.log("═══════════════════════════════════════");
    console.log(`🎁 GIFTCODE PHÁT HIỆN: ${code}`);
    console.log(`⏰ Thời gian: ${time}`);
    console.log("═══════════════════════════════════════");

    const results = [];

    for (const account of ACCOUNTS) {
        console.log(`🔄 Đang nhập code ${code} cho [${account.name}]...`);
        const result = await redeemCode(code, account);
        const json = JSON.stringify(result);
        const isSuccess = result.status === "successful";
        const status = isSuccess ? "✅ OK" : "❌ LỖI";
        const reward = result.payload?.reward?.replace(/<br\/>/g, "\n") || "";
        const detail = isSuccess ? reward : (result.payload || result.message || result.msg || json);
        console.log(`📨 [${account.name}] ${status}: ${json}`);
        results.push(`  • ${account.name}: ${status}\n    ${detail}`);
    }

    const telegramMsg = [
        `🎁 Code FCO: ${code}`,
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
// LOGIC CHÍNH
// =============================================

const liveChat = new LiveChat({ liveId: LIVE_VIDEO_ID });

// Khởi tạo Map để đếm số lần xuất hiện của từ ngữ
const codeCounter = new Map();

// Cache các code đã xác nhận để tránh thông báo trùng
const confirmedCodes = new Set();

// Bỏ qua batch tin nhắn cũ khi mới start
let isReady = false;
let firstBatchSkipped = false;

liveChat.on("chat", (chatItem) => {
    // Skip batch tin nhắn cũ (batch đầu tiên khi mới kết nối)
    if (!firstBatchSkipped) {
        firstBatchSkipped = true;
        // Đặt timeout ngắn để skip hết batch cũ, sau đó mới bắt đầu xử lý
        setTimeout(() => {
            isReady = true;
            console.log("🟢 Đã bỏ qua tin nhắn cũ. Bắt đầu theo dõi tin nhắn mới!");
        }, 2000);
        return;
    }
    if (!isReady) return;

    // Truy cập an toàn nội dung tin nhắn và chuyển sang uppercase để so khớp
    const rawMessage = chatItem.message?.[0]?.text?.trim();
    const message = rawMessage?.toUpperCase();

    if (!message) return;

    // Kiểm tra xem tin nhắn có khớp với định dạng của 1 Giftcode không
    if (CODE_REGEX.test(message)) {
        // Bỏ qua nếu code đã được phát hiện trước đó
        if (confirmedCodes.has(message)) return;

        // Tăng bộ đếm
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

// Xử lý lỗi LiveChat
liveChat.on("error", (err) => {
    console.error("❌ Lỗi LiveChat:", err.message || err);
});

// Xử lý sự kiện kết thúc livestream
liveChat.on("end", (reason) => {
    console.log("⛔ LiveChat đã dừng:", reason || "Livestream kết thúc");
    clearInterval(resetTimer);
});

// Reset bộ đếm sau mỗi khoảng thời gian để tránh tích lũy spam cũ
const resetTimer = setInterval(() => {
    if (codeCounter.size > 0) {
        console.log(`--- Đã reset bộ đếm chat (${codeCounter.size} mục) ---`);
        codeCounter.clear();
    }
}, RESET_INTERVAL);

// Khởi chạy LiveChat
console.log("🚀 Đang kết nối tới livestream...");
liveChat
    .start()
    .then((ok) => {
        if (ok) {
            console.log("✅ Đã kết nối thành công! Đang theo dõi chat...");
            sendTelegram(`🟢 Bot FCO đã khởi động!\n⏰ ${new Date().toLocaleString("vi-VN")}\n📺 https://www.youtube.com/live/${LIVE_VIDEO_ID}`);
        } else {
            console.error("❌ Không thể kết nối. Kiểm tra lại Live Video ID.");
            process.exit(1);
        }
    })
    .catch((err) => {
        console.error("❌ Lỗi khi khởi chạy LiveChat:", err.message || err);
        process.exit(1);
    });