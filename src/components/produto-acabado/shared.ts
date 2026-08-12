// Tipos + helpers puros do planejador Produto Acabado (Task 6/8, revenda).
// Espelha o padrão de src/components/oc-p-acabado/shared.ts (mesma família de telas),
// mas para a entidade `produtos_acabados` (compra + variantes, SEM grade cor×tamanho —
// isso é só da OC, ver design spec §2: "tabela de variantes ... SÓ POR COR — sem
// tamanho aqui").
import { format } from "date-fns";
import { splitMaiorResto } from "@/lib/produto-acabado";

export type Opt = { id: string; nome: string };
export type CatOpt = Opt & { grupo_id: string | null };
export type SubOpt = Opt & { categoria_id: string | null };
export type CorApelidoOpt = Opt & { cor_base_id: string | null };

export type VarianteDraft = {
  ordem: number;
  cor_id: string | null;
  cor_apelido_id: string | null;
  peso: number;
  qtd: number;
};

export type CelulaGradeOc = { pedida: number; recebida: number; defeito: number };
export type GradeDetalheOc = Record<string, Record<string, CelulaGradeOc>>;

export type OcVinculadaInfo = {
  id: string;
  numero: string | null;
  status: "encomendado" | "recebido";
  qtd_total: number;
  valor_unitario_real: number;
  grade_detalhe: GradeDetalheOc;
  // Valor unitário/desconto BRUTOS da OC (não o "real" já líquido acima) — pedido do dono
  // (ago/2026, "valor unitário e desconto no card devem ser atualizados de acordo com a
  // OC"): o servidor já sincroniza `produtos_acabados.valor_unitario`/`desconto_pct` com
  // estes MESMOS valores a cada save/vincular da OC (ver migração
  // 20260812100000_ocpa_sync_valores_produto.sql), então `p.valor_unitario`/`p.desconto_pct`
  // e `p.oc.valor_unitario`/`p.oc.desconto_pct` são sempre iguais em qualquer leitura fresca.
  // Guardados aqui à parte pra `montarDadosProduto` ter uma fonte explicitamente "vinda da
  // OC" ao reenviar esses campos (evita reenviar um valor local potencialmente mais velho
  // que o embed da OC, ainda que na prática os dois venham juntos do mesmo SELECT).
  valor_unitario: number;
  desconto_pct: number;
};

export type ProdutoDraft = {
  id: string;
  nome: string;
  ref: string | null;
  grupo_id: string | null;
  categoria_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  colecao_id: string | null;
  subcolecao: string | null;
  semana: string | null;
  empresa_id: string | null;
  representante_id: string | null;
  ref_fornecedor: string;
  composicao: string;
  grade_proporcao: Record<string, number>;
  qtd_total: number;
  valor_unitario: number;
  desconto_pct: number;
  insumos_total: number;
  // Markups digitáveis (item 3 do refino, ago/2026) — null = "não definido"; alimentam a
  // cadeia custo×markup_atacado=PREÇO ATACADO, preço atacado×markup_varejo=PREÇO VAREJO,
  // recomputada e persistida no servidor (`_pa_recomputar_precos_modelo`, chamada por
  // `salvar_produto_acabado`) em `modelos.preco_atacado`/`preco_venda` do espelho.
  markup_atacado: number | null;
  markup_varejo: number | null;
  modelo_id: string | null;
  variantes: VarianteDraft[];
  // Enriquecimento read-only (embeds) — nunca editados aqui:
  modeloPrecoVenda: number | null;
  modeloPrecoAtacado: number | null;
  modeloLinhaId: string | null;
  // Hierarquia de imagem do espelho (foto do modelo → desenho técnico → croqui), MESMA regra
  // do Plan. Tecido (`PlanTecidoSheet.tsx`) — consumida por `ModeloResumoFoto` (`fontes`, ela
  // mesma escolhe a 1ª truthy + trata PDF). Produto sem espelho (`modelo_id` null) = [null,
  // null, null] → placeholder.
  modeloThumbFontes: (string | null)[];
  oc: OcVinculadaInfo | null;
};

/** Σ peças = Σ qtd de todas as variantes do produto. */
export function somaPecas(p: Pick<ProdutoDraft, "variantes">): number {
  return p.variantes.reduce((s, v) => s + (Number(v.qtd) || 0), 0);
}

/** Só os campos que a TELA edita (Compra & variantes) — usado como snapshot do dirty-guard,
 *  pra não disparar "não salvo" por causa de dado read-only que muda no refetch. */
export function chaveDirty(p: ProdutoDraft) {
  return {
    id: p.id,
    empresa_id: p.empresa_id,
    representante_id: p.representante_id,
    ref_fornecedor: p.ref_fornecedor,
    composicao: p.composicao,
    grade_proporcao: p.grade_proporcao,
    qtd_total: p.qtd_total,
    valor_unitario: p.valor_unitario,
    desconto_pct: p.desconto_pct,
    markup_atacado: p.markup_atacado,
    markup_varejo: p.markup_varejo,
    variantes: p.variantes,
  };
}

/** Redistribui qtd_total entre as variantes pelo peso de cada uma (maior resto) —
 *  espelha `redistribuir=true` de `salvar_produto_acabado`, calculado no cliente pra
 *  preview imediato (o usuário ainda precisa Salvar pra persistir). */
export function redistribuirVariantesPorPeso(variantes: VarianteDraft[], qtdTotal: number): VarianteDraft[] {
  const pesos = Object.fromEntries(variantes.map((v) => [String(v.ordem), v.peso]));
  const split = splitMaiorResto(qtdTotal, pesos);
  return variantes.map((v) => ({ ...v, qtd: split[String(v.ordem)] ?? 0 }));
}

/** Monta a grade_detalhe "pedida" de uma OC nova a partir das variantes do produto (Fazer
 *  pedido) — espelha `_pa_grade_variante`/`_split_maior_resto` do banco. Acessório = célula
 *  única "UN"; senão, cada variante é destrinchada pela proporção de tamanho do produto. */
export function gradePedidaDeVariantes(
  variantes: VarianteDraft[],
  gradeProporcao: Record<string, number>,
  acessorio: boolean,
): GradeDetalheOc {
  const out: GradeDetalheOc = {};
  for (const v of variantes) {
    const split = acessorio ? { UN: v.qtd } : splitMaiorResto(v.qtd, gradeProporcao);
    const linha: Record<string, CelulaGradeOc> = {};
    for (const [tam, pedida] of Object.entries(split)) linha[tam] = { pedida: Number(pedida) || 0, recebida: 0, defeito: 0 };
    out[String(v.ordem)] = linha;
  }
  return out;
}

/** Soma de um campo (pedida/recebida/defeito) através de toda a grade_detalhe de uma OC. */
export function somaGradeCampo(grade: GradeDetalheOc | null | undefined, campo: keyof CelulaGradeOc): number {
  if (!grade) return 0;
  let s = 0;
  for (const linha of Object.values(grade)) for (const cel of Object.values(linha)) s += Number(cel?.[campo] ?? 0);
  return s;
}

export function hojeISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** `_dados` de `salvar_produto_acabado` — FONTE ÚNICA (achado do fix round 1: o Salvar em
 *  lote da tela esquecia `qtd_total`/`valor_unitario`/`desconto_pct` no payload, e o
 *  servidor persistia zeros sem avisar visualmente — só o reload/round-trip revelava).
 *  Usado tanto pelo Salvar em lote (`ProdutoAcabadoSheet`) quanto pelo save-antes-do-pedido
 *  (`ProdutoCard`, "Fazer pedido") — os dois SEMPRE mandam o mesmo shape completo.
 *
 *  Quando o produto TEM OC vinculada, `valor_unitario`/`desconto_pct` são espelho da OC (o
 *  card trava os inputs — ver `ProdutoCard`, seção "1 · Compra") — manda os valores de
 *  `p.oc`, não os de `p`: evita que um Salvar disparado por outro campo (ex.: REF
 *  Fornecedor) reenvie um `p.valor_unitario`/`p.desconto_pct` porventura mais velho que o
 *  que o servidor já sincronizou (pedido do dono, ago/2026 — "valor unitário e desconto no
 *  card devem ser atualizados de acordo com a OC"; RPC `salvar_produto_acabado` não faz
 *  COALESCE com o valor atual, então OMITIR o campo zeraria em vez de preservar). */
export function montarDadosProduto(p: ProdutoDraft): Record<string, unknown> {
  return {
    nome: p.nome,
    ref: p.ref,
    grupo_id: p.grupo_id,
    categoria_id: p.categoria_id,
    subcategoria1_id: p.subcategoria1_id,
    subcategoria2_id: p.subcategoria2_id,
    colecao_id: p.colecao_id,
    subcolecao: p.subcolecao,
    semana: p.semana,
    empresa_id: p.empresa_id,
    representante_id: p.representante_id,
    ref_fornecedor: p.ref_fornecedor || null,
    composicao: p.composicao || null,
    grade_proporcao: p.grade_proporcao,
    qtd_total: p.qtd_total,
    valor_unitario: p.oc ? p.oc.valor_unitario : p.valor_unitario,
    desconto_pct: p.oc ? p.oc.desconto_pct : p.desconto_pct,
    markup_atacado: p.markup_atacado,
    markup_varejo: p.markup_varejo,
    redistribuir: "false",
  };
}

/** A distribuição ATUAL das variantes ainda é a saída "por peso" (`redistribuirVariantesPorPeso`)
 *  para o `qtdTotal` informado — ou seja, ninguém editou manualmente uma célula de qtd (nem
 *  mudou peso/variantes) desde o último auto-redistribuir. Usado pra decidir se mudar a Qtd
 *  total pode redistribuir AUTOMATICAMENTE (fix round 2, review R1: antes redistribuía sempre,
 *  descartando silenciosamente edição manual das qtds por variante) — se `false`, a Qtd total
 *  muda mas as qtds atuais são PRESERVADAS; redistribuir vira ação explícita (botão
 *  "Redistribuir por peso", já existente na tela). */
export function ehDistribuicaoProporcional(variantes: VarianteDraft[], qtdTotal: number): boolean {
  const auto = redistribuirVariantesPorPeso(variantes, qtdTotal);
  return auto.every((v, i) => v.qtd === variantes[i].qtd);
}

/** Produto tem Σ qtd das variantes batendo com a Qtd total? Mesma regra de
 *  `_salvar_produto_acabado_core` quando `redistribuir=false` (o caminho usado pelo Salvar da
 *  tela e pelo Fazer pedido — NUNCA redistribui silenciosamente, ver fix round 1 item 3). */
export function variantesBatemComTotal(p: Pick<ProdutoDraft, "variantes" | "qtd_total">): boolean {
  return somaPecas(p) === p.qtd_total;
}

/**
 * Erro de validação CLIENT-SIDE que deve aparecer VERBATIM no toast — mesmo mecanismo que
 * `mensagemErro` (`@/lib/erro-mensagem`) já usa pro `RAISE ... using errcode = 'P0001'` do
 * servidor (`if (code === "P0001" && msg) return msg`). Achado no fix round 1: um
 * `throw new Error("mensagem clara em PT")` cru não carrega `.code`, então `mensagemErro` cai
 * na heurística `PARECE_PT` (lista fixa de palavras/acentos) — se a frase não bater nenhuma
 * (ex.: "A soma das variantes (0) precisa bater com a Qtd total (50)..."), o toast mostra o
 * FALLBACK genérico ("Erro ao criar pedido.") em vez da orientação real, escondendo exatamente
 * a mensagem que o usuário precisa pra corrigir. `erroValidacao` marca o erro com
 * `code: "P0001"` pra usar o MESMO atalho confiável do servidor, sem depender da heurística.
 */
export function erroValidacao(mensagem: string): Error {
  const erro = new Error(mensagem) as Error & { code: string };
  erro.code = "P0001";
  return erro;
}

export function fmtMoney(v: number | null | undefined): string {
  const n = Number(v) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
