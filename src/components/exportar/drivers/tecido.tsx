// Driver "tecido" do Exportar dados: recorte = Categoria (categorias_tecido da loja; "Todas" explícito) e a RPC `exportar_tecidos`.
// 2 níveis (cabeçalho / até variante = cor + apelido). Prefs por tipo: `useUserPref("export","tecido", categoria|colunas|niveis)`.
// O filtro é o ID da categoria (a RPC valida: não-uuid ou de outra loja = `exportar_filtro_invalido`); sentinela/vazio = null (todas).
import { useUserPref } from "@/hooks/useUiPrefs";
import { catalogoDoTipo } from "@/lib/exportar/campos-por-tipo";
import { chamarRpcExport, FiltroSelect, useOpcoesLoja } from "./compartilhado";
import { idParaRpc, nomeBaseArquivo, valorFiltroValido, type DriverRecorte, type NivelExport, type RecorteAtivo } from "./tipos";

export const NIVEIS_TECIDO: NivelExport[] = [
  { valor: "1", rotulo: "1. Cabeçalho", ajuda: "1 linha por tecido" },
  { valor: "2", rotulo: "2. Até variante", ajuda: "o cabeçalho e 1 linha por variante (cor + apelido)" },
];
export const NOME_ABA_TECIDO: Record<string, string> = { "1": "Cabeçalho", "2": "Até variante" };

/** Argumentos da RPC `exportar_tecidos` (puro): filtro vazio/sentinela vira null = todas as categorias. */
export function argsRpcTecido(filtros: { categoria: string | null }, campos: string[], niveis: string[], limite: number | null) {
  return { _categoria: idParaRpc(filtros.categoria), _campos: campos, _niveis: niveis, _limite: limite };
}

function useRecorteTecido(): RecorteAtivo {
  const [catPref, setCatPref] = useUserPref("export", "tecido", "categoria", []);
  const catQ = useOpcoesLoja("categorias_tecido");
  const categoria = valorFiltroValido(catPref, catQ.data ?? []); // null = nada escolhido (vazio/id que sumiu)

  const filtros = (
    <div className="grid gap-4 sm:grid-cols-2">
      <FiltroSelect
        id="exportar-tecido-categoria"
        rotulo="Categoria"
        placeholder="Escolha uma categoria"
        rotuloTodos="Todas as categorias"
        value={categoria ?? undefined}
        opcoes={catQ.data}
        carregando={catQ.isPending}
        erro={catQ.isError}
        onRetry={() => void catQ.refetch()}
        onChange={(v) => setCatPref([v])}
        textoErro="Não foi possível carregar as categorias."
        textoVazio="Esta loja ainda não tem categorias de tecido."
      />
    </div>
  );

  return {
    filtros,
    escolhido: categoria !== null,
    pronta: true,
    chave: ["tecido", categoria],
    avisoSemRecorte: "Escolha uma categoria (ou “Todas as categorias”) para ver a prévia.",
    avisoDependenciaErro: null,
    chamarRpc: (campos, niveis, limite) => chamarRpcExport("exportar_tecidos", argsRpcTecido({ categoria }, campos, niveis, limite)),
    nomeBaseArquivo: () => nomeBaseArquivo("tecido", { categoria }),
  };
}

export const driverTecido: DriverRecorte = {
  tipo: "tecido",
  catalogo: catalogoDoTipo("tecido"),
  niveis: NIVEIS_TECIDO,
  nomeAba: NOME_ABA_TECIDO,
  prefScreen: "tecido",
  item: { um: "tecido", varios: "tecidos" },
  avisoVariante: "Campos de variante: só têm valor nas linhas de variante (ficam vazios no cabeçalho).",
  useRecorte: useRecorteTecido,
};
