"use client";
import { useEffect, useState } from "react";
import { I18nProvider } from "@/lib/i18n";
import { isKiosk, lockDown } from "@/lib/kiosk";
import { TwinProvider } from "@/lib/twinContext";
import type { KioskMode } from "./KioskLayer";
import Shell from "./Shell";

export default function Root() {
  const [kiosk] = useState(isKiosk);
  const [kioskMode, setKioskMode] = useState<KioskMode>(kiosk ? "attract" : "live");
  useEffect(() => (kiosk ? lockDown() : undefined), [kiosk]);
  return (
    <I18nProvider>
      <TwinProvider holdHour={kiosk && kioskMode === "attract"}>
        <Shell kiosk={kiosk} kioskMode={kioskMode} setKioskMode={setKioskMode} />
      </TwinProvider>
    </I18nProvider>
  );
}
