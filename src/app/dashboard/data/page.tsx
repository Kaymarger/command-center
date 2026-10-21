import type { Metadata } from "next";
import { DashboardDataEditor } from "@/components/dashboard-data-editor";

export const metadata: Metadata = {
  title: "Live data",
};

export default function DashboardDataPage() {
  return (
    <main className="relative min-h-screen">
      <DashboardDataEditor />
    </main>
  );
}
