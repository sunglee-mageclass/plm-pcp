// Tipos + helpers puros do planejador Produto Acabado (Task 6/8, revenda).
// Espelha o padrão de src/components/oc-p-acabado/shared.ts (mesma família de telas),
// mas para a entidade `produtos_acabados` (compra + variantes, SEM grade cor×tamanho —
// isso é só da OC, ver design spec §2: "tabela de variantes ... SÓ POR COR — sem
// tamanho aqui").
import { format } from "date-fns";
import { splitMaiorResto } from "@/lib/produto-acabado";
import { brl } from "@/lib/format";

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
  // Colab (Fase 3, set/2026, ver migração 20260916220000): rev otimista POR PRODUTO — bumpa a
  // cada UPDATE em `produtos_acabados` (trigger `fn_colab_touch_rev`). Metadado READ-ONLY —
  // NUNCA entra em `chaveDirty` (editar outro campo não deve "sujar" por causa do rev mudar
  // no refetch; e o próprio rev nunca é editado pela UI).
  rev: number;
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
  // Preço FIXO por canal (set/2026): quando o usuário DIGITA um preço, ele é gravado EXATO aqui e o
  // markup do canal é limpo ("última edição manda"); o recompute usa `coalesce(preco_fixo, base×markup)`.
  // Espelha o Planejamento de Produto — as 2 telas usam o MESMO modelo. Read-only no draft (a escrita
  // vai pelas RPCs `salvar_precos_fixo_produto_acabado`/`salvar_markups_produto_acabado`, não pelo save
  // em lote de `salvar_produto_acabado`, que só toca markup).
  preco_atacado_fixo: number | null;
  preco_varejo_fixo: number | null;
  // Foto PRÓPRIA do produto (#2.4) — path no bucket "oc-tecido" (como o Importado). O thumb do
  // card usa esta com fallback pra do modelo espelho.
  foto_url: string | null;
  modelo_id: string | null;
  // Família de produtos (colecao_mixes). Read-only aqui — associada pelo EditarMixDialog (#4b),
  // NÃO por `montarDadosProduto` (o save do produto não toca mix_id). Alimenta o agrupamento
  // por família e é passada ao dialog p/ os rascunhos (modelo_id null).
  mix_id: string | null;
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

/** Só os campos que a TELA edita (Compra & variantes + Identidade, ago/2026 refino) — usado
 *  como snapshot do dirty-guard, pra não disparar "não salvo" por causa de dado read-only que
 *  muda no refetch. nome/grupo_id/categoria_id/subcategoria1_id/subcategoria2_id entraram
 *  quando o card ganhou o bloco "Identidade" editável (ProdutoCard) — sem isto aqui, editar
 *  esses campos não acendia o UnsavedIndicator nem habilitava o botão Salvar.
 *  `foto_url` (Fix round 2, N-4): faltava aqui — sem ele, `touched` (diff de `chaveDirty` vs a
 *  base, usado por `resolverTravaAcabado`) NUNCA continha "foto_url", então uma foto trocada antes
 *  do lock chegar era revertida em SILÊNCIO (sem o toast PT que o brief exige) — o usuário perdia
 *  o upload sem nenhum aviso. (`ref` NÃO entra — é gerado pelo trigger `fn_produto_acabado_ref`,
 *  nunca editável nesta tela — ver `ProdutoCard.tsx`, só exibido, nunca um `<Input>`.) */
export function chaveDirty(p: ProdutoDraft) {
  return {
    id: p.id,
    nome: p.nome,
    grupo_id: p.grupo_id,
    categoria_id: p.categoria_id,
    subcategoria1_id: p.subcategoria1_id,
    subcategoria2_id: p.subcategoria2_id,
    empresa_id: p.empresa_id,
    representante_id: p.representante_id,
    ref_fornecedor: p.ref_fornecedor,
    composicao: p.composicao,
    foto_url: p.foto_url,
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
    foto_url: p.foto_url ?? null,
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
// ── Integração F4 — Fix round 1 (I-1/I-2/M-1/M-3/M-4) — espelha 1:1 o mesmo bloco de
// `produto-importado/shared.ts` (mesmo par preco_varejo_fixo/markup_varejo, mesma trigger
// `fn_integracao_trava_espelho`, mesmas colunas nome/ref/foto_url). Ver o comentário completo lá.
export type CampoTravavel = "nome" | "ref" | "foto_url" | "preco_varejo_fixo" | "markup_varejo";
export const CAMPOS_TRAVAVEIS_POR_COLUNA: Record<string, readonly CampoTravavel[]> = {
  nome: ["nome"],
  ref: ["ref"],
  fotos_modelo: ["foto_url"],
  preco_venda: ["preco_varejo_fixo", "markup_varejo"],
};
export type AvisoTrava = { campo: CampoTravavel | "variantes"; rotulo: string };
export type ResolucaoTravaProduto = {
  paraServidor: Partial<Record<CampoTravavel, unknown>>;
  /** N-1 (Fix round 2) — espelha `resolverTravaImportado`: revert do array INTEIRO de variantes
   *  quando o conjunto de cores divergiu do servidor e a trava (SEMPRE em `variantes`) está ativa. */
  variantesParaServidor: VarianteDraft[] | null;
  avisos: AvisoTrava[];
};
const ROTULO_CAMPO_TRAVADO: Record<CampoTravavel, string> = {
  nome: "Nome", ref: "REF", foto_url: "Foto", preco_varejo_fixo: "Valor varejo", markup_varejo: "Markup Varejo",
};
/** Conjunto DISTINCT de "cor_id|cor_apelido_id" ordenado — espelha `fn_integracao_trava_variantes`
 *  (m4:253-318) o bastante pra decidir SE o conjunto mudou (mesma função de
 *  `produto-importado/shared.ts`, duplicada aqui por PA/PI não compartilharem `VarianteDraft`). */
function coresDistintasPA(variantes: readonly Pick<VarianteDraft, "cor_id" | "cor_apelido_id">[]): string[] {
  return [...new Set(variantes.map((v) => `${v.cor_id ?? ""}|${v.cor_apelido_id ?? ""}`))].sort();
}
/** PURA — espelha `resolverTravaImportado` (produto-importado/shared.ts): reverte campos travados
 *  ao valor do servidor (incondicional), reverte `variantes` INTEIRO quando as cores divergem com a
 *  trava ativa (N-1, Fix round 2), e devolve avisos PT só para os tocados que divergiam. */
export function resolverTravaAcabado(o: {
  enviado: ProdutoDraft;
  servidor: ProdutoDraft | null | undefined;
  travaAtual: ReadonlySet<string> | null | undefined;
  touched: ReadonlySet<string>;
}): ResolucaoTravaProduto {
  const { enviado, servidor, travaAtual, touched } = o;
  if (!travaAtual || travaAtual.size === 0 || !servidor) return { paraServidor: {}, variantesParaServidor: null, avisos: [] };
  const paraServidor: Partial<Record<CampoTravavel, unknown>> = {};
  const avisos: AvisoTrava[] = [];
  const camposJaVistos = new Set<CampoTravavel>();
  for (const coluna of travaAtual) {
    const campos = CAMPOS_TRAVAVEIS_POR_COLUNA[coluna];
    if (!campos) continue;
    for (const campo of campos) {
      if (camposJaVistos.has(campo)) continue;
      camposJaVistos.add(campo);
      const valorServidor = (servidor as any)[campo];
      paraServidor[campo] = valorServidor;
      const camposDoPar = coluna === "preco_venda" ? (["preco_varejo_fixo", "markup_varejo"] as const) : ([campo] as const);
      const tocadoNoSentidoDoPar = camposDoPar.some((c) => touched.has(c));
      if (!tocadoNoSentidoDoPar) continue;
      const valorEnviado = (enviado as any)[campo];
      if (valorEnviado === valorServidor) continue;
      avisos.push({ campo, rotulo: ROTULO_CAMPO_TRAVADO[campo] });
    }
  }
  let variantesParaServidor: VarianteDraft[] | null = null;
  if (travaAtual.has("variantes")) {
    const coresEnviado = coresDistintasPA(enviado.variantes);
    const coresServidor = coresDistintasPA(servidor.variantes);
    if (JSON.stringify(coresEnviado) !== JSON.stringify(coresServidor)) {
      variantesParaServidor = servidor.variantes;
      if (touched.has("variantes")) avisos.push({ campo: "variantes", rotulo: "Cores" });
    }
  }
  return { paraServidor, variantesParaServidor, avisos };
}
export function toastTravaAcabado(avisos: readonly AvisoTrava[]): string {
  const rotulos = avisos.map((a) => a.rotulo);
  const lista = rotulos.length <= 1 ? (rotulos[0] ?? "") : `${rotulos.slice(0, -1).join(", ")} e ${rotulos[rotulos.length - 1]}`;
  const verbo = rotulos.length <= 1 ? "foi travado" : "foram travados";
  return `${lista} ${verbo} pela Integração enquanto você editava — essa alteração não foi salva.`;
}
export function aplicarResolucaoTravaAcabado(draft: ProdutoDraft, resolucao: ResolucaoTravaProduto): ProdutoDraft {
  if (Object.keys(resolucao.paraServidor).length === 0 && !resolucao.variantesParaServidor) return draft;
  return {
    ...draft,
    ...resolucao.paraServidor,
    ...(resolucao.variantesParaServidor ? { variantes: resolucao.variantesParaServidor } : {}),
  } as ProdutoDraft;
}

export function erroValidacao(mensagem: string): Error {
  const erro = new Error(mensagem) as Error & { code: string };
  erro.code = "P0001";
  return erro;
}

export function fmtMoney(v: number | null | undefined): string {
  return brl(Number(v) || 0);
}

/** N-3 (Fix round 2, Integração) — PURA: qual `markup_varejo` o blur do Markup ATACADO deve
 *  reenviar pra `salvar_markups_produto_acabado` (a RPC grava os 2 campos SEMPRE, sem "só toca
 *  1" — `_salvar_markups_produto_acabado_core`). Sem varejo travado, o draft local manda (como
 *  sempre). COM o varejo travado, o draft pode ter divergido do servidor desde a marcação (ex.:
 *  um blur anterior que falhou) — reenviar o draft reescreveria o canal travado em SILÊNCIO (a
 *  trigger de trava só checa `preco_varejo_fixo`, nunca `markup_varejo` — D12 deixa markup passar
 *  sempre); manda o markup do SERVIDOR (`markupVarejoServidor`) nesse caso. `null`/`undefined` em
 *  `markupVarejoServidor === undefined` (prop AUSENTE — ex.: uso legado do `ProdutoCard` sem o
 *  prop novo) cai de volta no draft — melhor um valor potencialmente divergente do que travar a
 *  UI numa ausência de dado. `null` é um valor REAL do servidor (canal usa preço fixo, sem
 *  markup) — nesse caso manda `null`, nunca o draft (distinção `null` vs `undefined` proposital:
 *  `??` sozinho trataria os dois igual e mandaria o draft errado quando o servidor tem `null`). */
export function markupVarejoParaBlurAtacado(o: {
  travaVarejo: boolean;
  markupVarejoDraft: number | null;
  markupVarejoServidor: number | null | undefined;
}): number | null {
  if (!o.travaVarejo) return o.markupVarejoDraft;
  return o.markupVarejoServidor === undefined ? o.markupVarejoDraft : o.markupVarejoServidor;
}
