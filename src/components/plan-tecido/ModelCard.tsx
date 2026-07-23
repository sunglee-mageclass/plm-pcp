import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { PtSlot, PtMaterial } from "@/lib/plan-tecido/types";
import { ChevronRight } from "lucide-react";
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
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmGrade, setConfirmGrade] = useState(false);
  const [aplicandoGrade, setAplicandoGrade] = useState(false);
  const [criandoCard, setCriandoCard] = useState(false);

  // "Criar card" no Planejamento: só p/ slot ainda não ligado a um modelo, com nome ou tecido.
  const podeCriarCard = !slot.modelo_id && (!!slot.nome || slot.materiais.some((m) => m.artigo_id));

  async function criarCard() {
    if (!colecaoId) return;
    const _slot = {
      nome: slot.nome ?? null,
      ref: slot.ref ?? null,
      linha_id: slot.linha_id ?? null,
      categoria_id: slot.categoria_id ?? null,
      subcolecao_id: subcolecaoId ?? null,
      preco_venda: slot.preco_venda ?? null,
      custo_terceirizados_previsto: slot.custo_terceirizados_previsto ?? 0,
      custo_simulado: slot.custo_simulado ?? {},
      materiais: slot.materiais.map((m) => ({
        tipo: m.tipo,
        numero: m.numero,
        artigo_id: m.artigo_id,
        consumo: m.consumo,
        loss_percent: m.loss_percent,
        variantes: m.variantes.map((v) => ({
          variante_tecido_id: v.variante_tecido_id,
          ordem: v.ordem,
          multiplicador: v.multiplicador,
          // distribui a grade por tamanho (proporção) igual ao "Aplicar grade"
          grades: v.grades && Object.keys(v.grades).length ? v.grades : distribuirGrade(v.grade_total, slot.proporcoes),
          grade_total: v.grade_total,
        })),
      })),
    };
    setCriandoCard(true);
    try {
      const { data, error } = await supabase.rpc("plan_tecido_criar_card" as any, { _colecao_id: colecaoId, _slot });
      if (error) throw error;
      const novoId = data as string | null;
      toast.success("Card criado no Planejamento.");
      if (novoId) onChange({ ...slot, modelo_id: novoId }); // liga o slot (salve o plano p/ persistir)
      void qc.invalidateQueries({ queryKey: ["plan-tecido-modelos", colecaoId] });
      void qc.invalidateQueries({ queryKey: ["modelo"] });
      void qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      void qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
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
  const borderClass = open ? "border-primary" : usarEstoque ? "border-amber-500" : "";

  // Estado do botão "Aplicar grade ao modelo"
  const gradeDisabled = !slot.id || !slot.modelo_id || aplicandoGrade;
  const gradeTitle = !slot.id
    ? "Salve o plano primeiro"
    : !slot.modelo_id
      ? "Este item não está ligado a um card de modelo"
      : undefined;

  async function aplicarGrade() {
    if (!slot.id) return;
    const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
    const _variantes = (tec1?.variantes ?? []).map((v) => ({
      ordem: v.ordem,
      grade_total: v.grade_total,
      grades: distribuirGrade(v.grade_total, slot.proporcoes),
    }));
    setAplicandoGrade(true);
    try {
      const { data, error } = await supabase.rpc("aplicar_plan_tecido_grade" as any, {
        _slot_id: slot.id,
        _variantes,
      });
      if (error) throw error;
      const result = data as { modelo_id: string; changed: boolean } | null;
      if (result?.changed) {
        toast.success("Grade aplicada. #Erro aceso — verifique o modelo.");
      } else {
        toast.success("Grade já estava atualizada.");
      }
      // Invalidações best-effort
      void qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      void qc.invalidateQueries({ queryKey: ["cad-grades"] });
      void qc.invalidateQueries({ queryKey: ["dash-estoque"] });
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível aplicar a grade ao modelo."));
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
                    {aplicandoGrade ? "Aplicando…" : "Aplicar grade ao modelo"}
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
                {/* Hint de OC (planejamento) — em qualquer card salvo */}
                {colecaoId && (
                  <div className="mt-2">
                    <SlotOcHint colecaoId={colecaoId} slotId={slot.id} ocsAplicadas={ocsAplicadas ?? []} selected={slotOcIds ?? []} />
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
            <AlertDialogTitle>Aplicar grade ao modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso grava a grade por variante no card do modelo. NÃO altera o consumo (o CAD é dono
              do consumo). Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={aplicandoGrade}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={aplicandoGrade} onClick={aplicarGrade}>
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
