"use client";
// Client-only shell: the exhibit runs as a single offline page, and locale/kiosk come from the URL, so there is
// nothing to gain from server rendering (and reading the URL during render would cause hydration mismatches).
import dynamic from "next/dynamic";

const Root = dynamic(() => import("./Root"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-3">EventFlow Twin…</div>,
});

export default function App() {
  return <Root />;
}
