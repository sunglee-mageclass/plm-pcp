// Detalhe (Sheet/Dialog) do card do Planejamento — extraído (refactor 2026-08-25) da
// função privada `ModeloDialog` da rota `criacao.planejamento.tsx`, renomeada p/
// `PlanejamentoDetail` e exportada. Comportamento IDÊNTICO ao anterior — código MOVIDO,
// sem alteração de campo/query/guarda. Única adição: a prop `contexto` (default
// "planejamento") que muda os 2 pontos de navegação p/ o Produto Acabado (ver abaixo),
// pra o detalhe poder ser reusado inline dentro do planejador Produto Acabado (Task 2 da
// spec) sem "sair" da tela em que já está.
//
// O componente é AUTOSSUFICIENTE quanto às 7 listas de opção: chama
// `usePlanejamentoOpts()` internamente (o caller passa só modeloId/onClose/onSaved/contexto).
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Copy, ArrowLeft, Save, Pencil } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { pathDoElemento } from "@/lib/colab/colab-field-path";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeDraft, type Conflito } from "@/lib/colab/merge";
import { useAuth } from "@/hooks/useAuth";
import { ObsMaoObraField } from "@/components/shared/ObsMaoObraField";
import { MaoObraEditor, type MaoObraEditorLinha } from "@/components/planejamento/MaoObraEditor";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";
import { estadoMO, moLinhasEqual, type MoLinha } from "@/lib/mao-obra";
import { DateField } from "@/components/shared/DateField";
import { precoInfo, custoSimulado, moPorFaixa, statusMoFaixa, type CustoSimInput } from "@/lib/preco";
import { cqLiberado } from "@/lib/cq-status";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useGridCols } from "@/hooks/useGridCols";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { useTenantModules } from "@/hooks/useTenantModules";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { ProdutoRelacionadoSetor } from "@/components/planejamento/ProdutoRelacionadoSetor";
import { useOrcamento, orcLabel } from "@/components/otb/orcamento";
import { ehOrigemComprada } from "@/lib/origem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { ModeloDetailPanel } from "@/components/desenvolvimento/ModeloDetailPanel";

import { usePlanejamentoOpts } from "@/hooks/usePlanejamentoOpts";
import {
  uploadFile,
  numOr0,
  emptyDraft, draftFromModeloRow,
  type ArtigoOpt, type SubOpt, type Draft,
} from "@/components/planejamento/modelo-shared";
import {
  Secao, MultiArtigosField, FieldText, FieldSelect, PhotoList, SingleFileField,
  type EstoqueArtigo,
} from "@/components/planejamento/planejamento-detail/campos";
import { PrecoTabela } from "@/components/planejamento/planejamento-detail/PrecoTabela";
import { rotuloConflitoPlan, invalidarAposAprovarMO, camposParaDuplicar } from "@/components/planejamento/planejamento-detail/helpers";
import { InfoGeraisSecao } from "@/components/planejamento/planejamento-detail/InfoGeraisSecao";
import { useRevendaPlanejamento } from "@/components/planejamento/planejamento-detail/useRevendaPlanejamento";
import { PrecoRevendaBloco, ProdutoAcabadoSecao, GradeRevendaSecao } from "@/components/planejamento/planejamento-detail/RevendaSetores";
import { usePlanejamentoSave } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";
import { useFichaKanban } from "@/components/planejamento/planejamento-detail/ficha/useFichaKanban";
import { DevEquipeSection } from "@/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection";
import { MotivoCancelamento } from "@/components/planejamento/planejamento-detail/ficha/secoes/MotivoCancelamento";
import { AvisoCamposDev, type MotivoTravaDev } from "@/components/planejamento/planejamento-detail/ficha/secoes/AvisoCamposDev";
import { revendaCampoVisivel } from "@/lib/revenda-config";
import { AnexosDevCampos } from "@/components/planejamento/planejamento-detail/ficha/secoes/AnexosDevCampos";
// Reuso DIRETO (sem modificar — decisão travada 8): fio de comentários da Prova e bloco de Observações do Dev.
import { ModeloAjustesProvaSection } from "@/components/desenvolvimento/modelo-detail/ModeloAjustesProvaSection";
import { ModeloObservacoes } from "@/components/shared/ModeloObservacoes";
// API pública mantida: a rota `criacao.planejamento.tsx` importa FieldText/FieldSelect DAQUI.
export { FieldText, FieldSelect } from "@/components/planejamento/planejamento-detail/campos";

/* ============ DETALHE (Sheet/Dialog) ============ */

// API pública INALTERADA: `{ modeloId, onClose, onSaved, contexto? }`. Fix do bug do card NOVO (F3.1; R15 da
// F3.0): no 1º Salvar do Dialog "Novo Modelo" o card ganha id e o detalhe REMONTA (key nova) como o Sheet desse
// id — estado limpo, semeado do servidor como qualquer card existente, já com as seções do Dev. Antes o Dialog
// ficava aberto sem id e um 2º Salvar INSERIA de novo (card duplicado). Fica AQUI, não na rota, p/ valer em
// todo caller sem mexer em `criacao.planejamento.tsx` (arquivo da F2). Bônus: se o caller trocar `modeloId`
// sem desmontar, o detalhe remonta em vez de mesclar o card novo no rascunho do anterior.
export function PlanejamentoDetail(props: {
  modeloId: string | null;
  onClose: () => void;
  onSaved: () => void;
  contexto?: "planejamento" | "produto-acabado";
}) {
  const [idCriado, setIdCriado] = useState<string | null>(null);
  const id = props.modeloId ?? idCriado;
  return <PlanejamentoDetailConteudo key={id ?? "novo"} {...props} modeloId={id} onCreated={setIdCriado} />;
}

function PlanejamentoDetailConteudo({
  modeloId, onClose, onSaved, contexto = "planejamento", onCreated,
}: {
  modeloId: string | null;
  onClose: () => void;
  onSaved: () => void;
  contexto?: "planejamento" | "produto-acabado";
  /** Card NOVO: chamado com o id depois do INSERT (o wrapper remonta como Sheet desse id). */
  onCreated?: (id: string) => void;
}) {
  // As 7 listas de opção vêm do hook (cache compartilhado com a página, sem refetch duplo).
  // `artigos` do hook traz a forma completa (com categoria_tecido_id/categorias_tecido, campos
  // que este detalhe não usa) — o antigo `ModeloDialog` recebia `ArtigoOpt[]` na prop, então
  // tratamos igual aqui (ArtigoOpt é subconjunto estrutural; cast preserva o comportamento).
  const { estilistas, linhas, meses, anos, grupos, categorias, artigos: artigosFull } = usePlanejamentoOpts();
  const artigos = artigosFull as ArtigoOpt[];

  const isEdit = !!modeloId;
  const qc = useQueryClient();
  const fl = useFieldLabels();
  const { canView, canEdit } = useAuth();
  const podeVerCustos = canView("criacao_planejamento:custos");
  const podeEditarCustos = canEdit("criacao_planejamento:custos");
  // Permissão à parte SÓ p/ editar o preço de venda (banco enforça via trigger fn_modelo_preco_venda_gate).
  // VER o preço segue sob podeVerCustos; editar o preço passa a exigir esta section.
  const podeEditarPreco = canEdit("criacao_planejamento:preco_venda");
  const podeAprovarMaoObra = canEdit("producao_servico_aprovacao");
  // F3.1 — campos vindos do Desenvolvimento (decisão F3 #8): EDITAR exige canEdit da página do Dev; sem ela o
  // Salvar OMITE esses campos (`aplicarRegrasCamposDev`). VER (canView) entra com as seções (Task 5).
  const podeEditarDev = canEdit("criacao_desenvolvimento");
  const podeVerDev = canView("criacao_desenvolvimento");

  // Colab (spec 2026-08-03, Task 2): o queryFn agora só BUSCA (sem side-effects de setState —
  // roda em TODO refetch, não só na 1ª carga). Seed/merge acontecem no useEffect mais abaixo.
  // F3.1: SUBIU para cá (antes vinha logo antes do merge) — a trava dos campos do Dev, logo abaixo, lê
  // `enviado_cad`, e a F3.2 passa essa trava ao `useFichaTecnica`, chamado ANTES do cálculo de preço e do
  // "não salvo". Mesma queryKey, mesmo queryFn; só a posição (e a ordem dos hooks) mudou.
  const { data: modeloData } = useQuery({
    queryKey: ["modelo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.from("modelos").select("*").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  // ── F3.1 — trava dos campos vindos do Desenvolvimento ──────────────────────────────────────────────
  // Pós-Explosão (decisão F3 #1): SÓ nas seções vindas do Dev (Info Gerais/Coleção/Preço/MO/Lançamento seguem
  // livres). "Editar" destrava; Salvar re-trava (paridade com o Dev, ModeloDetailPanel.tsx:1600, :2273,
  // :3191-3194). Sem canEdit do Dev = sempre só-leitura (decisão F3 #8). É a trava ÚNICA da campanha: a F3.2
  // deriva dela a trava do BOM (`motivoTravaDev` → `useFichaTecnica`).
  const enviadoCad = !!(modeloData as any)?.enviado_cad;
  const [editandoDev, setEditandoDev] = useState(false);
  const devBloqueado = !podeEditarDev || (enviadoCad && !editandoDev);
  const motivoTravaDev: MotivoTravaDev = !podeEditarDev ? "sem_permissao" : enviadoCad && !editandoDev ? "enviado" : null;
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  // MO por serviço (spec 2026-08-06): rascunho LOCAL das linhas (VALOR editável) — fora do
  // `draft` principal; persiste no Salvar da página via RPC `salvar_modelo_servico_mo`. O
  // baseline (`moLinhasBase`) é o estado do servidor semeado do resumo; a divergência acende
  // o indicador de "não salvo". Refs p/ leitura síncrona (seed guardada + save mutationFn).
  const [moLinhas, setMoLinhas] = useState<MaoObraEditorLinha[]>([]);
  const [moLinhasBase, setMoLinhasBase] = useState<MaoObraEditorLinha[]>([]);
  const moLinhasRef = useRef(moLinhas); moLinhasRef.current = moLinhas;
  const moBaseRef = useRef(moLinhasBase); moBaseRef.current = moLinhasBase;
  // Serviços de M.O. JÁ PERSISTIDOS (baseline do servidor) — aprovar/reprovar (RPC imediata) só
  // vale nesses; linha recém-adicionada (só no rascunho) pede Salvar antes (senão "linha não
  // encontrada"). Deriva do baseline, não de `moLinhas`, pra uma linha nova não se auto-habilitar.
  const moLinhasPersistidas = useMemo(
    // Ids das linhas JÁ salvas no banco (multi-instância: aprovar é por id). Linha nova (sem id) fica de fora.
    () => new Set(moLinhasBase.map((l) => l.id).filter((x): x is string => !!x)),
    [moLinhasBase],
  );
  const { dirty: draftDirty, markClean, reset: resetDraftBaseline } = useDirtySnapshot(draft);
  // Grupo é transiente (não é coluna do modelo) — filtra as Categorias na cascata.
  const [grupoSel, setGrupoSel] = useState<string | null>(null);

  // Colab (spec 2026-08-03, Task 2 — adoção Plan. Produto; mesmo padrão do piloto OC Tecido
  // e da adoção do Desenvolvimento). Contrato desta tela: UPDATE DIRETO em `modelos` com
  // `.eq("rev", revBase)` — 0 linhas devolvidas = conflito (P0409 sintético).
  // touchedRef: campos ESCALARES do draft que EU editei (diff via setDraftTracked).
  // baseRef/revRef: último "fresh" visto do servidor e o rev otimista da linha.
  const touchedRef = useRef<Set<string>>(new Set());
  const baseRef = useRef<{ draft: Draft } | null>(null);
  const revRef = useRef<number | null>(null);
  const retryRef = useRef(false);
  // Guarda anti-duplo-clique do save — ref SÍNCRONO (isPending só atualiza no re-render).
  const savingRef = useRef(false);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  // Espelho síncrono de `conflitos` p/ o retry do save (roda fora do ciclo de render).
  const conflitosRef = useRef<Conflito[]>([]);
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  const [campoFocado, setCampoFocado] = useState<string | null>(null);
  // Scope do ring de presença auto-instrumentado (cobre todos os campos do sheet — set/2026).
  const colabScopeRef = useRef<HTMLDivElement>(null);
  // Espelho SEMPRE atualizado de `draft` p/ o merge síncrono dentro do onError do save (roda
  // depois de um `await` — nenhuma tecla digitada nessa janela pode se perder; mesma técnica
  // do piloto/Desenvolvimento).
  const draftLiveRef = useRef(draft);
  draftLiveRef.current = draft;

  // Wrapper que DIFERE prev→next e marca o que mudou — os filhos continuam recebendo a mesma
  // assinatura de `setDraft` (mesma técnica do piloto OC Tecido/Desenvolvimento).
  const setDraftTracked: typeof setDraft = (upd) =>
    setDraft((prev) => {
      const next = typeof upd === "function" ? (upd as (p: Draft) => Draft)(prev) : upd;
      for (const k of Object.keys(next) as (keyof Draft)[])
        if (next[k] !== prev[k]) touchedRef.current.add(String(k));
      return next;
    });
  const [confirmDel, setConfirmDel] = useState(false);
  // "Ver no Desenvolvimento" (setor Preço, §K) — abre o ModeloDetailPanel INLINE por cima
  // deste card (sem navegar), mesmo padrão sheet-sobre-sheet do ProdutoAcabadoSheet.
  const [verDevModeloId, setVerDevModeloId] = useState<string | null>(null);
  const { isModuleEnabled } = useTenantModules();
  const otbOn = isModuleEnabled("otb");
  // Revenda (Produto Acabado, Task 7): card revenda ganha campo de preço atacado + grade
  // cor×tamanho + atalhos pro planejador Produto Acabado — só quando o módulo está ligado.
  const paOn = isModuleEnabled("produto_acabado");
  // isRevenda = ESPECÍFICO de revenda (edição de preço atacado/grade via `produtos_acabados`).
  // isComprado = revenda OU importado — a semântica "comprado vs fabricado" (esconder tecido/
  // custo/MO). Importado tem tela própria de edição (`criacao.produto-importado`), então aqui
  // só herda o ESCONDER; nunca entra nos blocos de edição de revenda (`produtos_acabados`).
  const isRevenda = draft.origem === "revenda";
  const isComprado = ehOrigemComprada(draft.origem);
  const navigate = useNavigate();
  const orc = useOrcamento();
  const { data: colecoes = [] } = useQuery({
    queryKey: ["otb-colecoes-opts"],
    enabled: otbOn,
    queryFn: async () => {
      const { data } = await supabase.from("colecoes").select("id, nome, mes_id, ano_id").order("nome");
      return (data ?? []) as { id: string; nome: string; mes_id: string | null; ano_id: string | null }[];
    },
  });
  // Subcoleções da coleção escolhida — viram o dropdown de Subcoleção (OTB ligado).
  const { data: subcolecoesOpts = [] } = useQuery({
    queryKey: ["subcolecoes-opts", draft.colecao_id],
    enabled: otbOn && !!draft.colecao_id,
    queryFn: async () => {
      const { data } = await supabase.from("colecao_subcolecoes").select("nome").eq("colecao_id", draft.colecao_id!).order("ordem");
      return (data ?? []).map((r: any) => r.nome as string);
    },
  });

  // Estoque por artigo (físico/disponível) para mostrar ao selecionar o tecido.
  const { data: estoqueArr = [] } = useQuery({
    queryKey: ["estoque-tecido-por-artigo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("estoque_tecido_por_artigo" as any);
      if (error) throw error;
      return (data ?? []) as Array<{ artigo_id: string; fisico_m: number; reservado_m: number; disponivel_m: number }>;
    },
  });
  const estoqueMap = useMemo(
    () => Object.fromEntries(estoqueArr.map((e) => [e.artigo_id, e])),
    [estoqueArr],
  ) as Record<string, EstoqueArtigo>;

  // Subcategorias 1 e 2 (filhas da Categoria) — Setor "Informações Gerais".
  const { data: sub1Opts = [] } = useQuery({
    queryKey: ["opt", "subcategorias1_produto"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias1_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as SubOpt[];
    },
  });
  const { data: sub2Opts = [] } = useQuery({
    queryKey: ["opt", "subcategorias2_produto"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias2_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as SubOpt[];
    },
  });

  // Custo total unitário do modelo (real de Serviços senão previsto de Desenvolvimento).
  const { data: custoData } = useQuery({
    queryKey: ["plan-custo-unit", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data ?? {}) as any)[modeloId as string] as { previsto: number; real: number; confirmado: boolean } | undefined;
    },
  });

  // Categorias de serviço ATIVAS — dropdown "Adicionar serviço" do editor de MO (linhas
  // históricas de categoria já desativada seguem visíveis como linhas, mas não no dropdown).
  const { data: catsServico = [] } = useQuery({
    queryKey: ["cats-servico-ativas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categorias_terceirizado")
        .select("id, nome, ativo, valor_padrao").order("ordem").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; ativo: boolean; valor_padrao: number | null }[];
    },
  });
  // Resumo da MO por serviço (RPC mascara valor/total p/ quem não vê custos; {} p/ quem não vê
  // nem aprova). Semeia `moLinhas` (VALORES + estado por linha) e o gate do botão Lançar.
  const { data: moResumo } = useQuery({
    queryKey: ["mo-resumo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data as any)?.[modeloId] ?? null) as
        { estado: string; total: number | null; total_aprovado: number | null; linhas: (MoLinha & { valor: number | null })[] } | null;
    },
  });

  // Consumo real do BOM (Desenvolvimento/CAD) por artigo — alimenta o pré-preenchimento
  // do consumo na Simulação de custo quando o modelo já avançou.
  const { data: bomTecidos = [] } = useQuery({
    queryKey: ["modelo-tecidos-consumo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecidos")
        .select("artigo_id, consumo")
        .eq("modelo_id", modeloId as string)
        .eq("tipo", "tecido");
      if (error) throw error;
      return (data ?? []) as { artigo_id: string | null; consumo: number | null }[];
    },
  });

  // Cálculo de preço (Setor "Preço") — mesma lógica usada na lista e nos Lançamentos.
  const custoReal = !!custoData?.confirmado;
  const { custo, markupLinha: markup, preco, sugerido: precoSug, efetivo: precoEfetivo, markupReal } =
    precoInfo(custoData?.real, linhas.find((l) => l.id === draft.linha_id)?.markup, draft.preco_venda, draft.markup_editado);

  // Composição do custo — MESMA régua do card da lista (criacao.planejamento.tsx:548-567).
  //  • maoObraPlanejada = SEMPRE a M.O. PLANEJADA (Σ modelo_servico_mo = mao_obra_previsto). É o que
  //    o produto REALMENTE tem de M.O.; usada na exibição "M.O. real" da Fase B e no semáforo.
  //    NUNCA mao_obra_real — essa é só serviço EXTERNO ÷ grade e fica 0 quando a M.O. é toda INTERNA
  //    (modelo confirmado), fazendo a M.O. "sumir" (R$ 0,00) apesar de existir — o bug que o dono
  //    pegou no bloco "M.O. que cabe". Ver memória project_custo_calculo_bugs.
  //  • maoObraSetor = a M.O. EMBUTIDA no `.real` (confirmado → mao_obra_real; senão a prevista). Só
  //    esta fecha a soma Materiais + M.O. = Custo total exibido na tabela de Preço (por isso segue aqui).
  const maoObraSetor = Number(custoReal ? (custoData as any)?.mao_obra_real : (custoData as any)?.mao_obra_previsto) || 0;
  // M.O. planejada AO VIVO = Σ do rascunho `moLinhas` (o que se digitou agora, antes de salvar);
  // fallback pro valor salvo do banco (`mao_obra_previsto`) quando o rascunho não tem valores
  // visíveis (só-aprovador mascarado) ou ainda não semeou. Faz a Parte 3 (faixas) e as Obs da M.O.
  // reagirem à edição sem exigir 2 saves (pedido do dono set/2026). 0 é valor válido → `!= null`.
  const maoObraDevLive = moLinhas.some((l) => l.valor != null)
    ? moLinhas.reduce((s, l) => s + (Number(l.valor) || 0), 0)
    : Number((custoData as any)?.mao_obra_previsto) || 0;
  const maoObraPlanejada = maoObraDevLive;
  const materiaisSetor = custo > 0 ? custo - maoObraSetor : 0;
  const linhaSetor = linhas.find((l) => l.id === draft.linha_id) ?? null;
  // Faixas de markup da Linha (Fase A — só leitura no Sheet). Ideal = `markup`.
  const linhaFaixas = linhaSetor
    ? { min: linhaSetor.markup_min, ideal: linhaSetor.markup, max: linhaSetor.markup_max }
    : null;

  // Custo ESTIMADO (alimenta a seção Preço enquanto o BOM não confirma — a antiga "Simulação de
  // custo" foi absorvida ali, set/2026). Definido AQUI (antes das faixas) porque o materiais das
  // faixas, no modo estimado, sai daqui. Tecido: preço/m = o TECIDO PLANEJADO MAIS CARO (auto do
  // cadastro); consumo = override do usuário (`custo_simulado.consumo_tecido`), senão o consumo
  // REAL do BOM (editável na tabela Preço). Aviamento = manual (`custo_simulado.aviamento`, vira o
  // "Materiais" estimado). M.O. = `maoObraDevLive` (Σ do rascunho, ao vivo). `simCalc.total` =
  // tecido + aviamento + M.O. = o "Custo total" estimado exibido na tabela.
  const tecidoMaisCaro = draft.tecidos_planejados
    .map((id) => artigos.find((a) => a.id === id))
    .filter((a): a is ArtigoOpt => !!a)
    .reduce<ArtigoOpt | null>((best, a) => ((Number(a.preco_por_metro) || 0) > (Number(best?.preco_por_metro) || 0) ? a : best), null);
  const precoTecidoM = Number(tecidoMaisCaro?.preco_por_metro) || 0;
  const consumoRealBOM = tecidoMaisCaro
    ? Number(bomTecidos.find((t) => t.artigo_id === tecidoMaisCaro.id)?.consumo) || 0
    : 0;
  const consumoOverride = draft.custo_simulado.consumo_tecido ?? null;
  const consumoUsado = consumoOverride ?? consumoRealBOM;
  const maoObraUsado = maoObraDevLive > 0 ? maoObraDevLive : null;
  const simCalc = custoSimulado({
    consumo_tecido: consumoUsado,
    preco_tecido_m: precoTecidoM,
    aviamento: draft.custo_simulado.aviamento,
    mao_obra: maoObraUsado,
  });

  // Fase B — M.O. que ainda CABE por faixa = precoBase/markup − materiais. Responde "quanto posso
  // pagar de mão de obra?". BASE = preço EFETIVO (`precoInfo.efetivo`): o preço de venda digitado
  // se houver, SENÃO o sugerido (custo×markup). Decisão do dono (set/2026): a coluna Preço de
  // venda já promete "vazio usa o sugerido" — a M.O. por faixa tem que HONRAR isso e calcular na
  // mesma base, senão fica "—" à toa. (Substitui a decisão antiga de usar só o digitado.) `preco
  // Digitado` fica só p/ a Obs distinguir "usando o sugerido" de "usando o seu preço". Se a base
  // é 0 (sem custo/markup) OU a faixa não tem markup cadastrado, `moPorFaixa` devolve inatingível.
  // MATERIAIS da faixa = tudo que não é M.O.: no REAL, `materiaisSetor` (custo−M.O. embutida); no
  // ESTIMADO, `simCalc.total − M.O.` (= tecido+aviamento AO VIVO) — assim a Parte 3 reage a editar
  // aviamento/consumo/M.O. sem salvar (P4, set/2026), em vez de ficar presa no 0 do custo real.
  const precoVendaDigitado = Number(draft.preco_venda) > 0 ? Number(draft.preco_venda) : 0;
  const precoBaseMO = precoEfetivo;
  const materiaisParaFaixa = custoReal ? materiaisSetor : Math.max(0, simCalc.total - maoObraDevLive);
  const moMin = moPorFaixa(precoBaseMO, materiaisParaFaixa, linhaFaixas?.min);
  const moIdeal = moPorFaixa(precoBaseMO, materiaisParaFaixa, linhaFaixas?.ideal);
  const moMax = moPorFaixa(precoBaseMO, materiaisParaFaixa, linhaFaixas?.max);
  // Semáforo da M.O. planejada contra os tetos das faixas — 4 estados (até que faixa de markup a
  // M.O. cabe). Compara a M.O. PLANEJADA (o que o produto tem), NÃO a embutida no real (que zera
  // com M.O. interna e daria "0" enganoso).
  const moStatusFaixa = statusMoFaixa(
    maoObraPlanejada,
    moMin.atingivel, moMin.moMax,
    moIdeal.atingivel, moIdeal.moMax,
    moMax.atingivel, moMax.moMax,
  );
  // Custo previsto (p/ o histórico "antes (previsto)" quando o real assume). Só mostra quando o
  // real diverge do previsto (senão é ruído).
  const custoPrevisto = Number(custoData?.previsto) || 0;

  // Preço ATACADO (revenda, Task 7): mesma função `precoInfo` (intocada), mas com a base
  // sempre em "previsto" — o custo_unitario_modelos.previsto já traz insumos+desconto p/
  // revenda (Task 4) e fica disponível MESMO antes da OC ser recebida (ao contrário de
  // `.real`, que fica null até `oc.status='recebido'` — ver _custo_unitario_modelos_core).
  const custoPrevistoRevenda = Number(custoData?.previsto) || 0;
  // Base do MARKUP de revenda (set/2026): custo material + M.O. (Σ modelo_servico_mo, ao vivo).
  // Espelha o banco (`_pa_recomputar_precos_modelo` soma a MO em v_custo). `custoData.previsto`
  // NÃO inclui a MO (mantém a separação materiais×MO); a MO entra AQUI, só p/ a base do markup.
  const baseRevendaMarkup = custoPrevistoRevenda + (maoObraDevLive || 0);
  // Integridade dos 4 campos de topo (Custo→Preço→Sugerido) da REVENDA (set/2026, pedido do dono):
  // reusa `precoInfo` com a BASE de revenda (previsto+MO, sempre disponível) em vez de `custoData.real`
  // (que fica null até a OC chegar). Cadeia: custo = base; preço = custo × markup da linha; sugerido =
  // arredonda do preço; efetivo = preço de venda se houver, senão o sugerido. Só ilustrativo/read-only
  // — os markups atacado/varejo digitáveis abaixo é que gravam (via a RPC de markup).
  const piRevenda = precoInfo(
    baseRevendaMarkup,
    linhas.find((l) => l.id === draft.linha_id)?.markup,
    draft.preco_venda,
    draft.markup_editado,
  );

  const tenantIdAtivo = useActiveTenantId();
  // Toggle opt-in (Config da Loja): mostra os 2 blocos de análise de markup por faixa. Default OFF.
  // Reflete no próximo refetch/reabrir do Sheet (config muda raro). Ver [[project_markup_min_ideal_max]].
  const { data: markupFaixaOn = false } = useQuery({
    queryKey: ["tenant-config-markup-analise", tenantIdAtivo],
    enabled: !!tenantIdAtivo,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("markup_analise_faixa").eq("tenant_id", tenantIdAtivo).maybeSingle();
      return !!data?.markup_analise_faixa;
    },
  });
  // Revenda (Produto Acabado): estado, queries e mutations extraídos na F3.0 para
  // `planejamento-detail/useRevendaPlanejamento.ts` (texto movido). Chamado AQUI — antes dos effects
  // de seed de MO e de merge do colab, como antes (o seed da grade lê `revRef.current`).
  const revenda = useRevendaPlanejamento({
    modeloId, isEdit, isRevenda, paOn, draft, baseRevendaMarkup, grupos, categorias,
    tenantIdAtivo, revRef, qc, navigate, contexto, onClose,
  });
  const {
    gradeRevenda, setGradeRevenda, gradeRevendaBaseRef, gradeRevendaRevRef, gradeRevendaDirty,
    produtoRevenda, buildLinhasGradeRevenda,
  } = revenda;
  // Dirty combinado: draft OU linhas de MO OU grade revenda divergem do baseline (mantidos em
  // baselines INDEPENDENTES — cada um re-semeia no seu próprio momento, sem corrida de ordem
  // entre os carregamentos assíncronos).
  const dirty = draftDirty || !moLinhasEqual(moLinhas, moLinhasBase) || gradeRevendaDirty;
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });
  const setSim = (patch: Partial<CustoSimInput>) =>
    setDraftTracked((d) => ({ ...d, custo_simulado: { ...d.custo_simulado, ...patch } }));

  // Preço para venda é PLACEHOLDER (mostra o sugerido); só vira valor real se o usuário
  // digitar. Não auto-preenche o draft (isso causava o flip-flop preenchido↔placeholder).
  // O preço efetivo já cai no sugerido via precoInfo quando o campo está vazio.

  // "Ordem de Criação enviada" = gate p/ o Desenvolvimento (botão, não mais o status).
  const [enviada, setEnviada] = useState(false);
  // "Lançado" = gate p/ Lançamentos (botão, após CAD + CQ confirmado).
  const [lancado, setLancado] = useState(false);

  // CAD + status do CQ do modelo — habilita a Data de Lançamento / botão Lançar.
  const { data: cqInfo } = useQuery({
    queryKey: ["plan-cq", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cad")
        .select("id, controle_qualidade(status, status_pos), producao_terceirizados(ativo, categorias_terceirizado(etapa))")
        .eq("modelo_id", modeloId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  // Lançar exige Pré confirmado E (se há serviço pós-costura) Pós confirmado — mesmo
  // gate do Direcionamento (predicado único em @/lib/cq-status).
  const cqConfirmado = cqLiberado(cqInfo as any);

  // MO por serviço (spec 2026-08-06): semeia `moLinhas` do resumo do servidor. GUARDADA — se o
  // usuário tem edições locais de VALOR não salvas (moLinhas ≠ moLinhasBase), um refetch em
  // background (foco de janela / invalidação pós-aprovação) NÃO sobrescreve o rascunho; só
  // (re)semeia quando o rascunho de MO está limpo. Mesma proteção do merge do draft colab.
  useEffect(() => {
    if (!moResumo) return;
    const seed = (moResumo.linhas ?? []).map((l) => ({
      id: (l as any).id ?? null,
      categoria_terceirizado_id: l.categoria_terceirizado_id ?? null,
      nome: l.nome, valor: l.valor ?? null, aprovado: l.aprovado ?? null, motivo_reprovacao: l.motivo_reprovacao ?? null,
    })) as MaoObraEditorLinha[];
    if (!moLinhasEqual(moLinhasRef.current, moBaseRef.current)) return; // preserva edições não salvas
    setMoLinhas(seed); setMoLinhasBase(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moResumo]);

  // Gate do botão Lançar: liberada = sem serviço OU todas as linhas aprovadas. Derivado das
  // linhas LOCAIS (`estadoMO`) — reflete aprovações imediatas sem esperar o refetch do resumo.
  const moEstadoLocal = estadoMO(moLinhas);
  const maoObraPendente = !(moEstadoLocal === "sem_servico" || moEstadoLocal === "aprovada");

  // Aprovar/reprovar POR SERVIÇO (RPC `aprovar_servico_mo`, gated no servidor por
  // `producao_servico_aprovacao`). Ação imediata (não entra no Salvar da página). Patch LOCAL
  // das linhas (preserva os VALORES não salvos; atualiza aprovado/motivo) + re-sync da rev do
  // colab (o rollup no banco bumpa `modelos.rev` — sem re-hidratar `revRef`, o próximo Salvar
  // do card daria P0409 falso).
  const aprovarServicoMO = useMutation({
    mutationFn: async ({ linhaId, aprovado, motivo }: { linhaId: string; aprovado: boolean; motivo?: string }) => {
      const { error } = await supabase.rpc("aprovar_servico_mo" as any, {
        _modelo_id: modeloId, _linha_id: linhaId, _aprovado: aprovado, _motivo: motivo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.aprovado ? "Mão de obra aprovada." : "Mão de obra reprovada.");
      const patch = (ls: MaoObraEditorLinha[]) => ls.map((l) =>
        l.id === vars.linhaId
          ? { ...l, aprovado: vars.aprovado, motivo_reprovacao: vars.aprovado ? null : (vars.motivo ?? null) }
          : l);
      setMoLinhas(patch); setMoLinhasBase(patch);
      // Invalidations compartilhadas c/ a mutation da lista (`aprovarServicoMOLista`, spec
      // 2026-08-11 Task 2) — mesma função, não duplicar a lista de queryKeys.
      invalidarAposAprovarMO(qc, modeloId!);
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Não foi possível atualizar a mão de obra.")),
  });

  // ── F3.1 — etapa do kanban + campos vindos do Desenvolvimento ──────────────────────────────────────
  // Etapa do kanban (estado SALVO) + config da loja: coluna efetiva, gate do campo REF (refCampoVisivel, com
  // a posição DERIVADA quando a chave está ligada — decisão 10) e Reprovado (Motivo do Cancelamento).
  const kanbanCard = useFichaKanban({ modeloId, modeloData, enviada, lancado });
  // REF editável = a seção "Desenvolvimento" mostra o campo (etapa configurada) e os campos do Dev estão livres.
  const refEditavel = isEdit && !devBloqueado && kanbanCard.refVisivel;
  // Comprado (revenda/importado) segue a config "Fluxo de Revenda" da loja (decisão F3 #8; paridade com
  // ModeloDetailPanel.tsx:1574). Interno vê tudo.
  const campoVisivelDev = (key: string) => !isComprado || revendaCampoVisivel(kanbanCard.revendaCfg, key);

  // Colab (spec 2026-08-03, Task 2): 1ª carga semeia como sempre; refetch (Realtime/foco de
  // janela invalidando ["modelo", modeloId]) faz MERGE 3-vias em vez de sobrescrever o
  // rascunho às cegas — mesmo padrão do piloto OC Tecido / adoção do Desenvolvimento.
  useEffect(() => {
    if (!modeloData) return;
    const freshDraft = draftFromModeloRow(modeloData);
    const freshRev = (modeloData as any).rev ?? null;

    if (!baseRef.current) {
      // 1ª carga: seed normal (mesmo comportamento de antes do piloto).
      baseRef.current = { draft: freshDraft };
      revRef.current = freshRev;
      setDraft(freshDraft);
      resetDraftBaseline(freshDraft);
      // Pré-seleciona o Grupo da categoria carregada (deriva de categorias_produto.grupo_id).
      setGrupoSel(categorias.find((c) => c.id === (modeloData as any).categoria_principal_id)?.grupo_id ?? null);
      setEnviada(!!(modeloData as any).ordem_criacao_enviada);
      setLancado(!!(modeloData as any).lancado);
      touchedRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      return;
    }

    // Rev igual ao último que processei = nada aconteceu desde então (refetch duplicado/foco
    // de janela sem UPDATE real) — no-op, nem olha o draft.
    if (freshRev === revRef.current) return;

    // `ordem_criacao_enviada`/`lancado` são geridos por mutations PRÓPRIAS (`enviar`/`lancar`,
    // classe b — ver comentário nelas) fora do touched/merge do Draft; sempre adotam o valor do
    // servidor (idempotente, sem conflito a resolver aqui).
    setEnviada(!!(modeloData as any).ordem_criacao_enviada);
    setLancado(!!(modeloData as any).lancado);

    const md = mergeDraft({ base: baseRef.current.draft, draft, fresh: freshDraft, touched: touchedRef.current });
    const draftMudou = md.atualizados.length > 0 || md.conflitos.length > 0;
    baseRef.current = { draft: freshDraft };
    revRef.current = freshRev;

    // ⚠️ Um save do OUTRO USUÁRIO pode disparar mais de 1 evento UPDATE em sequência; passadas
    // SEGUINTES à que achou o conflito comparam `base` (já avançado) com o MESMO `fresh` → 0
    // diffs nessa passada (`draftMudou=false`) — NÃO sobrescreve `conflitos`/`ultimoMerge` aqui
    // (senão apagaria em silêncio um conflito real ainda não resolvido pelo usuário; mesmo
    // guard `semResultado` do piloto).
    if (!draftMudou) return;

    setDraft(md.valor);
    conflitosRef.current = md.conflitos;
    setConflitos(md.conflitos);
    setUltimoMerge({ atualizados: md.atualizados.length, conflitos: md.conflitos });
    // Categoria pode ter sido adotada em silêncio (não tocada) ou mantida "minha" (conflito) —
    // `md.valor` já reflete a decisão certa; recomputa o Grupo (filtro transiente) a partir dela.
    if (md.valor.categoria_principal_id !== draft.categoria_principal_id) {
      setGrupoSel(categorias.find((c) => c.id === md.valor.categoria_principal_id)?.grupo_id ?? null);
    }
    // Nada tocado pelo usuário: seguro re-baselinar o guarda de "não salvo" (o draft inteiro
    // acabou de virar o estado do servidor, então não há nada "não salvo" de verdade) — sem
    // isso, um espectador que não editou nada veria "alterações não salvas" por um merge
    // silencioso. Com algo tocado, NÃO re-baseliza (o indicador precisa continuar apontando
    // que ainda falta Salvar).
    if (touchedRef.current.size === 0) resetDraftBaseline(md.valor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeloData]);

  const uploadMutation = useMutation({
    mutationFn: async ({ file, key }: { file: File; key: "fotos_modelo" | "fotos_referencia" }) => {
      const path = await uploadFile(file, key);
      return { path, key };
    },
    onSuccess: ({ path, key }) => setDraftTracked((d) => ({ ...d, [key]: [...d[key], path] })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const uploadDesenho = useMutation({
    mutationFn: async (file: File) => uploadFile(file, "desenho_tecnico"),
    onSuccess: (path) => setDraftTracked((d) => ({ ...d, desenho_tecnico_url: path })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const uploadCroqui = useMutation({
    mutationFn: async (file: File) => uploadFile(file, "croqui"),
    onSuccess: (path) => setDraftTracked((d) => ({ ...d, croqui_url: path })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  // Ficha de Medida (veio do Dev — F3.1): MESMO caminho do Dev, `<tenant>/fichas/<modeloId>/<uuid>-<nome>`
  // (ModeloDetailPanel.tsx:2654-2659). Só no card existente (a seção só aparece com isEdit).
  const uploadFicha = useMutation({
    mutationFn: async (file: File) => uploadFile(file, `fichas/${modeloId}`),
    onSuccess: (path) => { setDraftTracked((d) => ({ ...d, ficha_medida_url: path })); toast.success("Ficha enviada"); },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  // Salvar re-trava os campos do Dev quando o card já foi enviado à Explosão (paridade com o Dev,
  // ModeloDetailPanel.tsx:2273) e avisa o container (lista por baixo).
  const aoSalvar = () => { setEditandoDev(false); onSaved(); };

  // Salvar (+ retry/merge do P0409) — extraído na F3.0 para `planejamento-detail/usePlanejamentoSave.ts`
  // (texto movido; os refs/estados abaixo continuam daqui e vão com os MESMOS nomes).
  const { save, handleSave } = usePlanejamentoSave({
    modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, podeEditarDev, categorias,
    refEditavel,
    draft, setDraft, draftLiveRef,
    touchedRef, baseRef, revRef, retryRef, savingRef, conflitosRef, setConflitos, setUltimoMerge,
    setEnviada, setLancado, markClean,
    moLinhas, moLinhasRef, moBaseRef, setMoLinhasBase,
    gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,
    qc, onSaved: aoSalvar, onCreated,
  });

  // Resolve um conflito de campo escalar: "usar o novo" aplica `dele` no rascunho e tira o
  // campo do `touched` (senão o próximo merge o trataria como editado por mim de novo);
  // "manter meu" só descarta o aviso — o valor local prevalece e SEGUE touched.
  const resolverConflito = (c: Conflito, useDele: boolean) => {
    if (useDele) {
      setDraft((d) => ({ ...d, [c.path]: c.dele }));
      touchedRef.current.delete(c.path);
    }
    setConflitos((prev) => {
      const next = prev.filter((x) => x.path !== c.path);
      conflitosRef.current = next;
      return next;
    });
    setUltimoMerge((prev) => {
      if (!prev) return prev;
      const conflitosRestantes = prev.conflitos.filter((x) => x.path !== c.path);
      if (conflitosRestantes.length === 0 && prev.atualizados === 0) return null;
      return { ...prev, conflitos: conflitosRestantes };
    });
  };
  // Resolução GENÉRICA a partir do ColabBanner (mesmo padrão do piloto/Desenvolvimento): todo
  // conflito ganha "manter meu · usar o novo" — sem isso o guard do save deadlockaria em
  // campos sem UI de resolução inline.
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitos.find((x) => x.path === path);
    if (c) resolverConflito(c, escolha === "dele");
  };

  // Colab: canal por modelo — o registroId vai DENTRO do canal (nunca ler old_record).
  // Qualquer UPDATE na linha `modelos` (inclusive um save de outro usuário) dispara
  // `onMudancaServidor`, que invalida a query e deixa o useEffect de merge acima reconciliar.
  const { presentes } = useColabRegistro({
    canal: modeloId ? `colab:modelo:${modeloId}` : null,
    tabela: "modelos",
    registroId: modeloId,
    onMudancaServidor: () => qc.invalidateQueries({ queryKey: ["modelo", modeloId] }),
    campoFocado,
  });
  // Presença por campo com NOME + COR (estilo Sheets, set/2026): o anel/rótulo sai do
  // <ColabPresenceOverlay> montado no fim do sheet — auto-instrumentado, cobre TODOS os campos
  // (o foco vira `campoFocado` via `pathDoElemento` no onFocusCapture do container).

  // Enviar/Cancelar Ordem de Criação: gate explícito pro Desenvolvimento (independe do Salvar).
  // Colab (Task 2): classe b — ação pontual de 1 campo (2, atômicos no mesmo payload), singular
  // e idempotente (enviar de novo com o mesmo `send` não muda nada); não compete com edições de
  // outros campos do rascunho. SEM trava de `rev`.
  const enviar = useMutation({
    mutationFn: async (send: boolean) => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      const payload = send
        ? { ordem_criacao_enviada: true, ordem_criacao_enviada_at: new Date().toISOString(), status_planejamento: "planejado" }
        : { ordem_criacao_enviada: false, ordem_criacao_enviada_at: null };
      const { error } = await supabase.from("modelos").update(payload).eq("id", modeloId);
      if (error) throw error;
    },
    onMutate: (send: boolean) => setEnviada(send),
    onError: (e: any, send: boolean) => { setEnviada(!send); toast.error(mensagemErro(e, "Erro")); },
    onSuccess: (_d, send: boolean) => {
      toast.success(send ? "Ordem de Criação enviada" : "Envio cancelado");
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
    },
  });

  // Lançar/Cancelar: gate explícito pro Lançamentos (independe do Salvar). Persiste a
  // Data de Lançamento junto (o usuário pode não ter clicado em Salvar).
  const lancar = useMutation({
    mutationFn: async (send: boolean) => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      // Pré-checagens de UX (mensagem imediata); o SERVIDOR re-valida em lancar_modelo.
      if (send) {
        if (!cqConfirmado) throw new Error("Confirme o Controle de Qualidade antes de lançar.");
        if (maoObraPendente) throw new Error("Aprove a mão de obra antes de lançar.");
        if (!draft.data_lancamento) throw new Error("Preencha a Data de Lançamento.");
      }
      // Gate REAL no servidor (CQ liberado + valor de serviço aprovado + data). Ao lançar,
      // a RPC também limpa o #Erro de 'lancamentos' (setado quando o CQ foi desmarcado antes).
      const { error } = await supabase.rpc("lancar_modelo" as any, {
        _modelo_id: modeloId,
        _data_lancamento: send ? draft.data_lancamento : null,
        _send: send,
      });
      if (error) throw error;
    },
    onMutate: (send: boolean) => setLancado(send),
    onError: (e: any, send: boolean) => { setLancado(!send); toast.error(mensagemErro(e, "Erro")); },
    onSuccess: (_d, send: boolean) => {
      toast.success(send ? "Modelo lançado" : "Lançamento cancelado");
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["lancamentos-cards"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
    },
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      if (!modeloId) return;
      // Raiz da família de versões: o original (cópias apontam para ele via modelo_base_id).
      const root = draft.modelo_base_id ?? modeloId;
      // Próxima versão = maior versão existente na família + 1.
      const { data: fam, error: eFam } = await supabase
        .from("modelos")
        .select("versao")
        .or(`id.eq.${root},modelo_base_id.eq.${root}`);
      if (eFam) throw eFam;
      const maxV = (fam ?? []).reduce((m, r: any) => Math.max(m, r.versao ?? 1), 1);
      // A cópia mantém o nome do original; a versão é que diferencia. `camposParaDuplicar` (helpers.ts,
      // decisão F3 #9): herda o de hoje (Planejamento + tecidos + Obs. Gerais + Descrição); NÃO herda a REF
      // (a nova versão gera a própria ao chegar ao Desenvolvimento — ref_auto, invariante #11) nem os demais
      // campos do Desenvolvimento (nascem vazios).
      const payload: any = {
        ...camposParaDuplicar(draft),
        status_planejamento: "em_planejamento",
        data_lancamento: null, // a cópia (nova versão) não nasce lançada (lancado default false)
        versao: maxV + 1,
        modelo_base_id: root,
      };
      const { error } = await supabase.from("modelos").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Card duplicado"); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!modeloId) return;
      const { error } = await supabase.from("modelos").delete().eq("id", modeloId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Modelo excluído"); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  // Condições que faltam p/ Enviar a Ordem de Criação (mostradas no tooltip do botão).
  const enviarBloqueios: string[] = [];
  if (draft.status_planejamento !== "planejado") enviarBloqueios.push('Defina o Status como "Planejado".');

  // O que falta p/ poder Lançar (mesmo gate da mutation `lancar`) — alimenta o tooltip
  // do botão desabilitado no setor Lançamento.
  const lancarBloqueios: string[] = [];
  if (!cqConfirmado) lancarBloqueios.push("Confirme o Controle de Qualidade (Pré e, se houver acabamento, o Pós).");
  if (maoObraPendente) lancarBloqueios.push("Aprove a mão de obra de todos os serviços (na seção Mão de obra).");
  if (!draft.data_lancamento) lancarBloqueios.push("Preencha a Data de Lançamento.");

  // Conteúdo interno idêntico p/ os dois containers (header / corpo rolável / rodapé
  // sticky / diálogos / guarda). EDITAR abre num Sheet lateral (side=right, ~70vw);
  // NOVO num Dialog central. O container é escolhido por `isEdit` logo abaixo.
  const conteudo = (
    <>
        <div className="shrink-0 px-6 pt-4 pb-0">
          <Breadcrumb items={[{ label: "Estilo & Engenharia" }, { label: "Planejamento de Produto" }, { label: draft.nome || "Novo modelo" }]} />
        </div>
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2 text-left">
          {/* Miniatura da foto do modelo à ESQUERDA do nome/REF (padrão dos headers de Serviços/CQ/
              Direcionamento). Quadrada (h-14 w-14); `ModeloResumoFoto` resolve a signed URL sozinho.
              Só no card existente (isEdit) — no "Novo Modelo" ainda não há foto. */}
          <div className="flex items-start gap-3">
            {isEdit && (
              <ModeloResumoFoto
                fontes={[draft.fotos_modelo?.[0], draft.desenho_tecnico_url, draft.croqui_url]}
                nome={draft.nome}
                className="h-14 w-14"
                zoom
              />
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span>{isEdit ? draft.nome || "Modelo" : "Novo Modelo"}</span>
                {draft.versao > 1 && <VersaoBadge versao={draft.versao} />}
                <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
              </DialogTitle>
              {/* REF logo abaixo do nome — read-only, discreta. Só aparece quando já existe (gerada no
                  Desenvolvimento, invariante #11); vazia no Planejamento pré-Dev fica oculta (mais clean). */}
              {isEdit && draft.ref && (
                <span className="text-xs font-mono text-muted-foreground">REF {draft.ref}</span>
              )}
              {/* Motivo do Cancelamento (veio do Dev — F3.1): só com a etapa em Reprovado. Sair de Reprovado NÃO
                  apaga o motivo (dono, 23/set) — ele só some da tela. Trava/permissão = fieldset. */}
              {isEdit && podeVerDev && kanbanCard.isReprovado && (
                <fieldset disabled={devBloqueado} className="contents">
                  <MotivoCancelamento
                    value={draft.motivo_cancelamento}
                    onChange={(v) => setDraftTracked((d) => ({ ...d, motivo_cancelamento: v }))}
                  />
                </fieldset>
              )}
            </div>
          </div>
          <ColabBanner
            presentes={presentes}
            ultimoMerge={ultimoMerge}
            conflitos={conflitos}
            onResolver={resolverPorPath}
            rotulo={rotuloConflitoPlan}
          />
        </DialogHeader>

        <div
          ref={colabScopeRef}
          className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-6"
          onFocusCapture={(e) => {
            const scope = colabScopeRef.current;
            setCampoFocado(scope ? pathDoElemento(e.target as HTMLElement, scope) : null);
          }}
          onBlurCapture={() => setCampoFocado(null)}
        >
          {/* SETOR 1 — Informações Gerais do Produto */}
          <InfoGeraisSecao
            draft={draft} setDraftTracked={setDraftTracked}
            grupoSel={grupoSel} setGrupoSel={setGrupoSel}
            grupos={grupos} categorias={categorias} estilistas={estilistas}
            sub1Opts={sub1Opts} sub2Opts={sub2Opts} fl={fl}
          />

          {/* SETOR 2 — Coleção */}
          <Secao titulo="Coleção" defaultOpen={false}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {otbOn ? (
                <FieldSelect
                  label={fl("colecao")}
                  value={draft.colecao_id ?? null}
                  onChange={(v) => {
                    const col = colecoes.find((c) => c.id === v);
                    setDraftTracked((d) => ({ ...d, colecao_id: v, colecao: col?.nome ?? d.colecao,
                      mes_id: d.mes_id ?? col?.mes_id ?? null, ano_id: d.ano_id ?? col?.ano_id ?? null }));
                  }}
                  options={colecoes.map((c) => ({ id: c.id, nome: orcLabel(c.nome, orc.colecao(c.id)) }))}
                />
              ) : (
                <FieldText label={fl("colecao")} value={draft.colecao} onChange={(v) => setDraftTracked((d) => ({ ...d, colecao: v }))} />
              )}
              {otbOn ? (
                <FieldSelect
                  label="Subcoleção"
                  value={draft.subcolecao || null}
                  onChange={(v) => setDraftTracked((d) => ({ ...d, subcolecao: v }))}
                  options={Array.from(new Set([...subcolecoesOpts, ...(draft.subcolecao ? [draft.subcolecao] : [])])).map((s) => ({ id: s, nome: orcLabel(s, orc.subcolecao(draft.colecao_id, s)) }))}
                />
              ) : (
                <FieldText label="Subcoleção" value={draft.subcolecao ?? ""} onChange={(v) => setDraftTracked((d) => ({ ...d, subcolecao: v }))} />
              )}
              <FieldSelect label={fl("linha")} value={draft.linha_id} onChange={(v) => setDraftTracked((d) => ({ ...d, linha_id: v }))} options={linhas.map((l) => ({ id: l.id, nome: orcLabel(l.nome, orc.nivel3(draft.colecao_id, draft.subcolecao, l.id)) }))} />
              <div className="grid gap-1">
                <Label>Lançamento</Label>
                <Select value={draft.semana || ""} onValueChange={(v) => setDraftTracked((d) => ({ ...d, semana: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {["1","2","3","4","5"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldSelect label="Mês de Planejamento" value={draft.mes_id} onChange={(v) => setDraftTracked((d) => ({ ...d, mes_id: v }))} options={meses} />
              <FieldSelect label="Ano" value={draft.ano_id} onChange={(v) => setDraftTracked((d) => ({ ...d, ano_id: v }))} options={anos} />
              {/* Data de Lançamento vive APENAS na seção Lançamento (junto do botão Lançar) — antes
                  aparecia duas vezes no mesmo Sheet, editando o mesmo campo (laudo jul/2026). */}
            </div>
          </Secao>

          {/* Desenvolvimento — equipe e cronograma (veio do Dev, F3.1). Sempre visível — independe da etapa —
              p/ quem vê o Desenvolvimento (decisão F3 #8); recolhida (decisão 6); só no card existente. O
              <fieldset> fica DENTRO da seção (o cabeçalho continua abrindo/fechando com o card travado). */}
          {isEdit && podeVerDev && (
            <Secao titulo="Desenvolvimento — equipe e cronograma" defaultOpen={false}>
              <AvisoCamposDev motivo={motivoTravaDev} />
              <fieldset disabled={devBloqueado} className="contents">
                <DevEquipeSection
                  draft={draft}
                  setDraftTracked={setDraftTracked}
                  refVisivel={kanbanCard.refVisivel}
                  campoVisivel={campoVisivelDev}
                  bloqueado={devBloqueado}
                />
              </fieldset>
            </Secao>
          )}

          {/* Ajustes na Prova (veio do Dev — F3.1): fio de comentários que grava NA HORA (fora do Salvar). Comprado
              segue a seção "prova" do Fluxo de Revenda (default: escondida). Trava = fieldset, como no Dev. */}
          {isEdit && modeloId && podeVerDev && campoVisivelDev("prova") && (
            <Secao titulo="Ajustes na Prova" defaultOpen={false}>
              <AvisoCamposDev motivo={motivoTravaDev} />
              <fieldset disabled={devBloqueado} className="contents">
                <ModeloAjustesProvaSection modeloId={modeloId} />
              </fieldset>
            </Secao>
          )}

          {/* ↓ F3.2: as seções do BOM (Tecidos/Forros/Entretelas · Aviamentos · Insumos · Grade) entram AQUI,
              entre "Ajustes na Prova" e "Preço" (ordem do mockup aprovado). */}

          {/* F3.1 — "Tecido Planejado" SUBIU para cá (mockup aprovado): no Dialog "Novo Modelo" fica ANTES da Mão de
              obra (gen_novo.py) e no Sheet no lugar da seção 5 "Tecidos" (gen_anotado.py), que a F3.2 troca pelo BOM. */}
          {/* SETOR 4 — Tecido Planejado (oculto p/ comprado — revenda/importado não têm tecido) */}
          {!isComprado && (
          <Secao titulo="Tecido Planejado" defaultOpen={false}>
            <MultiArtigosField
              label=""
              value={draft.tecidos_planejados}
              onChange={(v) => setDraftTracked((d) => ({ ...d, tecidos_planejados: v }))}
              artigos={artigos}
              estoque={estoqueMap}
            />
          </Secao>
          )}

          {/* SETOR 3 — Preço (só na edição; na criação o custo vem do BOM depois) */}
          {isEdit && (
          <Secao titulo="Preço" defaultOpen={false}>
            {!isRevenda ? (
              // MANUFATURADO — §K: custo/markup/preço vêm de OUTRA etapa (BOM/CAD +
              // Serviços; linha do Cadastro; cálculo de preco.ts) → tira de resumo + atalho
              // ⧉ pra etapa dona, NUNCA campo travado. Só "Preço para venda" é campo desta
              // tela (nasce vazio, placeholder = sugerido — §D). Nada de dado/RPC muda: são
              // os MESMOS valores (custo/markup/preco/precoSug/markupReal), só a apresentação.
              // Seção Preço TABULADA + FUNDIDA (set/2026): a antiga "Simulação de custo" foi
              // ABSORVIDA aqui (não existe mais como seção à parte). Tabela em 3 partes (Preços ·
              // Custos · M.O. por faixa), colunas Descrição · Markup · Valores · Obs. Coluna Valores
              // = só NÚMEROS; todo contexto (selo estimado/real, badge de faixa da M.O., histórico,
              // fórmula) vai na Obs. Preços digitáveis: Preço de venda + Consumo de tecido (vem do
              // Dev; migra o `custo_simulado.consumo_tecido`). Custos: enquanto o BOM não confirma
              // (estimado), Tecido = consumo×preço/m + Materiais editável (= aviamento, migra
              // `custo_simulado.aviamento`) + M.O. do Dev; quando confirma (real), vira Materiais
              // real + M.O. real do BOM. A seção "Mão de obra" (MaoObraEditor) fica logo ABAIXO.
              <PrecoTabela
                markupReal={markupReal} precoSug={precoSug} precoBase={precoBaseMO} precoDigitado={precoVendaDigitado}
                draftPrecoVenda={draft.preco_venda}
                onPrecoVenda={(v) => setDraftTracked((d) => ({ ...d, preco_venda: numOr0(v) > 0 ? Number(v) : null }))}
                custoReal={custoReal}
                consumo={consumoOverride} consumoRealBOM={consumoRealBOM} precoTecidoM={precoTecidoM} tecidoEstimado={simCalc.tecido}
                aviamento={draft.custo_simulado.aviamento ?? null} maoObraDev={maoObraDevLive} custoEstimado={simCalc.total}
                onConsumo={(v) => setSim({ consumo_tecido: numOr0(v) > 0 ? Number(v) : null })}
                onAviamento={(v) => setSim({ aviamento: numOr0(v) > 0 ? Number(v) : null })}
                materiaisReal={materiaisSetor} custoRealTotal={custo} custoPrevisto={custoPrevisto}
                linhaFaixas={linhaFaixas}
                moMin={moMin} moIdeal={moIdeal} moMax={moMax} moStatusFaixa={moStatusFaixa}
                podeVerCustos={podeVerCustos} podeEditarCustos={podeEditarCustos} podeEditarPreco={podeEditarPreco} markupFaixaOn={markupFaixaOn}
                onVerDev={modeloId ? () => setVerDevModeloId(modeloId) : undefined}
              />
            ) : (
              // REVENDA — fora do escopo aprovado do §K: segue como CampoRO + os 2 markups
              // digitáveis (mesma fonte de ProdutoCard.tsx no planejador Produto Acabado,
              // bidirecional) + Preço atacado/varejo FIXO (preço exato digitado, sem derivar do markup).
              <PrecoRevendaBloco rv={revenda} custoReal={custoReal} piRevenda={piRevenda} draft={draft} />
            )}
          </Secao>
          )}

          {/* Mão de obra POR SERVIÇO (spec 2026-08-06) — LOGO ABAIXO da seção Preço (set/2026,
              decisão do dono): a de cima calcula quanto de M.O. cabe por faixa; esta é onde se
              ADICIONA cada serviço com valor. Lista de serviços com valor (R$), estado por linha
              (pendente/aprovado/reprovado) e aprovar/reprovar por serviço. Gated: ver custos
              (valores + obs) OU aprovar (botões). O VALOR persiste no Salvar da página (fica no
              rascunho `moLinhas` até lá — NÃO exige salvar o modelo antes de digitar); aprovar/
              reprovar é imediato. REVENDA/IMPORTADO (set/2026): a MO é a MESMA fonte
              `modelo_servico_mo` (chaveada por modelo_id) — a seção aparece igual ao manufaturado,
              e a MO entra na BASE do markup (banco: _pa/_imp_recomputar). Comprado só mostra com
              `isEdit` (o modelo espelho já existe p/ gravar; senão não há onde persistir). */}
          {(!isComprado ? true : isEdit) && (podeVerCustos || (isEdit && podeAprovarMaoObra)) && (
            <Secao titulo="Mão de obra" defaultOpen={false}>
              <MaoObraEditor
                linhas={moLinhas}
                categorias={catsServico}
                podeVerCustos={podeVerCustos}
                podeAprovar={isEdit && podeAprovarMaoObra}
                onChangeLinhas={(ls) => setMoLinhas(ls)}
                onAprovar={(linhaId) => aprovarServicoMO.mutate({ linhaId, aprovado: true })}
                onReprovar={(linhaId, motivo) => aprovarServicoMO.mutate({ linhaId, aprovado: false, motivo })}
                pendingLinhaId={aprovarServicoMO.isPending ? aprovarServicoMO.variables?.linhaId : undefined}
                linhasPersistidas={moLinhasPersistidas}
              />
              {podeVerCustos && (
                <div className="mt-3">
                  {/* F3.1 (mockup aprovado): rótulo "Obs. Mão de Obra", igual ao do Dev (ModeloDetailPanel.tsx:3051-3055). */}
                  <ObsMaoObraField
                    label="Obs. Mão de Obra"
                    value={draft.observacoes_mao_obra}
                    onChange={(v) => setDraftTracked({ ...draft, observacoes_mao_obra: v })}
                  />
                </div>
              )}
            </Secao>
          )}

          {/* Revenda (Task 7): produto vinculado (Produto Acabado) — atalho ⧉ ou criar. */}
          {isEdit && isRevenda && paOn && (
            <ProdutoAcabadoSecao rv={revenda} contexto={contexto} modeloId={modeloId} navigate={navigate} />
          )}

          {/* Revenda (Task 7): grade cor×tamanho editável — por variante do produto (rótulo
              cor·apelido) × tamanhos ativos da proporção (grupo Acessórios = coluna única
              "UN"); lê/grava `modelo_grades` (variante_numero=ordem). */}
          {isEdit && isRevenda && paOn && produtoRevenda && (
            <GradeRevendaSecao rv={revenda} />
          )}

          {/* SETOR 5 — Anexos */}
          <Secao titulo="Anexos" defaultOpen={false}>
            <div className="grid sm:grid-cols-2 gap-4">
              <SingleFileField
                label="Foto do Croqui"
                path={draft.croqui_url}
                onUpload={(f) => uploadCroqui.mutate(f)}
                onRemove={() => setDraftTracked((d) => ({ ...d, croqui_url: "" }))}
              />
              <SingleFileField
                label="Desenho Técnico"
                path={draft.desenho_tecnico_url}
                onUpload={(f) => uploadDesenho.mutate(f)}
                onRemove={() => setDraftTracked((d) => ({ ...d, desenho_tecnico_url: "" }))}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <PhotoList label="Foto do Modelo" paths={draft.fotos_modelo}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_modelo" })}
                onRemove={(i) => setDraftTracked((d) => ({ ...d, fotos_modelo: d.fotos_modelo.filter((_, j) => j !== i) }))} />
              <PhotoList label="Foto de Referência" paths={draft.fotos_referencia}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_referencia" })}
                onRemove={(i) => setDraftTracked((d) => ({ ...d, fotos_referencia: d.fotos_referencia.filter((_, j) => j !== i) }))} />
            </div>
            {/* Ficha de Medida + Observações Gerais (vieram do Dev — F3.1): card existente, quem vê o Dev e (comprado)
                seção "s6" ligada no Fluxo de Revenda. Travam com as seções do Dev; o resto de Anexos segue livre. */}
            {isEdit && modeloId && podeVerDev && campoVisivelDev("s6") && (
              <>
                <AvisoCamposDev motivo={motivoTravaDev} />
                <fieldset disabled={devBloqueado} className="contents">
                  <AnexosDevCampos
                    fichaMedidaUrl={draft.ficha_medida_url}
                    onUploadFicha={(f) => uploadFicha.mutate(f)}
                    onRemoverFicha={() => setDraftTracked((d) => ({ ...d, ficha_medida_url: "" }))}
                    observacoesGerais={draft.observacoes_gerais}
                    onObservacoesGerais={(v) => setDraftTracked((d) => ({ ...d, observacoes_gerais: v }))}
                  />
                </fieldset>
              </>
            )}
          </Secao>

          {/* Observações (veio do Dev — F3.1): blocos com a Composição automática, gravam NA HORA (fora do Salvar).
              Reuso DIRETO de `ModeloObservacoes` (o card dele tem título próprio "Observações" — aceito: o
              componente é compartilhado com o Sheet do Dev e não muda até a F5). */}
          {isEdit && modeloId && podeVerDev && (
            <Secao titulo="Observações" defaultOpen={false}>
              <AvisoCamposDev motivo={motivoTravaDev} />
              <fieldset disabled={devBloqueado} className="contents">
                <ModeloObservacoes modeloId={modeloId} readOnly={devBloqueado} />
              </fieldset>
            </Secao>
          )}

          {/* SETOR 6 — Lançamento (gate: CAD + CQ liberado + valor de serviços aprovado) */}
          {isEdit && (
            <Secao titulo="Lançamento" defaultOpen={false}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1 flex-1 min-w-[180px]">
                  <Label>Data de Lançamento</Label>
                  {/* Editável aqui também: a data real pode não se cumprir, então o
                      usuário ajusta no próprio setor Lançamento (Salvar persiste). */}
                  <DateField
                    value={draft.data_lancamento ?? ""}
                    onChange={(e) => setDraftTracked((d) => ({ ...d, data_lancamento: e.target.value || null }))}
                    data-colab-path="data_lancamento"
                  />
                </div>
                {lancado ? (
                  <Button variant="outline" onClick={() => lancar.mutate(false)} disabled={lancar.isPending}>
                    Cancelar Lançamento
                  </Button>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      {/* Botão desabilitado não dispara title nativo — o span recebe o
                          hover e o tooltip lista o que falta para lançar. */}
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            onClick={() => lancar.mutate(true)}
                            disabled={lancar.isPending || lancarBloqueios.length > 0}
                          >
                            Lançar
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {lancarBloqueios.length > 0 && (
                        <TooltipContent className="max-w-[260px]">
                          <p className="font-medium">Para lançar, falta:</p>
                          <ul className="mt-1 list-disc pl-4">
                            {lancarBloqueios.map((b) => <li key={b}>{b}</li>)}
                          </ul>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              {lancado && <p className="mt-2 text-xs text-emerald-600">✓ Lançado — aparece em Lançamentos.</p>}
            </Secao>
          )}
          {isEdit && modeloId && (
            <Secao titulo="Produto Relacionado" defaultOpen={false}>
              <ProdutoRelacionadoSetor modeloId={modeloId} />
            </Secao>
          )}
        </div>

        <div className="shrink-0 border-t bg-background px-4 py-3 flex flex-wrap items-center gap-2">
          {/* Voltar: ESQUERDA — ícone no mobile, texto no desktop. */}
          <Button variant="outline" onClick={requestClose} aria-label="Voltar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 mr-1 max-sm:mr-0" />
            <span className="max-sm:sr-only">Voltar</span>
          </Button>
          {/* Excluir: logo ao lado do Voltar (só no modo edição). */}
          {isEdit && (
            <Button variant="destructive" onClick={() => setConfirmDel(true)} aria-label="Excluir" className="shrink-0 max-sm:aspect-square max-sm:px-0">
              <Trash2 className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Excluir</span>
            </Button>
          )}
          {/* Grupo direito: ml-auto empurra para a direita. */}
          {isEdit && (
            <Button variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending} aria-label="Duplicar" className="ml-auto shrink-0 max-sm:aspect-square max-sm:px-0">
              <Copy className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Duplicar</span>
            </Button>
          )}
          {isEdit && (enviada ? (
            <Button variant="outline" onClick={() => enviar.mutate(false)} disabled={enviar.isPending}>
              Cancelar Envio
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                {/* Botão desabilitado não dispara title nativo — o span recebe o hover
                    e o tooltip lista o que falta para enviar. */}
                <TooltipTrigger asChild>
                  <span className={isEdit ? "" : "ml-auto"} style={{ display: "inline-flex" }}>
                    <Button
                      variant="secondary"
                      onClick={() => enviar.mutate(true)}
                      disabled={enviar.isPending || enviarBloqueios.length > 0}
                    >
                      <span className="sm:hidden">Enviar Ordem</span>
                      <span className="hidden sm:inline">Enviar Ordem de Criação</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                {enviarBloqueios.length > 0 && (
                  <TooltipContent className="max-w-[260px]">
                    <p className="font-medium">Para enviar a Ordem de Criação, falta:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {enviarBloqueios.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          ))}
          {/* Trava pós-Explosão (decisão F3 #1): "Editar" destrava SÓ os campos vindos do Dev; o Salvar re-trava. */}
          {isEdit && enviadoCad && !editandoDev && podeEditarDev && (
            <Button
              variant="secondary"
              onClick={() => setEditandoDev(true)}
              aria-label="Editar"
              title="Enviado à Explosão — destrava os campos vindos do Desenvolvimento"
              className="shrink-0 max-sm:aspect-square max-sm:px-0"
            >
              <Pencil className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Editar</span>
            </Button>
          )}
          <Button className={`shrink-0 max-sm:aspect-square max-sm:px-0${!isEdit ? " ml-auto" : ""}`} aria-label="Salvar" onClick={handleSave} disabled={save.isPending}>
            <Save className="h-4 w-4 sm:mr-1" />
            <span className="max-sm:sr-only">Salvar</span>
          </Button>
        </div>

        <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
              <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => del.mutate()}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste card." />
        {/* Ring de presença por campo AUTO-instrumentado (cobre todos os campos do sheet). */}
        <ColabPresenceOverlay presentes={presentes} scopeRef={colabScopeRef} />
    </>
  );

  // Regra 3: EDITAR registro existente = Sheet lateral (side=right, ~70vw); NOVO = Dialog
  // central. Mesmo conteúdo interno nos dois; classes max-sm:* mantêm o fullscreen mobile.
  return (
    <>
      {isEdit ? (
        <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
          <SheetContent
            side="right"
            size="editor"
            className="flex flex-col gap-0 p-0 max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!rounded-none max-sm:!border-0 max-sm:!overflow-hidden"
          >
            {conteudo}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
          <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[70vw] max-h-[90vh] max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!overflow-hidden">
            {conteudo}
          </DialogContent>
        </Dialog>
      )}

      {/* "Ver no Desenvolvimento" (setor Preço, §K) → ModeloDetailPanel INLINE por cima deste
          Sheet, sem navegar (mesmo precedente do ProdutoAcabadoSheet:745-752). onSaved invalida
          as queries de custo/MO que o colab (canal `modelos`) não cobre — o próprio `["modelo",
          modeloId]` já reconcilia via Realtime/merge 3-vias quando o Dev grava na mesma linha. */}
      {verDevModeloId && (
        <ModeloDetailPanel
          modeloId={verDevModeloId}
          onClose={() => setVerDevModeloId(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["plan-custo-unit", verDevModeloId] });
            qc.invalidateQueries({ queryKey: ["mo-resumo", verDevModeloId] });
            qc.invalidateQueries({ queryKey: ["modelo-tecidos-consumo", verDevModeloId] });
            qc.invalidateQueries({ queryKey: ["modelo", verDevModeloId] });
            qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
            qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
          }}
        />
      )}
    </>
  );
}
