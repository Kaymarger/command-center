import { cn } from "@/lib/utils";

export type WebhookDelivery = {
  status: "sent" | "failed" | "not_configured";
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
        Job posted to the bot’s webhook.
      </p>
    );
  }

  if (delivery.status === "failed") {
    return (
      <p className="mt-1.5 text-xs text-red-300/90">
        Could not reach the bot
        {delivery.error ? `: ${delivery.error}` : "."}
      </p>
    );
  }

  return (
    <p className="mt-1.5 text-xs text-amber-200/90">
      {delivery.error ||
        "This bot’s webhook URL is not set yet — paste it when you have it."}
    </p>
  );
}
