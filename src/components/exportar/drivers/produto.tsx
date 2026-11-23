// Driver "produto" do Exportar dados: o recorte Coleção + Subcoleção e a RPC `exportar_produtos`.
// MOVIDO byte-a-byte de `ExportarDados.tsx` (Task 4 da frente "exportar por tipo"): mesmas prefs (`useUserPref("export","integracao",…)`),
// mesmas queryKeys, mesma sentinela `__todas_colecoes__`, mesmo nome de arquivo — o produto sai idêntico ao de antes.
//
// - "Todas as coleções" é uma ESCOLHA EXPLÍCITA (valor sentinela guardado no pref da coleção; a RPC recebe `_colecao: null` = loja
//   inteira, sem aviso de tamanho). 3 estados: (a) nada escolhido = Baixar desabilitado e nada é consultado; (b) "Todas" = libera
//   (subcoleção fica desabilitada/“Todas”, pois subcoleção é POR coleção); (c) uma coleção específica. O vazio NUNCA vira "todas".
// - Coleção/subcoleção só valem se ainda existirem nas listas carregadas do servidor (senão contam como "não escolhida"/"todas" —
//   nunca mandam texto velho ao RPC).
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useUserPref } from "@/hooks/useUiPrefs";
import { CAMPOS_EXPORT } from "@/lib/integracao/campos-export";
import { buscarOpcoesColecao } from "@/lib/opcoes-colecao";
import { nomeBaseArquivo, type DriverRecorte, type NivelExport, type RecorteAtivo, type RespostaExport } from "./tipos";

/** Valor do item "Todas" no Select da subcoleção (Radix não aceita value vazio). */
const TODAS = "__todas__";
/** Valor do item "Todas as coleções" no Select da coleção (escolha explícita; distinto do estado vazio = nada escolhido). */
const TODAS_COLECOES = "__todas_colecoes__";

export const NIVEIS_PRODUTO: NivelExport[] = [
  { valor: "1", rotulo: "SKU pai", ajuda: "1 linha por produto" },
  { valor: "2", rotulo: "Até cor", ajuda: "o pai e 1 linha por cor" },
  { valor: "3", rotulo: "Até tamanho", ajuda: "o pai e 1 linha por cor × tamanho" },
];

/** Nome da aba do Excel por nível (produto). Passado ao `baixarExport`, que não tem mais nomes fixos. */
export const NOME_ABA_PRODUTO: Record<string, string> = { "1": "SKU pai", "2": "Até cor", "3": "Até tamanho" };

function lerSubcolecoes(data: unknown): string[] {
  return Array.isArray(data) ? data.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

async function chamarExportar(
  colecao: string | null, // null = todas as coleções (loja inteira)
  subcolecao: string | null,
  campos: string[],
  niveis: string[],
  limite: number | null,
): Promise<RespostaExport> {
  const { data, error } = await supabase.rpc("exportar_produtos" as any, {
    _colecao: colecao,
    _subcolecao: subcolecao,
    _campos: campos,
    _niveis: niveis,
    _limite: limite,
  });
  if (error) throw error;
  const d = (data ?? {}) as Partial<RespostaExport>;
  return {
    colunas: Array.isArray(d.colunas) ? d.colunas : [],
    total: typeof d.total === "number" ? d.total : 0,
    niveis: d.niveis && typeof d.niveis === "object" ? d.niveis : {},
  };
}

function useRecorteProduto(): RecorteAtivo {
  const tenantId = useActiveTenantId();

  const [colecaoPref, setColecaoPref] = useUserPref("export", "integracao", "colecao", []);
  const [subPref, setSubPref] = useUserPref("export", "integracao", "subcolecao", []);

  // ---- Coleção (lista da loja) ----
  const colecoesQ = useQuery({
    queryKey: ["exportar-colecoes", tenantId],
    enabled: !!tenantId,
    retry: 1,
    queryFn: async () => (await buscarOpcoesColecao()).colecoes,
  });
  const colecoes = colecoesQ.data;
  // Só vale a coleção salva que ainda existe na lista (lista ainda não chegou = sem coleção, nada é consultado).
  const colecao = colecoes && colecaoPref[0] && colecoes.includes(colecaoPref[0]) ? colecaoPref[0] : "";
  // "Todas as coleções" só vale com a lista carregada e não vazia (mesmo critério do Select habilitado); vazio/inválido NÃO vira "todas".
  const todasColecoes = !!colecoes && colecoes.length > 0 && colecaoPref[0] === TODAS_COLECOES;
  const colecaoEscolhida = colecao !== "" || todasColecoes;
  /** O que vai para a RPC: null só quando "Todas" foi escolhida; senão a coleção específica. */
  const colecaoRpc: string | null = todasColecoes ? null : colecao;

  // ---- Subcoleção (dependente da coleção escolhida) ----
  const subsQ = useQuery({
    queryKey: ["exportar-subcolecoes", tenantId, colecao],
    enabled: !!tenantId && !!colecao && !todasColecoes,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("exportar_subcolecoes" as any, { _colecao: colecao });
      if (error) throw error;
      return lerSubcolecoes(data);
    },
  });
  const subcolecoes = subsQ.data;
  // Subcoleção salva que não existe nesta coleção = "todas" (nunca manda texto velho ao servidor).
  const subcolecao = subcolecoes && subPref[0] && subcolecoes.includes(subPref[0]) ? subPref[0] : null;
  // Enquanto a lista de subcoleções não chegou, a prévia espera (senão consultaria com a subcoleção errada).
  const subsPronta = !colecao || todasColecoes || subsQ.isSuccess;

  const trocarColecao = (v: string) => {
    setColecaoPref([v]);
    setSubPref([]); // a subcoleção é DA coleção: trocar a coleção (ou escolher "Todas as coleções") volta para "todas"
  };

  const filtros = (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1">
        <Label htmlFor="exportar-colecao">Coleção</Label>
        <Select value={todasColecoes ? TODAS_COLECOES : colecao || undefined} onValueChange={trocarColecao} disabled={!colecoes || colecoes.length === 0}>
          <SelectTrigger id="exportar-colecao" className="min-w-0 [&>span]:truncate">
            <SelectValue placeholder={colecoesQ.isPending ? "Carregando…" : "Escolha uma coleção"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS_COLECOES}>Todas as coleções</SelectItem>
            {(colecoes ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        {colecoesQ.isError && (
          <p className="text-xs text-destructive">
            Não foi possível carregar as coleções.{" "}
            <button type="button" className="underline" onClick={() => void colecoesQ.refetch()}>Tentar de novo</button>
          </p>
        )}
        {colecoes && colecoes.length === 0 && (
          <p className="text-xs text-muted-foreground">Esta loja ainda não tem coleções.</p>
        )}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="exportar-subcolecao">Subcoleção</Label>
        <Select
          value={subcolecao ?? TODAS}
          onValueChange={(v) => setSubPref(v === TODAS ? [] : [v])}
          disabled={!colecao || todasColecoes || !subcolecoes}
        >
          <SelectTrigger id="exportar-subcolecao" className="min-w-0 [&>span]:truncate">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>Todas</SelectItem>
            {(subcolecoes ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {subsQ.isError && (
          <p className="text-xs text-destructive">
            Não foi possível carregar as subcoleções.{" "}
            <button type="button" className="underline" onClick={() => void subsQ.refetch()}>Tentar de novo</button>
          </p>
        )}
      </div>
    </div>
  );

  return {
    filtros,
    escolhido: colecaoEscolhida,
    pronta: subsPronta,
    chave: [todasColecoes ? "__todas_colecoes__" : colecao, subcolecao],
    avisoSemRecorte: "Escolha uma coleção (ou “Todas as coleções”) para ver a prévia.",
    avisoDependenciaErro: subsQ.isError ? "Carregue as subcoleções para ver a prévia." : null,
    chamarRpc: (campos, niveis, limite) => chamarExportar(colecaoRpc, subcolecao, campos, niveis, limite),
    nomeBaseArquivo: () => nomeBaseArquivo("produto", { colecao: colecaoRpc, subcolecao }),
  };
}

export const driverProduto: DriverRecorte = {
  tipo: "produto",
  catalogo: CAMPOS_EXPORT,
  niveis: NIVEIS_PRODUTO,
  nomeAba: NOME_ABA_PRODUTO,
  prefScreen: "integracao",
  item: { um: "produto", varios: "produtos" },
  useRecorte: useRecorteProduto,
};
