import type { EmailDelivery } from "@/lib/bot-email";
import { cn } from "@/lib/utils";

const labels: Record<EmailDelivery["status"], string> = {
  sent: "Email sent",
  failed: "Email failed",
  skipped: "Email skipped",
  not_configured: "Email not set up",
};

export function EmailDeliveryBadge({
  delivery,
  className,
}: {
  delivery?: EmailDelivery;
  className?: string;
}) {
  if (!delivery) {
    return (
      <span
        className={cn(
          "inline-flex rounded-md bg-white/10 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
          className
        )}
      >
        No email yet
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em]",
        delivery.status === "sent" && "bg-emerald-500/15 text-emerald-300",
        delivery.status === "failed" && "bg-red-500/15 text-red-300",
        delivery.status === "not_configured" && "bg-amber-500/15 text-amber-200",
        delivery.status === "skipped" && "bg-white/10 text-muted-foreground",
        className
      )}
      title={
        delivery.error ||
        (delivery.to ? `To ${delivery.to}` : undefined) ||
        labels[delivery.status]
      }
    >
      {labels[delivery.status]}
    </span>
  );
}

export function EmailDeliveryDetail({
  delivery,
}: {
  delivery?: EmailDelivery;
}) {
  if (!delivery) return null;

  if (delivery.status === "sent") {
    return (
      <p className="mt-1.5 text-xs text-emerald-300/90">
        Emailed to {delivery.to}
        {delivery.subject ? ` · ${delivery.subject}` : ""}
      </p>
    );
  }

  if (delivery.status === "failed") {
    return (
      <p className="mt-1.5 text-xs text-red-300/90">
        Email failed{delivery.error ? `: ${delivery.error}` : ""}
      </p>
    );
  }

  if (delivery.status === "not_configured") {
    return (
      <p className="mt-1.5 text-xs text-amber-200/90">
        {delivery.error ||
          "Bot email address or mail settings still need to be filled in."}
      </p>
    );
  }

  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      {delivery.error || "Email skipped for this job."}
    </p>
  );
}
