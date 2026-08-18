import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
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
        return <StatusBadge tone="neutral">No prazo</StatusBadge>;
      }
      if (diff > 0) {
        return <StatusBadge tone="danger">Atrasado {dia(diff)}</StatusBadge>;
      }
      return <StatusBadge tone="success">Adiantado {dia(-diff)}</StatusBadge>;
    }
    return <Badge variant="outline">—</Badge>;
  }

  // encomendado (ou status indefinido): contagem regressiva / atraso vs. hoje.
  if (dataPrevista) {
    const diff = differenceInCalendarDays(parseISO(dataPrevista), parseISO(todayISOInStoreTZ(tz)));
    if (diff > 0) {
      return <StatusBadge tone="neutral">Faltam {dia(diff)}</StatusBadge>;
    }
    if (diff === 0) {
      return <StatusBadge tone="warning">Vence hoje</StatusBadge>;
    }
    return <StatusBadge tone="danger">Atrasado {dia(-diff)}</StatusBadge>;
  }

  return <Badge variant="outline">—</Badge>;
}
