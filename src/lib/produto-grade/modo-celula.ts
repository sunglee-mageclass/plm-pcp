// Decisão ÚNICA do "modo" de uma célula da grade "Lista" do Planejamento de Produto (PURA): a célula só DESENHA o modo; o COLAR do Excel usa
// a MESMA decisão para recusar o que a edição normal recusaria (sem permissão, travado pela Integração, só-leitura). Extraída de
// `CorpoLinhaProduto` na PR-3 para a célula e o colar nunca divergirem.
import type { EstadoModeloIntegracao } from "@/lib/integracao/trava";
import {
  colunaEditavelNoProduto,
  colunaTravadaPelaIntegracao,
  colunaTravavel,
  type ColunaProduto,
  type ProdutoEdicao,
} from "./colunas";
import type { ControleCelula } from "./celulas";

/** `editar` = controle habilitado; `texto` = não edita (permissão/origem/só-leitura); `travada` = a Integração trava NESTE produto;
 *  `verificando` = o estado da Integração ainda não chegou (desabilitada, nunca livre). */
export type ModoCelulaProduto = "editar" | "texto" | "travada" | "verificando";

export function modoDaCelulaProduto(i: {
  col: ColunaProduto;
  controle: ControleCelula;
  produto: ProdutoEdicao;
  /** A tela inteira está só-leitura. */
  readOnly: boolean;
  canEdit: (chave: string) => boolean;
  /** Estado da Integração DESTE produto (`null` = sem trava conhecida). */
  estado: EstadoModeloIntegracao | null;
  integracaoPronta: boolean;
}): ModoCelulaProduto {
  // Só as colunas do rascunho editam; as demais (REF, Status, Origem…) são só-leitura de qualquer jeito.
  const editaSemTrava =
    !i.readOnly &&
    i.controle !== "somente-leitura" &&
    colunaEditavelNoProduto(i.col, i.produto, i.canEdit, null, { integracaoPronta: true });
  if (!editaSemTrava) return "texto";
  if (
    colunaEditavelNoProduto(i.col, i.produto, i.canEdit, i.estado, {
      integracaoPronta: i.integracaoPronta,
    })
  )
    return "editar";
  if (colunaTravadaPelaIntegracao(i.col, i.estado)) return "travada";
  if (!i.integracaoPronta && colunaTravavel(i.col)) return "verificando";
  return "texto";
}
