import type { Metadata } from "next";
import { OpsDashboard } from "@/components/ops-dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardPage() {
  return (
    <main className="relative min-h-screen">
      <OpsDashboard />
    </main>
  );
}
