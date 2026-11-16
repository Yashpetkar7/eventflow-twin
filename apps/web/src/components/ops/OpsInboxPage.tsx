"use client";
// Client-only, like the twin: the locale comes from the URL (?lang=ar), so the language provider and the page both
// load in the browser (rendering them on the server would read `window`).
import dynamic from "next/dynamic";

const Inner = dynamic(() => Promise.all([import("./OpsInbox"), import("@/lib/i18n")]).then(([m, i]) => {
  function Root() {
    return <i.I18nProvider><m.OpsInbox /></i.I18nProvider>;
  }
  return Root;
}), { ssr: false, loading: () => <p style={{ padding: 24 }}>EventFlow Twin…</p> });

export default function OpsInboxPage() {
  return <Inner />;
}
