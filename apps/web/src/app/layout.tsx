import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Readex Pro (SIL OFL) ships inside the repo: no font request ever leaves the booth laptop.
const readex = localFont({
  src: [{ path: "./fonts/readex-pro-latin-wght-normal.woff2", weight: "160 700" }],
  variable: "--font-readex", display: "swap", adjustFontFallback: false,
});
const readexExt = localFont({
  src: [{ path: "./fonts/readex-pro-latin-ext-wght-normal.woff2", weight: "160 700" }],
  variable: "--font-readex-ext", display: "swap", adjustFontFallback: false,
});
const readexAr = localFont({
  src: [{ path: "./fonts/readex-pro-arabic-wght-normal.woff2", weight: "160 700" }],
  variable: "--font-readex-ar", display: "swap", adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "EventFlow Twin",
  description: "Interactive digital twin demonstrator: event-driven metro crowding on Dubai's Sheikh Zayed Road corridor, with plans a human approves.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${readex.variable} ${readexExt.variable} ${readexAr.variable}`}>
      <body>{children}</body>
    </html>
  );
}
