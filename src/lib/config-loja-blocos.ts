// [modularidade F2, F9] Quais blocos da Config da Loja aparecem por módulo — função PURA (testável). Esconder um bloco NÃO
// apaga a configuração gravada (o Salvar colaborativo manda só o que mudou). Fonte dos módulos: `MODULE_DEPS`/desenho da Parte 3.
//  - Kanban / Status do Kanban / Requisitos / REF / Fluxo de Revenda → só com Criação;
//  - Envio à Explosão (`explosao_envio_status`) → Criação E Entrada e Saída (a Explosão usa os dois);
//  - Etapas PL → só com Produção (além da chave `etapas_pl`); o bloco da Revenda segue exigindo `produto_acabado`;
//  - o modo só-estoque (`isStockOnly`) continua escondendo tudo isso, como antes.
import type { ModuleKey } from "@/hooks/useTenantModules";

export type BlocosConfigVisiveis = {
  /** Card "Status do Kanban" (colunas, Kanban automático, Requisitos por coluna, marcador de REF). */
  statusKanban: boolean;
  /** Marcador "Envio à Explosão" dentro do card de status + o texto dele. */
  envioExplosao: boolean;
  /** Card "Formato da REF". */
  formatoRef: boolean;
  /** Card "Fluxo de Revenda" (colunas, requisitos e campos do kanban de revenda). */
  fluxoRevenda: boolean;
  /** Card "Etapas PL". */
  etapasPl: boolean;
};

export function blocosConfigVisiveis(
  modules: Partial<Record<ModuleKey, boolean>>,
  isStockOnly: boolean,
): BlocosConfigVisiveis {
  const completo = !isStockOnly;
  const criacao = completo && !!modules.criacao;
  return {
    statusKanban: criacao,
    envioExplosao: criacao && !!modules.entrada_saida,
    formatoRef: criacao,
    fluxoRevenda: criacao && !!modules.produto_acabado,
    etapasPl: completo && !!modules.producao && !!modules.etapas_pl,
  };
}
