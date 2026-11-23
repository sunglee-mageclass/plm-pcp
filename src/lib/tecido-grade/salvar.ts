/* eslint-disable @typescript-eslint/no-explicit-any -- `rev`/`subcategoria_tecido_id`/RPCs fora do types.ts (regen pendente): `as any` no builder, padrão do $artigoId */
// Gravação da grade "Lista tipo Excel" de Cadastro > Tecidos — a MESMA regra do Sheet (`cadastro.tecidos.$artigoId.tsx`),
// em funções que os DOIS usam (o Sheet importa daqui; nada de regra duplicada):
//   artigo   → `artigos`.update `.eq("rev", revBase)` (0 linhas = P0409_LOCAL) → `set_artigo_categorias`
//   variante → RPC `salvar_variante_tecido` (CAS por campo) + assinatura da prévia de preço
// Este arquivo NÃO importa da rota (evita ciclo): quem chama converte o rascunho da cor com `draftParaServidor`.
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { paresParaSalvar, type SubPorCat } from "@/lib/tecido-subcategoria";
import type { CategoriaEntrada } from "./linhas";

/** Sinal do compare-and-set do tecido (ninguém é lançado pelo servidor: é 0 linhas no UPDATE com `rev`). */
export const CODIGO_CONFLITO_LOCAL = "P0409_LOCAL";

// ============================== Artigo (cabeçalho do tecido) ==============================

/**
 * UPDATE do tecido com trava otimista (rev). Devolve o `rev` NOVO (já bumpado por este UPDATE) para o chamador
 * re-baselizar IMEDIATAMENTE — sem isso, um 2º Salvar rápido mandaria o rev velho → P0409 FALSO contra o próprio save.
 * 0 linhas devolvidas = conflito (não é erro de rede/permissão): lança com `code = "P0409_LOCAL"`.
 * `types.ts` ainda não tem a coluna `rev` (regen pendente) → `as any` no builder inteiro.
 */
export async function atualizarArtigoComRev(
  artigoId: string,
  revBase: number | null,
  payload: Record<string, unknown>,
): Promise<number | null> {
  const { data: updRows, error } = await (supabase.from("artigos") as any)
    .update(payload)
    .eq("id", artigoId)
    .eq("rev", revBase)
    .select("id, rev");
  if (error) throw error;
  if (revBase != null && (!updRows || updRows.length === 0)) {
    const conflito: any = new Error("conflito_versao: o tecido foi salvo por outra pessoa");
    conflito.code = CODIGO_CONFLITO_LOCAL;
    throw conflito;
  }
  if (updRows && updRows[0]?.rev != null) return updRows[0].rev as number;
  return null;
}

/**
 * Junção de categorias, ATÔMICA (RPC): evita o tecido ficar sem nenhuma categoria caso o insert falhasse após o delete.
 * Só chamar depois do UPDATE do tecido ter passado (0 linhas já lançou P0409_LOCAL e abortou antes daqui).
 */
export async function gravarCategoriasArtigo(artigoId: string, catIds: string[], subPorCat: SubPorCat): Promise<void> {
  const { error } = await supabase.rpc("set_artigo_categorias" as any, {
    _artigo_id: artigoId,
    _pares: paresParaSalvar(catIds, subPorCat),
  });
  if (error) throw error;
}

/** Salvar do tecido na grade: UPDATE com rev e, se as categorias mudaram, `set_artigo_categorias`. Devolve o rev novo. */
export async function salvarArtigo(
  artigoId: string,
  revBase: number | null,
  payload: Record<string, unknown>,
  cats: { catIds: string[]; subPorCat: SubPorCat } | null,
): Promise<number | null> {
  const novoRev = await atualizarArtigoComRev(artigoId, revBase, payload);
  if (cats) await gravarCategoriasArtigo(artigoId, cats.catIds, cats.subPorCat);
  return novoRev;
}

/** Rascunho do TECIDO na grade (nomes = colunas de `artigos`; `catIds`/`subPorCat` = categorias N:N com sub). */
export type ArtigoDraft = {
  nome: string;
  empresa_id: string | null;
  preco: number | null;
  unidade_medida: string;
  largura_estimada: number | null;
  composicao: string | null;
  ncm: string | null;
  rendimento: number | null;
  mes_id: string | null;
  ano_id: string | null;
  catIds: string[];
  subPorCat: SubPorCat;
};

/** Os campos do tecido que a grade lê (subconjunto do `ArtigoEntrada`). */
export type ArtigoParaDraft = {
  nome: string;
  empresa_id: string | null;
  preco: number | null;
  unidade_medida: string | null;
  largura_estimada: number | null;
  composicao: string | null;
  ncm: string | null;
  rendimento: number | null;
  mes_id: string | null;
  ano_id: string | null;
};

/** vazio ("" ou só espaço) = null: o rascunho nunca fica "sujo" por trocar null por "". */
const vazioNulo = (v: string | null | undefined): string | null => (v == null || v.trim() === "" ? null : v);

/** Linhas do servidor -> rascunho (a base do `useCardDraft`; a tela MEMOIZA o resultado). */
export function artigoParaDraft(a: ArtigoParaDraft, cats: CategoriaEntrada[]): ArtigoDraft {
  return {
    nome: a.nome ?? "",
    empresa_id: a.empresa_id ?? null,
    preco: a.preco == null ? null : Number(a.preco),
    unidade_medida: a.unidade_medida ?? "metro",
    largura_estimada: a.largura_estimada == null ? null : Number(a.largura_estimada),
    composicao: vazioNulo(a.composicao),
    ncm: vazioNulo(a.ncm),
    rendimento: a.rendimento == null ? null : Number(a.rendimento),
    mes_id: a.mes_id ?? null,
    ano_id: a.ano_id ?? null,
    catIds: cats.map((c) => c.categoria_tecido_id),
    subPorCat: cats.reduce<SubPorCat>((m, c) => {
      if (c.subcategoria_tecido_id) m[c.categoria_tecido_id] = c.subcategoria_tecido_id;
      return m;
    }, {}),
  };
}

/** Falha de validação/servidor com texto PT-BR pronto; `conflito` = alguém salvou no meio (conta como "com conflito"). */
export class ErroGrade extends Error {
  conflito: boolean;
  constructor(mensagem: string, conflito = false) {
    super(mensagem);
    this.name = "ErroGrade";
    this.conflito = conflito;
  }
}

/** Mudou alguma coisa de categoria (marcadas ou subcategorias)? */
export function tocouCategorias(mudancas: Partial<ArtigoDraft>): boolean {
  return "catIds" in mudancas || "subPorCat" in mudancas;
}

/**
 * Rascunho (só os campos TOCADOS) -> payload do UPDATE de `artigos`. Mesmas normalizações do Sheet (`salvarTecido`):
 * texto vazio = null, NCM com trim, `categoria_tecido_id` = a 1ª categoria marcada, `rendimento` só vale em Kg.
 * Trocar o fornecedor zera o representante (ele pertence à empresa antiga). Lança `ErroGrade` se o nome ficou vazio.
 */
export function montarPayloadArtigo(mudancas: Partial<ArtigoDraft>, base: ArtigoDraft): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if ("nome" in mudancas) {
    if (!mudancas.nome || mudancas.nome.trim() === "") throw new ErroGrade("Informe o nome do tecido.");
    p.nome = mudancas.nome;
  }
  if ("empresa_id" in mudancas) {
    p.empresa_id = mudancas.empresa_id || null;
    p.representante_id = null;
  }
  if ("preco" in mudancas) p.preco = mudancas.preco ?? null;
  if ("largura_estimada" in mudancas) p.largura_estimada = mudancas.largura_estimada ?? null;
  if ("composicao" in mudancas) p.composicao = mudancas.composicao || null;
  if ("ncm" in mudancas) p.ncm = mudancas.ncm?.trim() || null;
  if ("mes_id" in mudancas) p.mes_id = mudancas.mes_id || null;
  if ("ano_id" in mudancas) p.ano_id = mudancas.ano_id || null;
  if ("unidade_medida" in mudancas) p.unidade_medida = mudancas.unidade_medida;
  if ("unidade_medida" in mudancas || "rendimento" in mudancas) {
    const unidade = mudancas.unidade_medida ?? base.unidade_medida;
    const rend = "rendimento" in mudancas ? mudancas.rendimento : base.rendimento;
    p.rendimento = unidade === "kg" ? rend ?? null : null;
  }
  if (tocouCategorias(mudancas)) {
    const ids = mudancas.catIds ?? base.catIds;
    p.categoria_tecido_id = ids[0] || null;
  }
  return p;
}

// ============================== Variante (cor) ==============================

const TEXTO_COR_DUPLICADA = "Já existe uma variante com essa cor e apelido.";
/** Mensagem PT da falha ao salvar UMA cor (23505 aqui só pode ser o índice único parcial artigo+cor+apelido). */
export function mensagemSalvarCor(e: unknown): string {
  if ((e as { code?: string } | null)?.code === "23505") return TEXTO_COR_DUPLICADA;
  return mensagemErro(e, "Erro ao salvar a cor.");
}

/** A chamada da RPC `salvar_variante_tecido` (CAS por campo). `mudancas`/`base` já em formato de servidor (`draftParaServidor`). */
export async function chamarSalvarVarianteTecido(args: {
  id: string;
  mudancas: Record<string, unknown>;
  base: Record<string, unknown>;
  /** Só vai com o preço (sem preço não há o que conferir). */
  assinatura: string | null;
}) {
  return supabase.rpc("salvar_variante_tecido" as any, {
    _id: args.id,
    _mudancas: args.mudancas,
    _base: args.base,
    _assinatura: args.assinatura,
  } as any);
}

/**
 * Assinatura da prévia de preço (RPC só-leitura `variante_tecido_preco_previa`): o servidor confere no Salvar que a
 * lista de produtos afetados não mudou. Devolve null se a prévia falhou ou estourou o prazo (`limite`, epoch ms).
 */
export async function buscarAssinaturaPreco(variantId: string, preco: number | null, limite?: number): Promise<string | null> {
  const pedido = (async () => {
    try {
      const { data, error } = await supabase.rpc("variante_tecido_preco_previa" as any, { _id: variantId, _preco: preco } as any);
      if (error) return null;
      const a = (data as { assinatura?: unknown } | null)?.assinatura;
      return typeof a === "string" ? a : null;
    } catch {
      return null;
    }
  })();
  if (limite == null) return pedido;
  const restante = Math.max(0, limite - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<null>((res) => { timer = setTimeout(() => res(null), restante); });
  try { return await Promise.race([pedido, prazo]); } finally { if (timer) clearTimeout(timer); }
}

/**
 * Salvar de UMA cor na grade. `mudancas`/`base` já convertidos por `draftParaServidor`. Mexeu no preço: pede a assinatura da
 * prévia aqui (leitura, nada grava) e a manda de volta. Lança `ErroGrade` com texto PT; `conflito` quando é P0409.
 */
export async function salvarVarianteGrade(args: {
  id: string;
  mudancas: Record<string, unknown>;
  base: Record<string, unknown>;
  tocouPreco: boolean;
  preco: number | null;
  limite?: number;
}): Promise<void> {
  let assinatura: string | null = null;
  if (args.tocouPreco) {
    assinatura = await buscarAssinaturaPreco(args.id, args.preco, args.limite);
    if (assinatura == null) throw new ErroGrade("Não consegui calcular o efeito do preço. Tente salvar de novo.");
  }
  const { error } = await chamarSalvarVarianteTecido({ id: args.id, mudancas: args.mudancas, base: args.base, assinatura });
  if (!error) return;
  const code = (error as { code?: string }).code;
  const msg = String((error as { message?: string }).message ?? "");
  if (code === "P0409" && msg.startsWith("conflito_versao")) {
    throw new ErroGrade("Outra pessoa alterou esta cor. Recarreguei a lista — confira e salve de novo.", true);
  }
  if (code === "P0409" && msg.startsWith("previa_desatualizada")) {
    throw new ErroGrade("O efeito do preço mudou — confira e salve de novo.", true);
  }
  throw new ErroGrade(mensagemSalvarCor(error));
}

// ============================== UM Salvar (ordem artigo -> variante, resultado parcial) ==============================

/** O que a tela registra por rascunho (tecido ou cor): lê o estado mais novo por ref, no momento de salvar. */
export type ItemSalvar = {
  id: string;
  dirty: () => boolean;
  salvar: (ctx: { limite?: number }) => Promise<void>;
};

export type ResultadoSalvarTudo = { ok: number; conflito: number; erro: number };

/** Texto PT-BR do aviso na linha que não gravou (conflito de rev do tecido, `ErroGrade` ou erro genérico do servidor). */
export function textoErroSalvar(e: unknown): string {
  if (e instanceof ErroGrade) return e.message;
  if ((e as { code?: string } | null)?.code === CODIGO_CONFLITO_LOCAL) {
    return "Outra pessoa salvou este tecido agora. Recarreguei a lista — confira e salve de novo.";
  }
  return mensagemErro(e, "Erro ao salvar.");
}

export function ehConflito(e: unknown): boolean {
  if (e instanceof ErroGrade) return e.conflito;
  return (e as { code?: string } | null)?.code === CODIGO_CONFLITO_LOCAL;
}

/**
 * UM Salvar: primeiro TODOS os rascunhos de tecido, depois os de cor, com UM prazo comum. PARCIAL: a falha de um (conflito de
 * rev, cor duplicada…) não derruba os outros — ele continua sujo (com o aviso na própria linha) e os demais gravam.
 */
export async function salvarEmOrdem(
  artigos: ItemSalvar[],
  variantes: ItemSalvar[],
  ctx: { limite?: number },
): Promise<ResultadoSalvarTudo> {
  const r: ResultadoSalvarTudo = { ok: 0, conflito: 0, erro: 0 };
  for (const item of [...artigos, ...variantes]) {
    if (!item.dirty()) continue;
    try {
      await item.salvar(ctx);
      r.ok++;
    } catch (e) {
      if (ehConflito(e)) r.conflito++;
      else r.erro++;
    }
  }
  return r;
}

/** Texto do toast do Salvar ("3 salvos, 1 com conflito"). `tom` diz qual toast usar. */
export function textoResultadoSalvar(r: ResultadoSalvarTudo): { tom: "sucesso" | "aviso" | "erro"; texto: string } {
  const partes: string[] = [];
  if (r.ok > 0) partes.push(`${r.ok} ${r.ok === 1 ? "salvo" : "salvos"}`);
  if (r.conflito > 0) partes.push(`${r.conflito} com conflito`);
  if (r.erro > 0) partes.push(`${r.erro} com erro`);
  if (partes.length === 0) return { tom: "aviso", texto: "Nada para salvar." };
  const texto = `${partes.join(", ")}.`;
  if (r.conflito === 0 && r.erro === 0) return { tom: "sucesso", texto };
  return { tom: r.ok > 0 ? "aviso" : "erro", texto: `${texto} Veja o aviso na linha.` };
}
