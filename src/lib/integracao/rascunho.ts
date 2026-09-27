// Integração — rascunho POR PRODUTO da aba Produtos (staging: nada grava antes do Salvar). PURO. As 12 colunas são as do
// CARD (mão dupla — a tela nunca tem cópia própria); o merge com o servidor é o 3-vias do sistema (base/draft/fresh/tocados,
// @/lib/colab/merge). Foto nova = marcador "novo:<id>" na posição dela (o upload só acontece no Salvar — Task 11). SKU à mão
// = o MESMO "a gravar" da seção Códigos (sku-previa.ts), gravado no passo 3 do Salvar.
//
// Ruling G1 (task-10-report.md, revisto no fix round 1): titulo_pagina/preco_anterior NULL = AUTOMÁTICO.
//
// Fix round 1 (task-10-review.md):
// - Important #1 (título): a regra "digitar igual ao automático mantém NULL" pertence a ESTA task (não a Task
//   11/12, como a v1 deste arquivo deferia sem ruling). Reusa os helpers PRONTOS do Sheet
//   (`tituloAoDigitar`/`tituloAoSair`/`tituloPaginaCalculado`, `src/lib/titulo-pagina.ts`) — sem reimplementar a
//   regra aqui. MUDANÇA DE INTERFACE (documentada para Task 11/12 poderem plugar): `Rascunho` ganhou o campo
//   `nomeLoja: string | null` (a marca da loja, `tenants.nome` — a MESMA fonte que `_titulo_pagina_calculado` usa
//   no servidor); `novoRascunho(p, nomeLoja)` e `mesclar(r, p, nomeLoja?)` passam a receber esse parâmetro (em
//   `mesclar`, omitir mantém o `nomeLoja` que já estava no rascunho — o nome da loja não muda entre um merge e
//   outro). Duas funções NOVAS espelham o onChange/onBlur do campo no Sheet: `editarTitulo(r, digitado)` (a cada
//   tecla, `tituloAoDigitar`) e `sairTitulo(r)` (ao perder o foco, `tituloAoSair` — normaliza espaço nas pontas e
//   "digitou igual ao automático com espaço a mais" de volta pra NULL). Renomear o produto (`editar(r,"nome",v)`)
//   NÃO toca `titulo_pagina` — se já é NULL (automático), continua NULL (o automático é recalculado AO VIVO na
//   exibição via `tituloPaginaCalculado(novoNome, nomeLoja)`, nunca gravado); se é manual, fica como está (mesmo
//   comportamento do Sheet: só o próprio campo Título decide quando volta a ser automático).
// - Important #2 (preço zero/negativo): `payloadItem` agora espelha o Sheet — `preco_anterior` via
//   `precoAnteriorOuNull` (vazio/0/negativo = NULL = automático, `planejamento-detail/helpers.ts`) e `preco_venda`
//   via `v > 0 ? v : null` (o MESMO padrão do Sheet, `PlanejamentoDetail.tsx:1705`, `numOr0(v) > 0 ? … : null` —
//   nunca manda 0). Crítico no SQL real (`integracao_salvar` m5): `preco_venda=0` num produto revenda/importado
//   chega em `salvar_precos_fixo_produto_acabado/_importado`, que RAISE P0001 "O preço precisa ser maior que
//   zero." para qualquer valor NÃO-NULL ≤ 0 — e por não ter savepoint nem catch, aborta o LOTE inteiro de até 50
//   produtos do `integracao_salvar`. Mandar NULL em vez de 0 é a única forma de "sem preço"/"volta a derivar do
//   markup" que a função aceita sem RAISE.
// - Minor #2: `colunasAlteradas` compara valores NORMALIZADOS (não crus) — texto aparado (`nome`/`ref`) e
//   texto-ou-null aparado (`ncm`/`titulo_pagina`/`descricao_produto`) evitam falso "alterado" por só espaço extra
//   ou `null` vs `""` (mesmo padrão de `normalizarDraftSalvo`/`textoOuNull` do Sheet).
// - Minor #3: `payloadItem`/`aposSalvar` NUNCA descartam foto nova em silêncio — se há `fotosNovas` pendentes e o
//   chamador não informa o resultado do upload (`fotosFinais`/`o.fotos`), a função lança (falha alto e cedo, em
//   vez de perder a foto silenciosamente numa Task 11 futura que esqueça o parâmetro).
// - Minor #5: `mesclar` também derruba um conflito ANTIGO cujo valor já bate com o novo `fresh` (o servidor
//   convergiu pro meu valor entretanto) — sem isso, um conflito resolvido "por fora" (ex.: outra aba salvou
//   exatamente o que eu tinha) ficava preso pra sempre, porque a 2ª chamada de `mergeDraft` não o re-emite nem o
//   remove por si (ele só emite conflito quando HÁ divergência NOVA entre base e fresh).
import { igual, mergeDraft, type Conflito } from "@/lib/colab/merge";
import type { ColunaEditavel } from "@/lib/integracao/campos";
import type { ProdutoLista, RawProduto, Sublinha } from "@/lib/integracao/produtos";
import { precoAnteriorOuNull } from "@/components/planejamento/planejamento-detail/helpers";
import { tituloAoDigitar, tituloAoSair, tituloPaginaCalculado } from "@/lib/titulo-pagina";
import {
  SKUS_A_GRAVAR_VAZIO,
  nadaAGravar,
  type SkusAGravar,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import type { LinhaSku } from "@/components/planejamento/planejamento-detail/codigos/sku-card";

export type Valores = Omit<RawProduto, "tamanho_tipo">;
export const COLUNAS: readonly ColunaEditavel[] = [
  "nome",
  "ref",
  "preco_anterior",
  "preco_venda",
  "peso_kg",
  "ncm",
  "titulo_pagina",
  "descricao_produto",
  "comprimento_cm",
  "largura_cm",
  "altura_cm",
  "fotos_modelo",
];
export const PREFIXO_FOTO_NOVA = "novo:";
export type FotoNova = { id: string; file: File };
export type Rascunho = {
  modeloId: string;
  nome: string;
  rev: number;
  tamanhoTipo: "letra" | "numero" | null;
  /** Ruling 1 do fix round 1: a marca da loja (`tenants.nome`) — necessária pro Título automático
   *  (`tituloPaginaCalculado`). Vem de fora (a tela lê de `integracao_config_ler`/outra fonte; `integracao_listar`
   *  não manda `tenants.nome`). `null` enquanto ainda não carregou (mesmo contrato do `nomeLoja` do Sheet). */
  nomeLoja: string | null;
  base: Valores;
  valores: Valores;
  tocados: ReadonlySet<ColunaEditavel>;
  fotosNovas: FotoNova[];
  skus: SkusAGravar;
  conflitos: Conflito[];
};
export type ItemSalvar = {
  modelo_id: string;
  rev: number;
  campos: Partial<Record<ColunaEditavel, string | number | string[] | null>>;
};

export function valoresDoRaw(raw: RawProduto): Valores {
  return {
    nome: raw.nome,
    ref: raw.ref,
    preco_anterior: raw.preco_anterior,
    preco_venda: raw.preco_venda,
    peso_kg: raw.peso_kg,
    ncm: raw.ncm,
    titulo_pagina: raw.titulo_pagina,
    descricao_produto: raw.descricao_produto,
    comprimento_cm: raw.comprimento_cm,
    largura_cm: raw.largura_cm,
    altura_cm: raw.altura_cm,
    fotos_modelo: [...raw.fotos_modelo],
  };
}
/** `nomeLoja`: mudança de interface do fix round 1 (Important #1) — a tela (Task 11/12) passa `tenants.nome`. */
export function novoRascunho(p: ProdutoLista, nomeLoja: string | null): Rascunho {
  const v = valoresDoRaw(p.raw);
  return {
    modeloId: p.modeloId,
    nome: p.raw.nome,
    rev: p.rev,
    tamanhoTipo: p.raw.tamanho_tipo,
    nomeLoja,
    base: v,
    valores: { ...v, fotos_modelo: [...v.fotos_modelo] },
    tocados: new Set(),
    fotosNovas: [],
    skus: SKUS_A_GRAVAR_VAZIO,
    conflitos: [],
  };
}
export function editar<K extends ColunaEditavel>(
  r: Rascunho,
  coluna: K,
  valor: Valores[K],
): Rascunho {
  const tocados = new Set(r.tocados);
  tocados.add(coluna);
  return {
    ...r,
    valores: { ...r.valores, [coluna]: valor },
    tocados,
    conflitos: r.conflitos.filter((c) => c.path !== coluna),
  };
}
/** Título calculado AO VIVO (nunca gravado) a partir do Nome do RASCUNHO + nome da loja — o mesmo par que o Sheet
 *  usa (`InfoGeraisSecao.tsx`: `tituloPaginaCalculado(draft.nome, nomeLoja)`). */
export const tituloCalculadoDoRascunho = (r: Rascunho): string =>
  tituloPaginaCalculado(r.valores.nome, r.nomeLoja);
/** Important #1 — onChange do campo Título: `tituloAoDigitar` (digitar igual ao automático mantém/volta a NULL). */
export const editarTitulo = (r: Rascunho, digitado: string): Rascunho =>
  editar(r, "titulo_pagina", tituloAoDigitar(digitado, tituloCalculadoDoRascunho(r)));
/** Important #1 — onBlur do campo Título: `tituloAoSair` (só espaço, ou aparado == automático, volta a NULL). */
export const sairTitulo = (r: Rascunho): Rascunho =>
  editar(r, "titulo_pagina", tituloAoSair(r.valores.titulo_pagina, tituloCalculadoDoRascunho(r)));
export function adicionarFotos(r: Rascunho, novas: FotoNova[]): Rascunho {
  if (novas.length === 0) return r;
  return editar({ ...r, fotosNovas: [...r.fotosNovas, ...novas] }, "fotos_modelo", [
    ...r.valores.fotos_modelo,
    ...novas.map((n) => PREFIXO_FOTO_NOVA + n.id),
  ]);
}
export function removerFoto(r: Rascunho, item: string): Rascunho {
  const fotosNovas = r.fotosNovas.filter((n) => PREFIXO_FOTO_NOVA + n.id !== item);
  return editar(
    { ...r, fotosNovas },
    "fotos_modelo",
    r.valores.fotos_modelo.filter((f) => f !== item),
  );
}
const TEXTO_OU_NULL: ReadonlySet<ColunaEditavel> = new Set([
  "ncm",
  "titulo_pagina",
  "descricao_produto",
]);
/** Minor #2 — valor NORMALIZADO pra fim de comparação de alteração (não altera o que fica no rascunho, só o que
 *  `colunasAlteradas` compara): texto aparado; `nome`/`ref` nunca viram NULL (o servidor recusa vazio, mas aqui é
 *  só igualdade — comparar "" com "" já funciona); os 3 texto-ou-null tratam NULL/""/"  " como o MESMO valor. */
function normalizado(coluna: ColunaEditavel, v: unknown): unknown {
  if (coluna === "nome" || coluna === "ref") return typeof v === "string" ? v.trim() : v;
  if (TEXTO_OU_NULL.has(coluna)) {
    const s = typeof v === "string" ? v.trim() : v;
    return s === "" || s === null || s === undefined ? null : s;
  }
  return v;
}
export const colunasAlteradas = (r: Rascunho): ColunaEditavel[] =>
  COLUNAS.filter((c) => !igual(normalizado(c, r.valores[c]), normalizado(c, r.base[c])));
export const temAlteracao = (r: Rascunho): boolean =>
  colunasAlteradas(r).length > 0 || !nadaAGravar(r.skus);
export const comSkus = (r: Rascunho, skus: SkusAGravar): Rascunho => ({ ...r, skus });

/** Chegou versão nova do servidor (rev diferente): merge 3-vias — não tocado segue o servidor; tocado e mudado lá = conflito.
 *  `nomeLoja` opcional (Important #1): omitir mantém o que já estava no rascunho (o nome da loja não muda entre merges). */
export function mesclar(r: Rascunho, p: ProdutoLista, nomeLoja?: string | null): Rascunho {
  if (p.rev === r.rev) return r;
  const fresh = valoresDoRaw(p.raw);
  const m = mergeDraft({
    base: r.base,
    draft: r.valores,
    fresh,
    touched: r.tocados as ReadonlySet<string>,
  });
  // Minor #5: um conflito ANTIGO (de um merge anterior) cujo valor no rascunho já bate com o `fresh` de AGORA
  // convergiu por fora (ex.: outra aba salvou exatamente o que eu tinha) — não fica preso pra sempre; `mergeDraft`
  // só reemite/remove um path que TEM divergência nova entre base/fresh, então um conflito já resolvido desse
  // jeito precisa ser dropado aqui, fora do resultado do merge.
  const antigosVivos = r.conflitos.filter(
    (c) =>
      !m.conflitos.some((n) => n.path === c.path) &&
      !igual(m.valor[c.path as keyof Valores], fresh[c.path as keyof Valores]),
  );
  const conflitos = [...antigosVivos, ...m.conflitos];
  return {
    ...r,
    rev: p.rev,
    nome: p.raw.nome,
    tamanhoTipo: p.raw.tamanho_tipo,
    nomeLoja: nomeLoja ?? r.nomeLoja,
    base: fresh,
    valores: m.valor,
    conflitos,
  };
}
export const manterMeu = (r: Rascunho, path: string): Rascunho => ({
  ...r,
  conflitos: r.conflitos.filter((c) => c.path !== path),
});
export function usarNovo(r: Rascunho, path: string): Rascunho {
  const k = path as ColunaEditavel;
  const tocados = new Set(r.tocados);
  tocados.delete(k);
  return {
    ...r,
    valores: { ...r.valores, [k]: r.base[k] },
    tocados,
    fotosNovas: k === "fotos_modelo" ? [] : r.fotosNovas,
    conflitos: r.conflitos.filter((c) => c.path !== path),
  };
}

/** Item do `integracao_salvar`: só as colunas alteradas (as ausentes não gravam). SKU NÃO vai aqui (passo 3).
 *  Important #2 — `preco_anterior`/`preco_venda` NUNCA mandam 0/negativo: o servidor aceita `>= 0` na validação
 *  genérica de `integracao_salvar`, mas `preco_venda` de revenda/importado é repassado a
 *  `salvar_precos_fixo_produto_acabado/_importado`, que RAISE P0001 pra qualquer valor NÃO-NULL `<= 0` — e aborta
 *  o LOTE inteiro (sem savepoint). NULL é a única codificação de "sem preço"/"automático" que não estoura.
 *  Minor #3 — foto nova pendente exige `fotosFinais` (lança em vez de perder a foto em silêncio). */
export function payloadItem(r: Rascunho, fotosFinais?: string[]): ItemSalvar | null {
  if (r.fotosNovas.length > 0 && fotosFinais === undefined && r.tocados.has("fotos_modelo")) {
    throw new Error(
      "payloadItem: há fotos novas pendentes de upload — informe fotosFinais (Task 11).",
    );
  }
  const cols = colunasAlteradas(r);
  if (cols.length === 0) return null;
  const campos: ItemSalvar["campos"] = {};
  for (const c of cols) {
    const v = r.valores[c];
    if (c === "fotos_modelo")
      campos.fotos_modelo =
        fotosFinais ?? r.valores.fotos_modelo.filter((f) => !f.startsWith(PREFIXO_FOTO_NOVA));
    else if (c === "nome" || c === "ref") campos[c] = String(v ?? "").trim();
    else if (c === "preco_anterior") campos.preco_anterior = precoAnteriorOuNull(v);
    else if (c === "preco_venda")
      campos.preco_venda = typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    else if (TEXTO_OU_NULL.has(c)) campos[c] = String(v ?? "").trim() || null;
    else campos[c] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return { modelo_id: r.modeloId, rev: r.rev, campos };
}
/** Depois do Salvar: o que gravou vira a base; sobra rascunho SÓ se os SKUs "a gravar" não gravaram (passo 3).
 *  Minor #3 — se há `fotosNovas` pendentes, `o.fotos` é obrigatório (senão o rascunho perderia a foto sem avisar). */
export function aposSalvar(
  r: Rascunho,
  o: { rev?: number; fotos?: string[]; skusGravados: boolean },
): Rascunho | null {
  if (r.fotosNovas.length > 0 && o.fotos === undefined) {
    throw new Error("aposSalvar: há fotos novas pendentes de upload — informe o.fotos (Task 11).");
  }
  if (o.skusGravados || nadaAGravar(r.skus)) return null;
  const valores: Valores = {
    ...r.valores,
    fotos_modelo: o.fotos ?? r.valores.fotos_modelo.filter((f) => !f.startsWith(PREFIXO_FOTO_NOVA)),
  };
  return {
    ...r,
    rev: o.rev ?? r.rev,
    base: valores,
    valores: { ...valores },
    tocados: new Set(),
    fotosNovas: [],
    conflitos: [],
  };
}
/** A sublinha da lista no formato da seção Códigos (digitarSku/skuExibido/situacaoPrevia leem este shape). */
export function linhaSkuDaSublinha(s: Sublinha): LinhaSku {
  return {
    variante_key: s.varianteKey,
    variante_ordem: s.varianteOrdem,
    cor_nome: s.corNome,
    apelido_nome: s.apelidoNome,
    tamanho_key: s.tamanhoKey,
    tamanho_ordem: s.tamanhoOrdem,
    id: s.skuId,
    sku: s.sku,
    manual: s.manual,
    rev: s.skuRev,
    sku_previsto: null,
    faltas: [],
    avisos: [],
    conflito_com: null,
    estado: s.sku ? (s.manual ? "manual" : "ok") : "vazio",
  };
}
