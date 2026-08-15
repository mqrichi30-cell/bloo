import { NextResponse } from "next/server";
import { getSession, CSRF_COOKIE_NAME } from "@/lib/session";

export async function POST() {
  const session = await getSession();
  session.destroy();

  const response = NextResponse.json({ ok: true });
  response.cookies.set(CSRF_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
