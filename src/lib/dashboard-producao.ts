// KPI "No status Aprovado" da aba Desenvolvimento do Dashboard (achados MÉDIOS R12, prod #6).
//
// Fonte: a chave `aprovadoNaoLancado` da RPC `dashboard_producao` (migration 20261022100000) = modelos na
// coluna "Aprovado" do quadro que AINDA NÃO foram lançados (`modelos.lancado`, fonte única — inv. #6). A
// coluna `kanbanDev` (o gráfico) conta todos os modelos da coluna, inclusive os já lançados (ex.: Blusa
// Master da Loja Teste), por isso NÃO serve para o rótulo "aprovados, não lançados".
//
// Fallback: se a chave faltar (banco ainda sem a migration, ou depois da volta dela), cai na contagem antiga
// pela coluna — mesmo critério de coluna do SQL: key exata "aprovado"; senão a 1ª cujo label contém "aprovad".
type ColunaKanban = { key?: unknown; label?: unknown; modelos?: unknown };

export function colunaAprovado(
  kanbanDev: ColunaKanban[] | null | undefined,
): ColunaKanban | undefined {
  const cols = Array.isArray(kanbanDev) ? kanbanDev : [];
  return (
    cols.find((k) => k?.key === "aprovado") ??
    cols.find((k) => /aprovad/i.test(String(k?.label ?? "")))
  );
}

export function aprovadosNaoLancados(
  prod: { aprovadoNaoLancado?: unknown; kanbanDev?: ColunaKanban[] | null } | null | undefined,
): number {
  const v = prod?.aprovadoNaoLancado;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const col = colunaAprovado(prod?.kanbanDev);
  return col ? Number(col.modelos ?? 0) || 0 : 0;
}
