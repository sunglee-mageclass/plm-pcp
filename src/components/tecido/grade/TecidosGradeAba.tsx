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
import { CardDraftsProvider, useCardDrafts } from "@/components/shared/card-drafts/CardDraftsProvider";
import { useReadOnly } from "@/components/RequirePermission";
import { mensagemErro } from "@/lib/erro-mensagem";
import { montarLinhas, type ArtigoEntrada } from "@/lib/tecido-grade/linhas";
import { corNovaEmExistente, separarNovos, tecidoNovoVazio, type TecidoNovo } from "@/lib/tecido-grade/linha-nova";
import {
  resultadoComNovos,
  salvarEmOrdem,
  salvarTecidoNovo,
  textoErroSalvar,
  type ItemSalvar,
} from "@/lib/tecido-grade/salvar";
import { TecidosGradeTabela, type RegistrarSaver, type SaverApi } from "./TecidosGradeTabela";
import type { AtualizarNovo } from "./TecidoNovoGrupo";
import { useTecidosGrade } from "./useTecidosGrade";

// Tipos mínimos (espelham o que a tela de Tecidos já carrega). Ficam aqui para não
// importar da rota (evita dependência circular).
export type GradeArtigo = {
  id: string;
  nome: string;
  empresa_id: string | null;
  categoria_tecido_id: string | null;
  preco: number | null;
  unidade_medida: string;
  largura_estimada: number | null;
  created_at: string;
};
export type GradeVariante = { artigo_id: string; foto_url: string | null; created_at: string };
export type GradeOpcao = { id: string; nome: string };

export interface TecidosGradeAbaProps {
  /** Tecidos já filtrados/ordenados pela tela (a grade mostra só estes, na mesma ordem). */
  artigos: GradeArtigo[];
  /** Variantes dos tecidos listados (a grade lê as variantes COMPLETAS da própria query). */
  variantes?: GradeVariante[];
  /** Fornecedores (id → nome) que a tela já carrega. */
  fornecedores?: GradeOpcao[];
  /** Categorias de tecido que a tela já carrega. */
  categorias?: GradeOpcao[];
  isMobile?: boolean;
}

/**
 * Aba "Lista tipo Excel" do Cadastro > Tecidos: a GRADE EDITÁVEL (1 linha por cor, cabeçalho do tecido repetido).
 * Editar só mexe em RASCUNHO (selo âmbar); NADA grava antes do Salvar. UM Salvar grava os tecidos (CAS por rev) e depois
 * as cores (CAS por campo), com resultado parcial. Também CRIA: "+ Novo tecido" / "+ adicionar variante (cor)" montam linhas NOVAS em
 * rascunho (estado desta aba, não do servidor) que o MESMO Salvar manda por `importar_tecido_linha`, depois dos editados; linha nova
 * incompleta fica PENDENTE (em vermelho) e não trava as válidas. (Colar/foto são tasks seguintes.)
 */
export function TecidosGradeAba(props: TecidosGradeAbaProps) {
  return (
    <CardDraftsProvider>
      <TecidosGradeConteudo artigos={props.artigos} />
    </CardDraftsProvider>
  );
}

function TecidosGradeConteudo({ artigos }: { artigos: GradeArtigo[] }) {
  const qc = useQueryClient();
  const dados = useTecidosGrade();
  const readOnly = useReadOnly();
  const { nSujos, descartarTodos } = useCardDrafts();
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao();

  // Linhas NOVAS (tecido novo / cor nova): rascunho só desta aba. Nada grava antes do Salvar.
  const [novos, setNovos] = useState<TecidoNovo[]>([]);
  const [errosNovos, setErrosNovos] = useState<Record<string, string>>({});
  // Depois de tentar salvar, os pendentes (faltam dados) ficam em vermelho; antes disso uma linha recém-criada não "grita".
  const [mostrarPendencias, setMostrarPendencias] = useState(false);
  const novosRef = useRef(novos);
  novosRef.current = novos;
  const limparErroNovo = useCallback((tmp: string) => {
    setErrosNovos((e) => {
      if (!(tmp in e)) return e;
      const { [tmp]: _fora, ...resto } = e;
      void _fora;
      return resto;
    });
  }, []);
  const atualizarNovo = useCallback<AtualizarNovo>(
    (tmp, fn) => {
      setNovos((l) => l.map((g) => (g.tmp === tmp ? fn(g) : g)));
      limparErroNovo(tmp);
    },
    [limparErroNovo],
  );
  const removerNovo = useCallback(
    (tmp: string) => {
      setNovos((l) => l.filter((g) => g.tmp !== tmp));
      limparErroNovo(tmp);
    },
    [limparErroNovo],
  );
  const adicionarTecido = useCallback(() => setNovos((l) => [...l, tecidoNovoVazio()]), []);
  // 1 grupo de cor nova por tecido existente (as próximas cores entram nele por "+ adicionar variante")
  const adicionarCor = useCallback(
    (artigoId: string, nome: string) =>
      setNovos((l) => (l.some((g) => g.artigoAlvoId === artigoId) ? l : [...l, corNovaEmExistente(artigoId, nome)])),
    [],
  );
  useEffect(() => {
    if (novos.length === 0) setMostrarPendencias(false);
  }, [novos.length]);
  const nTotal = nSujos + novos.length;

  // Guarda de "alterações não salvas": navegar de rota com rascunho pede confirmação (o selo está no cabeçalho).
  const { confirm } = useUnsavedGuard({ dirty: nTotal > 0, blockNav: true });

  // Cada rascunho (tecido ou cor) se registra aqui: o Salvar grava os tecidos ANTES das cores, na ordem que ESTE wrapper
  // define (a ordem de montagem do registry não serve: os filhos registram antes do pai).
  const saversRef = useRef(new Map<string, SaverApi>());
  const registrar = useCallback<RegistrarSaver>((id, api) => {
    saversRef.current.set(id, api);
    return () => {
      if (saversRef.current.get(id) === api) saversRef.current.delete(id);
    };
  }, []);

  // A tela passa os tecidos JÁ filtrados/ordenados; os dados completos (rev, variantes, categorias) vêm da query da grade.
  const linhas = useMemo(() => {
    const porId = new Map(dados.artigos.map((a) => [a.id, a]));
    const entradas: ArtigoEntrada[] = [];
    for (const a of artigos) {
      const g = porId.get(a.id);
      if (g) entradas.push({ ...g, categorias: dados.catsPorArtigo.get(a.id) ?? [] });
    }
    return montarLinhas(entradas, dados.variantesPorArtigo);
  }, [artigos, dados.artigos, dados.catsPorArtigo, dados.variantesPorArtigo]);

  const salvarMut = useMutation({
    mutationFn: async () => {
      const ctx = { limite: Date.now() + 5000 }; // UM prazo comum (prévias de preço), não N × 5 s
      const itens = Array.from(saversRef.current.entries()).map(([id, api]) => ({ id, kind: api.kind, item: { id, dirty: api.dirty, salvar: api.salvar } as ItemSalvar }));
      const resultado = await salvarEmOrdem(
        itens.filter((i) => i.kind === "artigo").map((i) => i.item),
        itens.filter((i) => i.kind === "variante").map((i) => i.item),
        ctx,
      );
      // NOVOS depois dos editados: acrescentar cor a um tecido que existe sobe o `artigos.rev` (trigger) e faria o UPDATE do tecido
      // editado dar conflito falso se fosse antes. Só os VÁLIDOS vão; os pendentes ficam na tela (resultado parcial).
      const { validos, pendentes } = separarNovos(novosRef.current);
      const criados: string[] = [];
      const erros: Record<string, string> = {};
      for (const g of validos) {
        try {
          await salvarTecidoNovo(g);
          criados.push(g.tmp);
        } catch (e) {
          erros[g.tmp] = textoErroSalvar(e);
        }
      }
      // Cada cor salva sobe o `artigos.rev` por trigger: relê tudo ANTES de liberar o próximo Salvar (senão ele mandaria um
      // rev velho = conflito falso contra o próprio save). Falha na releitura é inofensiva: o refetch normal cobre.
      // A lista da tela (`["artigos"]`) também é relida ANTES de limpar o rascunho: o tecido novo não pode "piscar" e sumir.
      try {
        await Promise.all([
          ...["artigos", "variantes", "artigo-categorias"].map((k) => qc.refetchQueries({ queryKey: ["tecidos-grade", k] })),
          ...(criados.length > 0 ? [qc.refetchQueries({ queryKey: ["artigos"] })] : []),
        ]);
      } catch { /* a próxima leitura atualiza */ }
      return { resultado, criados, erros, pendentes: pendentes.length };
    },
    onSuccess: ({ resultado: r, criados, erros, pendentes }) => {
      // grupos gravados saem do rascunho (um 2º Salvar não os reenvia); falhos e pendentes ficam, com o aviso na linha
      setNovos((l) => l.filter((g) => !criados.includes(g.tmp)));
      setErrosNovos(erros);
      const { tom, texto } = resultadoComNovos(r, { criados: criados.length, erros: Object.keys(erros).length, pendentes });
      if (tom === "sucesso") toast.success(texto);
      else if (tom === "aviso") toast.warning(texto);
      else toast.error(texto);
      // A visão Cards e o Sheet leem outras queries: marca como velhas (a grade já foi relida acima).
      for (const k of ["artigos", "artigo", "artigo-cats", "artigo-cats-all", "variantes", "variantes-thumb"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const pedirDescartar = () =>
    pedirConfirmacao({
      titulo: "Descartar alterações?",
      descricao: "Há alterações não salvas na lista de tecidos.",
      confirmar: "Descartar",
      cancelar: "Continuar editando",
      destrutivo: true,
      onConfirmar: () => {
        descartarTodos();
        setNovos([]);
        setErrosNovos({});
        setMostrarPendencias(false);
      },
    });

  const { nTecidos, nCores } = useMemo(
    () => ({ nTecidos: new Set(linhas.map((l) => l.artigoId)).size, nCores: linhas.filter((l) => l.variante).length }),
    [linhas],
  );
  const barraVisivel = !readOnly && (nTotal > 0 || salvarMut.isPending);
  // Erro honesto: nunca mostrar "vazio" quando a leitura falhou. Com rascunho em edição a tabela fica (não perder o que
  // foi digitado); sem rascunho, só o aviso.
  const mostrarTabela = !dados.isLoading && (!dados.isError || nTotal > 0);

  return (
    <div className={barraVisivel ? "space-y-3 pb-24" : "space-y-3"} data-testid="tecidos-grade-aba">
      <Card className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{nTecidos}</Badge>
        {nTecidos === 1 ? "tecido" : "tecidos"} ·
        <Badge variant="secondary">{nCores}</Badge>
        {nCores === 1 ? "cor" : "cores"}
        <UnsavedIndicator show={nTotal > 0} className="ml-auto shrink-0" />
      </Card>

      {dados.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>Não foi possível carregar a lista de tecidos.</span>
          <Button size="sm" variant="outline" className="ml-auto" disabled={dados.recarregando} onClick={() => void dados.recarregar()}>
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
        <TecidosGradeTabela
          linhas={linhas}
          opcoes={dados.opcoes}
          readOnly={readOnly}
          registrar={registrar}
          novos={{
            novos,
            mostrarPendencias,
            errosNovos,
            onAtualizarNovo: atualizarNovo,
            onRemoverNovo: removerNovo,
            onNovoTecido: adicionarTecido,
            onNovaCor: adicionarCor,
          }}
        />
      )}

      {barraVisivel && (
        <PageActionBar>
          <Button type="button" variant="outline" disabled={salvarMut.isPending} onClick={pedirDescartar}>
            <Undo2 className="mr-1 h-4 w-4" /> Descartar alterações
          </Button>
          <Button
            type="button"
            className="ml-auto"
            disabled={salvarMut.isPending || nTotal === 0}
            onClick={() => {
              setMostrarPendencias(true);
              salvarMut.mutate();
            }}
          >
            {salvarMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Salvar{nTotal > 0 ? ` (${nTotal})` : ""}
          </Button>
        </PageActionBar>
      )}

      {dialogConfirmacao}
      <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas na lista de tecidos." />
    </div>
  );
}
