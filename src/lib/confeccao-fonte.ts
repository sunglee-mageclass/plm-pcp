import { isServicoConfeccao, isServicoPL } from "@/lib/servico-confeccao";

type CatInfo = { id: string; nome: string };
type BlocoInfo = { id?: string | null; categoria_terceirizado_id: string; detalhado: boolean };
export type FonteResolucao = { fonteId: string | null; ambiguo: boolean; candidatos: string[] };

// Rank menor = maior prioridade. Prioridade explícita (array de categoria_id) vence;
// default: PL/Private Label (0) antes de Oficina/Costura (1).
function rankCategoria(catId: string, nome: string, prioridade?: string[]): number {
  if (prioridade && prioridade.length) {
    const i = prioridade.indexOf(catId);
    if (i >= 0) return i;
    return prioridade.length + (isServicoPL(nome) ? 0 : 1); // não listadas vão ao fim, PL antes
  }
  return isServicoPL(nome) ? 0 : 1;
}

/** Resolve O único bloco-fonte de confecção (destrinchado). Prioridade PL→Oficina
 *  (ou a `prioridade` configurada). `ambiguo` quando há 2+ candidatos. Espelha o
 *  servidor (`_resolver_fonte_confeccao`); em conflito, o servidor decide na escrita. */
export function resolverFonteConfeccao(
  blocos: BlocoInfo[],
  categorias: CatInfo[],
  prioridade?: string[],
): FonteResolucao {
  const nomeDe = (catId: string) => categorias.find((c) => c.id === catId)?.nome ?? "";
  const candidatos = blocos.filter(
    (b) => b.detalhado && !!b.id && isServicoConfeccao(nomeDe(b.categoria_terceirizado_id)),
  );
  if (candidatos.length === 0) return { fonteId: null, ambiguo: false, candidatos: [] };
  const ordenado = [...candidatos].sort(
    (a, b) =>
      rankCategoria(a.categoria_terceirizado_id, nomeDe(a.categoria_terceirizado_id), prioridade) -
      rankCategoria(b.categoria_terceirizado_id, nomeDe(b.categoria_terceirizado_id), prioridade),
  );
  return {
    fonteId: ordenado[0].id as string,
    ambiguo: candidatos.length > 1,
    candidatos: candidatos.map((c) => c.id as string),
  };
}
