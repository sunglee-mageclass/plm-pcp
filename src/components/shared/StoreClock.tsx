import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { STORE_TIMEZONE } from "@/lib/timezone";
import { cn } from "@/lib/utils";

// Relógio do topo: data + hora no fuso padrão da loja (GMT-3 / São Paulo).
// Atualiza a cada segundo. O fuso virá da config da loja futuramente.
export function StoreClock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: STORE_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);

  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: STORE_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  return (
    <div
      className={cn("flex items-center gap-2 text-sm text-muted-foreground tabular-nums", className)}
      title="Horário de São Paulo (GMT-3)"
    >
      <Clock className="h-4 w-4" />
      <span className="hidden sm:inline">{data}</span>
      <span className="font-medium text-foreground">{hora}</span>
    </div>
  );
}
