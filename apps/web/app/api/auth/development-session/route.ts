import { NextResponse } from "next/server";
import { z } from "zod";

import {
  DEVELOPMENT_SESSION_COOKIE,
  isDevelopmentAuthorizationEnabled
} from "@/lib/auth/development-session";

const requestSchema = z
  .object({
    account: z.string().trim().min(1).max(120),
    password: z.string().min(1).max(200)
  })
  .strict();

export async function POST(request: Request) {
  if (!isDevelopmentAuthorizationEnabled()) {
    return NextResponse.json(
      { code: "DEVELOPMENT_LOGIN_DISABLED", message: "开发态登录未启用" },
      { status: 503 }
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_LOGIN_INPUT", message: "请输入账号和密码" },
      { status: 400 }
    );
  }

  const response = NextResponse.json({ displayName: parsed.data.account });
  response.cookies.set({
    name: DEVELOPMENT_SESSION_COOKIE,
    value: encodeURIComponent(parsed.data.account),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8
  });
  return response;
}

export function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: DEVELOPMENT_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  return response;
}
