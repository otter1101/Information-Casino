import axios from "axios";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase"; 

const TOKEN_URL = "https://app.mindos.com/gate/lab/api/oauth/token/code";
const USER_INFO_URL = "https://app.mindos.com/gate/lab/api/secondme/user/info";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const isDev = process.env.NODE_ENV !== "production";
  
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const redirectUri = `${url.origin}/api/auth/callback`;

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("client_id", clientId!);
  body.set("client_secret", clientSecret!);

  try {
    // 1. 换取 Token
    const tokenRes = await axios.post(TOKEN_URL, body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    
    // 容错处理：万一 Token 获取失败
    if (!tokenRes.data || !tokenRes.data.data) {
        console.error("Token Exchange Failed:", tokenRes.data);
        return NextResponse.json({ error: "Token Exchange Failed" }, { status: 400 });
    }

    const { accessToken, expiresIn } = tokenRes.data.data;

    // 2. 🚀 关键：获取用户信息并存入 Supabase
    try {
        const userRes = await axios.get(USER_INFO_URL, {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });
        
        if (userRes.data.code === 0) {
            const u = userRes.data.data;
            // 拼装一个有趣的 System Prompt
            const shadesStr = (u.shades || []).map((s:any) => s.shadeName || s).join(', ');
            const systemPrompt = `你是用户 ${u.name} 的数字分身。你的兴趣标签是：${shadesStr}。请代表你的本尊，用犀利、直接的风格参与商业博弈。你的利益与本尊绑定，如果发现方案有漏洞，请无情指出。`;
            
            // 写入/更新数据库 (Upsert)
            await supabase.from('users').upsert({
                id: u.user_id || u.id, // 确保 ID 唯一
                name: u.name || u.nickname,
                avatar: u.avatar || u.avatar_url,
                shades: u.shades || [],
                system_prompt: systemPrompt,
                last_seen: new Date().toISOString()
            });
            console.log("✅ 真人 Agent 入库成功:", u.name);
        }
    } catch (dbError) {
        console.error("Supabase 写入失败 (不影响登录流程):", dbError);
    }

    // 3. Set Cookie
    const response = NextResponse.redirect(url.origin);
    response.cookies.set("secondme_access_token", accessToken, {
        httpOnly: true,
        secure: !isDev, 
        sameSite: "lax",
        path: "/",
        maxAge: expiresIn ?? 7200,
    });
    return response;

  } catch (error) {
      console.error("Auth Callback Critical Error:", error);
      return NextResponse.json({ error: "Auth Failed" }, { status: 500 });
  }
}