import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import { OpsBackground } from "@/components/ops-background";
import { SignOutButton } from "@/components/sign-out-button";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "AREG Ops",
    template: "%s · AREG Ops",
  },
  description:
    "Operations command center for Archibald Real Estate Group — listings, offers, marketing, and documents.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${roboto.variable} h-full antialiased`}>
      <body className="relative min-h-full font-sans">
        <OpsBackground />
        <SignOutButton />
        {children}
      </body>
    </html>
  );
}
