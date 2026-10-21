/** Light cleanup + organization for freeform notepad text. */
export function organizeNotes(raw: string): string {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]+\s*/, "").replace(/^\d+[.)]\s*/, ""));

  const dated: { sortKey: number; text: string }[] = [];
  const todos: string[] = [];
  const other: string[] = [];

  for (const line of lines) {
    const datedMatch = line.match(
      /^((?:\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{2,4})?)|(?:\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*\d{2,4})?))\s*[:\-]?\s*(.+)$/i
    );

    if (datedMatch) {
      const label = capitalize(datedMatch[1].replace(/\s+/g, " "));
      const rest = capitalize(datedMatch[2]);
      dated.push({
        sortKey: roughDateSortKey(datedMatch[1]),
        text: `• ${label} — ${rest}`,
      });
      continue;
    }

    if (/^(todo|to-?do|task)\b[:\-\s]*/i.test(line)) {
      todos.push(`• ${capitalize(line.replace(/^(todo|to-?do|task)\b[:\-\s]*/i, ""))}`);
      continue;
    }

    // Split "a, b, and c" style dumps into bullets when clearly a list
    if (line.includes(",") && line.length > 40 && !/[.!?]$/.test(line)) {
      const parts = line
        .split(/,|\band\b/i)
        .map((p) => p.trim())
        .filter((p) => p.length > 1);
      if (parts.length >= 3) {
        for (const part of parts) other.push(`• ${capitalize(part)}`);
        continue;
      }
    }

    other.push(`• ${capitalize(line)}`);
  }

  dated.sort((a, b) => a.sortKey - b.sortKey);

  const blocks: string[] = [];
  if (dated.length) {
    blocks.push(["Dates", ...dated.map((d) => d.text)].join("\n"));
  }
  if (todos.length) {
    blocks.push(["To-dos", ...todos].join("\n"));
  }
  if (other.length) {
    blocks.push(
      (dated.length || todos.length ? ["Notes", ...other] : other).join("\n")
    );
  }

  return blocks.join("\n\n").trim();
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function roughDateSortKey(raw: string): number {
  const months: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };

  const numeric = raw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : new Date().getFullYear();
    return year * 10000 + month * 100 + day;
  }

  const named = raw.match(
    /(?:(\d{1,2})\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})?(?:,?\s*(\d{2,4}))?/i
  );
  if (named) {
    const month = months[named[2].toLowerCase().slice(0, 3)] ?? 0;
    const day = Number(named[1] || named[3] || 1);
    const year = named[4]
      ? Number(named[4].length === 2 ? `20${named[4]}` : named[4])
      : new Date().getFullYear();
    return year * 10000 + month * 100 + day;
  }

  return Number.MAX_SAFE_INTEGER;
}
