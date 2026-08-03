// Merge 3-vias do rascunho colaborativo (spec 2026-08-03). PURO e sem dependências:
// base = o que a tela carregou/último merge · draft = o que estou vendo ·
// fresh = o que chegou do servidor · touched = campos que EU editei.
export type Conflito = { path: string; meu: unknown; dele: unknown };
export type MergeResult<T> = { valor: T; conflitos: Conflito[]; atualizados: string[] };

export function mergeDraft<T extends Record<string, any>>(o: {
  base: T; draft: T; fresh: T; touched: ReadonlySet<string>;
}): MergeResult<T> {
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
  for (const d of o.draft) {
    if (!d.id) { out.push(d); continue; }               // minha linha nova (sem id) sempre fica
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

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
