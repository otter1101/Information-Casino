import axios from "axios";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase"; 

const TOKEN_URL = "https://app.mindos.com/gate/lab/api/oauth/token/code";
const USER_INFO_URL = "https://app.mindos.com/gate/lab/api/secondme/user/info";
const USER_SHADES_URL = "https://app.mindos.com/gate/lab/api/secondme/user/shades";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const isDev = process.env.NODE_ENV !== "production";
  
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const redirectUri = `${url.origin}/api/auth/callback`;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing client credentials" },
      { status: 500 }
    );
  }

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

    const { accessToken, expiresIn, refreshToken } = tokenRes.data.data;

    // 2. 🚀 关键：获取用户信息并存入 Supabase
    try {
      const [userRes, shadesRes] = await Promise.all([
        axios.get(USER_INFO_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        axios.get(USER_SHADES_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);

      if (userRes.data?.code === 0) {
        const u = userRes.data.data ?? {};
        const shades = shadesRes.data?.code === 0
          ? shadesRes.data?.data?.shades ?? []
          : [];
        const shadesStr = (shades || [])
          .map((s: any) => s.shadeNamePublic || s.shadeName || s.name || s)
          .filter(Boolean)
          .join(", ");

        const systemPrompt = `你是用户 ${u.name || "用户"} 的数字分身。你的兴趣标签是：${shadesStr || "综合"}。请代表你的本尊，用犀利、直接的风格参与商业博弈。你的利益与本尊绑定，如果发现方案有漏洞，请无情指出。`;

        await supabase.from("users").upsert({
          id: u.userId || u.id || u.user_id,
          name: u.name || u.nickname,
          avatar: u.avatar || u.avatar_url,
          email: u.email,
          shades,
          system_prompt: systemPrompt,
          last_seen: new Date().toISOString(),
        });
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
    response.cookies.set("secondme_refresh_token", refreshToken, {
      httpOnly: true,
      secure: !isDev,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    response.cookies.set("secondme_logged_in", "1", {
      httpOnly: false,
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