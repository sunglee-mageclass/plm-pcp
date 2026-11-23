// Driver "insumo" do Exportar dados: recorte = Tipo de insumo (tipos_insumo da loja; "Todos" explícito) e a RPC `exportar_insumos`.
// 2 níveis (cabeçalho / até variante = cor × tamanho, SEM apelido). Prefs por tipo: `useUserPref("export","insumo", tipo_insumo|colunas|niveis)`.
import { useUserPref } from "@/hooks/useUiPrefs";
import { catalogoDoTipo } from "@/lib/exportar/campos-por-tipo";
import { chamarRpcExport, FiltroSelect, useOpcoesLoja } from "./compartilhado";
import { idParaRpc, nomeBaseArquivo, valorFiltroValido, type DriverRecorte, type NivelExport, type RecorteAtivo } from "./tipos";

export const NIVEIS_INSUMO: NivelExport[] = [
  { valor: "1", rotulo: "1. Cabeçalho", ajuda: "1 linha por insumo" },
  { valor: "2", rotulo: "2. Até variante (cor × tamanho)", ajuda: "o cabeçalho e 1 linha por cor × tamanho" },
];
export const NOME_ABA_INSUMO: Record<string, string> = { "1": "Cabeçalho", "2": "Até variante" };

/** Argumentos da RPC `exportar_insumos` (puro): filtro vazio/sentinela vira null = todos os tipos. */
export function argsRpcInsumo(filtros: { tipo: string | null }, campos: string[], niveis: string[], limite: number | null) {
  return { _tipo_insumo: idParaRpc(filtros.tipo), _campos: campos, _niveis: niveis, _limite: limite };
}

function useRecorteInsumo(): RecorteAtivo {
  const [tipoPref, setTipoPref] = useUserPref("export", "insumo", "tipo_insumo", []);
  const tipoQ = useOpcoesLoja("tipos_insumo");
  const tipo = valorFiltroValido(tipoPref, tipoQ.data ?? []);

  const filtros = (
    <div className="grid gap-4 sm:grid-cols-2">
      <FiltroSelect
        id="exportar-insumo-tipo"
        rotulo="Tipo de insumo"
        placeholder="Escolha um tipo de insumo"
        rotuloTodos="Todos os tipos"
        value={tipo ?? undefined}
        opcoes={tipoQ.data}
        carregando={tipoQ.isPending}
        erro={tipoQ.isError}
        onRetry={() => void tipoQ.refetch()}
        onChange={(v) => setTipoPref([v])}
        textoErro="Não foi possível carregar os tipos de insumo."
        textoVazio="Esta loja ainda não tem tipos de insumo."
      />
    </div>
  );

  return {
    filtros,
    escolhido: tipo !== null,
    pronta: true,
    chave: ["insumo", tipo],
    avisoSemRecorte: "Escolha um tipo de insumo (ou “Todos os tipos”) para ver a prévia.",
    avisoDependenciaErro: null,
    chamarRpc: (campos, niveis, limite) => chamarRpcExport("exportar_insumos", argsRpcInsumo({ tipo }, campos, niveis, limite)),
    nomeBaseArquivo: () => nomeBaseArquivo("insumo", { tipo }),
  };
}

export const driverInsumo: DriverRecorte = {
  tipo: "insumo",
  catalogo: catalogoDoTipo("insumo"),
  niveis: NIVEIS_INSUMO,
  nomeAba: NOME_ABA_INSUMO,
  prefScreen: "insumo",
  item: { um: "insumo", varios: "insumos" },
  avisoVariante: "Campos de variante: só têm valor nas linhas de variante, cor × tamanho (ficam vazios no cabeçalho).",
  useRecorte: useRecorteInsumo,
};
