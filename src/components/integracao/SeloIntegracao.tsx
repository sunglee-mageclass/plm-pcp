// Integração — selo "Integrável/Integrado em dd/mm — travado" (mockup 10) nas outras telas.
import { Lock } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { cn } from "@/lib/utils";
import { textoSelo, type EstadoModeloIntegracao } from "@/lib/integracao/trava";

export function SeloIntegracao({ estado, className }: { estado: EstadoModeloIntegracao; className?: string }) {
  const tz = useStoreTimezone();
  return (
    <StatusBadge tone={estado.estado === "integrado" ? "success" : "warning"}
      className={cn("inline-flex w-fit items-center gap-1 normal-case tracking-normal", className)}>
      <Lock className="h-4 w-4" aria-hidden />{textoSelo(estado, tz)}
    </StatusBadge>
  );
}
