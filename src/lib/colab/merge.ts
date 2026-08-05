// Merge 3-vias do rascunho colaborativo (spec 2026-08-03). PURO e sem dependências:
// base = o que a tela carregou/último merge · draft = o que estou vendo ·
// fresh = o que chegou do servidor · touched = campos que EU editei.
export type Conflito = { path: string; meu: unknown; dele: unknown };
export type MergeResult<T> = { valor: T; conflitos: Conflito[]; atualizados: string[] };

export function mergeDraft<T extends Record<string, any>>(o: {
  base: T; draft: T; fresh: T; touched: ReadonlySet<string>;
}): MergeResult<T> {
  // Itera `Object.keys(fresh)` — campos presentes só no draft não são avaliados.
  // Shape vem de SELECT * do Supabase (mesma forma em todos os 3).
  const valor: Record<string, any> = { ...o.draft };
  const conflitos: Conflito[] = [];
  const atualizados: string[] = [];
  for (const k of Object.keys(o.fresh)) {
    const mudouNoServidor = !igual(o.base[k], o.fresh[k]);
    if (!o.touched.has(k)) {
      if (mudouNoServidor) { valor[k] = o.fresh[k]; atualizados.push(k); }
    } else if (mudouNoServidor && !igual(o.draft[k], o.fresh[k])) {
      conflitos.push({ path: k, meu: o.draft[k], dele: o.fresh[k] }); // mantém o meu no valor
    }
  }
  return { valor: valor as T, conflitos, atualizados };
}

export type LinhaId = { id?: string | null };
export function mergeLinhas<R extends LinhaId>(o: {
  base: R[]; draft: R[]; fresh: R[]; touchedIds: ReadonlySet<string>;
}): { linhas: R[]; conflitos: Conflito[]; atualizadas: string[] } {
  const byId = (rs: R[]) => new Map(rs.filter((r) => r.id).map((r) => [r.id as string, r]));
  const bBase = byId(o.base), bFresh = byId(o.fresh);
  const conflitos: Conflito[] = [];
  const atualizadas: string[] = [];
  const out: R[] = [];
  const processados = new Set<string>();              // IDs já processados (inv. #3: ids são únicos)
  for (const d of o.draft) {
    if (!d.id) { out.push(d); continue; }               // minha linha nova (sem id) sempre fica
    if (processados.has(d.id)) continue;                // dup-id: pula, mantém o primeiro
    processados.add(d.id);
    const f = bFresh.get(d.id), b = bBase.get(d.id);
    const tocada = o.touchedIds.has(d.id);
    if (!f) {                                            // sumiu no servidor
      if (tocada) { conflitos.push({ path: `linha:${d.id}`, meu: d, dele: null }); out.push(d); }
      continue;                                          // não tocada → some
    }
    const mudouNoServidor = !igual(b, f);
    if (!tocada) { out.push(mudouNoServidor ? f : d); if (mudouNoServidor) atualizadas.push(d.id); }
    else if (mudouNoServidor && !igual(d, f)) { conflitos.push({ path: `linha:${d.id}`, meu: d, dele: f }); out.push(d); }
    else out.push(d);
  }
  for (const f of o.fresh) {                             // linhas novas do servidor
    if (f.id && !o.draft.some((d) => d.id === f.id)) { out.push(f); atualizadas.push(f.id); }
  }
  return { linhas: out, conflitos, atualizadas };
}

// Exportada p/ as telas compararem "valor ao vivo vs valor ENVIADO no save" com a MESMA
// semântica do merge (null≈undefined, deep p/ objetos/arrays) — ver onSuccess do save
// composto no Desenvolvimento (teclas digitadas durante o voo do save seguem touched).
export function igual(a: unknown, b: unknown): boolean {
  // null e undefined são EQUIVALENTES entre si (semântica anterior preservada)
  if (a == null || b == null) return a == null && b == null;
  if (a === b) return true; // inclui +0 === -0
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== "object" || typeof b !== "object") return false;
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) return false; // array vs objeto = DIFERENTE
  if (aArr) {
    const A = a as unknown[], B = b as unknown[];
    return A.length === B.length && A.every((v, i) => igual(v, B[i]));
  }
  // objetos: UNIÃO de chaves (chave ausente ≈ undefined ≈ null), ordem irrelevante
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) if (!igual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}
