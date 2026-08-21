import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Etapas PL (Fase 1, módulo opt-in `etapas_pl`; fix-round 1): rodapé da área de blocos PL do
// sheet de Serviços — lista os blocos PL reprovados na Peça Teste (pt_aprovacao='reprovado'),
// que SAÍRAM da lista principal de blocos. Cada item é colapsável (colapsado por default) e,
// ao abrir, mostra o MESMO card de edição COMPLETO do bloco (via `renderBloco`, a mesma função
// `renderBlocoCard` que a lista principal usa) — o usuário edita a Aprovação e/ou uma nova Data
// de Saída ali dentro; deixar de casar 'reprovado' devolve o bloco pra lista principal sozinho.

export type ReprovadaPl = {
  _key: string;
  idx: number; // índice em `blocos` (o array de estado do sheet) — repassado ao renderBloco
  empresa: string;
  pt_data_saida: string | null;
};

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function ReprovadasPl({
  blocos,
  renderBloco,
}: {
  blocos: ReprovadaPl[];
  renderBloco: (idx: number) => ReactNode;
}) {
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
            <ReprovadaPlItem key={b._key} item={b} renderBloco={renderBloco} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// Um item reprovado: header-resumo colapsado; abre p/ o card de edição completo do bloco.
function ReprovadaPlItem({ item, renderBloco }: { item: ReprovadaPl; renderBloco: (idx: number) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border bg-muted/30">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 p-3 text-left text-sm [&[data-state=open]>svg]:rotate-90">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">PL · {item.empresa}</p>
            <p className="text-xs text-muted-foreground">
              reprovada · saída {fmtData(item.pt_data_saida)}
            </p>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t p-3">
          <p className="mb-3 text-xs italic text-muted-foreground">nova saída reabre o fluxo</p>
          {renderBloco(item.idx)}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
