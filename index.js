const { bot } = require("./bot");

// Khởi chạy bot
console.log("🤖 Đang khởi động Bot FCO...");
bot.launch()
    .then(() => {
        console.log("✅ Bot đã sẵn sàng! Đang chờ lệnh từ Telegram...");
    })
    .catch((err) => {
        console.error("❌ Lỗi khởi động bot:", err.message);
        process.exit(1);
    });

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));