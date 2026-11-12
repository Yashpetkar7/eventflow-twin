"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type Evidence } from "./api";

/** /evidence (eval metrics with result files, data provenance, decision count). Refetch with reload(). */
export function useEvidence(deps: unknown[] = []) {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    api.evidence().then((e) => alive && setEvidence(e)).catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-controlled refresh keys
  }, [nonce, ...deps]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { evidence, error, reload };
}
