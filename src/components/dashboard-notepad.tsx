"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { importantDateGroups, todoSentence } from "@/lib/dashboard-text";
import { organizeNotes } from "@/lib/organize-notes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type DashboardNotepadProps = {
  storageKey: string;
  placeholder: string;
  kind: "dates" | "todos";
  onSave?: (text: string) => Promise<{ ok: boolean; message: string }>;
};

export function DashboardNotepad({
  storageKey,
  placeholder,
  kind,
  onSave,
}: DashboardNotepadProps) {
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
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
      if (onSave) {
        setNotice(null);
        const result = await onSave(value);
        if (result.ok) {
          setValue("");
          setNotice(result.message ? result : null);
        } else {
          setNotice({ ok: false, message: result.message || "That did not work." });
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 280));
      setValue(organizeNotes(value, kind));
    });
  }

  const dateGroups = kind === "dates" ? importantDateGroups(value) : [];
  const todoLines =
    kind === "todos"
      ? value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => todoSentence(line))
          .filter(Boolean)
      : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {dateGroups.length > 0 ? (
        <ul className="grid min-h-0 flex-1 gap-1 overflow-y-auto">
          {dateGroups.map((group) => (
            <li key={group.label}>
              <p className="text-[0.65rem] font-semibold text-[#7395B8]">{group.label}</p>
              {group.notes.map((note) => (
                <p key={note} title={note} className="truncate text-xs leading-snug text-foreground">
                  {note}
                </p>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
      {todoLines.length > 0 ? (
        <ul className="grid min-h-0 flex-1 gap-0.5 overflow-y-auto">
          {todoLines.map((line, index) => (
            <li key={`${line}-${index}`} title={line} className="truncate text-xs leading-snug text-foreground">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <Textarea
        value={value}
        onChange={(e) => {
          setNotice(null);
          setValue(e.target.value);
        }}
        onBlur={() => {
          if (onSave) return;
          setValue(organizeNotes(value, kind));
        }}
        placeholder={placeholder}
        className="h-10 shrink-0 resize-none border-white/10 bg-black/20 text-xs leading-snug"
      />
      {notice?.message ? (
        <p className={`text-[0.65rem] leading-snug ${notice.ok ? "text-[#7395B8]" : "text-amber-200"}`}>
          {notice.message}
        </p>
      ) : null}
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
            {onSave ? "Saving" : "Organizing"}
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
