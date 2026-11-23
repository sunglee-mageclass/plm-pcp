// Driver "aviamento" do Exportar dados: recorte = Categoria E Material (dois filtros INDEPENDENTES, cada um com "Todos" explícito; combinam
// com E no SQL) e a RPC `exportar_aviamentos`. 2 níveis (cabeçalho / até variante). Prefs por tipo:
// `useUserPref("export","aviamento", categoria|material|colunas|niveis)`.
// "Escolhido" = pelo menos UM dos dois foi escolhido (inclusive "Todos"); o outro, ainda vazio, vale "Todos" (mostrado como tal).
// Nada escolhido nos dois NUNCA vira "todos": Baixar desabilitado e nada é consultado.
import { useUserPref } from "@/hooks/useUiPrefs";
import { catalogoDoTipo } from "@/lib/exportar/campos-por-tipo";
import { chamarRpcExport, FiltroSelect, useOpcoesLoja } from "./compartilhado";
import { idParaRpc, nomeBaseArquivo, SENTINELA_TODOS, valorFiltroValido, type DriverRecorte, type NivelExport, type RecorteAtivo } from "./tipos";

export const NIVEIS_AVIAMENTO: NivelExport[] = [
  { valor: "1", rotulo: "1. Cabeçalho", ajuda: "1 linha por aviamento" },
  { valor: "2", rotulo: "2. Até variante", ajuda: "o cabeçalho e 1 linha por variante (cor + apelido)" },
];
export const NOME_ABA_AVIAMENTO: Record<string, string> = { "1": "Cabeçalho", "2": "Até variante" };

/** Argumentos da RPC `exportar_aviamentos` (puro): cada filtro vazio/sentinela vira null = todos naquele eixo (E no SQL). */
export function argsRpcAviamento(
  filtros: { categoria: string | null; material: string | null },
  campos: string[], niveis: string[], limite: number | null,
) {
  return { _categoria: idParaRpc(filtros.categoria), _material: idParaRpc(filtros.material), _campos: campos, _niveis: niveis, _limite: limite };
}

function useRecorteAviamento(): RecorteAtivo {
  const [catPref, setCatPref] = useUserPref("export", "aviamento", "categoria", []);
  const [matPref, setMatPref] = useUserPref("export", "aviamento", "material", []);
  const catQ = useOpcoesLoja("categorias_aviamento");
  const matQ = useOpcoesLoja("materiais_aviamento");
  const categoria = valorFiltroValido(catPref, catQ.data ?? []);
  const material = valorFiltroValido(matPref, matQ.data ?? []);
  const escolhido = categoria !== null || material !== null;

  const filtros = (
    <div className="grid gap-4 sm:grid-cols-2">
      <FiltroSelect
        id="exportar-aviamento-categoria"
        rotulo="Categoria"
        placeholder="Escolha uma categoria"
        rotuloTodos="Todas as categorias"
        value={categoria ?? (escolhido ? SENTINELA_TODOS : undefined)}
        opcoes={catQ.data}
        carregando={catQ.isPending}
        erro={catQ.isError}
        onRetry={() => void catQ.refetch()}
        onChange={(v) => setCatPref([v])}
        textoErro="Não foi possível carregar as categorias."
        textoVazio="Esta loja ainda não tem categorias de aviamento."
      />
      <FiltroSelect
        id="exportar-aviamento-material"
        rotulo="Material"
        placeholder="Escolha um material"
        rotuloTodos="Todos os materiais"
        value={material ?? (escolhido ? SENTINELA_TODOS : undefined)}
        opcoes={matQ.data}
        carregando={matQ.isPending}
        erro={matQ.isError}
        onRetry={() => void matQ.refetch()}
        onChange={(v) => setMatPref([v])}
        textoErro="Não foi possível carregar os materiais."
        textoVazio="Esta loja ainda não tem materiais de aviamento."
      />
    </div>
  );

  return {
    filtros,
    escolhido,
    pronta: true,
    chave: ["aviamento", categoria, material],
    avisoSemRecorte: "Escolha uma categoria e/ou um material (ou “Todos”) para ver a prévia.",
    avisoDependenciaErro: null,
    chamarRpc: (campos, niveis, limite) => chamarRpcExport("exportar_aviamentos", argsRpcAviamento({ categoria, material }, campos, niveis, limite)),
    nomeBaseArquivo: () => nomeBaseArquivo("aviamento", { categoria, material }),
  };
}

export const driverAviamento: DriverRecorte = {
  tipo: "aviamento",
  catalogo: catalogoDoTipo("aviamento"),
  niveis: NIVEIS_AVIAMENTO,
  nomeAba: NOME_ABA_AVIAMENTO,
  prefScreen: "aviamento",
  item: { um: "aviamento", varios: "aviamentos" },
  avisoVariante: "Campos de variante: só têm valor nas linhas de variante (ficam vazios no cabeçalho).",
  useRecorte: useRecorteAviamento,
};
