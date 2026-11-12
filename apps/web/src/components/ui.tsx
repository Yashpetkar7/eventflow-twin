"use client";
// Small shared building blocks so every tab looks like one product.
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export function Card({ title, action, children, className = "" }: {
  title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-1)] ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center gap-3">
          {title && <h2 className="text-[14px] font-semibold text-ink">{title}</h2>}
          <div className="flex-1" />
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  neutral: "bg-accent-soft text-accent",
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/15 text-warn",
  risk: "bg-risk/12 text-risk",
} as const;

export function KpiCard({ icon: Icon, label, value, unit, sub, tone = "neutral", hint }: {
  icon: LucideIcon; label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode;
  tone?: keyof typeof TONES; hint?: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-1)]" title={hint}>
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${TONES[tone]}`}><Icon className="h-5 w-5" aria-hidden /></span>
        <p className="text-[13px] font-medium leading-snug text-ink-2">{label}</p>
      </div>
      <p className="num mt-4 text-[30px] font-semibold leading-none tracking-tight text-ink">
        {value}{unit && <span className="ms-1 text-[15px] font-medium text-ink-3">{unit}</span>}
      </p>
      {sub && <p className="mt-2 text-[12px] leading-snug text-ink-3">{sub}</p>}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-ink">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-ink-3">{sub}</p>}
      </div>
      <div className="flex-1" />
      {actions}
    </div>
  );
}

const LINE_STYLE: Record<string, string> = {
  Red: "bg-[#D9483B]/12 text-[#B23A2F]",
  Green: "bg-[#2E9E5B]/12 text-[#237A47]",
  Branch: "bg-[#E07A6E]/15 text-[#B5574C]",
};

export function LineChip({ line }: { line: string }) {
  const t = useTranslations("lineName");
  const label = line === "Red" || line === "Green" || line === "Branch" ? t(line) : line;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${LINE_STYLE[line] ?? "bg-muted text-ink-2"}`}>{label}</span>;
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "synthetic" | "ok" | "risk" }) {
  const cls = tone === "synthetic" ? "badge-synthetic" : tone === "ok" ? "bg-ok/12 text-ok" : tone === "risk" ? "bg-risk/12 text-risk" : "badge-assumption";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}
