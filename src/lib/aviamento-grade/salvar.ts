/* eslint-disable @typescript-eslint/no-explicit-any -- `codigo`/`ncm`/`variantes_aviamento`/RPC fora do types.ts (regen pendente): `as any` no builder, como a tela de Aviamentos de hoje */
// Gravação da grade "Lista tipo Excel" de Cadastro > Aviamentos. A MESMA regra da tela de hoje (`cadastro.aviamentos.tsx`):
//   aviamento (cabeçalho) → `aviamentos`.update(payload).eq("id") DIRETO. Aviamento NÃO tem `rev`: sem trava otimista, "último vence"
//                           (como o Sheet de hoje). Categoria/subcategoria/material são 3 colunas FK do próprio UPDATE (sem N:N).
//   variantes (cores)     → RPC `salvar_variantes_aviamento(_aviamento_id, _variantes)`, que é de LOTE (keep/delete/update/insert):
//                           o que falta do payload é APAGADO (com guarda de uso). Por isso o Salvar manda, por aviamento tocado, o
//                           conjunto COMPLETO de variantes — montado sobre a leitura FRESCA do servidor (nunca sobre a tela), com só os
//                           campos TOCADOS por cima: não apaga a cor que outra pessoa criou nem desfaz a que ela editou em outro campo.
// Este arquivo é PURO em React: só `supabase`, texto PT-BR e a ordem do UM Salvar (cabeçalhos primeiro, depois as cores).
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";

/** Falha de validação/servidor com texto PT-BR pronto para a linha que não gravou. */
export class ErroGrade extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroGrade";
  }
}

// ============================== Aviamento (cabeçalho) ==============================

/** Rascunho do AVIAMENTO na grade (nomes = colunas de `aviamentos`). Vazio ("" ou só espaço) é sempre `null`. */
export type AviamentoDraft = {
  codigo: string | null;
  codigo_nome: string;
  empresa_id: string | null;
  representante_id: string | null;
  preco: number | null;
  ncm: string | null;
  categoria_aviamento_id: string | null;
  subcategoria_aviamento_id: string | null;
  material_aviamento_id: string | null;
  composicao: string | null;
  intervalo_largura_id: string | null;
  largura_exata: number | null;
  observacoes: string | null;
};

/** Os campos do aviamento que a grade lê (subconjunto do `AviamentoEntrada`/`GradeAviamentoCompleto`). */
export type AviamentoParaDraft = {
  codigo: string | null;
  codigo_nome: string | null;
  empresa_id: string | null;
  representante_id?: string | null;
  preco: number | null;
  ncm: string | null;
  categoria_aviamento_id: string | null;
  subcategoria_aviamento_id: string | null;
  material_aviamento_id: string | null;
  composicao: string | null;
  intervalo_largura_id: string | null;
  largura_exata: number | null;
  observacoes: string | null;
};

/** vazio ("" ou só espaço) = null: o rascunho nunca fica "sujo" por trocar null por "". */
const vazioNulo = (v: string | null | undefined): string | null =>
  v == null || v.trim() === "" ? null : v;
const numeroOuNulo = (v: number | string | null | undefined): number | null =>
  v == null || v === "" ? null : Number(v);

/** Linha do servidor -> rascunho (a base do `useCardDraft`; a tela MEMOIZA o resultado). */
export function aviamentoParaDraft(a: AviamentoParaDraft): AviamentoDraft {
  return {
    codigo: vazioNulo(a.codigo),
    codigo_nome: a.codigo_nome ?? "",
    empresa_id: a.empresa_id ?? null,
    representante_id: a.representante_id ?? null,
    preco: numeroOuNulo(a.preco),
    ncm: vazioNulo(a.ncm),
    categoria_aviamento_id: a.categoria_aviamento_id ?? null,
    subcategoria_aviamento_id: a.subcategoria_aviamento_id ?? null,
    material_aviamento_id: a.material_aviamento_id ?? null,
    composicao: vazioNulo(a.composicao),
    intervalo_largura_id: a.intervalo_largura_id ?? null,
    largura_exata: numeroOuNulo(a.largura_exata),
    observacoes: vazioNulo(a.observacoes),
  };
}

/**
 * Rascunho (só os campos TOCADOS) -> payload do UPDATE de `aviamentos`. Mesmas normalizações da tela de hoje: texto vazio = null,
 * NCM/composição/observações com trim. O nome é opcional (o identificador é o `codigo`): vazio grava "". O CÓDIGO não pode ficar
 * vazio no UPDATE (o gatilho que gera "SIGLA-NNNN" só roda no INSERT; gravar null deixaria o aviamento sem identificador) →
 * `ErroGrade`. Fornecedor e representante andam juntos: tocar um manda os dois (a escolha do `FornecedorSelect` é o PAR).
 */
export function montarPayloadAviamento(
  mudancas: Partial<AviamentoDraft>,
  base: AviamentoDraft,
): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if ("codigo" in mudancas) {
    const c = (mudancas.codigo ?? "").trim();
    if (c === "") throw new ErroGrade("O código não pode ficar vazio.");
    p.codigo = c;
  }
  if ("codigo_nome" in mudancas) p.codigo_nome = (mudancas.codigo_nome ?? "").trim();
  if ("empresa_id" in mudancas || "representante_id" in mudancas) {
    p.empresa_id = ("empresa_id" in mudancas ? mudancas.empresa_id : base.empresa_id) || null;
    p.representante_id =
      ("representante_id" in mudancas ? mudancas.representante_id : base.representante_id) || null;
  }
  if ("preco" in mudancas) p.preco = mudancas.preco ?? null;
  if ("ncm" in mudancas) p.ncm = mudancas.ncm?.trim() || null;
  if ("categoria_aviamento_id" in mudancas)
    p.categoria_aviamento_id = mudancas.categoria_aviamento_id || null;
  if ("subcategoria_aviamento_id" in mudancas)
    p.subcategoria_aviamento_id = mudancas.subcategoria_aviamento_id || null;
  if ("material_aviamento_id" in mudancas)
    p.material_aviamento_id = mudancas.material_aviamento_id || null;
  if ("composicao" in mudancas) p.composicao = mudancas.composicao?.trim() || null;
  if ("intervalo_largura_id" in mudancas)
    p.intervalo_largura_id = mudancas.intervalo_largura_id || null;
  if ("largura_exata" in mudancas) p.largura_exata = mudancas.largura_exata ?? null;
  if ("observacoes" in mudancas) p.observacoes = mudancas.observacoes?.trim() || null;
  return p;
}

/**
 * Texto PT-BR do erro do UPDATE do aviamento. O 23505 vem de DOIS uniques: código-por-loja (`ux_aviamentos_tenant_codigo`) ou
 * nome-por-fornecedor (`uq_aviamento_codigo_fornecedor`) — desambigua pelo nome do índice, como a tela de hoje.
 */
export function mensagemSalvarAviamento(e: unknown): string {
  if ((e as { code?: string } | null)?.code === "23505") {
    const alvo = String((e as any)?.message ?? "") + String((e as any)?.details ?? "");
    return /tenant_codigo/i.test(alvo)
      ? "Este código já está em uso. Escolha outro."
      : "Este nome já existe neste fornecedor.";
  }
  return mensagemErro(e, "Erro ao salvar o aviamento.");
}

/** UPDATE DIRETO do aviamento ("último vence": sem rev). 0 linhas devolvidas = o aviamento sumiu (excluído) ou a loja não o enxerga. */
export async function atualizarAviamento(
  aviamentoId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await (supabase.from("aviamentos") as any)
    .update(payload)
    .eq("id", aviamentoId)
    .select("id");
  if (error) throw new ErroGrade(mensagemSalvarAviamento(error));
  if (!data || data.length === 0) {
    throw new ErroGrade(
      "Este aviamento não foi encontrado (talvez tenha sido excluído por outra pessoa). Recarregue a lista.",
    );
  }
}

// ============================== Variantes (cores) ==============================

/** Rascunho da COR na grade. Cor base e apelido são ids em texto ("" = nenhum): é o formato dos selects. */
export type VarianteDraft = {
  cor_id: string;
  cor_apelido_id: string;
  nome_variante: string | null;
  codigo_variante: string | null;
  preco: number | null;
};

export type VarianteParaDraft = {
  cor_id: string | null;
  cor_apelido_id: string | null;
  nome_variante: string | null;
  codigo_variante: string | null;
  preco: number | null;
};

export function varianteParaDraft(v: VarianteParaDraft): VarianteDraft {
  return {
    cor_id: v.cor_id ?? "",
    cor_apelido_id: v.cor_apelido_id ?? "",
    nome_variante: vazioNulo(v.nome_variante),
    codigo_variante: vazioNulo(v.codigo_variante),
    preco: numeroOuNulo(v.preco),
  };
}

/** A variante como o servidor a tem agora (releitura fresca antes de gravar o lote). */
export type VarianteServidor = {
  id: string;
  cor_id: string | null;
  cor_apelido_id: string | null;
  nome_variante: string | null;
  codigo_variante: string | null;
  preco: number | null;
};

/** O elemento de `_variantes` da RPC `salvar_variantes_aviamento`. */
export type VarianteLote = {
  id: string;
  cor_id: string;
  cor_apelido_id: string | null;
  nome_variante: string | null;
  codigo_variante: string | null;
  preco: number | null;
};

/**
 * Conjunto COMPLETO de variantes do aviamento para a RPC: cada variante que o servidor tem agora (com TODOS os campos dela, para a
 * RPC não zerar nada) com SÓ os campos tocados por cima. Cor que o servidor não tem mais (excluída por outra pessoa) e foi tocada
 * = `ErroGrade` (nada vai); cor que outra pessoa CRIOU depois da carga entra como está (a RPC não a apaga). Cor tocada sem cor base
 * também é recusada (a RPC ignoraria a linha em silêncio).
 */
export function montarConjuntoVariantes(
  frescas: VarianteServidor[],
  mudancasPorId: ReadonlyMap<string, Partial<VarianteDraft>>,
): VarianteLote[] {
  const ids = new Set(frescas.map((v) => v.id));
  for (const id of mudancasPorId.keys()) {
    if (!ids.has(id)) {
      throw new ErroGrade(
        "Uma das cores foi excluída por outra pessoa. Recarreguei a lista — confira e salve de novo.",
      );
    }
  }
  return frescas.map((v) => {
    const m0 = mudancasPorId.get(v.id);
    const m = m0 && Object.keys(m0).length > 0 ? m0 : undefined; // `{}` = nada tocado
    const cor = m && "cor_id" in m ? m.cor_id || null : v.cor_id;
    if (m && !cor) throw new ErroGrade("Escolha a cor base da variante.");
    return {
      id: v.id,
      cor_id: cor as string,
      cor_apelido_id:
        (m && "cor_apelido_id" in m ? m.cor_apelido_id || null : v.cor_apelido_id) ?? null,
      nome_variante: m && "nome_variante" in m ? m.nome_variante?.trim() || null : v.nome_variante,
      codigo_variante:
        m && "codigo_variante" in m ? m.codigo_variante?.trim() || null : v.codigo_variante,
      preco: m && "preco" in m ? (m.preco ?? null) : numeroOuNulo(v.preco),
    };
  });
}

/** Mensagem PT da falha do lote de variantes (23505 aqui = índice único parcial aviamento+cor+apelido). */
export function mensagemSalvarVariantes(e: unknown): string {
  if ((e as { code?: string } | null)?.code === "23505")
    return "Já existe uma variante com essa cor e apelido neste aviamento.";
  return mensagemErro(e, "Erro ao salvar as cores.");
}

/**
 * Salva as cores TOCADAS de UM aviamento numa só chamada: relê as variantes dele no servidor, põe os campos tocados por cima e
 * manda o conjunto completo a `salvar_variantes_aviamento` (atômica; guarda de uso nas cores que sairiam). "Último vence" por aviamento.
 */
export async function salvarLoteVariantes(
  aviamentoId: string,
  itens: { id: string; mudancas: Partial<VarianteDraft> }[],
): Promise<void> {
  const { data, error } = await (supabase.from("variantes_aviamento") as any)
    .select("id,cor_id,cor_apelido_id,nome_variante,codigo_variante,preco")
    .eq("aviamento_id", aviamentoId)
    .order("created_at")
    .order("id");
  if (error) throw new ErroGrade(mensagemSalvarVariantes(error));
  const conjunto = montarConjuntoVariantes(
    (data ?? []) as VarianteServidor[],
    new Map(itens.map((i) => [i.id, i.mudancas])),
  );
  const { error: e2 } = await supabase.rpc(
    "salvar_variantes_aviamento" as any,
    {
      _aviamento_id: aviamentoId,
      _variantes: conjunto,
    } as any,
  );
  if (e2) throw new ErroGrade(mensagemSalvarVariantes(e2));
}

// ============================== UM Salvar (aviamentos → cores, resultado parcial) ==============================

/** Resultado do lote de cores de UM aviamento, repassado a cada cor dele (a cor só rebaseia o rascunho, não chama o servidor). */
export type ResultadoLote = { erro?: unknown };
export type CtxSalvar = { limite?: number; lote?: ResultadoLote };

export type ItemAviamento = {
  id: string;
  dirty: () => boolean;
  salvar: (ctx: CtxSalvar) => Promise<void>;
};
export type ItemVariante = {
  id: string;
  aviamentoId: string;
  dirty: () => boolean;
  /** Só os campos que a pessoa mexeu (rascunho ≠ base). */
  mudancas: () => Partial<VarianteDraft>;
  salvar: (ctx: CtxSalvar) => Promise<void>;
};

export type ResultadoSalvarTudo = { ok: number; erro: number };

/** Texto PT-BR do aviso na linha que não gravou. */
export function textoErroSalvar(e: unknown): string {
  if (e instanceof ErroGrade) return e.message;
  return mensagemErro(e, "Erro ao salvar.");
}

/**
 * UM Salvar: primeiro TODOS os cabeçalhos de aviamento, depois as cores — UMA chamada por aviamento tocado (conjunto completo).
 * PARCIAL: a falha de um aviamento (código duplicado, nome repetido no fornecedor…) ou do lote de cores de um aviamento não derruba
 * os outros — fica sujo, com o aviso na própria linha. Cada cor do lote que gravou só rebaseia o rascunho.
 */
export async function salvarEmOrdem(
  aviamentos: ItemAviamento[],
  variantes: ItemVariante[],
  ctx: { limite?: number } = {},
): Promise<ResultadoSalvarTudo> {
  const r: ResultadoSalvarTudo = { ok: 0, erro: 0 };
  for (const item of aviamentos) {
    if (!item.dirty()) continue;
    try {
      await item.salvar(ctx);
      r.ok++;
    } catch {
      r.erro++;
    }
  }
  const porAviamento = new Map<string, ItemVariante[]>();
  for (const v of variantes) {
    if (!v.dirty()) continue;
    const lista = porAviamento.get(v.aviamentoId);
    if (lista) lista.push(v);
    else porAviamento.set(v.aviamentoId, [v]);
  }
  for (const [aviamentoId, lista] of porAviamento) {
    const lote: ResultadoLote = {};
    try {
      await salvarLoteVariantes(
        aviamentoId,
        lista.map((v) => ({ id: v.id, mudancas: v.mudancas() })),
      );
    } catch (e) {
      lote.erro = e;
    }
    for (const v of lista) {
      try {
        await v.salvar({ ...ctx, lote });
        r.ok++;
      } catch {
        r.erro++;
      }
    }
  }
  return r;
}

/** Texto do toast do Salvar ("3 salvos, 1 com erro"). `tom` diz qual toast usar. */
export function textoResultadoSalvar(r: ResultadoSalvarTudo): {
  tom: "sucesso" | "aviso" | "erro";
  texto: string;
} {
  const partes: string[] = [];
  if (r.ok > 0) partes.push(`${r.ok} ${r.ok === 1 ? "salvo" : "salvos"}`);
  if (r.erro > 0) partes.push(`${r.erro} com erro`);
  if (partes.length === 0) return { tom: "aviso", texto: "Nada para salvar." };
  const texto = `${partes.join(", ")}.`;
  if (r.erro === 0) return { tom: "sucesso", texto };
  return { tom: r.ok > 0 ? "aviso" : "erro", texto: `${texto} Veja o aviso na linha.` };
}
