import { useState } from "react";
import { format } from "date-fns";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type Periodo = { from?: Date; to?: Date } | undefined;

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * Seletor de período: calendário de intervalo (clica data de–até) + atalhos
 * de Mês e Ano que selecionam o mês inteiro. Tudo continua editável no calendário.
 */
export function PeriodoPicker({ value, onChange, anoBase }: {
  value: Periodo;
  onChange: (p: Periodo) => void;
  /** Ano usado como centro da lista de anos (default: 2026). */
  anoBase?: number;
}) {
  const base = anoBase ?? 2026;
  const anos = Array.from({ length: 7 }, (_, i) => base - 4 + i);
  const [mes, setMes] = useState<string>("");
  const [ano, setAno] = useState<string>(String(base));

  const aplicar = (m: string, a: string) => {
    if (!m || !a) return;
    const y = Number(a), mo = Number(m);
    onChange({ from: new Date(y, mo - 1, 1), to: new Date(y, mo, 0) });
  };

  const label = value?.from
    ? `${format(value.from, "dd/MM/yy")}${value.to ? " – " + format(value.to, "dd/MM/yy") : " – …"}`
    : "Período";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CalendarRange className="h-4 w-4" />
          <span>{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex flex-col gap-3 p-3 sm:flex-row">
          <div className="flex w-full flex-col gap-2 sm:w-44">
            <span className="text-xs font-medium text-muted-foreground">Mês inteiro</span>
            <Select value={mes} onValueChange={(v) => { setMes(v); aplicar(v, ano); }}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Mês" /></SelectTrigger>
              <SelectContent>
                {MESES.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={ano} onValueChange={(v) => { setAno(v); aplicar(mes, v); }}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Ano" /></SelectTrigger>
              <SelectContent>
                {anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1"
              onClick={() => { setMes(""); onChange(undefined); }}
            >
              Limpar período
            </Button>
          </div>
          <Calendar mode="range" numberOfMonths={1} selected={value as any} onSelect={onChange as any} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
