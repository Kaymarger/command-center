import type { Metadata } from "next";
import { OpsDashboard } from "@/components/ops-dashboard";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

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
