import { createClient } from '@supabase/supabase-js';

// 获取环境变量
const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const envKey = process.env.SUPABASE_SERVICE_KEY;

// 🛑 调试日志：如果 Vercel 构建时看到了这句话，说明代码更新成功了
console.log("Supabase Init - URL:", envUrl ? "Found" : "Missing, using fallback");

// 🛠️ 终极防弹衣：
// 如果环境变量不存在（构建时），强制使用一个字符串，绝对不让 createClient 崩溃
const supabaseUrl = envUrl || "https://placeholder.supabase.co";
const supabaseKey = envKey || "placeholder-key";

export const supabase = createClient(supabaseUrl, supabaseKey);