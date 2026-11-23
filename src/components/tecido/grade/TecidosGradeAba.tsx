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
import { COLUNAS_TECIDO, byKey } from "@/lib/tecido-grade/colunas";
import { CAMPO_ARTIGO } from "@/lib/tecido-grade/celulas";
import {
  agruparNovosTecidos,
  camposDaCor,
  ehBlocoColavel,
  mapearColagem,
  montarLookupsColagem,
  parseBlocoTsv,
  resumoColagem,
  type PatchColagem,
} from "@/lib/tecido-grade/colar-tsv";
import { chaveSlotNovo, montarSlots, recusaDoSlot } from "@/lib/tecido-grade/colar-slots";
import { montarLinhas, type ArtigoEntrada } from "@/lib/tecido-grade/linhas";
import { corNovaEmExistente, separarNovos, tecidoNovoVazio, type TecidoNovo } from "@/lib/tecido-grade/linha-nova";
import {
  resultadoComNovos,
  salvarEmOrdem,
  salvarTecidoNovo,
  textoErroSalvar,
  type ItemSalvar,
} from "@/lib/tecido-grade/salvar";
import { TecidosGradeTabela, type ColarProps, type RegistrarSaver, type SaverApi } from "./TecidosGradeTabela";
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
 * incompleta fica PENDENTE (em vermelho) e não trava as válidas. COLAR do Excel (Ctrl+V de um bloco TSV numa célula): vira
 * rascunho a partir da célula-âncora (cor/fornecedor/mês/ano pelo NOME; texto sem correspondência NÃO grava e avisa na célula);
 * linhas além do fim criam tecidos novos. (Foto é a task seguinte.)
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
  // Avisos da última colagem (texto que não foi aplicado), por célula `<linha>|<coluna>`. Somem ao editar a célula.
  const [avisosColar, setAvisosColar] = useState<Record<string, string>>({});
  const limparAvisoColar = useCallback((chave: string) => {
    setAvisosColar((a) => {
      if (!(chave in a)) return a;
      const { [chave]: _fora, ...resto } = a;
      void _fora;
      return resto;
    });
  }, []);
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

  const linhasRef = useRef(linhas);
  linhasRef.current = linhas;
  const opcoesRef = useRef(dados.opcoes);
  opcoesRef.current = dados.opcoes;

  // Ctrl+V de um bloco do Excel numa célula (a âncora). TUDO vira rascunho: aplica nos rascunhos existentes, atualiza as linhas
  // novas e cria tecidos novos para as linhas que passam do fim. Nada grava antes do Salvar. `false` = não é bloco (colar normal).
  const aoColar = useCallback<ColarProps["onColar"]>(({ chaveLinha: chaveDaLinha, colKey, texto }) => {
    const bloco = parseBlocoTsv(texto);
    if (!ehBlocoColavel(texto, bloco)) return false;
    const slots = montarSlots(linhasRef.current, novosRef.current);
    const linhaIdx = slots.findIndex((sl) => sl.chave === chaveDaLinha);
    const colIdx = COLUNAS_TECIDO.findIndex((c) => c.key === colKey);
    if (linhaIdx < 0 || colIdx < 0) return false;
    const opcoes = opcoesRef.current;
    const lookups = montarLookupsColagem(opcoes);
    const apelidos = opcoes.coresApelido;
    const savers = saversRef.current;
    const novosAtuais = novosRef.current;

    // o que a linha JÁ tem (apelido depende da cor base; rendimento só vale em Kg)
    const corDoSlot = (i: number): { cor_id: string; cor_apelido_id: string } => {
      const sl = slots[i];
      if (sl.tipo === "existente") {
        const v = sl.varianteId ? savers.get(sl.varianteId)?.ler() : undefined;
        return { cor_id: String(v?.cor_id ?? ""), cor_apelido_id: String(v?.cor_apelido_id ?? "") };
      }
      const cor = novosAtuais.find((g) => g.tmp === sl.grupoTmp)?.vars.find((x) => x.tmp === sl.varTmp);
      return { cor_id: cor?.cor_id ?? "", cor_apelido_id: cor?.cor_apelido_id ?? "" };
    };
    const unidadeDoSlot = (i: number): string => {
      const sl = slots[i];
      if (sl.tipo === "existente") return String(savers.get(sl.artigoId)?.ler().unidade_medida ?? "metro");
      return novosAtuais.find((g) => g.tmp === sl.grupoTmp)?.cab.unidade_medida ?? "metro";
    };

    const res = mapearColagem({ linhaIdx, colIdx }, bloco, COLUNAS_TECIDO, slots.length, {
      lookups,
      contextoLinha: (i) => ({ corId: corDoSlot(i).cor_id, unidade: unidadeDoSlot(i) }),
      aceitaCelula: (i, key) => recusaDoSlot(slots[i], byKey(key) ?? { escopo: "artigo" }),
    });

    // 1) linhas que já existem: um lote de campos por tecido e por cor (cor base antes do apelido, na ordem da grade)
    const porLinha = new Map<number, PatchColagem[]>();
    for (const p of res.patches) porLinha.set(p.linhaIdx, [...(porLinha.get(p.linhaIdx) ?? []), p]);
    for (const [i, ps] of porLinha) {
      const sl = slots[i];
      const campoTecido: Record<string, unknown> = {};
      const campoCor: Record<string, unknown> = {};
      let cor = corDoSlot(i);
      for (const p of ps) {
        const col = byKey(p.colKey);
        if (!col) continue;
        if (col.escopo === "artigo") {
          const campo = CAMPO_ARTIGO[col.key];
          if (campo) campoTecido[campo] = p.valor;
        } else {
          const c = camposDaCor(col.key, p.valor, cor, apelidos);
          Object.assign(campoCor, c);
          cor = { ...cor, ...(c as Partial<typeof cor>) };
        }
      }
      if (sl.tipo === "existente") {
        if (Object.keys(campoTecido).length) savers.get(sl.artigoId)?.aplicar(campoTecido);
        if (sl.varianteId && Object.keys(campoCor).length) savers.get(sl.varianteId)?.aplicar(campoCor);
      } else {
        setNovos((l) =>
          l.map((g) =>
            g.tmp !== sl.grupoTmp
              ? g
              : {
                  ...g,
                  cab: { ...g.cab, ...campoTecido },
                  vars: g.vars.map((v) => (v.tmp === sl.varTmp ? { ...v, ...campoCor } : v)),
                },
          ),
        );
        limparErroNovo(sl.grupoTmp);
      }
    }

    // 2) linhas além do fim = tecidos novos (linhas seguidas com o mesmo nome são cores do mesmo tecido)
    const { grupos, varTmpPorLinha, avisos: avisosNovos } = agruparNovosTecidos(res.novasLinhas, apelidos);
    if (grupos.length > 0) setNovos((l) => [...l, ...grupos]);

    // 3) avisos nas células cujo texto NÃO foi aplicado (ou foi com ressalva)
    const chaveDaLinhaColada = (i: number): string | null =>
      i < slots.length ? slots[i].chave : varTmpPorLinha[i - slots.length] ? chaveSlotNovo(varTmpPorLinha[i - slots.length]) : null;
    setAvisosColar((antes) => {
      const prox = { ...antes };
      for (const p of res.patches) {
        const k = `${slots[p.linhaIdx].chave}|${p.colKey}`;
        if (p.aviso) prox[k] = p.aviso;
        else delete prox[k];
      }
      for (const av of avisosNovos) {
        const ch = varTmpPorLinha[av.linhaNovaIdx];
        if (ch) prox[`${chaveSlotNovo(ch)}|${av.colKey}`] = av.msg;
      }
      for (const ig of res.ignoradas) {
        if (!ig.colKey || !["sem-correspondencia", "numero-invalido", "regra"].includes(ig.motivo)) continue;
        const ch = chaveDaLinhaColada(ig.linhaIdx);
        if (ch) prox[`${ch}|${ig.colKey}`] = ig.detalhe;
      }
      return prox;
    });

    const resumo = resumoColagem(res);
    const opcoesToast = resumo.detalhe ? { description: resumo.detalhe } : undefined;
    if (resumo.tom === "sucesso") toast.success(resumo.texto, opcoesToast);
    else toast.warning(resumo.texto, opcoesToast);
    return true;
  }, [limparErroNovo]);
  const colar = useMemo<ColarProps>(
    () => ({ avisos: avisosColar, onLimparAviso: limparAvisoColar, onColar: aoColar }),
    [avisosColar, limparAvisoColar, aoColar],
  );

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
      setAvisosColar({}); // o que foi colado já foi para o servidor (ou ficou em linha com erro própria)
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
        setAvisosColar({});
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
          colar={colar}
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
