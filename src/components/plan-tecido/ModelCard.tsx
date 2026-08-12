import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { PtSlot, PtMaterial } from "@/lib/plan-tecido/types";
import { ChevronRight, Lock } from "lucide-react";
import type { DragHandle } from "./dnd";
import { necessidadePorTecido, distribuirGrade, fmtMetros } from "@/lib/plan-tecido/calc";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { StatusBadge } from "@/components/shared/StatusBadge";

function novoMaterial(existentes: PtMaterial[], tipo: "tecido" | "forro"): PtMaterial {
  const numero = existentes.filter((m) => m.tipo === tipo).length + 1;
  return { artigo_id: null, tipo, numero, consumo: 0, loss_percent: 0, ordem: existentes.length, variantes: [] };
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
  onEnsureSaved,
  defaultOpen,
  open: openProp,
  onToggleOpen,
  fornecCom,
  fornecTotal,
  dragHandle,
}: {
  slot: PtSlot;
  onChange: (s: PtSlot) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  colecaoId?: string;
  subcolecaoId?: string | null;
  paleta?: { artigo_id: string; papel: string }[];
  tamanhos?: string[];
  ocsAplicadas?: { id: string; numero_pedido: string | null; is_rolo?: boolean; tecidos: string[]; categorias?: string[] }[];
  slotOcIds?: string[];
  vinculos?: { oc_id: string; numero_pedido: string | null; tecidos: string | null }[];
  lancado?: boolean;
  /** Modelo já enviado ao CAD (travado p/ edição no Dev): "Aplicar ao modelo" fica desabilitado. */
  travado?: boolean;
  /** Estado da MO por serviço (aprovada|pendente|reprovada|sem_servico) — READ-ONLY; undefined = sem custo/mascarado. */
  maoObraEstado?: string;
  maoObraServico?: number | null;
  versao?: number | null;
  /** `modelos.origem` ("interno"|"revenda") — espelho de revenda: badge + esconde controles de tecido. */
  origem?: string | null;
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
}) {
  const qc = useQueryClient();
  const [openLocal, setOpenLocal] = useState(defaultOpen ?? false);
  const open = openProp ?? openLocal;
  const toggleOpen = onToggleOpen ?? (() => setOpenLocal((o) => !o));
  const [confirmGrade, setConfirmGrade] = useState(false);
  const [aplicandoGrade, setAplicandoGrade] = useState(false);
  const [criandoCard, setCriandoCard] = useState(false);

  // "Criar card" no Planejamento: só p/ slot ainda não ligado a um modelo, com nome ou tecido.
  const podeCriarCard = !slot.modelo_id && (!!slot.nome || slot.materiais.some((m) => m.artigo_id));

  // BOM do slot com a grade distribuída por proporção (compartilhado por criar/aplicar)
  const buildMateriais = () =>
    slot.materiais.map((m) => ({
      tipo: m.tipo, numero: m.numero, artigo_id: m.artigo_id, consumo: m.consumo, loss_percent: m.loss_percent,
      variantes: m.variantes.map((v) => ({
        variante_tecido_id: v.variante_tecido_id, ordem: v.ordem, multiplicador: v.multiplicador,
        grades: v.grades && Object.keys(v.grades).length ? v.grades : distribuirGrade(v.grade_total, slot.proporcoes),
        grade_total: v.grade_total,
      })),
    }));

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
  };

  async function criarCard() {
    if (!colecaoId) return;
    if (onEnsureSaved) { const ok = await onEnsureSaved(); if (!ok) return; }
    const _slot = {
      nome: slot.nome ?? null, ref: slot.ref ?? null, slot_id: slot.id ?? null,
      linha_id: slot.linha_id ?? null, categoria_id: slot.categoria_id ?? null,
      subcolecao_id: subcolecaoId ?? null,
      preco_venda: slot.preco_venda ?? null,
      custo_terceirizados_previsto: 0, // inerte: a MO nasce por-serviço no Planejamento (modelo_servico_mo)
      custo_simulado: slot.custo_simulado ?? {},
      materiais: buildMateriais(),
    };
    setCriandoCard(true);
    try {
      const { data, error } = await supabase.rpc("plan_tecido_criar_card" as any, { _colecao_id: colecaoId, _slot });
      if (error) throw error;
      toast.success("Card criado no Planejamento.");
      if (data) onChange({ ...slot, modelo_id: data as string }); // liga o slot no ato (botão vira "Aplicar")
      invalidarModelo();
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível criar o card."));
    } finally {
      setCriandoCard(false);
    }
  }

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
  const usarEstoque = slot.usar_estoque ?? false;
  // Espelho de revenda: NÃO planeja tecido (card informativo, ocupa a vaga do bucket — não
  // filtrar/esconder o card em si, só os controles de tecido dentro dele).
  const isRevenda = origem === "revenda";
  // peças = grade total do Tecido 1 (base do modelo)
  const pieces = (slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1)?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);
  const borderClass = open ? "border-primary" : usarEstoque ? "border-amber-500" : "";

  // Estado do botão "Aplicar ao modelo" (empurra o BOM completo). Bloqueia só se lançado.
  const gradeDisabled = !slot.id || !slot.modelo_id || !!lancado || !!travado || aplicandoGrade;
  const gradeTitle = !slot.id
    ? "Salve o plano primeiro"
    : !slot.modelo_id
      ? "Este item não está ligado a um card de modelo"
      : lancado
        ? "Modelo já lançado — não é possível alterar"
        : travado
          ? "Modelo já enviado ao CAD (travado) — destrave no Desenvolvimento para alterar"
          : undefined;

  async function aplicarAoModelo() {
    if (!slot.id) { setConfirmGrade(false); return; }
    setAplicandoGrade(true);
    try {
      if (onEnsureSaved) { const ok = await onEnsureSaved(); if (!ok) return; }
      const { error } = await supabase.rpc("plan_tecido_aplicar_ao_modelo" as any, {
        _slot_id: slot.id,
        _materiais: buildMateriais(),
      });
      if (error) throw error;
      toast.success("Aplicado ao modelo (tecidos, variantes, consumo e grade).");
      invalidarModelo();
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível aplicar ao modelo."));
    } finally {
      setAplicandoGrade(false);
      setConfirmGrade(false);
    }
  }

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
        <button
          className={`flex w-full items-center gap-2 p-2 text-left ${dragHandle ? "cursor-grab active:cursor-grabbing [touch-action:manipulation]" : ""}`}
          onClick={toggleOpen}
          {...(dragHandle?.attributes ?? {})}
          {...(dragHandle?.listeners ?? {})}
          title={dragHandle ? "Arraste para outra categoria (ou clique para recolher)" : undefined}
        >
          <ModeloThumb path={slot.thumb_path} className="h-16 w-16" />
          <div className={`min-w-0 flex-1 ${onToggleSelect ? "ml-3" : ""}`}>
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold leading-tight">{slot.nome ?? "Modelo"}</span>
              {versao != null && <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-bold text-primary" title="Versão do modelo (Planejamento de Produto)">v{versao}</span>}
              {isRevenda && (
                <span title="Espelho de produto de revenda — sem tecido a planejar">
                  <StatusBadge tone="info" className="shrink-0">Revenda</StatusBadge>
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              {slot.ref && <span className="tabular-nums">{slot.ref}</span>}
              {!isRevenda && <span className="tabular-nums">{pieces} pç</span>}
              {!isRevenda && <span className="tabular-nums">{total ? `${total.toFixed(0)} m` : "0 m"}</span>}
              {!isRevenda && usarEstoque && <span className="font-medium text-amber-700">estoque</span>}
            </div>
          </div>
          {!isRevenda && fornecTotal ? (
            fornecCom === fornecTotal
              ? <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700" title="Todos os materiais têm fornecedor">✓ fornec.</span>
              : <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title="Materiais com fornecedor">{fornecCom}/{fornecTotal}</span>
          ) : null}
          {!isRevenda && !temGrade && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title="Falta a grade: informe as PEÇAS (campo 'pç' de cada cor) em 'Tecidos & Forros'. A 'Proporção por tamanho' só distribui essa quantidade — não substitui o 'pç'.">⚠ sem peças</span>}
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
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
            {/* Proporção por tamanho (fixa no topo, não colapsável) — só a DISTRIBUIÇÃO; a quantidade
                (peças) é o 'pç' por cor no bloco do tecido. Antes chamava "Grade" e colidia com a badge.
                Revenda: não há tecido a planejar — controle escondido (card informativo). */}
            {!isRevenda && (
              <div className="border-t bg-muted/20 pb-1">
                <div className="px-2 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" title="Distribui as peças (pç) entre os tamanhos. A quantidade é o 'pç' de cada cor, abaixo em Tecidos & Forros.">Proporção por tamanho</div>
                <GradeSection slot={slot} onChange={onChange} tamanhos={tamanhos} />
              </div>
            )}
            <div className="border-t px-2 py-1 flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground shrink-0">Categoria</span>
              <select
                className="flex-1 rounded border bg-background px-2 py-1 text-xs h-8 max-md:h-11 max-md:text-base"
                value={slot.categoria_id ?? ""}
                onChange={(e) => onChange({ ...slot, categoria_id: e.target.value || null })}
              >
                <option value="">—</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            {/* "Usar estoque existente" é sobre estoque de TECIDO — sem sentido pra revenda. */}
            {!isRevenda && (
              <div className="border-t px-2 py-1 flex items-center gap-2">
                <label
                  className="flex cursor-pointer items-center gap-2 text-xs select-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    id={`usar-estoque-${slot.id ?? slot.modelo_id ?? "new"}`}
                    checked={usarEstoque}
                    onCheckedChange={(v) => onChange({ ...slot, usar_estoque: !!v })}
                    className="h-4 w-4"
                  />
                  <span>Usar estoque existente</span>
                </label>
              </div>
            )}
            {/* "Aplicar ao modelo"/"Criar card" empurram BOM de TECIDO + o hint de OC de tecido —
                nenhum dos dois se aplica a um espelho de revenda (sem BOM de tecido). */}
            {colecaoId && !isRevenda && (
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
                {slot.modelo_id && (lancado || travado) && (
                  <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700">
                    <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{lancado ? "Modelo lançado — aplicar não altera o BOM." : "Modelo enviado ao CAD (travado). Destrave no Desenvolvimento para alterar; aplicar aqui não terá efeito."}</span>
                  </p>
                )}
                {!slot.modelo_id && (
                  // card ainda não existe → criar
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    disabled={!podeCriarCard || criandoCard}
                    title={podeCriarCard ? "Cria o card em Plan. Produto com os dados deste item" : "Defina um nome ou um tecido primeiro"}
                    onClick={criarCard}
                  >
                    {criandoCard ? "Criando…" : "Criar card no Planejamento"}
                  </Button>
                )}
                {/* OC vinculada no Desenvolvimento (read-only, congela custo) — ou hint do plano */}
                {colecaoId && (
                  <div className="mt-2">
                    {(vinculos?.length ?? 0) > 0 ? (
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Lock className="h-3 w-3" /> OC do Desenvolvimento
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {vinculos!.map((v) => (
                            <span key={v.oc_id} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                              title={`Vínculo do Desenvolvimento — congela o custo${v.tecidos ? ` · ${v.tecidos}` : ""}`}>
                              <Lock className="h-2.5 w-2.5" />
                              {v.numero_pedido || "OC s/ nº"}{v.tecidos ? ` — ${v.tecidos}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <SlotOcHint colecaoId={colecaoId} slotId={slot.id} ocsAplicadas={ocsAplicadas ?? []} selected={slotOcIds ?? []} categoriaLane={slot.categoria_tecido_id ?? null} slotArtigos={(slot.materiais ?? []).map((m) => m.artigo_id).filter((a): a is string => !!a)} onEnsureSaved={onEnsureSaved} />
                    )}
                  </div>
                )}
              </div>
            )}
            <Accordion type="multiple" defaultValue={["mat"]} className="border-t px-2">
              {/* Materiais de TECIDO/FORRO — não existem num espelho de revenda. */}
              {!isRevenda && (
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
                        laneCategoriaId={slot.categoria_tecido_id ?? null}
                        paleta={paleta}
                        onChange={(nm) => {
                          const materiais = slot.materiais.slice();
                          materiais[i] = nm;
                          onChange({ ...slot, materiais });
                        }}
                        onRemove={() =>
                          onChange({ ...slot, materiais: slot.materiais.filter((_, j) => j !== i) })
                        }
                      />
                    ))}
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
            <AlertDialogAction disabled={aplicandoGrade} onClick={aplicarAoModelo}>
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
