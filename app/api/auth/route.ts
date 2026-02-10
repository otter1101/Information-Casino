import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
  // 确保这里的端口和你本地运行的一致
  const redirectUri = process.env.REDIRECT_URI || "http://localhost:3000/api/auth/callback";
  
  // 生成随机 state
  const state = Math.random().toString(36).substring(7);
  
  // 构造 URL
  const authUrl = `https://go.second.me/oauth/?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${state}`;

  const response = NextResponse.redirect(authUrl);
  
  // [关键] 设置 cookie，以便 callback 时候验证
  // 必须和 callback 里的 cookie 名字 "secondme_oauth_state" 一致
  response.cookies.set("secondme_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 5, // 5分钟有效
  });

  return response;
}