import type { Metadata } from "next";
import { JobsInbox } from "@/components/jobs-inbox";

export const metadata: Metadata = {
  title: "Job inbox",
};

export default function JobsPage() {
  return (
    <main className="relative min-h-screen">
      <JobsInbox />
    </main>
  );
}
