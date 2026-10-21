import {
  awaitStoreReady,
  getFeeds,
  listArtifacts,
  listDrafts,
  listJobs,
  subscribe,
} from "@/lib/bot-store";
import { requireUserSession } from "@/lib/ops-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = await requireUserSession();
  if (denied) return denied;

  await awaitStoreReady();

  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      send("feeds", getFeeds());
      send("drafts", listDrafts());
      send("jobs", listJobs());
      send("artifacts", listArtifacts());

      const unsubscribe = subscribe((event, payload) => {
        try {
          send(event, payload);
        } catch {
          cleanup();
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* closed */
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
