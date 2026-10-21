"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  OPS_SESSION_COOKIE,
  createSessionValue,
  opsPassword,
  passwordsMatch,
  safeNextPath,
  sessionCookieOptions,
} from "@/lib/ops-auth";

export async function login(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const password = opsPassword();
  if (!password) {
    redirect("/login?setup=1");
  }

  const input = String(formData.get("password") ?? "");
  if (!input || !passwordsMatch(input, password)) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const params = new URLSearchParams({ error: "1" });
    if (next !== "/") params.set("next", next);
    redirect(`/login?${params.toString()}`);
  }

  const store = await cookies();
  store.set(OPS_SESSION_COOKIE, createSessionValue(password), sessionCookieOptions());
  redirect(next);
}

export async function logout() {
  const store = await cookies();
  store.set(OPS_SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  redirect("/login");
}
