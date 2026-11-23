// Tabela da grade "Lista tipo Excel" de Cadastro > Tecidos (1 linha por cor; o cabeçalho do tecido se repete em cada cor).
// Molde: `integracao/ProdutosTabela` (thead pelo catálogo, scroll-x DENTRO do container, memo por grupo), escrito enxuto.
//
// STAGING (nada grava antes do Salvar): cada TECIDO tem um rascunho (`useCardDraft`, id = artigo.id) e cada COR outro
// (id = variante.id), ambos no `CardDraftsProvider` da aba. Editar uma célula só faz `patch` no rascunho (selo âmbar quando
// valor ≠ base). O Salvar (na `TecidosGradeAba`) chama o `salvar` de cada rascunho sujo — tecidos primeiro, depois cores.
// Cada rascunho se registra aqui por `registrar` (a ordem é do wrapper, não da ordem de montagem do registry).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useCardDraft } from "@/components/shared/card-drafts/useCardDraft";
import {
  draftParaServidor,
  varianteParaDraft,
  type VarianteDraft,
} from "@/routes/_authenticated/cadastro.tecidos.$artigoId";
import { COLUNAS_TECIDO, type ColunaGrade } from "@/lib/tecido-grade/colunas";
import type { ArtigoEntrada, LinhaGrade, VarianteEntrada } from "@/lib/tecido-grade/linhas";
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
import { cn } from "@/lib/utils";
import type { GradeOpcoes } from "./useTecidosGrade";
import { CelulaTecido } from "./CelulaTecido";

/** O que cada rascunho entrega ao Salvar: lê o estado MAIS NOVO por ref, no momento de salvar. */
export type SaverApi = {
  kind: "artigo" | "variante";
  dirty: () => boolean;
  salvar: (ctx: { limite?: number }) => Promise<void>;
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
};

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
      onChange={(v) => ctxA.patch(campo, v)}
      sujo={ctxA.sujo(campo)}
      desabilitado={readOnly || !col.editavel || celulaDesabilitadaPorRegra(col.key, ctxA.valor)}
      opcoes={opcoesDaColuna(col.key, opcoes)}
    />
  );
}

function celulaVariante(col: ColunaGrade, c: LinhaProps) {
  const { ctxV, variante, opcoes, readOnly, artigo } = c;
  if (!ctxV || !variante) {
    return <span className="px-2 text-muted-foreground" title="Tecido sem cores">—</span>;
  }
  const ariaLabel = `${col.rotulo} da cor de ${artigo.nome}`;
  if (col.key === "foto") return <CelulaTecido coluna={col} ariaLabel={ariaLabel} temFoto={!!variante.foto_url} />;
  const campo = CAMPO_VARIANTE[col.key];
  if (!campo) return null;
  const aoMudar = (v: unknown) => {
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
      desabilitado={readOnly || !col.editavel}
      opcoes={opcoesDaColuna(col.key, opcoes, ctxV.valor.cor_id)}
    />
  );
}

function LinhaTr(props: LinhaProps) {
  const { primeira, ctxA, ctxV, artigo, variante } = props;
  return (
    <tr
      className={cn("align-middle", primeira ? "border-t-2 border-border" : "border-t border-dashed")}
      data-artigo-id={artigo.id}
      data-variante-id={variante?.id}
    >
      <td className="w-8 px-1 py-1.5 text-center">
        <EstadoLinha sujo={(primeira && ctxA.dirty) || !!ctxV?.dirty} erro={ctxV?.erro ?? (primeira ? ctxA.erro : null)} />
      </td>
      {COLUNAS_TECIDO.map((col) => (
        <td key={col.key} className="px-1.5 py-1.5">
          {col.escopo === "artigo" ? celulaArtigo(col, props) : celulaVariante(col, props)}
        </td>
      ))}
    </tr>
  );
}

function LinhaComCor({ variante, ...resto }: Omit<LinhaProps, "ctxV"> & { variante: VarianteEntrada; registrar: RegistrarSaver }) {
  const { registrar, ...props } = resto;
  const ctxV = useRascunhoVariante(variante, registrar);
  return <LinhaTr {...props} variante={variante} ctxV={ctxV} />;
}

const GrupoTecido = memo(function GrupoTecido({ grupo, opcoes, readOnly, registrar }: {
  grupo: Grupo; opcoes: GradeOpcoes; readOnly: boolean; registrar: RegistrarSaver;
}) {
  const { artigo, linhas } = grupo;
  const ctxA = useRascunhoArtigo(artigo, registrar);
  return (
    <tbody data-grupo-artigo={artigo.id}>
      {linhas.map((l, i) =>
        l.variante ? (
          <LinhaComCor
            key={l.chave}
            artigo={artigo}
            ctxA={ctxA}
            primeira={i === 0}
            opcoes={opcoes}
            readOnly={readOnly}
            variante={l.variante}
            registrar={registrar}
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
          />
        ),
      )}
    </tbody>
  );
});

export function TecidosGradeTabela({ linhas, opcoes, readOnly, registrar }: {
  linhas: LinhaGrade[];
  opcoes: GradeOpcoes;
  readOnly: boolean;
  registrar: RegistrarSaver;
}) {
  const grupos = useMemo(() => agruparLinhasPorArtigo(linhas), [linhas]);
  return (
    <div className="max-h-[calc(100vh-16rem)] max-w-full overflow-auto rounded-md border" data-testid="tecidos-grade-tabela">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-8 px-1 py-2"><span className="sr-only">Estado</span></th>
            {COLUNAS_TECIDO.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-2 py-2 font-medium">{c.rotulo}</th>
            ))}
          </tr>
        </thead>
        {grupos.map((g) => (
          <GrupoTecido key={g.artigoId} grupo={g} opcoes={opcoes} readOnly={readOnly} registrar={registrar} />
        ))}
      </table>
    </div>
  );
}
