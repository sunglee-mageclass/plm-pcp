// Funções PURAS de agrupamento da grade de Insumos (sem React, sem Supabase) — testáveis em unit.
// Espelha `agruparAviamentoGrade.ts`, com a DIFERENÇA CENTRAL do insumo (decisão do dono): no banco a variante é (cor, tamanho),
// mas a grade tem 1 LINHA POR COR — 1 preço por cor e os TAMANHOS numa célula de multi-check. Por isso o agrupamento vai além de
// "por etiqueta": agrupa as variantes por etiqueta E por cor em BLOCOS `{cor_id, preco, tamanhos}` (o mesmo `CorBlock` do editor do Sheet).

/** Variante do insumo como a grade a lê (`variantes_etiqueta`). Sem apelido, sem foto, sem nome/código de variante. */
export type GradeVarianteInsumo = {
  id: string;
  etiqueta_id: string;
  cor_id: string | null;
  /** Chave da grade da loja ("40|M") ou null (variante só da cor, sem tamanho). */
  tamanho: string | null;
  preco: number | null;
  created_at: string;
};

/**
 * 1 linha da grade = 1 COR do insumo. `cor_id === ""` é "sem cor" (variante com `cor_id` null) — mesma convenção do editor do Sheet
 * (`CorBlock`), cujo Salvar grava `cor_id || null`. `tamanhos` = chaves "num|sigla" marcadas (vazio = variante só da cor).
 */
export type BlocoCorInsumo = { cor_id: string; preco: number | null; tamanhos: string[] };

/** Insumo (`etiquetas`) com os campos de cabeçalho editáveis na grade. Sem `rev` (o insumo não tem trava otimista por versão). */
export type GradeInsumoCompleto = {
  id: string;
  nome: string;
  /** unidade | metro | rolo | milheiro. */
  unidade: string;
  preco: number | null;
  empresa_id: string | null;
  representante_id: string | null;
  observacoes: string | null;
  /** ambos | numero | letra | nenhum. */
  formato_tamanho: string;
  /** FK `tipos_insumo` (o insumo NÃO tem categoria/subcategoria). */
  tipo_insumo_id: string | null;
  /** Vínculo a UM tamanho (urg R1): chave exata de `tamanhos_grade`; só vale em insumo sem tamanho próprio (ver `insumo-tamanho.ts`). */
  tamanho_vinculado: string | null;
  created_at: string;
};

/** Tamanhos da grade da loja quando `tenant_config.tamanhos_grade` está ausente/vazio (mesmo padrão da tela de Insumos de hoje). */
export const TAMANHOS_GRADE_PADRAO: readonly string[] = [
  "34|PPP",
  "36|PP",
  "38|P",
  "40|M",
  "42|G",
  "44|GG",
];

/**
 * `tenant_config.tamanhos_grade` (jsonb) → lista de chaves. Aceita string ou objeto `{nome|label}` (formatos antigos); lista
 * ausente, vazia ou que não seja array = o PADRÃO da loja nova. Mesma regra da query `["tenant-tamanhos-grade"]` da tela de hoje.
 */
export function normalizarTamanhosGrade(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...TAMANHOS_GRADE_PADRAO];
  return raw.map((x) => {
    if (typeof x === "string") return x;
    const o = x as { nome?: unknown; label?: unknown } | null;
    const t = o?.nome ?? o?.label;
    return t != null ? String(t) : String(x);
  });
}

/** Linha crua de `etiquetas` → insumo da grade (aplica os mesmos defaults da tela de Insumos: unidade "unidade", formato "ambos"). */
export function normalizarEtiquetaGrade(r: Record<string, unknown>): GradeInsumoCompleto {
  return {
    id: r.id as string,
    nome: (r.nome as string | null) ?? "",
    unidade: (r.unidade as string | null) ?? "unidade",
    preco: (r.preco as number | null) ?? null,
    empresa_id: (r.empresa_id as string | null) ?? null,
    representante_id: (r.representante_id as string | null) ?? null,
    observacoes: (r.observacoes as string | null) ?? null,
    formato_tamanho: (r.formato_tamanho as string | null) ?? "ambos",
    tipo_insumo_id: (r.tipo_insumo_id as string | null) ?? null,
    tamanho_vinculado: (r.tamanho_vinculado as string | null) ?? null,
    created_at: (r.created_at as string | null) ?? "",
  };
}

/**
 * Agrupa as variantes de UM insumo por cor (ordem de 1ª aparição; a query ordena por created_at, id). Regras (as do `openEdit` do Sheet):
 *  • `cor_id` null vira o bloco "" ("sem cor");
 *  • `preco` = o da 1ª variante da cor; se ela não tem preço, o da 1ª que tiver (como o editor do Sheet);
 *  • `tamanhos` = o tamanho não vazio de cada variante da cor, sem repetir, na ordem de entrada.
 */
export function blocosDoInsumo(variantes: GradeVarianteInsumo[]): BlocoCorInsumo[] {
  const porCor = new Map<string, BlocoCorInsumo>();
  for (const v of variantes) {
    const chave = v.cor_id ?? "";
    let bloco = porCor.get(chave);
    if (!bloco) {
      bloco = { cor_id: chave, preco: v.preco ?? null, tamanhos: [] };
      porCor.set(chave, bloco);
    }
    if (v.tamanho && !bloco.tamanhos.includes(v.tamanho)) bloco.tamanhos.push(v.tamanho);
    if (bloco.preco == null && v.preco != null) bloco.preco = v.preco;
  }
  return [...porCor.values()];
}

/**
 * Agrupa TODAS as variantes por etiqueta e, dentro dela, por cor. Etiqueta sem variantes fica ausente do Map
 * (a grade a mostra como 1 linha "sem cor").
 */
export function agruparInsumoGrade(
  variantes: GradeVarianteInsumo[],
): Map<string, BlocoCorInsumo[]> {
  const porEtiqueta = new Map<string, GradeVarianteInsumo[]>();
  for (const v of variantes) {
    const lista = porEtiqueta.get(v.etiqueta_id);
    if (lista) lista.push(v);
    else porEtiqueta.set(v.etiqueta_id, [v]);
  }
  const mapa = new Map<string, BlocoCorInsumo[]>();
  for (const [etiquetaId, lista] of porEtiqueta) mapa.set(etiquetaId, blocosDoInsumo(lista));
  return mapa;
}
