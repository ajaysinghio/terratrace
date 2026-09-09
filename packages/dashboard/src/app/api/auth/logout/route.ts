import { NextResponse } from "next/server";
import { appUrl } from "../../../../lib/authConfig";
import { COOKIE_NAME } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const response = NextResponse.redirect(new URL("/", appUrl()));
  response.cookies.delete(COOKIE_NAME);
  return response;
}
