const { bot } = require("./bot");
const { startLiveChat } = require("./livechat");
const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "state.json");

// Khởi chạy bot
console.log("🤖 Đang khởi động Bot FCO...");
bot.launch()
    .then(async () => {
        console.log("✅ Bot đã sẵn sàng! Đang chờ lệnh từ Telegram...");

        // Tự động khôi phục theo dõi live chat nếu có link đã lưu
        try {
            if (fs.existsSync(STATE_FILE)) {
                const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
                if (data.videoId) {
                    console.log(`🚀 Tự động kết nối lại Livestream: https://www.youtube.com/live/${data.videoId}...`);
                    const ok = await startLiveChat(data.videoId);
                    if (ok) {
                        console.log("🟢 Tự động kết nối thành công!");
                    } else {
                        console.warn("⚠️ Tự động kết nối thất bại. Có thể stream đã kết thúc hoặc sai ID.");
                    }
                }
            }
        } catch (err) {
            console.error("⚠️ Lỗi khi tự động kết nối lại livechat:", err.message);
        }
    })
    .catch((err) => {
        console.error("❌ Lỗi khởi động bot:", err.message);
        process.exit(1);
    });

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));