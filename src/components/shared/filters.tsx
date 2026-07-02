import { useEffect, useRef, useState, type ReactNode } from "react";
import { Filter, Group, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FilterOption = { id: string; nome: string };

export type FilterConfig = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  /** Valor considerado "vazio". Default: "all". */
  emptyValue?: string;
};

type FilterButtonProps = {
  filters?: FilterConfig[];
  children?: ReactNode;
  /** Quantidade de filtros ativos quando usando children. */
  activeCount?: number;
  onClear?: () => void;
};

export function FilterButton({ filters, children, activeCount, onClear }: FilterButtonProps) {
  const computedCount =
    activeCount ??
    (filters
      ? filters.filter((f) => {
          const empty = f.emptyValue ?? "all";
          return f.value && f.value !== empty;
        }).length
      : 0);

  const handleClear = () => {
    if (onClear) onClear();
    else if (filters) {
      filters.forEach((f) => f.onChange(f.emptyValue ?? "all"));
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          <span>Filtros</span>
          {computedCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
              {computedCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        {filters
          ? filters.map((f) => (
              <div key={f.label} className="grid gap-1">
                <Label className="text-xs">{f.label}</Label>
                <Select value={f.value} onValueChange={f.onChange}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))
          : children}
        {computedCount > 0 && (
          <div className="pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={handleClear}
            >
              Limpar filtros
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export type GroupToggle = {
  label: string;
  active: boolean;
  onToggle: () => void;
};

/**
 * Botão único (estilo Filtros) que abre um popover com checkboxes de agrupamento.
 * Os agrupamentos são combináveis e aninham na ordem em que `groups` é passado
 * (do mais amplo ao mais fino). Badge mostra quantos estão ativos.
 */
export function AgrupamentoButton({ groups }: { groups: GroupToggle[] }) {
  const count = groups.filter((g) => g.active).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={count > 0 ? "default" : "outline"} size="sm" className="gap-2">
          <Group className="h-4 w-4" />
          <span>Agrupar</span>
          {count > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
              {count}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 space-y-1">
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">
          Combináveis · aninham nesta ordem
        </p>
        {groups.map((g) => (
          <label
            key={g.label}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Checkbox checked={g.active} onCheckedChange={() => g.onToggle()} />
            <span>{g.label}</span>
          </label>
        ))}
        {count > 0 && (
          <div className="pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => groups.forEach((g) => g.active && g.onToggle())}
            >
              Limpar agrupamentos
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

type SearchToggleProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

export function SearchToggle({ value, onChange, placeholder = "Buscar..." }: SearchToggleProps) {
  const [expanded, setExpanded] = useState(Boolean(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  if (!expanded) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setExpanded(true)}
        aria-label="Buscar"
      >
        <Search className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="relative w-56">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!value) setExpanded(false);
        }}
        className="h-8 pl-8 pr-8 text-sm"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            setExpanded(false);
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="Limpar busca"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
