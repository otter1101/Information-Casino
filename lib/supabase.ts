import { createClient } from '@supabase/supabase-js';

// 获取环境变量（这两个变量稍后要在 .env.local 里配好）
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

// 创建一个拥有最高权限的客户端（用于后端读写）
export const supabase = createClient(supabaseUrl, supabaseKey);