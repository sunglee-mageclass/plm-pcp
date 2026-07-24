import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { PtSlot, PtMaterial } from "@/lib/plan-tecido/types";
import { ChevronRight, Lock, Check, X } from "lucide-react";
import { necessidadePorTecido, distribuirGrade } from "@/lib/plan-tecido/calc";
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
  maoObraAprovado,
  onSetMaoObra,
  onEnsureSaved,
  defaultOpen,
}: {
  slot: PtSlot;
  onChange: (s: PtSlot) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  colecaoId?: string;
  subcolecaoId?: string | null;
  paleta?: { artigo_id: string; papel: string }[];
  tamanhos?: string[];
  ocsAplicadas?: { id: string; numero_pedido: string | null; tecidos: string[] }[];
  slotOcIds?: string[];
  vinculos?: { oc_id: string; numero_pedido: string | null; tecidos: string | null }[];
  lancado?: boolean;
  maoObraAprovado?: boolean | null;
  onSetMaoObra?: (aprovado: boolean) => void;
  onEnsureSaved?: () => Promise<boolean>;
  defaultOpen?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(defaultOpen ?? false);
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
    void qc.invalidateQueries({ queryKey: ["cad-grades"] });
    void qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
    void qc.invalidateQueries({ queryKey: ["dash-estoque"] });
  };

  async function criarCard() {
    if (!colecaoId) return;
    if (onEnsureSaved) { const ok = await onEnsureSaved(); if (!ok) return; }
    const _slot = {
      nome: slot.nome ?? null, ref: slot.ref ?? null, slot_id: slot.id ?? null,
      linha_id: slot.linha_id ?? null, categoria_id: slot.categoria_id ?? null,
      subcolecao_id: subcolecaoId ?? null,
      preco_venda: slot.preco_venda ?? null,
      custo_terceirizados_previsto: slot.custo_terceirizados_previsto ?? 0,
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

  const total = necessidadePorTecido({
    colecao_id: "",
    subcolecoes: [
      {
        subcolecao_id: null,
        ordem: 0,
        linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [slot] }],
      },
    ],
  }).reduce((s, t) => s + t.totalMetros, 0);

  const temGrade = slot.materiais.some((m) => m.variantes.some((v) => v.grade_total > 0));
  const usarEstoque = slot.usar_estoque ?? false;
  const catNome = categorias.find((c) => c.id === slot.categoria_id)?.nome ?? null;
  // Resumo dos tecidos/forros do card, p/ aparecer na visão "Por linha" sem precisar expandir.
  const tecidosResumo = Array.from(
    new Set(slot.materiais.filter((m) => m.artigo_id && m.artigo_nome).map((m) => m.artigo_nome!)),
  ).join(" · ");
  const borderClass = open ? "border-primary" : usarEstoque ? "border-amber-500" : "";

  // Estado do botão "Aplicar ao modelo" (empurra o BOM completo). Bloqueia só se lançado.
  const gradeDisabled = !slot.id || !slot.modelo_id || !!lancado || aplicandoGrade;
  const gradeTitle = !slot.id
    ? "Salve o plano primeiro"
    : !slot.modelo_id
      ? "Este item não está ligado a um card de modelo"
      : lancado
        ? "Modelo já lançado — não é possível alterar"
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
              className="h-4 w-4"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        <button
          className="flex min-h-[68px] w-full items-center gap-2 p-2 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <ModeloThumb path={slot.thumb_path} />
          <div className={`min-w-0 flex-1 ${onToggleSelect ? "ml-4" : ""}`}>
            <div className="truncate text-sm font-medium">
              {slot.nome ?? "Modelo"}
              {slot.ref ? <span className="font-normal text-muted-foreground"> · {slot.ref}</span> : null}
            </div>
            {/* linha de categoria sempre reservada p/ padronizar a altura do card */}
            <div className="h-[15px] truncate text-[11px] text-muted-foreground">{catNome}</div>
            {/* tecido(s) do card — visível na visão "Por linha" sem expandir */}
            <div className="h-[15px] truncate text-[11px] text-muted-foreground" title={tecidosResumo || undefined}>
              {tecidosResumo || "— sem tecido"}
            </div>
            <div className="text-xs text-muted-foreground">
              {total ? `${total.toFixed(0)} m` : "—"} · {temGrade ? "✓ grade" : "⚠ falta"}
              {usarEstoque ? " · estoque" : ""}
            </div>
          </div>
        </button>
        {open && (
          <>
            <div className="border-t px-2 py-1 flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground shrink-0">Categoria</span>
              <select
                className="flex-1 rounded border bg-background px-2 py-1 text-xs"
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
            {colecaoId && (
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
                ) : (
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
                              {v.numero_pedido || v.oc_id.slice(0, 8)}{v.tecidos ? ` — ${v.tecidos}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <SlotOcHint colecaoId={colecaoId} slotId={slot.id} ocsAplicadas={ocsAplicadas ?? []} selected={slotOcIds ?? []} />
                    )}
                  </div>
                )}
                {/* Aprovação do custo de mão de obra (só p/ modelo real) — mesmo flag do Planejamento */}
                {slot.modelo_id && onSetMaoObra && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate">
                      Custo mão de obra:{" "}
                      <span className="font-medium text-foreground">
                        {maoObraAprovado === true ? "aprovado" : maoObraAprovado === false ? "reprovado" : "pendente"}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label="Aprovar custo de mão de obra"
                      onClick={() => onSetMaoObra(true)}
                      className={`ml-auto shrink-0 ${maoObraAprovado === true ? "text-emerald-600" : "text-muted-foreground/40 hover:text-emerald-600"}`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Reprovar custo de mão de obra"
                      onClick={() => onSetMaoObra(false)}
                      className={`shrink-0 ${maoObraAprovado === false ? "text-red-600" : "text-muted-foreground/40 hover:text-red-600"}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
            <Accordion type="multiple" defaultValue={["mat"]} className="border-t px-2">
              <AccordionItem value="mat">
                <AccordionTrigger className="py-2 text-xs">1. Tecidos &amp; Forros</AccordionTrigger>
                <AccordionContent>
                  {slot.materiais.map((m, i) => (
                    <MaterialBlock
                      key={m.id ?? i}
                      material={m}
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
              <AccordionItem value="grade">
                <AccordionTrigger className="py-2 text-xs">2. Grade</AccordionTrigger>
                <AccordionContent>
                  <GradeSection slot={slot} onChange={onChange} tamanhos={tamanhos} />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="custo">
                <AccordionTrigger className="py-2 text-xs">3. Custo &amp; Preço</AccordionTrigger>
                <AccordionContent>
                  <CustoSection slot={slot} onChange={onChange} />
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
