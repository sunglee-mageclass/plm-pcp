import { Badge } from "@/components/ui/badge";
import { differenceInCalendarDays, parseISO } from "date-fns";

export function OcPrazoBadge({
  dataPrevista,
  dataEntrega,
}: {
  dataPrevista: string | null | undefined;
  dataEntrega: string | null | undefined;
}) {
  if (dataEntrega && dataPrevista) {
    const diff = differenceInCalendarDays(parseISO(dataEntrega), parseISO(dataPrevista));
    if (diff === 0) {
      return (
        <Badge variant="outline" className="bg-slate-500 text-white border-transparent">
          No prazo
        </Badge>
      );
    }
    if (diff > 0) {
      return (
        <Badge variant="outline" className="bg-destructive text-destructive-foreground border-transparent">
          Atrasado {diff} dia{diff > 1 ? "s" : ""}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-green-600 text-white border-transparent">
        Adiantado {-diff} dia{-diff > 1 ? "s" : ""}
      </Badge>
    );
  }

  if (!dataEntrega && dataPrevista) {
    const diff = differenceInCalendarDays(new Date(), parseISO(dataPrevista));
    if (diff > 0) {
      return (
        <Badge variant="outline" className="bg-yellow-500 text-white border-transparent">
          Entrega prevista vencida há {diff} dia{diff > 1 ? "s" : ""}
        </Badge>
      );
    }
  }

  return <Badge variant="outline">—</Badge>;
}
