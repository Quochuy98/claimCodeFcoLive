require("dotenv").config();

// Telegram Bot
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// YouTube LiveChat
const THRESHOLD = 5; // Cần xuất hiện đủ 5 lần để xác nhận là code
const RESET_INTERVAL = 180000; // Reset bộ đếm sau mỗi 3 phút (180000ms)
const CODE_REGEX = /^FCPRO[A-Z0-9]{4,15}$/; // Prefix FCPRO + chữ hoa/số

module.exports = {
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    THRESHOLD,
    RESET_INTERVAL,
    CODE_REGEX,
};
