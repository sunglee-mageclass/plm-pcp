import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Plus, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { printWithImages } from "@/lib/print";
import { invalidarVencimentos, ROTULO_DATA_NOTA } from "@/lib/nota-entrada";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { varianteLabel } from "@/lib/variante";
import { fmtMoeda } from "@/lib/moeda";
import { erroCotacaoEtapas } from "@/lib/importado-etapas";
import { previewSiglaOcLote, numeroPrevia } from "@/lib/pedido-oc-lote";
import { contarRecebidos, motivoNaoExcluirOc, motivoNaoTirar, textoRecebidos } from "@/lib/oc-multi-itens";
import { textoMarcarProdutoRecebido, textoTirarProdutoDaOc } from "@/lib/confirmacoes-textos";
import { Button } from "@/components/ui/button";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { OcModalShell } from "@/components/shared/OcModalShell";
import { OcAnchorRail, type SecaoOc } from "@/components/shared/OcAnchorRail";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useValidarDataNota } from "@/components/shared/NotaEntrada";
import { OcDocumentoPrint } from "@/components/shared/OcDocumentoPrint";
import { OcItemAcordeao } from "@/components/shared/OcItemAcordeao";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import { OcSecTitle } from "@/components/oc-tecido/OcTecidoForm";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useRequerModulo } from "@/hooks/useRequerModulo";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { pathDoElemento } from "@/lib/colab/colab-field-path";
import { juntarConflitos, baseComLinhaResolvida } from "@/lib/colab/conflitos-pendentes";
import type { Conflito } from "@/lib/colab/merge";
import { erroValidacao } from "@/components/produto-acabado/shared";
import type { ColaboradorOpt } from "@/components/oc-p-acabado/OcPaRecebimento";
import { OcImpCabecalho, OcImpTotais, OcImpAnexos } from "./OcImpCabecalho";
import { OcImpItem, type Opt, type CatOpt, type SubOpt, type CorApelidoOpt } from "./OcImpItem";
import { ProdutoImportadoPicker, type ProdutoImportadoSelecionado } from "./ProdutoImportadoPicker";
import {
  cabecalhoParaPayload, celulasTocadas, dadosDoRecebimento, erroDeItensParaSalvar, etapasParaPayload, idsTocados, itemAvulsoVazio,
  itemDoProduto, itensParaPayload, linhaDeItem, motivoNaoReceber, totaisDaOc, totaisDoItem, valorM1DaCompra, type ItemOcImp,
} from "./itens";
import {
  baseAposMerge, baseDe, mesclarOcItens, mesclarParaRetryP0409Imp, resolverConflitoLinha, rotuloConflitoOc, type BaseOc,
} from "./colab-itens";
import { montarDocModeloOcImp } from "./doc-modelo";
import { buscarTamanhosLoja, lerOcComItens, type DadosOc } from "./queries";
import {
  emptyCabecalho, fmtDate, uploadFile, DEFAULT_TAMANHOS, TAM_ACESSORIO,
  type CabecalhoImpDraft, type GradeDetalhe, type OcImportadoRow, type OcImportadoStatus,
} from "./shared";

type EmpresaOpt = { id: string; nome_fantasia: string; representantes: { id: string; nome: string | null }[] };

/** Cabeçalho da OC (linha de `ocs_importado` + etapas) → rascunho. O produto NÃO mora mais aqui (R13): vem dos itens. */
export function cabecalhoDeOc(oc: any, etapas: CabecalhoImpDraft["etapas"]): CabecalhoImpDraft {
  return {
    numero: oc.numero ?? "",
    empresa_id: oc.empresa_id ?? null,
    representante_id: oc.representante_id ?? null,
    data_pedido: oc.data_pedido ?? "",
    data_prevista: oc.data_prevista ?? "",
    moeda_compra: oc.moeda_compra ?? "RMB",
    moeda_intermediaria: oc.moeda_intermediaria ?? null,
    cotacao_ref: Number(oc.cotacao_ref ?? 0),
    cotacao_final: Number(oc.cotacao_final ?? 0),
    etapas,
    data_nota_entrada: oc.data_nota_entrada ?? "",
    anexo_pedido_url: oc.anexo_pedido_url ?? null,
  };
}

const ROTULO_CONFLITO_CABECALHO: Record<string, string> = {
  numero: "Número", empresa_id: "Fornecedor", representante_id: "Representante", data_pedido: "Data do Pedido",
  data_prevista: "Data Prevista", moeda_compra: "Moeda de compra", moeda_intermediaria: "Moeda intermediária",
  cotacao_ref: "Cotação ref.", cotacao_final: "Cotação final", etapas: "Etapas de pagamento",
  data_nota_entrada: ROTULO_DATA_NOTA, anexo_pedido_url: "Anexo do pedido",
};

type Acao = { tipo: "salvar" } | { tipo: "receber"; itemTempId: string } | { tipo: "tirar"; itemTempId: string };

const mesmoJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Thumb({ path, alt }: { path: string | null; alt: string }) {
  const url = useSignedUrl(path, "oc-tecido");
  if (!url) return null;
  return <img src={url} alt={alt} className="h-10 w-10 shrink-0 rounded border object-cover" />;
}

/**
 * Sheet (editar) / Dialog (nova) da OC de Produto Importado COM VÁRIOS produtos (R13, P-354..P-363) — espelho de `OcPaDialog` (T7).
 *
 * Colaboração (padrão da OC Tecido + a grade POR ITEM): cabeçalho por `mergeDraft` (as ETAPAS são UM campo grão-grosso), itens por
 * `mergeLinhas({removidasIds})`, grade de cada item por célula (`mergeGradeGenerico`, caminho `item:<id>:grade:<ordem>:<tam>:<campo>`) —
 * ver `./colab-itens`. `rev` do cabeçalho em TODAS as RPCs; o retry do P0409 lê os REFS VIVOS (receita 2419d0f) e o `onSuccess` re-baseia
 * no ENVIADO. O `status` (da OC e de cada produto) e o custo landed REAL (da OC e de cada produto) NÃO são do rascunho: seguem sempre o
 * servidor — a tela nunca recalcula landed. As etapas vão SEMPRE como estado completo em `_etapas`.
 */
export function OcImpDialog({
  ocId, empresas, onClose, onSaved, onDelete,
}: {
  ocId: string | null;
  empresas: EmpresaOpt[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (oc: OcImportadoRow) => void;
}) {
  const isEdit = !!ocId;
  const validarNota = useValidarDataNota(); // D7: só não futura
  const qc = useQueryClient();
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao();

  const [campoFocadoColab, setCampoFocadoColab] = useState<string | null>(null);
  const colabScopeRef = useRef<HTMLDivElement>(null);
  const [draft, setDraftRaw] = useState<CabecalhoImpDraft>(emptyCabecalho());
  const [items, setItemsRaw] = useState<ItemOcImp[]>([]);
  const [status, setStatus] = useState<OcImportadoStatus>("encomendado");
  const [numeroReal, setNumeroReal] = useState<string | null>(null);
  const [dataEntregaOc, setDataEntregaOc] = useState<string | null>(null);
  const [landedOc, setLandedOc] = useState(0);
  const [secAtiva, setSecAtiva] = useState("ocimp-sec-pedido");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  // P-57: o Salvar/Receber só liga DEPOIS da 1ª carga semear o rascunho — salvar antes gravaria um cabeçalho em branco por cima da OC.
  const [hidratado, setHidratado] = useState(!ocId);

  const { dirty, markClean, reset: resetBaseline } = useDirtySnapshot({ draft, items });

  // ── Colaboração ──────────────────────────────────────────────────────────────────────────────────────────────────
  const touchedRef = useRef<Set<string>>(new Set());          // campos do CABEÇALHO que EU editei
  const touchedItemIdsRef = useRef<Set<string>>(new Set());   // ids de itens que EU editei ou REMOVI (mergeLinhas.removidasIds)
  const touchedGradeRef = useRef<Set<string>>(new Set());     // células de grade que EU editei: item:<id>:grade:<ordem>:<tam>:<campo>
  const baseRef = useRef<BaseOc | null>(null);
  const revRef = useRef<number | null>(null);
  const retryRef = useRef(false);
  const savingRef = useRef(false);                            // anti-duplo-clique (ref síncrono: isPending só atualiza no re-render)
  const enviadoRef = useRef<{ draft: CabecalhoImpDraft; items: ItemOcImp[] } | null>(null);
  const ultimoFreshRef = useRef<{ draft: CabecalhoImpDraft; items: ItemOcImp[] } | null>(null);
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const conflitosRef = useRef<Conflito[]>([]);
  // Espelhos SEMPRE atualizados (toda render): o merge do onError do save roda depois de um await — ler a closure do clique descartaria
  // o que foi digitado na janela; e o retry do P0409 grava aqui o estado MESCLADO antes do `mutate` (sem re-render no meio).
  const draftLiveRef = useRef(draft); draftLiveRef.current = draft;
  const itemsLiveRef = useRef(items); itemsLiveRef.current = items;
  const statusLiveRef = useRef(status); statusLiveRef.current = status;

  const setDraft: typeof setDraftRaw = (upd) =>
    setDraftRaw((prev) => {
      const next = typeof upd === "function" ? (upd as (p: CabecalhoImpDraft) => CabecalhoImpDraft)(prev) : upd;
      for (const k of Object.keys(next) as (keyof CabecalhoImpDraft)[]) if (next[k] !== prev[k]) touchedRef.current.add(String(k));
      return next;
    });
  const setItemsTracked: typeof setItemsRaw = (upd) =>
    setItemsRaw((prev) => {
      const next = typeof upd === "function" ? (upd as (p: ItemOcImp[]) => ItemOcImp[])(prev) : upd;
      for (const id of idsTocados(prev, next)) touchedItemIdsRef.current.add(id);   // editado OU removido (id persistido que sumiu)
      for (const p of celulasTocadas(prev, next)) touchedGradeRef.current.add(p);
      return next;
    });
  const mudarItem = (tempId: string) => (updater: (it: ItemOcImp) => ItemOcImp) =>
    setItemsTracked((prev) => prev.map((it) => (it.tempId === tempId ? updater(it) : it)));

  const { presentes: presentesColab } = useColabRegistro({
    canal: ocId ? `colab:oc-imp:${ocId}` : null,
    tabela: "ocs_importado",
    registroId: ocId ?? null,
    onMudancaServidor: () => qc.invalidateQueries({ queryKey: ["oc-importado", ocId] }),
    campoFocado: campoFocadoColab,
  });

  // ── Opções (taxonomia, cores, tamanhos, colaboradores) ──
  const { data: grupos = [] } = useOpt("grupos_produto");
  const { data: categorias = [] } = useOptCat("categorias_produto", "grupo_id");
  const { data: subcats1 = [] } = useOptCat("subcategorias1_produto", "categoria_id");
  const { data: subcats2 = [] } = useOptCat("subcategorias2_produto", "categoria_id");
  const { data: cores = [] } = useOpt("cores");
  const { data: coresApelido = [] } = useOptCat("cores_apelido", "cor_base_id");
  const { data: colaboradores = [] } = useQuery({
    queryKey: ["colaboradores-todos-ocimp"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as ColaboradorOpt[];
    },
  });
  const { data: tamanhos = DEFAULT_TAMANHOS } = useQuery({
    queryKey: ["tenant-config-tamanhos-ocimp"],
    queryFn: buscarTamanhosLoja,
  });
  const grupoNome = (id: string | null) => (grupos as Opt[]).find((g) => g.id === id)?.nome ?? null;
  const corNome = (id: string | null) => (cores as Opt[]).find((c) => c.id === id)?.nome ?? null;
  const apelidoNome = (id: string | null) => (coresApelido as CorApelidoOpt[]).find((c) => c.id === id)?.nome ?? null;
  const tamanhosDoItem = (it: ItemOcImp) => (ehGrupoAcessorio(grupoNome(it.grupo_id)) ? [TAM_ACESSORIO] : tamanhos);

  // A query só BUSCA (OC crua + etapas + itens); o seed/merge acontece no useEffect abaixo — um refetch alheio (Realtime) faz MERGE.
  const { data: ocQueryData, isError: erroCarga, isFetching: carregando, refetch: recarregar } = useQuery({
    queryKey: ["oc-importado", ocId],
    enabled: !!ocId,
    queryFn: () => lerOcComItens(ocId!),
  });

  /** Semeia TODO o rascunho do servidor (1ª carga e depois de tirar/receber) — setters CRUS: nada vira "tocado". */
  const semear = (d: DadosOc) => {
    const fd = cabecalhoDeOc(d.oc, d.etapas);
    baseRef.current = baseDe(fd, d.itens);
    ultimoFreshRef.current = { draft: fd, items: d.itens };
    draftLiveRef.current = fd; itemsLiveRef.current = d.itens;
    setDraftRaw(fd);
    setItemsRaw(d.itens);
    setStatus((d.oc.status as OcImportadoStatus) ?? "encomendado");
    setNumeroReal(d.oc.numero ?? null);
    setDataEntregaOc(d.oc.data_entrega ?? null);
    setLandedOc(Number(d.oc.custo_unitario_landed_real) || 0);
    revRef.current = d.oc.rev ?? null;
    touchedRef.current = new Set();
    touchedItemIdsRef.current = new Set();
    touchedGradeRef.current = new Set();
    conflitosRef.current = [];
    setConflitos([]);
    setUltimoMerge(null);
    resetBaseline({ draft: fd, items: d.itens });
    setHidratado(true);
  };

  useEffect(() => {
    if (!ocQueryData) return;
    const freshDraft = cabecalhoDeOc(ocQueryData.oc, ocQueryData.etapas);
    const freshItems = ocQueryData.itens;
    revRef.current = ocQueryData.oc.rev ?? null;
    ultimoFreshRef.current = { draft: freshDraft, items: freshItems };

    if (!baseRef.current) {
      semear(ocQueryData);
      if (freshItems.length === 1) setAbertos(new Set([freshItems[0].tempId]));
      return;
    }

    // O status e o landed NÃO são campos do rascunho (S6/servidor): seguem SEMPRE o do servidor.
    setStatus((ocQueryData.oc.status as OcImportadoStatus) ?? "encomendado");
    setNumeroReal(ocQueryData.oc.numero ?? null);
    setDataEntregaOc(ocQueryData.oc.data_entrega ?? null);
    setLandedOc(Number(ocQueryData.oc.custo_unitario_landed_real) || 0);

    // Refetch: MERGE em vez de sobrescrever (3-vias: cabeçalho por campo, itens por linha, grade por célula).
    const r = mesclarOcItens({
      base: baseRef.current,
      live: { draft: draftLiveRef.current, items: itemsLiveRef.current },
      fresh: { draft: freshDraft, items: freshItems },
      touched: touchedRef.current, touchedIds: touchedItemIdsRef.current, touchedGrade: touchedGradeRef.current,
    });
    if (!r.mudouDraft && !r.mudouItens && r.conflitos.length === 0 && r.atualizados === 0) {
      // Merge NO-OP (inclui o refetch que o onError do P0409 já processou): não tocar em NENHUM state. Conflitos de LINHA pendentes não
      // foram recalculados, logo não valem mais (o servidor apagou a linha ou o outro reverteu): descarta só esses.
      const restantes = conflitosRef.current.filter((c) => !c.path.startsWith("linha:"));
      if (restantes.length !== conflitosRef.current.length) {
        conflitosRef.current = restantes;
        setConflitos(restantes);
        setUltimoMerge((prev) => (prev ? { ...prev, conflitos: prev.conflitos.filter((c) => !c.path.startsWith("linha:")) } : prev));
      }
      baseRef.current = baseDe(freshDraft, freshItems);
      return;
    }
    if (r.mudouDraft) { draftLiveRef.current = r.draft; setDraftRaw(r.draft); }
    if (r.mudouItens) { itemsLiveRef.current = r.items; setItemsRaw(r.items); }
    // Conflitos ainda NÃO resolvidos continuam (um eco de OUTRA linha não destrava o Salvar) e a base das linhas em conflito não avança.
    const todos = juntarConflitos(conflitosRef.current, r.conflitos);
    conflitosRef.current = todos;
    setConflitos(todos);
    setUltimoMerge({ atualizados: r.atualizados, conflitos: todos });
    baseRef.current = baseAposMerge(baseRef.current, { draft: freshDraft, items: freshItems }, todos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocQueryData]);

  // ── Resolução de conflito (ColabBanner) ──────────────────────────────────────────────────────────────────────────
  const nomeDoItem = (id: string) =>
    itemsLiveRef.current.find((i) => i.id === id)?.nome_produto || ultimoFreshRef.current?.items.find((i) => i.id === id)?.nome_produto || "produto";
  const rotuloConflito = (path: string) => rotuloConflitoOc(path, ROTULO_CONFLITO_CABECALHO, nomeDoItem);
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitosRef.current.find((x) => x.path === path);
    if (!c) return;
    if (path.startsWith("linha:")) {
      const id = path.slice("linha:".length);
      const fr = ultimoFreshRef.current?.items.find((i) => i.id === id) ?? null;
      // A base dessa linha passa a ser o que o servidor tem (não reaparece como conflito).
      if (baseRef.current) baseRef.current = { ...baseRef.current, linhas: baseComLinhaResolvida(baseRef.current.linhas, id, fr ? linhaDeItem(fr) : null) };
      const r = resolverConflitoLinha({ items: itemsLiveRef.current, id, escolha, fresh: fr });
      itemsLiveRef.current = r.items;
      setItemsRaw(r.items);
      if (r.limparToque) touchedItemIdsRef.current.delete(id);
    } else if (path.startsWith("item:")) {
      const m = /^item:([^:]+):grade:([^:]+):(.+):([^:]+)$/.exec(path);
      if (m && escolha === "dele") {
        const [, id, ordem, tam, campo] = m;
        setItemsRaw((prev) => prev.map((it) => {
          if (it.id !== id) return it;
          const linha = { ...(it.grade[ordem] ?? {}) };
          linha[tam] = { ...(linha[tam] ?? { pedida: 0, recebida: 0, defeito: 0 }), [campo]: Number(c.dele) || 0 };
          return { ...it, grade: { ...it.grade, [ordem]: linha } as GradeDetalhe };
        }));
        touchedGradeRef.current.delete(path);
      }
    } else if (escolha === "dele") {
      setDraftRaw((d) => ({ ...d, [path]: c.dele as never }));
      touchedRef.current.delete(path);
    }
    conflitosRef.current = conflitosRef.current.filter((x) => x.path !== path);
    setConflitos(conflitosRef.current);
    if (conflitosRef.current.length === 0) setUltimoMerge(null);
  };
  const temConflito = conflitos.length > 0;
  const itemEmConflito = (it: ItemOcImp) => !!it.id && conflitos.some((c) => c.path === `linha:${it.id}` || c.path.startsWith(`item:${it.id}:`));

  // ── Documento imprimível (rascunho vivo) ─────────────────────────────────────────────────────────────────────────
  const empresaSel = empresas.find((e) => e.id === draft.empresa_id);
  const representanteNome = empresaSel?.representantes?.find((r) => r.id === draft.representante_id)?.nome ?? null;
  const docModelo = useMemo(
    () => montarDocModeloOcImp({
      numero: numeroReal, cabecalho: draft, landedUnitarioOc: landedOc, empresaNome: empresaSel?.nome_fantasia ?? null, representanteNome,
      itens: items, tamanhos, grupoNome, corNome, apelidoNome, emitidoEm: fmtDate(new Date().toISOString()),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, items, grupos, tamanhos, cores, coresApelido, empresas, numeroReal, landedOc],
  );
  const numeroPreviaOc = useMemo(
    () => numeroPrevia(previewSiglaOcLote(empresaSel?.nome_fantasia, items.map((i) => ({
      grupoNome: grupoNome(i.grupo_id) ?? "", categoriaNome: (categorias as CatOpt[]).find((c) => c.id === i.categoria_id)?.nome ?? "",
      grupoId: i.grupo_id, categoriaId: i.categoria_id,
    })))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empresaSel, items, grupos, categorias],
  );

  const handleUpload = async (file: File) => {
    try {
      const path = await uploadFile(file, "anexo_pedido_url");
      setDraft((d) => ({ ...d, anexo_pedido_url: path }));
      toast.success("Arquivo enviado");
    } catch (e: any) {
      toast.error(mensagemErro(e));
    }
  };

  // ── Salvar / Receber um produto / Tirar um produto (UMA mutação: mesmo merge, mesmo retry do P0409) ───────────────
  // [modularidade F2, m6] receber exige Criação E Produção no servidor (card + CQ).
  const requerRecebimento = useRequerModulo("criacao", "producao");

  const mutation = useMutation({
    mutationFn: async (acao: Acao) => {
      // Guard SÍNCRONO contra salvar com conflito pendente (o disabled do botão é state async).
      if (conflitosRef.current.length > 0) throw erroValidacao("Resolva os conflitos listados no aviso no topo antes de salvar.");
      if (isEdit && !baseRef.current) throw erroValidacao("Aguarde a OC terminar de carregar.");
      // Receita 2419d0f: estado AO VIVO (refs), NUNCA a closure do render do clique — no retry do P0409 o merge acabou de gravar o estado
      // mesclado aqui (setState ainda não re-renderizou).
      const d = draftLiveRef.current;
      const todos = itemsLiveRef.current;
      const its = acao.tipo === "tirar" ? todos.filter((i) => i.tempId !== acao.itemTempId) : todos;
      const erroItens = erroDeItensParaSalvar(its);
      if (erroItens) throw erroValidacao(erroItens);
      { const erroNota = validarNota(d.data_nota_entrada, d.data_pedido); if (erroNota) throw erroValidacao(erroNota); } // D7
      { const erroCot = erroCotacaoEtapas(d.etapas, valorM1DaCompra(its)); if (erroCot) throw erroValidacao(erroCot); } // P-207 A (L8)
      enviadoRef.current = { draft: d, items: its };

      if (acao.tipo === "receber") {
        if (!requerRecebimento.ok) throw erroValidacao(requerRecebimento.motivo);
        const item = its.find((i) => i.tempId === acao.itemTempId);
        const motivo = item ? motivoNaoReceber(item, tamanhosDoItem(item)) : "Produto não encontrado.";
        if (!item?.id || motivo) throw erroValidacao(motivo ?? "Salve a OC para registrar o recebimento deste produto.");
        // Salva as pendências da OC (itens + ETAPAS) E recebe o produto NUMA transação (o "CRITICAL" da inv. 1 garantido pelo servidor).
        const { error } = await supabase.rpc("receber_item_oc_importado" as any, {
          _oc_id: ocId, _item_id: item.id, _dados: dadosDoRecebimento(d, item), _itens: itensParaPayload(its),
          _etapas: etapasParaPayload(d.etapas), _rev_base: revRef.current,
        });
        if (error) throw error;
        return ocId as string;
      }
      const { data: savedId, error } = await supabase.rpc("salvar_oc_importado_itens" as any, {
        _id: isEdit ? ocId : null,
        _dados: cabecalhoParaPayload(d),
        _itens: itensParaPayload(its),
        _etapas: etapasParaPayload(d.etapas),        // estado COMPLETO do cronograma (como sempre no importado)
        _rev_base: isEdit ? revRef.current : null,   // P0409 se outra pessoa salvou no meio
      });
      if (error) throw error;
      return savedId as string;
    },
    onSuccess: async (savedId, acao) => {
      toast.success(acao.tipo === "receber" ? "Produto recebido — CQ e Direcionamento liberados para ele." : acao.tipo === "tirar" ? "Produto tirado da OC; total e parcelas recalculados." : "OC salva.");
      invalidarVencimentos(qc); // o save regenera as parcelas do Importado (etapas)
      qc.invalidateQueries({ queryKey: ["ocs_importado"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] }); // data_prevista/status mexem no badge "atrasada"
      qc.invalidateQueries({ queryKey: ["produtos-importados"] }); // o servidor sincroniza no produto e o chip da OC
      qc.invalidateQueries({ queryKey: ["produtos-importados-picker-oc"] });
      if (acao.tipo === "receber") qc.invalidateQueries({ queryKey: ["estoque_p_importado"] });
      const enviado = enviadoRef.current ?? { draft: draftLiveRef.current, items: itemsLiveRef.current };

      if (acao.tipo === "salvar") {
        // O que acabei de salvar JÁ É a base: o eco do Realtime (meu próprio UPDATE) não vira "alguém atualizou".
        baseRef.current = baseDe(enviado.draft, enviado.items);
        touchedRef.current = new Set(); touchedItemIdsRef.current = new Set(); touchedGradeRef.current = new Set();
        conflitosRef.current = []; setConflitos([]); setUltimoMerge(null);
        markClean();
        qc.invalidateQueries({ queryKey: ["oc-importado", savedId] });
        onSaved();
        onClose();
        return;
      }

      // Tirar / Receber: a tela FICA ABERTA (outros produtos seguem) e relê o servidor (status, landed, totais, item novo no recebido…).
      baseRef.current = baseDe(enviado.draft, enviado.items);
      if (acao.tipo === "tirar") {
        const sem = itemsLiveRef.current.filter((i) => i.tempId !== acao.itemTempId);
        itemsLiveRef.current = sem; setItemsRaw(sem);
      }
      await qc.refetchQueries({ queryKey: ["oc-importado", ocId] });
      const fresh = qc.getQueryData<DadosOc | null>(["oc-importado", ocId]);
      // Só re-semeia tudo se NADA foi digitado desde o envio (senão o merge do refetch preserva o que a pessoa fez depois).
      const igualAoEnviado = mesmoJson(draftLiveRef.current, enviado.draft) && mesmoJson(itemsLiveRef.current, enviado.items);
      if (fresh && igualAoEnviado) semear(fresh);
    },
    onError: async (e: any, acao) => {
      // Colab: conflito de versão — outra pessoa salvou entre a última carga e agora. Busca o estado novo e roda o merge AQUI (síncrono; o
      // useEffect só roda depois do re-render e o retry leria `revRef` velho). Sem conflito de verdade (só campos que EU não toquei), salva de
      // novo UMA vez; com conflito, para e deixa a pessoa resolver nos itens destacados.
      if (e?.code === "P0409" && !retryRef.current && isEdit) {
        retryRef.current = true;
        savingRef.current = true;
        await qc.refetchQueries({ queryKey: ["oc-importado", ocId] });
        const fresh = qc.getQueryData<DadosOc | null>(["oc-importado", ocId]);
        if (fresh?.oc) {
          const freshDraft = cabecalhoDeOc(fresh.oc, fresh.etapas);
          const base = baseRef.current ?? baseDe(freshDraft, fresh.itens);
          const r = mesclarParaRetryP0409Imp({
            base,
            live: { draft: draftLiveRef.current, items: itemsLiveRef.current },
            fresh: { draft: freshDraft, items: fresh.itens, status: ((fresh.oc.status as OcImportadoStatus) ?? "encomendado") },
            touched: touchedRef.current, touchedIds: touchedItemIdsRef.current, touchedGrade: touchedGradeRef.current,
          });
          // O retry roda ANTES do re-render: grava o estado MESCLADO nos refs que o mutationFn lê.
          draftLiveRef.current = r.estado.draft;
          itemsLiveRef.current = r.estado.items;
          statusLiveRef.current = r.estado.status;
          setStatus(r.estado.status); // status sempre o do servidor
          setLandedOc(Number(fresh.oc.custo_unitario_landed_real) || 0);
          if (r.mudouDraft) setDraftRaw(r.estado.draft);
          if (r.mudouItens) setItemsRaw(r.estado.items);
          const todos = juntarConflitos(conflitosRef.current, r.conflitos);
          conflitosRef.current = todos;
          setConflitos(todos);
          setUltimoMerge({ atualizados: r.atualizados, conflitos: todos });
          ultimoFreshRef.current = { draft: freshDraft, items: fresh.itens };
          // Avança base/rev AQUI: quando o useEffect rodar em seguida vai ver base === fresh (merge no-op).
          baseRef.current = baseAposMerge(base, { draft: freshDraft, items: fresh.itens }, todos);
          revRef.current = fresh.oc.rev ?? null;
          if (todos.length === 0) {
            mutation.mutate(acao, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
            return;
          }
          savingRef.current = false;
          retryRef.current = false;
          toast.warning("Alguém salvou esta OC agora — confira os itens em conflito.");
          return;
        }
        savingRef.current = false;
        retryRef.current = false;
        toast.error(mensagemErro(e, "Erro ao salvar"));
        return;
      }
      // A RPC já pode ter regenerado parcelas antes de falhar: invalida o Financeiro também aqui.
      invalidarVencimentos(qc);
      // Recusas do servidor que mudam o que a tela mostra (outra pessoa recebeu/tirou/recebeu a OC): relê.
      if (ocId && /^(item_recebido_nao_sai|oc_sem_produtos|oc_recebida_nao_adiciona|nao_encontrado)/.test(String(e?.message ?? ""))) {
        qc.invalidateQueries({ queryKey: ["oc-importado", ocId] });
      }
      toast.error(mensagemErro(e, acao.tipo === "receber" ? "Erro ao marcar recebido" : acao.tipo === "tirar" ? "Erro ao tirar da OC" : "Erro ao salvar"));
    },
  });

  const disparar = (acao: Acao) => {
    if (savingRef.current || mutation.isPending) return;
    savingRef.current = true;
    mutation.mutate(acao, { onSettled: () => { savingRef.current = false; } });
  };

  // ── Ações de ciclo por produto ───────────────────────────────────────────────────────────────────────────────────
  const moedaCompra = draft.moeda_compra;
  const tirarProduto = (it: ItemOcImp) => {
    if (!it.id) { // ainda não salvo (pendente do picker ou avulso novo): sai da lista sem confirmar — nada foi gravado
      setItemsTracked((prev) => prev.filter((x) => x.tempId !== it.tempId));
      return;
    }
    const antes = totaisDaOc(itemsLiveRef.current).total;
    const depois = totaisDaOc(itemsLiveRef.current.filter((x) => x.tempId !== it.tempId)).total;
    pedirConfirmacao({
      ...textoTirarProdutoDaOc({ nome: it.nome_produto, totalAntes: fmtMoeda(antes, moedaCompra), totalDepois: fmtMoeda(depois, moedaCompra), pendentes: dirty }),
      onConfirmar: () => disparar({ tipo: "tirar", itemTempId: it.tempId }),
    });
  };
  const receberProduto = (it: ItemOcImp) =>
    pedirConfirmacao({
      ...textoMarcarProdutoRecebido({ nome: it.nome_produto, pendentes: dirty }),
      onConfirmar: () => disparar({ tipo: "receber", itemTempId: it.tempId }),
    });

  const adicionarProdutos = (produtos: ProdutoImportadoSelecionado[]) => {
    setPickerOpen(false);
    if (produtos.length === 0) return;
    // OC NOVA sem produto: o 1º que entra define o fornecedor, a MOEDA, as cotações e o cronograma (as etapas) da OC — o servidor exige o
    // MESMO fornecedor e a MESMA moeda em todos, e uma OC nova não copia o cronograma do produto sozinha (só o "Fazer pedido" faz).
    if (!isEdit && itemsLiveRef.current.length === 0) {
      const p = produtos[0];
      setDraft((d) => ({
        ...d,
        empresa_id: p.empresa_id ?? d.empresa_id,
        representante_id: p.empresa_id ? p.representante_id : d.representante_id,
        moeda_compra: p.moeda_compra,
        moeda_intermediaria: p.moeda_intermediaria,
        cotacao_ref: p.cotacao_ref,
        cotacao_final: p.cotacao_final,
        etapas: p.etapas.length > 0 ? p.etapas : d.etapas,
      }));
    }
    const novos = produtos.map(itemDoProduto);
    setItemsTracked((prev) => [...prev, ...novos]);
    setAbertos((prev) => new Set([...prev, ...novos.map((n) => n.tempId)]));
    toast.success(`${produtos.length} ${produtos.length === 1 ? "produto adicionado" : "produtos adicionados"} — entram na OC ao Salvar.`);
  };
  const adicionarAvulso = () => {
    const novo = itemAvulsoVazio();
    setItemsTracked((prev) => [...prev, novo]);
    setAbertos((prev) => new Set([...prev, novo.tempId]));
  };
  const alternar = (tempId: string) =>
    setAbertos((prev) => { const n = new Set(prev); if (n.has(tempId)) n.delete(tempId); else n.add(tempId); return n; });

  // ── Derivados de tela ────────────────────────────────────────────────────────────────────────────────────────────
  const { recebidos, total: nItens } = contarRecebidos(items);
  const totais = totaisDaOc(items);
  const todosRecebidos = nItens > 0 && recebidos === nItens;
  const motivoNaoExcluir = motivoNaoExcluirOc(items);
  const pendente = mutation.isPending;

  const secoes: SecaoOc[] = [
    { id: "ocimp-sec-pedido", n: 1, label: "Dados do pedido" },
    { id: "ocimp-sec-cambio", n: 2, label: "Moedas & câmbio" },
    { id: "ocimp-sec-produtos", n: 3, label: `Produtos (${nItens})` },
    { id: "ocimp-sec-valores", n: 4, label: "Etapas & valores" },
    { id: "ocimp-sec-anexos", n: 5, label: "Anexos" },
  ];
  const irParaSecao = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); setSecAtiva(id); };
  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const topo = e.currentTarget.getBoundingClientRect().top;
    let atual = secoes[0].id;
    for (const s of secoes) {
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top - topo <= 40) atual = s.id;
    }
    if (atual !== secAtiva) setSecAtiva(atual);
  };

  const subtituloItem = (it: ItemOcImp) => {
    const nomes = it.variantes.map((v) => varianteLabel({ cor: corNome(v.cor_id), apelido: apelidoNome(v.cor_apelido_id) })).filter(Boolean).join(" · ");
    return [it.produtoRef, nomes, `${it.qtd_total} pç`, fmtMoeda(totaisDoItem(it).total, moedaCompra)].filter(Boolean).join(" · ");
  };

  // O picker só restringe a MOEDA quando a OC já tem produto (salvo ou pendente); a OC sem produto herda a do 1º que entrar.
  const moedaDaOc = isEdit || items.length > 0 ? { moeda_compra: draft.moeda_compra, moeda_intermediaria: draft.moeda_intermediaria } : null;

  return (
    <>
      <OcModalShell isEdit={isEdit} onClose={onClose} dirty={dirty} discardMessage="Há alterações não salvas nesta OC de produto importado.">
        <div className="shrink-0 space-y-1">
          <Breadcrumb items={[{ label: "Entrada e Saída" }, { label: "OC P. Importado" }, { label: numeroReal ?? "Novo pedido" }]} />
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{isEdit ? `OC ${numeroReal ?? ""}` : "Novo Pedido"}</DialogTitle>
              {isEdit && (
                <>
                  <StatusBadge tone={status === "recebido" ? "success" : "warning"}>{status === "recebido" ? "Recebida" : "Encomendada"}</StatusBadge>
                  <StatusBadge tone="info" className="normal-case tracking-normal">{textoRecebidos(recebidos, nItens)}</StatusBadge>
                  <OcPrazoBadge dataPrevista={draft.data_prevista} dataEntrega={dataEntregaOc} status={status} />
                </>
              )}
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
          </DialogHeader>
          {isEdit && (
            <InfoStrip
              itens={[
                { label: "Fornecedor", valor: empresaSel?.nome_fantasia ?? "—" },
                { label: "Moeda", valor: `${draft.moeda_compra}${draft.moeda_intermediaria ? ` → ${draft.moeda_intermediaria}` : ""}` },
                { label: "Produtos", valor: nItens },
                { label: "Peças", valor: totais.pecas },
                { label: "Total da OC", valor: fmtMoeda(totais.total, moedaCompra), hi: true },
              ]}
            />
          )}
          {/* Banner de colaboração: presença + "alguém salvou agora" + resolução de conflito. */}
          <ColabBanner presentes={presentesColab} ultimoMerge={ultimoMerge} conflitos={conflitos} onResolver={resolverPorPath} rotulo={rotuloConflito} />
        </div>

        <div className="flex min-h-0 gap-4">
          <OcAnchorRail secoes={secoes} ativa={secAtiva} onIr={irParaSecao} />
          <div
            ref={colabScopeRef}
            className="min-w-0 flex-1 space-y-6 overflow-y-auto"
            onScroll={onBodyScroll}
            onFocusCapture={(e) => {
              const scope = colabScopeRef.current;
              setCampoFocadoColab(scope ? pathDoElemento(e.target as HTMLElement, scope) : null);
            }}
            onBlurCapture={() => setCampoFocadoColab(null)}
          >
            <ColabPresenceOverlay presentes={presentesColab} scopeRef={colabScopeRef} />
            {isEdit && !hidratado && (
              <div role="status" className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {erroCarga ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Não foi possível carregar os dados da OC.</span>
                    <Button type="button" variant="outline" size="sm" disabled={carregando} onClick={() => recarregar()}>
                      {carregando ? "Tentando…" : "Tentar de novo"}
                    </Button>
                  </div>
                ) : ocQueryData === null ? "OC não encontrada." : "Carregando…"}
              </div>
            )}

            <OcImpCabecalho
              draft={draft} setDraft={setDraft} empresas={empresas} numeroOc={numeroReal} numeroPrevia={numeroPreviaOc} isEdit={isEdit}
            />

            {/* ── 3 · Produtos da OC (acordeão) ── */}
            <section id="ocimp-sec-produtos" className="scroll-mt-2 space-y-4">
              <OcSecTitle
                n={3}
                right={
                  <div className="flex items-center gap-2">
                    {!isEdit && (
                      <Button type="button" variant="outline" size="sm" onClick={adicionarAvulso}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Item avulso
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" disabled={todosRecebidos} onClick={() => setPickerOpen(true)}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar produto
                    </Button>
                  </div>
                }
              >
                Produtos da OC
              </OcSecTitle>
              <p className="text-xs text-muted-foreground">
                Cada produto é recebido, conferido (CQ) e direcionado separadamente. Enquanto a OC está encomendada dá para adicionar produtos
                (mesmo fornecedor, mesma moeda, sem OC) e tirar os ainda não recebidos.
              </p>
              {items.length === 0 && (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhum produto ainda — use “Adicionar produto”.</p>
              )}
              {items.map((it) => {
                const recebido = it.status === "recebido";
                const tams = tamanhosDoItem(it);
                const motivoReceber = motivoNaoReceber(it, tams) ?? (!requerRecebimento.ok ? requerRecebimento.motivo : temConflito ? "Resolva os conflitos antes de receber." : null);
                return (
                  <OcItemAcordeao
                    key={it.tempId}
                    id={`ocimp-item-${it.tempId}`}
                    aberto={abertos.has(it.tempId)}
                    onToggle={() => alternar(it.tempId)}
                    emConflito={itemEmConflito(it)}
                    thumb={<Thumb path={it.fotoPath} alt={it.nome_produto} />}
                    titulo={it.nome_produto || "Produto sem nome"}
                    subtitulo={subtituloItem(it)}
                    selos={
                      <>
                        {itemEmConflito(it) && <StatusBadge tone="danger">Conflito</StatusBadge>}
                        {!it.id ? <StatusBadge tone="info">Novo</StatusBadge>
                          : recebido ? <StatusBadge tone="success">Recebido{it.data_entrega ? ` em ${fmtDate(it.data_entrega)}` : ""}</StatusBadge>
                          : <StatusBadge tone="warning">Aguardando</StatusBadge>}
                      </>
                    }
                  >
                    <OcImpItem
                      item={it}
                      onItemChange={mudarItem(it.tempId)}
                      grupos={grupos as Opt[]} categorias={categorias as CatOpt[]} subcats1={subcats1 as SubOpt[]} subcats2={subcats2 as SubOpt[]}
                      cores={cores as Opt[]} coresApelido={coresApelido as CorApelidoOpt[]} tamanhos={tamanhos} colaboradores={colaboradores}
                      moedaCompra={draft.moeda_compra} moedaIntermediaria={draft.moeda_intermediaria} cotacaoRef={draft.cotacao_ref}
                      isEdit={isEdit}
                      motivoNaoTira={it.id ? motivoNaoTirar(it, nItens) : null}
                      onTirar={() => tirarProduto(it)}
                      motivoNaoRecebe={motivoReceber}
                      onReceber={() => receberProduto(it)}
                      recebendo={pendente}
                    />
                  </OcItemAcordeao>
                );
              })}
              {!isEdit && (
                <div className="flex items-start gap-2 rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] p-3 text-sm text-[var(--tone-warning-fg)]">
                  <span>O <b>Recebimento</b> de cada produto fica disponível depois de salvar a OC (salvou → reabra e registre a chegada).</span>
                </div>
              )}
            </section>

            <OcImpTotais draft={draft} setDraft={setDraft} itens={items} landedUnitarioOc={landedOc} />
            <OcImpAnexos draft={draft} setDraft={setDraft} onUpload={handleUpload} />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 border-t bg-background -mx-6 -mb-6 px-6 py-3 max-md:-mx-4 max-md:-mb-4 max-md:px-4 max-md:shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <Button variant="outline" onClick={onClose} aria-label="Voltar">
            <ArrowLeft className="h-4 w-4 md:mr-1" />
            <span className="max-md:sr-only">Voltar</span>
          </Button>
          <Button variant="outline" onClick={() => printWithImages()} aria-label="Imprimir pedido">
            <Printer className="h-4 w-4 md:mr-1" />
            <span className="max-md:sr-only">Imprimir</span>
          </Button>
          {isEdit && status === "encomendado" && (
            <>
              <Button
                variant="destructive"
                aria-label="Excluir"
                disabled={!!motivoNaoExcluir}
                title={motivoNaoExcluir ?? undefined}
                onClick={() => onDelete({
                  id: ocId!, numero: numeroReal, empresa_id: draft.empresa_id, data_pedido: draft.data_pedido, data_prevista: draft.data_prevista,
                  data_entrega: dataEntregaOc, qtd_total: totais.pecas, valor_total_desconto: totais.total, moeda_compra: draft.moeda_compra, status,
                  itens: items.filter((i) => i.id).map((i, k) => ({ id: i.id as string, ordem: k + 1, nome_produto: i.nome_produto, status: i.status })),
                })}
              >
                <Trash2 className="h-4 w-4 md:mr-1" />
                <span className="max-md:sr-only">Excluir</span>
              </Button>
              {motivoNaoExcluir && <span className="text-xs text-muted-foreground max-md:hidden">{motivoNaoExcluir}</span>}
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={() => disparar({ tipo: "salvar" })} disabled={pendente || temConflito || !hidratado} title={temConflito ? "Resolva os conflitos antes de salvar" : undefined}>
              <Check className="h-4 w-4 mr-1" />
              Salvar
            </Button>
          </div>
        </div>
        <OcDocumentoPrint modelo={docModelo} />
      </OcModalShell>

      <ProdutoImportadoPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onAdicionar={adicionarProdutos}
        empresaId={draft.empresa_id}
        empresaNome={empresaSel?.nome_fantasia ?? null}
        numeroOc={numeroReal}
        excluirIds={items.map((i) => i.produto_importado_id).filter((x): x is string => !!x)}
        moedaDaOc={moedaDaOc}
      />
      {dialogConfirmacao}
    </>
  );
}

// grupo/categoria são gerenciados no Cadastro; sem staleTime = refetch no mount (um item recém-criado aparece no dropdown).
function useOpt(table: string) {
  return useQuery({
    queryKey: ["opt-ocimp", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; nome: string }[];
    },
  });
}
function useOptCat(table: string, fk: string) {
  return useQuery({
    queryKey: ["opt-ocimp-cat", table, fk],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, nome, ${fk}`).order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
