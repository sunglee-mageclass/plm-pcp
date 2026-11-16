// F7 Armário · D4 — regras PURAS da tela de montagem (sem React/supabase): inserir, remover e resolver o "soltar" (onDragEnd).
// A grade é VISUAL (N colunas, reflui); a ORDEM é a posição na lista 1D (índice 1-based = ordem de envio da API).
// Nada aqui sabe de colunas: mudar o nº de colunas NUNCA toca a lista.
import { reordenar } from "@/lib/armario/ordem";

/** Id do droppable da grade (container: aceita soltar no vazio/fim). */
export const GRADE_DROP_ID = "armario-grade";
/** Prefixo do id sortable de um item JÁ na grade (`grade:${chave}`). O do dialog é `variante:${chave}`. */
export const GRADE_ITEM_PREFIXO = "grade:";

export const idItemGrade = (chave: string) => `${GRADE_ITEM_PREFIXO}${chave}`;
/** Chave de identidade a partir de um id sortable da grade (ou null se não for um). */
export const chaveDoIdGrade = (id: unknown): string | null => {
  const s = String(id ?? "");
  return s.startsWith(GRADE_ITEM_PREFIXO) ? s.slice(GRADE_ITEM_PREFIXO.length) : null;
};

interface ComChave { chave: string }

/** Insere `item` na posição `posicao` (fim se omitida/fora do intervalo). Chave já presente → devolve a MESMA lista (sem duplicar). */
export function inserirItem<T extends ComChave>(lista: readonly T[], item: T, posicao?: number): readonly T[] {
  if (lista.some((x) => x.chave === item.chave)) return lista;
  const out = lista.slice();
  const p = posicao == null || posicao < 0 || posicao > out.length ? out.length : posicao;
  out.splice(p, 0, item);
  return out;
}

/** Remove o item da chave (sem mutar). Chave ausente → mesma lista. */
export function removerItem<T extends ComChave>(lista: readonly T[], chave: string): readonly T[] {
  return lista.some((x) => x.chave === chave) ? lista.filter((x) => x.chave !== chave) : lista;
}

export type MotivoSemMudanca = "travado" | "sem-destino" | "duplicado" | "mesma-posicao" | "origem-desconhecida";

export interface DragEndEntrada<T extends ComChave> {
  lista: readonly T[];
  /** Origem: item que já está na grade (reordenar) ou item vindo do dialog (inserir). */
  origem: { tipo: "grade"; chave: string } | { tipo: "variante"; item: T };
  /** `over.id` do dnd-kit (item `grade:…`, container `GRADE_DROP_ID`) ou null (soltou fora). */
  overId: string | null;
  /** Armário publicado / sem permissão: a UI não deve nem tentar. */
  travado: boolean;
}
export interface DragEndSaida<T extends ComChave> {
  lista: readonly T[];
  mudou: boolean;
  motivo?: MotivoSemMudanca;
}

/**
 * Resolve o "soltar":
 *  · grade → grade: move o item para a posição do alvo (arrayMove) — fluxo 2D reflui, a ordem é a do array;
 *  · dialog → grade: insere NA posição do alvo (ou no fim se soltou no container); chave já na grade = ignora (o índice único barraria).
 */
export function resolverDragEnd<T extends ComChave>(e: DragEndEntrada<T>): DragEndSaida<T> {
  const sem = (motivo: MotivoSemMudanca): DragEndSaida<T> => ({ lista: e.lista, mudou: false, motivo });
  if (e.travado) return sem("travado");
  if (e.overId == null) return sem("sem-destino");
  const chaveAlvo = chaveDoIdGrade(e.overId);
  const noContainer = e.overId === GRADE_DROP_ID;
  if (chaveAlvo == null && !noContainer) return sem("sem-destino");
  const idxAlvo = chaveAlvo == null ? -1 : e.lista.findIndex((x) => x.chave === chaveAlvo);

  if (e.origem.tipo === "grade") {
    const de = e.lista.findIndex((x) => x.chave === (e.origem as { chave: string }).chave);
    if (de < 0) return sem("origem-desconhecida");
    const para = noContainer ? e.lista.length - 1 : idxAlvo;
    if (para < 0 || para === de) return sem("mesma-posicao");
    return { lista: reordenar(e.lista, de, para), mudou: true };
  }

  const item = e.origem.item;
  if (e.lista.some((x) => x.chave === item.chave)) return sem("duplicado");
  return { lista: inserirItem(e.lista, item, idxAlvo >= 0 ? idxAlvo : undefined), mudou: true };
}

/** Payload de `_itens` do `armario_salvar`: ordem do array = índice 1-based; só os ponteiros (o snapshot de cor vem do servidor). */
export function itensParaSalvar(lista: readonly {
  modelo_id: string; variante_tecido_id: string | null; produto_variante_id: string | null;
}[]) {
  return lista.map((i) => ({
    modelo_id: i.modelo_id,
    variante_tecido_id: i.variante_tecido_id ?? null,
    produto_variante_id: i.produto_variante_id ?? null,
  }));
}
