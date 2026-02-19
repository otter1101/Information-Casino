import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// 强制动态模式，每次请求都去数据库查最新数据
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 使用服务端的 Service Key (在 lib/supabase.ts 里初始化的那个)
    // 它有权限读取所有用户的 wealth 数据
    const { data, error } = await supabase
      .from('users')
      .select('name, wealth')
      .order('wealth', { ascending: false }) // 财富榜：钱多的排前面
      .limit(10); // 只取前10名

    if (error) {
      console.error("Leaderboard DB Error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (e) {
    console.error("Leaderboard Server Error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}