"use client";
// A QR code drawn in the page (decision #156): no image service, so it works with the booth's Wi-Fi off. The phone
// that scans it needs its own connection: the link opens the public rider page.
import { useMemo } from "react";
import qrcode from "qrcode-generator";

export function Qr({ url, size = 240, label, testid = "kiosk-qr" }: { url: string; size?: number; label: string; testid?: string }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, "M");                                  // type 0 = the smallest version that fits; M = 15 % error correction
    q.addData(url);
    q.make();
    const count = q.getModuleCount();
    let path = "";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (q.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { d: path, n: count + 8 };                          // a quiet zone of four modules on every side
  }, [url]);
  return (
    <svg className="kqr-code" role="img" aria-label={label} data-testid={testid} data-url={url} data-modules={n - 8} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
