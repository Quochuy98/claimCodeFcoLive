const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("⚠️ Cảnh báo: SUPABASE_URL hoặc SUPABASE_ANON_KEY chưa được cấu hình trong .env!");
}

const supabase = createClient(
    supabaseUrl || "https://placeholder.supabase.co",
    supabaseAnonKey || "placeholder"
);

/**
 * Lấy tất cả tài khoản hoạt động từ Supabase
 */
async function getAccounts() {
    try {
        if (!supabaseUrl || !supabaseAnonKey) return [];
        const { data, error } = await supabase
            .from("accounts")
            .select("name, csrf, session");

        if (error) {
            console.error("❌ Lỗi khi lấy accounts từ Supabase:", error.message);
            return [];
        }
        return data || [];
    } catch (err) {
        console.error("❌ Lỗi kết nối Supabase:", err.message);
        return [];
    }
}

/**
 * Thêm hoặc cập nhật tài khoản (Upsert) dựa theo trường 'name'
 */
async function upsertAccount(name, csrf, session) {
    try {
        if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error("Supabase chưa được cấu hình trong file .env");
        }
        const { data, error } = await supabase
            .from("accounts")
            .upsert(
                {
                    name,
                    csrf,
                    session,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "name" }
            );

        if (error) throw error;
        return { success: true, data };
    } catch (err) {
        console.error(`❌ Lỗi upsert account ${name}:`, err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    getAccounts,
    upsertAccount,
    supabase,
};
