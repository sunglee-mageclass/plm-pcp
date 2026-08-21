import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Etapas PL (Fase 1, módulo opt-in `etapas_pl`): rodapé da área de blocos PL do sheet de
// Serviços — lista os blocos PL reprovados na Peça Teste (pt_aprovacao='reprovado'), fora do
// fluxo normal de etapas (que só avança quando aprovado). Colapsável, fechado por default;
// puramente apresentacional — quem resolve "reprovado" e ordena por saída é o chamador.

export type ReprovadaPl = {
  _key: string;
  empresa: string;
  pt_data_saida: string | null;
};

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function ReprovadasPl({ blocos }: { blocos: ReprovadaPl[] }) {
  const [open, setOpen] = useState(false);
  if (blocos.length === 0) return null;

  const ordenados = [...blocos].sort((a, b) => (a.pt_data_saida ?? "").localeCompare(b.pt_data_saida ?? ""));

  return (
    <Card className="p-4">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-left font-semibold [&[data-state=open]>svg]:rotate-90">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
          <span>PLs reprovadas na peça teste</span>
          <Badge variant="secondary" className="ml-1">{ordenados.length}</Badge>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-2">
          {ordenados.map((b) => (
            <div key={b._key} className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">PL · {b.empresa}</p>
              <p className="text-xs text-muted-foreground">
                reprovada · saída {fmtData(b.pt_data_saida)}
              </p>
              <p className="mt-1 text-xs italic text-muted-foreground">nova saída reabre o fluxo</p>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
