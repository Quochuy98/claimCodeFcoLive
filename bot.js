const { Telegraf } = require("telegraf");
const { TELEGRAM_BOT_TOKEN } = require("./config");
const { startLiveChat, stopLiveChat, isRunning, getStatus, redeemCode } = require("./livechat");
const { upsertAccount, getAccounts } = require("./db");

// =============================================
// STATE
// =============================================

let currentVideoId = null;

// =============================================
// HELPERS
// =============================================

/**
 * Trích xuất YouTube Video ID từ nhiều dạng URL
 * Hỗ trợ: youtube.com/watch?v=, youtube.com/live/, youtu.be/, hoặc ID thuần
 */
function extractVideoId(input) {
    if (!input) return null;
    input = input.trim();

    // youtube.com/watch?v=VIDEO_ID
    const watchMatch = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch) return watchMatch[1];

    // youtube.com/live/VIDEO_ID
    const liveMatch = input.match(/youtube\.com\/live\/([a-zA-Z0-9_-]{11})/);
    if (liveMatch) return liveMatch[1];

    // youtu.be/VIDEO_ID
    const shortMatch = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];

    // Nếu input là 11 ký tự alphanumeric → coi như Video ID thuần
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

    return null;
}

/**
 * Trích xuất csrftoken và sessionid từ câu lệnh cURL (hoặc cookie thô)
 */
function extractTokensFromCurl(rawText) {
    let csrf = null;
    let session = null;

    // 1. Tìm X-CSRFToken header trước (khá phổ biến trong cURL)
    const csrfHeaderMatch = rawText.match(/X-CSRFToken:\s*([a-zA-Z0-9]+)/i);
    if (csrfHeaderMatch) {
        csrf = csrfHeaderMatch[1].trim();
    }

    // 2. Tìm csrftoken trong chuỗi cookie
    if (!csrf) {
        const csrfCookieMatch = rawText.match(/csrftoken=([a-zA-Z0-9]+)/);
        if (csrfCookieMatch) {
            csrf = csrfCookieMatch[1].trim();
        }
    }

    // 3. Tìm sessionid trong chuỗi cookie
    const sessionMatch = rawText.match(/sessionid=([a-zA-Z0-9]+)/);
    if (sessionMatch) {
        session = sessionMatch[1].trim();
    }

    return { csrf, session };
}

// =============================================
// BOT SETUP
// =============================================

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// ---- /start ----
bot.start((ctx) => {
    ctx.reply(
        `🤖 *Bot FCO YouTube* đã sẵn sàng\\!\n\n` +
        `📋 *Danh sách lệnh:*\n` +
        `  /youtube \\<link\\> — Set link YouTube\n` +
        `  /start\\_ytb — Bắt đầu theo dõi\n` +
        `  /stop\\_ytb — Dừng theo dõi\n` +
        `  /status — Xem trạng thái\n` +
        `  /accounts — Danh sách tài khoản\n` +
        `  /coupon \\<code\\> \\[tên\\_acc\\] — Nạp code thủ công\n` +
        `  /set \\<tên\\_acc\\> \\<cURL\\> — Lưu account từ cURL`,
        { parse_mode: "MarkdownV2" }
    );
});

// ---- /youtube [link] ----
bot.command("youtube", async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1).join(" ");

    if (!args) {
        const msg = await ctx.reply("⏳ Đang xử lý...");
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            "❌ Thiếu link YouTube!\n\n💡 Cách dùng: /youtube <link>\nVD: /youtube https://www.youtube.com/live/ABC123"
        );
        return;
    }

    const videoId = extractVideoId(args);
    if (!videoId) {
        const msg = await ctx.reply("⏳ Đang xử lý...");
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            `❌ Không thể trích xuất Video ID từ link:\n${args}\n\n💡 Hỗ trợ format:\n• youtube.com/watch?v=...\n• youtube.com/live/...\n• youtu.be/...\n• Video ID (11 ký tự)`
        );
        return;
    }

    // Nếu đang chạy LiveChat với video cũ → dừng trước
    if (isRunning()) {
        stopLiveChat();
        console.log("🔄 Đã dừng LiveChat cũ để set link mới.");
    }

    currentVideoId = videoId;

    const msg = await ctx.reply("⏳ Đang xử lý...");
    await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, undefined,
        `✅ Đã set link thành công!\n\n📺 Video ID: ${videoId}\n🔗 https://www.youtube.com/live/${videoId}\n\n👉 Gửi /start_ytb để bắt đầu theo dõi`
    );
});

// ---- /start_ytb ----
bot.command("start_ytb", async (ctx) => {
    if (!currentVideoId) {
        const msg = await ctx.reply("⏳ Đang xử lý...");
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            "❌ Chưa set link YouTube!\n\n👉 Gửi /youtube <link> trước"
        );
        return;
    }

    if (isRunning()) {
        const msg = await ctx.reply("⏳ Đang xử lý...");
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            `⚠️ LiveChat đang chạy rồi!\n\n📺 Video ID: ${currentVideoId}\n\n👉 Gửi /stop_ytb để dừng trước`
        );
        return;
    }

    const msg = await ctx.reply("⏳ Đang kết nối tới livestream...");

    try {
        const ok = await startLiveChat(currentVideoId);
        if (ok) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, msg.message_id, undefined,
                `▶️ Đã kết nối thành công!\n\n📺 Đang theo dõi: ${currentVideoId}\n🔗 https://www.youtube.com/live/${currentVideoId}\n⏰ ${new Date().toLocaleString("vi-VN")}`
            );
        } else {
            await ctx.telegram.editMessageText(
                ctx.chat.id, msg.message_id, undefined,
                `❌ Không thể kết nối!\n\nKiểm tra lại Video ID: ${currentVideoId}\nCó thể livestream chưa bắt đầu hoặc đã kết thúc.`
            );
        }
    } catch (err) {
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            `❌ Lỗi kết nối: ${err.message}`
        );
    }
});

// ---- /stop_ytb ----
bot.command("stop_ytb", async (ctx) => {
    if (!isRunning()) {
        const msg = await ctx.reply("⏳ Đang xử lý...");
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            "⚠️ Không có LiveChat nào đang chạy!"
        );
        return;
    }

    stopLiveChat();

    const msg = await ctx.reply("⏳ Đang xử lý...");
    await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, undefined,
        `⏹️ Đã dừng theo dõi!\n\n📺 Link vẫn giữ: ${currentVideoId}\n👉 Gửi /start_ytb để chạy lại`
    );
});

// ---- /status ----
bot.command("status", async (ctx) => {
    const status = getStatus();
    const videoInfo = currentVideoId
        ? `📺 Video ID: ${currentVideoId}\n🔗 https://www.youtube.com/live/${currentVideoId}`
        : "📺 Chưa set link YouTube";

    const runningInfo = status.running
        ? `🟢 Đang theo dõi`
        : `🔴 Đang dừng`;

    const msg = await ctx.reply("⏳ Đang xử lý...");
    await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, undefined,
        `📊 *Trạng thái Bot*\n\n${videoInfo}\n\n${runningInfo}\n📦 Code đã phát hiện: ${status.confirmedCount}\n🔍 Code đang chờ xác nhận: ${status.pendingCount}\n\n⏰ ${new Date().toLocaleString("vi-VN")}`
    );
});

// ---- /set [account_name] [curl_text] ----
bot.command("set", async (ctx) => {
    const rawText = ctx.message.text;
    const parts = rawText.split(/\s+/);

    if (parts.length < 3) {
        const msg = await ctx.reply("⏳ Đang xử lý...");
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            "❌ Sai định dạng lệnh!\n\n💡 Cách dùng: /set <tên_acc> <dán_lệnh_curl_ở_đây>\nVD: /set huytq1998 curl \"...\""
        );
        return;
    }

    const accountName = parts[1];
    const curlText = rawText.substring(rawText.indexOf(accountName) + accountName.length).trim();

    const { csrf, session } = extractTokensFromCurl(curlText);

    if (!csrf || !session) {
        const msg = await ctx.reply("⏳ Đang xử lý...");
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            `❌ Không thể trích xuất token!\n\nVui lòng đảm bảo lệnh cURL chứa:\n- Header 'X-CSRFToken' hoặc cookie 'csrftoken'\n- Cookie 'sessionid'`
        );
        return;
    }

    const msg = await ctx.reply("⏳ Đang lưu vào Supabase...");

    const result = await upsertAccount(accountName, csrf, session);

    if (result.success) {
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            `✅ Đã lưu tài khoản thành công!\n\n👤 Tên tài khoản: ${accountName}\n🔑 CSRF: ${csrf.substring(0, 8)}...\n📦 Session ID: ${session.substring(0, 8)}...\n\n👉 Token đã được lưu động vào Supabase!`
        );
    } else {
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            `❌ Lỗi lưu cơ sở dữ liệu:\n${result.error}`
        );
    }
});
// ---- Helper: Escape HTML ----
function escapeHTML(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ---- /coupon [code] [tài khoản] ----
bot.command("coupon", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1).filter(Boolean);

    if (args.length === 0) {
        const msg = await ctx.reply("⏳ Đang xử lý...");
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            "❌ Thiếu tham số!\n\n💡 Cách dùng:\n• Nạp tất cả: /coupon <code>\n• Nạp 1 acc: /coupon <code> <tên_acc>\nVD: /coupon FCPRONPS6WZG huytq1998"
        );
        return;
    }

    const code = args[0].toUpperCase();
    const accountName = args.length >= 2 ? args[1] : null;

    const targetDesc = accountName ? `tài khoản [${accountName}]` : "tất cả tài khoản";
    const msg = await ctx.reply(`🔄 Đang nạp code [${code}] cho ${targetDesc}...`);

    let accounts = await getAccounts();
    if (accounts.length === 0) {
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            `⚠️ Không tìm thấy tài khoản nào trong Supabase!`
        );
        return;
    }

    if (accountName) {
        accounts = accounts.filter(acc => acc.name.toLowerCase() === accountName.toLowerCase());
        if (accounts.length === 0) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, msg.message_id, undefined,
                `❌ Không tìm thấy tài khoản <b>${escapeHTML(accountName)}</b> trong Supabase!`,
                { parse_mode: "HTML" }
            );
            return;
        }
    }

    const results = [];
    const time = new Date().toLocaleString("vi-VN");

    for (const account of accounts) {
        const result = await redeemCode(code, account);
        const json = JSON.stringify(result);
        const isSuccess = result.status === "successful";
        const isAlreadyClaimed = result.msg === "This coupon code has already been used."
            || result.msg === "Mã coupon này đã được sử dụng."
            || (result.status === "failed" && /already|claimed|used|redeemed/i.test(result.msg || result.message || ""));

        const status = isSuccess ? "✅ OK" : (isAlreadyClaimed ? "⚠️ ĐÃ DÙNG" : "❌ LỖI");
        const reward = result.payload?.reward?.replace(/<br\/>/g, "\n") || "";
        const detail = isSuccess ? reward : (result.payload || result.message || result.msg || json);

        results.push(`• <b>${escapeHTML(account.name)}</b>: ${status}\n  <i>${escapeHTML(detail)}</i>`);
    }

    const telegramMsg = [
        `🎁 <b>Kết Quả Nạp Coupon</b>`,
        `Mã code: <code>${escapeHTML(code)}</code>`,
        ``,
        `📊 <b>Chi tiết:</b>`,
        ...results,
        ``,
        `⏰ <i>${time}</i>`,
    ].join("\n");

    await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, undefined,
        telegramMsg,
        { parse_mode: "HTML" }
    );
});

// ---- /accounts ----
bot.command("accounts", async (ctx) => {
    const msg = await ctx.reply("⏳ Đang lấy danh sách tài khoản từ Supabase...");

    const accounts = await getAccounts();
    if (accounts.length === 0) {
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, undefined,
            "⚠️ Chưa có tài khoản nào được lưu trữ trong Supabase!\n\n💡 Dùng lệnh /set để thêm tài khoản mới."
        );
        return;
    }

    const results = [];
    for (const [index, account] of accounts.entries()) {
        const csrfMask = account.csrf ? `${account.csrf.substring(0, 8)}...` : "N/A";
        const sessionMask = account.session ? `${account.session.substring(0, 8)}...` : "N/A";
        results.push(
            `${index + 1}. <b>${escapeHTML(account.name)}</b>\n` +
            `   • CSRF: <code>${escapeHTML(csrfMask)}</code>\n` +
            `   • Session: <code>${escapeHTML(sessionMask)}</code>`
        );
    }

    const telegramMsg = [
        `👤 <b>Danh Sách Tài Khoản Đang Hoạt Động (${accounts.length})</b>`,
        ``,
        ...results,
        ``,
        `💡 <i>Dùng lệnh /set để cập nhật hoặc thêm tài khoản mới.</i>`
    ].join("\n");

    await ctx.telegram.editMessageText(
        ctx.chat.id, msg.message_id, undefined,
        telegramMsg,
        { parse_mode: "HTML" }
    );
});

module.exports = { bot };
