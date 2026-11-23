// Tabela da grade "Lista tipo Excel" de Cadastro > Aviamentos: cada aviamento é um bloco — 1 linha-PAI (cabeçalho, só ela edita) +
// 1 linha-FILHO por cor (as cores nascem RECOLHIDAS: clicar na linha-pai abre/fecha). Espelha `TecidosGradeTabela`, adaptado.
//
// STAGING (nada grava antes do Salvar): cada AVIAMENTO tem um rascunho (`useCardDraft`, id = aviamento.id) e cada COR outro
// (id = variante.id), ambos no `CardDraftsProvider` da aba. Editar uma célula só faz `patch` no rascunho (selo âmbar quando
// valor ≠ base). O Salvar (na `AviamentosGradeAba`) chama o `salvar` de cada rascunho sujo — aviamentos primeiro, depois as cores
// (as cores de um aviamento vão numa só chamada de lote). Cada rascunho se registra aqui por `registrar`.
// Também CRIA (linhas NOVAS em rascunho, `AviamentoNovoGrupo`), COLA do Excel (bloco TSV na célula-âncora) e EXCLUI (lixeira única por
// linha; grava na hora, atrás de confirmação).
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
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCardDraft } from "@/components/shared/card-drafts/useCardDraft";
import type { SalvarCtx } from "@/components/shared/card-drafts/CardDraftsProvider";
import { SortTh, type SortDir } from "@/components/shared/sort";
import { useGradeTeclado } from "@/lib/grade-teclado";
import { colunaOrdenavel } from "@/lib/aviamento-grade/ordenar";
import { COLUNAS_AVIAMENTO, indiceDaColuna, type ColunaGrade } from "@/lib/aviamento-grade/colunas";
import {
  chaveLinha,
  type AviamentoEntrada,
  type LinhaGrade,
  type VarianteEntrada,
} from "@/lib/aviamento-grade/linhas";
import {
  CAMPO_AVIAMENTO,
  CAMPO_VARIANTE,
  controleDaCelula,
  empresasParaLinha,
  opcoesDaColuna,
  subcategoriaAposTrocarCategoria,
} from "@/lib/aviamento-grade/celulas";
import {
  aviamentoParaDraft,
  atualizarAviamento,
  montarPayloadAviamento,
  salvarLoteVariantes,
  textoErroSalvar,
  varianteParaDraft,
  type AviamentoDraft,
  type CtxSalvar,
  type VarianteDraft,
} from "@/lib/aviamento-grade/salvar";
import { cn } from "@/lib/utils";
import type { AviamentoNovo } from "@/lib/aviamento-grade/linha-nova";
import type { GradeOpcoes } from "./useAviamentosGrade";
import { CelulaAviamento, type GradeCelProps } from "./CelulaAviamento";
import { CelulaFotoVariante } from "./CelulaFotoVariante";
import { CLASSE_COL_ACOES, LinhasAviamentoNovo, type AtualizarNovo } from "./AviamentoNovoGrupo";
import { CelulaCorBaseMulti } from "@/components/tecido/grade/CelulaCorBaseMulti";

/** O que cada rascunho entrega ao Salvar: lê o estado MAIS NOVO por ref, no momento de salvar. */
export type SaverApi =
  | {
      kind: "aviamento";
      dirty: () => boolean;
      salvar: (ctx: CtxSalvar) => Promise<void>;
      /** Colar do Excel: aplica campos NO RASCUNHO (um `patch` por campo; nada grava). */
      aplicar: (campos: Record<string, unknown>) => void;
      /** Valor atual do rascunho (fornecedor/categoria que a colagem precisa conhecer). */
      ler: () => Record<string, unknown>;
    }
  | {
      kind: "variante";
      aviamentoId: string;
      dirty: () => boolean;
      /** Só os campos que a pessoa mexeu (rascunho ≠ base): vão por cima da leitura fresca do servidor no lote. */
      mudancas: () => Partial<VarianteDraft>;
      salvar: (ctx: CtxSalvar) => Promise<void>;
      aplicar: (campos: Record<string, unknown>) => void;
      ler: () => Record<string, unknown>;
    };
/** Registra um rascunho no wrapper do Salvar; devolve o "desregistrar". Precisa ser ESTÁVEL (useCallback) na tela. */
export type RegistrarSaver = (id: string, api: SaverApi) => () => void;

type Grupo = { aviamentoId: string; aviamento: AviamentoEntrada; linhas: LinhaGrade[] };

/** Linhas consecutivas do mesmo aviamento viram um grupo (montarLinhas já entrega o aviamento inteiro em sequência). */
function agruparLinhasPorAviamento(linhas: LinhaGrade[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const l of linhas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.aviamentoId === l.aviamentoId) ultimo.linhas.push(l);
    else grupos.push({ aviamentoId: l.aviamentoId, aviamento: l.aviamento, linhas: [l] });
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

/** Nome para rótulos: o nome do aviamento; sem nome, o código (o identificador). */
const nomeDoAviamento = (a: AviamentoEntrada): string => a.codigo_nome || a.codigo || "aviamento";

// ---------------------------------------------------------------- aviamento (rascunho do cabeçalho)

type AviamentoCtx = {
  valor: AviamentoDraft;
  sujo: (k: keyof AviamentoDraft) => boolean;
  patch: (k: keyof AviamentoDraft, v: unknown) => void;
  dirty: boolean;
  erro: string | null;
};

function useRascunhoAviamento(
  aviamento: AviamentoEntrada,
  registrar: RegistrarSaver,
): AviamentoCtx {
  const base = useEstavel(aviamentoParaDraft(aviamento));
  const [erro, setErro] = useState<string | null>(null);

  const salvarFn = useCallback(
    async (mudancas: Partial<AviamentoDraft>, baseEnviada: AviamentoDraft) => {
      setErro(null);
      try {
        // "último vence": UPDATE direto, sem rev (como a tela de Aviamentos de hoje)
        await atualizarAviamento(aviamento.id, montarPayloadAviamento(mudancas, baseEnviada));
      } catch (e) {
        setErro(textoErroSalvar(e));
        throw e;
      }
    },
    [aviamento.id],
  );
  const draft = useCardDraft<AviamentoDraft>({
    id: aviamento.id,
    base,
    salvarFn,
    onDescartar: () => setErro(null),
  });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(
    () =>
      registrar(aviamento.id, {
        kind: "aviamento",
        dirty: () => draftRef.current.dirty,
        salvar: (ctx) => draftRef.current.salvar(ctx),
        aplicar: (campos) => {
          for (const [k, v] of Object.entries(campos))
            draftRef.current.patch(k as keyof AviamentoDraft, v as never);
        },
        ler: () => ({ ...draftRef.current.valor }),
      }),
    [registrar, aviamento.id],
  );
  useEffect(() => {
    if (!draft.dirty) setErro(null);
  }, [draft.dirty]);

  const { valor, dirty, patch } = draft;
  const sujo = useCallback(
    (k: keyof AviamentoDraft) => dirty && !Object.is(valor[k], base[k]),
    [dirty, valor, base],
  );
  const patchCampo = useCallback(
    (k: keyof AviamentoDraft, v: unknown) => patch(k, v as never),
    [patch],
  );
  return { valor, sujo, patch: patchCampo, dirty, erro };
}

// ---------------------------------------------------------------- cor (rascunho da variante)

type VarianteCtx = {
  valor: VarianteDraft;
  sujo: (k: keyof VarianteDraft) => boolean;
  patch: (k: keyof VarianteDraft, v: unknown) => void;
  dirty: boolean;
  erro: string | null;
};

function useRascunhoVariante(variante: VarianteEntrada, registrar: RegistrarSaver): VarianteCtx {
  const base = useEstavel(varianteParaDraft(variante));
  const baseRef = useRef(base);
  baseRef.current = base;
  const [erro, setErro] = useState<string | null>(null);
  const varianteId = variante.id;
  const aviamentoId = variante.aviamento_id;

  // O servidor é chamado UMA vez por aviamento (lote, pela Aba); aqui a cor só recebe o resultado e rebaseia o rascunho. Sem lote
  // (salvar avulso) grava ela mesma, no mesmo caminho do lote.
  const salvarFn = useCallback(
    async (mudancas: Partial<VarianteDraft>, _baseEnviada: VarianteDraft, ctx?: SalvarCtx) => {
      setErro(null);
      try {
        const lote = (ctx as CtxSalvar | undefined)?.lote;
        if (lote) {
          if (lote.erro) throw lote.erro;
          return;
        }
        await salvarLoteVariantes(aviamentoId, [{ id: varianteId, mudancas }]);
      } catch (e) {
        setErro(textoErroSalvar(e));
        throw e;
      }
    },
    [aviamentoId, varianteId],
  );
  const draft = useCardDraft<VarianteDraft>({
    id: varianteId,
    base,
    salvarFn,
    onDescartar: () => setErro(null),
  });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(
    () =>
      registrar(varianteId, {
        kind: "variante",
        aviamentoId,
        dirty: () => draftRef.current.dirty,
        mudancas: () => {
          const v = draftRef.current.valor;
          const b = baseRef.current;
          const m: Partial<VarianteDraft> = {};
          for (const k of Object.keys(b) as Array<keyof VarianteDraft>) {
            if (!Object.is(v[k], b[k])) (m as Record<string, unknown>)[k] = v[k];
          }
          return m;
        },
        salvar: (ctx) => draftRef.current.salvar(ctx),
        aplicar: (campos) => {
          for (const [k, v] of Object.entries(campos))
            draftRef.current.patch(k as keyof VarianteDraft, v as never);
        },
        ler: () => ({ ...draftRef.current.valor }),
      }),
    [registrar, varianteId, aviamentoId],
  );
  useEffect(() => {
    if (!draft.dirty) setErro(null);
  }, [draft.dirty]);

  const { valor, dirty, patch } = draft;
  const sujo = useCallback(
    (k: keyof VarianteDraft) => dirty && !Object.is(valor[k], base[k]),
    [dirty, valor, base],
  );
  const patchCampo = useCallback(
    (k: keyof VarianteDraft, v: unknown) => patch(k, v as never),
    [patch],
  );
  return { valor, sujo, patch: patchCampo, dirty, erro };
}

// ---------------------------------------------------------------- linhas
// Cada AVIAMENTO é um bloco (<tbody>): 1 linha-PAI (cabeçalho: código, nome, fornecedor, preço… — SÓ ela mostra e edita) + N linhas-FILHO
// (uma por cor: só os campos da cor). Clicar no pai recolhe/expande as cores (nascem recolhidas). Aviamento sem cor = só a linha-pai.

type BaseLinhaProps = {
  aviamento: AviamentoEntrada;
  opcoes: GradeOpcoes;
  readOnly: boolean;
  /** Avisos da última colagem (chave `<linha>|<coluna>`) e como apagar um (ao editar a célula). */
  avisos: Record<string, string>;
  onLimparAviso: (chaveCelula: string) => void;
  /** Excluir cor / aviamento já cadastrados (grava na hora, com confirmação). */
  ex: ExcluirAcoes;
  /** Posição GLOBAL desta linha na grade (contínua entre os aviamentos, na ordem da tela): é a "linha" do endereço de teclado. */
  linhaIdx: number;
  propsCel: PropsCelula;
};

/** O que as cores RECOLHIDAS (escondidas) de um aviamento guardam: edição não salva / erro de salvar não podem ficar invisíveis. */
type EstadoFilho = "sujo" | "erro";
type ReportarFilho = (varianteId: string, estado: EstadoFilho | null) => void;

type PaiProps = BaseLinhaProps & {
  ctxA: AviamentoCtx;
  /** Quantas cores cadastradas o aviamento tem (0 = "sem cores": a linha-pai é a única do aviamento). */
  nCores: number;
  /** Cores que o aviamento JÁ tem (cadastradas + novas no rascunho): o popover multi-cor as mostra marcadas e travadas. */
  presentes: readonly string[];
  /** Cria cores novas no aviamento (multi-cor da linha-pai). */
  onAdicionarCores: NovosAcoes["onAdicionarCores"];
  /** Botão "+ cor" (cor nova neste aviamento); some quando já há cor nova pendente. */
  botaoCor?: ReactNode;
  recolhido: boolean;
  onAlternar: () => void;
  /** Cores recolhidas com edição não salva / erro (só conta quando `recolhido`). */
  filhosOcultos: { sujo: boolean; erro: boolean };
};

type FilhoProps = BaseLinhaProps & {
  variante: VarianteEntrada;
  ctxV: VarianteCtx;
  /** Cores recolhidas: a linha continua montada (o rascunho segue registrado no Salvar), só fica escondida. */
  oculta: boolean;
};

/** `useGradeTeclado().propsDaCelula`: endereça a célula (`data-grade-cel`) e liga Enter/Tab. */
type PropsCelula = (linha: number, coluna: number) => GradeCelProps;

/** Chave da célula nos avisos de colagem: `<chave da linha>|<chave da coluna>`. */
const chaveCelula = (chaveDaLinha: string, colKey: string): string => `${chaveDaLinha}|${colKey}`;

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

/** Célula do CABEÇALHO (só a linha-pai chama). */
function celulaAviamento(col: ColunaGrade, c: PaiProps) {
  const { ctxA, opcoes, readOnly, aviamento } = c;
  // rótulo estável (nome do servidor): digitar o nome não muda o aria-label do próprio campo
  const nome = nomeDoAviamento(aviamento);
  const ariaLabel = `${col.rotulo} de ${nome}`;
  const chaveAv = chaveCelula(chaveLinha(aviamento.id, null), col.key);
  const campo = CAMPO_AVIAMENTO[col.key];
  if (!campo) return null;
  const desabilitado = readOnly || !col.editavel;

  if (col.key === "fornecedor") {
    return (
      <CelulaAviamento
        coluna={col}
        ariaLabel={ariaLabel}
        sujo={ctxA.sujo("empresa_id") || ctxA.sujo("representante_id")}
        aviso={c.avisos[chaveAv]}
        desabilitado={desabilitado}
        fornecedor={{
          empresas: empresasParaLinha(opcoes.empresas, ctxA.valor.empresa_id),
          empresaId: ctxA.valor.empresa_id,
          representanteId: ctxA.valor.representante_id,
          onChange: (empresaId, representanteId) => {
            c.onLimparAviso(chaveAv);
            ctxA.patch("empresa_id", empresaId);
            ctxA.patch("representante_id", representanteId);
          },
        }}
      />
    );
  }

  const aoMudar = (v: unknown) => {
    c.onLimparAviso(chaveAv);
    ctxA.patch(campo, v);
    if (col.key === "categoria") {
      // A subcategoria cascateia pela categoria: a que não pertence à nova sai junto.
      const sub = subcategoriaAposTrocarCategoria(
        (v as string | null) ?? null,
        ctxA.valor.subcategoria_aviamento_id,
        opcoes.subcategorias,
      );
      if (sub !== ctxA.valor.subcategoria_aviamento_id)
        ctxA.patch("subcategoria_aviamento_id", sub);
    }
  };
  return (
    <CelulaAviamento
      coluna={col}
      ariaLabel={ariaLabel}
      valor={ctxA.valor[campo]}
      onChange={aoMudar}
      sujo={ctxA.sujo(campo)}
      aviso={c.avisos[chaveAv]}
      desabilitado={desabilitado}
      opcoes={opcoesDaColuna(col.key, opcoes, { categoriaId: ctxA.valor.categoria_aviamento_id })}
      placeholder={col.key === "codigo_nome" ? (aviamento.codigo ?? undefined) : undefined}
      gradeProps={c.propsCel(c.linhaIdx, indiceDaColuna(col.key))}
    />
  );
}

/** Célula "Cor base" da linha-PAI: quantas cores o aviamento tem + "+ cor" + a seleção MÚLTIPLA (cada cor marcada vira uma cor nova). */
function celulaCoresDoPai(c: PaiProps): ReactNode {
  const resumo = (
    <>
      <span
        className="whitespace-nowrap px-2 text-xs text-muted-foreground"
        data-resumo-cores
        title={c.nCores === 0 ? "Aviamento sem cores" : undefined}
      >
        {c.nCores === 0 ? "sem cores" : `${c.nCores} ${c.nCores === 1 ? "cor" : "cores"}`}
      </span>
      {c.botaoCor}
    </>
  );
  if (c.readOnly) return resumo;
  return (
    <CelulaCorBaseMulti
      cores={c.opcoes.cores}
      presentes={c.presentes}
      onAdicionar={(ids) =>
        c.onAdicionarCores(
          c.aviamento.id,
          nomeDoAviamento(c.aviamento),
          ids,
          c.ctxA.valor.preco ?? null,
        )
      }
      ariaLabel={`Adicionar várias cores em ${nomeDoAviamento(c.aviamento)}`}
      entidade="aviamento"
    >
      {resumo}
    </CelulaCorBaseMulti>
  );
}

/** Célula da COR (só a linha-filho chama). */
function celulaVariante(col: ColunaGrade, c: FilhoProps) {
  const { ctxV, variante, opcoes, readOnly, aviamento } = c;
  const ariaLabel = `${col.rotulo} da cor de ${nomeDoAviamento(aviamento)}`;
  const chaveAv = chaveCelula(chaveLinha(aviamento.id, variante.id), col.key);
  if (col.key === "foto")
    return (
      <CelulaFotoVariante
        coluna={col}
        ariaLabel={ariaLabel}
        variante={variante}
        readOnly={readOnly}
      />
    );
  const campo = CAMPO_VARIANTE[col.key];
  if (!campo) return null;
  const aoMudar = (v: unknown) => {
    c.onLimparAviso(chaveAv);
    if (col.key === "cor_base") {
      // Mesma regra do Sheet: o apelido que não é da nova cor base sai junto (a RPC recebe os dois no MESMO lote).
      const b = String(v ?? "");
      ctxV.patch("cor_id", b);
      const mantem = opcoes.coresApelido.some(
        (a) => a.id === ctxV.valor.cor_apelido_id && a.cor_base_id === b,
      );
      ctxV.patch("cor_apelido_id", mantem ? ctxV.valor.cor_apelido_id : "");
    } else if (col.key === "cor_apelido") {
      // Escolher o apelido preenche a cor base dele; limpar o apelido não mexe na cor base.
      const a = String(v ?? "");
      const baseDoApelido =
        opcoes.coresApelido.find((x) => x.id === a)?.cor_base_id ?? ctxV.valor.cor_id;
      ctxV.patch("cor_apelido_id", a);
      ctxV.patch("cor_id", baseDoApelido);
    } else {
      ctxV.patch(campo, v);
    }
  };
  return (
    <CelulaAviamento
      coluna={col}
      ariaLabel={ariaLabel}
      valor={ctxV.valor[campo]}
      onChange={aoMudar}
      sujo={ctxV.sujo(campo)}
      aviso={c.avisos[chaveAv]}
      desabilitado={readOnly || !col.editavel}
      opcoes={opcoesDaColuna(col.key, opcoes, { corId: ctxV.valor.cor_id })}
      gradeProps={c.propsCel(c.linhaIdx, indiceDaColuna(col.key))}
    />
  );
}

/** "Azul (Marinho)" / "Azul" / "sem cor": como a cor é chamada nas confirmações de excluir. */
function rotuloDaCor(v: VarianteEntrada, opcoes: GradeOpcoes): string {
  const base = opcoes.cores.find((x) => x.id === v.cor_id)?.nome;
  const apelido = opcoes.coresApelido.find((x) => x.id === v.cor_apelido_id)?.nome;
  if (!base && !apelido) return "sem cor";
  return apelido ? `${base ?? "—"} (${apelido})` : (base ?? "—");
}

/** Última coluna: UMA lixeira por linha. Na linha-PAI exclui o AVIAMENTO + todas as cores; na linha da cor, só aquela cor.
 *  Já cadastrado → confirmação + grava na hora. */
function CelulaAcoes({
  aviamento,
  variante,
  readOnly,
  ex,
  opcoes,
}: {
  aviamento: AviamentoEntrada;
  variante: VarianteEntrada | null;
  readOnly: boolean;
  ex: ExcluirAcoes;
  opcoes: GradeOpcoes;
}) {
  if (readOnly || ex === SEM_EXCLUIR) return null;
  // sem `variante` = linha-pai = excluir o aviamento inteiro; com `variante` = excluir só aquela cor.
  const corRotulo = variante ? rotuloDaCor(variante, opcoes) : "";
  const nome = nomeDoAviamento(aviamento);
  const onClick = () =>
    variante
      ? ex.onExcluirCor({
          aviamentoId: aviamento.id,
          aviamentoNome: nome,
          varianteId: variante.id,
          corRotulo,
        })
      : ex.onExcluirAviamento({ aviamentoId: aviamento.id, aviamentoNome: nome });
  return (
    <span className="flex items-center justify-end">
      <button
        type="button"
        disabled={ex.ocupado}
        onClick={onClick}
        aria-label={
          variante
            ? `Excluir a cor ${corRotulo} de ${nome}`
            : `Excluir o aviamento ${nome} e todas as cores`
        }
        title={
          variante
            ? "Excluir esta cor (pede confirmação)"
            : "Excluir o aviamento inteiro e todas as cores (pede confirmação)"
        }
        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        data-acao={variante ? "excluir-cor" : "excluir-aviamento"}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/** Estado + Nome ficam FIXOS na horizontal (sticky left): a largura da coluna de estado (chevron + selo) é a mesma do deslocamento do Nome. */
const CLASSE_COL_ESTADO = "sticky left-0 z-10 w-10 min-w-10 px-1 py-1.5 text-center";
const CLASSE_COL_NOME = "sticky left-10 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]";
/** A coluna fixa é o Nome (`codigo_nome`): o que identifica a linha ao rolar para o lado. */
const COLUNA_FIXA = "codigo_nome";

/** Cliques que NÃO recolhem o aviamento: quem edita/aciona alguma coisa na linha-pai (e o que o popover/select abre por portal). */
const INTERATIVO =
  "input,button,select,textarea,a,label,[role=combobox],[role=checkbox],[role=button],[role=switch],[role=option],[contenteditable=true]";

/** Linha-PAI do aviamento: cabeçalho (editável só aqui) + chevron que recolhe/expande as cores. */
function LinhaPai(props: PaiProps) {
  const { aviamento, ctxA, nCores, recolhido, onAlternar, filhosOcultos } = props;
  const temCores = nCores > 0;
  const nome = nomeDoAviamento(aviamento);
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
      data-aviamento-id={aviamento.id}
      data-pai
      data-recolhido={temCores && recolhido ? "" : undefined}
      data-slot={chaveLinha(aviamento.id, null)}
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
              title={
                recolhido ? "Mostrar as cores deste aviamento" : "Esconder as cores deste aviamento"
              }
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
          <EstadoLinha sujo={ctxA.dirty} erro={ctxA.erro} />
          {recolhido && filhosOcultos.erro ? (
            <span role="alert" title="Uma cor escondida não salvou" data-erro-filho-oculto>
              <AlertTriangle
                className="h-4 w-4 text-destructive"
                aria-label="Uma cor escondida não salvou"
              />
            </span>
          ) : recolhido && filhosOcultos.sujo ? (
            <span
              role="status"
              title="Há cores escondidas com alterações não salvas"
              data-selo-filho-oculto
              className="inline-block h-2 w-2 rounded-full bg-amber-500"
            />
          ) : null}
        </span>
      </td>
      {COLUNAS_AVIAMENTO.map((col) => (
        <td
          key={col.key}
          className={cn("bg-muted px-1.5 py-1.5", col.key === COLUNA_FIXA && CLASSE_COL_NOME)}
          data-col={col.key}
        >
          {col.escopo === "aviamento"
            ? celulaAviamento(col, props)
            : col.key === "cor_base"
              ? celulaCoresDoPai(props)
              : null}
        </td>
      ))}
      <td className={cn(CLASSE_COL_ACOES, "bg-muted")} data-col-acoes>
        <CelulaAcoes
          aviamento={aviamento}
          variante={null}
          readOnly={props.readOnly}
          ex={props.ex}
          opcoes={props.opcoes}
        />
      </td>
    </tr>
  );
}

/** Linha-FILHO: uma cor do aviamento, recuada sob o pai. As colunas do cabeçalho ficam VAZIAS (o cabeçalho é do pai). */
function LinhaFilho(props: FilhoProps) {
  const { aviamento, variante, ctxV, oculta } = props;
  return (
    <tr
      className={cn("border-t border-dashed align-middle", oculta && "hidden")}
      hidden={oculta}
      data-aviamento-id={aviamento.id}
      data-variante-id={variante.id}
      data-slot={chaveLinha(aviamento.id, variante.id)}
    >
      <td className={cn(CLASSE_COL_ESTADO, "border-l-4 border-l-primary/30 bg-background")}>
        <EstadoLinha sujo={ctxV.dirty} erro={ctxV.erro} />
      </td>
      {COLUNAS_AVIAMENTO.map((col) => (
        <td
          key={col.key}
          className={cn(
            "px-1.5 py-1.5",
            col.key === COLUNA_FIXA && cn(CLASSE_COL_NOME, "bg-background"),
          )}
          data-col={col.key}
        >
          {col.escopo === "variante" ? (
            celulaVariante(col, props)
          ) : col.key === COLUNA_FIXA ? (
            <span
              className="flex items-center gap-1 pl-5 text-xs text-muted-foreground"
              data-recuo
              title={`Cor de ${nomeDoAviamento(aviamento)}`}
            >
              ↳ cor
            </span>
          ) : null}
        </td>
      ))}
      <td className={CLASSE_COL_ACOES} data-col-acoes>
        <CelulaAcoes
          aviamento={aviamento}
          variante={variante}
          readOnly={props.readOnly}
          ex={props.ex}
          opcoes={props.opcoes}
        />
      </td>
    </tr>
  );
}

function LinhaComCor({
  variante,
  registrar,
  onEstado,
  ...resto
}: Omit<FilhoProps, "ctxV"> & { registrar: RegistrarSaver; onEstado: ReportarFilho }) {
  const ctxV = useRascunhoVariante(variante, registrar);
  // O aviamento recolhido esconde esta linha mas ela continua montada (o Salvar a enxerga); o pai mostra se há algo pendente nela.
  const estado: EstadoFilho | null = ctxV.erro ? "erro" : ctxV.dirty ? "sujo" : null;
  useEffect(() => {
    onEstado(variante.id, estado);
  }, [onEstado, variante.id, estado]);
  useEffect(() => () => onEstado(variante.id, null), [onEstado, variante.id]);
  return <LinhaFilho {...resto} variante={variante} ctxV={ctxV} />;
}

/** Props do que a tela guarda das linhas NOVAS (rascunho da aba) e das ações sobre elas. */
export type NovosAcoes = {
  /** Depois de tentar salvar: os pendentes ficam em vermelho. */
  mostrarPendencias: boolean;
  /** Erro do servidor por grupo novo (tmp → mensagem PT-BR). */
  errosNovos: Record<string, string>;
  onAtualizarNovo: AtualizarNovo;
  onRemoverNovo: (tmp: string) => void;
  /** "+ cor" num aviamento que já existe. */
  onNovaCor: (aviamentoId: string, nome: string) => void;
  /** Multi-cor da linha-pai de um aviamento que já existe: cria uma cor nova (com o preço herdado) por cor marcada. */
  onAdicionarCores: (
    aviamentoId: string,
    nome: string,
    corIds: string[],
    preco: number | null,
  ) => void;
};

/** Excluir o que JÁ está cadastrado: confirma e grava NA HORA (fora do rascunho/Salvar). Recebe a ordem da tela; quem confirma é a Aba. */
export type ExcluirProps = {
  onExcluirCor: (a: {
    aviamentoId: string;
    aviamentoNome: string;
    varianteId: string;
    corRotulo: string;
  }) => void;
  onExcluirAviamento: (a: { aviamentoId: string; aviamentoNome: string }) => void;
  /** Uma exclusão (ou o Salvar) em andamento: os botões ficam travados. */
  ocupado: boolean;
};
type ExcluirAcoes = ExcluirProps;
export type NovosProps = NovosAcoes & {
  novos: AviamentoNovo[];
  onNovoAviamento: () => void;
};

/** Colar do Excel: avisos da última colagem + o que fazer ao editar a célula / ao colar um bloco. */
export type ColarProps = {
  /** Texto que NÃO foi aplicado (chave `<linha>|<coluna>`): a célula fica em laranja tracejado, com o motivo no `title`. */
  avisos: Record<string, string>;
  onLimparAviso: (chaveCelula: string) => void;
  /** Recebe o bloco (texto da área de transferência) e a célula-âncora. `true` = tratou como bloco (o colar normal é cancelado). */
  onColar: (a: { chaveLinha: string; colKey: string; texto: string }) => boolean;
};

const SEM_AVISOS: Record<string, string> = {};
const NADA = () => {};

const SEM_NOVOS: AviamentoNovo[] = [];
const SEM_ERROS: Record<string, string> = {};
const SEM_ACOES: NovosAcoes = {
  mostrarPendencias: false,
  errosNovos: SEM_ERROS,
  onAtualizarNovo: () => {},
  onRemoverNovo: () => {},
  onNovaCor: () => {},
  onAdicionarCores: () => {},
};
const SEM_EXCLUIR: ExcluirAcoes = {
  onExcluirCor: () => {},
  onExcluirAviamento: () => {},
  ocupado: false,
};

/** Linhas (posições do teclado) que um aviamento cadastrado ocupa: a linha-pai + uma por cor (aviamento sem cor = só a linha-pai). */
const nLinhasDoGrupo = (g: Grupo): number => (g.linhas[0]?.variante ? 1 + g.linhas.length : 1);

const GrupoAviamento = memo(function GrupoAviamento({
  grupo,
  opcoes,
  readOnly,
  registrar,
  novosAlvo,
  nv,
  ex,
  avisos,
  onLimparAviso,
  inicio,
  propsCel,
}: {
  grupo: Grupo;
  opcoes: GradeOpcoes;
  readOnly: boolean;
  registrar: RegistrarSaver;
  /** Posição global da linha-pai deste aviamento (as cores vêm logo depois; as cores novas dele, depois das cadastradas). */
  inicio: number;
  propsCel: PropsCelula;
  avisos: Record<string, string>;
  onLimparAviso: (chaveCelula: string) => void;
  /** Cores novas deste aviamento (rascunho); entram no fim do mesmo <tbody> e nunca são escondidas pelo recolher. */
  novosAlvo: AviamentoNovo[];
  nv: NovosAcoes;
  ex: ExcluirAcoes;
}) {
  const { aviamento, linhas } = grupo;
  const ctxA = useRascunhoAviamento(aviamento, registrar);
  const cores = useMemo(
    () => linhas.filter((l): l is LinhaGrade & { variante: VarianteEntrada } => l.variante != null),
    [linhas],
  );
  // Recolher/expandir as cores deste aviamento: estado só local (não persiste); começa RECOLHIDO (a lista abre só com os cabeçalhos —
  // com muitos aviamentos, abre-se só o que vai mexer). Aviamento sem cor não recolhe.
  const [recolhidoLivre, setRecolhido] = useState(true);
  const recolhido = recolhidoLivre && cores.length > 0;
  const alternar = useCallback(() => setRecolhido((r) => !r), []);
  // O que as cores escondidas guardam (edição não salva / erro): o pai mostra, para não salvar às cegas nem esconder uma falha.
  const [estadoFilhos, setEstadoFilhos] = useState<Record<string, EstadoFilho>>({});
  const reportarFilho = useCallback<ReportarFilho>((id, e) => {
    setEstadoFilhos((m) => {
      if ((m[id] ?? null) === e) return m;
      const prox = { ...m };
      if (e) prox[id] = e;
      else delete prox[id];
      return prox;
    });
  }, []);
  const filhosOcultos = useMemo(() => {
    const v = Object.values(estadoFilhos);
    return { sujo: v.length > 0, erro: v.includes("erro") };
  }, [estadoFilhos]);
  // Uma cor escondida que NÃO salvou abre o aviamento: o erro precisa estar à vista (a pessoa pode recolher de novo depois).
  useEffect(() => {
    if (filhosOcultos.erro) setRecolhido(false);
  }, [filhosOcultos.erro]);
  // cores que o aviamento já tem (cadastradas + novas no rascunho): o multi-cor da linha-pai as mostra marcadas e travadas
  const presentes = useMemo(
    () => [
      ...cores.map((l) => l.variante.cor_id).filter((id): id is string => !!id),
      ...novosAlvo.flatMap((g) => g.vars.flatMap((v) => (v.cor_id ? [v.cor_id] : []))),
    ],
    [cores, novosAlvo],
  );
  // "+ cor" (na linha-pai) só some quando já há cor nova pendente neste aviamento (aí o botão "adicionar variante" do grupo faz o papel)
  const botaoCor =
    !readOnly && novosAlvo.length === 0 ? (
      <button
        type="button"
        onClick={() => nv.onNovaCor(aviamento.id, nomeDoAviamento(aviamento))}
        aria-label={`Adicionar cor em ${nomeDoAviamento(aviamento)}`}
        title="Adicionar cor neste aviamento"
        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    ) : undefined;
  return (
    <tbody data-grupo-aviamento={aviamento.id}>
      <LinhaPai
        aviamento={aviamento}
        ctxA={ctxA}
        opcoes={opcoes}
        readOnly={readOnly}
        nCores={cores.length}
        presentes={presentes}
        onAdicionarCores={nv.onAdicionarCores}
        botaoCor={botaoCor}
        recolhido={recolhido}
        onAlternar={alternar}
        filhosOcultos={filhosOcultos}
        avisos={avisos}
        onLimparAviso={onLimparAviso}
        ex={ex}
        linhaIdx={inicio}
        propsCel={propsCel}
      />
      {cores.map((l, i) => (
        <LinhaComCor
          key={l.chave}
          aviamento={aviamento}
          opcoes={opcoes}
          readOnly={readOnly}
          variante={l.variante}
          registrar={registrar}
          onEstado={reportarFilho}
          oculta={recolhido}
          avisos={avisos}
          onLimparAviso={onLimparAviso}
          ex={ex}
          linhaIdx={inicio + 1 + i}
          propsCel={propsCel}
        />
      ))}
      {novosAlvo.map((g, gi) => (
        <LinhasAviamentoNovo
          key={g.tmp}
          grupo={g}
          inicio={
            inicio +
            nLinhasDoGrupo(grupo) +
            novosAlvo.slice(0, gi).reduce((n, x) => n + x.vars.length, 0)
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

/** Ordenação por coluna (estado na Aba, que ordena as `linhas` ANTES de entregá-las): só desenha os cabeçalhos clicáveis. */
export type OrdenacaoProps = {
  sortKey: string | null;
  sortDir: SortDir;
  toggle: (key: string) => void;
};

export function AviamentosGradeTabela({
  linhas,
  opcoes,
  readOnly,
  registrar,
  novos: nv,
  colar,
  excluir,
  ordenacao,
}: {
  linhas: LinhaGrade[];
  opcoes: GradeOpcoes;
  readOnly: boolean;
  registrar: RegistrarSaver;
  /** Linhas novas (rascunho) + ações. Ausente = a grade só edita os existentes. */
  novos?: NovosProps;
  /** Colar do Excel. Ausente = colar normal, célula a célula. */
  colar?: ColarProps;
  /** Excluir cor/aviamento cadastrados. Ausente = a grade não oferece os botões de excluir. */
  excluir?: ExcluirProps;
  /** Cabeçalhos clicáveis (ordenar). Ausente = cabeçalhos de texto. */
  ordenacao?: OrdenacaoProps;
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
  const grupos = useMemo(() => agruparLinhasPorAviamento(linhas), [linhas]);
  // cores novas de aviamento existente entram no <tbody> do aviamento; aviamento novo ganha <tbody> próprio, no fim
  const { porAviamento, aviamentosNovos } = useMemo(() => {
    const mapa = new Map<string, AviamentoNovo[]>();
    const soNovos: AviamentoNovo[] = [];
    for (const g of nv?.novos ?? SEM_NOVOS) {
      if (g.aviamentoAlvoId)
        (
          mapa.get(g.aviamentoAlvoId) ?? mapa.set(g.aviamentoAlvoId, []).get(g.aviamentoAlvoId)!
        ).push(g);
      else soNovos.push(g);
    }
    return { porAviamento: mapa, aviamentosNovos: soNovos };
  }, [nv?.novos]);
  // Teclado (Enter desce / Tab ao lado): a "linha" é a posição GLOBAL na ordem da tela (cada aviamento: a linha-pai, suas cores
  // cadastradas, as cores novas dele; por fim os aviamentos novos) = a mesma ordem de `montarSlots`; a "coluna" é a posição em
  // COLUNAS_AVIAMENTO.
  const { inicios, inicioDosNovos, nLinhas } = useMemo(() => {
    let n = 0;
    const ini: number[] = [];
    for (const g of grupos) {
      ini.push(n);
      n +=
        nLinhasDoGrupo(g) +
        (porAviamento.get(g.aviamentoId) ?? SEM_NOVOS).reduce((t, x) => t + x.vars.length, 0);
    }
    const iniNovos: number[] = [];
    for (const g of aviamentosNovos) {
      iniNovos.push(n);
      n += g.vars.length;
    }
    return { inicios: ini, inicioDosNovos: iniNovos, nLinhas: n };
  }, [grupos, porAviamento, aviamentosNovos]);
  const { gridRef, propsDaCelula } = useGradeTeclado({
    nLinhas,
    nColunas: COLUNAS_AVIAMENTO.length,
  });
  // ações ESTÁVEIS por referência (o `memo` do GrupoAviamento não re-renderiza todos os aviamentos a cada tecla numa linha nova)
  const acoes = useMemo<NovosAcoes>(
    () =>
      nv
        ? {
            mostrarPendencias: nv.mostrarPendencias,
            errosNovos: nv.errosNovos,
            onAtualizarNovo: nv.onAtualizarNovo,
            onRemoverNovo: nv.onRemoverNovo,
            onNovaCor: nv.onNovaCor,
            onAdicionarCores: nv.onAdicionarCores,
          }
        : SEM_ACOES,
    // deps por campo (e não `nv`): o objeto `nv` é novo a cada render da Aba e desfaria o `memo` dos grupos
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      nv?.mostrarPendencias,
      nv?.errosNovos,
      nv?.onAtualizarNovo,
      nv?.onRemoverNovo,
      nv?.onNovaCor,
      nv?.onAdicionarCores,
    ],
  );
  const ex = useMemo<ExcluirAcoes>(
    () =>
      excluir
        ? {
            onExcluirCor: excluir.onExcluirCor,
            onExcluirAviamento: excluir.onExcluirAviamento,
            ocupado: excluir.ocupado,
          }
        : SEM_EXCLUIR,
    [excluir?.onExcluirCor, excluir?.onExcluirAviamento, excluir?.ocupado], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div className="space-y-2">
      <div
        ref={gridRef as RefObject<HTMLDivElement>}
        className="scroll-x-visivel max-h-[calc(100vh-16rem)] max-w-full overflow-y-auto rounded-md border"
        data-testid="aviamentos-grade-tabela"
        onPaste={aoColar}
      >
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              {/* Estado + Nome ficam FIXOS na horizontal (sticky left): ao rolar p/ o lado, sabe-se de qual aviamento é a linha. */}
              <th className={cn(CLASSE_COL_ESTADO, "bg-muted py-2")}>
                <span className="sr-only">Estado</span>
              </th>
              {COLUNAS_AVIAMENTO.map((c) => {
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
            <GrupoAviamento
              key={g.aviamentoId}
              grupo={g}
              inicio={inicios[gi]}
              propsCel={propsDaCelula}
              opcoes={opcoes}
              readOnly={readOnly}
              registrar={registrar}
              novosAlvo={porAviamento.get(g.aviamentoId) ?? SEM_NOVOS}
              nv={acoes}
              ex={ex}
              avisos={avisos}
              onLimparAviso={onLimparAviso}
            />
          ))}
          {aviamentosNovos.map((g, gi) => (
            <tbody key={g.tmp} data-grupo-novo={g.tmp}>
              <LinhasAviamentoNovo
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
        <Button type="button" variant="outline" size="sm" onClick={nv.onNovoAviamento}>
          <Plus className="mr-1 h-4 w-4" /> Novo aviamento
        </Button>
      )}
    </div>
  );
}
