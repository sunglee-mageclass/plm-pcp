import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { cn } from "@/lib/utils";

// Relógio do topo: data + hora no fuso configurado na loja (default GMT-3 / SP).
// Atualiza a cada segundo.
export function StoreClock({ className }: { className?: string }) {
  const tz = useStoreTimezone();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);

  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  return (
    <div
      // Cores claras no MOBILE (header navy do layout — Navy Trust v2); StoreClock só é usado ali.
      className={cn("flex items-center gap-2 text-sm text-muted-foreground tabular-nums max-md:text-sidebar-foreground/80", className)}
      title={`Fuso da loja: ${tz}`}
    >
      <Clock className="h-4 w-4" />
      <span className="hidden sm:inline">{data}</span>
      <span className="font-medium text-foreground max-md:text-sidebar-foreground">{hora}</span>
    </div>
  );
}
