import { importantDateLine, todoSentence } from "@/lib/dashboard-text";

/** Turn a notepad into dated lines or to-do sentences. */
export function organizeNotes(raw: string, kind: "dates" | "todos" = "dates"): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (kind === "todos" ? todoSentence(line) : importantDateLine(line)))
    .filter(Boolean)
    .join("\n");
}
