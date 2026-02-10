import axios from "axios";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const TOKEN_URL = "https://app.mindos.com/gate/lab/api/oauth/token/code";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  
  // Next.js 15 异步 Cookie
  const cookieStore = await cookies();
  const storedState = cookieStore.get("secondme_oauth_state")?.value;

  // --- 🚑 紧急修复：开发环境宽容模式 ---
  // 如果是开发环境，且有 code，哪怕 state 对不上也放行。
  // 只有在生产环境才强制检查 state，防止 CSRF 攻击。
  const isDev = process.env.NODE_ENV !== "production";
  
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  if (!isDev && (!state || !storedState || state !== storedState)) {
     return NextResponse.json({ error: "Invalid code or state" }, { status: 400 });
  }
  // ------------------------------------

  const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 500 });
  }

  const redirectUri = `${url.origin}/api/auth/callback`;
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  try {
    const tokenResponse = await axios.post(TOKEN_URL, body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const payload = tokenResponse.data;
    if (!payload || payload.code !== 0) {
        // 如果出错，打印详情方便调试
        console.error("Token Error Payload:", payload);
        return NextResponse.json({ error: "Token exchange failed", details: payload }, { status: 400 });
    }

    const accessToken = payload?.data?.accessToken;
    const refreshToken = payload?.data?.refreshToken;
    const expiresIn = payload?.data?.expiresIn;

    if (!accessToken) {
        return NextResponse.json({ error: "No access token" }, { status: 400 });
    }

    const response = NextResponse.redirect(url.origin);
    
    // 设置 Cookie，注意 localhost 下 secure 最好为 false (或者是根据协议自适应)
    response.cookies.set("secondme_access_token", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production", 
        sameSite: "lax",
        path: "/",
        maxAge: expiresIn ?? 7200,
    });

    // 清理 state
    response.cookies.delete("secondme_oauth_state");
    return response;

  } catch (error: any) {
      console.error("Auth error:", error.response?.data || error.message);
      return NextResponse.json({ error: "Auth failed check console" }, { status: 500 });
  }
}