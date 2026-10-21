import type { BotTarget } from "@/lib/ops-actions";

/**
 * Live webhook addresses stay in host env vars (BOT_*_URL).
 * Do not commit them. Auth keys stay in BOT_*_KEY and are never committed.
 */
export function defaultBotWebhookUrl(bot: BotTarget): string | undefined {
  void bot;
  return undefined;
}
