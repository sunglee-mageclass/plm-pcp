// Controle e opções de cada célula da grade "Lista" do Planejamento de Produto (PURO). A coluna diz o TIPO; aqui se resolve o CONTROLE
// de fato (Coleção/Subcoleção só viram dropdown com OTB) e as OPÇÕES dos selects (Sub1/Sub2 cascateiam pela categoria; a subcoleção,
// pela coleção). Quem decide se a célula EDITA é `colunaEditavelNoProduto` — nada daqui decide permissão.
import { statusMeta, type Opt } from "@/components/planejamento/modelo-shared";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import type { GradeOpcoesProduto } from "@/components/planejamento/grade/useProdutosGrade";
import type { ColunaProduto } from "./colunas";
import { valorColuna, type LinhaProduto, type ResolverRotulo } from "./linhas";

export type ControleCelula = "texto" | "money" | "select" | "somente-leitura";

/** O controle da coluna. Coleção/Subcoleção: dropdown SÓ com o módulo OTB (senão texto livre — `textoSemOtb`). */
export function controleDaColuna(col: ColunaProduto, otbOn: boolean): ControleCelula {
  if (col.soLeitura || col.tipo === "readonly") return "somente-leitura";
  if (col.tipo === "select" && col.textoSemOtb && !otbOn) return "texto";
  if (col.tipo === "texto") return "texto";
  if (col.tipo === "money") return "money";
  return "select";
}

/** Casas decimais do MoneyInput da coluna (peso 3, medidas/preço 2). */
export function casasDaColuna(col: Pick<ColunaProduto, "casas">): number {
  return col.casas ?? 2;
}

/** Valor "vazio" do Select (o Radix não aceita value=""): escolher "—" limpa o campo. */
export const OPCAO_VAZIA = "__vazio__";

/** Contexto da LINHA que as opções dependem (o rascunho vivo: trocar a categoria muda as subcategorias na hora). */
export type ContextoOpcoes = {
  categoriaId: string | null;
  colecaoId: string | null;
  /** Valor atual do campo: se não está na lista (cadastro apagado/órfão) entra mesmo assim, para a célula não "esvaziar". */
  atual: string | null;
};

/** Opções do select da coluna. Sub1/Sub2 = só as da categoria da linha; Subcoleção = só as da coleção da linha (com OTB). */
export function opcoesDaColuna(key: string, op: GradeOpcoesProduto, ctx: ContextoOpcoes): Opt[] {
  let lista: Opt[];
  switch (key) {
    case "colecao":
      lista = op.colecoes.map((c) => ({ id: c.id, nome: c.nome }));
      break;
    case "subcolecao":
      lista = (ctx.colecaoId ? (op.subcolecoesPorColecao.get(ctx.colecaoId) ?? []) : []).map(
        (n) => ({ id: n, nome: n }),
      );
      break;
    case "semana":
      lista = op.semanas;
      break;
    case "linha_id":
      lista = op.linhas.map((l) => ({ id: l.id, nome: l.nome }));
      break;
    case "mes_id":
      lista = op.meses;
      break;
    case "ano_id":
      lista = op.anos;
      break;
    case "estilista_id":
      lista = op.estilistas;
      break;
    case "categoria_principal_id":
      lista = op.categorias.map((c) => ({ id: c.id, nome: c.nome }));
      break;
    case "subcategoria1_id":
      lista = op.subcategorias1
        .filter((s) => s.categoria_id === ctx.categoriaId)
        .map((s) => ({ id: s.id, nome: s.nome }));
      break;
    case "subcategoria2_id":
      lista = op.subcategorias2
        .filter((s) => s.categoria_id === ctx.categoriaId)
        .map((s) => ({ id: s.id, nome: s.nome }));
      break;
    case "tamanho_tipo":
      lista = op.tamanhoTipos;
      break;
    default:
      lista = [];
  }
  if (ctx.atual && !lista.some((o) => o.id === ctx.atual))
    return [...lista, { id: ctx.atual, nome: ctx.atual }];
  return lista;
}

/** A subcategoria `subId` pertence à categoria `categoriaId`? (a cascata limpa a que ficou órfã ao trocar a categoria). */
export function subDaCategoria(
  subs: readonly { id: string; categoria_id: string | null }[],
  subId: string | null,
  categoriaId: string | null,
): boolean {
  if (!subId) return true;
  return subs.find((s) => s.id === subId)?.categoria_id === categoriaId;
}

/** Grupo da categoria dada é Acessórios? (grade única UN: "Tamanho em" não se aplica — `ehGrupoAcessorio`, espelho de `_grupo_eh_acessorio`). */
export function categoriaEhAcessorio(
  op: Pick<GradeOpcoesProduto, "categorias" | "grupos">,
  categoriaId: string | null,
): boolean {
  if (!categoriaId) return false;
  const grupoId = op.categorias.find((c) => c.id === categoriaId)?.grupo_id;
  if (!grupoId) return false;
  return ehGrupoAcessorio(op.grupos.find((g) => g.id === grupoId)?.nome);
}

/** id → rótulo por coluna de seleção, p/ ordenar e exibir (`valorColuna` com resolver). `grupo` = id da CATEGORIA → nome do grupo dela. */
export function resolverRotulosProduto(op: GradeOpcoesProduto): ResolverRotulo {
  const mapa = new Map<string, Map<string, string>>();
  const pares = (xs: readonly { id: string; nome: string }[]) =>
    new Map(xs.map((x) => [x.id, x.nome]));
  mapa.set("linha_id", pares(op.linhas));
  mapa.set("mes_id", pares(op.meses));
  mapa.set("ano_id", pares(op.anos));
  mapa.set("estilista_id", pares(op.estilistas));
  mapa.set("categoria_principal_id", pares(op.categorias));
  mapa.set("subcategoria1_id", pares(op.subcategorias1));
  mapa.set("subcategoria2_id", pares(op.subcategorias2));
  const nomeGrupo = new Map(op.grupos.map((g) => [g.id, g.nome]));
  mapa.set(
    "grupo",
    new Map(
      op.categorias.flatMap((c) =>
        c.grupo_id && nomeGrupo.has(c.grupo_id)
          ? [[c.id, nomeGrupo.get(c.grupo_id)!] as const]
          : [],
      ),
    ),
  );
  return (colKey, id) => {
    if (colKey === "status_planejamento") return statusMeta(id).label;
    return mapa.get(colKey)?.get(id);
  };
}

/** "2026-11-23" (ou ISO) → "23/11/2026", sem passar por `Date` (nunca desloca o dia pelo fuso). Vazio/ilegível → null. */
export function dataParaTela(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** Número → "1.234,50" com as casas da coluna (texto de leitura de peso/medidas/preço). */
export function numeroParaTela(n: number, casas: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/**
 * O texto que a célula mostra quando NÃO é um campo editável (só-leitura, sem permissão, comprado…): rótulo (não o id), data
 * dd/mm/aaaa, versão "vN", status pelo nome da etapa, número com as casas da coluna. Vazio → null (a célula mostra "—").
 */
export function textoDaCelula(
  linha: LinhaProduto,
  col: ColunaProduto,
  resolver: ResolverRotulo,
): string | null {
  const m = linha.modelo;
  switch (col.key) {
    case "versao":
      return m.versao != null ? `v${m.versao}` : null;
    case "data_lancamento":
      return dataParaTela(m.data_lancamento);
    case "status_planejamento":
      // como o card: sem status = "Em Planejamento" (`statusMeta`)
      return statusMeta(m.status_planejamento).label;
    default:
      break;
  }
  const v = valorColuna(linha, col, resolver);
  if (v === null || v === undefined || v === "") return null;
  if (col.tipo === "money" || col.key === "preco_atacado")
    return numeroParaTela(Number(v), col.casas ?? 2);
  return String(v);
}
