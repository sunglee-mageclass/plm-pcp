import { useState } from "react";
import type { PtSlot } from "@/lib/plan-tecido/types";
import { ChevronRight, ImageIcon } from "lucide-react";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";

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
      {open && <div className="border-t p-2 text-xs text-muted-foreground">Abas na Task 8. onChange disponível: {typeof onChange}</div>}
    </div>
  );
}
