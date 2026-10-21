"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { organizeNotes } from "@/lib/organize-notes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type DashboardNotepadProps = {
  storageKey: string;
  placeholder: string;
};

export function DashboardNotepad({
  storageKey,
  placeholder,
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
      setValue(organizeNotes(value));
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="min-h-0 flex-1 resize-none border-white/10 bg-black/20 text-sm leading-relaxed"
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
