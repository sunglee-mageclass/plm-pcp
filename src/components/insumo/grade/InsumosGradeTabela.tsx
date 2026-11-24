// Tabela da grade "Lista tipo Excel" de Cadastro > Insumos: cada insumo é um bloco — 1 linha-PAI (cabeçalho, só ela edita) + 1 linha-FILHO
// por COR (as cores nascem RECOLHIDAS: clicar na linha-pai abre/fecha). Espelha `AviamentosGradeTabela`, com a diferença do insumo:
// as cores NÃO têm rascunho próprio — o rascunho é UM por insumo (`useCardDraft`, id = insumo.id) e carrega o cabeçalho E os blocos de cor
// (`InsumoDraft.blocos`); cada linha-filho edita o bloco de mesma posição. Por isso as cores recolhidas nem precisam estar montadas.
//
// STAGING (nada grava antes do Salvar): editar uma célula só faz `patch` no rascunho (selo âmbar quando valor ≠ base). O Salvar (na
// `InsumosGradeAba`) chama o `salvar` de cada rascunho sujo (cabeçalho por UPDATE direto + cores por delete-and-reinsert — ver
// `insumo-grade/salvar.ts`). Cada rascunho se registra aqui por `registrar`. Criar/colar/excluir ficam para a IN-3.
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useCardDraft } from "@/components/shared/card-drafts/useCardDraft";
import { SortTh, type SortDir } from "@/components/shared/sort";
import { useGradeTeclado } from "@/lib/grade-teclado";
import { vinculoDisponivel } from "@/lib/insumo-tamanho";
import { colunaOrdenavel } from "@/lib/insumo-grade/ordenar";
import { COLUNAS_INSUMO, indiceDaColuna, type ColunaGrade } from "@/lib/insumo-grade/colunas";
import type { BlocoEntrada, InsumoEntrada, LinhaGrade } from "@/lib/insumo-grade/linhas";
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

/** O que cada rascunho entrega ao Salvar: lê o estado MAIS NOVO por ref, no momento de salvar. */
export type SaverApi = {
  dirty: () => boolean;
  salvar: (ctx: CtxSalvar) => Promise<void>;
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
  return {
    valor,
    sujo,
    cabecalhoSujo,
    blocoSujo,
    algumBlocoSujo,
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
};

type PaiProps = BaseLinhaProps & {
  /** Quantas cores o insumo tem (0 = "sem cores": a linha-pai é a única do insumo). */
  nCores: number;
  recolhido: boolean;
  onAlternar: () => void;
};

type FilhoProps = BaseLinhaProps & {
  /** Posição do bloco no rascunho (= a ordem do servidor; a tela pode ordenar as linhas, o bloco não muda de lugar). */
  idx: number;
};

/** Célula do CABEÇALHO (só a linha-pai chama). */
function celulaInsumo(col: ColunaGrade, c: PaiProps) {
  const { ctx, opcoes, readOnly, insumo } = c;
  // rótulo estável (nome do servidor): digitar o nome não muda o aria-label do próprio campo
  const ariaLabel = `${col.rotulo} de ${nomeDoInsumo(insumo)}`;
  const campo = CAMPO_INSUMO[col.key];
  if (!campo) return null;
  const desabilitado = readOnly || !col.editavel;

  if (col.key === "fornecedor") {
    return (
      <CelulaInsumo
        coluna={col}
        ariaLabel={ariaLabel}
        sujo={ctx.sujo("empresa_id") || ctx.sujo("representante_id")}
        desabilitado={desabilitado}
        fornecedor={{
          empresas: empresasParaLinha(opcoes.empresas, ctx.valor.empresa_id),
          empresaId: ctx.valor.empresa_id,
          representanteId: ctx.valor.representante_id,
          onChange: (empresaId, representanteId) => {
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
        dica={
          disponivel
            ? undefined
            : 'Só vale em insumo sem tamanho próprio: formato "Nenhum" ou nenhuma cor com tamanho marcado.'
        }
        tamanhosGrade={opcoes.tamanhosGrade}
      />
    );
  }

  return (
    <CelulaInsumo
      coluna={col}
      ariaLabel={ariaLabel}
      valor={ctx.valor[campo]}
      onChange={(v) => ctx.patch(campo, v)}
      sujo={ctx.sujo(campo as CampoCabecalho)}
      desabilitado={desabilitado}
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
  return (
    <span
      className="whitespace-nowrap px-2 text-xs text-muted-foreground"
      data-resumo-cores
      title={c.nCores === 0 ? "Insumo sem cores" : undefined}
    >
      {c.nCores === 0 ? "sem cores" : `${c.nCores} ${c.nCores === 1 ? "cor" : "cores"}`}
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
  const aoMudar = (v: unknown) => ctx.patchBloco(idx, { [campo]: v } as Partial<BlocoDraft>);
  if (col.key === "tamanhos") {
    const habilitada = tamanhosHabilitados(ctx.valor.formato_tamanho);
    return (
      <CelulaInsumo
        coluna={col}
        ariaLabel={ariaLabel}
        valor={bloco.tamanhos}
        onChange={aoMudar}
        sujo={sujo}
        desabilitado={readOnly || !col.editavel || !habilitada}
        dica={habilitada ? undefined : 'Formato "Nenhum": o insumo não tem tamanho.'}
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
      desabilitado={readOnly || !col.editavel}
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
    </tr>
  );
}

/** Linha-FILHO: uma cor do insumo, recuada sob o pai. As colunas do cabeçalho ficam VAZIAS (o cabeçalho é do pai). */
function LinhaFilho(props: FilhoProps) {
  const { insumo, ctx, idx } = props;
  return (
    <tr
      className="border-t border-dashed align-middle"
      data-insumo-id={insumo.id}
      data-cor-idx={idx}
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
              title={`Cor de ${nomeDoInsumo(insumo)}`}
            >
              ↳ cor
            </span>
          ) : null}
        </td>
      ))}
    </tr>
  );
}

/** Linhas (posições do teclado) que um insumo ocupa: a linha-pai + uma por cor (insumo sem cor = só a linha-pai). */
const nLinhasDoGrupo = (g: Grupo): number => (g.linhas[0]?.bloco ? 1 + g.linhas.length : 1);

const GrupoInsumo = memo(function GrupoInsumo({
  grupo,
  blocosBase,
  opcoes,
  readOnly,
  registrar,
  inicio,
  propsCel,
}: {
  grupo: Grupo;
  /** Cores do insumo NA ORDEM DO SERVIDOR (a ordem do rascunho; as linhas podem vir ordenadas por coluna). */
  blocosBase: BlocoEntrada[];
  opcoes: GradeOpcoes;
  readOnly: boolean;
  registrar: RegistrarSaver;
  /** Posição global da linha-pai deste insumo (as cores vêm logo depois). */
  inicio: number;
  propsCel: PropsCelula;
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
  return (
    <tbody data-grupo-insumo={insumo.id}>
      <LinhaPai
        insumo={insumo}
        ctx={ctx}
        opcoes={opcoes}
        readOnly={readOnly}
        nCores={cores.length}
        recolhido={recolhido}
        onAlternar={alternar}
        linhaIdx={inicio}
        propsCel={propsCel}
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
            linhaIdx={inicio + 1 + i}
            propsCel={propsCel}
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
}: {
  linhas: LinhaGrade[];
  /** Cores de cada insumo na ordem do servidor (a base do rascunho). */
  blocosPorEtiqueta: Map<string, BlocoEntrada[]>;
  opcoes: GradeOpcoes;
  readOnly: boolean;
  registrar: RegistrarSaver;
  /** Cabeçalhos clicáveis (ordenar). Ausente = cabeçalhos de texto. */
  ordenacao?: OrdenacaoProps;
}) {
  const grupos = useMemo(() => agruparLinhasPorInsumo(linhas), [linhas]);
  // Teclado (Enter desce / Tab ao lado): a "linha" é a posição GLOBAL na ordem da tela (cada insumo: a linha-pai + suas cores); a
  // "coluna" é a posição em COLUNAS_INSUMO.
  const { inicios, nLinhas } = useMemo(() => {
    let n = 0;
    const ini: number[] = [];
    for (const g of grupos) {
      ini.push(n);
      n += nLinhasDoGrupo(g);
    }
    return { inicios: ini, nLinhas: n };
  }, [grupos]);
  const { gridRef, propsDaCelula } = useGradeTeclado({
    nLinhas,
    nColunas: COLUNAS_INSUMO.length,
  });
  return (
    <div className="space-y-2">
      <div
        ref={gridRef as RefObject<HTMLDivElement>}
        className="scroll-x-visivel max-h-[calc(100vh-16rem)] max-w-full overflow-y-auto rounded-md border"
        data-testid="insumos-grade-tabela"
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
            />
          ))}
        </table>
      </div>
    </div>
  );
}
