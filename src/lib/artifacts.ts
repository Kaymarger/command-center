import type { BotTarget } from "@/lib/ops-actions";

export type ArtifactKind =
  | "document"
  | "deal"
  | "chat"
  | "docusign"
  | "social"
  | "feature-sheet"
  | "listing";

export type ArtifactStatus = "ready" | "in-progress" | "queued" | "done";

export type BotArtifact = {
  id: string;
  jobId: string;
  kind: ArtifactKind;
  title: string;
  detail: string;
  property?: string;
  party?: string;
  channel?: string;
  bot: BotTarget;
  status: ArtifactStatus;
  createdAt: string;
};

export function artifactKindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case "document":
      return "Document";
    case "deal":
      return "Deal stage";
    case "chat":
      return "AREG Chat";
    case "docusign":
      return "DocuSign";
    case "social":
      return "Social";
    case "feature-sheet":
      return "Feature sheet";
    case "listing":
      return "Listing";
  }
}
