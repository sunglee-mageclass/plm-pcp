import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import {
  CardDraftsProvider,
  useCardDrafts,
} from "@/components/shared/card-drafts/CardDraftsProvider";
import { useReadOnly } from "@/components/RequirePermission";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { SortDir } from "@/components/shared/sort";
import { byKey } from "@/lib/aviamento-grade/colunas";
import { opcoesDaColuna } from "@/lib/aviamento-grade/celulas";
import { ordenarLinhasPorColuna } from "@/lib/aviamento-grade/ordenar";
import {
  montarLinhas,
  type AviamentoEntrada,
  type ResolverRotulo,
} from "@/lib/aviamento-grade/linhas";
import {
  salvarEmOrdem,
  textoResultadoSalvar,
  type ItemAviamento,
  type ItemVariante,
} from "@/lib/aviamento-grade/salvar";
import {
  AviamentosGradeTabela,
  type OrdenacaoProps,
  type RegistrarSaver,
  type SaverApi,
} from "./AviamentosGradeTabela";
import { useAviamentosGrade } from "./useAviamentosGrade";

export interface AviamentosGradeAbaProps {
  /** Aviamentos já filtrados pela tela (a grade mostra só estes, na mesma ordem). Sem a prop, mostra todos os da loja. */
  aviamentos?: { id: string }[];
  isMobile?: boolean;
  /**
   * Avisa a tela-mãe quando há rascunho não salvo. A tela usa isto para pedir confirmação ANTES de trocar de visão (Cards) ou de
   * filtro/busca — senão a grade desmonta e o rascunho se perde calado. Ao desmontar avisa `false`.
   */
  onDirtyChange?: (sujo: boolean) => void;
}

/**
 * Aba "Lista tipo Excel" do Cadastro > Aviamentos: a GRADE EDITÁVEL (1 linha-pai por aviamento + 1 linha por cor, nascem recolhidas).
 * Editar só mexe em RASCUNHO (selo âmbar); NADA grava antes do Salvar. UM Salvar grava os cabeçalhos (UPDATE direto, "último vence":
 * aviamento não tem `rev`) e depois as cores (UMA chamada de lote `salvar_variantes_aviamento` por aviamento tocado, com o conjunto
 * completo), com resultado parcial. A foto da cor grava NA HORA (binário). Criar/colar/excluir ficam para a AV-3.
 */
export function AviamentosGradeAba(props: AviamentosGradeAbaProps) {
  return (
    <CardDraftsProvider>
      <AviamentosGradeConteudo
        aviamentos={props.aviamentos}
        isMobile={props.isMobile}
        onDirtyChange={props.onDirtyChange}
      />
    </CardDraftsProvider>
  );
}

function AviamentosGradeConteudo({ aviamentos, isMobile, onDirtyChange }: AviamentosGradeAbaProps) {
  const qc = useQueryClient();
  const dados = useAviamentosGrade();
  const readOnly = useReadOnly();
  const { nSujos, descartarTodos } = useCardDrafts();
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao();
  const nTotal = nSujos;

  // Avisa a tela-mãe do rascunho (para ela guardar a troca de visão/filtro). Ao desmontar (fechou a Lista) volta a "limpo".
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(nTotal > 0);
  }, [nTotal]);
  useEffect(() => () => onDirtyRef.current?.(false), []);

  // Guarda de "alterações não salvas": navegar de rota com rascunho pede confirmação (o selo está no cabeçalho).
  const { confirm } = useUnsavedGuard({ dirty: nTotal > 0, blockNav: true });

  // Cada rascunho (aviamento ou cor) se registra aqui: o Salvar grava os aviamentos ANTES das cores, na ordem que ESTE wrapper
  // define (a ordem de montagem do registry não serve: os filhos registram antes do pai).
  const saversRef = useRef(new Map<string, SaverApi>());
  const registrar = useCallback<RegistrarSaver>((id, api) => {
    saversRef.current.set(id, api);
    return () => {
      if (saversRef.current.get(id) === api) saversRef.current.delete(id);
    };
  }, []);

  // A tela passa os aviamentos JÁ filtrados/ordenados; os dados completos (variantes, ncm, observações…) vêm da query da grade.
  const linhasServidor = useMemo(() => {
    const porId = new Map(dados.aviamentos.map((a) => [a.id, a]));
    const ids = aviamentos ? aviamentos.map((a) => a.id) : dados.aviamentos.map((a) => a.id);
    const entradas: AviamentoEntrada[] = [];
    for (const id of ids) {
      const g = porId.get(id);
      if (g) entradas.push(g);
    }
    return montarLinhas(entradas, dados.variantesPorAviamento);
  }, [aviamentos, dados.aviamentos, dados.variantesPorAviamento]);

  // ORDENAÇÃO por coluna (clicar no cabeçalho: asc → desc). Sem clique = a ordem que a tela entregou. Ordena os GRUPOS (aviamentos)
  // pelo valor SALVO, nunca pelo rascunho, e deixa as cores de um aviamento juntas (ver `aviamento-grade/ordenar.ts`).
  const [ord, setOrd] = useState<{ key: string; dir: SortDir } | null>(null);
  const alternarOrdem = useCallback(
    (key: string) =>
      setOrd((o) =>
        o?.key === key ? { key, dir: o.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
      ),
    [],
  );
  // coluna de seleção guarda ID; ordena pelo NOME mostrado (fornecedor, categoria, subcategoria, material, intervalo, cor base/apelido)
  const rotulos = useMemo(() => {
    const mapa = new Map<string, Map<string, string>>();
    for (const k of [
      "fornecedor",
      "categoria",
      "subcategoria",
      "material",
      "intervalo_largura",
      "cor_base",
      "cor_apelido",
    ]) {
      mapa.set(k, new Map(opcoesDaColuna(k, dados.opcoes).map((x) => [x.id, x.nome])));
    }
    return mapa;
  }, [dados.opcoes]);
  const linhas = useMemo(() => {
    const col = ord ? byKey(ord.key) : undefined;
    if (!ord || !col) return linhasServidor;
    const resolver: ResolverRotulo = (colKey, id) => rotulos.get(colKey)?.get(id);
    return ordenarLinhasPorColuna(linhasServidor, col, ord.dir, resolver);
  }, [linhasServidor, ord, rotulos]);
  const ordenacao = useMemo<OrdenacaoProps>(
    () => ({ sortKey: ord?.key ?? null, sortDir: ord?.dir ?? "asc", toggle: alternarOrdem }),
    [ord, alternarOrdem],
  );

  const salvarMut = useMutation({
    mutationFn: async () => {
      const ctx = { limite: Date.now() + 5000 };
      const itens = Array.from(saversRef.current.entries());
      const aviamentosSujos: ItemAviamento[] = [];
      const variantesSujas: ItemVariante[] = [];
      for (const [id, api] of itens) {
        if (api.kind === "aviamento")
          aviamentosSujos.push({ id, dirty: api.dirty, salvar: api.salvar });
        else
          variantesSujas.push({
            id,
            aviamentoId: api.aviamentoId,
            dirty: api.dirty,
            mudancas: api.mudancas,
            salvar: api.salvar,
          });
      }
      const resultado = await salvarEmOrdem(aviamentosSujos, variantesSujas, ctx);
      // Relê a grade ANTES de liberar o próximo Salvar (a base do rascunho vem da leitura). Falha na releitura é inofensiva: o
      // refetch normal cobre. A lista da tela (`["aviamentos"]`) também é relida, para o card/ordem não ficarem velhos.
      try {
        await Promise.all([
          ...["aviamentos", "variantes"].map((k) =>
            qc.refetchQueries({ queryKey: ["aviamentos-grade", k] }),
          ),
          qc.refetchQueries({ queryKey: ["aviamentos"] }),
        ]);
      } catch {
        /* a próxima leitura atualiza */
      }
      return resultado;
    },
    onSuccess: (r) => {
      const { tom, texto } = textoResultadoSalvar(r);
      if (tom === "sucesso") toast.success(texto);
      else if (tom === "aviso") toast.warning(texto);
      else toast.error(texto);
      // A visão Cards e o Sheet leem outras queries: marca como velhas (a grade já foi relida acima).
      for (const k of ["aviamentos", "aviamentos-variantes"])
        qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const pedirDescartar = () =>
    pedirConfirmacao({
      titulo: "Descartar alterações?",
      descricao: "Há alterações não salvas na lista de aviamentos.",
      confirmar: "Descartar",
      cancelar: "Continuar editando",
      destrutivo: true,
      onConfirmar: () => descartarTodos(),
    });

  const { nAviamentos, nVariantes } = useMemo(
    () => ({
      nAviamentos: new Set(linhas.map((l) => l.aviamentoId)).size,
      nVariantes: linhas.filter((l) => l.variante).length,
    }),
    [linhas],
  );
  const barraVisivel = !readOnly && (nTotal > 0 || salvarMut.isPending);
  // Erro honesto: nunca mostrar "vazio" quando a leitura falhou. Com rascunho em edição a tabela fica (não perder o que
  // foi digitado); sem rascunho, só o aviso.
  const mostrarTabela = !isMobile && !dados.isLoading && (!dados.isError || nTotal > 0);

  return (
    <div
      className={barraVisivel ? "space-y-3 pb-24" : "space-y-3"}
      data-testid="aviamentos-grade-aba"
    >
      <Card className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{nAviamentos}</Badge>
        {nAviamentos === 1 ? "aviamento" : "aviamentos"} ·
        <Badge variant="secondary">{nVariantes}</Badge>
        {nVariantes === 1 ? "variante" : "variantes"}
        <UnsavedIndicator show={nTotal > 0} className="ml-auto shrink-0" />
      </Card>

      {dados.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>Não foi possível carregar a lista de aviamentos.</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={dados.recarregando}
            onClick={() => void dados.recarregar()}
          >
            {dados.recarregando ? "Tentando…" : "Tentar de novo"}
          </Button>
        </div>
      )}

      {dados.isLoading && (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="mr-2 inline h-5 w-5 animate-spin" />
          Carregando…
        </div>
      )}

      {mostrarTabela && (
        <AviamentosGradeTabela
          linhas={linhas}
          opcoes={dados.opcoes}
          readOnly={readOnly}
          registrar={registrar}
          ordenacao={ordenacao}
        />
      )}

      {barraVisivel && (
        <PageActionBar>
          <Button
            type="button"
            variant="outline"
            disabled={salvarMut.isPending}
            onClick={pedirDescartar}
          >
            <Undo2 className="mr-1 h-4 w-4" /> Descartar alterações
          </Button>
          <Button
            type="button"
            className="ml-auto"
            disabled={salvarMut.isPending || nTotal === 0}
            onClick={() => salvarMut.mutate()}
          >
            {salvarMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Salvar{nTotal > 0 ? ` (${nTotal})` : ""}
          </Button>
        </PageActionBar>
      )}

      {dialogConfirmacao}
      <UnsavedChangesGuard
        confirm={confirm}
        message="Há alterações não salvas na lista de aviamentos."
      />
    </div>
  );
}
