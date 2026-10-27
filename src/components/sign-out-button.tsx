"use client";

import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";
import { isTenantCalculatorPath } from "@/lib/tenant-notice";

export function SignOutButton() {
  const pathname = usePathname();
  if (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    isTenantCalculatorPath(pathname)
  ) {
    return null;
  }

  return (
    <div className="relative z-30 flex justify-end px-5 pt-4">
      <form action={logout}>
        <button
          type="submit"
          className="rounded-full border border-white/15 bg-black/30 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur transition hover:text-foreground"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
