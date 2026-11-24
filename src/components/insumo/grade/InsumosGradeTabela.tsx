// Tabela da grade "Lista tipo Excel" de Cadastro > Insumos: cada insumo é um bloco — 1 linha-PAI (cabeçalho, só ela edita) + 1 linha-FILHO
// por COR (as cores nascem RECOLHIDAS: clicar na linha-pai abre/fecha). Espelha `AviamentosGradeTabela`, com a diferença do insumo:
// as cores NÃO têm rascunho próprio — o rascunho é UM por insumo (`useCardDraft`, id = insumo.id) e carrega o cabeçalho E os blocos de cor
// (`InsumoDraft.blocos`); cada linha-filho edita o bloco de mesma posição. Por isso as cores recolhidas nem precisam estar montadas.
//
// STAGING (nada grava antes do Salvar): editar uma célula só faz `patch` no rascunho (selo âmbar quando valor ≠ base). O Salvar (na
// `InsumosGradeAba`) chama o `salvar` de cada rascunho sujo (cabeçalho por UPDATE direto + cores por delete-and-reinsert — ver
// `insumo-grade/salvar.ts`). Cada rascunho se registra aqui por `registrar`. Também CRIA (linhas NOVAS em rascunho,
// `InsumoNovoGrupo`), COLA do Excel (bloco TSV na célula-âncora) e EXCLUI (lixeira única por linha: o INSUMO grava na hora, atrás de
// confirmação; a COR só sai do rascunho — o próximo Salvar regrava as cores sem ela).
import {
  MOTIVO_SEM_TAMANHO,
  MOTIVO_VINCULO_INDISPONIVEL,
  motivoBloqueio,
} from "@/lib/grade-bloqueio";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCardDraft } from "@/components/shared/card-drafts/useCardDraft";
import { SortTh, type SortDir } from "@/components/shared/sort";
import { useGradeTeclado } from "@/lib/grade-teclado";
import { vinculoDisponivel } from "@/lib/insumo-tamanho";
import { colunaOrdenavel } from "@/lib/insumo-grade/ordenar";
import { COLUNAS_INSUMO, indiceDaColuna, type ColunaGrade } from "@/lib/insumo-grade/colunas";
import type { BlocoEntrada, InsumoEntrada, LinhaGrade } from "@/lib/insumo-grade/linhas";
import type { InsumoNovo } from "@/lib/insumo-grade/linha-nova";
import { chaveSlotCor, chaveSlotPai } from "@/lib/insumo-grade/colar-slots";
import { marcarCorRemovida } from "@/lib/insumo-grade/excluir";
import {
  CAMPO_COR,
  CAMPO_INSUMO,
  blocoIgual,
  blocosIguais,
  empresasParaLinha,
  opcoesDaColuna,
  tamanhosHabilitados,
} from "@/lib/insumo-grade/celulas";
import {
  ErroGrade,
  blocosEfetivos,
  insumoParaDraft,
  salvarInsumo,
  temCorRepetida,
  textoErroSalvar,
  type BlocoDraft,
  type CtxSalvar,
  type InsumoDraft,
} from "@/lib/insumo-grade/salvar";
import { cn } from "@/lib/utils";
import type { GradeOpcoes } from "./useInsumosGrade";
import { CelulaInsumo, type GradeCelProps } from "./CelulaInsumo";
import { CLASSE_COL_ACOES, LinhasInsumoNovo, type AtualizarNovo } from "./InsumoNovoGrupo";

/** O que cada rascunho entrega ao Salvar: lê o estado MAIS NOVO por ref, no momento de salvar. */
export type SaverApi = {
  dirty: () => boolean;
  salvar: (ctx: CtxSalvar) => Promise<void>;
  /** O rascunho atual do insumo (o colar lê o formato e o fornecedor que a linha já tem). */
  ler: () => InsumoDraft;
  /**
   * Colar do Excel: aplica campos do cabeçalho e partes de cores NO RASCUNHO (um lote só — a cor é achada pela cor da LEITURA do
   * servidor). Nada grava.
   */
  aplicar: (a: {
    campos?: Partial<InsumoDraft>;
    blocos?: { corId: string; parte: Partial<BlocoDraft> }[];
  }) => void;
  /** Cores (da leitura do servidor) que a lixeira marcou para remover: não são linhas da tela, o colar as pula. */
  removidas: () => string[];
};
/** Registra um rascunho no wrapper do Salvar; devolve o "desregistrar". Precisa ser ESTÁVEL (useCallback) na tela. */
export type RegistrarSaver = (id: string, api: SaverApi) => () => void;

/** Ordenação por coluna (estado na Aba, que ordena as `linhas` ANTES de entregá-las): só desenha os cabeçalhos clicáveis. */
export type OrdenacaoProps = {
  sortKey: string | null;
  sortDir: SortDir;
  toggle: (key: string) => void;
};

type Grupo = { insumoId: string; insumo: InsumoEntrada; linhas: LinhaGrade[] };

/** Linhas consecutivas do mesmo insumo viram um grupo (`montarLinhas` já entrega o insumo inteiro em sequência). */
function agruparLinhasPorInsumo(linhas: LinhaGrade[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const l of linhas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.insumoId === l.insumoId) ultimo.linhas.push(l);
    else grupos.push({ insumoId: l.insumoId, insumo: l.insumo, linhas: [l] });
  }
  return grupos;
}

/** Mantém a MESMA referência enquanto o conteúdo não muda (a `base` do `useCardDraft` tem de ser estável). */
function useEstavel<T>(valor: T): T {
  const ref = useRef(valor);
  if (ref.current !== valor && JSON.stringify(ref.current) !== JSON.stringify(valor))
    ref.current = valor;
  return ref.current;
}

/** Nome para rótulos: o nome do insumo; sem nome, "insumo". */
const nomeDoInsumo = (i: InsumoEntrada): string => i.nome || "insumo";

// ---------------------------------------------------------------- insumo (rascunho do cabeçalho + das cores)

type CampoCabecalho = Exclude<keyof InsumoDraft, "blocos">;

type InsumoCtx = {
  valor: InsumoDraft;
  /** Cabeçalho: valor ≠ base (só quando há rascunho). */
  sujo: (k: CampoCabecalho) => boolean;
  /** Algum campo do CABEÇALHO difere da base (o selo da linha-pai; as cores têm o delas). */
  cabecalhoSujo: boolean;
  /** Por posição de cor: o bloco difere da base. */
  blocoSujo: (i: number, campo?: keyof BlocoDraft) => boolean;
  algumBlocoSujo: boolean;
  /** Quantas cores a lixeira marcou para remover (somem ao Salvar). */
  nRemovidas: number;
  /** Lixeira da cor: marca a cor (por posição) como removida no rascunho; `desfazer` volta atrás. Nada grava. */
  marcarCor: (i: number, removido: boolean) => void;
  patch: (k: keyof InsumoDraft, v: unknown) => void;
  /** Edita uma cor (por posição); se o conjunto volta a ser igual à base, o rascunho de cores é solto (não fica "sujo à toa"). */
  patchBloco: (i: number, parte: Partial<BlocoDraft>) => void;
  dirty: boolean;
  erro: { texto: string; alvo: "cabecalho" | "variantes" } | null;
};

function useRascunhoInsumo(
  insumo: InsumoEntrada,
  blocosBase: BlocoEntrada[],
  registrar: RegistrarSaver,
): InsumoCtx {
  const base = useEstavel(insumoParaDraft(insumo, blocosBase));
  const [erro, setErro] = useState<InsumoCtx["erro"]>(null);

  const salvarFn = useCallback(
    async (mudancas: Partial<InsumoDraft>, baseEnviada: InsumoDraft) => {
      setErro(null);
      try {
        // "último vence": UPDATE direto do cabeçalho (sem rev) + cores por delete-and-reinsert, como a tela de Insumos de hoje
        await salvarInsumo(mudancas, baseEnviada, insumo.id);
      } catch (e) {
        setErro({
          texto: textoErroSalvar(e),
          alvo: e instanceof ErroGrade ? e.alvo : "cabecalho",
        });
        throw e;
      }
    },
    [insumo.id],
  );
  const draft = useCardDraft<InsumoDraft>({
    id: insumo.id,
    base,
    salvarFn,
    onDescartar: () => setErro(null),
  });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baseRef = useRef(base);
  baseRef.current = base;
  useEffect(
    () =>
      registrar(insumo.id, {
        dirty: () => draftRef.current.dirty,
        salvar: (ctx) => draftRef.current.salvar(ctx),
        ler: () => ({ ...draftRef.current.valor }),
        aplicar: ({ campos, blocos }) => {
          const d = draftRef.current;
          for (const [k, v] of Object.entries(campos ?? {}))
            d.patch(k as keyof InsumoDraft, v as never);
          if (!blocos || blocos.length === 0) return;
          const base = baseRef.current;
          const partes = new Map<number, Partial<BlocoDraft>>();
          for (const b of blocos) {
            const i = base.blocos.findIndex((x) => x.cor_id === b.corId);
            if (i >= 0) partes.set(i, { ...partes.get(i), ...b.parte });
          }
          if (partes.size === 0) return;
          const prox = draftRef.current.valor.blocos.map((b, i) =>
            partes.has(i) ? { ...b, ...partes.get(i) } : b,
          );
          d.patch("blocos", (blocosIguais(prox, base.blocos) ? base.blocos : prox) as never);
        },
        removidas: () =>
          draftRef.current.valor.blocos.flatMap((b, i) =>
            b.removido && baseRef.current.blocos[i] ? [baseRef.current.blocos[i].cor_id] : [],
          ),
      }),
    [registrar, insumo.id],
  );
  useEffect(() => {
    if (!draft.dirty) setErro(null);
  }, [draft.dirty]);

  const { valor, dirty, patch } = draft;
  const sujo = useCallback(
    (k: CampoCabecalho) => dirty && !Object.is(valor[k], base[k]),
    [dirty, valor, base],
  );
  const blocoSujo = useCallback(
    (i: number, campo?: keyof BlocoDraft) => {
      if (!dirty) return false;
      const a = valor.blocos[i];
      const b = base.blocos[i];
      if (!campo) return !blocoIgual(a, b);
      if (!a || !b) return a !== b;
      return !blocoIgual({ ...b, [campo]: a[campo] }, b);
    },
    [dirty, valor.blocos, base.blocos],
  );
  const cabecalhoSujo = useMemo(
    () =>
      dirty &&
      (Object.keys(base) as Array<keyof InsumoDraft>).some(
        (k) => k !== "blocos" && !Object.is(valor[k], base[k]),
      ),
    [dirty, valor, base],
  );
  const algumBlocoSujo = useMemo(
    () => dirty && !blocosIguais(valor.blocos, base.blocos),
    [dirty, valor.blocos, base.blocos],
  );
  const nRemovidas = useMemo(() => valor.blocos.filter((b) => b.removido).length, [valor.blocos]);
  const patchCampo = useCallback(
    (k: keyof InsumoDraft, v: unknown) => patch(k, v as never),
    [patch],
  );
  const patchBloco = useCallback(
    (i: number, parte: Partial<BlocoDraft>) => {
      const atuais = draftRef.current.valor.blocos;
      const prox = atuais.map((b, j) => (j === i ? { ...b, ...parte } : b));
      // volta a ser igual à base → devolve a MESMA referência da base (o `useCardDraft` compara por identidade e solta o campo)
      patch(
        "blocos",
        (blocosIguais(prox, baseRef.current.blocos) ? baseRef.current.blocos : prox) as never,
      );
    },
    [patch],
  );
  const marcarCor = useCallback(
    (i: number, removido: boolean) => {
      const prox = marcarCorRemovida(draftRef.current.valor.blocos, i, removido);
      patch(
        "blocos",
        (blocosIguais(prox, baseRef.current.blocos) ? baseRef.current.blocos : prox) as never,
      );
    },
    [patch],
  );
  return {
    valor,
    sujo,
    cabecalhoSujo,
    blocoSujo,
    algumBlocoSujo,
    nRemovidas,
    marcarCor,
    patch: patchCampo,
    patchBloco,
    dirty,
    erro,
  };
}

// ---------------------------------------------------------------- linhas
// Cada INSUMO é um bloco (<tbody>): 1 linha-PAI (cabeçalho: nome, tipo, unidade, fornecedor, preço… — SÓ ela mostra e edita) + N linhas-FILHO
// (uma por COR: cor, tamanhos e preço da cor). Clicar no pai recolhe/expande as cores (nascem recolhidas). Insumo sem cor = só a linha-pai.

/** `useGradeTeclado().propsDaCelula`: endereça a célula (`data-grade-cel`) e liga Enter/Tab. */
type PropsCelula = (linha: number, coluna: number) => GradeCelProps;

function EstadoLinha({ sujo, erro }: { sujo: boolean; erro: string | null }): ReactNode {
  if (erro) {
    return (
      <span role="alert" title={erro} data-erro-linha>
        <AlertTriangle className="h-4 w-4 text-destructive" aria-label={`Não salvou: ${erro}`} />
      </span>
    );
  }
  if (sujo) {
    return (
      <span
        role="status"
        title="Alterações não salvas"
        data-selo-nao-salvo
        className="inline-block h-2 w-2 rounded-full bg-amber-500"
      />
    );
  }
  return null;
}

type BaseLinhaProps = {
  insumo: InsumoEntrada;
  ctx: InsumoCtx;
  opcoes: GradeOpcoes;
  readOnly: boolean;
  /** Posição GLOBAL desta linha na grade (contínua entre os insumos, na ordem da tela): é a "linha" do endereço de teclado. */
  linhaIdx: number;
  propsCel: PropsCelula;
  /** Avisos da última colagem (`<slot>|<coluna>`) e como apagar um ao editar a célula. */
  avisos: Record<string, string>;
  onLimparAviso: (chaveCelula: string) => void;
  /** Excluir o INSUMO cadastrado (grava na hora, com confirmação). */
  ex: ExcluirAcoes;
};

type PaiProps = BaseLinhaProps & {
  /** Quantas cores o insumo tem na leitura (0 = "sem cores": a linha-pai é a única do insumo), contando as marcadas para remover. */
  nCores: number;
  recolhido: boolean;
  onAlternar: () => void;
  /** "+ cor" (cor nova neste insumo); ausente quando já há cor nova pendente ou a grade é só leitura. */
  botaoCor?: ReactNode;
};

type FilhoProps = BaseLinhaProps & {
  /** Posição do bloco no rascunho (= a ordem do servidor; a tela pode ordenar as linhas, o bloco não muda de lugar). */
  idx: number;
  /** A cor deste bloco NA LEITURA do servidor ("" = sem cor): é a chave do slot do colar, estável enquanto a pessoa edita a cor. */
  corBase: string;
};

/** Célula do CABEÇALHO (só a linha-pai chama). */
function celulaInsumo(col: ColunaGrade, c: PaiProps) {
  const { ctx, opcoes, readOnly, insumo } = c;
  // rótulo estável (nome do servidor): digitar o nome não muda o aria-label do próprio campo
  const ariaLabel = `${col.rotulo} de ${nomeDoInsumo(insumo)}`;
  const campo = CAMPO_INSUMO[col.key];
  if (!campo) return null;
  const desabilitado = readOnly || !col.editavel;
  const motivo = motivoBloqueio(readOnly, col.editavel);
  const chaveAv = `${chaveSlotPai(insumo.id)}|${col.key}`;
  const aviso = c.avisos[chaveAv];

  if (col.key === "fornecedor") {
    return (
      <CelulaInsumo
        coluna={col}
        ariaLabel={ariaLabel}
        sujo={ctx.sujo("empresa_id") || ctx.sujo("representante_id")}
        aviso={aviso}
        desabilitado={desabilitado}
        motivoBloqueio={motivo}
        fornecedor={{
          empresas: empresasParaLinha(opcoes.empresas, ctx.valor.empresa_id),
          empresaId: ctx.valor.empresa_id,
          representanteId: ctx.valor.representante_id,
          onChange: (empresaId, representanteId) => {
            c.onLimparAviso(chaveAv);
            ctx.patch("empresa_id", empresaId);
            ctx.patch("representante_id", representanteId);
          },
        }}
      />
    );
  }

  if (col.key === "tamanho_vinculado") {
    // Só vale em insumo sem tamanho próprio (formato "nenhum" ou nenhuma cor com tamanho marcado); fora disso a célula trava.
    const disponivel = vinculoDisponivel(
      ctx.valor.formato_tamanho,
      blocosEfetivos(ctx.valor.formato_tamanho, ctx.valor.blocos),
    );
    return (
      <CelulaInsumo
        coluna={col}
        ariaLabel={ariaLabel}
        valor={ctx.valor.vincular ? ctx.valor.tamanho_vinculado : null}
        onChange={(v) => {
          // escolher um tamanho liga o vínculo; "Sem vínculo" o desliga (o par `vincular`/`tamanho_vinculado` anda junto)
          ctx.patch("vincular", v != null);
          ctx.patch("tamanho_vinculado", (v as string | null) ?? null);
        }}
        sujo={ctx.sujo("vincular") || ctx.sujo("tamanho_vinculado")}
        desabilitado={desabilitado || !disponivel}
        motivoBloqueio={motivoBloqueio(
          readOnly,
          col.editavel,
          disponivel ? undefined : MOTIVO_VINCULO_INDISPONIVEL,
        )}
        tamanhosGrade={opcoes.tamanhosGrade}
      />
    );
  }

  return (
    <CelulaInsumo
      coluna={col}
      ariaLabel={ariaLabel}
      valor={ctx.valor[campo]}
      onChange={(v) => {
        c.onLimparAviso(chaveAv);
        ctx.patch(campo, v);
      }}
      sujo={ctx.sujo(campo as CampoCabecalho)}
      aviso={aviso}
      desabilitado={desabilitado}
      motivoBloqueio={motivo}
      opcoes={opcoesDaColuna(col.key, opcoes)}
      gradeProps={props_(c, col)}
    />
  );
}

/** Endereço de teclado da célula (linha global × posição da coluna). */
function props_(c: BaseLinhaProps, col: ColunaGrade): GradeCelProps {
  return c.propsCel(c.linhaIdx, indiceDaColuna(col.key));
}

/** Célula "Cor" da linha-PAI: quantas cores o insumo tem. */
function celulaCoresDoPai(c: PaiProps): ReactNode {
  const aRemover = c.ctx.nRemovidas;
  const ativas = c.nCores - aRemover;
  return (
    <span className="flex items-center gap-1">
      <span
        className="whitespace-nowrap px-2 text-xs text-muted-foreground"
        data-resumo-cores
        title={ativas === 0 ? "Insumo sem cores" : undefined}
      >
        {ativas === 0 ? "sem cores" : `${ativas} ${ativas === 1 ? "cor" : "cores"}`}
        {aRemover > 0 ? ` · ${aRemover} a remover` : ""}
      </span>
      {c.botaoCor}
    </span>
  );
}

/** Célula da COR (só a linha-filho chama). */
function celulaCor(col: ColunaGrade, c: FilhoProps) {
  const { ctx, opcoes, readOnly, insumo, idx } = c;
  const bloco = ctx.valor.blocos[idx];
  const campo = CAMPO_COR[col.key];
  if (!bloco || !campo) return null;
  const ariaLabel = `${col.rotulo} da cor de ${nomeDoInsumo(insumo)}`;
  const sujo = ctx.blocoSujo(idx, campo);
  const chaveAv = `${chaveSlotCor(insumo.id, c.corBase)}|${col.key}`;
  const aviso = c.avisos[chaveAv];
  const aoMudar = (v: unknown) => {
    c.onLimparAviso(chaveAv);
    ctx.patchBloco(idx, { [campo]: v } as Partial<BlocoDraft>);
  };
  if (col.key === "tamanhos") {
    const habilitada = tamanhosHabilitados(ctx.valor.formato_tamanho);
    return (
      <CelulaInsumo
        coluna={col}
        ariaLabel={ariaLabel}
        valor={bloco.tamanhos}
        onChange={aoMudar}
        sujo={sujo}
        aviso={aviso}
        desabilitado={readOnly || !col.editavel || !habilitada}
        motivoBloqueio={motivoBloqueio(
          readOnly,
          col.editavel,
          habilitada ? undefined : MOTIVO_SEM_TAMANHO,
        )}
        tamanhosGrade={opcoes.tamanhosGrade}
      />
    );
  }
  return (
    <CelulaInsumo
      coluna={col}
      ariaLabel={ariaLabel}
      valor={bloco[campo]}
      onChange={aoMudar}
      sujo={sujo}
      aviso={aviso}
      desabilitado={readOnly || !col.editavel}
      motivoBloqueio={motivoBloqueio(readOnly, col.editavel)}
      opcoes={opcoesDaColuna(col.key, opcoes)}
      erro={
        col.key === "cor" && temCorRepetida(ctx.valor.blocos) && corRepete(ctx.valor.blocos, idx)
          ? "Esta cor aparece em mais de uma linha deste insumo."
          : undefined
      }
      gradeProps={props_(c, col)}
    />
  );
}

/** A cor deste bloco aparece em outro bloco do mesmo insumo? */
const corRepete = (blocos: readonly BlocoDraft[], i: number): boolean =>
  blocos.some((b, j) => j !== i && b.cor_id === blocos[i].cor_id);

/** "Azul" / "sem cor": como a cor é chamada nos rótulos da lixeira. */
function rotuloDaCor(corId: string, opcoes: GradeOpcoes): string {
  if (!corId) return "sem cor";
  return opcoes.cores.find((x) => x.id === corId)?.nome ?? "cor";
}

/**
 * Última coluna: UMA lixeira por linha. Na linha-PAI exclui o INSUMO + todas as cores (confirmação; grava na hora). Na linha da COR
 * só TIRA a cor do rascunho (nada grava): o próximo Salvar regrava as cores sem ela.
 */
function CelulaAcoes({
  insumo,
  corIdx,
  ctx,
  readOnly,
  ex,
  rotuloCor,
}: {
  insumo: InsumoEntrada;
  /** Posição do bloco no rascunho; null = linha-pai. */
  corIdx: number | null;
  ctx: InsumoCtx;
  readOnly: boolean;
  ex: ExcluirAcoes;
  rotuloCor?: string;
}) {
  if (readOnly || ex === SEM_EXCLUIR) return null;
  const nome = nomeDoInsumo(insumo);
  const cor = corIdx != null;
  const onClick = () =>
    cor
      ? ctx.marcarCor(corIdx, true)
      : ex.onExcluirInsumo({ insumoId: insumo.id, insumoNome: nome });
  return (
    <span className="flex items-center justify-end">
      <button
        type="button"
        disabled={ex.ocupado}
        onClick={onClick}
        aria-label={
          cor
            ? `Remover a cor ${rotuloCor} de ${nome}`
            : `Excluir o insumo ${nome} e todas as cores`
        }
        title={
          cor
            ? "Remover esta cor (some ao Salvar)"
            : "Excluir o insumo inteiro e todas as cores (pede confirmação)"
        }
        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        data-acao={cor ? "remover-cor" : "excluir-insumo"}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/** Estado + Nome ficam FIXOS na horizontal (sticky left): a largura da coluna de estado (chevron + selo) é a mesma do deslocamento do Nome. */
const CLASSE_COL_ESTADO = "sticky left-0 z-10 w-10 min-w-10 px-1 py-1.5 text-center";
const CLASSE_COL_NOME = "sticky left-10 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]";
/** A coluna fixa é o Nome: o que identifica a linha ao rolar para o lado. */
const COLUNA_FIXA = "nome";

/** Cliques que NÃO recolhem o insumo: quem edita/aciona alguma coisa na linha-pai (e o que o popover/select abre por portal). */
const INTERATIVO =
  "input,button,select,textarea,a,label,[role=combobox],[role=checkbox],[role=button],[role=switch],[role=option],[contenteditable=true]";

/** Linha-PAI do insumo: cabeçalho (editável só aqui) + chevron que recolhe/expande as cores. */
function LinhaPai(props: PaiProps) {
  const { insumo, ctx, nCores, recolhido, onAlternar } = props;
  const temCores = nCores > 0;
  const nome = nomeDoInsumo(insumo);
  const aoClicarLinha = (e: MouseEvent<HTMLTableRowElement>) => {
    if (!temCores) return;
    const alvo = e.target as HTMLElement | null;
    // evento de portal (popover/select) sobe pela árvore do React mas NÃO está dentro da linha no DOM
    if (!alvo || !e.currentTarget.contains(alvo) || alvo.closest(INTERATIVO)) return;
    onAlternar();
  };
  return (
    <tr
      className={cn(
        "border-t-[3px] border-border bg-muted align-middle",
        temCores && "cursor-pointer",
      )}
      data-insumo-id={insumo.id}
      data-pai
      data-slot={chaveSlotPai(insumo.id)}
      data-recolhido={temCores && recolhido ? "" : undefined}
      onClick={aoClicarLinha}
    >
      <td className={cn(CLASSE_COL_ESTADO, "bg-muted")}>
        <span className="flex items-center justify-center gap-1">
          {temCores ? (
            <button
              type="button"
              onClick={onAlternar}
              aria-expanded={!recolhido}
              aria-label={`${recolhido ? "Expandir" : "Recolher"} as cores de ${nome}`}
              title={recolhido ? "Mostrar as cores deste insumo" : "Esconder as cores deste insumo"}
              data-acao="alternar-cores"
              className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            >
              {recolhido ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          ) : null}
          <EstadoLinha sujo={ctx.cabecalhoSujo} erro={ctx.erro?.texto ?? null} />
          {/* Cores escondidas guardam edição não salva: o pai avisa (senão ela ficaria invisível). */}
          {recolhido && ctx.algumBlocoSujo ? (
            <span
              role="status"
              title="Há cores escondidas com alterações não salvas"
              data-selo-filho-oculto
              className="inline-block h-2 w-2 rounded-full bg-amber-500"
            />
          ) : null}
        </span>
      </td>
      {COLUNAS_INSUMO.map((col) => (
        <td
          key={col.key}
          className={cn("bg-muted px-1.5 py-1.5", col.key === COLUNA_FIXA && CLASSE_COL_NOME)}
          data-col={col.key}
        >
          {col.escopo === "insumo"
            ? celulaInsumo(col, props)
            : col.key === "cor"
              ? celulaCoresDoPai(props)
              : null}
        </td>
      ))}
      <td className={cn(CLASSE_COL_ACOES, "bg-muted")} data-col-acoes>
        <CelulaAcoes
          insumo={insumo}
          corIdx={null}
          ctx={ctx}
          readOnly={props.readOnly}
          ex={props.ex}
        />
      </td>
    </tr>
  );
}

/** Linha-FILHO: uma cor do insumo, recuada sob o pai. As colunas do cabeçalho ficam VAZIAS (o cabeçalho é do pai). */
function LinhaFilho(props: FilhoProps) {
  const { insumo, ctx, idx, corBase } = props;
  const nome = nomeDoInsumo(insumo);
  const rotulo = rotuloDaCor(corBase, props.opcoes);
  // Cor que a lixeira marcou: a linha continua à vista (riscada) até o Salvar, com "Desfazer" — nada some calado.
  if (ctx.valor.blocos[idx]?.removido) {
    return (
      <tr
        className="border-t border-dashed align-middle text-muted-foreground"
        data-insumo-id={insumo.id}
        data-cor-idx={idx}
        data-cor-removida
      >
        <td className={cn(CLASSE_COL_ESTADO, "border-l-4 border-l-primary/30 bg-background")}>
          <EstadoLinha sujo erro={ctx.erro?.alvo === "variantes" ? ctx.erro.texto : null} />
        </td>
        <td colSpan={COLUNAS_INSUMO.length} className={cn("bg-background px-1.5 py-1.5 text-xs")}>
          <span className="flex items-center gap-2 pl-5">
            <span className="line-through">Cor {rotulo}</span>
            <span>será removida ao Salvar</span>
            {!props.readOnly && (
              <button
                type="button"
                onClick={() => ctx.marcarCor(idx, false)}
                aria-label={`Desfazer a remoção da cor ${rotulo} de ${nome}`}
                data-acao="desfazer-remocao-cor"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
              >
                <Undo2 className="h-3.5 w-3.5" /> Desfazer
              </button>
            )}
          </span>
        </td>
        <td className={CLASSE_COL_ACOES} />
      </tr>
    );
  }
  return (
    <tr
      className="border-t border-dashed align-middle"
      data-insumo-id={insumo.id}
      data-cor-idx={idx}
      data-slot={chaveSlotCor(insumo.id, corBase)}
    >
      <td className={cn(CLASSE_COL_ESTADO, "border-l-4 border-l-primary/30 bg-background")}>
        <EstadoLinha
          sujo={ctx.blocoSujo(idx)}
          erro={ctx.erro?.alvo === "variantes" ? ctx.erro.texto : null}
        />
      </td>
      {COLUNAS_INSUMO.map((col) => (
        <td
          key={col.key}
          className={cn(
            "px-1.5 py-1.5",
            col.key === COLUNA_FIXA && cn(CLASSE_COL_NOME, "bg-background"),
          )}
          data-col={col.key}
        >
          {col.escopo === "variante" ? (
            celulaCor(col, props)
          ) : col.key === COLUNA_FIXA ? (
            <span
              className="flex items-center gap-1 pl-5 text-xs text-muted-foreground"
              data-recuo
              title={`Cor de ${nome}`}
            >
              ↳ cor
            </span>
          ) : null}
        </td>
      ))}
      <td className={CLASSE_COL_ACOES} data-col-acoes>
        <CelulaAcoes
          insumo={insumo}
          corIdx={idx}
          ctx={ctx}
          readOnly={props.readOnly}
          ex={props.ex}
          rotuloCor={rotulo}
        />
      </td>
    </tr>
  );
}

/** Props do que a tela guarda das linhas NOVAS (rascunho da aba) e das ações sobre elas. */
export type NovosAcoes = {
  /** Depois de tentar salvar: os pendentes ficam em vermelho. */
  mostrarPendencias: boolean;
  /** Erro do servidor por grupo novo (tmp → mensagem PT-BR). */
  errosNovos: Record<string, string>;
  onAtualizarNovo: AtualizarNovo;
  onRemoverNovo: (tmp: string) => void;
  /** "+ cor" num insumo que já existe. */
  onNovaCor: (insumoId: string, nome: string, formato: string) => void;
};

/** Excluir o INSUMO já cadastrado: confirma e grava NA HORA (fora do rascunho/Salvar). Quem confirma é a Aba. */
export type ExcluirProps = {
  onExcluirInsumo: (a: { insumoId: string; insumoNome: string }) => void;
  /** Uma exclusão (ou o Salvar) em andamento: os botões ficam travados. */
  ocupado: boolean;
};
type ExcluirAcoes = ExcluirProps;
export type NovosProps = NovosAcoes & {
  novos: InsumoNovo[];
  onNovoInsumo: () => void;
};

/** Colar do Excel: avisos da última colagem + o que fazer ao editar a célula / ao colar um bloco. */
export type ColarProps = {
  /** Texto que NÃO foi aplicado (chave `<slot>|<coluna>`): a célula fica em laranja tracejado, com o motivo no `title`. */
  avisos: Record<string, string>;
  onLimparAviso: (chaveCelula: string) => void;
  /** Recebe o bloco (texto da área de transferência) e a célula-âncora. `true` = tratou como bloco (o colar normal é cancelado). */
  onColar: (a: { chaveLinha: string; colKey: string; texto: string }) => boolean;
};

const SEM_AVISOS: Record<string, string> = {};
const NADA = () => {};

const SEM_NOVOS: InsumoNovo[] = [];
const SEM_ERROS: Record<string, string> = {};
const SEM_ACOES: NovosAcoes = {
  mostrarPendencias: false,
  errosNovos: SEM_ERROS,
  onAtualizarNovo: () => {},
  onRemoverNovo: () => {},
  onNovaCor: () => {},
};
const SEM_EXCLUIR: ExcluirAcoes = {
  onExcluirInsumo: () => {},
  ocupado: false,
};

/** Linhas (posições do teclado) que um insumo cadastrado ocupa: a linha-pai + uma por cor (insumo sem cor = só a linha-pai). */
const nLinhasDoGrupo = (g: Grupo): number => (g.linhas[0]?.bloco ? 1 + g.linhas.length : 1);

const GrupoInsumo = memo(function GrupoInsumo({
  grupo,
  blocosBase,
  opcoes,
  readOnly,
  registrar,
  inicio,
  propsCel,
  novosAlvo,
  nv,
  ex,
  avisos,
  onLimparAviso,
}: {
  grupo: Grupo;
  /** Cores do insumo NA ORDEM DO SERVIDOR (a ordem do rascunho; as linhas podem vir ordenadas por coluna). */
  blocosBase: BlocoEntrada[];
  opcoes: GradeOpcoes;
  readOnly: boolean;
  registrar: RegistrarSaver;
  /** Posição global da linha-pai deste insumo (as cores vêm logo depois; as cores novas dele, depois das cadastradas). */
  inicio: number;
  propsCel: PropsCelula;
  /** Cores novas deste insumo (rascunho); entram no fim do mesmo <tbody> e nunca são escondidas pelo recolher. */
  novosAlvo: InsumoNovo[];
  nv: NovosAcoes;
  ex: ExcluirAcoes;
  avisos: Record<string, string>;
  onLimparAviso: (chaveCelula: string) => void;
}) {
  const { insumo, linhas } = grupo;
  const ctx = useRascunhoInsumo(insumo, blocosBase, registrar);
  // cada linha-filho aponta para o bloco do rascunho pela POSIÇÃO no servidor (a cor é única dentro do insumo)
  const cores = useMemo(
    () =>
      linhas
        .filter((l): l is LinhaGrade & { bloco: BlocoEntrada } => l.bloco != null)
        .map((l) => ({
          chave: l.chave,
          corBase: l.bloco.cor_id,
          idx: blocosBase.findIndex((b) => b.cor_id === l.bloco.cor_id),
        }))
        .filter((c) => c.idx >= 0),
    [linhas, blocosBase],
  );
  // Recolher/expandir as cores: estado só local (não persiste); começa RECOLHIDO (a lista abre só com os cabeçalhos).
  const [recolhidoLivre, setRecolhido] = useState(true);
  const recolhido = recolhidoLivre && cores.length > 0;
  const alternar = useCallback(() => setRecolhido((r) => !r), []);
  // Um erro das cores abre o insumo: a falha precisa estar à vista (a pessoa pode recolher de novo depois).
  const erroDasCores = ctx.erro?.alvo === "variantes";
  useEffect(() => {
    if (erroDasCores) setRecolhido(false);
  }, [erroDasCores]);
  // "+ cor" (na linha-pai) só some quando já há cor nova pendente neste insumo (aí o botão "adicionar cor" do grupo faz o papel)
  const botaoCor =
    !readOnly && novosAlvo.length === 0 ? (
      <button
        type="button"
        onClick={() => nv.onNovaCor(insumo.id, nomeDoInsumo(insumo), ctx.valor.formato_tamanho)}
        aria-label={`Adicionar cor em ${nomeDoInsumo(insumo)}`}
        title="Adicionar cor neste insumo"
        data-acao="adicionar-cor"
        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    ) : undefined;
  return (
    <tbody data-grupo-insumo={insumo.id}>
      <LinhaPai
        insumo={insumo}
        ctx={ctx}
        opcoes={opcoes}
        readOnly={readOnly}
        nCores={cores.length}
        botaoCor={botaoCor}
        recolhido={recolhido}
        onAlternar={alternar}
        linhaIdx={inicio}
        propsCel={propsCel}
        avisos={avisos}
        onLimparAviso={onLimparAviso}
        ex={ex}
      />
      {!recolhido &&
        cores.map((c, i) => (
          <LinhaFilho
            key={c.chave}
            insumo={insumo}
            ctx={ctx}
            opcoes={opcoes}
            readOnly={readOnly}
            idx={c.idx}
            corBase={c.corBase}
            linhaIdx={inicio + 1 + i}
            propsCel={propsCel}
            avisos={avisos}
            onLimparAviso={onLimparAviso}
            ex={ex}
          />
        ))}
      {novosAlvo.map((g, gi) => (
        <LinhasInsumoNovo
          key={g.tmp}
          grupo={g}
          inicio={
            inicio +
            nLinhasDoGrupo(grupo) +
            novosAlvo.slice(0, gi).reduce((n, x) => n + x.blocos.length, 0)
          }
          propsCel={propsCel}
          opcoes={opcoes}
          mostrarPendencias={nv.mostrarPendencias}
          erro={nv.errosNovos[g.tmp]}
          onChange={nv.onAtualizarNovo}
          onRemover={nv.onRemoverNovo}
          avisos={avisos}
          onLimparAviso={onLimparAviso}
        />
      ))}
    </tbody>
  );
});

const SEM_BLOCOS: BlocoEntrada[] = [];

export function InsumosGradeTabela({
  linhas,
  blocosPorEtiqueta,
  opcoes,
  readOnly,
  registrar,
  ordenacao,
  novos: nv,
  colar,
  excluir,
}: {
  linhas: LinhaGrade[];
  /** Cores de cada insumo na ordem do servidor (a base do rascunho). */
  blocosPorEtiqueta: Map<string, BlocoEntrada[]>;
  opcoes: GradeOpcoes;
  readOnly: boolean;
  registrar: RegistrarSaver;
  /** Cabeçalhos clicáveis (ordenar). Ausente = cabeçalhos de texto. */
  ordenacao?: OrdenacaoProps;
  /** Linhas novas (rascunho) + ações. Ausente = a grade só edita os existentes. */
  novos?: NovosProps;
  /** Colar do Excel. Ausente = colar normal, célula a célula. */
  colar?: ColarProps;
  /** Excluir insumo cadastrado. Ausente = a grade não oferece o botão de excluir. */
  excluir?: ExcluirProps;
}) {
  const avisos = colar?.avisos ?? SEM_AVISOS;
  const onLimparAviso = colar?.onLimparAviso ?? NADA;
  // Ctrl+V de um BLOCO (TAB/várias linhas) com o foco numa célula: a célula é a âncora. O evento sobe do campo até aqui; valor
  // simples segue o colar normal do próprio campo.
  const aoColar = (e: ClipboardEvent<HTMLDivElement>) => {
    if (!colar || readOnly) return;
    const alvo = e.target as HTMLElement | null;
    const td = alvo?.closest?.("td[data-col]") as HTMLElement | null;
    const tr = td?.closest("tr[data-slot]") as HTMLElement | null;
    if (!td || !tr) return;
    const texto = e.clipboardData?.getData("text/plain") ?? "";
    if (!/[\t\r\n"]/.test(texto)) return;
    if (colar.onColar({ chaveLinha: tr.dataset.slot ?? "", colKey: td.dataset.col ?? "", texto }))
      e.preventDefault();
  };
  const grupos = useMemo(() => agruparLinhasPorInsumo(linhas), [linhas]);
  // cores novas de insumo existente entram no <tbody> do insumo; insumo novo ganha <tbody> próprio, no fim
  const { porInsumo, insumosNovos } = useMemo(() => {
    const mapa = new Map<string, InsumoNovo[]>();
    const soNovos: InsumoNovo[] = [];
    for (const g of nv?.novos ?? SEM_NOVOS) {
      if (g.insumoAlvoId)
        (mapa.get(g.insumoAlvoId) ?? mapa.set(g.insumoAlvoId, []).get(g.insumoAlvoId)!).push(g);
      else soNovos.push(g);
    }
    return { porInsumo: mapa, insumosNovos: soNovos };
  }, [nv?.novos]);
  // Teclado (Enter desce / Tab ao lado): a "linha" é a posição GLOBAL na ordem da tela (cada insumo: a linha-pai, suas cores
  // cadastradas, as cores novas dele; por fim os insumos novos) = a mesma ordem de `montarSlots`; a "coluna" é a posição em
  // COLUNAS_INSUMO.
  const { inicios, inicioDosNovos, nLinhas } = useMemo(() => {
    let n = 0;
    const ini: number[] = [];
    for (const g of grupos) {
      ini.push(n);
      n +=
        nLinhasDoGrupo(g) +
        (porInsumo.get(g.insumoId) ?? SEM_NOVOS).reduce((t, x) => t + x.blocos.length, 0);
    }
    const iniNovos: number[] = [];
    for (const g of insumosNovos) {
      iniNovos.push(n);
      n += g.blocos.length;
    }
    return { inicios: ini, inicioDosNovos: iniNovos, nLinhas: n };
  }, [grupos, porInsumo, insumosNovos]);
  const { gridRef, propsDaCelula } = useGradeTeclado({
    nLinhas,
    nColunas: COLUNAS_INSUMO.length,
  });
  // ações ESTÁVEIS por referência (o `memo` do GrupoInsumo não re-renderiza todos os insumos a cada tecla numa linha nova)
  const acoes = useMemo<NovosAcoes>(
    () =>
      nv
        ? {
            mostrarPendencias: nv.mostrarPendencias,
            errosNovos: nv.errosNovos,
            onAtualizarNovo: nv.onAtualizarNovo,
            onRemoverNovo: nv.onRemoverNovo,
            onNovaCor: nv.onNovaCor,
          }
        : SEM_ACOES,
    // deps por campo (e não `nv`): o objeto `nv` é novo a cada render da Aba e desfaria o `memo` dos grupos
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nv?.mostrarPendencias, nv?.errosNovos, nv?.onAtualizarNovo, nv?.onRemoverNovo, nv?.onNovaCor],
  );
  const ex = useMemo<ExcluirAcoes>(
    () =>
      excluir
        ? { onExcluirInsumo: excluir.onExcluirInsumo, ocupado: excluir.ocupado }
        : SEM_EXCLUIR,
    [excluir?.onExcluirInsumo, excluir?.ocupado], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div className="space-y-2">
      <div
        ref={gridRef as RefObject<HTMLDivElement>}
        className="scroll-x-visivel max-h-[calc(100vh-16rem)] max-w-full overflow-y-auto rounded-md border"
        data-testid="insumos-grade-tabela"
        onPaste={aoColar}
      >
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              {/* Estado + Nome ficam FIXOS na horizontal (sticky left): ao rolar p/ o lado, sabe-se de qual insumo é a linha. */}
              <th className={cn(CLASSE_COL_ESTADO, "bg-muted py-2")}>
                <span className="sr-only">Estado</span>
              </th>
              {COLUNAS_INSUMO.map((c) => {
                const classe = cn(
                  "whitespace-nowrap px-2 py-2 font-medium",
                  c.key === COLUNA_FIXA && cn(CLASSE_COL_NOME, "bg-muted"),
                );
                return ordenacao && colunaOrdenavel(c) ? (
                  <SortTh
                    key={c.key}
                    label={c.rotulo}
                    sortKey={c.key}
                    sortState={ordenacao}
                    className={classe}
                  />
                ) : (
                  <th key={c.key} className={classe}>
                    {c.rotulo}
                  </th>
                );
              })}
              <th className="bg-muted px-2 py-2">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          {grupos.map((g, gi) => (
            <GrupoInsumo
              key={g.insumoId}
              grupo={g}
              blocosBase={blocosPorEtiqueta.get(g.insumoId) ?? SEM_BLOCOS}
              inicio={inicios[gi]}
              propsCel={propsDaCelula}
              opcoes={opcoes}
              readOnly={readOnly}
              registrar={registrar}
              novosAlvo={porInsumo.get(g.insumoId) ?? SEM_NOVOS}
              nv={acoes}
              ex={ex}
              avisos={avisos}
              onLimparAviso={onLimparAviso}
            />
          ))}
          {insumosNovos.map((g, gi) => (
            <tbody key={g.tmp} data-grupo-novo={g.tmp}>
              <LinhasInsumoNovo
                grupo={g}
                inicio={inicioDosNovos[gi]}
                propsCel={propsDaCelula}
                opcoes={opcoes}
                mostrarPendencias={acoes.mostrarPendencias}
                erro={acoes.errosNovos[g.tmp]}
                onChange={acoes.onAtualizarNovo}
                onRemover={acoes.onRemoverNovo}
                avisos={avisos}
                onLimparAviso={onLimparAviso}
              />
            </tbody>
          ))}
        </table>
      </div>
      {nv && !readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={nv.onNovoInsumo}>
          <Plus className="mr-1 h-4 w-4" /> Novo insumo
        </Button>
      )}
    </div>
  );
}
