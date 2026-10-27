"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import {
  DEFAULT_DELIVERY_METHOD,
  DELIVERY_METHODS,
  TENANT_CALCULATOR_PUBLIC_URL,
  calculateTenantNotice,
  type DeliveryMethodId,
} from "@/lib/tenant-notice";
import { cn } from "@/lib/utils";

const RULES =
  "Rules: subjects removed and buyer requests notice in writing; notice generated via the BC Landlord Use Web Portal; tenancy ends at least 3 months after notice is received, on the day before rent is due; tenant leaves by 1 PM on the effective date and the buyer can move in the next day. Confirm unusual cases with the Residential Tenancy Branch.";

function localTodayISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function subscribeToNothing() {
  return () => {};
}

const fieldClass =
  "h-11 w-full rounded-lg border border-[#7395B8]/35 bg-black/25 px-3 text-base text-foreground outline-none [color-scheme:dark] focus-visible:border-[#7395B8] focus-visible:ring-2 focus-visible:ring-[#7395B8]/50";

export function TenantNoticeCalculator({
  variant = "page",
}: {
  variant?: "card" | "page";
}) {
  const compact = variant === "card";
  const today = useSyncExternalStore(subscribeToNothing, localTodayISO, () => "");
  const [servedOverride, setServedOverride] = useState<string | null>(null);
  const served = servedOverride ?? today;
  const [deliveryId, setDeliveryId] = useState<DeliveryMethodId>(DEFAULT_DELIVERY_METHOD);
  const [rentDueDay, setRentDueDay] = useState("1");
  const [fixedTerm, setFixedTerm] = useState(false);
  const [termEnd, setTermEnd] = useState("");
  const [copied, setCopied] = useState(false);

  const rows = calculateTenantNotice({
    served,
    deliveryId,
    rentDueDay,
    fixedTerm,
    termEnd,
  });

  async function copyLink() {
    const url = TENANT_CALCULATOR_PUBLIC_URL;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const area = document.createElement("textarea");
      area.value = url;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={cn("text-foreground", compact ? "pt-1" : "mt-5")} data-tenant-calculator={variant}>
      <div
        className="grid grid-cols-2 gap-2"
        role="group"
        aria-label="Tenancy type"
      >
        <button
          type="button"
          aria-pressed={!fixedTerm}
          onClick={() => setFixedTerm(false)}
          className={cn(
            "h-11 rounded-lg border px-3 text-sm font-medium transition",
            !fixedTerm
              ? "border-[#1F6598] bg-[#1F6598] text-white"
              : "border-[#7395B8]/35 bg-black/20 text-muted-foreground hover:text-foreground",
          )}
        >
          Month-to-month
        </button>
        <button
          type="button"
          aria-pressed={fixedTerm}
          onClick={() => setFixedTerm(true)}
          className={cn(
            "h-11 rounded-lg border px-3 text-sm font-medium transition",
            fixedTerm
              ? "border-[#1F6598] bg-[#1F6598] text-white"
              : "border-[#7395B8]/35 bg-black/20 text-muted-foreground hover:text-foreground",
          )}
        >
          Fixed-term
        </button>
      </div>

      {fixedTerm ? (
        <p className="mt-2 rounded-lg border border-amber-200/30 bg-amber-200/10 px-3 py-2 text-sm leading-snug text-amber-100">
          Fixed-term: the tenant cannot be required to vacate before the end of the term.
        </p>
      ) : null}

      <div className={cn("mt-3 grid gap-3", compact ? "sm:grid-cols-2" : "gap-4")}>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Subject removal date
          </span>
          <input
            type="date"
            value={served}
            onChange={(event) => setServedOverride(event.target.value)}
            className={fieldClass}
            aria-label="Subject removal date"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Delivery method
          </span>
          <select
            value={deliveryId}
            onChange={(event) => setDeliveryId(event.target.value as DeliveryMethodId)}
            className={fieldClass}
            aria-label="Delivery method"
          >
            {DELIVERY_METHODS.map((method) => (
              <option key={method.id} value={method.id}>
                {method.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Rent due day of month
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={28}
            value={rentDueDay}
            onChange={(event) => setRentDueDay(event.target.value)}
            className={fieldClass}
            aria-label="Rent due day of month"
          />
        </label>

        {fixedTerm ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Fixed term end date
            </span>
            <input
              type="date"
              value={termEnd}
              onChange={(event) => setTermEnd(event.target.value)}
              className={fieldClass}
              aria-label="Fixed term end date"
            />
          </label>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <dl className="mt-4">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-start justify-between gap-3 border-b border-white/10 py-2.5"
            >
              <dt className="min-w-0 text-sm text-muted-foreground">{row.label}</dt>
              <dd className="shrink-0 text-right text-sm font-semibold text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Enter a subject removal date.</p>
      )}

      <p className={cn("text-muted-foreground", compact ? "mt-3 text-xs leading-relaxed" : "mt-4 text-sm leading-relaxed")}>
        {RULES}
      </p>

      {compact ? (
        <div className="mt-3 rounded-lg border border-[#7395B8]/30 bg-black/20 px-3 py-2.5">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#7395B8]">
            Shareable link (no password)
          </p>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <a
              href={TENANT_CALCULATOR_PUBLIC_URL}
              className="min-w-0 flex-1 break-all text-sm text-foreground underline decoration-[#7395B8]/50 underline-offset-2"
            >
              {TENANT_CALCULATOR_PUBLIC_URL}
            </a>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#7395B8]/40 px-3 text-sm font-medium text-[#7395B8] transition hover:border-[#7395B8]/70 hover:text-foreground"
            >
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
