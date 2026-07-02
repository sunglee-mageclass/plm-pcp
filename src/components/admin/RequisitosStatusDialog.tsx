import { useState } from "react";
import { ListChecks } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { MODULOS, CONDICOES } from "@/lib/kanban-condicoes";

/**
 * Botão "Requisitos" por status do kanban → dialog com as condições agrupadas por
 * módulo (checkboxes). O que estiver marcado é REQUISITO DE ENTRADA (todos em E) para
 * um card poder entrar naquele status. Edita `tenant_config.kanban_requisitos[key]`.
 */
export function RequisitosStatusButton({
  label,
  requisitos,
  onChange,
}: {
  label: string;
  requisitos: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = new Set(requisitos);
  const toggle = (key: string, v: boolean) => {
    const n = new Set(requisitos);
    if (v) n.add(key); else n.delete(key);
    onChange(Array.from(n));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0">
          <ListChecks className="h-4 w-4 sm:mr-1" />
          <span className="max-sm:sr-only">Requisitos{requisitos.length ? ` (${requisitos.length})` : ""}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Requisitos para entrar em “{label}”</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Um card só entra neste status quando <strong>todas</strong> as condições marcadas
          estiverem satisfeitas.
        </p>
        <Accordion type="multiple" className="space-y-1">
          {MODULOS.map((m) => {
            const conds = CONDICOES.filter((c) => c.modulo === m.key);
            if (conds.length === 0) return null;
            const nSel = conds.filter((c) => set.has(c.key)).length;
            return (
              <AccordionItem key={m.key} value={m.key} className="rounded-md border px-3">
                <AccordionTrigger className="py-2 text-sm hover:no-underline">
                  <span className="flex-1 text-left font-medium">{m.label}</span>
                  {nSel > 0 && <span className="mr-2 text-xs font-semibold text-primary">{nSel}</span>}
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-3">
                  {conds.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-start gap-2">
                      <Checkbox
                        checked={set.has(c.key)}
                        onCheckedChange={(v) => toggle(c.key, !!v)}
                        className="mt-0.5"
                      />
                      <span className="text-sm leading-tight">
                        {c.label}
                        {c.descricao && <span className="block text-xs text-muted-foreground">{c.descricao}</span>}
                      </span>
                    </label>
                  ))}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
        <div className="flex justify-end">
          <Button type="button" onClick={() => setOpen(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
