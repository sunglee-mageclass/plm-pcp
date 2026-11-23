// Tabela da grade "Lista tipo Excel" de Cadastro > Tecidos (1 linha por cor; o cabeçalho do tecido se repete em cada cor).
// Molde: `integracao/ProdutosTabela` (thead pelo catálogo, scroll-x DENTRO do container, memo por grupo), escrito enxuto.
//
// STAGING (nada grava antes do Salvar): cada TECIDO tem um rascunho (`useCardDraft`, id = artigo.id) e cada COR outro
// (id = variante.id), ambos no `CardDraftsProvider` da aba. Editar uma célula só faz `patch` no rascunho (selo âmbar quando
// valor ≠ base). O Salvar (na `TecidosGradeAba`) chama o `salvar` de cada rascunho sujo — tecidos primeiro, depois cores.
// Cada rascunho se registra aqui por `registrar` (a ordem é do wrapper, não da ordem de montagem do registry).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCardDraft } from "@/components/shared/card-drafts/useCardDraft";
import {
  draftParaServidor,
  varianteParaDraft,
  type VarianteDraft,
} from "@/routes/_authenticated/cadastro.tecidos.$artigoId";
import { COLUNAS_TECIDO, type ColunaGrade } from "@/lib/tecido-grade/colunas";
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
import { CelulaTecido } from "./CelulaTecido";
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

type LinhaProps = {
  artigo: ArtigoEntrada;
  ctxA: ArtigoCtx;
  /** 1ª linha do tecido: leva o estado (selo/aviso) do cabeçalho. */
  primeira: boolean;
  opcoes: GradeOpcoes;
  readOnly: boolean;
  /** Cor da linha (null = tecido sem cores). */
  variante: VarianteEntrada | null;
  ctxV: VarianteCtx | null;
  /** Última linha do tecido: botão "+ cor" (cor nova neste tecido). */
  acaoCor?: ReactNode;
  /** Avisos da última colagem (chave `<linha>|<coluna>`) e como apagar um (ao editar a célula). */
  avisos: Record<string, string>;
  onLimparAviso: (chaveCelula: string) => void;
  /** Cores que o tecido JÁ tem (cadastradas + novas no rascunho): o popover multi-cor as mostra marcadas e travadas. */
  presentes: readonly string[];
  /** Cria cores novas no tecido (multi-cor da linha-pai). */
  onAdicionarCores: NovosAcoes["onAdicionarCores"];
  /** Excluir cor / tecido já cadastrados (grava na hora, com confirmação). */
  ex: ExcluirAcoes;
};

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

function celulaArtigo(col: ColunaGrade, c: LinhaProps) {
  const { ctxA, opcoes, readOnly, artigo } = c;
  // rótulo estável (nome do servidor): digitar o nome não muda o aria-label do próprio campo
  const ariaLabel = `${col.rotulo} de ${artigo.nome}`;
  const chaveAv = chaveCelula(chaveLinha(artigo.id, c.variante?.id ?? null), col.key);
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
    />
  );
}

/** Linha-PAI (1ª do tecido) de cor base: ao lado do Select de 1 cor, a seleção MÚLTIPLA (cada cor marcada vira uma cor nova). */
function comMultiCor(c: LinhaProps, celula: ReactNode): ReactNode {
  if (c.readOnly || !c.primeira) return celula;
  return (
    <CelulaCorBaseMulti
      cores={c.opcoes.cores}
      presentes={c.presentes}
      onAdicionar={(ids) => c.onAdicionarCores(c.artigo.id, c.artigo.nome, ids, c.ctxA.valor.preco ?? null)}
      ariaLabel={`Adicionar várias cores em ${c.artigo.nome}`}
    >
      {celula}
    </CelulaCorBaseMulti>
  );
}

function celulaVariante(col: ColunaGrade, c: LinhaProps) {
  const { ctxV, variante, opcoes, readOnly, artigo } = c;
  if (!ctxV || !variante) {
    const vazio = <span className="px-2 text-muted-foreground" title="Tecido sem cores">—</span>;
    return col.key === "cor_base" ? comMultiCor(c, vazio) : vazio;
  }
  const ariaLabel = `${col.rotulo} da cor de ${artigo.nome}`;
  const chaveAv = chaveCelula(chaveLinha(artigo.id, variante.id), col.key);
  if (col.key === "foto") return <CelulaTecido coluna={col} ariaLabel={ariaLabel} temFoto={!!variante.foto_url} />;
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
  const celula = (
    <CelulaTecido
      coluna={col}
      ariaLabel={ariaLabel}
      valor={ctxV.valor[campo]}
      onChange={aoMudar}
      sujo={ctxV.sujo(campo)}
      aviso={c.avisos[chaveAv]}
      desabilitado={readOnly || !col.editavel}
      opcoes={opcoesDaColuna(col.key, opcoes, ctxV.valor.cor_id)}
    />
  );
  return col.key === "cor_base" ? comMultiCor(c, celula) : celula;
}

/** "Azul (Marinho)" / "Azul" / "sem cor": como a cor é chamada nas confirmações de excluir. */
function rotuloDaCor(v: VarianteEntrada, opcoes: GradeOpcoes): string {
  const base = opcoes.cores.find((x) => x.id === v.cor_id)?.nome;
  const apelido = opcoes.coresApelido.find((x) => x.id === v.cor_apelido_id)?.nome;
  if (!base && !apelido) return "sem cor";
  return apelido ? `${base ?? "—"} (${apelido})` : (base ?? "—");
}

/** Última coluna: excluir a COR da linha e (na linha-pai) o TECIDO inteiro. Já cadastrado → confirmação + grava na hora. */
function CelulaAcoes({ c }: { c: LinhaProps }) {
  const { artigo, variante, primeira, readOnly, ex } = c;
  if (readOnly || ex === SEM_EXCLUIR) return null;
  return (
    <span className="flex items-center justify-end gap-1">
      {variante && (
        <button
          type="button"
          disabled={ex.ocupado}
          onClick={() => ex.onExcluirCor({ artigoId: artigo.id, artigoNome: artigo.nome, varianteId: variante.id, corRotulo: rotuloDaCor(variante, c.opcoes) })}
          aria-label={`Excluir a cor ${rotuloDaCor(variante, c.opcoes)} de ${artigo.nome}`}
          title="Excluir esta cor (pede confirmação e grava na hora)"
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          data-acao="excluir-cor"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      {primeira && (
        <button
          type="button"
          disabled={ex.ocupado}
          onClick={() => ex.onExcluirTecido({ artigoId: artigo.id, artigoNome: artigo.nome })}
          aria-label={`Excluir o tecido ${artigo.nome}`}
          title="Excluir o tecido inteiro e todas as cores (pede confirmação e grava na hora)"
          className="whitespace-nowrap rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          data-acao="excluir-tecido"
        >
          Excluir tecido
        </button>
      )}
    </span>
  );
}

function LinhaTr(props: LinhaProps) {
  const { primeira, ctxA, ctxV, artigo, variante, acaoCor } = props;
  return (
    <tr
      className={cn("align-middle", primeira ? "border-t-2 border-border" : "border-t border-dashed")}
      data-artigo-id={artigo.id}
      data-variante-id={variante?.id}
      data-slot={chaveLinha(artigo.id, variante?.id ?? null)}
    >
      <td className="sticky left-0 z-10 w-8 bg-background px-1 py-1.5 text-center">
        <span className="flex items-center justify-center gap-1">
          <EstadoLinha sujo={(primeira && ctxA.dirty) || !!ctxV?.dirty} erro={ctxV?.erro ?? (primeira ? ctxA.erro : null)} />
          {acaoCor}
        </span>
      </td>
      {COLUNAS_TECIDO.map((col, i) => (
        <td
          key={col.key}
          className={cn(
            "px-1.5 py-1.5",
            // 1ª coluna (Nome) FIXA na horizontal, fundo sólido p/ não deixar o conteúdo rolar por baixo.
            i === 0 && "sticky left-8 z-10 bg-background shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]",
          )}
          data-col={col.key}
        >
          {col.escopo === "artigo" ? celulaArtigo(col, props) : celulaVariante(col, props)}
        </td>
      ))}
      <td className={CLASSE_COL_ACOES} data-col-acoes>
        <CelulaAcoes c={props} />
      </td>
    </tr>
  );
}

function LinhaComCor({ variante, ...resto }: Omit<LinhaProps, "ctxV"> & { variante: VarianteEntrada; registrar: RegistrarSaver }) {
  const { registrar, ...props } = resto;
  const ctxV = useRascunhoVariante(variante, registrar);
  return <LinhaTr {...props} variante={variante} ctxV={ctxV} />;
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

const GrupoTecido = memo(function GrupoTecido({ grupo, opcoes, readOnly, registrar, novosAlvo, nv, ex, avisos, onLimparAviso }: {
  grupo: Grupo; opcoes: GradeOpcoes; readOnly: boolean; registrar: RegistrarSaver;
  avisos: Record<string, string>; onLimparAviso: (chaveCelula: string) => void;
  /** Cores novas deste tecido (rascunho); entram no fim do mesmo <tbody>. */
  novosAlvo: TecidoNovo[];
  nv: NovosAcoes;
  ex: ExcluirAcoes;
}) {
  const { artigo, linhas } = grupo;
  const ctxA = useRascunhoArtigo(artigo, registrar);
  // cores que o tecido já tem (cadastradas + novas no rascunho): o multi-cor da linha-pai as mostra marcadas e travadas
  const presentes = useMemo(
    () => [
      ...linhas.flatMap((l) => (l.variante?.cor_id ? [l.variante.cor_id] : [])),
      ...novosAlvo.flatMap((g) => g.vars.flatMap((v) => (v.cor_id ? [v.cor_id] : []))),
    ],
    [linhas, novosAlvo],
  );
  // "+ cor" só some quando já há cor nova pendente neste tecido (aí o botão "adicionar variante" do grupo faz o papel)
  const botaoCor =
    !readOnly && novosAlvo.length === 0 ? (
      <button
        type="button"
        onClick={() => nv.onNovaCor(artigo.id, artigo.nome)}
        aria-label={`Adicionar cor em ${artigo.nome}`}
        title="Adicionar cor neste tecido"
        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    ) : undefined;
  return (
    <tbody data-grupo-artigo={artigo.id}>
      {linhas.map((l, i) => {
        const ultima = i === linhas.length - 1;
        return l.variante ? (
          <LinhaComCor
            key={l.chave}
            artigo={artigo}
            ctxA={ctxA}
            primeira={i === 0}
            opcoes={opcoes}
            readOnly={readOnly}
            variante={l.variante}
            registrar={registrar}
            acaoCor={ultima ? botaoCor : undefined}
            avisos={avisos}
            onLimparAviso={onLimparAviso}
            presentes={presentes}
            onAdicionarCores={nv.onAdicionarCores}
            ex={ex}
          />
        ) : (
          <LinhaTr
            key={l.chave}
            artigo={artigo}
            ctxA={ctxA}
            primeira={i === 0}
            opcoes={opcoes}
            readOnly={readOnly}
            variante={null}
            ctxV={null}
            acaoCor={ultima ? botaoCor : undefined}
            avisos={avisos}
            onLimparAviso={onLimparAviso}
            presentes={presentes}
            onAdicionarCores={nv.onAdicionarCores}
            ex={ex}
          />
        );
      })}
      {novosAlvo.map((g) => (
        <LinhasTecidoNovo
          key={g.tmp}
          grupo={g}
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

export function TecidosGradeTabela({ linhas, opcoes, readOnly, registrar, novos: nv, colar, excluir }: {
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
        className="max-h-[calc(100vh-16rem)] max-w-full overflow-auto rounded-md border"
        data-testid="tecidos-grade-tabela"
        onPaste={aoColar}
      >
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              {/* Estado + Nome ficam FIXOS na horizontal (sticky left): ao rolar p/ o lado, sabe-se de qual variante é a linha. */}
              <th className="sticky left-0 z-10 w-8 bg-muted px-1 py-2"><span className="sr-only">Estado</span></th>
              {COLUNAS_TECIDO.map((c, i) => (
                <th
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap px-2 py-2 font-medium",
                    i === 0 && "sticky left-8 z-10 bg-muted shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]",
                  )}
                >
                  {c.rotulo}
                </th>
              ))}
              <th className="sticky right-0 z-20 bg-muted px-2 py-2 shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.15)]"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          {grupos.map((g) => (
            <GrupoTecido
              key={g.artigoId}
              grupo={g}
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
          {tecidosNovos.map((g) => (
            <tbody key={g.tmp} data-grupo-novo={g.tmp}>
              <LinhasTecidoNovo
                grupo={g}
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
