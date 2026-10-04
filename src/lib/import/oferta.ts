// [modularidade F2, F4e] O que a tela "Importar Dados" OFERECE por loja — função PURA (testável), sem hook. O servidor já
// recusa por linha (`importar_modelo_linha` = Criação; `importar_produto_linha` = Produto Acabado OU Importado); aqui a loja
// só não é levada até o erro: aba/entidade que ela não tem não entra no modelo de planilha nem na análise.
import type { ModuleKey } from "@/hooks/useTenantModules";
import { MODULE_ROTULO } from "@/lib/permissions-catalog";
import type { ColumnSpec, EntidadeAgregada, EntityImportDescriptor, Problema, ResolvedRow } from "./types";

type Modulos = Partial<Record<ModuleKey, boolean>>;

/** A entidade de importação está disponível para a loja? Tecido/Aviamento/Insumo seguem sempre (Cadastro). */
export function entidadeOferecida(entidade: string, modules: Modulos): boolean {
  if (entidade === "modelo") return !!modules.criacao;
  if (entidade === "produto") return !!modules.produto_acabado || !!modules.produto_importado;
  return true;
}

/** Descritores que a loja pode importar, na ordem de entrada (dependências primeiro). */
export function descritoresOferecidos(descs: readonly EntityImportDescriptor[], modules: Modulos): EntityImportDescriptor[] {
  return descs.filter((d) => entidadeOferecida(d.entidade, modules));
}

/** Módulo(s) que falta(m) para a entidade (texto do aviso "Ignorada…"). */
export function moduloQueFalta(entidade: string): string {
  if (entidade === "modelo") return MODULE_ROTULO.criacao;
  if (entidade === "produto") return `${MODULE_ROTULO.produto_acabado} ou ${MODULE_ROTULO.produto_importado}`;
  return "";
}

// ── Produto: o `tipo` por loja [Ruling R9] ───────────────────────────────────────────────────────────────────────────────
// `importar_produto_linha` exige `produto_acabado` para `revenda` e `produto_importado` para `importado`, cada um em separado:
// a loja só com PA não oferece "Importado" (e vice-versa). O descritor da loja filtra opções/hint/exemplo da coluna `tipo` e
// recusa, no `resolve` E no `revalidar` (este substitui `problemas` a cada edição de célula), a linha de tipo que a loja não tem.
export type TipoProduto = "revenda" | "importado";

export function tiposProdutoOferecidos(modules: Modulos): TipoProduto[] {
  return [...(modules.produto_acabado ? (["revenda"] as const) : []), ...(modules.produto_importado ? (["importado"] as const) : [])];
}

const ROTULO_TIPO: Record<TipoProduto, string> = { revenda: "Revenda", importado: "Importado" };
const MODULO_DO_TIPO: Record<TipoProduto, string> = { revenda: MODULE_ROTULO.produto_acabado, importado: MODULE_ROTULO.produto_importado };

function problemaTipoForaDaLoja(tipoBruto: unknown, oferecidos: TipoProduto[]): Problema | null {
  const t = String(tipoBruto ?? "").trim().toLowerCase() as TipoProduto;
  if (t !== "revenda" && t !== "importado") return null; // inválido: o descritor original já acusa
  if (oferecidos.includes(t)) return null;
  return {
    nivel: "erro",
    campo: "tipo",
    mensagem: `O módulo ${MODULO_DO_TIPO[t]} não está ligado nesta loja — esta linha (${ROTULO_TIPO[t]}) não pode ser importada.`,
  };
}

/** Descritor como a LOJA o vê. Só o Produto muda (coluna `tipo` + recusa do tipo sem módulo); os demais voltam iguais. */
export function descritorDaLoja(desc: EntityImportDescriptor, modules: Modulos): EntityImportDescriptor {
  if (desc.entidade !== "produto") return desc;
  const oferecidos = tiposProdutoOferecidos(modules);
  if (oferecidos.length === 0 || oferecidos.length === 2) return desc; // 2 = igual a hoje; 0 nem é oferecido
  const colunas: ColumnSpec[] = desc.colunas.map((c) =>
    c.key === "tipo"
      ? { ...c, opcoes: oferecidos.map((t) => ROTULO_TIPO[t]), hint: oferecidos.join(" ou "), exemplo: oferecidos[0] }
      : c,
  );
  return {
    ...desc,
    colunas,
    resolve(row, maps): ResolvedRow {
      const r = desc.resolve(row, maps);
      const p = problemaTipoForaDaLoja(row.tipo, oferecidos);
      return p ? { ...r, problemas: [...r.problemas, p] } : r;
    },
    revalidar(ent: EntidadeAgregada): Problema[] {
      const base = desc.revalidar ? desc.revalidar(ent) : [];
      const p = problemaTipoForaDaLoja(ent.cabecalho.tipo, oferecidos);
      return p ? [...base, p] : base;
    },
  };
}

/** Descritores que a loja importa, já no formato da loja (ver `descritorDaLoja`). */
export function descritoresDaLoja(descs: readonly EntityImportDescriptor[], modules: Modulos): EntityImportDescriptor[] {
  return descritoresOferecidos(descs, modules).map((d) => descritorDaLoja(d, modules));
}
