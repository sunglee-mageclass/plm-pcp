import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PtSlot, PtMaterial } from "@/lib/plan-tecido/types";
import { ChevronRight, ImageIcon } from "lucide-react";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MaterialBlock } from "./MaterialBlock";
import { GradeSection } from "./GradeSection";
import { CustoSection } from "./CustoSection";

function novoMaterial(existentes: PtMaterial[], tipo: "tecido" | "forro"): PtMaterial {
  const numero = existentes.filter((m) => m.tipo === tipo).length + 1;
  return { artigo_id: null, tipo, numero, consumo: 0, loss_percent: 0, ordem: existentes.length, variantes: [] };
}

export function ModelCard({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  const [open, setOpen] = useState(false);
  const { data: categorias = [] } = useQuery({
    queryKey: ["plan-tecido-categorias"],
    queryFn: async () => ((await supabase.from("categorias_produto").select("id, nome").order("nome")).data ?? []) as { id: string; nome: string }[],
  });
  const total = necessidadePorTecido({ colecao_id: "", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [slot] }] }] })
    .reduce((s, t) => s + t.totalMetros, 0);
  const temGrade = slot.materiais.some((m) => m.variantes.some((v) => v.grade_total > 0));
  const usarEstoque = slot.usar_estoque ?? false;
  const borderClass = open ? "border-primary" : usarEstoque ? "border-amber-500" : "";
  return (
    <div className={`rounded-lg border ${borderClass}`}>
      <button className="flex w-full items-center gap-2 p-2 text-left" onClick={() => setOpen((o) => !o)}>
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        <div className="flex h-7 w-7 items-center justify-center rounded bg-muted"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{slot.ref ?? slot.nome ?? "Modelo"}</div>
          <div className="text-xs text-muted-foreground">{total ? `${total.toFixed(0)} m` : "—"} · {temGrade ? "✓ grade" : "⚠ falta"}{usarEstoque ? " · estoque" : ""}</div>
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
            {categorias.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}
          </select>
        </div>
        <div className="border-t px-2 py-1 flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs select-none" onClick={(e) => e.stopPropagation()}>
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
                <MaterialBlock key={m.id ?? i} material={m} onChange={(nm) => {
                  const materiais = slot.materiais.slice(); materiais[i] = nm; onChange({ ...slot, materiais });
                }} onRemove={() => onChange({ ...slot, materiais: slot.materiais.filter((_, j) => j !== i) })} />
              ))}
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onChange({ ...slot, materiais: [...slot.materiais, novoMaterial(slot.materiais, "tecido")] })}>+ tecido</Button>
                <Button variant="outline" size="sm" onClick={() => onChange({ ...slot, materiais: [...slot.materiais, novoMaterial(slot.materiais, "forro")] })}>+ forro</Button>
              </div>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="grade">
            <AccordionTrigger className="py-2 text-xs">2. Grade</AccordionTrigger>
            <AccordionContent><GradeSection slot={slot} onChange={onChange} /></AccordionContent>
          </AccordionItem>
          <AccordionItem value="custo">
            <AccordionTrigger className="py-2 text-xs">3. Custo &amp; Preço</AccordionTrigger>
            <AccordionContent><CustoSection slot={slot} onChange={onChange} /></AccordionContent>
          </AccordionItem>
        </Accordion>
        </>
      )}
    </div>
  );
}
