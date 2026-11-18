"use client";
// The Ask tab (contract 1.17.0, docs/18_ASSISTANT.md): a conversation with the twin about the scenario on screen.
// Every answer shows what stands behind it (the simulator runs, the documents with their source), how it was routed
// and, for a recommendation, its confidence in separate graded parts. An instruction ("attendance to 60,000") changes
// the real scenario: the controls on the left move, and the change can be undone with one tap.
import { useEffect, useRef, useState } from "react";
import { N, useFmt, useLocale } from "@/lib/i18n";
import { useAssistant, type Turn } from "@/lib/assistant";
import { useTwin } from "@/lib/store";
import type { ChatResponse, CompareTable, ConfidenceReport, EvidenceRef } from "@/lib/api";
import { chipKey, useSay } from "./say";

const STARTERS = ["overcrowded", "best_plan", "compare", "lens:safety", "whatif_attendance", "confidence", "evidence"];
const LENSES = ["safety", "crowd", "wait", "cost", "resources", "accessibility", "balanced"];
const PARTS = ["forecast", "evidence", "robustness", "validation", "execution"] as const;

function Evidence({ res }: { res: ChatResponse }) {
  const { t } = useSay();
  const [open, setOpen] = useState(res.passages);
  const docs = res.evidence.filter((e) => e.kind === "document");
  const runs = res.evidence.filter((e) => e.kind !== "document");
  if (!docs.length && !runs.length) return null;
  return (
    <div className="as-evidence" data-testid="as-evidence">
      <div className="as-label">{t("sources")}</div>
      {runs.length > 0 && (
        <div className="as-runs">
          {runs.map((e, i) => (
            <span key={`${e.id}${i}`} className="as-run" data-kind={e.kind}>{t(`tool.${e.tool ?? "simulate"}`)} <code>{e.run_id ?? e.id}</code></span>
          ))}
        </div>
      )}
      {docs.length > 0 && !res.passages && (
        <button type="button" className="as-link" aria-expanded={open} onClick={() => setOpen(!open)}>{t("tool.retrieve")} · <N>{docs.length}</N></button>
      )}
      {open && docs.map((e) => <DocCard key={e.id ?? e.title} e={e} />)}
    </div>
  );
}

export function DocCard({ e, link = true }: { e: EvidenceRef; link?: boolean }) {
  const { t } = useSay();
  const { locale } = useLocale();
  const web = (e.url ?? "").startsWith("http");
  return (
    <figure className="as-doc" data-testid="as-doc" data-source={e.id}>
      <blockquote lang={e.excerpt_locale ?? "en"} dir={e.excerpt_locale === "ar" ? "rtl" : "ltr"}>{e.excerpt}</blockquote>
      <figcaption>
        <span className={`badge sm${e.source_kind === "official" ? " navy" : ""}`}>{t(`doc.${e.source_kind ?? "project"}`)}</span>
        <b><bdi>{e.authority}</bdi></b>
        <span><bdi>{e.title}</bdi>{e.section ? <> · <bdi>{e.section}</bdi></> : null}</span>
        <span className="note"><N>{e.published ? t("doc.published", { d: e.published }) : t("doc.undated")}</N> · <N>{t("doc.retrieved", { d: e.retrieved ?? "" })}</N></span>
        <span className="note">{t("doc.licence", { l: e.licence ?? "" })}</span>
        {locale === "ar" && e.excerpt_locale !== "ar" && <span className="note">{t("doc.translated")}</span>}
        {link && web ? <a href={e.url!} target="_blank" rel="noopener noreferrer"><bdi>{e.url}</bdi></a> : <code><bdi>{e.url}</bdi></code>}
      </figcaption>
    </figure>
  );
}

function Confidence({ c }: { c: ConfidenceReport }) {
  const { t, sep } = useSay();
  const f = useFmt();
  const fc = c.forecast as Record<string, number | null>, rb = c.robustness as Record<string, number | null>, va = c.validation as Record<string, number | null>;
  const ex = c.execution as Record<string, string | number | null>, ev = c.evidence as { is_synthetic?: boolean };
  const detail: Record<string, string | null> = {
    forecast: fc.p50 != null ? t("conf.dForecast", { p10: f.int(Number(fc.p10)), p50: f.int(Number(fc.p50)), p90: f.int(Number(fc.p90)) }) : null,
    evidence: t("conf.dEvidence", { demand: t(ev.is_synthetic ? "conf.synthetic" : "conf.real") }),
    robustness: rb.total != null ? t("conf.dRobust", { holds: f.int(Number(rb.holds)), total: f.int(Number(rb.total)), passed: f.int(Number(rb.checks_passed)), applicable: f.int(Number(rb.checks_applicable)) }) : null,
    validation: va.numbers_checked != null ? t("conf.dValid", { n: f.int(Number(va.numbers_checked)) }) : null,
    execution: ex.engine ? t("conf.dExec", { engine: String(ex.engine), sims: f.int(Number(ex.simulations ?? 0)), calls: f.int(Number(ex.model_calls ?? 0)) }) : null,
  };
  return (
    <div className="as-conf" data-testid="as-confidence" data-overall={c.overall}>
      <div className="as-label">{t("conf.title")}</div>
      <ul>
        {PARTS.map((p) => (
          <li key={p} data-part={p} data-level={c.levels[p]}>
            <span className={`as-level ${c.levels[p]}`}>{t(`level.${c.levels[p]}`)}</span>
            <span><b>{t(`conf.${p}`)}</b>{detail[p] ? <><br /><small><N>{detail[p]}</N></small></> : null}</span>
          </li>
        ))}
      </ul>
      <p className="as-overall"><b>{t("conf.overall", { level: t(`level.${c.overall}`) })}</b>
        {c.limiting.length > 0 && <> · {t("conf.weakest", { parts: c.limiting.map((p) => t(`part.${p}`)).join(sep) })}</>}</p>
      <p className="note">{t("conf.note")}</p>
    </div>
  );
}

export function Plans({ table, onLens, busy }: { table: CompareTable; onLens: (lens: string) => void; busy: boolean }) {
  const { t, sep } = useSay();
  const f = useFmt();
  const weights = Object.entries(table.weights).map(([k, v]) => `${t(`obj.${k}`)} ${f.int(Math.round(v * 100))}%`).join(sep);
  return (
    <div className="as-plans" data-testid="as-table" data-lens={table.lens}>
      <div className="as-label">{t("table.lens", { lens: t(`lens.${table.lens}`) })}</div>
      <p className="note"><N>{t("table.weights", { w: weights })}</N></p>
      {table.ignored.length > 0 && <p className="warnbox">{t("table.ignored", { what: table.ignored.map((o) => t(`obj.${o}`)).join(sep) })}</p>}
      {table.rows.map((r) => (
        <div key={r.id} className={`as-plan${r.eligible ? "" : " blocked"}`} data-testid="as-plan" data-id={r.id} data-eligible={r.eligible} data-pareto={r.pareto}>
          <div className="as-plan-h">
            <b><bdi>{r.title}</bdi></b>
            <span className="as-tags">
              {r.rank != null && r.rank === table.recommended_rank && <span className="badge sm navy">{t("table.recommended")}</span>}
              <span className="badge sm">{t(r.offered ? "table.offered" : "table.tested")}</span>
              {r.pareto && <span className="badge sm ok" title={t("table.pareto")}>{t("table.pareto")}</span>}
            </span>
          </div>
          {!r.eligible && <p className="warnbox">{t("table.blocked", { why: r.blocked_by.map((b) => t(`hard.${b}`)).join(sep) })}</p>}
          <dl>
            <div><dt>{t("table.peak")}</dt><dd><N>{f.int(Math.round((r.values.safety ?? 0) * 100))}%</N></dd></div>
            <div><dt>{t("table.excess")}</dt><dd><N>{f.int(Math.round(r.values.crowd ?? 0))}</N></dd></div>
            <div><dt>{t("table.wait")}</dt><dd><N>{t("table.minutes", { n: f.num(r.values.wait ?? 0, 1) })}</N></dd></div>
            <div><dt>{t("table.cost")}</dt><dd><N>{f.num(r.values.cost ?? 0, 1)}</N></dd></div>
            <div><dt>{t("table.walk")}</dt><dd><N>{f.num(r.values.accessibility ?? 0, 1)}</N></dd></div>
            <div><dt>{t("table.emissions")}</dt><dd className="as-none">{t("table.none")}</dd></div>
          </dl>
          <p className="note">{t("table.parties")}: {r.parties.map((p) => t(`party.${p}`)).join(sep) || t("none")} · {t("table.state", { s: t(`life.${r.lifecycle}`) })}
            {r.run_id ? <> · <code>{r.run_id}</code></> : null}</p>
        </div>
      ))}
      <div className="as-lenses">
        <span className="note">{t("table.again")}</span>
        {LENSES.filter((l) => l !== table.lens).map((l) => (
          <button key={l} type="button" className="pill" disabled={busy} onClick={() => onLens(l)} data-lens={l}>{t(`lens.${l}`)}</button>
        ))}
      </div>
    </div>
  );
}

function Answer({ turn, last }: { turn: Turn; last: boolean }) {
  const { say, t, show, sep } = useSay();
  const { locale } = useLocale();
  const busy = useAssistant((s) => s.busy);
  const send = useAssistant((s) => s.send);
  const res = turn.res;
  if (turn.error || !res) return <div className="warnbox" role="alert" data-testid="as-error">{t("error", { msg: turn.error ?? "" })}</div>;
  const tools = [...new Set(res.tools.map((x) => t(`tool.${String(x.tool)}`)))].join(sep);
  return (
    <div className={`as-answer ${res.status}`} data-testid="as-answer" data-status={res.status} data-intent={res.intent ?? ""}>
      {res.status !== "answered" && <span className={`badge sm${res.status === "applied" ? " ok" : ""}`}>{t(`status.${res.status}`)}</span>}
      {res.blocks.filter((b) => !b.key.startsWith("chat.set.")).map((b, i) => <p key={i} data-key={b.key}><N>{say(b)}</N></p>)}
      {res.patch && (
        <div className="as-patch" data-testid="as-patch" data-version={res.patch.version}>
          <div className="as-label">{t("patch.title")} · <N>{t("version", { v: res.patch.version })}</N></div>
          <ul>
            {res.patch.changes.map((c) => (
              <li key={c.field} data-field={c.field}><b>{t(`field.${c.field}`)}</b> <N>{show(c.field, Array.isArray(c.was) ? c.was.join(", ") : c.was)} → {show(c.field, Array.isArray(c.to) ? c.to.join(", ") : c.to)}</N></li>
            ))}
          </ul>
          <p className="note">{t("patch.recalc", { what: res.patch.recalculated.map((r) => `${t(`recalc.${String(r.what)}`)} ${String(r.run_id)}`).join(sep) })}</p>
          <p className="note">{t("patch.applying")}</p>
          {last && <button type="button" className="pill" disabled={busy} onClick={() => void send({ intent: "undo" }, locale)} data-testid="as-undo">{t("patch.undo")}</button>}
        </div>
      )}
      {res.options.length > 0 && last && (
        <div className="as-options" data-testid="as-options">
          {res.options.map((o, i) => (
            <button key={i} type="button" className={i === 0 ? "btn navy" : "pill"} disabled={busy} data-intent={o.intent}
              onClick={() => void send({ intent: o.intent, args: o.args }, locale)}><N>{say({ key: o.label_key, params: o.params ?? {} })}</N></button>
          ))}
        </div>
      )}
      {res.table && <Plans table={res.table} busy={busy} onLens={(l) => void send({ intent: `lens:${l}` }, locale)} />}
      {res.confidence && <Confidence c={res.confidence} />}
      <Evidence res={res} />
      {res.findings.length > 0 && <p className="warnbox" data-testid="as-finding">{t("finding")}</p>}
      <p className="as-foot note" data-testid="as-route" data-via={res.routed_by}>{t(`via.${res.routed_by}`)}{tools ? <> {t("ran", { tools })}</> : null}</p>
    </div>
  );
}

export function Assistant() {
  const { t } = useSay();
  const { locale } = useLocale();
  const turns = useAssistant((s) => s.turns);
  const busy = useAssistant((s) => s.busy);
  const version = useAssistant((s) => s.version);
  const send = useAssistant((s) => s.send);
  const reset = useAssistant((s) => s.reset);
  const ready = useTwin((s) => !!s.forecast && !s.loading);
  const synthetic = useTwin((s) => s.forecast?.is_synthetic ?? true);
  const [q, setQ] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [turns.length, busy]);
  const lastRes = [...turns].reverse().find((x) => x.res)?.res;
  const chips = (lastRes?.suggestions.length ? lastRes.suggestions : STARTERS).slice(0, 6);
  const ask = (text: string) => { const m = text.trim().slice(0, 500); if (m) { setQ(""); void send({ message: m }, locale); } };
  return (
    <div className="assistant" data-testid="assistant" data-version={version}>
      <div className="as-head">
        <div>
          <h3 className="team-h">{t("title")}</h3>
          <p className="note">{t("sub")}</p>
        </div>
        <span className="as-meta">
          <span className="badge sm navy" data-testid="as-version"><N>{t("version", { v: version })}</N></span>
          {synthetic && <span className="badge sm">SYNTHETIC</span>}
        </span>
      </div>
      <div className="as-thread" role="log" aria-live="polite" data-testid="as-thread">
        {turns.length === 0 && <p className="as-example note">{t("example")}</p>}
        {turns.map((x, i) => x.who === "you"
          ? <div key={x.id} className="as-you" data-testid="as-you"><span className="note">{t("you")}</span><p><bdi>{x.text ?? t(chipKey(x.chip ?? "help"))}</bdi></p></div>
          : <Answer key={x.id} turn={x} last={i === turns.length - 1} />)}
        {busy && <p className="note" data-testid="as-busy">{t("thinking")}</p>}
        <div ref={end} />
      </div>
      <div className="as-chips" data-testid="as-chips">
        {turns.length === 0 && <span className="note">{t("starters")}</span>}
        {chips.map((c) => (
          <button key={c} type="button" className="pill" disabled={busy || !ready} data-intent={c} onClick={() => void send({ intent: c }, locale)}>{t(chipKey(c))}</button>
        ))}
      </div>
      <form className="as-form" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input className="ask-input" value={q} maxLength={500} onChange={(e) => setQ(e.target.value)} placeholder={t("placeholder")} aria-label={t("placeholder")} data-testid="as-input" />
        <button type="submit" className="btn navy" disabled={busy || !ready || !q.trim()} data-testid="as-send">{t("send")}</button>
      </form>
      {turns.length > 0 && <button type="button" className="as-link" onClick={reset} data-testid="as-reset">{t("clear")}</button>}
    </div>
  );
}
