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
import { byKey } from "@/lib/insumo-grade/colunas";
import { opcoesDaColuna } from "@/lib/insumo-grade/celulas";
import { ordenarLinhasPorColuna } from "@/lib/insumo-grade/ordenar";
import { montarLinhas, type ResolverRotulo } from "@/lib/insumo-grade/linhas";
import { salvarEmOrdem, textoResultadoSalvar, type ItemInsumo } from "@/lib/insumo-grade/salvar";
import {
  InsumosGradeTabela,
  type OrdenacaoProps,
  type RegistrarSaver,
  type SaverApi,
} from "./InsumosGradeTabela";
import { useInsumosGrade } from "./useInsumosGrade";

export interface InsumosGradeAbaProps {
  /** Insumos já filtrados pela tela (a grade mostra só estes, na mesma ordem). Sem a prop, mostra todos os da loja. */
  etiquetas?: { id: string }[];
  isMobile?: boolean;
  /**
   * Avisa a tela-mãe quando há rascunho não salvo. A tela usa isto para pedir confirmação ANTES de trocar de visão (Cards) ou de
   * filtro/busca — senão a grade desmonta e o rascunho se perde calado. Ao desmontar avisa `false`.
   */
  onDirtyChange?: (sujo: boolean) => void;
}

/**
 * Aba "Lista tipo Excel" do Cadastro > Insumos: a GRADE EDITÁVEL (1 linha-pai por insumo + 1 linha por cor, nascem recolhidas).
 * Editar só mexe em RASCUNHO (selo âmbar); NADA grava antes do Salvar. UM Salvar grava cada insumo sujo na ordem da tela: o
 * cabeçalho por UPDATE direto ("último vence": insumo não tem `rev`) e, se as cores mudaram, as variantes por delete-and-reinsert
 * (cor × tamanhos), com resultado parcial (o insumo que falha fica sujo, com o aviso na própria linha). Esta fase (IN-2) só EDITA os
 * insumos que já existem: criar, colar do Excel e excluir vêm na IN-3.
 */
export function InsumosGradeAba(props: InsumosGradeAbaProps) {
  return (
    <CardDraftsProvider>
      <InsumosGradeConteudo
        etiquetas={props.etiquetas}
        isMobile={props.isMobile}
        onDirtyChange={props.onDirtyChange}
      />
    </CardDraftsProvider>
  );
}

function InsumosGradeConteudo({ etiquetas, isMobile, onDirtyChange }: InsumosGradeAbaProps) {
  const qc = useQueryClient();
  const dados = useInsumosGrade();
  const readOnly = useReadOnly();
  const { nSujos, descartarTodos } = useCardDrafts();
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao();

  // Avisa a tela-mãe do rascunho (para ela guardar a troca de visão/filtro). Ao desmontar (fechou a Lista) volta a "limpo".
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(nSujos > 0);
  }, [nSujos]);
  useEffect(() => () => onDirtyRef.current?.(false), []);

  // Guarda de "alterações não salvas": navegar de rota com rascunho pede confirmação (o selo está no cabeçalho).
  const { confirm } = useUnsavedGuard({ dirty: nSujos > 0, blockNav: true });

  // Cada rascunho (insumo) se registra aqui: o Salvar grava na ordem que ESTE wrapper define.
  const saversRef = useRef(new Map<string, SaverApi>());
  const registrar = useCallback<RegistrarSaver>((id, api) => {
    saversRef.current.set(id, api);
    return () => {
      if (saversRef.current.get(id) === api) saversRef.current.delete(id);
    };
  }, []);

  // A tela passa os insumos JÁ filtrados; os dados completos (cores, tamanhos…) vêm da query da grade.
  const visiveis = useMemo(() => {
    if (!etiquetas) return dados.etiquetas;
    // a ordem é a da lista que a tela entregou (filtrada/ordenada por ela); id que a leitura da grade não trouxe fica de fora
    const porId = new Map(dados.etiquetas.map((e) => [e.id, e]));
    return etiquetas.flatMap((e) => {
      const g = porId.get(e.id);
      return g ? [g] : [];
    });
  }, [dados.etiquetas, etiquetas]);
  const linhasServidor = useMemo(
    () => montarLinhas(visiveis, dados.blocosPorEtiqueta),
    [visiveis, dados.blocosPorEtiqueta],
  );

  // ORDENAÇÃO por coluna (clicar no cabeçalho: asc → desc). Sem clique = a ordem que a tela entregou. Ordena os GRUPOS (insumos)
  // pelo valor SALVO, nunca pelo rascunho, e deixa as cores de um insumo juntas (ver `insumo-grade/ordenar.ts`).
  const [ord, setOrd] = useState<{ key: string; dir: SortDir } | null>(null);
  const alternarOrdem = useCallback(
    (key: string) =>
      setOrd((o) =>
        o?.key === key ? { key, dir: o.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
      ),
    [],
  );
  // coluna de seleção guarda ID; ordena pelo NOME mostrado (tipo, fornecedor, cor)
  const rotulos = useMemo(() => {
    const mapa = new Map<string, Map<string, string>>();
    for (const k of ["tipo_insumo", "fornecedor", "cor"]) {
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
      // na ordem em que a tela mostra os insumos (o Map registra na ordem de montagem, que não é a da tela)
      const ordemTela = Array.from(new Set(linhas.map((l) => l.insumoId)));
      const sujos: ItemInsumo[] = [];
      for (const id of ordemTela) {
        const api = saversRef.current.get(id);
        if (api) sujos.push({ id, dirty: api.dirty, salvar: api.salvar });
      }
      const resultado = await salvarEmOrdem(sujos, ctx);
      // Relê a grade ANTES de liberar o próximo Salvar (a base do rascunho vem da leitura). Falha na releitura é inofensiva: o
      // refetch normal cobre. A lista da tela (`["etiquetas-cadastro"]`) também é relida/invalidada: o Cards e o Sheet leem outra query.
      try {
        await Promise.all(
          ["etiquetas", "variantes"].map((k) =>
            qc.refetchQueries({ queryKey: ["insumos-grade", k] }),
          ),
        );
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
      for (const k of ["etiquetas-cadastro", "etiquetas-opts"])
        qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const pedirDescartar = () =>
    pedirConfirmacao({
      titulo: "Descartar alterações?",
      descricao: "Há alterações não salvas na lista de insumos.",
      confirmar: "Descartar",
      cancelar: "Continuar editando",
      destrutivo: true,
      onConfirmar: () => descartarTodos(),
    });

  const { nInsumos, nCores } = useMemo(
    () => ({
      nInsumos: new Set(linhas.map((l) => l.insumoId)).size,
      nCores: linhas.filter((l) => l.bloco).length,
    }),
    [linhas],
  );
  const barraVisivel = !readOnly && (nSujos > 0 || salvarMut.isPending);
  // Erro honesto: nunca mostrar "vazio" quando a leitura falhou. Com rascunho em edição a tabela fica (não perder o que
  // foi digitado); sem rascunho, só o aviso.
  const mostrarTabela = !isMobile && !dados.isLoading && (!dados.isError || nSujos > 0);

  return (
    <div className={barraVisivel ? "space-y-3 pb-24" : "space-y-3"} data-testid="insumos-grade-aba">
      {/* Contagem só com dado confiável: carregando ou com erro, "0 insumos" seria mentira (C3). */}
      {!dados.isLoading && !dados.isError && (
        <Card className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{nInsumos}</Badge>
          {nInsumos === 1 ? "insumo" : "insumos"} ·<Badge variant="secondary">{nCores}</Badge>
          {nCores === 1 ? "cor" : "cores"}
          <UnsavedIndicator show={nSujos > 0} className="ml-auto shrink-0" />
        </Card>
      )}

      {dados.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>Não foi possível carregar a lista de insumos.</span>
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
        <InsumosGradeTabela
          linhas={linhas}
          blocosPorEtiqueta={dados.blocosPorEtiqueta}
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
            disabled={salvarMut.isPending || nSujos === 0}
            onClick={() => salvarMut.mutate()}
          >
            {salvarMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Salvar{nSujos > 0 ? ` (${nSujos})` : ""}
          </Button>
        </PageActionBar>
      )}

      {dialogConfirmacao}
      <UnsavedChangesGuard
        confirm={confirm}
        message="Há alterações não salvas na lista de insumos."
      />
    </div>
  );
}
