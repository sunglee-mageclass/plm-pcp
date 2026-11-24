// Catálogo PURO das colunas da grade "Lista tipo Excel" de Estilo & Engenharia > Planejamento de Produto (sem React, sem Supabase).
// ⚠️ É o ALICERCE DE SEGURANÇA da edição (PR-2): cada coluna declara QUEM edita, qual permissão de SEÇÃO ela exige, se a Integração
// pode travá-la por produto e se é só-leitura. A tabela `modelos` é central — quem decide "editável?" é SÓ `colunaEditavelNoProduto`
// (nunca a célula). Mesmo mapa do Sheet do Planejamento (`CAMPOS_*_DRAFT` em planejamento-detail/helpers.ts — anti-drift em
// `tests/unit/produto-grade-colunas.test.ts`).
//
// Diferenças dos outros catálogos de grade (tecido/aviamento/insumo): o produto é 1 LINHA POR MODELO (sem pai/filhos, sem escopo)
// e a edição depende de PERMISSÃO (página + seção), de TRAVA da Integração (por produto) e de ORIGEM (comprado = preço derivado).
//
// A chave da coluna = nome da coluna em `modelos` (é o que `colunasTravadas` devolve) — exceto as DERIVADAS/de exibição (`grupo`).

import { resolverPermissoesSheet } from "@/components/planejamento/planejamento-detail/permissoes-sheet";
import { colunasTravadas, type EstadoModeloIntegracao } from "@/lib/integracao/trava";
import { ehOrigemComprada } from "@/lib/origem";
import { CHAVE_EDITAR_PRECO_ATACADO, CHAVE_EDITAR_PRECO_VAREJO } from "@/lib/preco-permissao";

export type TipoColuna = "texto" | "money" | "select" | "readonly";

/** Seção de permissão (`criacao_planejamento:<seção>`) que a coluna exige para APARECER e para EDITAR. */
export type PermissaoColuna = "custos" | "preco_venda" | "preco_atacado";

/**
 * Quem edita o campo (espelha as 3 listas do Sheet — "nem ganha nem perde", P-53 A):
 *  - "planejamento": SÓ o Planejamento (`CAMPOS_SO_PLANEJAMENTO_DRAFT`) — exige `canEdit("criacao_planejamento")`;
 *  - "compartilhado": Planejamento OU Desenvolvimento (`CAMPOS_COMPARTILHADOS_DRAFT`) — o Dev só vale com o card AINDA não enviado à Explosão;
 *  - "dev": só o Desenvolvimento (`CAMPOS_DEV_DRAFT`) — exige `canEdit("criacao_desenvolvimento")` e o card não enviado à Explosão.
 */
export type DonoColuna = "planejamento" | "compartilhado" | "dev";

export type ColunaProduto = {
  /** Nome da coluna em `modelos` (é o que `colunasTravadas` e o payload do save usam) — ou chave derivada (`grupo`). */
  key: string;
  rotulo: string;
  tipo: TipoColuna;
  dono: DonoColuna;
  /** Seção de permissão: sem VER (ou EDITAR) a seção, a coluna some (ou fica só-leitura). */
  permissao?: PermissaoColuna;
  /** Nunca editável na grade (REF, status/kanban, derivadas, datas de ciclo…). */
  soLeitura?: boolean;
  /** A Integração pode travá-la POR PRODUTO (a coluna está entre as marcadas na config — `colunasTravadas`). */
  travavelIntegracao?: boolean;
  /** Travada SEMPRE que o produto está integrável/integrado (marcada ou não — `SEMPRE_TRAVADO`: "Tamanho em"). */
  sempreTravadaIntegracao?: boolean;
  /** Só editável direto em produto INTERNO: no comprado (revenda/importado) o valor é DERIVADO (gatilho B1b → 42501) — vai por RPC própria. */
  soInterno?: boolean;
  /** Sem o módulo OTB a coluna é texto livre (com OTB é dropdown da coleção/subcoleção). */
  textoSemOtb?: boolean;
  /** Casas decimais do MoneyInput (peso 3, medidas 2, preço 2). */
  casas?: number;
  /** Documental: o que a mudança dispara/exige no servidor (a PR-2 trata; nada aqui executa). */
  disparaRegra?: string;
};

const col = (
  key: string,
  rotulo: string,
  tipo: TipoColuna,
  dono: DonoColuna,
  extra: Partial<Omit<ColunaProduto, "key" | "rotulo" | "tipo" | "dono">> = {},
): ColunaProduto => ({ key, rotulo, tipo, dono, ...extra });

const REF_ESPELHO =
  "REF+espelho: dispara fn_modelo_ref_auto (sigla da REF) e trg_modelo_espelho_categoria (PA/PI); Acessórios com OC é recusado (P0001 categoria_acessorio_com_pedido)";

/**
 * Ordem lógica: identificação → texto → medidas → preço → planejamento (coleção/linha/data) → taxonomia → grade → observações.
 * `ref_auto` NÃO é coluna (a REF só aparece depois de revelada — invariante 11; a grade mostra só `ref`).
 */
export const COLUNAS_PRODUTO: readonly ColunaProduto[] = [
  // Identificação (só-leitura)
  col("ref", "REF", "readonly", "dev", {
    soLeitura: true,
    disparaRegra:
      "REF: trigger fn_modelo_ref_auto; editável só a partir da etapa configurada (Sheet/Códigos) — só-leitura na grade",
  }),
  col("versao", "Versão", "readonly", "planejamento", { soLeitura: true }),
  col("origem", "Origem", "readonly", "planejamento", { soLeitura: true }),
  col("status_planejamento", "Status", "readonly", "planejamento", {
    soLeitura: true,
    disparaRegra: "Status/etapa do kanban: muda no quadro (RPC do kanban), nunca na grade",
  }),
  // Texto
  col("nome", "Nome", "texto", "compartilhado", {
    travavelIntegracao: true,
    disparaRegra: "nome/REF sincronizam modelos ↔ produtos_* por gatilho",
  }),
  col("descricao_produto", "Descrição", "texto", "planejamento", { travavelIntegracao: true }),
  col("ncm", "NCM", "texto", "planejamento", {
    travavelIntegracao: true,
    disparaRegra: "NCM: só dígitos e pontos, até 10 caracteres (filtrarNcm)",
  }),
  col("titulo_pagina", "Título para a página", "texto", "planejamento", {
    travavelIntegracao: true,
    disparaRegra:
      "vazio = título AUTOMÁTICO (v1: nome | loja; v2+: herdado da versão anterior) — NULL, não string vazia",
  }),
  // Medidas
  col("peso_kg", "Peso (kg)", "money", "planejamento", { travavelIntegracao: true, casas: 3 }),
  col("comprimento_cm", "Comprimento (cm)", "money", "planejamento", {
    travavelIntegracao: true,
    casas: 2,
  }),
  col("largura_cm", "Largura (cm)", "money", "planejamento", {
    travavelIntegracao: true,
    casas: 2,
  }),
  col("altura_cm", "Altura (cm)", "money", "planejamento", { travavelIntegracao: true, casas: 2 }),
  // Preço (seção de permissão PRÓPRIA, independente de custos)
  col("preco_venda", "Preço de venda", "money", "planejamento", {
    permissao: "preco_venda",
    travavelIntegracao: true,
    soInterno: true,
    casas: 2,
    disparaRegra: "fn_modelo_preco_venda_gate (permissão de edição); comprado = derivado (B1b)",
  }),
  col("preco_anterior", "Preço anterior", "money", "planejamento", {
    permissao: "preco_venda",
    travavelIntegracao: true,
    casas: 2,
    disparaRegra:
      "vazio = preço anterior AUTOMÁTICO (versão anterior) — NULL; S5 exige a seção preco_venda",
  }),
  // Atacado: só existe como preço do COMPRADO (markup/preço fixo por RPC própria) — sem edição direta na grade.
  col("preco_atacado", "Preço de atacado", "money", "planejamento", {
    permissao: "preco_atacado",
    soLeitura: true,
    casas: 2,
    disparaRegra:
      "atacado = preço do comprado, derivado do markup/preço fixo (RPC própria); sem edição direta na grade v1",
  }),
  // Planejamento da coleção
  col("colecao", "Coleção", "select", "compartilhado", {
    textoSemOtb: true,
    disparaRegra: "com OTB grava colecao_id junto; sem OTB é texto livre (colecao)",
  }),
  col("subcolecao", "Subcoleção", "select", "compartilhado", { textoSemOtb: true }),
  col("semana", "Lançamento", "select", "compartilhado"),
  col("linha_id", "Linha", "select", "compartilhado"),
  col("mes_id", "Mês de Planejamento", "select", "compartilhado"),
  col("ano_id", "Ano", "select", "compartilhado"),
  col("estilista_id", "Estilista", "select", "compartilhado"),
  col("data_lancamento", "Data de lançamento", "readonly", "planejamento", {
    soLeitura: true,
    disparaRegra: "Lançar/cancelar tem regras próprias (CQ, M.O.) — só-leitura na grade v1",
  }),
  // Taxonomia (disparam REF + espelho — comportamento legítimo)
  col("grupo", "Grupo", "readonly", "compartilhado", {
    soLeitura: true,
    disparaRegra: "derivado da categoria (categorias_produto.grupo_id)",
  }),
  col("categoria_principal_id", "Categoria", "select", "compartilhado", {
    disparaRegra: REF_ESPELHO,
  }),
  col("subcategoria1_id", "Subcategoria", "select", "compartilhado", {
    disparaRegra: `${REF_ESPELHO}; cascateia pela categoria`,
  }),
  col("subcategoria2_id", "Subcategoria 2", "select", "compartilhado", {
    disparaRegra: `${REF_ESPELHO}; cascateia pela categoria`,
  }),
  // Grade de tamanhos: editável, MAS a Integração a trava SEMPRE (integrável/integrado)
  col("tamanho_tipo", "Tamanho em", "select", "planejamento", {
    travavelIntegracao: true,
    sempreTravadaIntegracao: true,
    disparaRegra: "Letra/Número; escondido em Acessórios (grade UN); aviso se já há SKUs gerados",
  }),
  // Observações
  col("observacoes_gerais", "Observações gerais", "texto", "dev"),
  // A Obs. de M.O. só aparece com custos no card de hoje (`obsMO && podeVerCustos`) — a seção `custos` governa ver E editar.
  col("observacoes_mao_obra", "Obs. mão de obra", "texto", "compartilhado", {
    permissao: "custos",
  }),
];

const POR_KEY: ReadonlyMap<string, ColunaProduto> = new Map(COLUNAS_PRODUTO.map((c) => [c.key, c]));

/** Coluna pela chave; `undefined` se não existir. */
export function byKey(key: string): ColunaProduto | undefined {
  return POR_KEY.get(key);
}

/** Posição da coluna na grade (0 = REF): é a "coluna" do endereço de teclado (`data-grade-cel="<linha>:<coluna>"`). -1 se não existe. */
export function indiceDaColuna(key: string): number {
  return COLUNAS_PRODUTO.findIndex((c) => c.key === key);
}

/** Chave de permissão completa de uma seção (`criacao_planejamento:<seção>`). Fonte única: preco-permissao.ts para os preços. */
export function chaveDePermissao(p: PermissaoColuna): string {
  switch (p) {
    case "preco_venda":
      return CHAVE_EDITAR_PRECO_VAREJO;
    case "preco_atacado":
      return CHAVE_EDITAR_PRECO_ATACADO;
    case "custos":
      return "criacao_planejamento:custos";
  }
}

type Checa = (chave: string) => boolean;

/**
 * Tudo o que `colunasVisiveis`/`colunaEditavelNoProduto` consultam em `canView`/`canEdit`: as 2 páginas + as seções de preço/custo.
 * (`canView`/`canEdit` do `useAuth` mudam de identidade a cada render; a tela memoiza pela `assinaturaPermissoes`, que só muda quando
 * o RESULTADO muda.)
 */
export const CHAVES_PERMISSAO_GRADE: readonly string[] = [
  "criacao_planejamento",
  "criacao_desenvolvimento",
  chaveDePermissao("preco_venda"),
  chaveDePermissao("preco_atacado"),
  chaveDePermissao("custos"),
];

/** Texto curto com o resultado de VER/EDITAR de cada chave da grade (igual = mesmas colunas visíveis/editáveis). */
export function assinaturaPermissoes(canView: Checa, canEdit: Checa): string {
  return CHAVES_PERMISSAO_GRADE.map(
    (k) => `${canView(k) ? "v" : "-"}${canEdit(k) ? "e" : "-"}`,
  ).join("");
}

/** A coluna aparece? Sem `permissao` = sempre; com ela, exige VER (ou EDITAR — o Editor inclui ver) da seção. */
export function colunaVisivel(
  c: ColunaProduto,
  canView: Checa,
  canEdit: Checa = () => false,
): boolean {
  if (!c.permissao) return true;
  const chave = chaveDePermissao(c.permissao);
  return canView(chave) || canEdit(chave);
}

/** Colunas que o usuário pode VER, na ordem do catálogo (esconde preço/custo sem a permissão da seção). */
export function colunasVisiveis(canView: Checa, canEdit: Checa = () => false): ColunaProduto[] {
  return COLUNAS_PRODUTO.filter((c) => colunaVisivel(c, canView, canEdit));
}

/** O que a edição precisa saber do PRODUTO (a linha) além da coluna. */
export type ProdutoEdicao = {
  origem?: string | null;
  /** `modelos.enviado_cad`: já enviado à Explosão → os campos do Desenvolvimento travam (devBloqueado do Sheet). */
  enviado_cad?: boolean | null;
};

/**
 * ÚNICA decisão de "esta célula edita?" — combina, nesta ordem (qualquer NÃO encerra):
 *  1. só-leitura (catálogo);
 *  2. PERMISSÃO: página (`criacao_planejamento`/`criacao_desenvolvimento`, via `resolverPermissoesSheet` = a MESMA regra do Sheet) e, se a
 *     coluna tem seção, EDITAR da seção (preço também exige editar o Planejamento — P-53 A);
 *  3. ORIGEM: `soInterno` e o produto é comprado → não;
 *  4. TRAVA da Integração por produto: `travavelIntegracao` e a coluna está em `colunasTravadas(estado)`; `sempreTravadaIntegracao` e o
 *     produto tem QUALQUER estado (integrável/integrado).
 * O banco continua sendo o guardião real (42501); isto só espelha para a tela não oferecer o que será recusado.
 * `estado` ausente (null/undefined) = produto sem trava conhecida (ou a consulta ainda não chegou — quem monta a tela decide esperar).
 */
export function colunaEditavelNoProduto(
  c: ColunaProduto,
  produto: ProdutoEdicao,
  canEdit: Checa,
  estado: EstadoModeloIntegracao | null | undefined,
  opcoes: { integracaoPronta?: boolean } = {},
): boolean {
  if (c.soLeitura || c.tipo === "readonly") return false;
  // O estado da Integração AINDA não chegou (`useIntegracaoEstados` devolve {} enquanto carrega): coluna que a Integração pode travar
  // fica BLOQUEADA, nunca livre — senão há uma janela de célula editável em produto travado (concern #1 da PR-1). Default = pronta.
  if (opcoes.integracaoPronta === false && colunaTravavel(c)) return false;

  const podeEditarPlanejamento = canEdit("criacao_planejamento");
  const podeEditarDev = canEdit("criacao_desenvolvimento");
  const devBloqueado = !podeEditarDev || !!produto.enviado_cad;
  const perm = resolverPermissoesSheet({ podeEditarPlanejamento, podeEditarDev, devBloqueado });
  if (c.dono === "planejamento" && perm.planBloqueado) return false;
  if (c.dono === "compartilhado" && perm.compartilhadoBloqueado) return false;
  if (c.dono === "dev" && (!podeEditarDev || devBloqueado)) return false;

  if (c.permissao) {
    if (!canEdit(chaveDePermissao(c.permissao))) return false;
    // P-53 A: a seção de preço sozinha não basta — o Salvar do Planejamento é quem grava (sem editar o Planejamento o valor se perde).
    if (c.permissao !== "custos" && !podeEditarPlanejamento) return false;
  }

  if (c.soInterno && ehOrigemComprada(produto.origem)) return false;

  if (estado) {
    if (c.sempreTravadaIntegracao) return false;
    if (c.travavelIntegracao && colunasTravadas(estado).has(c.key)) return false;
  }
  return true;
}

/** A Integração pode travar esta coluna em algum produto (marcada na config, ou `SEMPRE_TRAVADO`)? */
export function colunaTravavel(c: ColunaProduto): boolean {
  return !!c.travavelIntegracao || !!c.sempreTravadaIntegracao;
}

/**
 * Colunas na ORDEM DA TELA: o Nome vai PRIMEIRO (é a coluna fixa — sticky — da grade; REF/Versão/Origem/Status são só-leitura e
 * ficam logo depois). A chave de teclado (`data-grade-cel="<linha>:<coluna>"`) é a posição nesta lista.
 */
export function colunasNaOrdemDaTela(cols: readonly ColunaProduto[]): ColunaProduto[] {
  const nome = cols.find((c) => c.key === "nome");
  return nome ? [nome, ...cols.filter((c) => c !== nome)] : [...cols];
}

/** A coluna está travada pela Integração NESTE produto? (mesma regra do passo 4 de `colunaEditavelNoProduto`; serve ao selo/dica da célula.) */
export function colunaTravadaPelaIntegracao(
  c: ColunaProduto,
  estado: EstadoModeloIntegracao | null | undefined,
): boolean {
  if (!estado) return false;
  if (c.sempreTravadaIntegracao) return true;
  return !!c.travavelIntegracao && colunasTravadas(estado).has(c.key);
}
