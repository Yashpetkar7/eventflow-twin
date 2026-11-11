"use client";
import { I18nProvider } from "@/lib/i18n";
import Workspace from "./Workspace";

export default function Root() {
  return (
    <I18nProvider>
      <Workspace />
    </I18nProvider>
  );
}
