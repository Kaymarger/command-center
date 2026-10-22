"use client";

import { useEffect, useRef, useState } from "react";
import { organizeNotes } from "@/lib/organize-notes";
import { Textarea } from "@/components/ui/textarea";

type DashboardNotepadProps = {
  storageKey: string;
  placeholder: string;
  draft?: string;
  onSave?: (text: string) => Promise<{ ok: boolean; message: string }>;
};

export function DashboardNotepad({ storageKey, placeholder, draft = "", onSave }: DashboardNotepadProps) {
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const onSaveRef = useRef(onSave);
  const savedRef = useRef("");
  onSaveRef.current = onSave;

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey) ?? "";
    const initial = draft || saved;
    setValue(initial);
    savedRef.current = draft;
    setReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (!ready || dirty) return;
    if (draft) setValue(draft);
  }, [draft, dirty, ready]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(storageKey, value);
  }, [ready, storageKey, value]);

  useEffect(() => {
    if (!ready || !dirty) return;
    const handle = window.setTimeout(() => {
      const next = organizeNotes(value, "dates");
      setDirty(false);
      if (next !== value) setValue(next);
      if (!onSaveRef.current || next === savedRef.current) return;
      void onSaveRef.current(next).then((result) => {
        if (result.ok) {
          savedRef.current = next;
          setNotice("");
        } else {
          setNotice(result.message || "That did not save.");
        }
      });
    }, 700);
    return () => window.clearTimeout(handle);
  }, [dirty, ready, value]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Textarea
        value={value}
        onChange={(event) => {
          setNotice("");
          setDirty(true);
          setValue(event.target.value);
        }}
        placeholder={placeholder}
        aria-label="Important dates"
        className="h-full min-h-[3.25rem] flex-1 resize-none border-white/10 bg-black/20 text-xs leading-snug"
      />
      {notice ? <p className="pt-0.5 text-[0.65rem] leading-snug text-amber-200">{notice}</p> : null}
    </div>
  );
}
