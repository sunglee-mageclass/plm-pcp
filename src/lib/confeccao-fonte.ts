import { isServicoConfeccao, isServicoPL } from "@/lib/servico-confeccao";

type CatInfo = { id: string; nome: string };
// `created_at` é opcional: hoje o `Bloco` do PCP (pcp.servicos.$modeloId.tsx) não carrega essa
// coluna no estado local. Quando ausente (em qualquer um dos dois lados de um empate), o
// desempate cai no fallback estável (ordem de entrada) — `Array.prototype.sort` é estável
// (garantido pela spec desde ES2019), então o comportamento não é aleatório, só não-determinístico
// entre chamadas com ordens de entrada diferentes. Passar `created_at` quando disponível é o que
// casa com o `ORDER BY ..., pt.created_at` da futura `_resolver_fonte_confeccao` (SQL, Task 3).
type BlocoInfo = {
  id?: string | null;
  categoria_terceirizado_id: string;
  detalhado: boolean;
  created_at?: string | null;
};
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

// Desempate quando 2+ blocos empatam no rank (ex.: 2 blocos "Oficina" destrinchados — a UI do
// PCP permite blocos repetidos da mesma categoria). Menor `created_at` (bloco mais antigo)
// vence, espelhando `ORDER BY ..., pt.created_at` (ascendente) da SQL da Task 3. Sem
// `created_at` em um dos dois lados: 0 (mantém a ordem de entrada — sort estável).
function compararDesempate(a: BlocoInfo, b: BlocoInfo): number {
  const ca = a.created_at ? Date.parse(a.created_at) : NaN;
  const cb = b.created_at ? Date.parse(b.created_at) : NaN;
  if (Number.isNaN(ca) || Number.isNaN(cb)) return 0;
  return ca - cb;
}

/** Resolve O único bloco-fonte de confecção (destrinchado). Prioridade PL→Oficina
 *  (ou a `prioridade` configurada); empate de rank desempata por `created_at` (mais antigo
 *  vence) quando disponível. `ambiguo` quando há 2+ candidatos. Espelha o servidor
 *  (`_resolver_fonte_confeccao`); em conflito, o servidor decide na escrita. */
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
  const ordenado = [...candidatos].sort((a, b) => {
    const ra = rankCategoria(a.categoria_terceirizado_id, nomeDe(a.categoria_terceirizado_id), prioridade);
    const rb = rankCategoria(b.categoria_terceirizado_id, nomeDe(b.categoria_terceirizado_id), prioridade);
    return ra !== rb ? ra - rb : compararDesempate(a, b);
  });
  return {
    fonteId: ordenado[0].id as string,
    ambiguo: candidatos.length > 1,
    candidatos: candidatos.map((c) => c.id as string),
  };
}
