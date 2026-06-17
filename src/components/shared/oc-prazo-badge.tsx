import { Badge } from "@/components/ui/badge";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { todayISOInStoreTZ } from "@/lib/timezone";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";

const dia = (n: number) => `${n} dia${n > 1 ? "s" : ""}`;

// Alerta de prazo da OC. O comportamento depende do status:
// - encomendado: ainda não recebida → compara HOJE (fuso da loja) com a data
//   prevista. Mostra contagem regressiva ("Faltam X dias") ou atraso.
// - recebido: compara a data de entrega real com a prevista → adiantado / no
//   prazo / atrasado.
export function OcPrazoBadge({
  dataPrevista,
  dataEntrega,
  status,
}: {
  dataPrevista: string | null | undefined;
  dataEntrega: string | null | undefined;
  status?: string | null;
}) {
  const tz = useStoreTimezone();

  if (status === "recebido") {
    if (dataEntrega && dataPrevista) {
      const diff = differenceInCalendarDays(parseISO(dataEntrega), parseISO(dataPrevista));
      if (diff === 0) {
        return <Badge variant="outline" className="bg-slate-500 text-white border-transparent">No prazo</Badge>;
      }
      if (diff > 0) {
        return <Badge variant="outline" className="bg-destructive text-destructive-foreground border-transparent">Atrasado {dia(diff)}</Badge>;
      }
      return <Badge variant="outline" className="bg-green-600 text-white border-transparent">Adiantado {dia(-diff)}</Badge>;
    }
    return <Badge variant="outline">—</Badge>;
  }

  // encomendado (ou status indefinido): contagem regressiva / atraso vs. hoje.
  if (dataPrevista) {
    const diff = differenceInCalendarDays(parseISO(dataPrevista), parseISO(todayISOInStoreTZ(tz)));
    if (diff > 0) {
      return <Badge variant="outline" className="bg-slate-500 text-white border-transparent">Faltam {dia(diff)}</Badge>;
    }
    if (diff === 0) {
      return <Badge variant="outline" className="bg-yellow-500 text-white border-transparent">Vence hoje</Badge>;
    }
    return <Badge variant="outline" className="bg-destructive text-destructive-foreground border-transparent">Atrasado {dia(-diff)}</Badge>;
  }

  return <Badge variant="outline">—</Badge>;
}
