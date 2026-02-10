import axios from "axios";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const TOKEN_URL = "https://app.mindos.com/gate/lab/api/oauth/token/code";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  
  // [关键修复] Next.js 15: cookies() 是异步的，必须加 await
  const cookieStore = await cookies();
  const storedState = cookieStore.get("secondme_oauth_state")?.value;

  if (!code || !state || !storedState || state !== storedState) {
    return NextResponse.json(
      { error: "Invalid code or state" },
      { status: 400 }
    );
  }

  const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing client credentials" },
      { status: 500 }
    );
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
        return NextResponse.json(
        { error: "Token exchange failed", details: payload },
        { status: 400 }
        );
    }

    const accessToken = payload?.data?.accessToken as string | undefined;
    const refreshToken = payload?.data?.refreshToken as string | undefined;
    const expiresIn = payload?.data?.expiresIn as number | undefined;

    if (!accessToken) {
        return NextResponse.json(
        { error: "Missing access token in response" },
        { status: 400 }
        );
    }

    const response = NextResponse.redirect(url.origin);
    
    // 设置 Cookie
    response.cookies.set("secondme_access_token", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: expiresIn ?? 7200,
    });

    if (refreshToken) {
        response.cookies.set("secondme_refresh_token", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        });
    }

    // 清理 state
    response.cookies.delete("secondme_oauth_state");
    return response;

  } catch (error: any) {
      console.error("Auth error:", error.response?.data || error.message);
      return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }
}