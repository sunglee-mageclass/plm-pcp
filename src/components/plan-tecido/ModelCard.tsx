import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { PtSlot, PtMaterial } from "@/lib/plan-tecido/types";
import { ChevronRight, ImageIcon } from "lucide-react";
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
import { useSignedUrl } from "@/hooks/useSignedUrl";

function ModeloThumb({ path }: { path?: string | null }) {
  const url = useSignedUrl(path ?? null, "modelos");
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

function novoMaterial(existentes: PtMaterial[], tipo: "tecido" | "forro"): PtMaterial {
  const numero = existentes.filter((m) => m.tipo === tipo).length + 1;
  return { artigo_id: null, tipo, numero, consumo: 0, loss_percent: 0, ordem: existentes.length, variantes: [] };
}

export function ModelCard({
  slot,
  onChange,
  selected,
  onToggleSelect,
}: {
  slot: PtSlot;
  onChange: (s: PtSlot) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmGrade, setConfirmGrade] = useState(false);
  const [aplicandoGrade, setAplicandoGrade] = useState(false);

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
          className="flex w-full items-center gap-2 p-2 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
          <ModeloThumb path={slot.thumb_path} />
          <div className={`min-w-0 ${onToggleSelect ? "ml-4" : ""}`}>
            <div className="truncate text-sm font-medium">
              {slot.nome ?? "Modelo"}
              {slot.ref ? <span className="font-normal text-muted-foreground"> · {slot.ref}</span> : null}
            </div>
            {catNome && <div className="truncate text-[11px] text-muted-foreground">{catNome}</div>}
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
            <Accordion type="multiple" defaultValue={["mat"]} className="border-t px-2">
              <AccordionItem value="mat">
                <AccordionTrigger className="py-2 text-xs">1. Tecidos &amp; Forros</AccordionTrigger>
                <AccordionContent>
                  {slot.materiais.map((m, i) => (
                    <MaterialBlock
                      key={m.id ?? i}
                      material={m}
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
                  <GradeSection slot={slot} onChange={onChange} />
                  <div className="mt-2 border-t pt-2">
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
                  </div>
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
