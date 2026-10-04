// [modularidade F2, F4e] O que a tela "Importar Dados" OFERECE por loja — função PURA (testável), sem hook. O servidor já
// recusa por linha (`importar_modelo_linha` = Criação; `importar_produto_linha` = Produto Acabado OU Importado); aqui a loja
// só não é levada até o erro: aba/entidade que ela não tem não entra no modelo de planilha nem na análise.
import type { ModuleKey } from "@/hooks/useTenantModules";
import type { EntityImportDescriptor } from "./types";

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
