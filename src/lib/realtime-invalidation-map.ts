// SSOT do hook global `useRealtimeInvalidation` (atualização AO VIVO entre usuários —
// item 11 do dono, ago/2026; ESTENDIDO set/2026 p/ "realtime leve" nas LISTAS). Mapeia
// cada TABELA para o PREDICATE de queryKeys a invalidar quando um OUTRO usuário do mesmo
// tenant salva algo naquela tabela. Um usuário na tela de Desenvolvimento vê o kanban se
// atualizar na hora quando outro renomeia um status na Config da Loja OU move um card, sem refresh.
//
// DUAS classes de tabela:
//  • CONFIG/TAXONOMIA (low-churn) — config da loja + dropdowns/regras. Escopo original (ago/2026).
//  • NEGÓCIO/LISTA (high-churn — modelos, ocs_tecido, colecoes, producao_terceirizados,
//    controle_qualidade) — Fase 1 do roadmap de realtime universal (set/2026). O objetivo é só as
//    LISTAS/canvas/kanban se atualizarem ao vivo; os SHEETS de detalhe dessas telas já têm colab
//    por-registro (useColabRegistro/rev), então aqui mapeamos SÓ as queryKeys de LISTA (não as de
//    detalhe `["...", id]`, que o colab cobre e que um refetch global atrapalharia). O debounce de
//    250ms do hook coalesce rajadas (salvar 1 modelo bumpa `modelos` + várias filhas via trigger).
//
// Esta lista é a fonte única: alimenta as assinaturas do canal Realtime (useRealtimeInvalidation)
// E o teste anti-drift (confere que cada tabela está na publication supabase_realtime e que nenhum
// token de queryKey aqui está morto).
//
// Como as keys foram derivadas: grep de `.from("<tabela>")` em src/ + a queryKey do useQuery que
// envolve cada leitura (ver tests/unit/realtime-invalidation-map.test.ts). NÃO inventar key.

import type { QueryKey } from "@tanstack/react-query";

export const REALTIME_INVALIDATION_TABLES = [
  // config/taxonomia (low-churn)
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
  // negócio/lista (high-churn) — realtime leve nas listas/canvas/kanban (Fase 1)
  "modelos",
  "ocs_tecido",
  "colecoes",
  "producao_terceirizados",
  "controle_qualidade",
  // Fase 2 — OCs de compra (aviamento/insumo/p.acabado/p.importado) + produtos revenda/importado
  "ocs_aviamento",
  "ocs_etiqueta",
  "ocs_p_acabado",
  "ocs_importado",
  "produtos_acabados",
  "produtos_importados",
  // Fase 2 — Financeiro
  "parcelas",
  "parcelas_servico",
  // Fase 2 (fechamento) — OSs + Cadastros (listas)
  "ordens_saida_tecido",
  "ordens_saida_aviamento",
  "artigos",
  "aviamentos",
  "empresas",
  "representantes",
  "colaboradores",
  "destinos_saida",
  "etiquetas",
  // Fase 2 (fechamento) — taxonomias de Atributos ainda não publicadas (regra genérica de taxonomia)
  "anos",
  "categorias_fornecedor",
  "categorias_tecido",
  "categorias_aviamento",
  "subcategorias_aviamento",
  "materiais_aviamento",
  "intervalos_largura",
  "tipos_insumo",
] as const;

export type RealtimeTable = (typeof REALTIME_INVALIDATION_TABLES)[number];
// Tabelas de negócio: predicate por LISTA de tokens exatos (só queryKeys de lista).
export const BUSINESS_TABLES = [
  "modelos",
  "ocs_tecido",
  "colecoes",
  "producao_terceirizados",
  "controle_qualidade",
  "ocs_aviamento",
  "ocs_etiqueta",
  "ocs_p_acabado",
  "ocs_importado",
  "produtos_acabados",
  "produtos_importados",
  "parcelas",
  "parcelas_servico",
  "ordens_saida_tecido",
  "ordens_saida_aviamento",
  "artigos",
  "aviamentos",
  "empresas",
  "representantes",
  "destinos_saida",
  "etiquetas",
] as const;
export type BusinessTable = (typeof BUSINESS_TABLES)[number];
type TaxonomyTable = Exclude<RealtimeTable, "tenant_config" | BusinessTable>;

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
  // Fase 2 — taxonomias de Atributos: a lista é sempre `["attr", <tabela>, ""]`, casada pela regra
  // GENÉRICA (s1(k)===tabela). Sem token bespoke (a página de Atributos usa o AttributeTab genérico).
  anos: [],
  categorias_fornecedor: [],
  categorias_tecido: [],
  categorias_aviamento: [],
  subcategorias_aviamento: [],
  materiais_aviamento: [],
  intervalos_largura: [],
  tipos_insumo: [],
  // Colaboradores usa o AttributeTab genérico: lista `["attr","colaboradores",<papel>]` — casa por
  // s1(k)===tabela (regra genérica). Sem token bespoke.
  colaboradores: [],
};

function matchTaxonomy(table: TaxonomyTable, k: QueryKey): boolean {
  if (s0(k) === table || s1(k) === table) return true;
  return TAXONOMY_KEY_TOKENS[table].includes(s0(k));
}

// ---------------------------------------------------------------------------
// Tabelas de NEGÓCIO (high-churn) — SÓ as queryKeys de LISTA/canvas/kanban (não as de detalhe
// `["x", id]`, cobertas pelo colab por-registro). Match por `k[0] ∈ tokens` (prefixo exato).
// Cada token é conferido VIVO no anti-drift (grep em src/). Uma lista que lê 2+ tabelas (ex.:
// a lista de Serviços lê `producao_terceirizados` + `modelos`) é mapeada nas 2 — invalida em
// qualquer uma das duas mudar, o que é o correto.
export const BUSINESS_KEY_TOKENS: Record<BusinessTable, readonly string[]> = {
  modelos: [
    // Planejamento (canvas) + Desenvolvimento (kanban) e derivados de custo/MO/grade
    "modelos-planejamento", "modelos-desenvolvimento",
    "plan-custo-unit", "mo-resumo-list", "desenv-mo-resumo", "modelo-mo-resumo",
    "plan-grade-total", "plan-grade-real", "plan-cq-pronto",
    // listas de PCP/Expedição que pivotam por modelo
    "producao-terc-list", "producao-cq-list", "dir-list", "producao-terc-mo-resumo",
    // Lançamentos (cards de modelos prontos/lançados + custo)
    "lancamentos-cards", "lanc-custo-unit", "lanc-custo-real-total",
    // Explosão (lista de modelos a enviar ao corte)
    "producao-explosao-list",
    // OTB (poder de venda / links de modelo)
    "otb-modelos-link", "otb-custo-lista", "otb-grade-lista", "otb-pv-poder",
  ],
  ocs_tecido: ["ocs_tecido", "ocs_tecido_artigos", "ocs_tecido_qtd_recebida", "rolos", "estoque-tecidos"],
  colecoes: ["plan-tecido-colecoes", "plan-tecido-previa", "otb-colecoes"],
  producao_terceirizados: ["producao-terc-list", "producao-terc-mo-resumo"],
  // Lançamentos também depende do CQ (prontos-para-lançar) → invalida seus cards quando o CQ muda.
  controle_qualidade: ["producao-cq-list", "lancamentos-cards"],
  // Fase 2 — OCs de compra (só keys de LISTA; detalhe = ["oc-*", id] fica de fora)
  ocs_aviamento: ["oc-avi", "ocs-avi-totals", "ocs_aviamento", "estoque-aviamentos", "dash-estoque"],
  ocs_etiqueta: ["etiquetas-oc-insumo", "ocs-insumo-totals", "ocs_etiqueta"],
  ocs_p_acabado: ["ocs_p_acabado", "estoque_p_acabado"],
  ocs_importado: ["ocs_importado", "estoque_p_importado"],
  produtos_acabados: ["produtos-acabados", "produtos-acabados-estoque", "produto-acabado-variantes-estoque"],
  produtos_importados: ["produtos-importados", "produtos-importados-estoque", "produto-importado-variantes-estoque"],
  // Fase 2 — Financeiro (a pagar/receber + serviços). `parcelas` alimenta a lista de contas e
  // as pendências de recebimento; `servicos-financeiro` (com sub-escopo calendario/lista) vem das 2.
  parcelas: ["parcelas", "financeiro-pendencias-receb"],
  parcelas_servico: ["servicos-financeiro"],
  // Fase 2 (fechamento) — OSs + Cadastros. Só keys de LISTA (detalhe é estado local / token diferente).
  ordens_saida_tecido: ["os-tecido"],
  ordens_saida_aviamento: ["os-aviamento"],
  artigos: ["artigos", "variantes-thumb"],
  aviamentos: ["aviamentos", "aviamentos-variantes"],
  empresas: ["empresas-multi"],
  representantes: ["representantes"],
  destinos_saida: ["destinos-saida"],
  etiquetas: ["etiquetas-cadastro"],
};

// Tokens AMBÍGUOS: o mesmo `k[0]` nomeia a LISTA (`["token", [ids]]`, k[1] = array de ids) E o
// DETALHE do sheet aberto (`["token", modeloId]`, k[1] = string). Refetchar o detalhe por um evento
// global atrapalharia o merge do colab (flicker no badge de MO/custo enquanto se edita). Para esses,
// só casa quando k[1] NÃO é uma string de id. Os demais tokens são inequívocos (a string no k[1] de
// `["ocs_tecido","tab-counts"]` é um SUB-escopo de lista, não um id — esses casam sempre).
const BUSINESS_AMBIGUOUS = new Set([
  "plan-custo-unit", "modelo-mo-resumo",
  // OC Aviamento: `["oc-avi"]` (prefixo, invalida a lista) vs `["oc-avi", ocId]` (detalhe do sheet).
  "oc-avi",
]);

function matchBusiness(table: BusinessTable, k: QueryKey): boolean {
  if (!BUSINESS_KEY_TOKENS[table].includes(s0(k))) return false;
  if (BUSINESS_AMBIGUOUS.has(s0(k)) && typeof k[1] === "string") return false; // é key de DETALHE
  return true;
}

const BUSINESS_SET = new Set<string>(BUSINESS_TABLES);

/** Predicate de invalidação de uma tabela: recebe uma queryKey e diz se ela lê essa tabela. */
export function matchesTable(table: RealtimeTable, key: QueryKey): boolean {
  if (table === "tenant_config") return matchTenantConfig(key);
  if (BUSINESS_SET.has(table)) return matchBusiness(table as BusinessTable, key);
  return matchTaxonomy(table as TaxonomyTable, key);
}
