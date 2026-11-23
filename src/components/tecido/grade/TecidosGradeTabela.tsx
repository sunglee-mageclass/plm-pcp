// Tabela da grade "Lista tipo Excel" de Cadastro > Tecidos: cada tecido é um bloco — 1 linha-PAI (cabeçalho, só ela edita) + 1 linha-FILHO por cor
// (as cores nascem RECOLHIDAS: clicar na linha-pai abre/fecha).
// Molde: `integracao/ProdutosTabela` (thead pelo catálogo, scroll-x DENTRO do container, memo por grupo), escrito enxuto.
//
// STAGING (nada grava antes do Salvar): cada TECIDO tem um rascunho (`useCardDraft`, id = artigo.id) e cada COR outro
// (id = variante.id), ambos no `CardDraftsProvider` da aba. Editar uma célula só faz `patch` no rascunho (selo âmbar quando
// valor ≠ base). O Salvar (na `TecidosGradeAba`) chama o `salvar` de cada rascunho sujo — tecidos primeiro, depois cores.
// Cada rascunho se registra aqui por `registrar` (a ordem é do wrapper, não da ordem de montagem do registry).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCardDraft } from "@/components/shared/card-drafts/useCardDraft";
import { SortTh, type SortDir } from "@/components/shared/sort";
import { useGradeTeclado } from "@/lib/grade-teclado";
import { colunaOrdenavel } from "@/lib/tecido-grade/ordenar";
import {
  draftParaServidor,
  varianteParaDraft,
  type VarianteDraft,
} from "@/routes/_authenticated/cadastro.tecidos.$artigoId";
import { COLUNAS_TECIDO, indiceDaColuna, type ColunaGrade } from "@/lib/tecido-grade/colunas";
import { chaveLinha, type ArtigoEntrada, type LinhaGrade, type VarianteEntrada } from "@/lib/tecido-grade/linhas";
import {
  CAMPO_ARTIGO,
  CAMPO_VARIANTE,
  celulaDesabilitadaPorRegra,
  controleDaCelula,
  mesmaLista,
  mesmoMapa,
  opcoesDaColuna,
  precoPorMetroTexto,
} from "@/lib/tecido-grade/celulas";
import {
  artigoParaDraft,
  montarPayloadArtigo,
  salvarArtigo,
  salvarVarianteGrade,
  textoErroSalvar,
  tocouCategorias,
  type ArtigoDraft,
} from "@/lib/tecido-grade/salvar";
import type { SubPorCat } from "@/lib/tecido-subcategoria";
import type { TecidoNovo } from "@/lib/tecido-grade/linha-nova";
import { cn } from "@/lib/utils";
import type { GradeOpcoes } from "./useTecidosGrade";
import { CelulaTecido, type GradeCelProps } from "./CelulaTecido";
import { CelulaFotoVariante } from "./CelulaFotoVariante";
import { CLASSE_COL_ACOES, LinhasTecidoNovo, type AtualizarNovo } from "./TecidoNovoGrupo";
import { CelulaCorBaseMulti } from "./CelulaCorBaseMulti";

/** O que cada rascunho entrega ao Salvar: lê o estado MAIS NOVO por ref, no momento de salvar. */
export type SaverApi = {
  kind: "artigo" | "variante";
  dirty: () => boolean;
  salvar: (ctx: { limite?: number }) => Promise<void>;
  /** Colar do Excel: aplica campos NO RASCUNHO (um `patch` por campo; nada grava). */
  aplicar: (campos: Record<string, unknown>) => void;
  /** Valor atual do rascunho (cor base / unidade que a colagem precisa conhecer). */
  ler: () => Record<string, unknown>;
};
/** Registra um rascunho no wrapper do Salvar; devolve o "desregistrar". Precisa ser ESTÁVEL (useCallback) na tela. */
export type RegistrarSaver = (id: string, api: SaverApi) => () => void;

type Grupo = { artigoId: string; artigo: ArtigoEntrada; linhas: LinhaGrade[] };

/** Linhas consecutivas do mesmo tecido viram um grupo (montarLinhas já entrega o tecido inteiro em sequência). */
function agruparLinhasPorArtigo(linhas: LinhaGrade[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const l of linhas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.artigoId === l.artigoId) ultimo.linhas.push(l);
    else grupos.push({ artigoId: l.artigoId, artigo: l.artigo, linhas: [l] });
  }
  return grupos;
}

/** Mantém a MESMA referência enquanto o conteúdo não muda (a `base` do `useCardDraft` tem de ser estável). */
function useEstavel<T>(valor: T): T {
  const ref = useRef(valor);
  if (ref.current !== valor && JSON.stringify(ref.current) !== JSON.stringify(valor)) ref.current = valor;
  return ref.current;
}

// ---------------------------------------------------------------- tecido (rascunho do cabeçalho)

type ArtigoCtx = {
  valor: ArtigoDraft;
  sujo: (k: keyof ArtigoDraft) => boolean;
  patch: (k: keyof ArtigoDraft, v: unknown) => void;
  patchCategorias: (ids: string[], subs: SubPorCat) => void;
  dirty: boolean;
  erro: string | null;
};

function useRascunhoArtigo(artigo: ArtigoEntrada, registrar: RegistrarSaver): ArtigoCtx {
  const base = useEstavel(artigoParaDraft(artigo, artigo.categorias ?? []));
  // rev do servidor, sempre o MAIOR visto: variante salva depois do tecido sobe o rev por trigger, e o refetch pós-Salvar traz o novo.
  const revRef = useRef<number | null>(artigo.rev);
  if (artigo.rev != null && (revRef.current == null || artigo.rev > revRef.current)) revRef.current = artigo.rev;
  const [erro, setErro] = useState<string | null>(null);

  const salvarFn = useCallback(
    async (mudancas: Partial<ArtigoDraft>, baseEnviada: ArtigoDraft) => {
      setErro(null);
      try {
        const payload = montarPayloadArtigo(mudancas, baseEnviada);
        const cats = tocouCategorias(mudancas)
          ? { catIds: mudancas.catIds ?? baseEnviada.catIds, subPorCat: mudancas.subPorCat ?? baseEnviada.subPorCat }
          : null;
        const novoRev = await salvarArtigo(artigo.id, revRef.current, payload, cats);
        if (novoRev != null) revRef.current = novoRev;
      } catch (e) {
        setErro(textoErroSalvar(e));
        throw e;
      }
    },
    [artigo.id],
  );
  const draft = useCardDraft<ArtigoDraft>({ id: artigo.id, base, salvarFn, onDescartar: () => setErro(null) });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(
    () =>
      registrar(artigo.id, {
        kind: "artigo",
        dirty: () => draftRef.current.dirty,
        salvar: (ctx) => draftRef.current.salvar(ctx),
        aplicar: (campos) => { for (const [k, v] of Object.entries(campos)) draftRef.current.patch(k as keyof ArtigoDraft, v as never); },
        ler: () => ({ ...draftRef.current.valor }),
      }),
    [registrar, artigo.id],
  );
  useEffect(() => { if (!draft.dirty) setErro(null); }, [draft.dirty]);

  const { valor, dirty, patch } = draft;
  const sujo = useCallback(
    (k: keyof ArtigoDraft) => dirty && !(Object.is(valor[k], base[k])),
    [dirty, valor, base],
  );
  const patchCampo = useCallback((k: keyof ArtigoDraft, v: unknown) => patch(k, v as never), [patch]);
  const patchCategorias = useCallback(
    (ids: string[], subs: SubPorCat) => {
      // Mesmo conteúdo da base = a MESMA referência da base (senão desfazer a marcação deixaria o tecido "sujo").
      patch("catIds", (mesmaLista(ids, base.catIds) ? base.catIds : ids) as never);
      patch("subPorCat", (mesmoMapa(subs, base.subPorCat) ? base.subPorCat : subs) as never);
    },
    [patch, base],
  );
  return { valor, sujo, patch: patchCampo, patchCategorias, dirty, erro };
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
  const [erro, setErro] = useState<string | null>(null);
  const salvarFn = useCallback(
    async (mudancas: Partial<VarianteDraft>, baseEnviada: VarianteDraft, ctx?: { limite?: number }) => {
      setErro(null);
      try {
        await salvarVarianteGrade({
          id: variante.id,
          mudancas: draftParaServidor(mudancas),
          base: draftParaServidor(baseEnviada),
          tocouPreco: "preco" in mudancas,
          preco: mudancas.preco ?? null,
          limite: ctx?.limite,
        });
      } catch (e) {
        setErro(textoErroSalvar(e));
        throw e;
      }
    },
    [variante.id],
  );
  const draft = useCardDraft<VarianteDraft>({ id: variante.id, base, salvarFn, onDescartar: () => setErro(null) });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(
    () =>
      registrar(variante.id, {
        kind: "variante",
        dirty: () => draftRef.current.dirty,
        salvar: (ctx) => draftRef.current.salvar(ctx),
        aplicar: (campos) => { for (const [k, v] of Object.entries(campos)) draftRef.current.patch(k as keyof VarianteDraft, v as never); },
        ler: () => ({ ...draftRef.current.valor }),
      }),
    [registrar, variante.id],
  );
  useEffect(() => { if (!draft.dirty) setErro(null); }, [draft.dirty]);

  const { valor, dirty, patch } = draft;
  const sujo = useCallback((k: keyof VarianteDraft) => dirty && !Object.is(valor[k], base[k]), [dirty, valor, base]);
  const patchCampo = useCallback((k: keyof VarianteDraft, v: unknown) => patch(k, v as never), [patch]);
  return { valor, sujo, patch: patchCampo, dirty, erro };
}

// ---------------------------------------------------------------- linhas
// Cada TECIDO é um bloco (<tbody>): 1 linha-PAI (cabeçalho: nome, fornecedor, preço… — SÓ ela mostra e edita) + N linhas-FILHO (uma por
// cor: só os campos da cor). Clicar no pai recolhe/expande as cores (nascem recolhidas). Tecido sem cor = só a linha-pai.

type BaseLinhaProps = {
  artigo: ArtigoEntrada;
  opcoes: GradeOpcoes;
  readOnly: boolean;
  /** Avisos da última colagem (chave `<linha>|<coluna>`) e como apagar um (ao editar a célula). */
  avisos: Record<string, string>;
  onLimparAviso: (chaveCelula: string) => void;
  /** Excluir cor / tecido já cadastrados (grava na hora, com confirmação). */
  ex: ExcluirAcoes;
  /** Posição GLOBAL desta linha na grade (contínua entre os tecidos, na ordem da tela): é a "linha" do endereço de teclado. */
  linhaIdx: number;
  propsCel: PropsCelula;
};

/** O que as cores RECOLHIDAS (escondidas) de um tecido guardam: edição não salva / erro de salvar não podem ficar invisíveis. */
type EstadoFilho = "sujo" | "erro";
type ReportarFilho = (varianteId: string, estado: EstadoFilho | null) => void;

type PaiProps = BaseLinhaProps & {
  ctxA: ArtigoCtx;
  /** Quantas cores cadastradas o tecido tem (0 = "sem cores": a linha-pai é a única do tecido). */
  nCores: number;
  /** Cores que o tecido JÁ tem (cadastradas + novas no rascunho): o popover multi-cor as mostra marcadas e travadas. */
  presentes: readonly string[];
  /** Cria cores novas no tecido (multi-cor da linha-pai). */
  onAdicionarCores: NovosAcoes["onAdicionarCores"];
  /** Botão "+ cor" (cor nova neste tecido); some quando já há cor nova pendente. */
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
    return <span role="status" title="Alterações não salvas" data-selo-nao-salvo className="inline-block h-2 w-2 rounded-full bg-amber-500" />;
  }
  return null;
}

/** Célula do CABEÇALHO (só a linha-pai chama). */
function celulaArtigo(col: ColunaGrade, c: PaiProps) {
  const { ctxA, opcoes, readOnly, artigo } = c;
  // rótulo estável (nome do servidor): digitar o nome não muda o aria-label do próprio campo
  const ariaLabel = `${col.rotulo} de ${artigo.nome}`;
  const chaveAv = chaveCelula(chaveLinha(artigo.id, null), col.key);
  if (col.key === "preco_por_metro") {
    return <CelulaTecido coluna={col} ariaLabel={ariaLabel} texto={precoPorMetroTexto(ctxA.valor)} />;
  }
  if (controleDaCelula(col) === "categorias") {
    return (
      <CelulaTecido
        coluna={col}
        ariaLabel={ariaLabel}
        sujo={ctxA.sujo("catIds") || ctxA.sujo("subPorCat")}
        desabilitado={readOnly}
        categorias={{
          options: opcoes.categorias,
          subcategorias: opcoes.subcategorias,
          catIds: ctxA.valor.catIds,
          subPorCat: ctxA.valor.subPorCat,
          onChange: ctxA.patchCategorias,
        }}
      />
    );
  }
  const campo = CAMPO_ARTIGO[col.key];
  if (!campo) return null;
  return (
    <CelulaTecido
      coluna={col}
      ariaLabel={ariaLabel}
      valor={ctxA.valor[campo]}
      onChange={(v) => {
        ctxA.patch(campo, v);
        c.onLimparAviso(chaveAv);
      }}
      sujo={ctxA.sujo(campo)}
      aviso={c.avisos[chaveAv]}
      desabilitado={readOnly || !col.editavel || celulaDesabilitadaPorRegra(col.key, ctxA.valor)}
      opcoes={opcoesDaColuna(col.key, opcoes)}
      gradeProps={c.propsCel(c.linhaIdx, indiceDaColuna(col.key))}
    />
  );
}

/** Célula "Cor base" da linha-PAI: quantas cores o tecido tem + "+ cor" + a seleção MÚLTIPLA (cada cor marcada vira uma cor nova). */
function celulaCoresDoPai(c: PaiProps): ReactNode {
  const resumo = (
    <>
      <span className="whitespace-nowrap px-2 text-xs text-muted-foreground" data-resumo-cores title={c.nCores === 0 ? "Tecido sem cores" : undefined}>
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
      onAdicionar={(ids) => c.onAdicionarCores(c.artigo.id, c.artigo.nome, ids, c.ctxA.valor.preco ?? null)}
      ariaLabel={`Adicionar várias cores em ${c.artigo.nome}`}
    >
      {resumo}
    </CelulaCorBaseMulti>
  );
}

/** Célula da COR (só a linha-filho chama). */
function celulaVariante(col: ColunaGrade, c: FilhoProps) {
  const { ctxV, variante, opcoes, readOnly, artigo } = c;
  const ariaLabel = `${col.rotulo} da cor de ${artigo.nome}`;
  const chaveAv = chaveCelula(chaveLinha(artigo.id, variante.id), col.key);
  if (col.key === "foto") return <CelulaFotoVariante coluna={col} ariaLabel={ariaLabel} variante={variante} readOnly={readOnly} />;
  const campo = CAMPO_VARIANTE[col.key];
  if (!campo) return null;
  const aoMudar = (v: unknown) => {
    c.onLimparAviso(chaveAv);
    if (col.key === "cor_base") {
      // Mesma regra do Sheet: o apelido que não é da nova cor base sai junto (a RPC recebe os dois no MESMO Salvar).
      const b = String(v ?? "");
      ctxV.patch("cor_id", b);
      const mantem = opcoes.coresApelido.some((a) => a.id === ctxV.valor.cor_apelido_id && a.cor_base_id === b);
      ctxV.patch("cor_apelido_id", mantem ? ctxV.valor.cor_apelido_id : "");
    } else if (col.key === "cor_apelido") {
      // Escolher o apelido preenche a cor base dele.
      const a = String(v ?? "");
      const baseDoApelido = opcoes.coresApelido.find((x) => x.id === a)?.cor_base_id ?? ctxV.valor.cor_id;
      ctxV.patch("cor_apelido_id", a);
      ctxV.patch("cor_id", baseDoApelido);
    } else {
      ctxV.patch(campo, v);
    }
  };
  return (
    <CelulaTecido
      coluna={col}
      ariaLabel={ariaLabel}
      valor={ctxV.valor[campo]}
      onChange={aoMudar}
      sujo={ctxV.sujo(campo)}
      aviso={c.avisos[chaveAv]}
      desabilitado={readOnly || !col.editavel}
      opcoes={opcoesDaColuna(col.key, opcoes, ctxV.valor.cor_id)}
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

/** Última coluna: UMA lixeira por linha. Na linha-PAI exclui o TECIDO + todas as cores; na linha da cor, só aquela cor.
 *  Já cadastrado → confirmação + grava na hora. */
function CelulaAcoes({ artigo, variante, readOnly, ex, opcoes }: {
  artigo: ArtigoEntrada; variante: VarianteEntrada | null; readOnly: boolean; ex: ExcluirAcoes; opcoes: GradeOpcoes;
}) {
  if (readOnly || ex === SEM_EXCLUIR) return null;
  // sem `variante` = linha-pai = excluir o tecido inteiro; com `variante` = excluir só aquela cor.
  const corRotulo = variante ? rotuloDaCor(variante, opcoes) : "";
  const onClick = () =>
    variante
      ? ex.onExcluirCor({ artigoId: artigo.id, artigoNome: artigo.nome, varianteId: variante.id, corRotulo })
      : ex.onExcluirTecido({ artigoId: artigo.id, artigoNome: artigo.nome });
  return (
    <span className="flex items-center justify-end">
      <button
        type="button"
        disabled={ex.ocupado}
        onClick={onClick}
        aria-label={variante ? `Excluir a cor ${corRotulo} de ${artigo.nome}` : `Excluir o tecido ${artigo.nome} e todas as cores`}
        title={variante ? "Excluir esta cor (pede confirmação)" : "Excluir o tecido inteiro e todas as cores (pede confirmação)"}
        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        data-acao={variante ? "excluir-cor" : "excluir-tecido"}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/** Estado + Nome ficam FIXOS na horizontal (sticky left): a largura da coluna de estado (chevron + selo) é a mesma do deslocamento do Nome. */
const CLASSE_COL_ESTADO = "sticky left-0 z-10 w-10 min-w-10 px-1 py-1.5 text-center";
const CLASSE_COL_NOME = "sticky left-10 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]";

/** Cliques que NÃO recolhem o tecido: quem edita/aciona alguma coisa na linha-pai (e o que o popover/select abre por portal). */
const INTERATIVO = "input,button,select,textarea,a,label,[role=combobox],[role=checkbox],[role=button],[role=switch],[role=option],[contenteditable=true]";

/** Linha-PAI do tecido: cabeçalho (editável só aqui) + chevron que recolhe/expande as cores + lixeira do tecido. */
function LinhaPai(props: PaiProps) {
  const { artigo, ctxA, nCores, recolhido, onAlternar, filhosOcultos } = props;
  const temCores = nCores > 0;
  const aoClicarLinha = (e: MouseEvent<HTMLTableRowElement>) => {
    if (!temCores) return;
    const alvo = e.target as HTMLElement | null;
    // evento de portal (popover/select) sobe pela árvore do React mas NÃO está dentro da linha no DOM
    if (!alvo || !e.currentTarget.contains(alvo) || alvo.closest(INTERATIVO)) return;
    onAlternar();
  };
  return (
    <tr
      className={cn("border-t-[3px] border-border bg-muted align-middle", temCores && "cursor-pointer")}
      data-artigo-id={artigo.id}
      data-pai
      data-recolhido={temCores && recolhido ? "" : undefined}
      data-slot={chaveLinha(artigo.id, null)}
      onClick={aoClicarLinha}
    >
      <td className={cn(CLASSE_COL_ESTADO, "bg-muted")}>
        <span className="flex items-center justify-center gap-1">
          {temCores ? (
            <button
              type="button"
              onClick={onAlternar}
              aria-expanded={!recolhido}
              aria-label={`${recolhido ? "Expandir" : "Recolher"} as cores de ${artigo.nome}`}
              title={recolhido ? "Mostrar as cores deste tecido" : "Esconder as cores deste tecido"}
              data-acao="alternar-cores"
              className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            >
              {recolhido ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : null}
          <EstadoLinha sujo={ctxA.dirty} erro={ctxA.erro} />
          {recolhido && filhosOcultos.erro ? (
            <span role="alert" title="Uma cor escondida não salvou" data-erro-filho-oculto><AlertTriangle className="h-4 w-4 text-destructive" aria-label="Uma cor escondida não salvou" /></span>
          ) : recolhido && filhosOcultos.sujo ? (
            <span role="status" title="Há cores escondidas com alterações não salvas" data-selo-filho-oculto className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          ) : null}
        </span>
      </td>
      {COLUNAS_TECIDO.map((col, i) => (
        <td
          key={col.key}
          className={cn("bg-muted px-1.5 py-1.5", i === 0 && CLASSE_COL_NOME)}
          data-col={col.key}
        >
          {col.escopo === "artigo" ? celulaArtigo(col, props) : col.key === "cor_base" ? celulaCoresDoPai(props) : null}
        </td>
      ))}
      <td className={cn(CLASSE_COL_ACOES, "bg-muted")} data-col-acoes>
        <CelulaAcoes artigo={artigo} variante={null} readOnly={props.readOnly} ex={props.ex} opcoes={props.opcoes} />
      </td>
    </tr>
  );
}

/** Linha-FILHO: uma cor do tecido, recuada sob o pai. As colunas do cabeçalho ficam VAZIAS (o cabeçalho é do pai). */
function LinhaFilho(props: FilhoProps) {
  const { artigo, variante, ctxV, oculta } = props;
  return (
    <tr
      className={cn("border-t border-dashed align-middle", oculta && "hidden")}
      hidden={oculta}
      data-artigo-id={artigo.id}
      data-variante-id={variante.id}
      data-slot={chaveLinha(artigo.id, variante.id)}
    >
      <td className={cn(CLASSE_COL_ESTADO, "border-l-4 border-l-primary/30 bg-background")}>
        <EstadoLinha sujo={ctxV.dirty} erro={ctxV.erro} />
      </td>
      {COLUNAS_TECIDO.map((col, i) => (
        <td
          key={col.key}
          className={cn("px-1.5 py-1.5", i === 0 && cn(CLASSE_COL_NOME, "bg-background"))}
          data-col={col.key}
        >
          {col.escopo === "variante" ? (
            celulaVariante(col, props)
          ) : i === 0 ? (
            <span className="flex items-center gap-1 pl-5 text-xs text-muted-foreground" data-recuo title={`Cor de ${artigo.nome}`}>↳ cor</span>
          ) : null}
        </td>
      ))}
      <td className={CLASSE_COL_ACOES} data-col-acoes>
        <CelulaAcoes artigo={artigo} variante={variante} readOnly={props.readOnly} ex={props.ex} opcoes={props.opcoes} />
      </td>
    </tr>
  );
}

function LinhaComCor({ variante, registrar, onEstado, ...resto }: Omit<FilhoProps, "ctxV"> & { registrar: RegistrarSaver; onEstado: ReportarFilho }) {
  const ctxV = useRascunhoVariante(variante, registrar);
  // O tecido recolhido esconde esta linha mas ela continua montada (o Salvar a enxerga); o pai mostra se há algo pendente nela.
  const estado: EstadoFilho | null = ctxV.erro ? "erro" : ctxV.dirty ? "sujo" : null;
  useEffect(() => { onEstado(variante.id, estado); }, [onEstado, variante.id, estado]);
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
  /** "+ cor" num tecido que já existe. */
  onNovaCor: (artigoId: string, nome: string) => void;
  /** Multi-cor da linha-pai de um tecido que já existe: cria uma cor nova (com o preço herdado) por cor marcada. */
  onAdicionarCores: (artigoId: string, nome: string, corIds: string[], preco: number | null) => void;
};

/** Excluir o que JÁ está cadastrado: confirma e grava NA HORA (fora do rascunho/Salvar). Recebe a ordem da tela; quem confirma é a Aba. */
export type ExcluirProps = {
  onExcluirCor: (a: { artigoId: string; artigoNome: string; varianteId: string; corRotulo: string }) => void;
  onExcluirTecido: (a: { artigoId: string; artigoNome: string }) => void;
  /** Uma exclusão (ou o Salvar) em andamento: os botões ficam travados. */
  ocupado: boolean;
};
type ExcluirAcoes = ExcluirProps;
export type NovosProps = NovosAcoes & {
  novos: TecidoNovo[];
  onNovoTecido: () => void;
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

const SEM_NOVOS: TecidoNovo[] = [];
const SEM_ERROS: Record<string, string> = {};
const SEM_ACOES: NovosAcoes = {
  mostrarPendencias: false,
  errosNovos: SEM_ERROS,
  onAtualizarNovo: () => {},
  onRemoverNovo: () => {},
  onNovaCor: () => {},
  onAdicionarCores: () => {},
};
const SEM_EXCLUIR: ExcluirAcoes = { onExcluirCor: () => {}, onExcluirTecido: () => {}, ocupado: false };

/** Linhas (posições do teclado) que um tecido cadastrado ocupa: a linha-pai + uma por cor (tecido sem cor = só a linha-pai). */
const nLinhasDoGrupo = (g: Grupo): number => (g.linhas[0]?.variante ? 1 + g.linhas.length : 1);

const GrupoTecido = memo(function GrupoTecido({ grupo, opcoes, readOnly, registrar, novosAlvo, nv, ex, avisos, onLimparAviso, inicio, propsCel }: {
  grupo: Grupo; opcoes: GradeOpcoes; readOnly: boolean; registrar: RegistrarSaver;
  /** Posição global da linha-pai deste tecido (as cores vêm logo depois; as cores novas dele, depois das cadastradas). */
  inicio: number;
  propsCel: PropsCelula;
  avisos: Record<string, string>; onLimparAviso: (chaveCelula: string) => void;
  /** Cores novas deste tecido (rascunho); entram no fim do mesmo <tbody> e nunca são escondidas pelo recolher. */
  novosAlvo: TecidoNovo[];
  nv: NovosAcoes;
  ex: ExcluirAcoes;
}) {
  const { artigo, linhas } = grupo;
  const ctxA = useRascunhoArtigo(artigo, registrar);
  const cores = useMemo(() => linhas.filter((l): l is LinhaGrade & { variante: VarianteEntrada } => l.variante != null), [linhas]);
  // Recolher/expandir as cores deste tecido: estado só local (não persiste); começa RECOLHIDO (a lista abre só com os cabeçalhos —
  // com muitos tecidos, abre-se só o que vai mexer). Tecido sem cor não recolhe.
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
  // Uma cor escondida que NÃO salvou abre o tecido: o erro precisa estar à vista (a pessoa pode recolher de novo depois).
  useEffect(() => {
    if (filhosOcultos.erro) setRecolhido(false);
  }, [filhosOcultos.erro]);
  // cores que o tecido já tem (cadastradas + novas no rascunho): o multi-cor da linha-pai as mostra marcadas e travadas
  const presentes = useMemo(
    () => [
      ...cores.map((l) => l.variante.cor_id).filter((id): id is string => !!id),
      ...novosAlvo.flatMap((g) => g.vars.flatMap((v) => (v.cor_id ? [v.cor_id] : []))),
    ],
    [cores, novosAlvo],
  );
  // "+ cor" (na linha-pai) só some quando já há cor nova pendente neste tecido (aí o botão "adicionar variante" do grupo faz o papel)
  const botaoCor =
    !readOnly && novosAlvo.length === 0 ? (
      <button
        type="button"
        onClick={() => nv.onNovaCor(artigo.id, artigo.nome)}
        aria-label={`Adicionar cor em ${artigo.nome}`}
        title="Adicionar cor neste tecido"
        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    ) : undefined;
  return (
    <tbody data-grupo-artigo={artigo.id}>
      <LinhaPai
        artigo={artigo}
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
          artigo={artigo}
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
        <LinhasTecidoNovo
          key={g.tmp}
          grupo={g}
          inicio={inicio + nLinhasDoGrupo(grupo) + novosAlvo.slice(0, gi).reduce((n, x) => n + x.vars.length, 0)}
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
export type OrdenacaoProps = { sortKey: string | null; sortDir: SortDir; toggle: (key: string) => void };

export function TecidosGradeTabela({ linhas, opcoes, readOnly, registrar, novos: nv, colar, excluir, ordenacao }: {
  linhas: LinhaGrade[];
  opcoes: GradeOpcoes;
  readOnly: boolean;
  registrar: RegistrarSaver;
  /** Linhas novas (rascunho) + ações. Ausente = a grade só edita os existentes. */
  novos?: NovosProps;
  /** Colar do Excel. Ausente = colar normal, célula a célula. */
  colar?: ColarProps;
  /** Excluir cor/tecido cadastrados. Ausente = a grade não oferece os botões de excluir. */
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
    if (colar.onColar({ chaveLinha: tr.dataset.slot ?? "", colKey: td.dataset.col ?? "", texto })) e.preventDefault();
  };
  const grupos = useMemo(() => agruparLinhasPorArtigo(linhas), [linhas]);
  // cores novas de tecido existente entram no <tbody> do tecido; tecido novo ganha <tbody> próprio, no fim
  const { porArtigo, tecidosNovos } = useMemo(() => {
    const mapa = new Map<string, TecidoNovo[]>();
    const soNovos: TecidoNovo[] = [];
    for (const g of nv?.novos ?? SEM_NOVOS) {
      if (g.artigoAlvoId) (mapa.get(g.artigoAlvoId) ?? mapa.set(g.artigoAlvoId, []).get(g.artigoAlvoId)!).push(g);
      else soNovos.push(g);
    }
    return { porArtigo: mapa, tecidosNovos: soNovos };
  }, [nv?.novos]);
  // Teclado (Enter desce / Tab ao lado): a "linha" é a posição GLOBAL na ordem da tela (cada tecido: a linha-pai, suas cores
  // cadastradas, as cores novas dele; por fim os tecidos novos) = a mesma ordem de `montarSlots`; a "coluna" é a posição em COLUNAS_TECIDO.
  const { inicios, inicioDosNovos, nLinhas } = useMemo(() => {
    let n = 0;
    const ini: number[] = [];
    for (const g of grupos) {
      ini.push(n);
      n += nLinhasDoGrupo(g) + (porArtigo.get(g.artigoId) ?? SEM_NOVOS).reduce((t, x) => t + x.vars.length, 0);
    }
    const iniNovos: number[] = [];
    for (const g of tecidosNovos) {
      iniNovos.push(n);
      n += g.vars.length;
    }
    return { inicios: ini, inicioDosNovos: iniNovos, nLinhas: n };
  }, [grupos, porArtigo, tecidosNovos]);
  const { gridRef, propsDaCelula } = useGradeTeclado({ nLinhas, nColunas: COLUNAS_TECIDO.length });
  // ações ESTÁVEIS por referência (o `memo` do GrupoTecido não re-renderiza todos os tecidos a cada tecla numa linha nova)
  const acoes = useMemo<NovosAcoes>(
    () =>
      nv
        ? { mostrarPendencias: nv.mostrarPendencias, errosNovos: nv.errosNovos, onAtualizarNovo: nv.onAtualizarNovo, onRemoverNovo: nv.onRemoverNovo, onNovaCor: nv.onNovaCor, onAdicionarCores: nv.onAdicionarCores }
        : SEM_ACOES,
    [nv?.mostrarPendencias, nv?.errosNovos, nv?.onAtualizarNovo, nv?.onRemoverNovo, nv?.onNovaCor, nv?.onAdicionarCores], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const ex = useMemo<ExcluirAcoes>(
    () => (excluir ? { onExcluirCor: excluir.onExcluirCor, onExcluirTecido: excluir.onExcluirTecido, ocupado: excluir.ocupado } : SEM_EXCLUIR),
    [excluir?.onExcluirCor, excluir?.onExcluirTecido, excluir?.ocupado], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div className="space-y-2">
      <div
        ref={gridRef as RefObject<HTMLDivElement>}
        className="scroll-x-visivel max-h-[calc(100vh-16rem)] max-w-full overflow-y-auto rounded-md border"
        data-testid="tecidos-grade-tabela"
        onPaste={aoColar}
      >
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              {/* Estado + Nome ficam FIXOS na horizontal (sticky left): ao rolar p/ o lado, sabe-se de qual variante é a linha. */}
              <th className={cn(CLASSE_COL_ESTADO, "bg-muted py-2")}><span className="sr-only">Estado</span></th>
              {COLUNAS_TECIDO.map((c, i) => {
                const classe = cn(
                  "whitespace-nowrap px-2 py-2 font-medium",
                  i === 0 && cn(CLASSE_COL_NOME, "bg-muted"),
                );
                return ordenacao && colunaOrdenavel(c) ? (
                  <SortTh key={c.key} label={c.rotulo} sortKey={c.key} sortState={ordenacao} className={classe} />
                ) : (
                  <th key={c.key} className={classe}>{c.rotulo}</th>
                );
              })}
              <th className="bg-muted px-2 py-2"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          {grupos.map((g, gi) => (
            <GrupoTecido
              key={g.artigoId}
              grupo={g}
              inicio={inicios[gi]}
              propsCel={propsDaCelula}
              opcoes={opcoes}
              readOnly={readOnly}
              registrar={registrar}
              novosAlvo={porArtigo.get(g.artigoId) ?? SEM_NOVOS}
              nv={acoes}
              ex={ex}
              avisos={avisos}
              onLimparAviso={onLimparAviso}
            />
          ))}
          {tecidosNovos.map((g, gi) => (
            <tbody key={g.tmp} data-grupo-novo={g.tmp}>
              <LinhasTecidoNovo
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
        <Button type="button" variant="outline" size="sm" onClick={nv.onNovoTecido}>
          <Plus className="mr-1 h-4 w-4" /> Novo tecido
        </Button>
      )}
    </div>
  );
}
