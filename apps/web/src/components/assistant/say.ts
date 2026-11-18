// Words for the assistant's answers. The API sends a key and parameters; the parameter's name says what it holds
// (`_st` a station id, `_pct` / `_n` whole numbers, `_x` a decimal, `_t` a time, `_list` station ids, `_s` text), so
// one formatter serves every answer in English and Arabic and no figure is ever typed into a string here.
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useFmt, useLocale } from "@/lib/i18n";
import { useTwin } from "@/lib/store";
import type { ChatBlock } from "@/lib/api";

type Vals = Record<string, string | number>;
export type Words = (key: string, values?: Vals) => string;

export function useSay() {
  const t = useTranslations("assistant") as unknown as Words;
  const f = useFmt();
  const { locale } = useLocale();
  const stations = useTwin((s) => s.stations);
  const sep = locale === "ar" ? "، " : ", ";

  const name = useCallback((id: unknown) => {
    const s = stations.find((x) => x.id === id);
    return s ? f.station(s) : String(id ?? "");
  }, [stations, f]);

  /** A setting's value as the planner reads it on the controls. */
  const show = useCallback((field: string, raw: unknown): string => {
    const v = String(raw ?? "");
    if (v === "" || v === "-") return t("none");
    switch (field) {
      case "attendance": case "cost_cap": case "exit_sigma_min": return f.int(Number(v));
      case "threshold": case "metro_share": return `${f.int(Math.round(Number(v) * 100))}%`;
      case "weather": return t(`weather.${v}`);
      case "priority": return t(`prio.${v}`);
      case "forbid": return v.split(", ").map((m) => t(`measure.${m}`)).join(sep);
      case "protect": return v.split(", ").map(name).join(sep);
      default: return v;
    }
  }, [t, f, name, sep]);

  const values = useCallback((key: string, params: Record<string, unknown>): Vals => {
    const field = key.startsWith("chat.set.") ? key.slice(9) : String(params.field_s ?? "");
    const out: Vals = {};
    for (const [k, v] of Object.entries(params)) {
      if (k.endsWith("_st")) out[k] = name(v);
      else if (k.endsWith("_list")) out[k] = (Array.isArray(v) ? v : []).map(name).join(sep);
      else if (k.endsWith("_pct") || k.endsWith("_n")) out[k] = f.int(Number(v));
      else if (k.endsWith("_x")) out[k] = f.num(Number(v), 2);
      else if (k === "field_s") out[k] = t(`field.${v}`);
      else if (k === "lens_s" || k === "what_s") out[k] = t(`lens.${v}`);
      else if (k === "overall_s") out[k] = t(`level.${v}`);
      else if (k === "limiting_s") out[k] = String(v).split(",").filter(Boolean).map((p) => t(`part.${p}`)).join(sep);
      else if (k === "line_s") out[k] = t(`line.${v}`);
      else if (k === "from_s" || k === "to_s") out[k] = show(field, v);
      else out[k] = String(v ?? "");
    }
    return out;
  }, [t, f, name, sep, show]);

  const say = useCallback((b: Pick<ChatBlock, "key" | "params">): string => {
    try { return t(`a.${b.key}`, values(b.key, b.params ?? {})); } catch { return b.key; }
  }, [t, values]);

  return { say, t, name, show, sep };
}

/** A chip's label: "lens:safety" → chip.lens_safety. */
export const chipKey = (intent: string) => `chip.${intent.replace(":", "_")}`;
