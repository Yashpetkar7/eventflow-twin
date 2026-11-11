import type { Metadata, Viewport } from "next";
import { Geist, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font: no font requests at the venue (offline booth).
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const plexArabic = IBM_Plex_Sans_Arabic({ variable: "--font-plex-arabic", subsets: ["arabic"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "EventFlow Twin",
  description: "Research prototype: forecast event-driven metro crowding on Dubai's Sheikh Zayed Road corridor and test interventions a human planner approves.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" dir="ltr" className={`${geistSans.variable} ${plexArabic.variable} h-full antialiased`}>
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
