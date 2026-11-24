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
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  estadoIntegracaoFresco,
  invalidarEstadoSeTravado,
  type EstadoModeloIntegracao,
} from "@/lib/integracao/trava";
import type { SortDir } from "@/components/shared/sort";
import { assinaturaPermissoes, byKey, colunasVisiveis } from "@/lib/produto-grade/colunas";
import {
  montarLinhas,
  modelosNaOrdemDaTela,
  type ModeloGradeEntrada,
} from "@/lib/produto-grade/linhas";
import { ordenarLinhasProduto } from "@/lib/produto-grade/ordenar";
import { resolverRotulosProduto } from "@/lib/produto-grade/celulas";
import { resumoSalvar, type ResultadoLinha } from "@/lib/produto-grade/resumo";
import { ProdutosGradeTabela, type OrdenacaoProps, type SalvarCtx } from "./ProdutosGradeTabela";
import { lerModeloGrade, useProdutosGrade } from "./useProdutosGrade";

export interface ProdutosGradeAbaProps {
  /**
   * Produtos já filtrados E ORDENADOS pela tela (a grade mostra só estes, NA MESMA ORDEM — a do filtro/ordenação do Planejamento).
   * Sem a prop, mostra todos os da loja, na ordem da consulta.
   */
  modelos?: { id: string }[];
  isMobile?: boolean;
  /**
   * Avisa a tela-mãe quando há rascunho não salvo (editado). A tela usa isto para pedir confirmação ANTES de trocar de visão (Cards), de
   * busca ou de filtro — senão a grade desmonta/esvazia e o rascunho se perde calado. Ao desmontar avisa `false`.
   */
  onDirtyChange?: (sujo: boolean) => void;
  /**
   * PR-GRADE-2 — abre o Sheet do produto JÁ na seção pedida (`grade` no interno, `grade_revenda` no comprado). A tela-mãe decide como
   * (hoje: `setOpenId` + seção inicial — Sheet lateral, sem trocar de página). Ausente = a linha expandida não mostra o botão.
   */
  onAbrirNoSheet?: (modeloId: string, secao: string) => void;
}

/**
 * Aba "Lista tipo Excel" do Planejamento de Produto: a GRADE EDITÁVEL (1 linha por modelo, sem pai/filhos). Só EDITA os que já existem
 * (criar = "Novo Modelo"; colar do Excel vem na PR-3). Editar só mexe em RASCUNHO (selo âmbar); NADA grava antes do Salvar. UM Salvar
 * grava cada produto tocado com o CAS por `rev` (P0409 = alguém salvou antes: recarrega SÓ aquela linha e avisa), sem derrubar as outras.
 * Quem edita o quê (permissão, origem, trava da Integração) é `colunaEditavelNoProduto`; status/REF/SKU/custos são só-leitura.
 * Erro de leitura é honesto: aviso + "Tentar de novo", nunca "0 produtos".
 */
export function ProdutosGradeAba(props: ProdutosGradeAbaProps) {
  return (
    <CardDraftsProvider>
      <ProdutosGradeConteudo {...props} />
    </CardDraftsProvider>
  );
}

const QUERY_GRADE = ["modelos-planejamento", "grade"] as const;

function ProdutosGradeConteudo({
  modelos,
  isMobile,
  onDirtyChange,
  onAbrirNoSheet,
}: ProdutosGradeAbaProps) {
  const qc = useQueryClient();
  const dados = useProdutosGrade();
  const readOnly = useReadOnly();
  const tz = useStoreTimezone();
  const { nSujos, descartarTodos, salvarTodos } = useCardDrafts();
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao();
  const nTotal = nSujos;

  // Avisa a tela-mãe do rascunho (para ela guardar a troca de visão/busca/filtro). Ao desmontar (fechou a Lista) volta a "limpo".
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(nTotal > 0);
  }, [nTotal]);
  useEffect(() => () => onDirtyRef.current?.(false), []);

  // Guarda de "alterações não salvas": navegar de rota com rascunho pede confirmação.
  const { confirm } = useUnsavedGuard({ dirty: nTotal > 0, blockNav: true });

  // Segue a ORDEM da tela (`modelos` já vem filtrado/ordenado); produto que a consulta da grade ainda não trouxe fica de fora.
  const visiveis = useMemo(
    () => (modelos ? modelosNaOrdemDaTela(dados.modelos, modelos) : dados.modelos),
    [dados.modelos, modelos],
  );
  const linhasServidor = useMemo(() => montarLinhas(visiveis), [visiveis]);

  // ORDENAÇÃO por coluna (clicar no cabeçalho: asc → desc). Sem clique = a ordem que a tela entregou. Ordena pelo valor SALVO (nunca o
  // rascunho). Fica AQUI (e não na tabela) para o teclado e, na PR-3, o colar seguirem a ordem da TELA: tudo lê as mesmas `linhas`.
  const [ord, setOrd] = useState<{ key: string; dir: SortDir } | null>(null);
  const alternarOrdem = useCallback(
    (key: string) =>
      setOrd((o) =>
        o?.key === key ? { key, dir: o.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
      ),
    [],
  );
  const resolver = useMemo(() => resolverRotulosProduto(dados.opcoes), [dados.opcoes]);
  const linhas = useMemo(() => {
    const col = ord ? byKey(ord.key) : undefined;
    if (!ord || !col) return linhasServidor;
    return ordenarLinhasProduto(linhasServidor, col, ord.dir, resolver);
  }, [linhasServidor, ord, resolver]);
  const ordenacao = useMemo<OrdenacaoProps>(
    () => ({ sortKey: ord?.key ?? null, sortDir: ord?.dir ?? "asc", toggle: alternarOrdem }),
    [ord, alternarOrdem],
  );

  // Permissões: as colunas visíveis só mudam quando o RESULTADO muda (canView/canEdit do useAuth mudam de identidade a cada render).
  const permissoesKey = assinaturaPermissoes(dados.canView, dados.canEdit);
  const colunasVis = useMemo(
    () => colunasVisiveis(dados.canView, dados.canEdit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissoesKey],
  );

  // --- contexto do Salvar (tudo por REF: lido no instante de salvar) ---
  const estadosRef = useRef<Record<string, EstadoModeloIntegracao>>(dados.estadosIntegracao);
  // Durante o Salvar o estado vale o RELIDO (abaixo): um re-render no meio NÃO pode devolver o do cache, mais velho.
  const salvandoRef = useRef(false);
  if (!salvandoRef.current) estadosRef.current = dados.estadosIntegracao;
  const integracaoProntaRef = useRef(dados.integracaoPronta);
  integracaoProntaRef.current = dados.integracaoPronta;
  const canEditRef = useRef(dados.canEdit);
  canEditRef.current = dados.canEdit;
  const opcoesRef = useRef(dados.opcoes);
  opcoesRef.current = dados.opcoes;
  const resultadosRef = useRef<ResultadoLinha[]>([]);
  const revSalvoRef = useRef(new Map<string, number>());

  const reportar = useCallback((r: ResultadoLinha) => {
    resultadosRef.current.push(r);
  }, []);
  // P0409: relê SÓ aquele modelo e troca a linha no cache (o resto da grade — e o rascunho das outras linhas — não se mexe). Se o modelo
  // não existe mais, a linha FICA (o aviso diz que sumiu; o refetch normal a tira) — nunca some calada com o rascunho dentro.
  const recarregarLinha = useCallback(
    async (id: string) => {
      const fresco = await lerModeloGrade(id);
      if (fresco) {
        qc.setQueryData<ModeloGradeEntrada[]>(QUERY_GRADE, (old) =>
          old ? old.map((m) => (m.id === id ? fresco : m)) : old,
        );
      }
      return fresco;
    },
    [qc],
  );
  const aoErro = useCallback((e: unknown) => invalidarEstadoSeTravado(qc, e), [qc]);
  const salvarCtx = useMemo<SalvarCtx>(
    () => ({
      estadosRef,
      integracaoProntaRef,
      canEditRef,
      opcoesRef,
      reportar,
      recarregarLinha,
      aoErro,
      revSalvoRef,
    }),
    [reportar, recarregarLinha, aoErro],
  );

  const salvarMut = useMutation({
    mutationFn: async () => {
      resultadosRef.current = [];
      revSalvoRef.current = new Map();
      salvandoRef.current = true;
      try {
        // A trava vale pelo estado de AGORA (não pelo do render): outra pessoa pode ter marcado o produto depois de a Lista abrir.
        try {
          estadosRef.current = await estadoIntegracaoFresco(qc);
        } catch {
          /* sem releitura: vale o último estado conhecido (o banco recusa o que estiver travado) */
        }
        await salvarTodos({ limite: Date.now() + 5000 });
      } finally {
        salvandoRef.current = false;
      }
      // Relê a grade ANTES de liberar o próximo Salvar: o `rev` novo e os valores que os gatilhos mexeram (REF, espelho) chegam juntos.
      try {
        await qc.refetchQueries({ queryKey: QUERY_GRADE });
      } catch {
        /* a próxima leitura atualiza */
      }
      return resultadosRef.current;
    },
    onSuccess: (resultados) => {
      const r = resumoSalvar(resultados);
      const opts = r.detalhe ? { description: r.detalhe } : undefined;
      if (r.tom === "sucesso") toast.success(r.texto, opts);
      else if (r.tom === "aviso") toast.warning(r.texto, opts);
      else toast.error(r.texto, opts);
      // O card (visão Cards), o Sheet, o OTB e o Plan. Tecido leem outras queries: marca como velhas (a grade já foi relida acima).
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"], exact: true });
      qc.invalidateQueries({ queryKey: ["modelo"] });
      qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
      qc.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey?.[0] === "string" &&
          (q.queryKey[0] as string).startsWith("plan-tecido"),
      });
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const pedirDescartar = () =>
    pedirConfirmacao({
      titulo: "Descartar alterações?",
      descricao: "Há alterações não salvas na lista de produtos.",
      confirmar: "Descartar",
      cancelar: "Continuar editando",
      destrutivo: true,
      onConfirmar: () => descartarTodos(),
    });

  const nProdutos = linhas.length;
  const barraVisivel = !readOnly && !isMobile && (nTotal > 0 || salvarMut.isPending);
  // Erro honesto: nunca mostrar "vazio" quando a leitura falhou. Com rascunho em edição a tabela fica (não perder o que foi digitado);
  // sem rascunho, só o aviso.
  const mostrarTabela = !isMobile && !dados.isLoading && (!dados.isError || nTotal > 0);
  const verificandoIntegracao =
    !dados.integracaoPronta && !dados.integracaoErro && !dados.isLoading;

  return (
    <div
      className={barraVisivel ? "space-y-3 pb-24" : "space-y-3"}
      data-testid="produtos-grade-aba"
    >
      {/* Contagem só com dado confiável: carregando ou com erro, "0 produtos" seria mentira (C3). */}
      {!dados.isLoading && !dados.isError && (
        <Card className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{nProdutos}</Badge>
          {nProdutos === 1 ? "produto" : "produtos"}
          {verificandoIntegracao && (
            <span
              className="inline-flex items-center gap-1 text-xs"
              data-testid="verificando-integracao"
            >
              <Loader2 className="h-3 w-3 animate-spin" /> verificando a Integração…
            </span>
          )}
          <UnsavedIndicator show={nTotal > 0} className="ml-auto shrink-0" />
        </Card>
      )}

      {dados.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>Não foi possível carregar a lista de produtos.</span>
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

      {/* A Integração não respondeu: os campos que ela pode travar ficam BLOQUEADOS (nunca livres) até saber. */}
      {!dados.isLoading && dados.integracaoErro && (
        <div
          role="alert"
          data-testid="integracao-erro"
          className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <span>
            Não foi possível verificar a Integração. Os campos que ela pode travar ficam bloqueados
            até a verificação funcionar.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={dados.integracaoRecarregando}
            onClick={() => void dados.recarregarIntegracao()}
          >
            {dados.integracaoRecarregando ? "Tentando…" : "Tentar de novo"}
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
        <ProdutosGradeTabela
          linhas={linhas}
          colunasVisiveis={colunasVis}
          opcoes={dados.opcoes}
          otbOn={dados.otbOn}
          readOnly={readOnly}
          integracaoPronta={dados.integracaoPronta}
          estadosIntegracao={dados.estadosIntegracao}
          permissoesKey={permissoesKey}
          canEdit={dados.canEdit}
          tz={tz}
          resolver={resolver}
          salvar={salvarCtx}
          ordenacao={ordenacao}
          abrirNoSheet={onAbrirNoSheet}
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
            // P-57: sem a 1ª carga completa (modelos + opções + módulos) o Salvar fica desabilitado.
            disabled={salvarMut.isPending || nTotal === 0 || dados.isLoading}
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
        message="Há alterações não salvas na lista de produtos."
      />
    </div>
  );
}
