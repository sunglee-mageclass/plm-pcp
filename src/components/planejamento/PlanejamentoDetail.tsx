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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, ArrowLeft, Save, Pencil, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { VersoesExistentesAviso, useVersoesFamilia } from "@/components/planejamento/VersoesExistentesAviso";
import { buscarVersoesFamilia } from "@/lib/versoes-familia-query";
import { agruparPorFamilia, precisaConfirmar } from "@/lib/versoes-familia";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CONTEXTO_PADRAO, type ContextoDetalhe } from "@/components/planejamento/planejamento-detail/contexto";
import { consumirFlag } from "@/lib/cq-status-tela";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import { textoCancelarLancamento } from "@/lib/confirmacoes-textos";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { pathDoElemento } from "@/lib/colab/colab-field-path";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeDraft, type Conflito } from "@/lib/colab/merge";
import { useAuth } from "@/hooks/useAuth";
import { ReadOnlyScope } from "@/components/RequirePermission";
import { ObsMaoObraField } from "@/components/shared/ObsMaoObraField";
import { MaoObraEditor, type MaoObraEditorLinha } from "@/components/planejamento/MaoObraEditor";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";
import { InfoHover } from "@/components/shared/InfoHover";
import { SeloIntegracao } from "@/components/integracao/SeloIntegracao";
import { useIntegracaoEstado } from "@/hooks/useIntegracaoEstado";
import { TEXTO_SKU_TRAVADO, TEXTO_TRAVA_SHEET, colunasTravadas, textoExcluirTravado } from "@/lib/integracao/trava";
import { estadoMO, moLinhasEqual, moLinhaVaiReabrir, podeEditarValorMO, type MoLinha } from "@/lib/mao-obra";
import { DateField } from "@/components/shared/DateField";
import { precoInfo, custoSimulado, moPorFaixa, statusMoFaixa, type CustoSimInput } from "@/lib/preco";
import { cqLiberado } from "@/lib/cq-status";
import { bloqueiosLancar } from "@/lib/lancar";
import { rotuloColecao } from "@/lib/colecao-rotulo";
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
import { useRequerModulo } from "@/hooks/useRequerModulo";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { ProdutoRelacionadoSetor } from "@/components/planejamento/ProdutoRelacionadoSetor";
import { useOrcamento, orcLabel } from "@/components/otb/orcamento";
import { ehOrigemComprada } from "@/lib/origem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useTenantBranding } from "@/hooks/useTenantBranding";

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
import { resolverPermissoesSheet } from "@/components/planejamento/planejamento-detail/permissoes-sheet";
import { InfoGeraisSecao } from "@/components/planejamento/planejamento-detail/InfoGeraisSecao";
import { useVersaoAnterior } from "@/hooks/useVersaoAnterior";
import { useRevendaPlanejamento } from "@/components/planejamento/planejamento-detail/useRevendaPlanejamento";
import { useGradeComprado } from "@/components/planejamento/planejamento-detail/useGradeComprado";
import { PrecoRevendaBloco, ProdutoAcabadoSecao, GradeRevendaSecao, ProdutoImportadoSecao } from "@/components/planejamento/planejamento-detail/RevendaSetores";
import { usePlanejamentoSave } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";
import { useFichaTecnica } from "@/components/planejamento/planejamento-detail/ficha/useFichaTecnica";
import { useFichaKanban } from "@/components/planejamento/planejamento-detail/ficha/useFichaKanban";
import { opcoesMoverHoje } from "@/components/planejamento/planejamento-detail/ficha/etapa-kanban";
import { opcoesMoverAuto, proximaEtapa } from "@/components/planejamento/planejamento-detail/ficha/etapa-mover";
import { useMoverEtapa } from "@/components/planejamento/planejamento-detail/ficha/useMoverEtapa";
import { EtapaHeader } from "@/components/planejamento/planejamento-detail/ficha/EtapaHeader";
import { etapaDoModelo } from "@/lib/kanban-auto-ui";
import { PrintFicha } from "@/components/producao/PrintFicha";
import { gateEnvioExplosao, pendenciasEnvioExplosao } from "@/components/planejamento/planejamento-detail/ficha/envio-explosao";
import { PedidoSecaoContext, proximoPedido, type PedidoSecao } from "@/components/planejamento/planejamento-detail/secoes-abertas";
import { MenuMaisAcoes } from "@/components/planejamento/planejamento-detail/MenuMaisAcoes";
import { useEnviarExplosao } from "@/components/planejamento/planejamento-detail/useEnviarExplosao";
import { useImportarDados } from "@/components/planejamento/planejamento-detail/useImportarDados";
import { ImportarDadosDialog } from "@/components/desenvolvimento/importar/ImportarDadosDialog";
import { numerarSecoes, resumoColecao, selosSecoesSheet, type SecaoSheetKey } from "@/components/planejamento/planejamento-detail/ficha/selos-secoes";
import { requisitosUniao } from "@/components/planejamento/planejamento-detail/ficha/selos-bom";
import { SeloBadge } from "@/components/planejamento/planejamento-detail/ficha/secoes/SeloBadge";
import { SeloObservacoesBadge, SeloProvaBadge, SeloRelacionadoBadge } from "@/components/planejamento/planejamento-detail/SelosAuxiliares";
import { BomSecoes } from "@/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes";
import { baseCustoPlanejamento, baseMarkupComMO, estimativaComCustosAdicionais, moEmbutidaDoCusto, previstoDaFicha } from "@/components/planejamento/planejamento-detail/custo-base";
import { somaCustosAdicionais } from "@/lib/custo";
import { artigosTecidoPrincipais } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
import { gravarTecidosIniciais } from "@/components/planejamento/planejamento-detail/ficha/persistir-bom";
import { DevEquipeSection } from "@/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection";
import { CodigosSecao } from "@/components/planejamento/planejamento-detail/codigos/CodigosSecao";
import { useSkusAGravar, useSkusModelo } from "@/components/planejamento/planejamento-detail/codigos/useSkusModelo";
import { seloCodigos } from "@/components/planejamento/planejamento-detail/codigos/sku-card";
import { nadaAGravar, refParaPrevia } from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { MotivoCancelamento } from "@/components/planejamento/planejamento-detail/ficha/secoes/MotivoCancelamento";
import { AvisoCamposDev, type MotivoTravaDev } from "@/components/planejamento/planejamento-detail/ficha/secoes/AvisoCamposDev";
import { revendaCampoVisivel } from "@/lib/revenda-config";
import {
  desenvolvimentoCompleto, espelhosDoCard, opcoesOrigem, requeridasPorOrigem, secoesFicha, seloGradeComprado, type EspelhosCard,
} from "@/components/planejamento/planejamento-detail/comprado";
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
  contexto?: ContextoDetalhe;
  /** R14 L3: o host já tem guarda de navegação suja própria (ex.: Integração com campos sujos)? Então o Sheet NÃO
   *  bloqueia a navegação de rota (evita prompt em dobro). Default false: o Sheet bloqueia (`blockNav: dirty`). */
  hostGuardaNavegacao?: boolean;
}) {
  const [idCriado, setIdCriado] = useState<string | null>(null);
  const id = props.modeloId ?? idCriado;
  return <PlanejamentoDetailConteudo key={id ?? "novo"} {...props} modeloId={id} onCreated={setIdCriado} />;
}

function PlanejamentoDetailConteudo({
  modeloId, onClose: onCloseProp, onSaved, contexto = CONTEXTO_PADRAO, onCreated, hostGuardaNavegacao = false,
}: {
  modeloId: string | null;
  onClose: () => void;
  onSaved: () => void;
  contexto?: ContextoDetalhe;
  hostGuardaNavegacao?: boolean;
  /** Card NOVO: chamado com o id depois do INSERT (o wrapper remonta como Sheet desse id). */
  onCreated?: (id: string) => void;
}) {
  // R14 L3: com `blockNav`, o `onClose` do host pode NAVEGAR (ex.: limpa ?modelo= da URL) enquanto `dirty` ainda é true
  // (Descartar, ou fechar após salvar/excluir) — o blocker pediria confirmação DE NOVO. Ao fechar, a navegação passa.
  const fechandoRef = useRef(false);
  const onClose = useCallback(() => { fechandoRef.current = true; onCloseProp(); }, [onCloseProp]);
  // Consome-se sozinho (1 leitura, como o `justClosingRef` do ProdutoAcabadoSheet): nunca vira bypass permanente (B6).
  const navPermitida = useCallback(() => consumirFlag(fechandoRef), []);
  // "Criar produto acabado" fecha pelo MESMO caminho do Voltar/X (pede confirmação se sujo) — o hook é chamado antes do guarda.
  const requestCloseRef = useRef<() => void>(() => {});
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
  // Reforço de segurança S3c (P-244 = B): VALOR de M.O. só quem EDITA o Planejamento E vê custos (a mesma regra do servidor).
  const podeEditarMO = podeEditarValorMO(canEdit, canView);
  const podeVerCustos = canView("criacao_planejamento:custos");
  const podeEditarCustos = canEdit("criacao_planejamento:custos");
  // Permissão à parte SÓ p/ editar o preço de venda (banco enforça via trigger fn_modelo_preco_venda_gate).
  // VER o preço segue sob podeVerCustos; editar o preço passa a exigir esta section.
  const podeAprovarMaoObra = canEdit("producao_servico_aprovacao");
  // F3.1 — campos vindos do Desenvolvimento (decisão F3 #8): EDITAR exige canEdit da página do Dev; sem ela o
  // Salvar OMITE esses campos (`aplicarRegrasCamposDev`). VER (canView) entra com as seções (Task 5).
  const podeEditarDev = canEdit("criacao_desenvolvimento");
  const podeVerDev = canView("criacao_desenvolvimento");
  // F3.6 (seção "4. Códigos" — F3.5b do SKU): SKUs = ver/editar o Planejamento (spec SKU §4.4; o servidor confere no wrapper).
  const podeVerPlanejamento = canView("criacao_planejamento");
  const podeEditarPlanejamento = canEdit("criacao_planejamento");
  // P-53 A (fix 1, m-3) — a permissão de preço (`criacao_planejamento:preco_venda`) é uma seção À PARTE,
  // mas o Salvar do Planejamento é quem grava o valor digitado — sem TAMBÉM exigir `podeEditarPlanejamento`,
  // quem tem só a seção de preço (mas não edita o Planejamento) via a UI destravada e o Salvar descarta o
  // valor em silêncio (`aplicarRegrasCamposPlanejamento` apaga `preco_venda`/`preco_atacado`/`preco_anterior`
  // do payload) — campo editável que nunca salva. Variável ÚNICA usada na UI (PrecoTabela/PrecoRevendaBloco)
  // E no hook de save (mesmo nome que antes, para não espalhar o `&&` em vários pontos).
  const podeEditarPreco = canEdit("criacao_planejamento:preco_venda") && podeEditarPlanejamento;
  // Reforço de segurança S3d (C-14/C-15): markup/preço fixo do comprado = EDITAR o Produto Acabado OU a seção de preço (o mesmo
  // OU do servidor em salvar_markups/salvar_precos_fixo_produto_acabado); a trava do Planejamento (planBloqueado) segue por fora.
  const podeEditarPrecoComprado = canEdit("criacao_planejamento:preco_venda") || canEdit("criacao_produto_acabado");

  // Colab (spec 2026-08-03, Task 2): o queryFn agora só BUSCA (sem side-effects de setState —
  // roda em TODO refetch, não só na 1ª carga). Seed/merge acontecem no useEffect mais abaixo.
  // F3.1: SUBIU para cá (antes vinha logo antes do merge) — a trava dos campos do Dev, logo abaixo, lê
  // `enviado_cad`, e a F3.2 passa essa trava ao `useFichaTecnica`, chamado ANTES do cálculo de preço e do
  // "não salvo". Mesma queryKey, mesmo queryFn; só a posição (e a ordem dos hooks) mudou.
  const { data: modeloData, isError: modeloErrored, refetch: refetchModelo } = useQuery({
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
  // P-53 A (revisão da parte 1, dono 26/set): o Sheet decide POR SEÇÃO pelas DUAS permissões — não herda mais a
  // trava da PÁGINA onde foi aberto (ex.: kanban do Dev). "Nem ganha, nem perde": editável se algum dos 2 Sheets
  // antigos deixava editar. Ver src/components/planejamento/planejamento-detail/permissoes-sheet.ts.
  const perm = resolverPermissoesSheet({ podeEditarPlanejamento, podeEditarDev, devBloqueado });
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  // Fix hidratação (P-57 A): true depois que a 1ª carga de ["modelo", modeloId] semeou o
  // draft (ramo `!baseRef.current` do efeito abaixo). Enquanto false E isEdit, mostra
  // "Carregando o card…" no lugar do corpo e trava o Salvar — sem isso, o usuário edita em
  // cima do `emptyDraft()` e o seed sobrescreve/zera o touched (investigação 26/set, §1.2).
  const [semeado, setSemeado] = useState(false);
  // MO por serviço (spec 2026-08-06): rascunho LOCAL das linhas (VALOR editável) — fora do
  // `draft` principal; persiste no Salvar da página via RPC `salvar_modelo_servico_mo`. O
  // baseline (`moLinhasBase`) é o estado do servidor semeado do resumo; a divergência acende
  // o indicador de "não salvo". Refs p/ leitura síncrona (seed guardada + save mutationFn).
  const [moLinhas, setMoLinhas] = useState<MaoObraEditorLinha[]>([]);
  const [moLinhasBase, setMoLinhasBase] = useState<MaoObraEditorLinha[]>([]);
  const moLinhasRef = useRef(moLinhas); moLinhasRef.current = moLinhas;
  const moBaseRef = useRef(moLinhasBase); moBaseRef.current = moLinhasBase;
  // SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.2.1 — P-46): o Regerar e o SKU à mão ficam "a gravar" FORA do Draft
  // (como as linhas de MO) — declarado AQUI, antes do `dirty`, que depende dele. Só o Salvar grava (aoSalvar).
  const skusAGravar = useSkusAGravar();
  // Serviços de M.O. JÁ PERSISTIDOS (baseline do servidor) — aprovar/reprovar (RPC imediata) só
  // vale nesses; linha recém-adicionada (só no rascunho) pede Salvar antes (senão "linha não
  // encontrada"). Deriva do baseline, não de `moLinhas`, pra uma linha nova não se auto-habilitar.
  const moLinhasPersistidas = useMemo(
    // Ids das linhas JÁ salvas no banco (multi-instância: aprovar é por id). Linha nova (sem id) fica de fora.
    () => new Set(moLinhasBase.map((l) => l.id).filter((x): x is string => !!x)),
    [moLinhasBase],
  );
  const { dirty: draftDirty, reset: resetDraftBaseline } = useDirtySnapshot(draft);
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
  // Ajuste (set/2026): mesma guarda pro Duplicar — `duplicate.isPending` só atualiza no
  // próximo render, então um clique duplo rápido dispara 2 `mutate()` antes do 1º re-render
  // marcar `isPending=true` e cria 2 cópias.
  const duplicandoRef = useRef(false);
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
  // F3.3 — o "Ver no Desenvolvimento" SAIU (abria um 2º editor do mesmo BOM por cima do card; o Sheet já tem as seções do
  // Dev). Estado dos links "Para enviar, falta…", da impressão da Ficha Técnica e da confirmação do envio.
  const [pedidoSecao, setPedidoSecao] = useState<PedidoSecao>(null);
  const abrirSecao = (chave: string) => setPedidoSecao((p) => proximoPedido(p, chave));
  const [printTecnicaToken, setPrintTecnicaToken] = useState(0);
  const [confirmEnviarExplosao, setConfirmEnviarExplosao] = useState(false);
  // "Cancelar Ordem de Criação" é NEUTRO no menu ⋯ (R7, mockup — sem vermelho), mas é ação sensível:
  // confirma por AlertDialog antes de reverter `ordem_criacao_enviada` (instrução do orquestrador da T9).
  const [confirmCancelarOrdem, setConfirmCancelarOrdem] = useState(false);
  const { isModuleEnabled } = useTenantModules();
  const otbOn = isModuleEnabled("otb");
  // Revenda (Produto Acabado, Task 7): card revenda ganha campo de preço atacado + grade
  // cor×tamanho + atalhos pro planejador Produto Acabado — só quando o módulo está ligado.
  const paOn = isModuleEnabled("produto_acabado");
  // F3.4 — Produto Importado (opt-in, `produto_importado`): Origem "Importado" no Select e a grade/seção do importado.
  const piOn = isModuleEnabled("produto_importado");
  // [modularidade F2, F4a] Explosão = Entrada e Saída (T1: o servidor recusa `enviar_modelo_para_cad` sem E&S): o botão avisa ANTES.
  const requerEs = useRequerModulo("entrada_saida");
  // isRevenda = ESPECÍFICO de revenda (edição de preço atacado/grade via `produtos_acabados`).
  // isComprado = revenda OU importado — a semântica "comprado vs fabricado" (esconder tecido/
  // custo/MO). Importado tem tela própria de edição (`criacao.produto-importado`), então aqui
  // só herda o ESCONDER; nunca entra nos blocos de edição de revenda (`produtos_acabados`).
  // Fix final M4 — card comprado dispara ~14 queries `plan-ficha-*` e pisca "Carregando…" por um instante.
  // Causa: no 1º render o draft é `emptyDraft()` (origem "interno" — modelo-shared.ts), então `isComprado`
  // saía `false` até o `useEffect` de seed (~:603-621) semear `draft` a partir de `modeloData`. `useFichaTecnica`
  // já roda com esse `isComprado` errado ANTES do seed — `habilitada=true` dispara as 5 queries do BOM
  // (`plan-ficha-*`) para um card que É comprado, pisando o "Carregando…" das seções do BOM. Fix: enquanto o
  // draft ainda não foi semeado (`!baseRef.current` — a MESMA flag que o efeito de seed usa pra saber se é a
  // 1ª carga), deriva `isComprado` direto de `modeloData?.origem` (já disponível, sem query nova); depois do
  // seed, `draft.origem` já É o do servidor e os dois caminhos coincidem.
  const isRevenda = draft.origem === "revenda";
  const isComprado = ehOrigemComprada(baseRef.current ? draft.origem : ((modeloData as any)?.origem ?? draft.origem));
  // Fix final ROUND 2, item 4 — M4 sobrou pra quando o cache de `["modelo", id]` está FRIO: com
  // `!baseRef.current` E `modeloData` ainda `undefined` (query em voo, sem dado nenhum no cache),
  // o fallback acima cai em `draft.origem` = `"interno"` (o `emptyDraft()`) — `isComprado=false` por
  // engano, mesmo sendo um card de revenda/importado. `isComprado` (acima) continua servindo o resto
  // do componente (JSX/gate do Duplicar) sem mudar; SÓ o valor que vai para `useFichaTecnica` fica
  // mais estrito: "comprado OU indefinido (1ª carga, cache frio) ⇒ trata como comprado" — a ficha só
  // usa o comportamento INTERNO (grade/CAD do Tecido 1) quando já dá pra confirmar que o modelo é
  // interno (draft semeado OU `modeloData` já chegado).
  // Fix round 1 (M1) — comentário CORRIGIDO: o texto antigo dizia "⇒ NÃO habilita", mas isso ficou
  // FALSO desde a Task 4/F3.4 (`useFichaTecnica.habilitada` não exclui mais `isComprado` — a ficha
  // agora ABRE para o comprado, sem grade própria e sem CAD, conforme decisão F3 #4). `isCompradoParaFicha`
  // não decide "habilita ou não"; decide se `useFichaTecnica` PROJETA o card como comprado (sem grade
  // do Tecido 1, sem CAD gravável) mesmo antes do seed — evita um flash com o comportamento INTERNO
  // (ex.: pré-preenchimento de Tecido 1..N) para um card que É comprado.
  // Card novo (Dialog, sem `modeloId`) não quebra: `useFichaTecnica.habilitada` já exige `isEdit`.
  const isCompradoParaFicha = isComprado || (isEdit && !baseRef.current && !modeloData);
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
      // null (não undefined): o TanStack recusa `undefined` ("Query data cannot be undefined") — vem sem permissão de custos / modelo apagado.
      return (((data ?? {}) as any)[modeloId as string] ?? null) as { previsto: number; real: number; confirmado: boolean } | null;
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

  // Cálculo de preço (seção "Preço e Custos"). F3.2 (decisão F3 #6): o `precoInfo` foi para DEPOIS da estimativa
  // — o custo-base agora é real › previsto do BOM › estimativa (ver `custoBase` mais abaixo).
  const custoReal = !!custoData?.confirmado;

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

  // F3.2 — BOM do Desenvolvimento no Sheet (Tecidos/Aviamentos/Insumos/Grade + custos do BOM). Hook SEMPRE
  // chamado (regra dos hooks); inerte no card novo, no comprado e sem `canView("criacao_desenvolvimento")`.
  // Trava ÚNICA (R2 do G-plano conjunto): `motivoTravaDev` vem da F3.1 (declarado logo depois das permissões, antes
  // daqui — por isso a query do modelo subiu lá) e já considera o "Editar".
  const ficha = useFichaTecnica({
    modeloId, isEdit, isComprado: isCompradoParaFicha,
    tecidosPlanejados: draft.tecidos_planejados,
    proporcoes: draft.proporcoes,
    custosAdicionais: draft.custos_adicionais,
    setDraftTracked,
    maoObraVivo: maoObraDevLive,
    travaDev: motivoTravaDev,
    // F3.3 — D2: o CAD só nasce depois da Ordem de Criação. Lê o SERVIDOR (o `enviada` local é declarado mais abaixo).
    ordemEnviada: !!(modeloData as any)?.ordem_criacao_enviada,
    // Fix I-1 (review T3+T7) — a Grade Total sem proporção reparte só entre os tamanhos visíveis do "Tamanho em".
    tamanhoTipo: draft.tamanho_tipo,
  });
  // F3.2 (Task 13) — espelho SÍNCRONO de `ficha` p/ o Duplicar: a `mutationFn` faz um `await` (busca da
  // versão máxima) ANTES de ler `ficha.carregado`/`ficha.estado` — mesma classe de risco que o `fichaRef`
  // do `usePlanejamentoSave.ts` documenta (closure de um render que pode ficar velho durante o `await`,
  // se o componente renderizar de novo nesse meio-tempo). `ficha` some render; a ref garante que o
  // `mutationFn` sempre leia o estado do BOM mais recente na hora de montar a cópia.
  const fichaRef = useRef(ficha);
  fichaRef.current = ficha;
  // Fix round 4 (itens 1 e 2) — decisão F3 #2: qualquer uma das duas permissões de custo libera a
  // visão de custo derivado (sugerido/markup/faixas/"Materiais do BOM"/"Custos do BOM"/MO na Parte 3).
  // `podeVerCustos` = page-level do Planejamento (`criacao_planejamento:custos`); `ficha.podeVerCustos` =
  // `criacao_planejamento:custos` OU `criacao_desenvolvimento:custos` (já é união — ver useFichaTecnica.ts).
  // Usar SEMPRE `veCustos` (não `podeVerCustos` sozinho) onde a tabela/seção decide MOSTRAR custo derivado.
  const veCustos = podeVerCustos || ficha.podeVerCustos;
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
  // tecido + aviamento + M.O.; o "Custo total" estimado da tabela = isso + custos adicionais (`estimativaBase` abaixo).
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

  // F3.2 — decisão F3 #6: o markup e a tabela usam o MESMO custo-base, com selo de 3 estados. Previsto = o do BOM
  // AO VIVO quando a ficha está carregada (e o BOM tem material); senão o salvo (custo_peca_previsto do Dev).
  // Fix round 4 (item 1, IMPORTANTE — vazamento de informação): `custoData` já vem mascarado (`{}`) do RPC
  // `custo_unitario_modelos` sem permissão (invariante #12), mas `ficha.totais`/`simCalc` são calculados NO
  // CLIENTE a partir do BOM/rascunho — sem gate, vazavam sugerido/markup/faixas mesmo sem `veCustos`. Sem
  // `veCustos`: previsto e estimativa caem a 0 ⇒ `custoBase.valor` = 0 (real já vem mascarado do servidor) ⇒
  // `precoInfo` devolve custo/sugerido/markup = 0 ⇒ a tabela mostra "—" em tudo, exatamente como antes da T12.
  // F3.4 — comprado: o previsto é o do SERVIDOR (revenda = unit real + insumos; importado = landed —
  // `_custo_unitario_modelos_core`), nunca o total do BOM da ficha (que agora carrega também p/ comprado).
  // Preço M6: no IMPORTADO a base do markup soma a M.O. ao vivo (real ‖ previsto + M.O.), igual à revenda e ao banco.
  const ehImportadoBase = draft.origem === "importado";
  const previstoCompradoBase = ehImportadoBase ? baseMarkupComMO(custoData?.previsto, maoObraDevLive) : Number(custoData?.previsto) || 0;
  const realServidorBase = ehImportadoBase ? baseMarkupComMO(custoData?.real, maoObraDevLive) : custoData?.real;
  const previstoBase = !veCustos ? 0 : ficha.carregado && !isComprado ? previstoDaFicha(ficha.totais) : previstoCompradoBase;
  // Fix pós-rebase (item 7 — paridade com o Dev): a estimativa SOMA os custos adicionais (`estimativaComCustosAdicionais`,
  // custo-base.ts — `preco.ts`/`custoSimulado` intocados, invariante #8). A tabela mostra as linhas "Custos adicionais"
  // no estimado, então o Custo total fecha.
  const estimativaBase = veCustos ? estimativaComCustosAdicionais(simCalc.total, draft.custos_adicionais) : 0;
  const custoBase = baseCustoPlanejamento({ confirmado: custoReal, realServidor: realServidorBase, previsto: previstoBase, estimativa: estimativaBase });
  const { custo, markupLinha: markup, preco, sugerido: precoSug, efetivo: precoEfetivo, markupReal } =
    precoInfo(custoBase.valor, linhas.find((l) => l.id === draft.linha_id)?.markup, draft.preco_venda, draft.markup_editado);
  // M.O. embutida no custo-base: a real (Serviços ÷ grade) quando confirmado; senão a planejada ao vivo.
  const moEmbutida = moEmbutidaDoCusto({ selo: custoBase.selo, importado: ehImportadoBase, maoObraSetor, maoObraDevLive });
  const materiaisSetor = custo > 0 ? Math.max(0, custo - moEmbutida) : 0;

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
  const materiaisParaFaixa = materiaisSetor; // F3.2 #6: mesma base do markup (real / previsto / estimado)
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
  // M6: no importado o previsto comparado com a base JÁ inclui a M.O. (senão 'antes (previsto)' aparece falso).
  const custoPrevisto = ehImportadoBase ? previstoCompradoBase : Number(custoData?.previsto) || 0;

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
  // F3.6 (ruling 1) — a MARCA da loja (`tenants.nome`, não o WISH360) p/ o Título automático da seção 1; mesma query cacheada
  // dos relatórios (useTenantBranding).
  const { nome: nomeLoja } = useTenantBranding();
  // P-146..P-158 + R4 — a VERSÃO ANTERIOR do card (fonte única no SQL, RPC `modelos_versao_anterior`). Só na v2+ SALVA (a v1
  // nunca tem anterior — sem consulta na maioria dos cards); uma Versão digitada e ainda não salva só vale depois do Salvar.
  const versaoSalva = Number((modeloData as { versao?: number } | undefined)?.versao ?? 1);
  const temVersaoAnterior = isEdit && !!modeloId && versaoSalva > 1;
  const versaoAnt = useVersaoAnterior(modeloId && temVersaoAnterior ? [modeloId] : [], temVersaoAnterior);
  const versaoAnterior = temVersaoAnterior && modeloId ? versaoAnt.mapa.get(modeloId) ?? null : null;
  // I1 (revisão front): "carregando" = pedido e ainda sem dado; "erro" = falhou SEM dado em cache (mostra a falha com
  // "Tentar de novo"). Um refetch em segundo plano que falha com dado em cache segue o dado anterior — campo editável.
  const versaoAnteriorCarregando = temVersaoAnterior && versaoAnt.carregando;
  const versaoAnteriorErro = temVersaoAnterior && versaoAnt.erro;
  const tentarVersaoAnterior = versaoAnt.tentarDeNovo;
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
    modeloId, isEdit, isRevenda, paOn, draft, baseRevendaMarkup, categorias,
    qc, navigate, contexto, onClose: () => requestCloseRef.current(),
  });
  const { produtoRevenda } = revenda;
  // F3.4 — grade cor × tamanho do COMPRADO (revenda E importado), fonte ÚNICA da grade do comprado (decisão F3 #4). Lê o
  // produto da origem SALVA (a do servidor — a troca no Select só vale depois do Salvar). MESMA posição de antes (a grade
  // saiu do `useRevendaPlanejamento`): antes dos effects de seed de MO e do merge do colab (o seed copia `revRef.current`).
  // Nome `origemComprado` (não `origemSalva`) — rebase-cadeia F3.1 FINAL: evita colidir com o `origemSalva` do bloco
  // "Mover para…" do kanban (F3.1 final, mais abaixo neste componente — mesmo nome, escopo/semântica diferentes).
  const origemComprado = String((modeloData as any)?.origem ?? "interno");
  const gradeComprado = useGradeComprado({
    modeloId, isEdit, origem: origemComprado, moduloOn: origemComprado === "importado" ? piOn : paOn,
    grupos, tenantIdAtivo, revRef,
    // Importado: a célula editada marca a ficha (a grade grava pelo BOM — conferência R5/R5a protege o Salvar).
    aoEditar: origemComprado === "importado" ? () => ficha.marcarGradeExternaEditada() : undefined,
  });
  const {
    gradeRevenda, setGradeRevenda, gradeRevendaBaseRef, gradeRevendaRevRef, gradeRevendaDirty, buildLinhasGradeRevenda,
  } = gradeComprado;
  // ── F3.4 — Origem (decisão F3 #3 + D1; R3/R7 do G-plano F3.4): "Importado" com o módulo; a troca olha o que o card JÁ
  // TEM no servidor. Tecido no BOM (servidor OU já na ficha carregada): tecido reserva estoque — num comprado ficaria
  // escondido reservando.
  const { data: temTecidosServidor = false } = useQuery({
    queryKey: ["plan-origem-tem-tecidos", modeloId],
    enabled: isEdit && !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelo_tecidos").select("id").eq("modelo_id", modeloId as string).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });
  // R3 — os DOIS espelhos do card (invariante #13), QUALQUER que seja a origem (um card interno pode já ter sido comprado —
  // o produto continua vinculado na tela dele).
  // Fix round 1 (I3) — premissa errada corrigida: `produtos_acabados` TAMBÉM tem `modgate_sel` RESTRICTIVE (módulo
  // `produto_acabado`; `savepoints/.../policies.csv:559`) — sem `paOn`, o SELECT volta vazio SEM erro, exatamente como
  // `produtos_importados`. Lida SÓ com `paOn` (mesmo padrão do `piOn` abaixo); sem `paOn`, `acabado` fica INDETERMINADO
  // (null) — `espelhosDoCard` já trata os dois lados assim. Key ganha `paOn` (prefixo de `piOn`, mesma convenção).
  const qEspelhos = useQuery({
    queryKey: ["plan-origem-espelhos", modeloId, paOn, piOn],
    enabled: isEdit && !!modeloId,
    queryFn: async (): Promise<EspelhosCard> => {
      let acabados: { ocs: { id: string }[] | null }[] | null = null;
      if (paOn) {
        const pa = await (supabase.from("produtos_acabados" as any) as any)
          .select("id, ocs:ocs_p_acabado(id)")
          .eq("modelo_id", modeloId);
        if (pa.error) throw pa.error;
        acabados = pa.data ?? [];
      }
      let pi: { ocs: { id: string }[] | null }[] | null = null;
      if (piOn) {
        const r = await (supabase.from("produtos_importados" as any) as any)
          .select("id, ocs:ocs_importado(id)")
          .eq("modelo_id", modeloId);
        if (r.error) throw r.error;
        pi = r.data ?? [];
      }
      return espelhosDoCard({ acabados, importados: pi });
    },
  });
  const origemOpcoesLista = opcoesOrigem({
    isEdit, salva: origemComprado, atual: draft.origem, piOn,
    temTecidos: temTecidosServidor || (ficha.carregado && ficha.estado.blocks.some((b) => !!b.artigo_id)),
    // Carregando ou com erro ⇒ null ⇒ nenhuma troca no escuro (falha fechada).
    espelhos: qEspelhos.data ?? null,
    // R7 — a ficha projeta pela origem do RASCUNHO e a grade segue a SALVA: trocar com edição pendente deixaria a referência
    // do BOM calculada com a OUTRA projeção ("Tecidos & BOM" falso). Sem edição, a referência re-baseia sozinha.
    edicaoPendente: ficha.tocado || gradeComprado.gradeRevendaDirty,
  });
  // Dirty combinado: draft OU linhas de MO OU grade revenda divergem do baseline (mantidos em
  // baselines INDEPENDENTES — cada um re-semeia no seu próprio momento, sem corrida de ordem
  // entre os carregamentos assíncronos).
  const dirty = draftDirty || !moLinhasEqual(moLinhas, moLinhasBase) || gradeRevendaDirty || ficha.dirty || !nadaAGravar(skusAGravar.aGravar);
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose, blockNav: !hostGuardaNavegacao, navPermitida });
  requestCloseRef.current = requestClose;
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
  const { data: cqInfo, isLoading: cqInfoCarregando } = useQuery({
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
  // [modularidade P-252 A] o CQ só é exigido para Lançar se a loja tem o módulo Produção (o servidor decide igual:
  // `lancar_modelo`); sem Produção basta a mão de obra aprovada e a data.
  const cqExigido = isModuleEnabled("producao");

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
      empresa_id: l.empresa_id ?? null, empresa_nome: l.empresa_nome ?? null, // [urg R4] fornecedor de serviço da linha
    })) as MaoObraEditorLinha[];
    if (!moLinhasEqual(moLinhasRef.current, moBaseRef.current)) return; // preserva edições não salvas
    setMoLinhas(seed); setMoLinhasBase(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moResumo]);

  // Gate do botão Lançar: liberada = sem serviço OU todas as linhas aprovadas. Derivado das
  // linhas LOCAIS (`estadoMO`) — reflete aprovações imediatas sem esperar o refetch do resumo.
  const moEstadoLocal = estadoMO(moLinhas);
  // Contas certas item 8 (P-163 A): linha aprovada com valor/serviço mudado e AINDA NÃO salvo conta como pendente — o
  // Salvar a reabre no servidor; sem isto o Lançar (que não passa pelo Salvar) lançaria com a M.O. antiga aprovada.
  const moReabreAoSalvar = moLinhas.some((l) => l.id != null && moLinhaVaiReabrir(l, moLinhasBase.find((b) => b.id === l.id)));
  const maoObraPendente = !(moEstadoLocal === "sem_servico" || moEstadoLocal === "aprovada") || moReabreAoSalvar;

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
  // Integração (F4, spec §6/§8): produto integrável/integrado = campos marcados travados. O BANCO recusa (gatilhos
  // trg_zz_integracao_trava); a tela só espelha — selo no cabeçalho, campos desabilitados, Excluir travado.
  // Fix round 3 (R-6 da re-revisão) — `sempreAoAbrir: true`: SÓ o Sheet do Planejamento (que de fato trava
  // campos e bloqueia Salvar) força o refetch a cada abertura de card EXISTENTE (`isEdit`; o Dialog "Novo card" usa
  // este mesmo componente e não precisa — NF-2 da re-revisão 3) — os outros consumidores futuros
  // (card do Plan. Produto, Produto Acabado/Importado, slot do Plan.Tecido, Dialog "Novo card") usam o
  // default (staleTime 30s) e não pagam um RPC cheio por montagem.
  const estadoIntegracao = useIntegracaoEstado(isEdit ? modeloId : null, { sempreAoAbrir: isEdit });
  const travaIntegracao = colunasTravadas(estadoIntegracao);
  // REF editável = a seção "Códigos" (F3.6) mostra o campo (etapa configurada) e os campos do Dev estão livres.
  const refEditavel = isEdit && !devBloqueado && kanbanCard.refNaEtapa && !travaIntegracao.has("ref");
  // Comprado (revenda/importado) segue a config "Fluxo de Revenda" da loja (decisão F3 #8; paridade com
  // ModeloDetailPanel.tsx:1574). Interno vê tudo.
  const campoVisivelDev = (key: string) => !isComprado || revendaCampoVisivel(kanbanCard.revendaCfg, key);
  // "Mover para…" do selo (a etapa fica FORA do Salvar — decisão 13).
  const moverEtapa = useMoverEtapa(modeloId, tenantIdAtivo);
  // F3.6 — matriz de SKUs do card (RPC `skus_modelo`, F3.5a) + 1ª geração pós-Salvar (R12). SKU em PRÉVIA: a prévia usa a REF que
  // o Salvar vai gravar (a do rascunho só quando ela vai no payload — refEditavel) e o "Tamanho em" do rascunho (vai sempre).
  const skus = useSkusModelo(modeloId, isEdit && !!modeloId && podeVerPlanejamento, podeEditarPlanejamento && !travaIntegracao.has("sku"), {
    refPrevia: refParaPrevia({ refVaiNoSalvar: refEditavel, refRascunho: draft.ref, refSalva: (modeloData as any)?.ref ?? "" }),
    tamanhoTipo: draft.tamanho_tipo,
    aGravar: skusAGravar,
  });

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
      setSemeado(true);
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
    // F3.2 — o rev mudou (save de outra pessoa, eco do meu, ou ação MINHA que mexe em `modelos` — Mover para…, Ordem,
    // Lançar, aprovar MO): sem BOM tocado ⇒ recarrega o BOM (o baseline acompanha); com BOM tocado ⇒ a ficha CONFERE se
    // o BOM do servidor mudou de verdade e só então acende "Tecidos & BOM" (R5 — o eco das próprias ações é ignorado).
    // Vale mesmo se o draft escalar não mudou (Dev :838-843).
    ficha.colab.aoMudarNoServidor();
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
  // ModeloDetailPanel.tsx:2273) e avisa o container (lista por baixo). SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.2.5
  // e §6): o modelo JÁ foi gravado; agora os SKUs "a gravar" (`aplicarAGravar` — a prévia vista, assinatura conferida no
  // servidor) e, se não falharem, a 1ª geração automática (`gerarSeFaltar`, só num card que continua sem NENHUM SKU — P-50 A).
  // Fix 1 (T5, revisão Opus C1) — a suspeita do adendo original (inverter a ordem porque um digitado num card virgem
  // "roubava" a 1ª geração das outras linhas) tinha uma saída MELHOR do que inverter a ordem: card VIRGEM com algo "a
  // gravar" usa modo 'criar' na prévia E no aplicar (useSkusModelo.ts) — um plano só, automáticas + digitado, sem
  // depender de duas chamadas separadas. Com isso a ordem aplicarAGravar → gerarSeFaltar (a do spec) volta a ser
  // correta: card virgem SEM nada "a gravar" continua caindo no `gerarSeFaltar` (P-50 A); card virgem COM algo "a
  // gravar" já sai gerado por inteiro do `aplicarAGravar` (modo 'criar'), e o `gerarSeFaltar` que roda depois não
  // encontra mais nada pendente (não repete trabalho, `deveGerarPrimeiraVez` já dá false). Erro no `aplicarAGravar`
  // (`"falhou"`) NÃO tenta a 1ª geração — evita rodar sobre um estado que a prévia não confirmou. Aguardado pelo
  // usePlanejamentoSave: o Salvar segue "salvando" até os dois passos terminarem.
  const aoSalvar = async () => {
    setEditandoDev(false);
    onSaved();
    // P-146/P-155 B: a Versão (ou o preço/título que as versões seguintes herdam) pode ter mudado neste Salvar.
    void qc.invalidateQueries({ queryKey: ["versao-anterior"] });
    if (!isEdit) return;
    const r = await skus.aplicarAGravar();
    if (r !== "falhou") await skus.gerarSeFaltar();
  };

  // Salvar (+ retry/merge do P0409) — extraído na F3.0 para `planejamento-detail/usePlanejamentoSave.ts`
  // (texto movido; os refs/estados abaixo continuam daqui e vão com os MESMOS nomes).
  const { save, handleSave, salvarAntes } = usePlanejamentoSave({
    modeloId, isEdit, isRevenda, paOn, piOn, podeEditarPreco, podeVerCustos, podeEditarMO, podeEditarDev, podeEditarPlanejamento, categorias,
    refEditavel, travaIntegracao,
    draft, setDraft, draftLiveRef,
    touchedRef, baseRef, revRef, retryRef, savingRef, conflitosRef, setConflitos, setUltimoMerge,
    setEnviada, setLancado,
    moLinhasRef, moBaseRef, setMoLinhasBase,
    gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,
    // F3.4 — a grade do IMPORTADO grava pelo BOM (a da revenda por `salvar_grade_revenda`). Origem SALVA (a da grade).
    gradeCompradoPeloBom: origemComprado === "importado",
    qc, onSaved: aoSalvar, onCreated, ficha: ficha.save, resetDraftBaseline,
  });
  // F3.3 — Enviar à Explosão (Dev :2402-2433): Salvar + `enviar_modelo_para_cad`; pós-envio re-trava e avisa a lista.
  const enviarExplosao = useEnviarExplosao({
    modeloId, qc, salvarAntes, draftLiveRef,
    bloqueioModulo: requerEs.ok ? null : requerEs.motivo,
    onEnviado: () => { setEditandoDev(false); onSaved(); },
  });
  // F3.3 — Importar dados (Dev :2328-2400): staging no rascunho/BOM/CAD (só o Salvar grava); obs. do bloco grava na hora.
  const importar = useImportarDados({ modeloId, ficha, draft, setDraftTracked, qc });

  // Fix final (F3.1, item 3) — card NOVO: entre o clique em Salvar e o Sheet remontar com o id
  // criado (`onCreated`, key nova no `PlanejamentoDetail` acima), o que se digita no formulário
  // é perdido — o componente inteiro desmonta/remonta. Trava o formulário com `<fieldset
  // disabled>` SÓ nesta janela (card NOVO + 1º save em voo) e mostra "Salvando…" — evita a
  // digitação perdida em vez de tentar preservá-la através da remontagem. Não afeta o card
  // existente: `isEdit` já é `true` ali, então `salvandoNovo` nunca liga.
  const salvandoNovo = !isEdit && save.isPending;

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
    // F3.2 — conflito de SEÇÃO do BOM: "manter meu" fecha o aviso (o próximo Salvar sobrescreve); "usar o novo"
    // descarta as edições do BOM e recarrega do servidor (Dev :1819-1838).
    if (path === "secao:bom") { ficha.colab.resolverConflitoBom(escolha === "meu"); return; }
    const c = conflitos.find((x) => x.path === path);
    if (c) resolverConflito(c, escolha === "dele");
  };

  // Colab: canal por modelo — o registroId vai DENTRO do canal (nunca ler old_record).
  // Qualquer UPDATE na linha `modelos` (inclusive um save de outro usuário) dispara
  // `onMudancaServidor`, que invalida a query e deixa o useEffect de merge acima reconciliar.
  // Fix final (F3.1): também invalida `["plan-kanban-cond", modeloId]` (key do
  // `useFichaKanban.ts:65`) — sem isso, as condições do "Mover para…" e o gate da REF ficavam
  // com o cache velho até um refetch manual quando OUTRA pessoa salvava o modelo.
  const { presentes } = useColabRegistro({
    canal: modeloId ? `colab:modelo:${modeloId}` : null,
    tabela: "modelos",
    registroId: modeloId,
    onMudancaServidor: () => {
      qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["plan-kanban-cond", modeloId] });
      // F3.6 — REF/grade/variantes mudaram no servidor ⇒ a matriz de SKUs relê.
      qc.invalidateQueries({ queryKey: ["plan-skus", modeloId] });
      // SKU em prévia — a prévia relê com o que a outra pessoa salvou (REF/"Tamanho em"/grade).
      qc.invalidateQueries({ queryKey: ["plan-skus-previa", modeloId] });
    },
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
      // Fix m1 (corrida no Cancelar Ordem) — o AlertDialog já re-checa `enviado_cad` no CLIQUE (acima), mas
      // sobra a janela ENTRE esse re-check e este UPDATE (outra pessoa envia à Explosão bem no meio). Sem
      // `.eq("enviado_cad", false)`, o UPDATE cancelaria a Ordem de um card que acabou de sair pro Desenvolvimento
      // via Explosão — mesma classe de corrida que o P0409 cobre no Salvar, mas esta mutation não tem `rev`.
      let query = supabase.from("modelos").update(payload).eq("id", modeloId);
      if (!send) query = query.eq("enviado_cad", false);
      const { data, error } = await query.select("id");
      if (error) throw error;
      if (!send && (data ?? []).length === 0) {
        // 0 linhas = o `.eq("enviado_cad", false)` não bateu: o card foi enviado à Explosão no meio do caminho.
        // MESMO toast PT que o re-check do "Sim, cancelar" já usa (não duplicar mensagem).
        throw new Error("ENVIADO_NO_MEIO");
      }
    },
    onMutate: (send: boolean) => setEnviada(send),
    onError: (e: any, send: boolean) => {
      setEnviada(!send);
      // Fix m1 — 0 linhas afetadas pelo `.eq("enviado_cad", false)`: mesmo toast PT do re-check do "Sim,
      // cancelar" + invalida o modelo (o card já está enviado; o card/menu precisam refletir isso).
      if (e?.message === "ENVIADO_NO_MEIO") {
        toast.error("Este card já foi enviado à Explosão — a Ordem de Criação não pode mais ser cancelada.");
        qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
        return;
      }
      toast.error(mensagemErro(e, "Erro"));
    },
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
        const faltas = bloqueiosLancar({ cqExigido, cqLiberado: cqConfirmado, moAprovada: !maoObraPendente, temData: !!draft.data_lancamento, moReabreAoSalvar });
        if (faltas.length > 0) throw new Error(faltas[0]);
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
  // [camada C2 · P-263 A] "Cancelar Lançamento" desfaz: pede "Tem certeza?" antes. "Lançar" segue direto (Seção 2 não implementada).
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao(lancar.isPending);

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
      // F3.2 — decisão F3 #9: a nova versão herda o Planejamento + os TECIDOS (só o artigo); o resto do
      // Desenvolvimento (equipe, datas, proporções, custos adicionais…) nasce vazio — já saiu no `camposParaDuplicar`
      // da F3.1 (lista ÚNICA `CAMPOS_DEV_DRAFT`). O BOM da cópia é gravado como Tecido 1..N logo após o insert (uma
      // fonte só; a lista segue derivada): com a ficha carregada, os artigos PRINCIPAIS dos blocos Tecido (sem
      // substitutos); sem ela, a lista salva (comportamento de hoje). Comprado (revenda/importado) nunca tem BOM
      // manufaturado (F3.2, decisão F3 #4) — `gravarTecidosIniciais` só roda para origem NÃO comprada.
      // Fix round 4 (item 6, T13 m1) — COMPRADO nunca tem `fichaRef.current.carregado` true (a ficha nem
      // habilita p/ comprado — `habilitada = isEdit && !isComprado && ...`), então caía sempre no fallback
      // `.slice(0, 3)` — truncando a lista de comprado p/ 3 itens na cópia. Comprado não usa `tecidos_planejados`
      // como BOM (é só coluna de texto, sem `gravarTecidosIniciais`), então a cópia deve levar a lista INTEIRA,
      // como antes da T13 (sem truncar).
      const tecidosDaCopia = isComprado
        ? draft.tecidos_planejados
        : fichaRef.current.carregado
          ? artigosTecidoPrincipais(fichaRef.current.estado.blocks)
          : draft.tecidos_planejados.slice(0, 3);
      payload.tecidos_planejados = tecidosDaCopia;
      const { data: novo, error } = await supabase.from("modelos").insert(payload).select("id").single();
      if (error) throw error;
      if (novo?.id && !ehOrigemComprada(payload.origem ?? draft.origem)) {
        try {
          await gravarTecidosIniciais(novo.id, tecidosDaCopia);
        } catch (eT) {
          (eT as any).etapaFalha = "tecidos";
          throw eT;
        }
      }
    },
    onSuccess: () => { toast.success("Card duplicado"); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); qc.invalidateQueries({ queryKey: ["versoes-familia"] }); onSaved(); onClose(); },
    onError: (e: any) => {
      // Acréscimo do controlador (item b) — o INSERT já criou a cópia mesmo quando `gravarTecidosIniciais`
      // falha depois dele: não desfazer. Mesmo padrão do card NOVO no Salvar (usePlanejamentoSave.ts,
      // `etapaFalha === "tecidos"`) — o `prefillPendenteRef` (useFichaBom.ts) faz o PRÓXIMO Salvar, já na
      // nova versão, regravar o BOM sozinho a partir de `tecidos_planejados` (gravado no INSERT acima).
      if (e?.etapaFalha === "tecidos") {
        // Fix round 4 (item 8, T13 m3) — toast honesto: quem NÃO edita o Dev não vai conseguir "salvar de
        // novo" (o Salvar do Planejamento sem `canEdit("criacao_desenvolvimento")` OMITE as colunas do Dev —
        // decisão F3 #8 —, então o BOM nunca seria regravado por essa pessoa). Mesma condição/mesma mensagem
        // em `usePlanejamentoSave.ts` (card novo, `etapaFalha === "tecidos"`).
        toast.error(
          podeEditarDev
            ? "A nova versão foi criada, mas os tecidos NÃO foram para a Ficha (BOM). Abra a nova versão e salve de novo para gravá-los."
            : "A nova versão foi criada, mas os tecidos NÃO foram para a Ficha (BOM). Peça a quem edita o Desenvolvimento para salvar a nova versão.",
        );
        qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
        qc.invalidateQueries({ queryKey: ["versoes-familia"] });
        onSaved();
        onClose();
        return;
      }
      toast.error(mensagemErro(e));
    },
  });

  const iniciarDuplicar = () => {
    if (duplicandoRef.current || duplicate.isPending) return;
    duplicandoRef.current = true;
    duplicate.mutate(undefined, { onSettled: () => { duplicandoRef.current = false; } });
  };
  // P-152 — antes de duplicar, confere as outras versões da família (leitura pela RLS). Sem outras versões
  // duplica direto, como sempre; com outras (ou se a conferência falhar — falha FECHADA) abre o AlertDialog.
  const [dupChecando, setDupChecando] = useState(false);
  const [dupAviso, setDupAviso] = useState(false);
  const versoesDup = useVersoesFamilia(modeloId ? [modeloId] : [], dupAviso, { colecaoId: draft.colecao_id ?? null, subcolecao: draft.subcolecao ?? null });
  // Fechou o Sheet durante a conferência assíncrona → NÃO duplica depois.
  const montadoRef = useRef(true);
  useEffect(() => { montadoRef.current = true; return () => { montadoRef.current = false; }; }, []);
  const handleDuplicate = async () => {
    if (!modeloId || dupChecando || duplicandoRef.current || duplicate.isPending) return;
    setDupChecando(true);
    try {
      const linhas = await qc.fetchQuery({
        queryKey: ["versoes-familia", modeloId],
        staleTime: 0,
        queryFn: () => buscarVersoesFamilia(supabase, [modeloId]),
      });
      if (!montadoRef.current) return;
      if (precisaConfirmar(agruparPorFamilia(linhas, [modeloId]))) setDupAviso(true);
      else iniciarDuplicar();
    } catch {
      if (montadoRef.current) setDupAviso(true); // o diálogo mostra o erro + "Tentar de novo"
    } finally {
      if (montadoRef.current) setDupChecando(false);
    }
  };

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
  const lancarBloqueios = bloqueiosLancar({ cqExigido, cqLiberado: cqConfirmado, moAprovada: !maoObraPendente, temData: !!draft.data_lancamento, moReabreAoSalvar });

  // Selo da etapa no HEADER (decisão 5: Nome → REF → selo). "Planejamento" antes da Ordem de Criação, "Lançado"
  // depois de lançar, senão a coluna (+ automática/fixado c/ a chave ligada). Mover exige editar o Dev (a RPC
  // também exige — kanban_auto_4_rpcs.sql:49-51) e as condições carregadas (a dica não pode mentir).
  const selo = etapaDoModelo(kanbanCard.modeloKanban, kanbanCard.kanbanCfg);
  const podeMover = isEdit && !!modeloId && podeEditarDev && selo.fase === "kanban" && kanbanCard.condProntas;
  // M6 (fix round 1→2, item 5 opcional): quando o card ESTÁ no kanban e o usuário poderia editar
  // o Dev, mas ainda não pode mover porque as duas queries (config da loja + condições) não
  // chegaram, o selo ganha um texto de "carregando"/"erro" em vez de parecer indistinguível de
  // "sem permissão"/"fora do kanban". Round 2 expôs `regrasComErro` (`useFichaKanban.ts`,
  // `isError` das 2 queries) — "erro" quando alguma falhou de verdade; "carregando" senão.
  const seloCarregando: "carregando" | "erro" | false =
    !(isEdit && !!modeloId && podeEditarDev && selo.fase === "kanban" && !kanbanCard.condProntas)
      ? false
      : kanbanCard.regrasComErro ? "erro" : "carregando";
  const origemSalva = kanbanCard.modeloKanban.origem ?? null;
  const opcoesMover = !podeMover
    ? []
    : kanbanCard.kanbanCfg.kanban_automatico
      ? opcoesMoverAuto({ modelo: kanbanCard.modeloKanban, statusEfetivo: kanbanCard.statusEfetivo, cfg: kanbanCard.kanbanCfg, cond: kanbanCard.cond })
      : opcoesMoverHoje({ origem: origemSalva, statusEfetivo: kanbanCard.statusEfetivo, cfg: kanbanCard.kanbanCfg, cond: kanbanCard.cond });
  // "Próxima: X — falta: Y" só com a chave ligada (card automático) — igual ao "próx.: falta X" do board da F2.
  const proxima = kanbanCard.kanbanCfg.kanban_automatico ? proximaEtapa(kanbanCard.derivacao, kanbanCard.kanbanCfg) : null;
  const moverPara = (para: string) => moverEtapa.mutate({
    para, origem: origemSalva, statusAntes: kanbanCard.statusSalvo, fixadoAntes: !!kanbanCard.derivacao?.fixado,
    cfg: kanbanCard.kanbanCfg, cond: kanbanCard.cond,
  });

  // ── F3.3 — numeração "N." e selos de TODAS as seções (adiados da F3.1 — plano F3.1 §7 T2) ─────────────────────────
  // `vis` é a fonte ÚNICA de "a seção aparece?": o JSX abaixo usa ESTES booleanos, então a numeração nunca descola do
  // que está na tela. Ordem/numeração: selos-secoes.ts (mockup gen_main.py:31-106; Dialog "Novo Modelo": gen_novo.py).
  const fichaVisivel = isEdit && !!modeloId && ficha.habilitada;
  // ── F3.4 — seções da ficha por ORIGEM (decisões F3 #4/#8): comprado pelo "Fluxo de Revenda"; grade do Tecido 1 só interno.
  const secFicha = secoesFicha(isComprado, campoVisivelDev);
  // Grade cor × tamanho: a da origem SALVA. Só-leitura com a troca de Origem ainda não salva, ou no importado sem a ficha
  // editável (a grade dele grava pelo BOM — D3 (A)). Revenda: editável como hoje.
  const origemTrocadaPendente = draft.origem !== origemComprado;
  // P-53 A (fix 1, m-2) — a grade do comprado é COMPARTILHADA (paridade com o `locked` do Dev antigo): sem
  // `perm.compartilhadoBloqueado` livre (nenhum dos 2 Sheets destrava), a trava pós-Explosão sozinha
  // (`ficha.podeEditar`) era contornável por quem só edita o DEV com o card já enviado à Explosão (fix 2,
  // item 7 — o comentário da rodada 1 dizia "Planejamento" por engano).
  // Fix 2 (item 4, N-1) — mensagem mais específica: se a pessoa AINDA edita o Dev (só não tem a
  // permissão de Planejamento que faltava aqui — cenário raro, já que quem edita só o Dev normalmente
  // passa pelo ramo `compartilhadoBloqueado=false`), reaproveita o texto "use o botão Editar" (é o
  // mesmo mecanismo do card enviado à Explosão); senão, mensagem genérica de falta de permissão.
  const motivoGradeSomenteLeitura: string | null = origemTrocadaPendente
    ? "Salve a troca de Origem antes de editar a grade."
    : perm.compartilhadoBloqueado
      ? (podeEditarDev
        ? "Card enviado à Explosão: para alterar a grade, use o botão Editar."
        : "Sem permissão para editar esta grade.")
      : origemComprado === "importado" && !ficha.podeEditar
        ? ficha.motivoSomenteLeitura === "enviado"
          // D3 (informado ao dono): depois de enviado à Explosão, a grade do importado trava JUNTO com a ficha.
          // (texto antigo do importado — segue alcançável quando compartilhadoBloqueado=false, ou seja,
          // quem edita o Planejamento OU o Dev sem trava pós-Explosão, mas a ficha do importado específica
          // está travada por outro motivo, ex.: sem canEdit do Dev mas com podeEditarPlanejamento)
          ? "Card enviado à Explosão: a grade do importado trava junto com a ficha — para mudar, use o botão Editar."
          : "A grade do importado grava junto com a ficha do Desenvolvimento — só quem edita o Desenvolvimento a altera aqui (com a ficha carregada)."
        : null;
  // Fix minors (M1) — o texto de "sem produto vinculado" ("salve para criar") só faz sentido quando é O SALVAR do
  // Planejamento que resolve. Com `origemTrocadaPendente`, é exatamente esse Salvar que cria o produto (não exige o
  // Dev) — mantém o genérico. Já com a ficha travada no importado (`motivoGradeSomenteLeitura` do outro ramo), o
  // Salvar do Planejamento sozinho NÃO cria nada (precisa do Dev) — nesse caso o texto de "sem produto" mostra o
  // motivo REAL (`motivoGradeSomenteLeitura`) em vez do "salve para criar" enganoso.
  // Fix 2 (item 5, N-2) — desde o fix 1 (m-1), a auto-criação do espelho no Salvar exige `podeEditarPlanejamento`
  // (não só `paOn`/`piOn`). Sem essa permissão, o texto genérico "Salve o card… para o sistema criá-lo" ficaria
  // enganoso (o Salvar dessa pessoa não cria nada) — mesmo no ramo `origemTrocadaPendente`, onde antes o motivo
  // ficava `null` (texto genérico). Prioridade MÁXIMA: falta de permissão de Planejamento explica por si só por
  // que "sem produto" persiste, então checa ANTES de `origemTrocadaPendente`.
  const motivoSemProdutoComprado: string | null = !podeEditarPlanejamento
    ? "Este card ainda não tem produto vinculado — quem edita o Planejamento o cria ao salvar."
    : origemTrocadaPendente ? null : motivoGradeSomenteLeitura;
  // F3.6 (Parte A — spec §5.1): a Mão de obra deixa de ser seção no Sheet e vira o bloco da linha "Mão de obra" DENTRO de
  // "Preço e Custos"; a condição de exibir é a MESMA de antes (ver custos OU aprovar; comprado só com o card salvo).
  const moBlocoVisivel = (!isComprado ? true : isEdit) && (veCustos || (isEdit && podeAprovarMaoObra));
  // [urg R4] fornecedores de serviço do Select por linha de M.O.: TODAS as empresas tipo 'servico' da loja (P-289 C — não só as
  // vinculadas à categoria do serviço). Só carrega quando o bloco de M.O. aparece; a loja entra na key (super admin troca de loja).
  const { data: empresasServicoMO = [] } = useQuery({
    queryKey: ["empresas-servico-mo", tenantIdAtivo],
    enabled: moBlocoVisivel && !!tenantIdAtivo,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nome_fantasia").eq("tipo", "servico").order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as { id: string; nome_fantasia: string }[];
    },
  });
  const vis: Record<SecaoSheetKey, boolean> = {
    info: true,
    colecao: true,
    // F3.4 (acréscimo do controlador, comparação Dev × Planejamento) — paridade com `s1` (esconde "Informações
    // Básicas" no Dev): hoje sempre true (`revendaCampoVisivel("s1")` sempre devolve true), sem efeito visível.
    desenvolvimento: isEdit && podeVerDev && secFicha.equipe,
    codigos: isEdit && !!modeloId,
    prova: isEdit && !!modeloId && podeVerDev && campoVisivelDev("prova"),
    tecidos: fichaVisivel && secFicha.tecidos, aviamentos: fichaVisivel && secFicha.aviamentos,
    insumos: fichaVisivel && secFicha.insumos, grade: fichaVisivel && secFicha.gradeTecido, cad: fichaVisivel && secFicha.cad,
    tecidos_novo: !isEdit && !isComprado,
    // F3.6 (R1) — Dialog "Novo Modelo" (sem a seção Preço): a MO segue como seção SEM número (mockup gen_novo.py), chave
    // própria como `tecidos_novo`. No Sheet ela mora dentro de "Preço e Custos" (`moBlocoVisivel`).
    mao_obra_novo: !isEdit && moBlocoVisivel,
    preco: isEdit,
    // F3.4 — a mesma chave serve à seção do produto do IMPORTADO ("Produto Importado").
    produto_acabado: isEdit && ((isRevenda && paOn) || (draft.origem === "importado" && piOn)),
    // F3.4 — decisão F3 #4: a grade cor × tamanho é A grade do comprado (revenda E importado), pela seção "s4".
    grade_revenda: isEdit && !!modeloId && isComprado && (isRevenda ? paOn : piOn) && secFicha.gradeComprado,
    anexos: true,
    observacoes: isEdit && !!modeloId && podeVerDev,
    lancamento: isEdit,
    relacionado: isEdit && !!modeloId,
  };
  // R7 do G-plano F3.3 — segue o mockup: no Dialog "Novo Modelo" só "1. Informações" e "2. Coleção" (gen_novo.py:13-20).
  const numeros = numerarSecoes(new Set((Object.keys(vis) as SecaoSheetKey[]).filter((k) => vis[k])), { dialogNovo: !isEdit });
  // F3.4 — requisitos POR ORIGEM nos selos (comprado = `revenda_kanban_requisitos`, sem os impossíveis p/ comprado).
  const requeridasCard = requeridasPorOrigem(
    isComprado,
    requisitosUniao(isComprado ? kanbanCard.revendaCfg.requisitos : kanbanCard.kanbanCfg.kanban_requisitos),
  );
  const selos = selosSecoesSheet({
    requeridas: requeridasCard,
    satisfeitas: ficha.habilitada && ficha.dados.condicoesProntas ? ficha.dados.condicoes : null,
    // Lote B (revisão do commit 6fac668, I3) — mesmo `veCustos` do item I2 acima: o campo continua se chamando
    // `podeVerCustos` (nome inalterado no shape de `selosSecoesSheet`), só o VALOR passado muda (união das 2
    // permissões, não só a page-level do Planejamento).
    podeVerCustos: veCustos,
    infoCompleta: !!draft.nome.trim() && !!draft.estilista_id && !!draft.categoria_principal_id,
    // Brief 25/set — "vazia" (nome, estilista E categoria vazios) ≠ "incompleta" (`infoCompleta` já usa AND).
    infoVazia: !draft.nome.trim() && !draft.estilista_id && !draft.categoria_principal_id,
    colecaoResumo: resumoColecao({
      // [modularidade R11] rótulo da coleção (nome do OTB pelo id, senão o texto): card só-id não mostra a seção "vazia".
      colecao: rotuloColecao({ colecao: draft.colecao, colecaoNome: colecoes.find((c) => c.id === draft.colecao_id)?.nome }),
      subcolecao: draft.subcolecao || null,
      linha: linhas.find((l) => l.id === draft.linha_id)?.nome ?? null,
      semana: draft.semana || null,
      mes: meses.find((m) => m.id === draft.mes_id)?.nome ?? null,
      ano: anos.find((x) => x.id === draft.ano_id)?.nome ?? null,
    }),
    desenvolvimentoCompleto: desenvolvimentoCompleto(draft, campoVisivelDev),
    // Brief 25/set — nenhum de modelista, piloteiros 1–3, datas de piloto 1–3, desenho técnico, aprovação,
    // obs. técnicas preenchido (sem nova query — os campos já vêm do `draft`).
    desenvolvimentoVazia: !draft.modelista_id && !draft.piloteiro1_id && !draft.piloteiro2_id && !draft.piloteiro3_id
      && !draft.data_piloto1 && !draft.data_piloto2 && !draft.data_piloto3 && !draft.data_desenho_tecnico
      && !draft.data_aprovacao && !draft.observacoes_tecnicas.trim(),
    preco: isRevenda ? { efetivo: piRevenda.efetivo, markup: piRevenda.markupReal } : { efetivo: precoEfetivo, markup: markupReal },
    // F3.6 (R15 — item 13 do G-plano): MO pendente/reprovada no selo de Preço, p/ interno E comprado; o estado já está
    // carregado aqui (`moLinhas` → `moEstadoLocal`); só quando o bloco de MO é visível p/ este usuário.
    maoObraAviso: moBlocoVisivel && (moEstadoLocal === "pendente" || moEstadoLocal === "reprovada") ? moEstadoLocal : null,
    anexos: { fotoModelo: draft.fotos_modelo.length > 0, fotoReferencia: draft.fotos_referencia.length > 0, desenho: !!draft.desenho_tecnico_url, croqui: !!draft.croqui_url },
    lancamento: { lancado, data: draft.data_lancamento },
  });
  // F3.4 — selo da grade cor × tamanho (comprado): requisito `grade_preenchida` do fluxo de comprado, senão informativo.
  selos.grade_revenda = seloGradeComprado({
    requeridas: requeridasCard,
    satisfeitas: ficha.habilitada && ficha.dados.condicoesProntas ? ficha.dados.condicoes : null,
    totalGeral: gradeComprado.totalGeralRevenda,
    nVariantes: gradeComprado.variantesRevenda.length,
  });
  selos.codigos = seloCodigos(skus.matriz, skus.temPrevia);
  const seloDe = (k: SecaoSheetKey) => {
    const s = selos[k];
    return s ? <SeloBadge selo={s} /> : undefined;
  };

  // ── F3.3 — Enviar à Explosão: gate pela ETAPA (posição DERIVADA com a chave ligada — decisão 10; Dev :1405-1413) +
  // "Para enviar, falta" (Dev :1576-1598). Só produto interno com a ficha (comprado = F3.4), Ordem enviada, não enviado.
  const gateEnvio = gateEnvioExplosao({
    cfg: kanbanCard.kanbanCfg, explosaoEnvioStatus: kanbanCard.explosaoEnvioStatus,
    statusCru: enviada ? kanbanCard.statusSalvo : null, derivacao: kanbanCard.derivacao, condProntas: kanbanCard.condProntas,
    // Junção L2+L3 (B10, P-213 A): reprovado no Planejamento também não vai à Explosão (≡ SQL _enviar_modelo_para_cad_core).
    statusPlanejamento: kanbanCard.statusPlanejamento,
  });
  // F3.4 — D2 (A): comprado também envia à Explosão, como no Desenvolvimento (ModeloDetailPanel.tsx:1577-1598): a lista
  // "Para enviar, falta" só exige o que a loja deixou VISÍVEL p/ comprado, e a grade é a cor × tamanho.
  const mostraEnviarExplosao = fichaVisivel && enviada && !enviadoCad;
  // Fix round T7 (Important, RULING do controlador) — o card é comprado, "s4" está visível no Fluxo de Revenda, mas o
  // módulo da FAMÍLIA está desligado (Produto Acabado p/ revenda, Produto Importado p/ importado): a seção
  // `grade_revenda` NUNCA aparece nesse caso (`vis.grade_revenda` exige `paOn`/`piOn` além de `secFicha.gradeComprado`),
  // então a grade jamais "preenche" e o Enviar travaria pra sempre com um link morto. Texto honesto, sem link.
  const gradeIndisponivel = isComprado && secFicha.gradeComprado && !(isRevenda ? paOn : piOn)
    ? `Grade cor × tamanho indisponível — o módulo ${isRevenda ? "Produto Acabado" : "Produto Importado"} está desligado nesta loja; peça ao administrador.`
    : undefined;
  // Fix T9 M2 — só calcula/mostra pendências com a ficha CARREGADA: `ficha.estado.blocks`/`.grades` podem estar
  // vazios/parciais enquanto a carga do BOM/CAD roda, e sem este gate "Falta: tecido / grade" piscava durante a
  // carga (mesmo com `gateEnvio.ok`, que só confere a ETAPA do card, não se a ficha já hidratou).
  // Fix round T7 (M2) — comprado: a grade cor × tamanho não vem da ficha (BOM), vem de `gradeComprado`
  // (`useGradeComprado`) — sua PRÓPRIA carga (produto vinculado + `modelo_grades`). Sem esperar por ela também,
  // "Falta: grade preenchida" piscava (Σ=0 durante a carga) mesmo com o card já tendo grade preenchida no servidor.
  // Interno: `gradeComprado.produtoLoading`/`gradeSeeded` são sempre `false`/`true` (a query nem dispara, `on=false`
  // dentro do hook) — sem efeito no caminho de sempre.
  const gradeCompradoPronta = !gradeComprado.produtoLoading && gradeComprado.gradeSeeded;
  // Fix minors (M2) — a query de `modelo_grades` falhou (`gradeModeloError`): `gradeCompradoPronta` já vira `true`
  // (senão "Carregando a ficha…" travaria pra sempre — ver `useGradeComprado.ts`), então some do guard de
  // `pendenciasEnvio` como "pronta"; sem este `!gradeModeloError` aqui, `pendenciasEnvioExplosao` rodaria sobre um
  // rascunho de grade NUNCA semeado (sempre vazio) e devolveria "falta grade" — um motivo de bloqueio que parece
  // pedir preenchimento, quando na verdade é falha de carga (precisa recarregar, não editar).
  const pendenciasEnvio = mostraEnviarExplosao && gateEnvio.ok && ficha.carregado && gradeCompradoPronta && !gradeComprado.gradeModeloError
    ? pendenciasEnvioExplosao({
      draft, blocks: ficha.estado.blocks,
      grades: isComprado ? buildLinhasGradeRevenda() : ficha.estado.grades,
      rotuloRef: fl("ref"),
      campoVisivel: campoVisivelDev,
      secaoGrade: isComprado ? "grade_revenda" : "grade",
      gradeIndisponivel,
    })
    : [];
  const mostraFaltas = pendenciasEnvio.length > 0;
  // Fix round T7 (M2) — `!gradeCompradoPronta` some do `motivoEnvioBloqueado` da MESMA forma que `!ficha.carregado`:
  // sem esta checagem, `pendenciasEnvio` ficava `[]` (o guard zera a lista durante a carga da grade do comprado) ⇒
  // `mostraFaltas=false` ⇒ o botão "Enviar à Explosão" ficava DESTRAVADO na janela entre `ficha.carregado=true` e a
  // grade do comprado terminar de carregar — exatamente o clique precoce que o M2 original pretendia evitar.
  // Fix minors (M2) — `gradeComprado.gradeModeloError` ganha um ramo PRÓPRIO, antes de `!gradeCompradoPronta`
  // (que já é `true` nesse caso): mensagem PT de erro em vez de "Carregando a ficha…" (que ficaria mostrando
  // "carregando" pra sempre — o guard antigo nunca saía desse estado com a query falhada) e NUNCA destrava o
  // envio sem a grade (mesma trava de antes, só troca o texto).
  const motivoEnvioBloqueado: string | null = !mostraEnviarExplosao ? null
    : !requerEs.ok ? requerEs.motivo
    : gradeComprado.gradeModeloError ? "Não foi possível carregar a grade — recarregue a página."
      : !ficha.carregado || !gradeCompradoPronta ? "Carregando a ficha…"
        : !podeEditarDev ? "Sem permissão para editar o Desenvolvimento."
          : gateEnvio.carregando ? "Conferindo a etapa do card…"
            : !gateEnvio.ok ? gateEnvio.motivo
              : mostraFaltas ? "Preencha os itens pendentes para enviar."
                : null;
  const podeEnviarExplosaoAgora = mostraEnviarExplosao && motivoEnvioBloqueado === null && ficha.podeEditar
    && !enviarExplosao.isPending && !save.isPending;

  // F3.6 (R16) — o editor de M.O. POR SERVIÇO (spec 2026-08-06) e a Obs. de M.O., montados UMA vez e encaixados: na tabela
  // de "Preço e Custos" (manufaturado e importado), no bloco de preço da revenda, ou na seção sem número do Dialog "Novo
  // Modelo". VALOR = rascunho `moLinhas` (grava no Salvar); aprovar/reprovar = RPC imediata gated por
  // `producao_servico_aprovacao` (invariante #12); ver/digitar valor = `veCustos` (união das 2 permissões, decisão F3 #2).
  // P-53 A (fix 1, m-2) — M.O. (valores + observação) é COMPARTILHADA: o Dev antigo também editava
  // (payload :1878-1945). A trava pós-Explosão (`devBloqueado`) sozinha era contornável por quem só
  // edita o DEV com o card já pós-Explosão (fix 2, item 7: o comentário original dizia "Planejamento"
  // por engano) — agora exige `perm.compartilhadoBloqueado` (livre se qualquer um dos 2 Sheets deixava editar).
  const editorMaoObra = (
    <fieldset disabled={perm.compartilhadoBloqueado} className="contents">
      <MaoObraEditor
        linhas={moLinhas}
        categorias={catsServico}
        podeVerCustos={veCustos}
        podeAprovar={isEdit && podeAprovarMaoObra}
        onChangeLinhas={(ls) => setMoLinhas(ls)}
        onAprovar={(linhaId) => aprovarServicoMO.mutate({ linhaId, aprovado: true })}
        onReprovar={(linhaId, motivo) => aprovarServicoMO.mutate({ linhaId, aprovado: false, motivo })}
        pendingLinhaId={aprovarServicoMO.isPending ? aprovarServicoMO.variables?.linhaId : undefined}
        linhasPersistidas={moLinhasPersistidas}
        linhasBase={moLinhasBase}
        podeEditarValor={podeEditarMO}
        fornecedores={empresasServicoMO}
      />
    </fieldset>
  );
  // F3.6 (mockup v3; R34): "Observação de mão de obra" pelo `label` que o ObsMaoObraField JÁ aceita (o Dev segue com o dele).
  const obsMaoObra = veCustos ? (
    <fieldset disabled={perm.compartilhadoBloqueado} className="contents">
      <ObsMaoObraField
        label="Observação de mão de obra"
        value={draft.observacoes_mao_obra}
        onChange={(v) => setDraftTracked((d) => ({ ...d, observacoes_mao_obra: v }))}
      />
    </fieldset>
  ) : null;
  // Conteúdo interno idêntico p/ os dois containers (header / corpo rolável / rodapé
  // sticky / diálogos / guarda). EDITAR abre num Sheet lateral (side=right, ~70vw);
  // NOVO num Dialog central. O container é escolhido por `isEdit` logo abaixo.
  const conteudo = (
    <PedidoSecaoContext.Provider value={pedidoSecao}>
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
                {/* Fix final (F3.1, item 3): indicador discreto do 1º Salvar do card NOVO — o
                    formulário está travado (fieldset abaixo) enquanto isto aparece. */}
                {salvandoNovo && (
                  <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Salvando…
                  </span>
                )}
                {!salvandoNovo && <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />}
              </DialogTitle>
              {/* REF logo abaixo do nome — read-only, discreta. Só aparece quando já existe (gerada no
                  Desenvolvimento, invariante #11); vazia no Planejamento pré-Dev fica oculta (mais clean). */}
              {isEdit && draft.ref && (
                <span className="text-xs font-mono text-muted-foreground">REF {draft.ref}</span>
              )}
              {isEdit && estadoIntegracao && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <SeloIntegracao estado={estadoIntegracao} />
                  <InfoHover ariaLabel="O que fica travado pela Integração">{TEXTO_TRAVA_SHEET}</InfoHover>
                </div>
              )}
              {isEdit && (
                <EtapaHeader
                  selo={selo}
                  podeMover={podeMover}
                  opcoes={opcoesMover}
                  onMover={moverPara}
                  movendo={moverEtapa.isPending}
                  proxima={proxima}
                  sujo={dirty}
                  carregando={seloCarregando}
                />
              )}
              {/* Motivo do Cancelamento (veio do Dev — F3.1): só com a etapa em Reprovado. Sair de Reprovado NÃO
                  apaga o motivo (dono, 23/set) — ele só some da tela. Trava/permissão = fieldset.
                  Fix hidratação rodada 1 (achado M7 da revisão): + `&& semeado` — este campo vive
                  no HEADER, fora do placeholder "Carregando o card…" (que só cobre o `fieldset`
                  principal mais abaixo); sem o gate, dava para digitar um motivo antes do seed, e
                  o texto sumia quando o servidor chegava (sem gravação no servidor, mas perda de
                  digitação visível ao usuário). */}
              {isEdit && podeVerDev && kanbanCard.isReprovado && semeado && (
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
            conflitos={ficha.colab.conflitoBom ? [...conflitos, { path: "secao:bom", meu: "minhas edições não salvas", dele: "recarregar do servidor" }] : conflitos}
            onResolver={resolverPorPath}
            rotulo={rotuloConflitoPlan}
          />
        </DialogHeader>

        <div
          ref={colabScopeRef}
          className={cn(
            "flex-1 min-h-0 overflow-y-auto px-6 pb-4",
            // R1 (guardião): o `disabled` do fieldset não impede o Radix (Select/Combobox/Popover)
            // de abrir — ele abre no `pointerdown`, antes do React re-renderizar como bloqueado.
            // `pointer-events-none` no container barra esse pointerdown; o teclado já é coberto
            // pelo `disabled` do fieldset. Só liga durante o 1º Salvar do card NOVO (`salvandoNovo`
            // exige `!isEdit` — nunca afeta o card existente). O indicador "Salvando…" (no header)
            // continua visível pois vive FORA deste container.
            salvandoNovo && "pointer-events-none",
          )}
          aria-busy={salvandoNovo}
          onFocusCapture={(e) => {
            const scope = colabScopeRef.current;
            setCampoFocado(scope ? pathDoElemento(e.target as HTMLElement, scope) : null);
          }}
          onBlurCapture={() => setCampoFocado(null)}
        >
        {/* Fix final (F3.1, item 3): card NOVO + 1º Salvar em voo — trava TODO o formulário.
            B1 (guardião): o `space-y-6` mora AQUI (no próprio fieldset, não mais no container
            acima) — como este fieldset é o ÚNICO filho direto do container, um `className="contents"`
            fazia o seletor `:where(.space-y-6>:not(:last-child))` não achar nenhum filho direto
            de verdade (as seções viravam netas), zerando o espaço entre elas. `min-w-0 border-0
            p-0 m-0` zera o default de UA do <fieldset> (min-width/border/padding/margin) para não
            mudar nada visual além de devolver os 24px. Não mexe no card EXISTENTE: `salvandoNovo`
            exige `!isEdit`. */}
        {/* P-53 A (fix 1, sugestão barata) — aviso discreto quando o Sheet está aberto (não é
            `sheetSomenteLeitura` — o usuário edita ALGUMA coisa aqui) mas os campos SÓ do Planejamento
            estão travados: quem só edita o Dev (aberto pelo kanban, por ex.) vê por que Status/Origem/
            NCM/Título/medidas/preços/etc. não respondem. Mesmo padrão visual do `AvisoCamposDev`
            (tokens — border-dashed + text-muted-foreground —, sem cor solta). */}
        {perm.planBloqueado && !perm.sheetSomenteLeitura && (
          <p className="mx-6 mt-3 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Sem permissão para editar o Planejamento — os campos só do Planejamento estão travados.
          </p>
        )}
        {/* Fix hidratação (P-57 A): antes do seed (isEdit && !semeado), placeholder em vez do
            corpo — um `<fieldset disabled>` NÃO bastaria (o Radix Select/Combobox/Popover abre
            no pointerdown antes do React re-renderizar como bloqueado; mesma lição registrada em
            tests/unit/planejamento-dev-equipe-disabled.test.ts). Com cache quente dura 1 frame.
            Fix hidratação rodada 1 (achado M1 da revisão): "Carregando o card…" ficava preso pra
            sempre se `["modelo", modeloId]` desse ERRO (o effect de seed só roda com `modeloData`
            truthy/null-checked — nunca com `undefined` de erro) ou voltasse `null` (card excluído
            por outra pessoa, ou sem acesso — o efeito sai em `!modeloData`). Distingue os 3
            estados; "Voltar" já funciona nos 3 (fica na barra de rodapé, fora deste placeholder). */}
        {isEdit && !semeado ? (
          modeloErrored ? (
            <div className="p-6 space-y-3 text-sm">
              <p className="text-destructive font-medium">Não foi possível carregar o card.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => refetchModelo()}>
                Tentar de novo
              </Button>
            </div>
          ) : modeloData === null ? (
            <p className="p-6 text-sm text-muted-foreground">Card não encontrado.</p>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">Carregando o card…</p>
          )
        ) : (
        <fieldset disabled={salvandoNovo} aria-busy={salvandoNovo} className="space-y-6 min-w-0 border-0 p-0 m-0">
          {/* SETOR 1 — Informações Gerais do Produto */}
          <InfoGeraisSecao numero={numeros.info} selo={seloDe("info")} travaIntegracao={travaIntegracao}
            draft={draft} setDraftTracked={setDraftTracked}
            grupoSel={grupoSel} setGrupoSel={setGrupoSel}
            grupos={grupos} categorias={categorias} estilistas={estilistas}
            sub1Opts={sub1Opts} sub2Opts={sub2Opts} fl={fl} origemOpcoes={origemOpcoesLista}
            nomeLoja={nomeLoja}
            planBloqueado={perm.planBloqueado}
            compartilhadoBloqueado={perm.compartilhadoBloqueado}
            versaoAnterior={versaoAnterior} versaoAnteriorCarregando={versaoAnteriorCarregando}
            versaoAnteriorErro={versaoAnteriorErro} onTentarVersaoAnterior={tentarVersaoAnterior}
          />

          {/* SETOR 2 — Coleção */}
          <Secao id="colecao" titulo="Coleção" numero={numeros.colecao} selo={seloDe("colecao")} defaultOpen={false}>
            {/* P-53 A: Coleção/Subcoleção/Linha/Semana/Mês/Ano são COMPARTILHADOS — o Dev também os grava
                (ModeloDetailPanel.tsx:1878-1945). Editável se qualquer um dos 2 Sheets deixava. */}
            <fieldset disabled={perm.compartilhadoBloqueado} className="contents">
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
                // Fix 2 (item 2, re-revisão) — Coleção texto livre (lojas SEM OTB): o Dev antigo nem
                // MOSTRAVA esse campo sem OTB (era um campo só do Sheet do Planejamento nesse modo) —
                // trava adicional SÓ aqui com `perm.planBloqueado`, por cima do fieldset compartilhado
                // da seção inteira (Coleção permanece em CAMPOS_COMPARTILHADOS_DRAFT — o select do OTB
                // grava junto do `colecao_id`, que é compartilhado de verdade).
                <fieldset disabled={perm.planBloqueado} className="contents">
                  <FieldText label={fl("colecao")} value={draft.colecao} onChange={(v) => setDraftTracked((d) => ({ ...d, colecao: v }))} />
                </fieldset>
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
            </fieldset>
          </Secao>

          {/* Desenvolvimento (veio do Dev, F3.1; F3.6: título sem "— equipe e cronograma" e SEM a REF, que foi para "Códigos").
              Sempre visível — independe da etapa — p/ quem vê o Desenvolvimento (decisão F3 #8); recolhida (decisão 6); só no
              card existente. O <fieldset> fica DENTRO da seção (o cabeçalho continua abrindo/fechando com o card travado). */}
          {vis.desenvolvimento && (
            <Secao id="desenvolvimento" titulo="Desenvolvimento" numero={numeros.desenvolvimento} selo={seloDe("desenvolvimento")} defaultOpen={false}>
              <AvisoCamposDev motivo={motivoTravaDev} />
              <fieldset disabled={devBloqueado} className="contents">
                <DevEquipeSection
                  draft={draft}
                  setDraftTracked={setDraftTracked}
                  campoVisivel={campoVisivelDev}
                  bloqueado={devBloqueado}
                  camposCopiados={ficha.camposCopiados}
                  onCampoEditado={ficha.onCampoEditado}
                />
              </fieldset>
            </Secao>
          )}

          {/* F3.6 — "4. Códigos" (spec 2026-09-25 §5.1; F3.5b do SKU): a REF que saiu da seção 3 (mesma exibição/trava) +
              "Tamanho em" + SKUs por variante × tamanho. Só no card existente. */}
          {vis.codigos && modeloId && (
            <Secao id="codigos" titulo="Códigos" numero={numeros.codigos} selo={seloDe("codigos")} defaultOpen={false}>
              {travaIntegracao.has("sku") && <p className="text-xs text-muted-foreground">{TEXTO_SKU_TRAVADO}</p>}
              <CodigosSecao
                draft={draft}
                setDraftTracked={setDraftTracked}
                rotuloRef={fl("ref")}
                refVisivel={kanbanCard.refVisivel}
                refEditavel={refEditavel}
                refPrevia={refParaPrevia({ refVaiNoSalvar: refEditavel, refRascunho: draft.ref, refSalva: (modeloData as any)?.ref ?? "" })}
                skus={skus}
                aGravar={skusAGravar}
                // R4 — grade/tecidos do rascunho ainda não salvos: a prévia usa a grade SALVA (só um aviso).
                bomSujo={ficha.dirty || gradeRevendaDirty}
                podeVerSkus={podeVerPlanejamento}
                podeEditarSkus={podeEditarPlanejamento && !travaIntegracao.has("sku")}
              />
            </Secao>
          )}

          {/* Ajustes na Prova (veio do Dev — F3.1): fio de comentários que grava NA HORA (fora do Salvar). Comprado
              segue a seção "prova" do Fluxo de Revenda (default: escondida). Trava = fieldset, como no Dev. */}
          {vis.prova && modeloId && (
            <Secao id="prova" titulo="Ajustes na Prova" numero={numeros.prova} selo={<SeloProvaBadge modeloId={modeloId} />} defaultOpen={false}>
              <AvisoCamposDev motivo={motivoTravaDev} />
              <fieldset disabled={devBloqueado} className="contents">
                <ModeloAjustesProvaSection modeloId={modeloId} />
              </fieldset>
            </Secao>
          )}

          {/* F3.2 — seções vindas do Desenvolvimento: Tecidos/Forros/Entretelas · Aviamentos · Insumos · Grade (ordem
              do mockup aprovado). SEMPRE visíveis (recolhidas) p/ quem vê o Desenvolvimento; editáveis p/ quem o
              edita (decisão F3 #8); só produto interno (comprado = F3.4). Substituem o "Tecido Planejado". */}
          {fichaVisivel && modeloId && (
            <BomSecoes
              ficha={ficha}
              numeros={numeros}
              visiveis={secFicha}
              modeloId={modeloId}
              estoque={estoqueMap}
              ordemEnviada={enviada}
              proporcoes={draft.proporcoes ?? {}}
              // P-120 A (plano tamanho-em, Tarefa 7) — a Grade do card INTERNO mostra só o lado escolhido.
              tamanhoTipo={draft.tamanho_tipo}
            />
          )}

          {/* F3.2 / G-mockup R3 — só no Dialog "Novo Modelo", ANTES da Mão de obra (gen_novo.py): o mesmo seletor do
              antigo "Tecido Planejado" (preço/m + estoque) GRAVA o BOM como Tecido 1..N (só o artigo) logo após o
              INSERT. No card existente os tecidos moram na seção "Tecidos / Forros / Entretelas" (BOM, logo acima) e a
              lista `tecidos_planejados` é derivada. */}
          {vis.tecidos_novo && (
          <Secao id="tecidos_novo" titulo="Tecidos" numero={numeros.tecidos_novo} defaultOpen>
            <MultiArtigosField
              label=""
              value={draft.tecidos_planejados}
              onChange={(v) => setDraftTracked((d) => ({ ...d, tecidos_planejados: v }))}
              artigos={artigos}
              estoque={estoqueMap}
              max={3}
            />
            <p className="text-xs text-muted-foreground">Ao salvar, cada tecido vira Tecido 1, 2 e 3 do BOM (só o tecido — cores, consumo e grade você completa no card).</p>
          </Secao>
          )}

          {/* F3.6 (R1) — só no Dialog "Novo Modelo" (a seção Preço não existe nele): a MESMA M.O. da tabela do Sheet. */}
          {vis.mao_obra_novo && (
            <Secao id="mao_obra_novo" titulo="Mão de obra" numero={numeros.mao_obra_novo} defaultOpen={false}>
              {editorMaoObra}
              {obsMaoObra && <div className="mt-3">{obsMaoObra}</div>}
            </Secao>
          )}

          {/* SETOR 3 — Preço (só na edição; na criação o custo vem do BOM depois) */}
          {vis.preco && (
          <Secao id="preco" titulo="Preço e Custos" numero={numeros.preco} selo={seloDe("preco")} defaultOpen={false}>
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
              // real + M.O. real do BOM. F3.6: a Mão de obra (MaoObraEditor) mora DENTRO desta tabela — não é mais
              // seção própria (slots `blocoMaoObra`/`obsMaoObra`, logo abaixo da linha "Mão de obra"/"Custo total").
              <PrecoTabela
                markupReal={markupReal} precoSug={precoSug} precoBase={precoBaseMO} precoDigitado={precoVendaDigitado}
                draftPrecoVenda={draft.preco_venda}
                onPrecoVenda={(v) => setDraftTracked((d) => ({ ...d, preco_venda: numOr0(v) > 0 ? Number(v) : null }))}
                seloCusto={custoBase.selo} custoBase={custo}
                consumo={consumoOverride} consumoRealBOM={consumoRealBOM} precoTecidoM={precoTecidoM} tecidoEstimado={simCalc.tecido}
                aviamento={draft.custo_simulado.aviamento ?? null} maoObraDev={maoObraDevLive}
                onConsumo={(v) => setSim({ consumo_tecido: numOr0(v) > 0 ? Number(v) : null })}
                onAviamento={(v) => setSim({ aviamento: numOr0(v) > 0 ? Number(v) : null })}
                materiaisBase={materiaisSetor} custoPrevisto={custoPrevisto}
                // Fix pós-rebase (item 7) — Σ dos custos adicionais (entra no estimado): linha só-leitura quando não há a ficha.
                custosAdicionaisSoma={veCustos ? somaCustosAdicionais(draft.custos_adicionais) : 0}
                linhaFaixas={linhaFaixas}
                moMin={moMin} moIdeal={moIdeal} moMax={moMax} moStatusFaixa={moStatusFaixa}
                // Fix round 4 (item 2) — `veCustos` (união das 2 permissões, decisão F3 #2) no lugar de
                // `podeVerCustos` sozinho: a Parte 3 (M.O. por faixa) da tabela é gated por esta prop.
                podeVerCustos={veCustos} podeEditarCustos={podeEditarCustos} podeEditarPreco={podeEditarPreco} markupFaixaOn={markupFaixaOn}
                travaPrecoVenda={travaIntegracao.has("preco_venda")} travaPrecoAnterior={travaIntegracao.has("preco_anterior")}
                // Fix round 1 (I-2, review Task 22) — sem `piOn`, o gravador de preço fixo do importado
                // (usePlanejamentoSave.ts, n1) nunca roda: editar aqui seria descartado em silêncio. `!isComprado`
                // já garante que `draft.origem` só pode ser "importado" (não "revenda", que usa o outro ramo/
                // `PrecoRevendaBloco` — `!isRevenda` acima) ou "interno" (para quem `piOn` é irrelevante).
                precoImportadoOff={draft.origem === "importado" && !piOn}
                planBloqueado={perm.planBloqueado}
                // F3.2 — decisão F3 #2 + mockup (R9c): custos do BOM como LINHAS desta tabela, p/ quem vê custos no
                // Planejamento OU no Desenvolvimento; custos adicionais editáveis só sem trava (`ficha.podeEditar`).
                // F3.4 — linhas "Custos do BOM" e custos adicionais só no INTERNO: no comprado não entram no custo
                // (`_custo_unitario_modelos_core` ramos revenda/importado) — mostrar confundiria a tabela do importado.
                custosBom={!isComprado && ficha.habilitada && ficha.carregado && veCustos ? {
                  totais: ficha.totais,
                  custosAdicionais: draft.custos_adicionais,
                  onChange: (v) => setDraftTracked((d) => ({ ...d, custos_adicionais: v })),
                  editavel: ficha.podeEditar,
                  copiados: ficha.camposCopiados,
                  onEditado: ficha.onCampoEditado,
                } : null}
                // F3.6 (R16) — a M.O. entra na tabela (linha "Mão de obra" + Obs. abaixo do "Custo total").
                blocoMaoObra={moBlocoVisivel ? editorMaoObra : null}
                obsMaoObra={moBlocoVisivel ? obsMaoObra : null}
                // F3.6 (ruling 11) — Preço anterior (grava no Salvar; payload só com podeEditarPreco — usePlanejamentoSave).
                precoAnterior={draft.preco_anterior}
                onPrecoAnterior={(v) => setDraftTracked((d) => ({ ...d, preco_anterior: v }))}
                versaoAnterior={versaoAnterior} versaoAnteriorCarregando={versaoAnteriorCarregando}
            versaoAnteriorErro={versaoAnteriorErro} onTentarVersaoAnterior={tentarVersaoAnterior}
              />
            ) : (
              // REVENDA — fora do escopo aprovado do §K: segue como CampoRO + os 2 markups
              // digitáveis (mesma fonte de ProdutoCard.tsx no planejador Produto Acabado,
              // bidirecional) + Preço atacado/varejo FIXO (preço exato digitado, sem derivar do markup).
              <PrecoRevendaBloco rv={revenda} custoReal={custoReal} piRevenda={piRevenda} draft={draft}
                blocoMaoObra={moBlocoVisivel ? editorMaoObra : null} obsMaoObra={moBlocoVisivel ? obsMaoObra : null}
                podeEditarPreco={podeEditarPreco}
                podeEditarPrecoComprado={podeEditarPrecoComprado}
                planBloqueado={perm.planBloqueado}
                travaVarejo={travaIntegracao.has("preco_venda")} travaPrecoAnterior={travaIntegracao.has("preco_anterior")}
                precoAnterior={draft.preco_anterior}
                onPrecoAnterior={(v) => setDraftTracked((d) => ({ ...d, preco_anterior: v }))}
                versaoAnterior={versaoAnterior} versaoAnteriorCarregando={versaoAnteriorCarregando}
            versaoAnteriorErro={versaoAnteriorErro} onTentarVersaoAnterior={tentarVersaoAnterior} />
            )}
          </Secao>
          )}

          {/* Revenda (Task 7): produto vinculado (Produto Acabado) — atalho ⧉ ou criar. */}
          {vis.produto_acabado && (isRevenda ? (
            <ProdutoAcabadoSecao rv={revenda} contexto={contexto} modeloId={modeloId} navigate={navigate} numero={numeros.produto_acabado} podeAcoesPlanejamento={perm.podeAcoesPlanejamento} />
          ) : (
            <ProdutoImportadoSecao gc={gradeComprado} navigate={navigate} numero={numeros.produto_acabado} />
          ))}

          {/* Revenda (Task 7): grade cor×tamanho editável — por variante do produto (rótulo
              cor·apelido) × tamanhos ativos da proporção (grupo Acessórios = coluna única
              "UN"); lê/grava `modelo_grades` (variante_numero=ordem). */}
          {vis.grade_revenda && (
            <GradeRevendaSecao gc={gradeComprado} numero={numeros.grade_revenda} selo={seloDe("grade_revenda")} motivoSomenteLeitura={motivoGradeSomenteLeitura} motivoSemProduto={motivoSemProdutoComprado} tamanhoTipo={draft.tamanho_tipo} />
          )}

          {/* SETOR 5 — Anexos. P-53 A (fix 1, m-2): croqui/desenho/fotos são COMPARTILHADOS (o Dev antigo também
              gravava — payload :1878-1945); a trava pós-Explosão (devBloqueado, abaixo) sozinha era contornável
              por quem só edita o DEV com o card já pós-Explosão (fix 2, item 7: comentário original dizia
              "Planejamento" por engano) — agora exige perm.compartilhadoBloqueado também. */}
          <Secao id="anexos" titulo="Anexos" numero={numeros.anexos} selo={seloDe("anexos")} defaultOpen={false}>
            <fieldset disabled={perm.compartilhadoBloqueado} className="contents">
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
              <fieldset disabled={travaIntegracao.has("fotos_modelo")} className="contents">
                <PhotoList label="Foto do Modelo" paths={draft.fotos_modelo}
                  onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_modelo" })}
                  onRemove={(i) => setDraftTracked((d) => ({ ...d, fotos_modelo: d.fotos_modelo.filter((_, j) => j !== i) }))} />
              </fieldset>
              <PhotoList label="Foto de Referência" paths={draft.fotos_referencia}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_referencia" })}
                onRemove={(i) => setDraftTracked((d) => ({ ...d, fotos_referencia: d.fotos_referencia.filter((_, j) => j !== i) }))} />
            </div>
            </fieldset>
            {/* Ficha de Medida + Observações Gerais (vieram do Dev — F3.1): card existente, quem vê o Dev e (comprado)
                seção "s6" ligada no Fluxo de Revenda. Travam com `devBloqueado` (regra própria — Observações Gerais
                E Ficha de Medida são compartilhadas também, mas mantidas na trava do Dev como já era, ver AvisoCamposDev). */}
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
          {vis.observacoes && modeloId && (
            <Secao id="observacoes" titulo="Observações" numero={numeros.observacoes} selo={<SeloObservacoesBadge modeloId={modeloId} />} defaultOpen={false}>
              <AvisoCamposDev motivo={motivoTravaDev} />
              <fieldset disabled={devBloqueado} className="contents">
                <ModeloObservacoes modeloId={modeloId} readOnly={devBloqueado} />
              </fieldset>
            </Secao>
          )}

          {/* SETOR 6 — Lançamento (gate: valor de serviços aprovado + data; CQ liberado só com o módulo Produção — P-252 A) */}
          {vis.lancamento && (
            <Secao id="lancamento" titulo="Lançamento" numero={numeros.lancamento} selo={seloDe("lancamento")} defaultOpen={false}>
              <div className="flex flex-wrap items-end gap-3">
                {/* P-53 A: Data de Lançamento é SÓ do Planejamento. */}
                <fieldset disabled={perm.planBloqueado} className="contents">
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
                </fieldset>
                {/* P-53 A: Lançar/Cancelar Lançamento é ação de ciclo do Planejamento — só perm.podeAcoesPlanejamento. */}
                {perm.podeAcoesPlanejamento && (lancado ? (
                  <Button
                    variant="outline"
                    // [camada C2 · P-263 A] cancelar o lançamento desfaz: "Tem certeza?" antes (o servidor só recebe ao confirmar).
                    onClick={() => pedirConfirmacao({
                      ...textoCancelarLancamento({ nome: draft.nome, ref: draft.ref, dataLancamento: draft.data_lancamento }),
                      onConfirmar: () => lancar.mutate(false),
                    })}
                    disabled={lancar.isPending}
                  >
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
                ))}
              </div>
              {/* A página Lançamentos é do módulo Produção e só lista card com CQ liberado: sem Produção não promete que aparece lá. */}
              {lancado && <p className="mt-2 text-xs text-emerald-600">{cqExigido ? "✓ Lançado — aparece em Lançamentos." : "✓ Lançado."}</p>}
            </Secao>
          )}
          {vis.relacionado && modeloId && (
            <Secao id="relacionado" titulo="Produto Relacionado" numero={numeros.relacionado} selo={<SeloRelacionadoBadge modeloId={modeloId} />} defaultOpen={false}>
              {/* P-53 A: adicionar/remover Produto Relacionado é ação de ciclo do Planejamento. */}
              <fieldset disabled={!perm.podeAcoesPlanejamento} className="contents">
                <ProdutoRelacionadoSetor modeloId={modeloId} />
              </fieldset>
            </Secao>
          )}

          {/* F3.3 — "Para enviar, falta…" no MOBILE (Dev :3107-3119); no desktop fica no rodapé. */}
          {mostraFaltas && (
            <p className="sm:hidden text-xs text-amber-700 dark:text-amber-300">
              Para enviar, falta:{" "}
              {pendenciasEnvio.map((p, i) => (
                <span key={p.label}>
                  {i > 0 && " · "}
                  {/* Fix round T7 (Important) — `p.secao` ausente = pendência SEM seção pra abrir (ex.: grade indisponível
                      por módulo desligado): texto puro, sem link/onClick, não o `<button>` de sempre. */}
                  {p.secao ? (
                    <button type="button" className="font-medium underline underline-offset-2" onClick={() => abrirSecao(p.secao as string)}>{p.label}</button>
                  ) : (
                    <span className="font-medium">{p.label}</span>
                  )}
                </span>
              ))}
            </p>
          )}
        </fieldset>
        )}
        </div>

        {/* F3.3 — rodapé do mockup (gen_main.py:118-124): Voltar · Excluir · [Para enviar, falta…] · ⋯ · [Enviar Ordem de
            Criação | Enviar à Explosão] · [Editar] · Salvar. Duplicar / Importar dados / Ficha Técnica / Cancelar Ordem de
            Criação moram no ⋯ (§L). */}
        <div className="shrink-0 border-t bg-background px-4 py-3 flex flex-wrap items-center gap-2">
          {/* Voltar: ESQUERDA — ícone no mobile, texto no desktop. */}
          <Button variant="outline" onClick={requestClose} aria-label="Voltar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 mr-1 max-sm:mr-0" />
            <span className="max-sm:sr-only">Voltar</span>
          </Button>
          {/* Excluir: logo ao lado do Voltar (só no modo edição). P-53 A: ação de ciclo do Planejamento. */}
          {isEdit && perm.podeAcoesPlanejamento && (
            <Button variant="destructive" disabled={!!estadoIntegracao} onClick={() => setConfirmDel(true)} aria-label="Excluir" className="shrink-0 max-sm:aspect-square max-sm:px-0">
              <Trash2 className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Excluir</span>
            </Button>
          )}
          {isEdit && perm.podeAcoesPlanejamento && estadoIntegracao && (
            <InfoHover ariaLabel="Por que não exclui">{textoExcluirTravado(estadoIntegracao.estado)}</InfoHover>
          )}
          {/* "Para enviar, falta…" (Dev :3136-3147): cada item abre a seção onde se resolve. Trunca (1 linha). */}
          {mostraFaltas && (
            <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground max-sm:hidden" data-testid="para-enviar-falta">
              Para enviar, falta:{" "}
              {pendenciasEnvio.map((p, i) => (
                <span key={p.label}>
                  {i > 0 && ", "}
                  {/* Fix round T7 (Important) — mesmo tratamento do bloco mobile acima: sem `secao`, texto puro. */}
                  {p.secao ? (
                    <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => abrirSecao(p.secao as string)}>{p.label}</button>
                  ) : (
                    <span>{p.label}</span>
                  )}
                </span>
              ))}
            </span>
          )}
          {isEdit && (
            <MenuMaisAcoes
              className={mostraFaltas ? "max-sm:ml-auto" : "ml-auto"}
              // P-53 A (fix 1, m-5) — Duplicar é ação de ciclo do Planejamento: sem `perm.podeAcoesPlanejamento`
              // o item nem aparece (paridade com Importar/Cancelar Ordem, que já somem sem a condição deles) —
              // em vez de ficar preso em "carregando…" pra sempre.
              onDuplicar={perm.podeAcoesPlanejamento ? handleDuplicate : undefined}
              // Fix T9 I1 — devolve a condição do round 4 da F3.2 (item 7, 67e363f ~:1387-1388), perdida quando
              // o Duplicar saiu do rodapé (solto) e virou item do MenuMaisAcoes (Task 9): a `mutationFn` do
              // Duplicar lê `fichaRef.current.carregado`/`.estado.blocks` — clicar ANTES de carregar caía no
              // fallback `tecidos_planejados.slice(0,3)` em vez dos artigos reais do BOM.
              // Rebase F3.3→3adfbd3 — + a condição do micro-fix M1 da F3.2 (3adfbd3): `isEdit && !modeloData` (cache FRIO:
              // `isCompradoParaFicha` desabilita a ficha por precaução e destravaria o Duplicar antes do seed, copiando o
              // `emptyDraft()`), no `duplicando` e na dica.
              duplicando={duplicate.isPending || dupChecando || (ficha.habilitada && !ficha.carregado) || (isEdit && !modeloData)}
              duplicandoTitle={(ficha.habilitada && !ficha.carregado) || (isEdit && !modeloData) ? "Carregando a ficha…" : undefined}
              // F3.4 — só interno: o diálogo do Dev copia a grade por variante do Tecido 1, que o comprado não tem.
              onImportar={ficha.podeEditar && !isComprado ? () => importar.setAberto(true) : undefined}
              onFichaTecnica={enviadoCad ? () => setPrintTecnicaToken((t) => t + 1) : undefined}
              // Fix T9 I3 (ruling do controlador) — com `enviado_cad=true` o card já foi p/ a Explosão (CQ/
              // Direcionamento podem ter avançado por cima do CAD); "Cancelar Ordem" volta o card pro
              // Planejamento mas NÃO desfaz nada da Explosão — some do menu pra não sugerir uma reversão que
              // não existe. P-53 A: Cancelar Ordem é ação de ciclo do Planejamento.
              onCancelarOrdem={perm.podeAcoesPlanejamento && enviada && !enviadoCad ? () => setConfirmCancelarOrdem(true) : undefined}
              cancelandoOrdem={enviar.isPending}
            />
          )}
          {/* P-53 A: Enviar Ordem de Criação é ação de ciclo do Planejamento. */}
          {isEdit && !enviada && perm.podeAcoesPlanejamento && (
            <TooltipProvider>
              <Tooltip>
                {/* Botão desabilitado não dispara title nativo — o span recebe o hover e o tooltip lista o que falta. */}
                <TooltipTrigger asChild>
                  <span className="inline-flex shrink-0">
                    <Button variant="secondary" onClick={() => enviar.mutate(true)} disabled={enviar.isPending || enviarBloqueios.length > 0}>
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
          )}
          {mostraEnviarExplosao && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex shrink-0">
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmEnviarExplosao(true)}
                      disabled={!podeEnviarExplosaoAgora}
                      aria-label="Enviar à Explosão"
                      className="max-sm:aspect-square max-sm:px-0"
                    >
                      {enviarExplosao.isPending ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1" /> : <Send className="h-4 w-4 sm:mr-1" />}
                      <span className="max-sm:sr-only">Enviar à Explosão</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                {motivoEnvioBloqueado && <TooltipContent className="max-w-[260px]">{motivoEnvioBloqueado}</TooltipContent>}
              </Tooltip>
            </TooltipProvider>
          )}
          {/* [modularidade F2] Toque no celular não tem hover: o motivo do módulo também sai num InfoHover ao lado do botão. */}
          {mostraEnviarExplosao && !requerEs.ok && requerEs.faltam.length > 0 && (
            <InfoHover ariaLabel="Por que não envia à Explosão">{requerEs.motivo}</InfoHover>
          )}
          {/* Trava pós-Explosão (decisão F3 #1): "Editar" destrava os campos vindos do Dev (BOM e CAD incluídos); o Salvar re-trava. */}
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
          {/* P-53 A: Salvar habilitado com !perm.sheetSomenteLeitura (antes dependia só da trava da página).
              Fix hidratação (P-57 A): + trava até o seed (isEdit && !semeado) — sem isso o Salvar fica
              habilitado em cima do emptyDraft() e grava vazio por cima do servidor. */}
          <Button className={`shrink-0 max-sm:aspect-square max-sm:px-0${!isEdit ? " ml-auto" : ""}`} aria-label="Salvar" onClick={handleSave} disabled={perm.sheetSomenteLeitura || save.isPending || enviarExplosao.isPending || (isEdit && !semeado)}>
            <Save className="h-4 w-4 sm:mr-1" />
            <span className="max-sm:sr-only">Salvar</span>
          </Button>
        </div>

        {dialogConfirmacao}

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

        {/* P-152 — Duplicar quando já existem outras versões da família (ou a conferência falhou). */}
        <AlertDialog open={dupAviso} onOpenChange={(o) => { setDupAviso(o); if (!o) versoesDup.reset(); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {versoesDup.erro ? "Não foi possível conferir as versões" : versoesDup.precisa ? "Duplicar — já existem outras versões" : "Duplicar esta versão"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                A cópia vira uma nova versão desta família. Confira as versões que já existem antes de continuar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <VersoesExistentesAviso
              estado={versoesDup}
              destino={{ colecaoId: draft.colecao_id ?? null, subcolecao: draft.subcolecao ?? null }}
            />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={!versoesDup.pronto}
                onClick={() => { setDupAviso(false); versoesDup.reset(); iniciarDuplicar(); }}
              >
                Duplicar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* F3.3 — confirmação do envio (Dev :3202-3219). */}
        <AlertDialog open={confirmEnviarExplosao} onOpenChange={setConfirmEnviarExplosao}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Enviar modelo para a Explosão?</AlertDialogTitle>
              <AlertDialogDescription>
                {isComprado
                  ? "O card é salvo e vai para a Explosão (próxima etapa) com a grade e os insumos atuais."
                  : "O card é salvo e vai para a Explosão (próxima etapa) com os tecidos, variantes, grade e CAD atuais."} Na Explosão
                você define a quantidade a enviar e autoriza a baixa do estoque. Depois de enviado, os campos vindos do
                Desenvolvimento ficam travados — use "Editar" para alterá-los.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Não, quero revisar antes</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmEnviarExplosao(false);
                  // Fix T9 M5 — re-checa `podeEnviarExplosaoAgora` no clique (não só no `disabled` do botão que abriu
                  // o diálogo): o AlertDialog pode ficar aberto um tempo antes da confirmação, e o gate pode ter
                  // mudado nesse meio-tempo (etapa avançou/regrediu, outra pessoa salvou, ficha ficou indisponível).
                  // Sem esta checagem, "Sim, enviar" dispararia a mutation mesmo sem mais poder enviar.
                  if (!podeEnviarExplosaoAgora) {
                    toast.error(motivoEnvioBloqueado ?? "Não é mais possível enviar à Explosão — confira o card.");
                    return;
                  }
                  enviarExplosao.mutate();
                }}
              >
                Sim, enviar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Cancelar Ordem de Criação (menu ⋯, NEUTRO — R7): ação sensível, confirma antes de reverter.
            Fix T9 I3 (ruling do controlador) — com CAD existente e o card ainda NÃO enviado à Explosão (o item só
            aparece nesse caso — `enviadoCad` esconde o item por completo, ver MenuMaisAcoes acima), o texto avisa que
            o CAD sobrevive ao cancelamento; sem CAD, mantém o texto de sempre.
            Fix pós-rebase (item 3) — "tem CAD?" não pode depender só da ficha: sem a ficha habilitada (sem `canView` do
            Dev) `ficha.dados.cadExiste` é sempre false. Fonte extra SEM query nova: `cqInfo` (["plan-cq", modeloId],
            ~:562) já lê `cad.id` do modelo para o Lançar, com `enabled: !!modeloId` — independe da ficha.
            Fix m3 — enquanto `cqInfo` ainda não chegou (`cqInfoCarregando`), NÃO mostra a versão "sem CAD" do texto:
            com CAD já existente mas a query ainda em voo, o texto errado prometia "pode enviar de novo depois" sem
            avisar que o CAD sobrevive. Mostra um texto neutro ("Verificando o CAD…") e desabilita "Sim, cancelar"
            até carregar — a ação sensível espera ter certeza do que vai avisar. */}
        <AlertDialog open={confirmCancelarOrdem} onOpenChange={setConfirmCancelarOrdem}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar a Ordem de Criação?</AlertDialogTitle>
              <AlertDialogDescription>
                {cqInfoCarregando
                  ? "Verificando o CAD…"
                  : ficha.dados.cadExiste || !!(cqInfo as { id?: string } | null | undefined)?.id
                    ? 'Este card já tem CAD: ao cancelar a Ordem, o CAD continua existindo e o card não poderá ser excluído. Ele sai do kanban do Desenvolvimento e poderá ser enviado de novo.'
                    : 'O card volta para o Planejamento e sai do Desenvolvimento. Você pode enviar a Ordem de Criação de novo depois.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                disabled={cqInfoCarregando}
                onClick={() => {
                  setConfirmCancelarOrdem(false);
                  // Fix pós-rebase (item 2) — re-checa o envio à Explosão no CLIQUE (mesma ideia do "Sim, enviar", Fix T9
                  // M5): o diálogo pode ficar aberto enquanto outra pessoa envia o card à Explosão (o Realtime atualiza
                  // `["modelo", modeloId]`). Com `enviado_cad=true` o item nem aparece no menu (Fix T9 I3) — cancelar
                  // agora voltaria o card ao Planejamento sem desfazer nada da Explosão. Lê o render atual E o cache.
                  const enviadoAgora = enviadoCad || !!(qc.getQueryData(["modelo", modeloId]) as { enviado_cad?: boolean } | null | undefined)?.enviado_cad;
                  if (enviadoAgora) {
                    toast.error("Este card já foi enviado à Explosão — a Ordem de Criação não pode mais ser cancelada.");
                    return;
                  }
                  enviar.mutate(false);
                }}
              >
                Sim, cancelar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* F3.3 — Importar dados (Dev :3239-3259): o diálogo do Dev SEM modificar; só existe aberto (nasce limpo). */}
        {isEdit && modeloId && importar.aberto && (
          <ImportarDadosDialog
            open={importar.aberto}
            onOpenChange={importar.setAberto}
            modeloDestinoId={modeloId}
            destinoBlocks={ficha.estado.blocks}
            onCopiar={(r, origem, sel) => importar.onCopiar(r, origem, sel)}
          />
        )}
        <AlertDialog open={!!importar.confirmacao} onOpenChange={(o) => { if (!o) importar.setConfirmacao(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sobrescrever dados existentes?</AlertDialogTitle>
              <AlertDialogDescription>
                A importação vai substituir: {importar.confirmacao?.itens.join(" · ")}. Os campos entram para revisão (só o
                Salvar grava); as Observações (bloco), se marcadas, são aplicadas na hora.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => importar.confirmacao?.aplicar()}>Substituir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste card." />
        {/* F3.3 — Ficha Técnica (menu ⋯, "após Enviar"): a MESMA do Dev (PrintFicha — PrintArea em portal), montada oculta
            e disparada pelo token (Dev :3261-3265). */}
        {isEdit && modeloId && enviadoCad && <PrintFicha modeloId={modeloId} kind="tecnica" token={printTecnicaToken} />}
        {/* Ring de presença por campo AUTO-instrumentado (cobre todos os campos do sheet). */}
        <ColabPresenceOverlay presentes={presentes} scopeRef={colabScopeRef} />
    </PedidoSecaoContext.Provider>
  );

  // Regra 3: EDITAR registro existente = Sheet lateral (side=right, ~70vw); NOVO = Dialog
  // central. Mesmo conteúdo interno nos dois; classes max-sm:* mantêm o fullscreen mobile.
  return (
    <>
      {isEdit ? (
        // P-53 A: ReadOnlyScope decide o fieldset do SheetContent pelas 2 permissões deste Sheet —
        // NÃO herda mais a trava da PÁGINA onde foi aberto (RequirePermission/useReadOnly da rota).
        <ReadOnlyScope value={perm.sheetSomenteLeitura}>
          <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
            <SheetContent
              side="right"
              size="editor"
              className="flex flex-col gap-0 p-0 max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!rounded-none max-sm:!border-0 max-sm:!overflow-hidden"
            >
              {conteudo}
            </SheetContent>
          </Sheet>
        </ReadOnlyScope>
      ) : (
        // Criar card NOVO é ação de Planejamento — só `podeEditarPlanejamento` decide (o Dev não cria
        // cards no Planejamento).
        <ReadOnlyScope value={!podeEditarPlanejamento}>
          <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
            <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[70vw] max-h-[90vh] max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!overflow-hidden">
              {conteudo}
            </DialogContent>
          </Dialog>
        </ReadOnlyScope>
      )}
    </>
  );
}
