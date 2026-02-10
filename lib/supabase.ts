import { createClient } from '@supabase/supabase-js';

// 🛠️ 防崩策略：
// 如果环境变量没读到（比如在 Vercel 构建阶段），就用一个合法的假地址。
// 这样 "npm run build" 就能跑通，不会卡死。
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || "placeholder-key";

// 创建客户端
export const supabase = createClient(supabaseUrl, supabaseKey);