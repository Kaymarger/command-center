import { importantDateGroups, todoSentence } from "@/lib/dashboard-text";

/** Turn a notepad into dated lines or to-do sentences. */
export function organizeNotes(raw: string, kind: "dates" | "todos" = "dates"): string {
  if (kind === "dates") {
    return importantDateGroups(raw)
      .flatMap((group) =>
        group.label === "No date"
          ? group.notes
          : group.notes.map((note) => `${group.label} — ${note}`),
      )
      .join("\n");
  }
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => todoSentence(line))
    .filter(Boolean)
    .join("\n");
}
