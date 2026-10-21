"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { importantDateLine, todoSentence } from "@/lib/dashboard-text";
import { organizeNotes } from "@/lib/organize-notes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type DashboardNotepadProps = {
  storageKey: string;
  placeholder: string;
  kind: "dates" | "todos";
};

export function DashboardNotepad({
  storageKey,
  placeholder,
  kind,
}: DashboardNotepadProps) {
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) setValue(saved);
    setReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(storageKey, value);
  }, [ready, storageKey, value]);

  function organize() {
    startTransition(async () => {
      await new Promise((r) => setTimeout(r, 280));
      setValue(organizeNotes(value, kind));
    });
  }

  const rendered = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (kind === "todos" ? todoSentence(line) : importantDateLine(line)))
    .filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {rendered.length > 0 ? (
        <ul className="grid min-h-0 flex-1 gap-0.5 overflow-y-auto">
          {rendered.map((line, index) => (
            <li key={`${line}-${index}`} title={line} className="truncate text-xs leading-snug text-foreground">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setValue(organizeNotes(value, kind))}
        placeholder={placeholder}
        className="h-10 shrink-0 resize-none border-white/10 bg-black/20 text-xs leading-snug"
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending || !value.trim()}
        onClick={organize}
        className="w-full bg-[#1F6598]/35 text-foreground hover:bg-[#1F6598]/50"
      >
        {pending ? (
          <>
            <Loader2 className="animate-spin" />
            Organizing
          </>
        ) : (
          <>
            <Sparkles />
            Correct & organize
          </>
        )}
      </Button>
    </div>
  );
}
