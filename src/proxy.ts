import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  OPS_SESSION_COOKIE,
  hasBotBearer,
  isValidSession,
  opsPassword,
  safeNextPath,
} from "@/lib/ops-auth";
import { isTenantCalculatorPath } from "@/lib/tenant-notice";

function isLogin(pathname: string) {
  return pathname === "/login" || pathname.startsWith("/login/");
}

function isBotWebhook(pathname: string) {
  return /^\/api\/bots\/[^/]+\/webhook\/?$/.test(pathname);
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Public notice calculator. Every other page and API stays behind sign-in.
  if (isTenantCalculatorPath(pathname)) {
    return NextResponse.next();
  }

  const password = opsPassword();
  const authed = Boolean(
    password &&
      isValidSession(request.cookies.get(OPS_SESSION_COOKIE)?.value, password),
  );

  if (isLogin(pathname)) {
    if (!authed) return NextResponse.next();
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    return NextResponse.redirect(new URL(next, request.url));
  }

  if (authed) return NextResponse.next();

  if (
    isBotWebhook(pathname) &&
    hasBotBearer(request.headers.get("authorization"))
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    if (!password) {
      return NextResponse.json(
        { error: "Sign-in is not set up yet." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (!password) loginUrl.searchParams.set("setup", "1");
  const dest = `${pathname}${search}`;
  if (dest !== "/") loginUrl.searchParams.set("next", dest);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
