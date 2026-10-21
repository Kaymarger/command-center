import { cn } from "@/lib/utils";

export type WebhookDelivery = {
  status: "sent" | "failed" | "not_configured";
  httpStatus?: number;
  error?: string;
  sentAt?: string;
};

const labels: Record<WebhookDelivery["status"], string> = {
  sent: "Sent to bot",
  failed: "Bot send failed",
  not_configured: "Bot not linked",
};

export function WebhookDeliveryBadge({
  delivery,
  className,
}: {
  delivery?: WebhookDelivery;
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
        No send yet
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em]",
        delivery.status === "sent" && "bg-emerald-500/15 text-emerald-300",
        delivery.status === "failed" && "bg-red-500/15 text-red-300",
        delivery.status === "not_configured" &&
          "bg-amber-500/15 text-amber-200",
        className
      )}
      title={delivery.error || labels[delivery.status]}
    >
      {labels[delivery.status]}
    </span>
  );
}

export function WebhookDeliveryDetail({
  delivery,
}: {
  delivery?: WebhookDelivery;
}) {
  if (!delivery) return null;

  if (delivery.status === "sent") {
    return (
      <p className="mt-1.5 text-xs text-emerald-300/90">
        {typeof delivery.httpStatus === "number"
          ? `The webhook replied ${delivery.httpStatus}.`
          : "Job posted to the bot’s webhook."}
      </p>
    );
  }

  return (
    <p
      className={
        delivery.status === "failed"
          ? "mt-1.5 text-xs text-red-300/90"
          : "mt-1.5 text-xs text-amber-200/90"
      }
    >
      {delivery.error ||
        (delivery.status === "failed"
          ? "This job was not sent. Check the bot webhook address and key on the host."
          : "This bot’s webhook address or key is not set on the host yet.")}
    </p>
  );
}
