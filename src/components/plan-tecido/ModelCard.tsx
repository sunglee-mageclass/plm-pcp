import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { PtSlot, PtMaterial, PtVariante } from "@/lib/plan-tecido/types";
import { ChevronRight, Lock, ShoppingCart, MoreHorizontal, Eraser } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DragHandle } from "./dnd";
import { necessidadePorTecido, buildMateriaisAplicar, fmtMetros } from "@/lib/plan-tecido/calc";
import { fmtInt } from "@/lib/format";
import { ehOrigemComprada, rotuloOrigem } from "@/lib/origem";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MaterialBlock } from "./MaterialBlock";
import { GradeSection } from "./GradeSection";
import { CustoSection } from "./CustoSection";
import { ModeloThumb } from "./ModeloThumb";
import { SlotOcHint } from "./SlotOcHint";
import { ReferenciaDialog } from "./ReferenciaDialog";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { StatusBadge } from "@/components/shared/StatusBadge";

function novoMaterial(existentes: PtMaterial[], tipo: "tecido" | "forro"): PtMaterial {
  // numero = MAX(numero do mesmo tipo) + 1 — NUNCA por CONTAGEM. O material vindo do BOM (partição
  // por artigo real em PlanTecidoSheet.modelosReais) pode chegar com numero NÃO-contíguo por tipo
  // (ex.: dois blocos do MESMO forro colapsam num material só que herda o numero do 1º bloco na
  // ordem do PostgREST — pode ser 2, sem que exista forro#1). Contagem+1 recalculava um numero já
  // existente → colisão em uq_plan_mat (slot_id,tipo,numero) → 23505 "valor duplicado" ao Salvar/
  // Aplicar ao modelo (regressão ago/2026 — o renumMateriais anterior só cobria remover-e-readicionar,
  // NÃO o load-com-buraco). max+1 é seguro para qualquer configuração de numero (contígua ou com buraco).
  const maxNum = existentes.reduce((mx, m) => (m.tipo === tipo ? Math.max(mx, Number(m.numero) || 0) : mx), 0);
  const numero = maxNum + 1;
  return { artigo_id: null, tipo, numero, consumo: 0, loss_percent: 0, ordem: existentes.length, variantes: [] };
}

// Renumera `numero` 1..n POR TIPO (tecido/forro), preservando a ordem relativa — mesmo padrão já
// usado p/ variantes (MaterialBlock.tsx `renum`, ordem 1..n em uq_plan_var). Mantém os numeros
// contíguos ao remover um material do meio (complementa o max+1 do novoMaterial acima; ambos
// protegem uq_plan_mat (slot_id,tipo,numero) do 23505 "valor duplicado").
function renumMateriais(materiais: PtMaterial[]): PtMaterial[] {
  const porTipo: Partial<Record<PtMaterial["tipo"], number>> = {};
  return materiais.map((m) => {
    const n = (porTipo[m.tipo] = (porTipo[m.tipo] ?? 0) + 1);
    return m.numero === n ? m : { ...m, numero: n };
  });
}

export function ModelCard({
  slot,
  onChange,
  selected,
  onToggleSelect,
  colecaoId,
  subcolecaoId,
  paleta,
  tamanhos,
  ocsAplicadas,
  slotOcIds,
  vinculos,
  lancado,
  travado,
  maoObraEstado,
  maoObraServico,
  versao,
  origem,
  fase,
  onEnsureSaved,
  defaultOpen,
  open: openProp,
  onToggleOpen,
  fornecCom,
  fornecTotal,
  dragHandle,
  variantesGrupoT1,
}: {
  slot: PtSlot;
  onChange: (s: PtSlot) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  colecaoId?: string;
  subcolecaoId?: string | null;
  paleta?: { artigo_id: string; papel: string }[];
  tamanhos?: string[];
  ocsAplicadas?: { id: string; numero_pedido: string | null; is_rolo?: boolean; tecidos: string[]; categorias?: string[]; artigos?: string[]; fornecedor?: string | null; owned?: boolean }[];
  slotOcIds?: string[];
  vinculos?: { oc_id: string; numero_pedido: string | null; tecidos: string | null }[];
  lancado?: boolean;
  /** Modelo já enviado ao CAD (travado p/ edição no Dev): "Aplicar ao modelo" fica desabilitado. */
  travado?: boolean;
  /** Estado da MO por serviço (aprovada|pendente|reprovada|sem_servico) — READ-ONLY; undefined = sem custo/mascarado. */
  maoObraEstado?: string;
  maoObraServico?: number | null;
  versao?: number | null;
  /** `modelos.origem` ("interno"|"revenda"|"importado") — espelho de comprado: badge + esconde controles de tecido. */
  origem?: string | null;
  /** Fase do modelo no fluxo (item 10) — badge/3ª linha ao lado da foto; a fase MAIS avançada verdadeira. */
  fase?: { label: string; tone: "success" | "warning" | "info" | "neutral" } | null;
  onEnsureSaved?: () => Promise<boolean>;
  defaultOpen?: boolean;
  /** Controle externo do aberto/recolhido (para "recolher/expandir todos"). Se ausente, usa estado local. */
  open?: boolean;
  onToggleOpen?: () => void;
  /** Status de fornecedor: nº de materiais com fornecedor / total (selo no header). */
  fornecCom?: number;
  fornecTotal?: number;
  /** Alça de arraste (o header vira handle do drag-n-drop entre lanes). */
  dragHandle?: DragHandle;
  /** Modo Plano: união VISUAL das variantes do Tecido 1 do grupo (nome de tecido). O bloco do
      Tecido 1 exibe as faltantes com qtd 0 (fantasma, editável — digitar promove p/ real).
      NÃO grava por exibir. undefined fora do Modo Plano (comportamento normal). */
  variantesGrupoT1?: PtVariante[];
}) {
  const qc = useQueryClient();
  const [openLocal, setOpenLocal] = useState(defaultOpen ?? false);
  const open = openProp ?? openLocal;
  const toggleOpen = onToggleOpen ?? (() => setOpenLocal((o) => !o));
  // Índice (no array original `slot.materiais`) do "Tecido 1" — o que dá nome à faixa no Modo Plano.
  // MESMO critério do ModoPlanoView (`tec1 = materiais.find(tipo tecido && artigo_id)`): o 1º tecido
  // COM artigo escolhido; fallback p/ o 1º tecido (sem artigo) se nenhum tiver. Só esse bloco recebe
  // a união de variantes do grupo (`variantesGrupoT1`) — casar o critério evita aplicar a união de um
  // material a outro (desalinhamento). -1 se não houver material de tecido → nenhuma fantasma.
  const tec1Idx = (() => {
    const comArtigo = slot.materiais.findIndex((m) => m.tipo === "tecido" && m.artigo_id);
    if (comArtigo >= 0) return comArtigo;
    return slot.materiais.findIndex((m) => m.tipo === "tecido");
  })();
  const [confirmGrade, setConfirmGrade] = useState(false);
  const [aplicandoGrade, setAplicandoGrade] = useState(false);
  // Guarda vazio-sobre-preenchido (backend RAISE P0001, hint 'plan_tecido_sobrescrita'):
  // guarda a mensagem PT do banco p/ o 2º AlertDialog de confirmação.
  const [sobrescritaMsg, setSobrescritaMsg] = useState<string | null>(null);
  const [confirmLimpar, setConfirmLimpar] = useState(false);

  // "Limpar slot" (#4c): zera o rascunho do slot MANTENDO a vaga (id/slot_index). Só p/ slot SEM
  // modelo (vaga). É estado LOCAL da árvore (persiste no Save do Plan.Tecido — delete+reinsert),
  // sem RPC. Preserva id/slot_index; limpa materiais/BOM/categoria/mix/proporções/custos/nome/ref.
  const limparSlot = () => {
    onChange({
      id: slot.id, slot_index: slot.slot_index, modelo_id: null,
      ref: null, nome: null, thumb_path: null, referencia_paths: [],
      proporcoes: null, categoria_id: null, categoria_tecido_id: null, mix_id: null,
      linha_id: null, markup_editado: null, preco_venda: null,
      custo_simulado: null, custo_terceirizados_previsto: null, custos_adicionais: [],
      usar_estoque: slot.usar_estoque, materiais: [],
    });
    setConfirmLimpar(false);
    toast.success("Slot limpo.");
  };

  // "Criar card no Planejamento" (que ficava aqui, por card) SAIU pra barra de seleção do
  // PlanTecidoSheet (G6 — criação em massa). `podeCriarCard`/`criarCard` foram removidos deste
  // componente; o predicado equivalente (`podeCriarCard`) foi replicado em PlanTecidoSheet.tsx
  // pra uso da ação em massa — ver comentário lá.

  // BOM do slot com a grade distribuída por proporção (compartilhado por aplicar + auto-aplicar
  // do save — fonte única em `buildMateriaisAplicar`, @/lib/plan-tecido/calc).
  const buildMateriais = () => buildMateriaisAplicar(slot);

  const invalidarModelo = () => {
    void qc.invalidateQueries({ queryKey: ["modelo"] });
    void qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
    void qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
    void qc.invalidateQueries({ queryKey: ["dash-estoque"] });
    // Chaves do DESENVOLVIMENTO afetadas por criar/aplicar (BOM, grade, proporção e VÍNCULO de OC):
    // sem isto, o card do Dev, se já montado/cacheado, mostra dado velho e a OC propagada pelo
    // "aplicar" não aparece selecionada. (["cad-grades"] era alvo errado — aplicar mexe em
    // modelo_grades, não cad_grades — e ["modelo"] casa só o Planejamento, não o Dev.)
    const mid = slot.modelo_id;
    if (mid) {
      void qc.invalidateQueries({ queryKey: ["modelo-detail", mid] });
      void qc.invalidateQueries({ queryKey: ["modelo-tecidos", mid] });
      void qc.invalidateQueries({ queryKey: ["modelo-grades", mid] });
      void qc.invalidateQueries({ queryKey: ["modelo-tecido-oc-links", mid] });
      void qc.invalidateQueries({ queryKey: ["modelo-precos-congelado", mid] });
      void qc.invalidateQueries({ queryKey: ["dev-cad-precos-congelado", mid] });
    }
    // Chips "OC do Desenvolvimento" no card do plano refletem na hora (senão só ao refocar a janela).
    if (colecaoId) void qc.invalidateQueries({ queryKey: ["plan-tecido-vinculos", colecaoId] });
    // Aplicar/Criar SINCRONIZA os hints de slot em modelo_tecido_oc_links, fonte de COBERTURA da
    // prévia (has_card=true) → o "a comprar" do Resumo muda. Sem isto só atualizava ao refocar (bug #2).
    if (colecaoId) void qc.invalidateQueries({ queryKey: ["plan-tecido-previa", colecaoId] });
  };

  const { data: categorias = [] } = useQuery({
    queryKey: ["plan-tecido-categorias"],
    queryFn: async () =>
      ((await supabase.from("categorias_produto").select("id, nome").order("nome")).data ?? []) as {
        id: string;
        nome: string;
      }[],
  });

  const necTecidos = necessidadePorTecido({
    colecao_id: "",
    subcolecoes: [
      {
        subcolecao_id: null,
        ordem: 0,
        linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [slot] }],
      },
    ],
  });
  const total = necTecidos.reduce((s, t) => s + t.totalMetros, 0);
  const temGrade = slot.materiais.some((m) => m.variantes.some((v) => v.grade_total > 0));
  // Flag "Usar estoque existente" APOSENTADO (decisão do dono 17/ago/2026): a coluna
  // plan_tecido_slots.usar_estoque fica INERTE — o save segue preservando o valor existente (round-trip
  // do arvore), mas a UI não expõe mais o checkbox nem sinaliza o card (borda/selo). Régua única agora:
  // vinculou OC/rolo = consome o físico daquela fonte; não vinculou = compra.
  // Espelho de comprado (revenda/importado): NÃO planeja tecido (card informativo, ocupa a vaga
  // do bucket — não filtrar/esconder o card em si, só os controles de tecido dentro dele).
  const isComprado = ehOrigemComprada(origem);
  // peças = grade total do Tecido 1 (base do modelo)
  const pieces = (slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1)?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);
  const borderClass = open ? "border-primary" : "";

  // Estado do botão "Aplicar ao modelo" (empurra o BOM completo). Bloqueia só se lançado.
  const gradeDisabled = !slot.id || !slot.modelo_id || !!lancado || !!travado || aplicandoGrade;
  // Mensagem do botão "Aplicar ao modelo" (tooltip ao passar o mouse). Os avisos de lançado/travado
  // ficam AQUI (antes eram um <p> abaixo do botão que ocupava espaço vertical e desalinhava as
  // variantes do resumo — pedido do dono set/2026): o botão desabilitado explica no hover.
  const gradeTitle = !slot.id
    ? "Salve o plano primeiro"
    : !slot.modelo_id
      ? "Este item não está ligado a um card de modelo"
      : lancado
        ? "Modelo lançado — aplicar não altera o BOM."
        : travado
          ? "Modelo enviado ao CAD (travado). Destrave no Desenvolvimento para alterar; aplicar aqui não terá efeito."
          : undefined;

  async function aplicarAoModelo(confirmarSobrescrita = false) {
    if (!slot.id) { setConfirmGrade(false); return; }
    setAplicandoGrade(true);
    try {
      if (onEnsureSaved) { const ok = await onEnsureSaved(); if (!ok) return; }
      const { error } = await supabase.rpc("plan_tecido_aplicar_ao_modelo" as any, {
        _slot_id: slot.id,
        _materiais: buildMateriais(),
        ...(confirmarSobrescrita ? { _confirmar_sobrescrita: true } : {}),
      });
      if (error) throw error;
      toast.success("Aplicado ao modelo (tecidos, variantes, consumo e grade).");
      setSobrescritaMsg(null);
      invalidarModelo();
    } catch (e: any) {
      // Guarda vazio-sobre-preenchido: em vez de toastar o erro, abre confirmação e re-chama
      // com _confirmar_sobrescrita=true. hint estável evita casar por texto (i18n-safe).
      if (e?.hint === "plan_tecido_sobrescrita") {
        setSobrescritaMsg(mensagemErro(e, "Aplicar sobrescreveria dados já cadastrados no modelo."));
      } else {
        toast.error(mensagemErro(e, "Não foi possível aplicar ao modelo."));
      }
    } finally {
      setAplicandoGrade(false);
      setConfirmGrade(false);
    }
  }

  // G5: carrinho — o card já foi COMPRADO (pedido feito) quando tem hint de OC do plano
  // (plan_tecido_slot_oc, gravado pelo "Fazer pedido" da seleção) OU vínculo real do Dev
  // (modelo_tecido_oc_links). Ícone no canto sup. direito; o nome reserva espaço (pr-6) pra
  // truncar ANTES dele em vez de passar por baixo.
  const comprado = (slotOcIds?.length ?? 0) > 0 || (vinculos?.length ?? 0) > 0;

  return (
    <>
      <div className={`rounded-lg border ${borderClass} relative`}>
        {/* Checkbox de seleção múltipla */}
        {onToggleSelect && (
          <div className="absolute left-1 top-1 z-10">
            <Checkbox
              checked={selected ?? false}
              onCheckedChange={onToggleSelect}
              className="h-4 w-4 max-md:h-6 max-md:w-6"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        {/* Foto FORA do <button> (não aninhar interativos): clicar abre o lightbox (item 12); o resto
            do header segue sendo o toggle/handle de arraste. Referência (G4) também fica fora —
            é um Dialog próprio, não pode aninhar num <button>. */}
        {/* Header (redesenho set/2026 — pedido do dono): FOTO grande à esquerda · info empilhada no
            meio (nome+v, REF, pç·m, badges numa linha própria) · ações à direita no topo (anexar
            foto + recolher/expandir). O clique no MIOLO (info) recolhe/expande e é o handle de arraste. */}
        <div className="flex w-full gap-2 p-2">
          {/* Hierarquia da imagem do card (G4): foto do modelo (thumb_path) vence; senão a 1ª de referência. */}
          <ModeloThumb path={slot.thumb_path ?? slot.referencia_paths?.[0] ?? null} className="h-24 w-[72px] shrink-0" zoom alt={slot.nome ?? "Modelo"} />
          {/* Coluna de INFO: o <button> (toggle recolher/expandir) cobre nome/REF/pç·m/badges; a
              Categoria fica FORA do button (select é inválido dentro de button e o clique conflitaria
              com o toggle) mas na MESMA coluna — no header, logo abaixo da REF/badges (dono set/2026). */}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Nome + REF = handle de toggle (button). Sai antes da Categoria p/ ela ficar logo abaixo
              da REF (dono set/2026) — o select é inválido dentro de <button> e o clique conflitaria. */}
          <button
            className={`flex min-w-0 flex-col items-start gap-0.5 text-left ${dragHandle ? "cursor-grab active:cursor-grabbing [touch-action:manipulation]" : ""}`}
            onClick={toggleOpen}
            {...(dragHandle?.attributes ?? {})}
            {...(dragHandle?.listeners ?? {})}
            title={dragHandle ? "Arraste para outra categoria (ou clique para recolher)" : undefined}
          >
            <div className="flex w-full items-start gap-1.5">
              {/* Nome reserva SEMPRE 2 linhas de altura (min-h = 2×leading-tight = 2.5em), mesmo quando
                  cabe em 1 — mantém a altura do topo idêntica entre cards p/ o alinhamento no Modo Plano.
                  line-clamp-2 corta em 2 linhas; title mostra o nome completo ao passar o mouse. */}
              <span className="line-clamp-2 min-h-[2.5em] min-w-0 flex-1 text-[13px] font-semibold leading-tight" title={slot.nome ?? "Modelo"}>{slot.nome ?? "Modelo"}</span>
              {versao != null && <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-bold text-primary" title="Versão do modelo (Planejamento de Produto)">v{versao}</span>}
              {isComprado && (
                <span title={`Espelho de produto ${rotuloOrigem(origem).toLowerCase()} — sem tecido a planejar`}>
                  <StatusBadge tone="info" className="shrink-0">{rotuloOrigem(origem)}</StatusBadge>
                </span>
              )}
            </div>
            {/* REF na PRÓPRIA linha e "N pç · N m" numa linha separada (.num), tipografia consistente. */}
            {slot.ref && (
              <div className="w-full truncate text-[11px] leading-tight text-muted-foreground tabular-nums" title={slot.ref}>
                {slot.ref}
              </div>
            )}
          </button>
          {/* Categoria — logo ABAIXO da REF (dono set/2026). Fora do <button> do toggle. Usa o Select
              ESTILIZADO do sistema (Radix), não o <select> nativo — dropdown consistente com o resto.
              Radix não aceita SelectItem value="" → sentinela "__none__" p/ "sem categoria". */}
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-[10px] text-muted-foreground">Categoria</span>
            <Select
              value={slot.categoria_id ?? "__none__"}
              onValueChange={(v) => onChange({ ...slot, categoria_id: v === "__none__" ? null : v })}
            >
              <SelectTrigger className="h-7 min-w-0 flex-1 text-[11px] max-md:h-11 max-md:text-base">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* pç·m + badges = 2ª área clicável do toggle. */}
          <button
            type="button"
            className="flex min-w-0 flex-col items-start gap-0.5 text-left"
            onClick={toggleOpen}
          >
            {!isComprado && (
              <div className="flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                <span><span className="num">{pieces}</span> pç</span>
                <span aria-hidden className="opacity-60">·</span>
                <span><span className="num">{total ? fmtInt(total) : "0"}</span> m</span>
              </div>
            )}
            {/* Badges numa ÚNICA linha (fase + fornecedor + sem peças) — SEM flex-wrap: quebrar a
                "sem peças" pra 2ª linha variava a altura do topo entre cards e desalinhava o Modo
                Plano (dono set/2026). Truncagem CORRETA da fase: `min-w-0` no BADGE (item da linha,
                encolhe só quando falta espaço) + `truncate` num SPAN interno — text-overflow não
                funciona direto em container flex (o Badge é inline-flex; truncate nele só CLIPAVA
                sem "…" e o max-w-full percentual colapsava a largura mesmo com espaço sobrando). */}
            <div className="mt-0.5 flex w-full items-center gap-0.5">
              {/* Sem prefixos "✓ "/"⚠ " nas curtas (dono set/2026): a COR do badge (verde/âmbar) já
                  comunica o estado, e os ~24px poupados são o que deixa a FASE caber INTEIRA no card
                  estreito do Modo Plano. O truncate da fase fica só como última defesa (fase longa
                  em card muito apertado), com o rótulo completo no tooltip. */}
              {slot.modelo_id && fase && (
                <StatusBadge tone={fase.tone} title={`Etapa atual: ${fase.label}`} className="min-w-0 px-1 normal-case tracking-normal">
                  <span className="min-w-0 truncate">{fase.label}</span>
                </StatusBadge>
              )}
              {!isComprado && fornecTotal ? (
                fornecCom === fornecTotal
                  ? <StatusBadge tone="success" title="Todos os materiais têm fornecedor" className="shrink-0 px-1 py-0.5 normal-case tracking-normal">fornec.</StatusBadge>
                  : <StatusBadge tone="warning" title="Materiais com fornecedor" className="shrink-0 px-1 py-0.5 normal-case tracking-normal">{fornecCom}/{fornecTotal}</StatusBadge>
              ) : null}
              {!isComprado && !temGrade && <StatusBadge tone="warning" title="Falta a grade: informe as PEÇAS (campo 'pç' de cada cor) em 'Tecidos & Forros'. A 'Proporção por tamanho' só distribui essa quantidade — não substitui o 'pç'." className="shrink-0 px-1 py-0.5 normal-case tracking-normal">s/ peças</StatusBadge>}
              {/* Carrinho (G5) MOVIDO p/ o fim da linha do dropdown das OCs (dono set/2026) — na linha
                  das badges ele quebrava para uma 2ª linha e variava a altura do topo entre cards. */}
            </div>
          </button>
          </div>
          {/* Ações à direita, no topo: anexar foto (ReferenciaDialog) + recolher/expandir; e ⋯ p/ vaga. */}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              <ReferenciaDialog slot={slot} onChange={onChange} />
              <button type="button" onClick={toggleOpen} aria-label={open ? "Recolher card" : "Expandir card"}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
              </button>
            </div>
            {/* Limpar slot (#4c): só em VAGA (slot sem modelo). Zera o rascunho mantendo a vaga. */}
            {!slot.modelo_id && (
              <Popover>
                <PopoverTrigger asChild>
                  <span role="button" tabIndex={0} onClick={(e) => e.stopPropagation()}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Mais ações">
                    <MoreHorizontal className="h-4 w-4" />
                  </span>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-44 p-1" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => setConfirmLimpar(true)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-muted">
                    <Eraser className="h-4 w-4 shrink-0" /> Limpar slot
                  </button>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
        {!open && necTecidos.length > 0 && (
          <div className="space-y-1.5 border-t px-2 py-1.5">
            {necTecidos.map((t, ti) => (
              <div key={ti} className="space-y-0.5">
                <div className="truncate text-[10px] font-semibold uppercase tracking-tight text-muted-foreground">{t.artigo_nome}</div>
                {/* variantes do preview do card recolhido em ordem alfabética (dono, jul/2026) — exibição só */}
                {[...t.variantes].sort((a, b) => (a.label ?? "").localeCompare(b.label ?? "", "pt-BR", { sensitivity: "base" })).map((v, i) => (
                  <div key={i} className="flex items-center gap-2 pl-1 text-[11px]">
                    <VarianteSwatch nome={v.cor_nome ?? undefined} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{v.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{fmtMetros(v.metros)} m</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {open && (
          <>
            {/* Pós-explosão (enviado_cad): o BOM já foi explodido pelo CAD — o card TRAVA a edição de
                tecido (cor/pç/consumo/tecido). A régua do dono: até a Explosão, o card manda; a partir
                dela, ajuste no PCP/CAD. (O gate real está no servidor — aqui é só o aviso + inputs off.) */}
            {!isComprado && travado && (
              <div className="flex items-start gap-1.5 border-t bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                <span><b>Enviado à Explosão</b></span>
              </div>
            )}
            {/* Proporção por tamanho (fixa no topo, não colapsável) — só a DISTRIBUIÇÃO; a quantidade
                (peças) é o 'pç' por cor no bloco do tecido. Antes chamava "Grade" e colidia com a badge.
                Revenda: não há tecido a planejar — controle escondido (card informativo). */}
            {!isComprado && (
              <div className="border-t bg-muted/20 pb-1">
                <div className="px-2 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" title="Distribui as peças (pç) entre os tamanhos. A quantidade é o 'pç' de cada cor, abaixo em Tecidos & Forros.">Proporção por tamanho</div>
                <GradeSection slot={slot} onChange={onChange} tamanhos={tamanhos} readOnly={!!travado} />
              </div>
            )}
            {/* Categoria MOVIDA para o header (abaixo da REF/badges) — dono set/2026. */}
            {/* Flag "Usar estoque existente" APOSENTADO (dono 17/ago/2026) — checkbox removido. A régua
                única agora é por VÍNCULO (OC/rolo abaixo, no hint), não por um flag de card. */}
            {/* "Aplicar ao modelo"/"Criar card" empurram BOM de TECIDO + o hint de OC de tecido —
                nenhum dos dois se aplica a um espelho de revenda (sem BOM de tecido). */}
            {colecaoId && !isComprado && (
              <div className="border-t px-2 py-1">
                {slot.modelo_id ? (
                  // card existe → aplicar grade nele
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    disabled={gradeDisabled}
                    title={gradeTitle}
                    onClick={() => setConfirmGrade(true)}
                  >
                    {aplicandoGrade ? "Aplicando…" : "Aplicar ao modelo"}
                  </Button>
                ) : null}
                {/* Aviso de lançado/travado saiu daqui (era um <p> que ocupava espaço e desalinhava as
                    variantes) — virou o `title`/tooltip do botão "Aplicar ao modelo" acima. */}
                {/* "Criar card no Planejamento" saiu do card — agora é ação em massa na barra de
                    seleção do PlanTecidoSheet (G6). */}
                {/* OC vinculada no Desenvolvimento (read-only, congela custo) — ou hint do plano */}
                {colecaoId && (
                  <div className="mt-2">
                    {(vinculos?.length ?? 0) > 0 ? (
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Lock className="h-3 w-3" /> OC do Desenvolvimento
                        </div>
                        {/* Modo Plano: as OCs vinculadas viram UM chip de altura FIXA (1 linha), com a
                            lista completa no popover. Empilhar N badges dava altura variável por card e
                            desalinhava as variantes do Tecido 1 com o resumo (decisão do dono set/2026).
                            O carrinho (pedido feito) fica no FIM desta linha (dono set/2026). */}
                        <div className="flex items-center justify-between gap-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded-full border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/70">
                                <Lock className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">
                                  {vinculos!.length === 1
                                    ? (vinculos![0].numero_pedido || "OC s/ nº")
                                    : `${vinculos!.length} OCs vinculadas`}
                                </span>
                                <ChevronRight className="h-2.5 w-2.5 shrink-0 rotate-90" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-64 p-2">
                              <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                                <Lock className="h-3 w-3" /> Vínculos do Desenvolvimento — congelam o custo
                              </div>
                              <div className="max-h-48 space-y-1 overflow-y-auto">
                                {vinculos!.map((v) => (
                                  <div key={v.oc_id} className="flex items-start gap-1.5 rounded border bg-muted/40 px-2 py-1 text-[11px]">
                                    <Lock className="mt-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0">
                                      <span className="block font-medium tabular-nums">{v.numero_pedido || "OC s/ nº"}</span>
                                      {v.tecidos && <span className="block truncate text-[10px] text-muted-foreground">{v.tecidos}</span>}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                          {comprado && <ShoppingCart className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Comprado (pedido feito)" />}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <SlotOcHint colecaoId={colecaoId} slotId={slot.id} ocsAplicadas={ocsAplicadas ?? []} selected={slotOcIds ?? []} categoriaLane={slot.categoria_tecido_id ?? null} slotArtigos={(slot.materiais ?? []).map((m) => m.artigo_id).filter((a): a is string => !!a)} onEnsureSaved={onEnsureSaved} />
                        </div>
                        {comprado && <ShoppingCart className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Comprado (pedido feito)" />}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <Accordion type="multiple" defaultValue={["mat"]} className="border-t px-2">
              {/* Materiais de TECIDO/FORRO — não existem num espelho de revenda. */}
              {!isComprado && (
                <AccordionItem value="mat">
                  <AccordionTrigger className="py-2 text-xs">1. Tecidos &amp; Forros</AccordionTrigger>
                  <AccordionContent>
                    {/* Exibição: TECIDO antes de FORRO (dono, ago/2026) — sort estável só na
                        renderização; o array (e os índices dos callbacks) não muda. */}
                    {[...slot.materiais.entries()]
                      .sort(([, a], [, b]) => (a.tipo === b.tipo ? 0 : a.tipo === "tecido" ? -1 : 1))
                      .map(([i, m]) => (
                      <MaterialBlock
                        key={m.id ?? i}
                        material={m}
                        readOnly={!!travado}
                        laneCategoriaId={slot.categoria_tecido_id ?? null}
                        paleta={paleta}
                        variantesGrupo={i === tec1Idx ? variantesGrupoT1 : undefined}
                        onChange={(nm) => {
                          const materiais = slot.materiais.slice();
                          materiais[i] = nm;
                          onChange({ ...slot, materiais });
                        }}
                        onRemove={() =>
                          onChange({ ...slot, materiais: renumMateriais(slot.materiais.filter((_, j) => j !== i)) })
                        }
                      />
                    ))}
                    {/* Adicionar tecido/forro some quando travado (enviado à Explosão) — o BOM já foi
                        explodido; qualquer novo material teria que ir pelo PCP/CAD. */}
                    {!travado && (
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            onChange({
                              ...slot,
                              materiais: [...slot.materiais, novoMaterial(slot.materiais, "tecido")],
                            })
                          }
                        >
                          + tecido
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            onChange({
                              ...slot,
                              materiais: [...slot.materiais, novoMaterial(slot.materiais, "forro")],
                            })
                          }
                        >
                          + forro
                        </Button>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              )}
              <AccordionItem value="custo">
                <AccordionTrigger className="py-2 text-xs">2. Custo &amp; Preço</AccordionTrigger>
                <AccordionContent>
                  <CustoSection slot={slot} onChange={onChange} maoObraEstado={maoObraEstado} maoObraServico={maoObraServico} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </>
        )}
      </div>

      <AlertDialog open={confirmGrade} onOpenChange={setConfirmGrade}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar ao modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              Grava no card do modelo os <b>tecidos/forros, variantes, consumo e grade</b> deste item
              (substitui o BOM de tecido do modelo). Não mexe em entretela/aviamentos. Permitido em
              etapa avançada; bloqueado se o modelo já foi lançado. Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={aplicandoGrade}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={aplicandoGrade} onClick={() => aplicarAoModelo()}>
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 2º passo: o backend barrou (apagaria cores/grade já cadastradas). Confirma a sobrescrita. */}
      <AlertDialog open={!!sobrescritaMsg} onOpenChange={(o) => { if (!o) setSobrescritaMsg(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sobrescrever dados do modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              {sobrescritaMsg} Isso substitui o BOM de tecido do modelo pelo deste item.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={aplicandoGrade}>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={aplicandoGrade} onClick={() => aplicarAoModelo(true)}>
              Aplicar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Limpar slot (#4c) — zera o rascunho da vaga, mantém a vaga na lista */}
      <AlertDialog open={confirmLimpar} onOpenChange={setConfirmLimpar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar slot?</AlertDialogTitle>
            <AlertDialogDescription>
              Zera os dados deste slot (tecidos, categoria, família, custos, nome…). A vaga continua
              na lista, vazia, na mesma posição. A limpeza é aplicada ao salvar o plano.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={limparSlot}>Limpar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
