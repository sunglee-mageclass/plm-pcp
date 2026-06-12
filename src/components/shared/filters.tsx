import { useEffect, useRef, useState, type ReactNode } from "react";
import { Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
