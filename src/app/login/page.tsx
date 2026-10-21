import type { Metadata } from "next";
import { login } from "@/app/login/actions";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNextPath } from "@/lib/ops-auth";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; setup?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const setup = params.setup === "1";
  const invalid = params.error === "1";

  return (
    <main className="relative flex min-h-screen items-center justify-center px-5 py-16">
      <div className="w-full max-w-md rounded-3xl border border-[#7395B8]/30 bg-white/[0.07] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <p className="text-xs font-medium tracking-[0.18em] text-[#7395B8] uppercase">
          AREG Ops
        </p>
        <h1 className="mt-3 font-heading text-3xl font-medium tracking-tight text-foreground">
          Sign in
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the team password to open the command center and send jobs to
          the bots.
        </p>

        {setup ? (
          <p
            className="mt-5 rounded-2xl border border-amber-200/30 bg-amber-200/10 px-4 py-3 text-sm text-amber-100"
            role="status"
          >
            Sign-in is not turned on yet. The password still needs to be saved
            on the website host.
          </p>
        ) : null}

        {invalid ? (
          <p
            className="mt-5 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100"
            role="alert"
          >
            That password is not right. Try again.
          </p>
        ) : null}

        <form action={login} className="mt-6 flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              className="h-12 rounded-2xl border-white/12 bg-white/[0.07] px-4 text-base"
            />
          </div>
          <button
            type="submit"
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-12 w-full rounded-2xl text-base",
            )}
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
