// Identidade ESTÁVEL de uma variante dentro do Armário (vitrine). Lib pura, sem I/O.
// Espelha o índice único de `armario_itens` (NULLS NOT DISTINCT) e a RPC de "já em outro armário".
// NUNCA usar "ordem/posição da variante" como identidade.
import { corApelidoLabel } from "@/lib/variante";

export type ArmarioOrigem = "interno" | "revenda" | "importado";

/** Campos de identidade de um item de armário (qualquer origem). */
export interface ArmarioItemIdentidade {
  modelo_id: string | null;
  /** Ponteiro nativo do produto interno (variantes_tecido). */
  variante_tecido_id?: string | null;
  /** Ponteiro nativo de revenda/importado (produto_variantes). */
  produto_variante_id?: string | null;
  cor_id?: string | null;
  cor_apelido_id?: string | null;
}

export interface ArmarioItemRotulo extends ArmarioItemIdentidade {
  /** Nomes do cadastro VIVO (resolvidos pelo chamador). */
  cor_nome?: string | null;
  cor_apelido_nome?: string | null;
  /** true quando a cor foi excluída do cadastro depois de entrar no armário. */
  cor_removida?: boolean;
}

export const ROTULO_COR_REMOVIDA = "cor removida";

const parte = (v: string | null | undefined) => (v == null || v === "" ? "" : String(v));

/**
 * Chave canônica (string) da identidade: 5 campos fixos, nesta ordem, separados por "|",
 * ausente = vazio:
 *   modelo_id | variante_tecido_id | produto_variante_id | cor_id | cor_apelido_id
 * Mesma FORMA para as 3 origens (interno preenche variante_tecido_id; revenda/importado
 * preenchem produto_variante_id). Duas variantes com a mesma identidade colidem.
 */
export function chaveVariante(item: ArmarioItemIdentidade): string {
  return [
    parte(item.modelo_id),
    parte(item.variante_tecido_id),
    parte(item.produto_variante_id),
    parte(item.cor_id),
    parte(item.cor_apelido_id),
  ].join("|");
}

/** Origem inferida pelo ponteiro nativo. */
export function origemDoItem(item: ArmarioItemIdentidade): ArmarioOrigem | null {
  if (item.variante_tecido_id) return "interno";
  if (item.produto_variante_id) return "revenda"; // revenda e importado compartilham produto_variante_id
  return null;
}

/** Rótulo "cor - cor apelido"; "cor removida" se a cor sumiu do cadastro vivo. */
export function rotuloVariante(item: ArmarioItemRotulo): string {
  const semCor = !item.cor_nome && !item.cor_apelido_nome;
  if (item.cor_removida || semCor) return ROTULO_COR_REMOVIDA;
  return corApelidoLabel(item.cor_nome, item.cor_apelido_nome);
}

/** Remove itens repetidos (mesma chave), preservando a 1ª ocorrência e a ordem. */
export function dedupeVariantes<T extends ArmarioItemIdentidade>(itens: T[]): T[] {
  const vistos = new Set<string>();
  return itens.filter((i) => {
    const k = chaveVariante(i);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
