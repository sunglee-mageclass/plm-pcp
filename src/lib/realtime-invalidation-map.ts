// SSOT do hook global `useRealtimeInvalidation` (atualização AO VIVO entre usuários —
// item 11 do dono, ago/2026). Mapeia cada TABELA de config/cadastro (low-churn) para o
// PREDICATE de queryKeys a invalidar quando um OUTRO usuário do mesmo tenant salva algo
// naquela tabela. Um usuário na tela de Desenvolvimento vê o kanban se atualizar na hora
// quando outro renomeia um status na Config da Loja, sem refresh.
//
// Escopo DELIBERADAMENTE restrito a config + taxonomias que alimentam dropdowns/regras
// (NÃO modelos/OCs/parcelas — esses são high-churn e já têm colab por REGISTRO via
// useColabRegistro/rev). Esta lista é a fonte única: alimenta as assinaturas do canal
// Realtime (useRealtimeInvalidation) E o teste anti-drift (que confere que cada tabela
// está na publication supabase_realtime e que nenhum token de queryKey aqui está morto).
//
// Como as keys foram derivadas: grep de `.from("<tabela>")` em src/ + a queryKey do
// useQuery que envolve cada leitura (ver tests/unit/realtime-invalidation-map.test.ts p/
// o anti-drift). NÃO inventar key — só mapear as existentes.

import type { QueryKey } from "@tanstack/react-query";

export const REALTIME_INVALIDATION_TABLES = [
  "tenant_config",
  "categorias_produto",
  "subcategorias1_produto",
  "subcategorias2_produto",
  "grupos_produto",
  "linhas",
  "meses",
  "cores",
  "cores_apelido",
  "categorias_terceirizado",
  "lojas_direcionamento",
] as const;

export type RealtimeTable = (typeof REALTIME_INVALIDATION_TABLES)[number];
type TaxonomyTable = Exclude<RealtimeTable, "tenant_config">;

const s0 = (k: QueryKey): string => (typeof k[0] === "string" ? k[0] : "");
const s1 = (k: QueryKey): string => (typeof k[1] === "string" ? k[1] : "");

// ---------------------------------------------------------------------------
// tenant_config — 1 linha por tenant lida por ~24 queryKeys HETEROGÊNEAS (grade de
// tamanhos, status do kanban, requisitos, módulos, fuso, nomenclaturas, modo OC/rolo…).
// Reusa o predicate JÁ battle-tested do save de Config da Loja (admin/configuracoes.tsx:
// k[0] contém "tenant" OU "tamanhos") e FECHA os 3 buracos reais que aquele predicate não
// pega (confeccao-prioridade / cq-confeccao-prioridade / plan-tecido-kanban-cols — keys
// que leem tenant_config mas não contêm "tenant"/"tamanhos").
export const TENANT_CONFIG_EXTRA_KEYS: readonly string[] = [
  "confeccao-prioridade",
  "cq-confeccao-prioridade",
  "plan-tecido-kanban-cols",
];

function matchTenantConfig(k: QueryKey): boolean {
  const a = s0(k);
  return a.includes("tenant") || a.includes("tamanhos") || TENANT_CONFIG_EXTRA_KEYS.includes(a);
}

// ---------------------------------------------------------------------------
// Taxonomias/cadastros — dropdowns e listas. Duas regras cobrem tudo:
//   (1) GENÉRICA: k[0]===tabela  OU  k[1]===tabela. Cobre as listas nomeadas pela própria
//       tabela (ex.: ["categorias_terceirizado"], ["categorias_terceirizado","colab"]) E
//       TODOS os loaders de opções genéricos, que passam a tabela como 2º elemento
//       independentemente do prefixo: ["opt",t,…], ["opt-panel",t], ["opt-pv",t],
//       ["opt-ocpa",t], ["opt-produto-acabado",t].
//   (2) BESPOKE: keys nomeadas de outra forma (abaixo). Cada string é verificada VIVA no
//       teste anti-drift (grep em src/) — se alguém renomear/remover a key, o teste quebra.
export const TAXONOMY_KEY_TOKENS: Record<TaxonomyTable, readonly string[]> = {
  categorias_produto: ["otb-categorias-all", "plan-tecido-categorias"],
  subcategorias1_produto: [],
  subcategorias2_produto: [],
  grupos_produto: ["otb-grupos"],
  linhas: ["linhas-markup", "padrao-linhas", "plan-tecido-linhas-markup"],
  meses: ["meses-options"],
  cores: ["cores-list", "cores-options", "cores-opts"],
  cores_apelido: ["cores-apelido-list", "cores-apelido-options", "plan-tecido-cores-combos"],
  categorias_terceirizado: [
    "cat-terceirizado-confeccao",
    "cat-terceirizado-options",
    "cats-servico-ativas",
    "cq-cats-servico",
    "leadtime-categorias-terceirizado",
    "leadtime-servico-cats",
  ],
  lojas_direcionamento: ["lojas-direcionamento", "dir-lojas"],
};

function matchTaxonomy(table: TaxonomyTable, k: QueryKey): boolean {
  if (s0(k) === table || s1(k) === table) return true;
  return TAXONOMY_KEY_TOKENS[table].includes(s0(k));
}

/** Predicate de invalidação de uma tabela: recebe uma queryKey e diz se ela lê essa tabela. */
export function matchesTable(table: RealtimeTable, key: QueryKey): boolean {
  return table === "tenant_config" ? matchTenantConfig(key) : matchTaxonomy(table, key);
}
