// Tabela da grade "Lista tipo Excel" do Planejamento de Produto: 1 linha por MODELO. PR-GRADE-1: cada modelo é EXPANSÍVEL (chevron, nasce
// RECOLHIDO) e, aberto, mostra as cores + a matriz cor × tamanho (`ProdutoLinhaExpandida`; a grade só é carregada ao expandir).
// PR-GRADE-2: a REVENDA edita a grade na própria lista (RPC dedicada `salvar_grade_revenda`); interno/importado ficam só-leitura + botão
// "abrir no Sheet na seção da grade" (o interno grava pelo `salvar_modelo_bom`, que apaga/reinsere o BOM — nunca pela lista).
// ⚠️ `modelos` é a tabela mais crítica do sistema. Por isso:
//  - STAGING: cada modelo tem um rascunho (`useCardDraft`, id = modelo.id) no `CardDraftsProvider` da Aba; editar só faz `patch`
//    (selo âmbar quando valor ≠ base). NADA grava antes do Salvar (na `ProdutosGradeAba`);
//  - QUEM DECIDE se a célula edita é SÓ `colunaEditavelNoProduto` (permissão de página/seção, origem, trava da Integração POR PRODUTO,
//    Dev travado após a Explosão); a célula só desenha o `modo`. Enquanto o estado da Integração não chega, as colunas traváveis ficam
//    DESABILITADAS (nunca livres);
//  - SALVAR por linha: CAS por `rev` (o `rev` de quando a pessoa começou a editar; 0 linhas = P0409 → recarrega SÓ aquela linha, avisa e
//    re-baseliza o `rev`, sem derrubar o rascunho das outras) — `salvarProduto` (lib/produto-grade/salvar.ts).
// Molde: `tecido/grade/TecidosGradeTabela` (thead pelo catálogo, scroll-x DENTRO do container, memo por linha, teclado) — mas plana.
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCardDraft } from "@/components/shared/card-drafts/useCardDraft";
import { SortTh, type SortDir } from "@/components/shared/sort";
import { useGradeTeclado } from "@/lib/grade-teclado";
import { cn } from "@/lib/utils";
import {
  colunaEditavelNoProduto,
  colunaTravadaPelaIntegracao,
  colunaTravavel,
  colunasNaOrdemDaTela,
  type ColunaProduto,
} from "@/lib/produto-grade/colunas";
import { colunaOrdenavel } from "@/lib/produto-grade/ordenar";
import type { LinhaProduto, ModeloGradeEntrada, ResolverRotulo } from "@/lib/produto-grade/linhas";
import {
  categoriaEhAcessorio,
  controleDaColuna,
  opcoesDaColuna,
  subDaCategoria,
  textoDaCelula,
} from "@/lib/produto-grade/celulas";
import {
  CHAVES_DRAFT_PRODUTO,
  ehConflitoRev,
  produtoParaDraft,
  salvarProduto,
  textoErroSalvar,
  TEXTO_CONFLITO_PRODUTO,
  TEXTO_PRODUTO_SUMIU,
  type ClienteModelos,
  type ProdutoDraft,
} from "@/lib/produto-grade/salvar";
import type { ResultadoLinha } from "@/lib/produto-grade/resumo";
import {
  TEXTO_PRECO_TRAVADO,
  textoSelo,
  type EstadoModeloIntegracao,
} from "@/lib/integracao/trava";
import { CelulaProduto, type GradeCelProps, type ModoCelula } from "./CelulaProduto";
import { ProdutoLinhaExpandida } from "./ProdutoLinhaExpandida";
import type { GradeOpcoesProduto } from "./useProdutosGrade";

/** O que cada linha precisa do Salvar da Aba (tudo por REF: lido no instante de salvar, nunca a closure do render). */
export type SalvarCtx = {
  /** Estado da Integração FRESCO (relido pela Aba antes de salvar): a trava vale por ele, não pelo do render. */
  estadosRef: MutableRefObject<Record<string, EstadoModeloIntegracao>>;
  integracaoProntaRef: MutableRefObject<boolean>;
  canEditRef: MutableRefObject<(chave: string) => boolean>;
  opcoesRef: MutableRefObject<GradeOpcoesProduto>;
  reportar: (r: ResultadoLinha) => void;
  /** Releitura de UM modelo (P0409): atualiza a linha no cache e devolve o modelo novo (`null` = não existe mais). */
  recarregarLinha: (id: string) => Promise<ModeloGradeEntrada | null>;
  /** Erro de salvar de uma linha (a Aba invalida o estado da Integração se foi 42501 `integracao_travado`). */
  aoErro: (e: unknown) => void;
  /** `rev` novo que o Salvar de CADA linha (cabeçalho) acabou de subir: o Salvar da GRADE do mesmo produto não o toma por conflito alheio. */
  revSalvoRef: MutableRefObject<Map<string, number>>;
};

/** Ordenação por coluna (estado na Aba, que ordena as `linhas` ANTES de entregá-las): só desenha os cabeçalhos clicáveis. */
export type OrdenacaoProps = {
  sortKey: string | null;
  sortDir: SortDir;
  toggle: (key: string) => void;
};

/** Mantém a MESMA referência enquanto o conteúdo não muda (a `base` do `useCardDraft` tem de ser estável). */
function useEstavel<T>(valor: T): T {
  const ref = useRef(valor);
  if (ref.current !== valor && JSON.stringify(ref.current) !== JSON.stringify(valor))
    ref.current = valor;
  return ref.current;
}

// ---------------------------------------------------------------- rascunho de UM modelo

type ProdutoCtx = {
  /** O que a célula mostra (editado = rascunho; o resto = servidor mais novo). Identidade estável enquanto nada muda. */
  valor: ProdutoDraft;
  /** Chaves EDITADAS (≠ âncora), juntas por "|" — string para o `memo` do corpo comparar por valor. */
  editados: string;
  patch: <K extends keyof ProdutoDraft>(k: K, v: ProdutoDraft[K]) => void;
  dirty: boolean;
  erro: string | null;
};

function useRascunhoProduto(modelo: ModeloGradeEntrada, sc: SalvarCtx): ProdutoCtx {
  const base = useEstavel(produtoParaDraft(modelo));
  const modeloRef = useRef(modelo);
  modeloRef.current = modelo;
  // `useCardDraft` NÃO reancora os campos que a pessoa NÃO editou quando o servidor muda com a linha suja (refetch/Realtime/P0409):
  // o campo ficaria velho na tela e pareceria "sujo". Por isso a linha guarda a ÂNCORA (a base de quando começou a editar): "editado" =
  // valor ≠ âncora; o que NÃO foi editado mostra sempre o valor MAIS NOVO do servidor (a `base`).
  const ancoraRef = useRef(base);
  const baseAtualRef = useRef(base);
  baseAtualRef.current = base;
  // O que ACABEI de salvar e o refetch ainda não trouxe: até a base nova chegar, é ele a referência da linha limpa (senão o campo
  // recém-salvo pareceria "editado" se a pessoa mexesse em outro antes do refetch).
  const salvoRef = useRef<ProdutoDraft | null>(null);
  const baseVistaRef = useRef(base);
  if (baseVistaRef.current !== base) {
    baseVistaRef.current = base;
    salvoRef.current = null;
  }
  // O `rev` do CAS = o de QUANDO a pessoa começou a editar: com a linha suja NÃO acompanha o servidor (senão um Salvar sobrescreveria
  // sem aviso o que outra pessoa salvou no meio). Limpa, acompanha (só sobe — o `rev` devolvido pelo UPDATE pode ser mais novo que a
  // linha em cache até o refetch chegar).
  const revBaseRef = useRef<number | null>(modelo.rev ?? null);
  const [erro, setErro] = useState<string | null>(null);

  const salvarFn = useCallback(
    async (mudancas: Partial<ProdutoDraft>, baseEnviada: ProdutoDraft) => {
      const m = modeloRef.current;
      setErro(null);
      try {
        const categoriaEfetiva =
          "categoria_principal_id" in mudancas
            ? (mudancas.categoria_principal_id ?? null)
            : baseEnviada.categoria_principal_id;
        const r = await salvarProduto({
          client: supabase as unknown as ClienteModelos,
          modelo: m,
          revBase: revBaseRef.current,
          mudancas,
          canEdit: (k) => sc.canEditRef.current(k),
          estado: sc.estadosRef.current[m.id] ?? null,
          integracaoPronta: sc.integracaoProntaRef.current,
          acessorio: categoriaEhAcessorio(sc.opcoesRef.current, categoriaEfetiva),
        });
        if (r.rev != null) {
          revBaseRef.current = r.rev;
          sc.revSalvoRef.current.set(m.id, r.rev);
        }
        salvoRef.current = { ...baseAtualRef.current, ...mudancas };
        sc.reportar({
          id: m.id,
          nome: m.nome?.trim() || "(sem nome)",
          tipo: "ok",
          enviou: r.enviou,
          omitidas: r.omitidas,
        });
      } catch (e) {
        if (ehConflitoRev(e)) {
          // Alguém salvou no meio: recarrega SÓ esta linha (as outras seguem), re-baseliza o `rev` e MANTÉM o rascunho para a pessoa
          // conferir e salvar de novo. Falha na releitura não esconde o conflito.
          let texto = TEXTO_CONFLITO_PRODUTO;
          try {
            const fresco = await sc.recarregarLinha(m.id);
            if (fresco) revBaseRef.current = fresco.rev;
            else texto = TEXTO_PRODUTO_SUMIU;
          } catch {
            /* a próxima leitura atualiza; o aviso do conflito fica */
          }
          setErro(texto);
          sc.reportar({ id: m.id, nome: m.nome?.trim() || "(sem nome)", tipo: "conflito" });
        } else {
          sc.aoErro(e);
          setErro(textoErroSalvar(e));
          sc.reportar({ id: m.id, nome: m.nome?.trim() || "(sem nome)", tipo: "erro" });
        }
        throw e;
      }
    },
    [sc, setErro],
  );

  const draft = useCardDraft<ProdutoDraft>({
    id: modelo.id,
    base,
    salvarFn,
    onDescartar: () => setErro(null),
  });
  const { valor: valorBruto, dirty, patch } = draft;
  if (!dirty) ancoraRef.current = salvoRef.current ?? base; // linha limpa: a âncora acompanha o servidor (suja, FICA a de quando começou)
  const ancora = ancoraRef.current;
  if (
    !dirty &&
    modelo.rev != null &&
    (revBaseRef.current == null || modelo.rev > revBaseRef.current)
  ) {
    revBaseRef.current = modelo.rev;
  }
  const editado = (k: keyof ProdutoDraft) => dirty && !Object.is(valorBruto[k], ancora[k]);
  // O que a célula mostra: o editado vale o rascunho; o resto, o servidor mais novo. MEMOIZADO (identidade estável enquanto nada muda):
  // o corpo da linha é `memo` e não pode refazer as ~30 células só porque o contexto do Provider mudou (nSujos de OUTRA linha).
  const editados = useMemo(
    () =>
      dirty
        ? CHAVES_DRAFT_PRODUTO.filter((k) => !Object.is(valorBruto[k], ancora[k])).join("|")
        : "",
    [dirty, valorBruto, ancora],
  );
  const valor = useMemo<ProdutoDraft>(
    () =>
      dirty
        ? (Object.fromEntries(
            CHAVES_DRAFT_PRODUTO.map((k) => [
              k,
              editados.split("|").includes(k) ? valorBruto[k] : base[k],
            ]),
          ) as ProdutoDraft)
        : valorBruto,
    [dirty, editados, valorBruto, base],
  );
  useEffect(() => {
    if (!dirty) setErro(null);
  }, [dirty, setErro]);

  const patchTipado = useCallback(
    <K extends keyof ProdutoDraft>(k: K, v: ProdutoDraft[K]) => patch(k, v as never),
    [patch],
  );
  return { valor, editados, patch: patchTipado, dirty, erro };
}

// ---------------------------------------------------------------- linha

/** Permissões que `colunaEditavelNoProduto`/`colunasVisiveis` consultam: a assinatura muda só quando o RESULTADO muda (mantém as linhas memoizadas). */
type GradeCtx = {
  colunas: ColunaProduto[];
  opcoes: GradeOpcoesProduto;
  otbOn: boolean;
  readOnly: boolean;
  integracaoPronta: boolean;
  tz: string;
  resolver: ResolverRotulo;
  /** Decide por ref (estável): a Tabela re-cria `g` quando a assinatura das permissões muda. */
  canEdit: (chave: string) => boolean;
  propsCel: (linha: number, coluna: number) => GradeCelProps;
  salvar: SalvarCtx;
  /** PR-GRADE-2 — abre o Sheet do produto já na seção pedida (`undefined` = sem o atalho). */
  abrirNoSheet?: (modeloId: string, secao: string) => void;
};

function EstadoLinha({ sujo, erro }: { sujo: boolean; erro: string | null }) {
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

/** Estado + Nome ficam FIXOS na horizontal (sticky left): ao rolar para o lado, sabe-se de qual produto é a linha. */
const CLASSE_COL_ESTADO = "sticky left-0 z-10 w-10 min-w-10 px-1 py-1.5 text-center";
const CLASSE_COL_NOME = "sticky left-10 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]";

type LinhaProps = {
  linha: LinhaProduto;
  /** Estado da Integração DESTE produto (`null` = sem trava conhecida). */
  estado: EstadoModeloIntegracao | null;
  g: GradeCtx;
  linhaIdx: number;
};

/**
 * Dono do rascunho da linha. `useCardDraft` assina o contexto do Provider (que muda a cada `nSujos`): esta função re-renderiza em TODAS
 * as linhas quando UMA vira suja/limpa — por isso é só o gancho; as ~30 células estão no `CorpoLinhaProduto` (memo), que só refaz
 * quando algo DELA muda.
 */
const LinhaProdutoGrade = memo(function LinhaProdutoGrade({
  linha,
  estado,
  g,
  linhaIdx,
}: LinhaProps) {
  const ctx = useRascunhoProduto(linha.modelo, g.salvar);
  return (
    <CorpoLinhaProduto
      linha={linha}
      estado={estado}
      g={g}
      linhaIdx={linhaIdx}
      valor={ctx.valor}
      editados={ctx.editados}
      patch={ctx.patch}
      dirty={ctx.dirty}
      erro={ctx.erro}
    />
  );
});

const CorpoLinhaProduto = memo(function CorpoLinhaProduto({
  linha,
  estado,
  g,
  linhaIdx,
  valor,
  editados,
  patch,
  dirty,
  erro,
}: LinhaProps & ProdutoCtx) {
  const modelo = linha.modelo;
  const sujo = (k: keyof ProdutoDraft) => dirty && editados.split("|").includes(k);
  const ctx = { sujo, patch };
  const produto = { origem: modelo.origem, enviado_cad: modelo.enviado_cad };
  const acessorio = categoriaEhAcessorio(g.opcoes, valor.categoria_principal_id);
  const nomeAria = modelo.nome?.trim() || "(sem nome)";
  // PR-GRADE-1 — expandir/recolher (nasce recolhido; estado local da linha: ordenar/filtrar não o perde porque a `key` é o modelo).
  const [aberto, setAberto] = useState(false);
  // PR-GRADE-2 — rascunho de grade (revenda) em edição NESTA linha: bloqueia recolher (a matriz é desmontada ao recolher e o rascunho se perderia).
  const [gradeSuja, setGradeSuja] = useState(false);
  // A grade lida é a SALVA: o grupo vem da categoria SALVA do modelo (não do rascunho).
  const acessorioSalvo = categoriaEhAcessorio(g.opcoes, modelo.categoria_principal_id);
  const ariaDe = (col: ColunaProduto) => `${col.rotulo} de ${nomeAria}`;

  const celula = (col: ColunaProduto, colIdx: number) => {
    const controle = controleDaColuna(col, g.otbOn);
    const leitura = textoDaCelula(linha, col, g.resolver);
    const gradeProps = g.propsCel(linhaIdx, colIdx);
    // Só as colunas do rascunho editam; as demais (REF, Status, Origem…) são só-leitura de qualquer jeito.
    const editaSemTrava =
      !g.readOnly &&
      controle !== "somente-leitura" &&
      colunaEditavelNoProduto(col, produto, g.canEdit, null, { integracaoPronta: true });
    let modo: ModoCelula = "texto";
    if (editaSemTrava) {
      if (
        colunaEditavelNoProduto(col, produto, g.canEdit, estado, {
          integracaoPronta: g.integracaoPronta,
        })
      )
        modo = "editar";
      else if (colunaTravadaPelaIntegracao(col, estado)) modo = "travada";
      else if (!g.integracaoPronta && colunaTravavel(col)) modo = "verificando";
    }
    const motivoTrava =
      modo === "travada" && estado
        ? col.key === "preco_venda"
          ? `${TEXTO_PRECO_TRAVADO} ${textoSelo(estado, g.tz)}`
          : textoSelo(estado, g.tz)
        : undefined;
    const comum = {
      coluna: col,
      controle,
      modo,
      ariaLabel: ariaDe(col),
      motivoTrava,
      texto: leitura,
    };

    switch (col.key) {
      case "tamanho_tipo":
        // Acessórios = grade única "UN": "Tamanho em" não se aplica (escondido, como no Sheet).
        if (acessorio)
          return <CelulaProduto {...comum} controle="somente-leitura" texto="N/A (grade UN)" />;
        return (
          <CelulaProduto
            {...comum}
            valor={valor.tamanho_tipo}
            sujo={ctx.sujo("tamanho_tipo")}
            opcoes={opcoesDaColuna("tamanho_tipo", g.opcoes, {
              categoriaId: null,
              colecaoId: null,
              atual: valor.tamanho_tipo,
            })}
            onChange={(v) => ctx.patch("tamanho_tipo", v as string | null)}
          />
        );
      case "colecao":
        if (controle === "select") {
          return (
            <CelulaProduto
              {...comum}
              valor={valor.colecao_id}
              sujo={ctx.sujo("colecao_id")}
              placeholder={modelo.colecao_rotulo ?? undefined}
              opcoes={opcoesDaColuna("colecao", g.opcoes, {
                categoriaId: null,
                colecaoId: null,
                atual: valor.colecao_id,
              })}
              onChange={(v) => {
                const id = (v as string | null) ?? null;
                const col2 = g.opcoes.colecoes.find((c) => c.id === id);
                ctx.patch("colecao_id", id);
                // Como o Sheet: o texto acompanha o nome da coleção; Mês/Ano vazios herdam os dela.
                if (col2) ctx.patch("colecao", col2.nome);
                if (col2 && !valor.mes_id && col2.mes_id) ctx.patch("mes_id", col2.mes_id);
                if (col2 && !valor.ano_id && col2.ano_id) ctx.patch("ano_id", col2.ano_id);
              }}
            />
          );
        }
        return (
          <CelulaProduto
            {...comum}
            valor={valor.colecao}
            sujo={ctx.sujo("colecao")}
            gradeProps={gradeProps}
            onChange={(v) => ctx.patch("colecao", v as string | null)}
          />
        );
      case "subcolecao":
        if (controle === "select") {
          return (
            <CelulaProduto
              {...comum}
              valor={valor.subcolecao}
              sujo={ctx.sujo("subcolecao")}
              opcoes={opcoesDaColuna("subcolecao", g.opcoes, {
                categoriaId: null,
                colecaoId: valor.colecao_id,
                atual: valor.subcolecao,
              })}
              onChange={(v) => ctx.patch("subcolecao", v as string | null)}
            />
          );
        }
        return (
          <CelulaProduto
            {...comum}
            valor={valor.subcolecao}
            sujo={ctx.sujo("subcolecao")}
            gradeProps={gradeProps}
            onChange={(v) => ctx.patch("subcolecao", v as string | null)}
          />
        );
      case "categoria_principal_id":
        return (
          <CelulaProduto
            {...comum}
            valor={valor.categoria_principal_id}
            sujo={ctx.sujo("categoria_principal_id")}
            opcoes={opcoesDaColuna("categoria_principal_id", g.opcoes, {
              categoriaId: null,
              colecaoId: null,
              atual: valor.categoria_principal_id,
            })}
            onChange={(v) => {
              const nova = (v as string | null) ?? null;
              ctx.patch("categoria_principal_id", nova);
              // Cascata: a subcategoria que não é da categoria nova sai junto (o gatilho do REF/espelho também a limparia).
              if (!subDaCategoria(g.opcoes.subcategorias1, valor.subcategoria1_id, nova))
                ctx.patch("subcategoria1_id", null);
              if (!subDaCategoria(g.opcoes.subcategorias2, valor.subcategoria2_id, nova))
                ctx.patch("subcategoria2_id", null);
            }}
          />
        );
      case "subcategoria1_id":
      case "subcategoria2_id": {
        const k = col.key;
        return (
          <CelulaProduto
            {...comum}
            valor={valor[k]}
            sujo={ctx.sujo(k)}
            opcoes={opcoesDaColuna(k, g.opcoes, {
              categoriaId: valor.categoria_principal_id,
              colecaoId: null,
              atual: valor[k],
            })}
            onChange={(v) => ctx.patch(k, v as string | null)}
          />
        );
      }
      default:
        break;
    }

    // Demais colunas do rascunho têm o MESMO nome no rascunho; as só-leitura caem aqui só para desenhar o texto.
    if (controle === "somente-leitura") return <CelulaProduto {...comum} />;
    const k = col.key as keyof ProdutoDraft;
    const selectOpcoes =
      controle === "select"
        ? opcoesDaColuna(col.key, g.opcoes, {
            categoriaId: null,
            colecaoId: null,
            atual: (valor[k] as string | null) ?? null,
          })
        : undefined;
    return (
      <CelulaProduto
        {...comum}
        valor={valor[k]}
        sujo={ctx.sujo(k)}
        opcoes={selectOpcoes}
        placeholder={k === "titulo_pagina" || k === "preco_anterior" ? "automático" : undefined}
        gradeProps={controle === "texto" || controle === "money" ? gradeProps : undefined}
        onChange={(v) => ctx.patch(k, v as never)}
      />
    );
  };

  return (
    <>
      <tr className="border-t align-middle" data-modelo-id={modelo.id} data-slot={linha.chave}>
        <td className={cn(CLASSE_COL_ESTADO, "bg-background")}>
          <div className="flex items-center justify-center gap-0.5">
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              disabled={aberto && gradeSuja}
              title={
                aberto && gradeSuja
                  ? "Salve ou descarte as alterações da grade antes de recolher."
                  : undefined
              }
              aria-expanded={aberto}
              aria-label={`${aberto ? "Recolher" : "Expandir"} a grade de tamanhos de ${nomeAria}`}
              data-expandir-grade
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <EstadoLinha sujo={dirty || gradeSuja} erro={erro} />
          </div>
        </td>
        {g.colunas.map((col, i) => (
          <td
            key={col.key}
            className={cn("px-1.5 py-1.5", i === 0 && cn(CLASSE_COL_NOME, "bg-background"))}
            data-col={col.key}
          >
            {celula(col, i)}
          </td>
        ))}
      </tr>
      {aberto && (
        <tr data-grade-expandida-de={modelo.id} className="bg-muted/20">
          <td colSpan={g.colunas.length + 1} className="p-0">
            {/* sticky: a matriz fica à vista mesmo com a tabela rolada para o lado */}
            <div className="sticky left-0 max-w-[min(72rem,calc(100vw-6rem))]">
              <ProdutoLinhaExpandida
                modelo={modelo}
                acessorio={acessorioSalvo}
                salvar={g.salvar}
                readOnly={g.readOnly}
                canEdit={g.canEdit}
                abrirNoSheet={g.abrirNoSheet}
                onSujoChange={setGradeSuja}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
});

// ---------------------------------------------------------------- tabela

export function ProdutosGradeTabela({
  linhas,
  colunasVisiveis,
  opcoes,
  otbOn,
  readOnly,
  integracaoPronta,
  estadosIntegracao,
  permissoesKey,
  canEdit,
  tz,
  resolver,
  salvar,
  ordenacao,
  abrirNoSheet,
}: {
  /** Linhas JÁ na ordem da tela (filtro + ordenação por coluna aplicados pela Aba). */
  linhas: LinhaProduto[];
  /** As colunas que o usuário PODE VER (`colunasVisiveis(canView, canEdit)`); a ordem da tela (Nome primeiro) é aplicada aqui. */
  colunasVisiveis: ColunaProduto[];
  opcoes: GradeOpcoesProduto;
  otbOn: boolean;
  readOnly: boolean;
  integracaoPronta: boolean;
  estadosIntegracao: Record<string, EstadoModeloIntegracao>;
  /** Muda só quando o RESULTADO das permissões muda: mantém as linhas memoizadas (canEdit/canView do `useAuth` mudam de identidade). */
  permissoesKey: string;
  canEdit: (chave: string) => boolean;
  tz: string;
  resolver: ResolverRotulo;
  salvar: SalvarCtx;
  /** Cabeçalhos clicáveis (ordenar). Ausente = cabeçalhos de texto. */
  ordenacao?: OrdenacaoProps;
  /** PR-GRADE-2 — abre o Sheet do produto na seção pedida (botão da linha expandida do interno/importado). */
  abrirNoSheet?: (modeloId: string, secao: string) => void;
}) {
  const colunas = useMemo(() => colunasNaOrdemDaTela(colunasVisiveis), [colunasVisiveis]);
  // Teclado (Enter desce / Tab ao lado): "linha" = posição na ordem da tela; "coluna" = posição em `colunas` (Nome = 0).
  const { gridRef, propsDaCelula } = useGradeTeclado({
    nLinhas: linhas.length,
    nColunas: colunas.length,
  });
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const canEditEstavel = useCallback((chave: string) => canEditRef.current(chave), []);
  const g = useMemo<GradeCtx>(
    () => ({
      colunas,
      opcoes,
      otbOn,
      readOnly,
      integracaoPronta,
      tz,
      resolver,
      canEdit: canEditEstavel,
      propsCel: propsDaCelula,
      salvar,
      abrirNoSheet,
    }),
    // `permissoesKey` entra de propósito: permissão que muda recalcula as células (canEditEstavel lê por ref e não muda de identidade).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      colunas,
      opcoes,
      otbOn,
      readOnly,
      integracaoPronta,
      tz,
      resolver,
      canEditEstavel,
      propsDaCelula,
      salvar,
      abrirNoSheet,
      permissoesKey,
    ],
  );
  return (
    <div className="space-y-2">
      <div
        ref={gridRef as RefObject<HTMLDivElement>}
        className="scroll-x-visivel max-h-[calc(100vh-16rem)] max-w-full overflow-y-auto rounded-md border"
        data-testid="produtos-grade-tabela"
      >
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className={cn(CLASSE_COL_ESTADO, "bg-muted py-2")}>
                <span className="sr-only">Estado</span>
              </th>
              {colunas.map((c, i) => {
                const classe = cn(
                  "whitespace-nowrap px-2 py-2 font-medium",
                  i === 0 && cn(CLASSE_COL_NOME, "bg-muted"),
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
          <tbody>
            {linhas.map((l, i) => (
              <LinhaProdutoGrade
                key={l.chave}
                linha={l}
                estado={estadosIntegracao[l.modeloId] ?? null}
                g={g}
                linhaIdx={i}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
