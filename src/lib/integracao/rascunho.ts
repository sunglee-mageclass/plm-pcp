// Integração — rascunho POR PRODUTO da aba Produtos (staging: nada grava antes do Salvar). PURO. As 12 colunas são as do
// CARD (mão dupla — a tela nunca tem cópia própria); o merge com o servidor é o 3-vias do sistema (base/draft/fresh/tocados,
// @/lib/colab/merge). Foto nova = marcador "novo:<id>" na posição dela (o upload só acontece no Salvar — Task 11). SKU à mão
// = o MESMO "a gravar" da seção Códigos (sku-previa.ts), gravado no passo 3 do Salvar.
//
// Ruling G1 (task-10-report.md): titulo_pagina/preco_anterior NULL = AUTOMÁTICO. `editar(r, coluna, valor)` já é
// genérico o bastante — gravar `null` nesses 2 campos simplesmente registra a intenção "voltar ao automático", sem
// tratamento especial: o `payloadItem` manda `null` como qualquer outro texto/número vazio (o servidor interpreta
// NULL nessas 2 colunas como automático — ver _integracao_retrato_core). Não há aqui a regra "digitar o mesmo texto
// do automático mantém NULL" do Título do Sheet (`tituloAoDigitar`/`tituloAoSair`, `src/lib/titulo-pagina.ts`) nem
// um equivalente para o preço anterior — o Sheet (`precoAnteriorOuNull`, planejamento-detail/helpers.ts) só tem
// "vazio/0/negativo = NULL", sem comparar com o valor efetivo calculado. A tela (Task 11+) decide se replica a
// comparação com o automático ao vivo; aqui o contrato é só "limpar o campo grava NULL".
import { igual, mergeDraft, type Conflito } from "@/lib/colab/merge";
import type { ColunaEditavel } from "@/lib/integracao/campos";
import type { ProdutoLista, RawProduto, Sublinha } from "@/lib/integracao/produtos";
import {
  SKUS_A_GRAVAR_VAZIO, nadaAGravar, type SkusAGravar,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import type { LinhaSku } from "@/components/planejamento/planejamento-detail/codigos/sku-card";

export type Valores = Omit<RawProduto, "tamanho_tipo">;
export const COLUNAS: readonly ColunaEditavel[] = [
  "nome", "ref", "preco_anterior", "preco_venda", "peso_kg", "ncm", "titulo_pagina", "descricao_produto",
  "comprimento_cm", "largura_cm", "altura_cm", "fotos_modelo",
];
export const PREFIXO_FOTO_NOVA = "novo:";
export type FotoNova = { id: string; file: File };
export type Rascunho = {
  modeloId: string; nome: string; rev: number; tamanhoTipo: "letra" | "numero";
  base: Valores; valores: Valores; tocados: ReadonlySet<ColunaEditavel>;
  fotosNovas: FotoNova[]; skus: SkusAGravar; conflitos: Conflito[];
};
export type ItemSalvar = {
  modelo_id: string; rev: number; campos: Partial<Record<ColunaEditavel, string | number | string[] | null>>;
};

export function valoresDoRaw(raw: RawProduto): Valores {
  return {
    nome: raw.nome, ref: raw.ref, preco_anterior: raw.preco_anterior, preco_venda: raw.preco_venda, peso_kg: raw.peso_kg,
    ncm: raw.ncm, titulo_pagina: raw.titulo_pagina, descricao_produto: raw.descricao_produto, comprimento_cm: raw.comprimento_cm,
    largura_cm: raw.largura_cm, altura_cm: raw.altura_cm, fotos_modelo: [...raw.fotos_modelo],
  };
}
export function novoRascunho(p: ProdutoLista): Rascunho {
  const v = valoresDoRaw(p.raw);
  return {
    modeloId: p.modeloId, nome: p.raw.nome, rev: p.rev, tamanhoTipo: p.raw.tamanho_tipo, base: v,
    valores: { ...v, fotos_modelo: [...v.fotos_modelo] }, tocados: new Set(), fotosNovas: [], skus: SKUS_A_GRAVAR_VAZIO,
    conflitos: [],
  };
}
export function editar<K extends ColunaEditavel>(r: Rascunho, coluna: K, valor: Valores[K]): Rascunho {
  const tocados = new Set(r.tocados);
  tocados.add(coluna);
  return { ...r, valores: { ...r.valores, [coluna]: valor }, tocados, conflitos: r.conflitos.filter((c) => c.path !== coluna) };
}
export function adicionarFotos(r: Rascunho, novas: FotoNova[]): Rascunho {
  if (novas.length === 0) return r;
  return editar({ ...r, fotosNovas: [...r.fotosNovas, ...novas] }, "fotos_modelo",
    [...r.valores.fotos_modelo, ...novas.map((n) => PREFIXO_FOTO_NOVA + n.id)]);
}
export function removerFoto(r: Rascunho, item: string): Rascunho {
  const fotosNovas = r.fotosNovas.filter((n) => PREFIXO_FOTO_NOVA + n.id !== item);
  return editar({ ...r, fotosNovas }, "fotos_modelo", r.valores.fotos_modelo.filter((f) => f !== item));
}
export const colunasAlteradas = (r: Rascunho): ColunaEditavel[] => COLUNAS.filter((c) => !igual(r.valores[c], r.base[c]));
export const temAlteracao = (r: Rascunho): boolean => colunasAlteradas(r).length > 0 || !nadaAGravar(r.skus);
export const comSkus = (r: Rascunho, skus: SkusAGravar): Rascunho => ({ ...r, skus });

/** Chegou versão nova do servidor (rev diferente): merge 3-vias — não tocado segue o servidor; tocado e mudado lá = conflito. */
export function mesclar(r: Rascunho, p: ProdutoLista): Rascunho {
  if (p.rev === r.rev) return r;
  const fresh = valoresDoRaw(p.raw);
  const m = mergeDraft({ base: r.base, draft: r.valores, fresh, touched: r.tocados as ReadonlySet<string> });
  const conflitos = [...r.conflitos.filter((c) => !m.conflitos.some((n) => n.path === c.path)), ...m.conflitos];
  return { ...r, rev: p.rev, nome: p.raw.nome, tamanhoTipo: p.raw.tamanho_tipo, base: fresh, valores: m.valor, conflitos };
}
export const manterMeu = (r: Rascunho, path: string): Rascunho => ({ ...r, conflitos: r.conflitos.filter((c) => c.path !== path) });
export function usarNovo(r: Rascunho, path: string): Rascunho {
  const k = path as ColunaEditavel;
  const tocados = new Set(r.tocados);
  tocados.delete(k);
  return {
    ...r, valores: { ...r.valores, [k]: r.base[k] }, tocados, fotosNovas: k === "fotos_modelo" ? [] : r.fotosNovas,
    conflitos: r.conflitos.filter((c) => c.path !== path),
  };
}

const TEXTO_OU_NULL: ReadonlySet<ColunaEditavel> = new Set(["ncm", "titulo_pagina", "descricao_produto"]);
/** Item do `integracao_salvar`: só as colunas alteradas (as ausentes não gravam). SKU NÃO vai aqui (passo 3). */
export function payloadItem(r: Rascunho, fotosFinais?: string[]): ItemSalvar | null {
  const cols = colunasAlteradas(r);
  if (cols.length === 0) return null;
  const campos: ItemSalvar["campos"] = {};
  for (const c of cols) {
    const v = r.valores[c];
    if (c === "fotos_modelo") campos.fotos_modelo = fotosFinais ?? r.valores.fotos_modelo.filter((f) => !f.startsWith(PREFIXO_FOTO_NOVA));
    else if (c === "nome" || c === "ref") campos[c] = String(v ?? "").trim();
    else if (TEXTO_OU_NULL.has(c)) campos[c] = String(v ?? "").trim() || null;
    else campos[c] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return { modelo_id: r.modeloId, rev: r.rev, campos };
}
/** Depois do Salvar: o que gravou vira a base; sobra rascunho SÓ se os SKUs "a gravar" não gravaram (passo 3). */
export function aposSalvar(r: Rascunho, o: { rev?: number; fotos?: string[]; skusGravados: boolean }): Rascunho | null {
  if (o.skusGravados || nadaAGravar(r.skus)) return null;
  const valores: Valores = { ...r.valores, fotos_modelo: o.fotos ?? r.valores.fotos_modelo.filter((f) => !f.startsWith(PREFIXO_FOTO_NOVA)) };
  return { ...r, rev: o.rev ?? r.rev, base: valores, valores: { ...valores }, tocados: new Set(), fotosNovas: [], conflitos: [] };
}
/** A sublinha da lista no formato da seção Códigos (digitarSku/skuExibido/situacaoPrevia leem este shape). */
export function linhaSkuDaSublinha(s: Sublinha): LinhaSku {
  return {
    variante_key: s.varianteKey, variante_ordem: s.varianteOrdem, cor_nome: s.corNome, apelido_nome: s.apelidoNome,
    tamanho_key: s.tamanhoKey, tamanho_ordem: s.tamanhoOrdem, id: s.skuId, sku: s.sku, manual: s.manual, rev: s.skuRev,
    sku_previsto: null, faltas: [], avisos: [], conflito_com: null, estado: s.sku ? (s.manual ? "manual" : "ok") : "vazio",
  };
}
