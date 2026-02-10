import { createClient } from '@supabase/supabase-js';

// 🛠️ 核心修改：增加了 || 后面的默认值
// 即使 Vercel 构建时读不到环境变量，这里也会有个假地址顶着，不会报错
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || "example-key";

export const supabase = createClient(supabaseUrl, supabaseKey);