// Helpers PUROS da aba Leadtime do Dashboard (item 8 do Dashboard v2 — hero ponta-a-ponta +
// bullet graphs + heatmap de 6 fases). Sem React, sem I/O: só a matemática de fases/ideais/
// agregação, testável em isolamento. Ver docs/design/ui-padroes.md §R (bullet graph R7, número-
// hero R8, sequencial R2, status+ícone R3) e os shapes das RPCs dashboard_leadtime /
// dashboard_leadtime_itens (só-leitura; nenhuma migration).

export type FaseKey =
  | "planejamento"
  | "desenvolvimento"
  | "servicos"
  | "cq"
  | "direcionamento"
  | "lancamento";

export type Fase = { key: FaseKey; label: string; short: string };

// As 6 fases em ordem de FLUXO. O kanban INTEIRO (todas as colunas + status históricos, ex.
// "aprovado") colapsa em "Desenvolvimento"; os marcos de produção `cad_corte` (CAD→Corte) e
// `servicos`/`servico_cat:*` entram em "Serviços" (execução). Reconcilia o desenho da proposta
// (Planej · Desenv · Serviços · CQ · Direc · Lançam) com as chaves REAIS das RPCs.
export const FASES: readonly Fase[] = [
  { key: "planejamento", label: "Planejamento", short: "Planej." },
  { key: "desenvolvimento", label: "Desenvolvimento", short: "Desenv." },
  { key: "servicos", label: "Serviços", short: "Serviços" },
  { key: "cq", label: "CQ", short: "CQ" },
  { key: "direcionamento", label: "Direcionamento", short: "Direc." },
  { key: "lancamento", label: "Lançamento", short: "Lançam." },
] as const;

/** Fase de uma etapa-chave da RPC (colapsa o kanban em Desenvolvimento; cad_corte→Serviços). */
export function faseDeEtapa(etapa: string): FaseKey {
  if (etapa === "planejamento") return "planejamento";
  if (etapa.startsWith("kanban:")) return "desenvolvimento";
  if (etapa === "cq") return "cq";
  if (etapa === "direcionamento") return "direcionamento";
  if (etapa === "lancamento") return "lancamento";
  // servicos, servico_cat:*, cad_corte e qualquer outra etapa de produção → Serviços.
  return "servicos";
}

/** Ideal (dias) por etapa configurada (skeleton dashboard_leadtime). */
export function idealLookup(etapas: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of etapas ?? []) m.set(String(e.etapa), Number(e.idealDias) || 0);
  return m;
}

// Ideal de uma etapa: config da loja quando existe; senão default por tipo (kanban 5d, macro/
// serviço 7d) — mesma régua da RPC, para as chaves históricas fora do board configurado.
export function idealDeEtapa(etapa: string, lookup: Map<string, number>): number {
  const v = lookup.get(etapa);
  if (v != null && v > 0) return v;
  return etapa.startsWith("kanban:") ? 5 : 7;
}

export type FaseTotais = { valor: number; meta: number };
export type ItemTotais = {
  total: number;
  meta: number;
  porFase: Partial<Record<FaseKey, FaseTotais>>;
};

// Soma TODAS as durações do item (inclui status históricos fora do board — ex. "aprovado", com
// 74 modelos no tenant piloto; ignorá-los esconderia o gargalo real). `meta` = Σ do ideal das
// etapas que o item de fato percorreu (apples-to-apples com `total`); na etapa de SLA usa o SLA
// da Sub1 do item quando houver.
export function itemTotais(
  item: any,
  lookup: Map<string, number>,
  slaServico: string | null,
): ItemTotais {
  const dur = (item?.duracoes ?? {}) as Record<string, unknown>;
  const porFase: Partial<Record<FaseKey, FaseTotais>> = {};
  let total = 0;
  let meta = 0;
  for (const [k, vRaw] of Object.entries(dur)) {
    const v = Number(vRaw);
    if (!Number.isFinite(v)) continue;
    const ideal =
      k === slaServico && item?.sub1_sla != null ? Number(item.sub1_sla) : idealDeEtapa(k, lookup);
    const fk = faseDeEtapa(k);
    total += v;
    meta += ideal;
    const cur = porFase[fk] ?? { valor: 0, meta: 0 };
    cur.valor += v;
    cur.meta += ideal;
    porFase[fk] = cur;
  }
  return { total, meta, porFase };
}

export type HeroStats = {
  n: number;
  mediaTotal: number;
  mediaMeta: number;
  delta: number; // mediaTotal − mediaMeta (>0 = acima da meta = pior)
  dentroMeta: number; // nº de itens com total ≤ meta
  pctDentro: number; // %
};

// Hero ponta-a-ponta (R8): média do lead time total no filtro + a meta média acumulada, o desvio
// e a fração de itens dentro da meta.
export function heroStats(
  itens: any[],
  lookup: Map<string, number>,
  slaServico: string | null,
): HeroStats {
  const n = itens.length;
  if (!n) return { n: 0, mediaTotal: 0, mediaMeta: 0, delta: 0, dentroMeta: 0, pctDentro: 0 };
  let somaTotal = 0;
  let somaMeta = 0;
  let dentro = 0;
  for (const it of itens) {
    const { total, meta } = itemTotais(it, lookup, slaServico);
    somaTotal += total;
    somaMeta += meta;
    if (total <= meta) dentro++;
  }
  const mediaTotal = somaTotal / n;
  const mediaMeta = somaMeta / n;
  return {
    n,
    mediaTotal,
    mediaMeta,
    delta: mediaTotal - mediaMeta,
    dentroMeta: dentro,
    pctDentro: Math.round((100 * dentro) / n),
  };
}

// Índice da rampa sequencial (0..4 → --chart-seq-1..5) pela razão real/ideal. >1 = acima da meta
// (atrasado) e sobe de intensidade. A rampa é magnitude (não status): o atraso ganha ícone ▲ à
// parte (R3 — nunca só cor).
export function seqIndexRatio(ratio: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(ratio) || ratio <= 0.75) return 0;
  if (ratio <= 1.0) return 1;
  if (ratio <= 1.5) return 2;
  if (ratio <= 2.5) return 3;
  return 4;
}

// Cor do texto SOBRE a célula da rampa. A rampa navy inverte com o tema (claro→escuro no claro,
// escuro→claro no escuro), mas --foreground/--background são SEMPRE opostos ao fundo da página:
// os índices claros (perto do fundo) leem com --foreground; os intensos (longe do fundo) com
// --background. Vale nos dois temas — sem hex/oklch solto (anti-drift).
export function seqTextToken(idx: number): "var(--foreground)" | "var(--background)" {
  return idx >= 3 ? "var(--background)" : "var(--foreground)";
}

// Escala do eixo de um GRUPO de bullets: cobre a pior barra E a faixa "atrasado" (1,5× ideal) com
// folga, para a barra NUNCA saturar (R7). Todos os bullets do grupo compartilham a escala (barras
// comparáveis entre si).
export function bulletScaleMax(medias: number[], ideais: number[]): number {
  const maxMedia = medias.length ? Math.max(...medias) : 0;
  const maxIdeal = ideais.length ? Math.max(...ideais) : 0;
  return Math.max(maxMedia * 1.08, maxIdeal * 1.6, 1);
}

// ————— Grupos de coluna EXPANSÍVEIS do heatmap (Desenvolvimento / Serviços destrinchados) —————

// Meta de COLORAÇÃO de uma sub-coluna: SÓ o ideal configurado pela loja (nunca o default por tipo).
// Sub-etapa sem ideal na config ⇒ null → célula neutra (valor sem cor de razão; não inventa meta,
// R3/honestidade). Difere de `idealDeEtapa` (que sempre devolve um número via default) de propósito.
export function metaConfig(key: string, lookup: Map<string, number>): number | null {
  const v = lookup.get(key);
  return v != null && v > 0 ? v : null;
}

// Particiona a fase de um item nas SUB-colunas próprias (`subKeys`) + o resíduo do balde. `outros`
// captura as chaves da fase que NÃO viraram coluna própria. Quais chaves entram em `subKeys` é
// decisão do chamador (dashboard):
//  • Desenvolvimento — o board (status atuais) + os status EXTINTOS relevantes PROMOVIDOS
//    (ver `promoverExtintos`); o resíduo é o balde "Histórico" (status extintos leves, fora do
//    board — ex. "aprovado" quando não domina).
//  • Serviços — `cad_corte` (marco CAD→Corte, sempre coluna própria quando presente) + as
//    categorias ATIVAS; o resíduo "Outros" fica só com o macro "servicos" (antigo) + categorias
//    inativas/removidas.
// INVARIANTE: Σ(valores) + outros ≡ o `porFase[fase].valor` de itemTotais — a soma das sub-colunas
// fecha SEMPRE com a coluna agregada (nada some; o balde segura o resto, seja Histórico ou Outros).
export function splitFaseSub(
  item: any,
  fase: FaseKey,
  subKeys: readonly string[],
): { valores: Record<string, number>; outros: number; total: number } {
  const want = new Set(subKeys);
  const dur = (item?.duracoes ?? {}) as Record<string, unknown>;
  const valores: Record<string, number> = {};
  let outros = 0;
  let total = 0;
  for (const [k, vRaw] of Object.entries(dur)) {
    const v = Number(vRaw);
    if (!Number.isFinite(v)) continue;
    if (faseDeEtapa(k) !== fase) continue;
    total += v;
    if (want.has(k)) valores[k] = (valores[k] ?? 0) + v;
    else outros += v;
  }
  return { valores, outros, total };
}

// Fração MÍNIMA do tempo agregado da fase (Σ sobre os itens filtrados) para uma chave FORA de
// `boardKeys` deixar o balde e virar sub-coluna própria. 0.20 = 20% da fase. Critério REGISTRADO:
// um status extinto (fora do board atual) só vira "<Label> (antigo)" quando de fato pesa — evita
// poluir o heatmap com colunas de status raros; o resto continua somado no balde "Histórico".
export const PROMO_HISTORICO_FRAC = 0.2;

/** Chaves da fase FORA de `boardKeys` (ex.: status extintos do kanban) cujo tempo AGREGADO
 *  (Σ sobre os itens filtrados) é ≥ `frac`×(Σ da fase) — as "relevantes", que ganham coluna
 *  própria fora do balde. Retorna ordenado por peso desc (a mais pesada primeiro). Puro/testável.
 *  Fase sem tempo nenhum ⇒ []. Não confia em nada além de `duracoes`/`faseDeEtapa`. */
export function promoverExtintos(
  itens: any[],
  fase: FaseKey,
  boardKeys: readonly string[],
  frac: number = PROMO_HISTORICO_FRAC,
): string[] {
  const board = new Set(boardKeys);
  const agg = new Map<string, number>();
  let faseTotal = 0;
  for (const it of itens ?? []) {
    const dur = (it?.duracoes ?? {}) as Record<string, unknown>;
    for (const [k, vRaw] of Object.entries(dur)) {
      const v = Number(vRaw);
      if (!Number.isFinite(v)) continue;
      if (faseDeEtapa(k) !== fase) continue;
      faseTotal += v;
      if (!board.has(k)) agg.set(k, (agg.get(k) ?? 0) + v);
    }
  }
  if (faseTotal <= 0) return [];
  const limite = frac * faseTotal;
  return [...agg.entries()]
    .filter(([, s]) => s >= limite)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

/** Detalha o RESÍDUO do balde de uma fase (o que sobra fora de `subKeys`): cada chave com o Σ do
 *  seu tempo. Aceita 1 item (tooltip da célula) OU um array (tooltip do header = agregado do
 *  filtro). Ordena por valor desc; descarta zeros. Puro — o chamador resolve os rótulos (precisa
 *  do board/cadastro). Espelha a partição de `splitFaseSub` (mesma régua de fase/finitude). */
export function detalharOutros(
  itensOrItem: any | any[],
  fase: FaseKey,
  subKeys: readonly string[],
): { key: string; valor: number }[] {
  const want = new Set(subKeys);
  const arr = Array.isArray(itensOrItem) ? itensOrItem : [itensOrItem];
  const agg = new Map<string, number>();
  for (const it of arr) {
    const dur = (it?.duracoes ?? {}) as Record<string, unknown>;
    for (const [k, vRaw] of Object.entries(dur)) {
      const v = Number(vRaw);
      if (!Number.isFinite(v)) continue;
      if (faseDeEtapa(k) !== fase) continue;
      if (want.has(k)) continue;
      agg.set(k, (agg.get(k) ?? 0) + v);
    }
  }
  return [...agg.entries()]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, valor]) => ({ key, valor }));
}
