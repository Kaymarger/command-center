import type { Metadata } from "next";
import { TenantNoticeCalculator } from "@/components/tenant-notice-calculator";

export const metadata: Metadata = {
  title: "Tenant Notice Date Calculator (BC)",
  description:
    "Calculate BC tenancy notice dates from the subject removal date, delivery method, and rent due day.",
};

export default function TenantCalculatorPage() {
  return (
    <main className="relative mx-auto w-full max-w-lg px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
      <div className="rounded-3xl border border-[#7395B8]/30 bg-white/[0.07] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8">
        <p className="text-xs font-medium tracking-[0.18em] text-[#7395B8] uppercase">
          AREG Ops
        </p>
        <h1 className="mt-3 font-heading text-[clamp(1.6rem,6vw,2rem)] font-medium leading-tight tracking-tight text-foreground">
          Tenant Notice Date Calculator (BC)
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Notice is served on the subject removal date. 3 months&apos; notice.
        </p>
        <TenantNoticeCalculator variant="page" />
      </div>
    </main>
  );
}
