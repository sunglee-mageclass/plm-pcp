// Integração — decisão PURA de cada célula da aba Produtos: editar ou só ler (e por quê) + o "i" de quem edita. Os gates
// vêm do servidor (D24); aqui só a ordem: estado (trava) → só leitura por natureza (P-80 A) → gate → salvando.
import type { CampoDef } from "@/lib/integracao/campos";
import type { ProdutoLista } from "@/lib/integracao/produtos";

export type ModoCelula = { tipo: "editar" } | { tipo: "leitura"; motivo: string | null; travado: boolean };
export const TEXTO_TRAVADO_INTEGRAVEL = "Integrável — travado. Volte para não integrável para editar.";
export const TEXTO_TRAVADO_INTEGRADO = "Integrado — travado. Só o super admin desfaz a integração.";

export function modoCelula(campo: CampoDef, p: ProdutoLista, salvando: boolean): ModoCelula {
  if (p.estado !== "nao_integravel") {
    return { tipo: "leitura", motivo: p.estado === "integrado" ? TEXTO_TRAVADO_INTEGRADO : TEXTO_TRAVADO_INTEGRAVEL, travado: true };
  }
  if (campo.tipo === "somente_leitura" || campo.key === "metatag" || campo.key === "keywords" || !campo.gate) {
    return { tipo: "leitura", motivo: null, travado: false };
  }
  const g = p.gates[campo.gate];
  if (!g.ok) return { tipo: "leitura", motivo: g.motivo, travado: false };
  if (salvando) return { tipo: "leitura", motivo: "Salvando…", travado: false };
  return { tipo: "editar" };
}

export function infoEdicao(campo: CampoDef, p: ProdutoLista): string | null {
  if (campo.key === "ref_sku") {
    if (p.origem === "revenda") return "REF da revenda: nasce no cadastro do Produto Acabado; editar aqui muda nos dois lugares (mão dupla).";
    if (p.origem === "importado") return "REF do importado: nasce no cadastro do Produto Importado; editar aqui muda nos dois lugares (mão dupla).";
    return "REF manual liberada (etapa já revela a REF neste card) — editar aqui edita o card também.";
  }
  if (campo.key === "preco_venda" && p.origem === "revenda") return 'Grava como preço FIXO de revenda (mesma regra do card — "última edição manda").';
  if (campo.key === "preco_venda" && p.origem === "importado") return 'Grava como preço FIXO do importado (mesma regra do card — "última edição manda").';
  if (campo.key === "foto") return "As fotos novas só sobem no Salvar da página.";
  return null;
}
