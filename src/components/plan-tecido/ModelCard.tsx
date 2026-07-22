import { useState } from "react";
import type { PtSlot, PtMaterial } from "@/lib/plan-tecido/types";
import { ChevronRight, ImageIcon } from "lucide-react";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { MaterialBlock } from "./MaterialBlock";
import { GradeSection } from "./GradeSection";
import { CustoSection } from "./CustoSection";

function novoMaterial(existentes: PtMaterial[], tipo: "tecido" | "forro"): PtMaterial {
  const numero = existentes.filter((m) => m.tipo === tipo).length + 1;
  return { artigo_id: null, tipo, numero, consumo: 0, loss_percent: 0, ordem: existentes.length, variantes: [] };
}

export function ModelCard({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  const [open, setOpen] = useState(false);
  const total = necessidadePorTecido({ colecao_id: "", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [slot] }] }] })
    .reduce((s, t) => s + t.totalMetros, 0);
  const temGrade = slot.materiais.some((m) => m.variantes.some((v) => v.grade_total > 0));
  return (
    <div className={`rounded-lg border ${open ? "border-primary" : ""}`}>
      <button className="flex w-full items-center gap-2 p-2 text-left" onClick={() => setOpen((o) => !o)}>
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        <div className="flex h-7 w-7 items-center justify-center rounded bg-muted"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{slot.ref ?? slot.nome ?? "Modelo"}</div>
          <div className="text-xs text-muted-foreground">{total ? `${total.toFixed(0)} m` : "—"} · {temGrade ? "✓ grade" : "⚠ falta"}</div>
        </div>
      </button>
      {open && (
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
      )}
    </div>
  );
}
