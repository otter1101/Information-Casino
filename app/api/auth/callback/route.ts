import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase"; 

// 官方文档地址
const TOKEN_URL = "https://app.mindos.com/gate/lab/api/oauth/token/code";
const USER_INFO_URL = "https://app.mindos.com/gate/lab/api/secondme/user/info";
const USER_SHADES_URL = "https://app.mindos.com/gate/lab/api/secondme/user/shades";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  
  // 如果没 code，直接报错回首页
  if (!code) return NextResponse.redirect(`${url.origin}/?error=NoCode`);

  const clientId = process.env.NEXT_PUBLIC_CLIENT_ID!;
  const clientSecret = process.env.CLIENT_SECRET!;
  const redirectUri = `${url.origin}/api/auth/callback`;

  try {
    // 1. 换取 Token
    const tokenParams = new URLSearchParams();
    tokenParams.append("grant_type", "authorization_code");
    tokenParams.append("code", code);
    tokenParams.append("redirect_uri", redirectUri);
    tokenParams.append("client_id", clientId);
    tokenParams.append("client_secret", clientSecret);

    console.log("🔥 Exchanging token...");
    const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenParams
    });
    
    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0) {
        throw new Error(`TokenError: ${JSON.stringify(tokenData)}`);
    }

    const { accessToken } = tokenData.data;

    // 2. 获取用户信息 (并行请求)
    console.log("🔥 Fetching user info...");
    const [userRes, shadesRes] = await Promise.all([
        fetch(USER_INFO_URL, { headers: { "Authorization": `Bearer ${accessToken}` } }),
        fetch(USER_SHADES_URL, { headers: { "Authorization": `Bearer ${accessToken}` } })
    ]);

    const userData = await userRes.json();
    const shadesData = await shadesRes.json();

    if (userData.code !== 0) throw new Error("UserInfoError");

    const u = userData.data;
    const shades = shadesData.code === 0 ? shadesData.data.shades : [];
    
    // 3. 写入 Supabase (即使失败也不要在页面报错，只在后台记录)
    try {
        console.log("🔥 Writing to DB...", u.userId);
        const { error: dbError } = await supabase.from('users').upsert({
            id: u.userId || u.id, // 兼容不同字段名
            name: u.name,
            avatar: u.avatar,
            shades: shades,
            last_seen: new Date().toISOString(),
        }, { onConflict: 'id' });

        if (dbError) {
            console.error("❌ DB Write Error:", dbError);
        } else {
            console.log("✅ DB Write Success!");
            // 初始化钱包
            await supabase.rpc('increment_wealth', { row_id: u.userId || u.id, amount: 0 });
        }
    } catch (dbErr) {
        console.error("❌ DB Critical Error:", dbErr);
    }

    // 4. 构造重定向 (带着 Cookie 回家)
    const response = NextResponse.redirect(url.origin);
    
    // 核心：设置头像和名字的 Cookie (前端直接读这个)
    // 注意：名字用 encodeURIComponent 避免中文乱码
    response.cookies.set("sm_name", encodeURIComponent(u.name || "User"), { path: '/', maxAge: 86400 });
    response.cookies.set("sm_avatar", u.avatar || "", { path: '/', maxAge: 86400 });
    response.cookies.set("secondme_token", accessToken, { httpOnly: true, path: '/' });

    return response;

  } catch (error: any) {
      console.error("Auth Critical Error:", error);
      // 把错误显示在 URL 里方便调试
      return NextResponse.redirect(`${url.origin}/?error=${encodeURIComponent(error.message || "Unknown")}`);
  }
}