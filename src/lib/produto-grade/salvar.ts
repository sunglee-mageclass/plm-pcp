// Rascunho + SALVAR da grade "Lista tipo Excel" do Planejamento de Produto (PURO: sem React; o cliente do banco entra por parâmetro).
// ⚠️ `modelos` é a tabela central (Realtime, `rev`, permissões, trava da Integração, muitos gatilhos). Regras que valem aqui:
//  - 1 UPDATE por modelo TOCADO, só com os campos EDITADOS, com o CAS por `rev` (`.eq("id").eq("rev", revBase).select("id, rev")`):
//    0 linhas = alguém salvou no meio (P0409) — a tela recarrega AQUELA linha e avisa; o resto do Salvar segue (resultado parcial);
//  - a decisão "esta coluna pode ir?" é SÓ `colunaEditavelNoProduto` (a mesma da célula): coluna travada pela Integração (ou que ainda
//    nem sabemos se está) NUNCA vai no payload — omitir evita o 42501 que derrubaria o UPDATE do card inteiro;
//  - vazio de Título/Preço anterior = NULL (automático/herdado da versão anterior), nunca "" nem 0; mesmas normalizações do Sheet
//    (`camposNovosParaPayload`/`precoAnteriorOuNull`/NCM filtrado/medidas arredondadas);
//  - Categoria/Subcategorias vão no MESMO UPDATE: o gatilho gera a REF e o espelho PA/PI; Acessórios↔outro grupo com pedido (OC) é
//    recusado (P0001 `categoria_acessorio_com_pedido`) — pré-checagem só-leitura com a regra do Sheet, texto em PT.
import {
  filtrarNcm,
  numeroOuNull,
  precoAnteriorOuNull,
  textoOuNull,
} from "@/components/planejamento/planejamento-detail/helpers";
import {
  RecusaEsperadaError,
  conferirCategoriaAcessorioPedido,
  precisaConferirCategoria,
  textoBloqueioCategoriaCard,
  type ClienteLeitura,
} from "@/lib/categoria-card-produto";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { EstadoModeloIntegracao } from "@/lib/integracao/trava";
import {
  byKey,
  colunaEditavelNoProduto,
  colunaTravadaPelaIntegracao,
  colunaTravavel,
} from "./colunas";
import type { ModeloGradeEntrada } from "./linhas";

/** O que a linha deixa EDITAR (é o rascunho do modelo). As chaves seguem as colunas de `modelos`; `colecao_id` anda junto de `colecao`. */
export type ProdutoDraft = {
  /** `null` = a pessoa apagou o texto (o Salvar recusa: nome é obrigatório). */
  nome: string | null;
  descricao_produto: string | null;
  ncm: string | null;
  titulo_pagina: string | null;
  peso_kg: number | null;
  comprimento_cm: number | null;
  largura_cm: number | null;
  altura_cm: number | null;
  preco_venda: number | null;
  preco_anterior: number | null;
  colecao: string | null;
  colecao_id: string | null;
  subcolecao: string | null;
  semana: string | null;
  linha_id: string | null;
  mes_id: string | null;
  ano_id: string | null;
  estilista_id: string | null;
  categoria_principal_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  tamanho_tipo: string | null;
  observacoes_gerais: string | null;
  observacoes_mao_obra: string | null;
};

/** Ordem de gravação no payload (estável) = a ordem do rascunho. */
export const CHAVES_DRAFT_PRODUTO = [
  "nome",
  "descricao_produto",
  "ncm",
  "titulo_pagina",
  "peso_kg",
  "comprimento_cm",
  "largura_cm",
  "altura_cm",
  "preco_venda",
  "preco_anterior",
  "colecao",
  "colecao_id",
  "subcolecao",
  "semana",
  "linha_id",
  "mes_id",
  "ano_id",
  "estilista_id",
  "categoria_principal_id",
  "subcategoria1_id",
  "subcategoria2_id",
  "tamanho_tipo",
  "observacoes_gerais",
  "observacoes_mao_obra",
] as const satisfies readonly (keyof ProdutoDraft)[];

/** Chave do rascunho → coluna do catálogo (`colecao_id` é parte da coluna "Coleção"). */
export function colunaDaChave(k: keyof ProdutoDraft): string {
  return k === "colecao_id" ? "colecao" : k;
}

/** O modelo (servidor) → rascunho-base. Vazio/ausente = `null` (nome: ""), para o "sujo" comparar com o que a célula emite. */
export function produtoParaDraft(m: ModeloGradeEntrada): ProdutoDraft {
  return {
    nome: m.nome ?? "",
    descricao_produto: m.descricao_produto ?? null,
    ncm: m.ncm ?? null,
    titulo_pagina: m.titulo_pagina ?? null,
    peso_kg: m.peso_kg ?? null,
    comprimento_cm: m.comprimento_cm ?? null,
    largura_cm: m.largura_cm ?? null,
    altura_cm: m.altura_cm ?? null,
    preco_venda: m.preco_venda ?? null,
    preco_anterior: m.preco_anterior ?? null,
    colecao: m.colecao ?? null,
    colecao_id: m.colecao_id ?? null,
    subcolecao: m.subcolecao ?? null,
    semana: m.semana ?? null,
    linha_id: m.linha_id ?? null,
    mes_id: m.mes_id ?? null,
    ano_id: m.ano_id ?? null,
    estilista_id: m.estilista_id ?? null,
    categoria_principal_id: m.categoria_principal_id ?? null,
    subcategoria1_id: m.subcategoria1_id ?? null,
    subcategoria2_id: m.subcategoria2_id ?? null,
    tamanho_tipo: m.tamanho_tipo ?? null,
    observacoes_gerais: m.observacoes_gerais ?? null,
    observacoes_mao_obra: m.observacoes_mao_obra ?? null,
  };
}

const idOuNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const textoApararOuNull = (v: unknown): string | null =>
  textoOuNull(typeof v === "string" ? v.trim() : null);
const precoOuNull = (v: unknown): number | null => {
  const n = numeroOuNull(v, 2);
  return n !== null && n > 0 ? n : null;
};

/** O valor do rascunho → o que vai na coluna. MESMAS regras do Sheet (`camposNovosParaPayload`, `precoAnteriorOuNull`, preço > 0…). */
export function valorParaPayload(k: keyof ProdutoDraft, v: unknown): unknown {
  switch (k) {
    case "nome":
      return typeof v === "string" ? v.trim() : "";
    case "descricao_produto":
    case "observacoes_gerais":
    case "observacoes_mao_obra":
      return textoOuNull(typeof v === "string" ? v : null);
    case "ncm":
      return textoOuNull(filtrarNcm(typeof v === "string" ? v : null));
    case "titulo_pagina":
    case "colecao":
    case "subcolecao":
      // vazio de Título = NULL = AUTOMÁTICO (v1: nome | loja; v2+: herdado da versão anterior) — nunca "".
      return textoApararOuNull(v);
    case "peso_kg":
      return numeroOuNull(v, 3);
    case "comprimento_cm":
    case "largura_cm":
    case "altura_cm":
      return numeroOuNull(v, 2);
    case "preco_venda":
      return precoOuNull(v);
    case "preco_anterior":
      // vazio/0 = NULL = AUTOMÁTICO (versão anterior) — nunca "preço zero".
      return precoAnteriorOuNull(v);
    case "tamanho_tipo":
      return v === "numero" || v === "letra" ? v : null;
    default:
      return idOuNull(v); // colecao_id, semana, linha_id, mes_id, ano_id, estilista_id, categoria/subcategorias
  }
}

export type OmissaoProduto = {
  key: string;
  rotulo: string;
  /** "travada" = a Integração trava (ou ainda não sabemos): AVISA a pessoa; "nao_edita" = permissão/origem/Acessórios: já estava desabilitada. */
  motivo: "travada" | "nao_edita";
};

type Checa = (chave: string) => boolean;
export type EntradaPayload = {
  modelo: Pick<ModeloGradeEntrada, "origem" | "enviado_cad">;
  canEdit: Checa;
  estado: EstadoModeloIntegracao | null | undefined;
  integracaoPronta: boolean;
  /** O grupo da categoria EFETIVA (a do rascunho) é Acessórios: grade única UN — "Tamanho em" não se aplica. */
  acessorio: boolean;
};

/**
 * Só os campos EDITADOS, só os que a célula deixaria editar (mesma decisão: `colunaEditavelNoProduto`), normalizados como o Sheet.
 * O que a Integração trava (ou que ainda não sabemos) SAI do payload e é relatado em `omitidas`. Nome vazio é recusado (NOT NULL).
 */
export function montarPayloadProduto(
  mudancas: Partial<ProdutoDraft>,
  o: EntradaPayload,
): { payload: Record<string, unknown>; omitidas: OmissaoProduto[] } {
  const payload: Record<string, unknown> = {};
  const omitidas: OmissaoProduto[] = [];
  for (const k of CHAVES_DRAFT_PRODUTO) {
    if (!(k in mudancas)) continue;
    const col = byKey(colunaDaChave(k));
    if (!col) continue;
    if (k === "tamanho_tipo" && o.acessorio) {
      omitidas.push({ key: k, rotulo: col.rotulo, motivo: "nao_edita" });
      continue;
    }
    const pode = colunaEditavelNoProduto(col, o.modelo, o.canEdit, o.estado, {
      integracaoPronta: o.integracaoPronta,
    });
    if (!pode) {
      const travada =
        colunaTravadaPelaIntegracao(col, o.estado) || (!o.integracaoPronta && colunaTravavel(col));
      omitidas.push({ key: k, rotulo: col.rotulo, motivo: travada ? "travada" : "nao_edita" });
      continue;
    }
    payload[k] = valorParaPayload(k, mudancas[k]);
  }
  if ("nome" in payload && payload.nome === "") {
    throw new RecusaEsperadaError("O nome do produto não pode ficar vazio.");
  }
  return { payload, omitidas };
}

/** Alguém salvou este produto depois que a pessoa começou a editar (0 linhas no UPDATE com `.eq("rev")`) — P0409. */
export class ConflitoProdutoError extends Error {
  readonly code = "P0409";
  readonly conflitoRev = true;
  constructor(mensagem = TEXTO_CONFLITO_PRODUTO) {
    super(mensagem);
    this.name = "ConflitoProdutoError";
  }
}
export const TEXTO_CONFLITO_PRODUTO =
  "Outra pessoa salvou este produto agora há pouco. A linha foi atualizada — confira as suas alterações e salve de novo.";
export const TEXTO_PRODUTO_SUMIU =
  "Este produto não existe mais (foi excluído por outra pessoa). Recarregue a lista.";

/** O erro é um conflito de `rev` (do UPDATE sem linha OU o P0409 de um gatilho)? */
export function ehConflitoRev(e: unknown): boolean {
  if (e instanceof ConflitoProdutoError) return true;
  const code = (e as { code?: unknown } | null | undefined)?.code;
  return String(code ?? "") === "P0409";
}

/** Texto PT do erro de UMA linha (conflito/recusas/42501/P0001 traduzidos). */
export function textoErroSalvar(e: unknown): string {
  if (e instanceof ConflitoProdutoError) return e.message;
  return mensagemErro(e, "Erro ao salvar.");
}

/** O pedaço do cliente do banco que o Salvar usa (o `supabase` do app, ou um fake nos testes). */
export type ClienteModelos = {
  from: (tabela: string) => {
    update: (p: Record<string, unknown>) => {
      eq: (
        c: string,
        v: unknown,
      ) => {
        eq: (
          c: string,
          v: unknown,
        ) => {
          select: (
            cols: string,
          ) => PromiseLike<{ data: { id: string; rev: number }[] | null; error: unknown }>;
        };
      };
    };
  };
};

export type ResultadoSalvarProduto = {
  /** `rev` novo devolvido pelo UPDATE (re-baseliza o CAS). `null` = nada foi enviado. */
  rev: number | null;
  enviou: boolean;
  omitidas: OmissaoProduto[];
};

/**
 * Salva UM produto: monta o payload, pré-checa Acessórios+OC (só-leitura), e faz o UPDATE com CAS por `rev`.
 * `revBase` = o `rev` de quando a pessoa começou a editar. 0 linhas = `ConflitoProdutoError` (a tela recarrega a linha).
 */
export async function salvarProduto(o: {
  client: ClienteModelos;
  modelo: Pick<ModeloGradeEntrada, "id" | "origem" | "enviado_cad" | "categoria_principal_id">;
  revBase: number | null | undefined;
  mudancas: Partial<ProdutoDraft>;
  canEdit: Checa;
  estado: EstadoModeloIntegracao | null | undefined;
  integracaoPronta: boolean;
  acessorio: boolean;
  /** Pré-checagem de Acessórios+OC (injetável nos testes). Padrão = a regra do Sheet, lendo pelo mesmo cliente. */
  conferirCategoria?: typeof conferirCategoriaAcessorioPedido;
}): Promise<ResultadoSalvarProduto> {
  const { payload, omitidas } = montarPayloadProduto(o.mudancas, {
    modelo: o.modelo,
    canEdit: o.canEdit,
    estado: o.estado,
    integracaoPronta: o.integracaoPronta,
    acessorio: o.acessorio,
  });
  if (Object.keys(payload).length === 0) return { rev: null, enviou: false, omitidas };
  // Sem rev de base não há o que conferir: o UPDATE `.eq("rev", null)` nunca casaria — vira o mesmo conflito (a tela relê e recomeça).
  if (o.revBase == null) throw new ConflitoProdutoError();

  if (
    precisaConferirCategoria({
      isEdit: true,
      origem: o.modelo.origem,
      categoriaPayload: payload.categoria_principal_id as string | null | undefined,
      categoriaServidor: o.modelo.categoria_principal_id,
    })
  ) {
    const conferir = o.conferirCategoria ?? conferirCategoriaAcessorioPedido;
    const bloqueados = await conferir(o.client as unknown as ClienteLeitura, {
      modeloIds: [o.modelo.id],
      categoriaNova: payload.categoria_principal_id as string,
    });
    if (bloqueados.length > 0)
      throw new RecusaEsperadaError(textoBloqueioCategoriaCard(bloqueados[0]));
  }

  const { data, error } = await o.client
    .from("modelos")
    .update(payload)
    .eq("id", o.modelo.id)
    .eq("rev", o.revBase)
    .select("id, rev");
  if (error) throw error;
  if (!data || data.length === 0) throw new ConflitoProdutoError();
  return { rev: data[0].rev ?? null, enviou: true, omitidas };
}
