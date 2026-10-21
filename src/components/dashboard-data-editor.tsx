"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import {
  emptyFeeds,
  type CincAgentStats,
  type IxactItem,
  type LiveFeeds,
  type OutstandingEmail,
  type ReferralItem,
} from "@/lib/dashboard-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#7395B8]/30 bg-white/[0.06] p-4 backdrop-blur-xl">
      <h2 className="mb-3 font-heading text-lg text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function DashboardDataEditor() {
  const [feeds, setFeeds] = useState<LiveFeeds>(emptyFeeds());
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/feeds/live", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: LiveFeeds) => setFeeds({ ...emptyFeeds(), ...data }));
  }, []);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/feeds/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feeds),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed");
      setStatus("Saved — dashboard will update live.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function updateCinc(index: number, patch: Partial<CincAgentStats>) {
    setFeeds((prev) => {
      const cincAgents = [...prev.cincAgents];
      cincAgents[index] = { ...cincAgents[index], ...patch };
      return { ...prev, cincAgents };
    });
  }

  return (
    <div className="relative mx-auto flex w-full max-w-4xl flex-col px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      <Link
        href="/dashboard"
        className="mb-5 inline-flex w-fit items-center gap-1.5 text-sm text-[#7395B8] transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Dashboard
      </Link>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-[clamp(1.6rem,3.5vw,2.25rem)] font-medium tracking-tight text-foreground">
            Live data
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit actual dashboard feeds here. No Google Sheet access required.
          </p>
        </div>
        <Button onClick={() => void save()} disabled={saving}>
          <Save />
          {saving ? "Saving…" : "Save to dashboard"}
        </Button>
      </header>

      {status ? (
        <p className="mb-4 text-sm text-[#7395B8]">{status}</p>
      ) : null}

      <div className="grid gap-4">
        <Section title="CINC agents">
          <div className="grid gap-3">
            {feeds.cincAgents.map((agent, index) => (
              <div
                key={agent.id}
                className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3"
              >
                <div className="flex justify-between gap-2">
                  <Label>Agent</Label>
                  <button
                    type="button"
                    className="text-[#7395B8]"
                    onClick={() =>
                      setFeeds((prev) => ({
                        ...prev,
                        cincAgents: prev.cincAgents.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <Input
                  value={agent.agent}
                  onChange={(e) => updateCinc(index, { agent: e.target.value })}
                  placeholder="Agent name"
                />
                <Input
                  value={agent.lastCall}
                  onChange={(e) =>
                    updateCinc(index, { lastCall: e.target.value })
                  }
                  placeholder="Last call"
                />
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    type="number"
                    value={agent.wtd.calls}
                    onChange={(e) =>
                      updateCinc(index, {
                        wtd: { ...agent.wtd, calls: Number(e.target.value) },
                      })
                    }
                    placeholder="WTD calls"
                  />
                  <Input
                    type="number"
                    value={agent.wtd.connected}
                    onChange={(e) =>
                      updateCinc(index, {
                        wtd: {
                          ...agent.wtd,
                          connected: Number(e.target.value),
                        },
                      })
                    }
                    placeholder="WTD connected"
                  />
                  <Input
                    type="number"
                    value={agent.wtd.appointments}
                    onChange={(e) =>
                      updateCinc(index, {
                        wtd: {
                          ...agent.wtd,
                          appointments: Number(e.target.value),
                        },
                      })
                    }
                    placeholder="WTD appts"
                  />
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                setFeeds((prev) => ({
                  ...prev,
                  cincAgents: [
                    ...prev.cincAgents,
                    {
                      id: crypto.randomUUID(),
                      agent: "",
                      lastCall: "",
                      wtd: { calls: 0, connected: 0, appointments: 0 },
                      mtd: { calls: 0, connected: 0, appointments: 0 },
                      ytd: { calls: 0, connected: 0, appointments: 0 },
                    },
                  ],
                }))
              }
            >
              <Plus />
              Add agent
            </Button>
          </div>
        </Section>

        <Section title="Anniversaries">
          <IxactEditor
            items={feeds.anniversaries}
            onChange={(anniversaries) =>
              setFeeds((prev) => ({ ...prev, anniversaries }))
            }
          />
        </Section>

        <Section title="Birthdays">
          <IxactEditor
            items={feeds.birthdays}
            onChange={(birthdays) =>
              setFeeds((prev) => ({ ...prev, birthdays }))
            }
          />
        </Section>

        <Section title="Open houses">
          <div className="grid gap-3">
            {feeds.openHouse.rows.map((row, index) => (
              <div key={`${row.agent}-${index}`} className="grid gap-2 sm:grid-cols-3">
                <Input
                  value={row.agent}
                  placeholder="Agent"
                  onChange={(e) => {
                    const rows = [...feeds.openHouse.rows];
                    rows[index] = { ...row, agent: e.target.value };
                    setFeeds((prev) => ({
                      ...prev,
                      openHouse: { ...prev.openHouse, rows },
                    }));
                  }}
                />
                <Input
                  value={row.window}
                  placeholder="Window"
                  onChange={(e) => {
                    const rows = [...feeds.openHouse.rows];
                    rows[index] = { ...row, window: e.target.value };
                    setFeeds((prev) => ({
                      ...prev,
                      openHouse: { ...prev.openHouse, rows },
                    }));
                  }}
                />
                <div className="flex gap-2">
                  <Input
                    value={row.coverage}
                    placeholder="Coverage"
                    onChange={(e) => {
                      const rows = [...feeds.openHouse.rows];
                      rows[index] = { ...row, coverage: e.target.value };
                      setFeeds((prev) => ({
                        ...prev,
                        openHouse: { ...prev.openHouse, rows },
                      }));
                    }}
                  />
                  <button
                    type="button"
                    className="text-[#7395B8]"
                    onClick={() =>
                      setFeeds((prev) => ({
                        ...prev,
                        openHouse: {
                          ...prev.openHouse,
                          rows: prev.openHouse.rows.filter((_, i) => i !== index),
                        },
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                setFeeds((prev) => ({
                  ...prev,
                  openHouse: {
                    ...prev.openHouse,
                    rows: [
                      ...prev.openHouse.rows,
                      { agent: "", window: "", coverage: "Available" },
                    ],
                  },
                }))
              }
            >
              <Plus />
              Add open-house row
            </Button>
          </div>
        </Section>

        <Section title="Referrals">
          <ReferralEditor
            label="Active"
            items={feeds.referrals.active}
            onChange={(active) =>
              setFeeds((prev) => ({
                ...prev,
                referrals: { ...prev.referrals, active },
              }))
            }
          />
          <div className="mt-4">
            <ReferralEditor
              label="History"
              items={feeds.referrals.history}
              onChange={(history) =>
                setFeeds((prev) => ({
                  ...prev,
                  referrals: { ...prev.referrals, history },
                }))
              }
            />
          </div>
        </Section>

        <Section title="Outstanding emails">
          <div className="grid gap-3">
            {feeds.outstandingEmails.map((email, index) => (
              <div key={email.id} className="grid gap-2">
                <div className="flex gap-2">
                  <Input
                    value={email.label}
                    placeholder="Label"
                    onChange={(e) => {
                      const outstandingEmails = [...feeds.outstandingEmails];
                      outstandingEmails[index] = {
                        ...email,
                        label: e.target.value,
                      };
                      setFeeds((prev) => ({ ...prev, outstandingEmails }));
                    }}
                  />
                  <button
                    type="button"
                    className="text-[#7395B8]"
                    onClick={() =>
                      setFeeds((prev) => ({
                        ...prev,
                        outstandingEmails: prev.outstandingEmails.filter(
                          (_, i) => i !== index
                        ),
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <Input
                  value={email.detail}
                  placeholder="Detail"
                  onChange={(e) => {
                    const outstandingEmails = [...feeds.outstandingEmails];
                    outstandingEmails[index] = {
                      ...email,
                      detail: e.target.value,
                    };
                    setFeeds((prev) => ({ ...prev, outstandingEmails }));
                  }}
                />
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                setFeeds((prev) => ({
                  ...prev,
                  outstandingEmails: [
                    ...prev.outstandingEmails,
                    {
                      id: crypto.randomUUID(),
                      type: "other",
                      label: "",
                      detail: "",
                    } satisfies OutstandingEmail,
                  ],
                }))
              }
            >
              <Plus />
              Add outstanding email
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function IxactEditor({
  items,
  onChange,
}: {
  items: IxactItem[];
  onChange: (items: IxactItem[]) => void;
}) {
  return (
    <div className="grid gap-3">
      {items.map((item, index) => (
        <div key={item.id} className="grid gap-2 sm:grid-cols-3">
          <Input
            value={item.name}
            placeholder="Name"
            onChange={(e) => {
              const next = [...items];
              next[index] = { ...item, name: e.target.value };
              onChange(next);
            }}
          />
          <Input
            value={item.date}
            placeholder="Date"
            onChange={(e) => {
              const next = [...items];
              next[index] = { ...item, date: e.target.value };
              onChange(next);
            }}
          />
          <div className="flex gap-2">
            <Input
              value={item.note}
              placeholder="Note"
              onChange={(e) => {
                const next = [...items];
                next[index] = { ...item, note: e.target.value };
                onChange(next);
              }}
            />
            <button
              type="button"
              className="text-[#7395B8]"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          onChange([
            ...items,
            { id: crypto.randomUUID(), name: "", date: "", note: "" },
          ])
        }
      >
        <Plus />
        Add row
      </Button>
    </div>
  );
}

function ReferralEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: ReferralItem[];
  onChange: (items: ReferralItem[]) => void;
}) {
  return (
    <div className="grid gap-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7395B8]">
        {label}
      </p>
      {items.map((item, index) => (
        <div key={item.id} className="grid gap-2 sm:grid-cols-3">
          <Input
            value={item.name}
            placeholder="Referral"
            onChange={(e) => {
              const next = [...items];
              next[index] = { ...item, name: e.target.value };
              onChange(next);
            }}
          />
          <Input
            value={item.direction}
            placeholder="Direction"
            onChange={(e) => {
              const next = [...items];
              next[index] = { ...item, direction: e.target.value };
              onChange(next);
            }}
          />
          <div className="flex gap-2">
            <Input
              value={item.meta}
              placeholder="Meta"
              onChange={(e) => {
                const next = [...items];
                next[index] = { ...item, meta: e.target.value };
                onChange(next);
              }}
            />
            <button
              type="button"
              className="text-[#7395B8]"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          onChange([
            ...items,
            {
              id: crypto.randomUUID(),
              name: "",
              status: label.toLowerCase() === "history" ? "history" : "active",
              direction: "",
              meta: "",
            },
          ])
        }
      >
        <Plus />
        Add {label.toLowerCase()} referral
      </Button>
    </div>
  );
}
