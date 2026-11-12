"use client";
// Client-only shell: the exhibit is a single offline page and locale/kiosk come from the URL, so there is
// nothing to gain from server rendering (reading the URL during render would cause hydration mismatches).
import dynamic from "next/dynamic";

const Root = dynamic(() => import("./Root"), {
  ssr: false,
  loading: () => <div style={{ display: "grid", placeItems: "center", height: "100vh", color: "#6B7284" }}>EventFlow Twin…</div>,
});

export default function App() {
  return <Root />;
}
