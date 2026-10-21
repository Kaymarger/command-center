import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  OPS_SESSION_COOKIE,
  hasBotBearer,
  isValidSession,
  opsPassword,
} from "@/lib/ops-auth";

async function hasOpsSession(): Promise<boolean> {
  const password = opsPassword();
  if (!password) return false;
  const token = (await cookies()).get(OPS_SESSION_COOKIE)?.value;
  return isValidSession(token, password);
}

/** Block strangers from reading data or sending jobs. */
export async function requireUserSession(): Promise<NextResponse | null> {
  if (!opsPassword()) {
    return NextResponse.json(
      { error: "Sign-in is not set up yet." },
      { status: 503 },
    );
  }
  if (!(await hasOpsSession())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  return null;
}

/**
 * User session, or a bot calling back with its own Bearer key.
 * Does not accept the bot key as permission to send new jobs.
 */
export async function requireUserOrBot(
  request: Request,
): Promise<NextResponse | null> {
  if (await hasOpsSession()) return null;
  if (hasBotBearer(request.headers.get("authorization"))) return null;
  if (!opsPassword()) {
    return NextResponse.json(
      { error: "Sign-in is not set up yet." },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: "Sign in required." }, { status: 401 });
}
