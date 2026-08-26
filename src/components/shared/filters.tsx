import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronsUpDown, Filter, Group, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFilterUsage } from "@/hooks/useFilterUsage";

/** A partir de quantos filtros vale a pena o layout multi-coluna + "Mais usados". */
const ADAPTIVE_MIN = 5;
/** Quantos filtros a coluna "Mais usados" mostra no máximo. */
const MOST_USED_MAX = 4;

/**
 * Classe do estado "filtro ativo" (valor ≠ vazio) — borda primary + peso.
 * Use no SelectTrigger/Input de filtros CUSTOM (children do FilterButton, ex.:
 * financeiro/auditoria, que misturam data/texto) p/ igualar o realce que o
 * layout de array já dá. Não pega em DateField (className vai no wrapper, não no
 * input) — nesses a contagem no badge do botão sinaliza.
 */
export const filtroAtivoClass = (active: boolean) =>
  active ? "border-primary font-medium text-foreground" : "";

export type FilterOption = { id: string; nome: string };

/** Filtro de valor único (dropdown Select). Opt-in via `single: true` — o default é multi. */
export type FilterConfigSingle = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  /** Valor considerado "vazio". Default: "all". */
  emptyValue?: string;
  single: true;
};

/**
 * Filtro multi-seleção (popover de checkboxes) — é o DEFAULT (sem flag). `value` é o array
 * de ids marcados; array vazio = nenhum filtro (mostra tudo). Não usa `emptyValue`/`options`
 * com "Todos" — o "todos" é o estado de nada marcado.
 */
export type FilterConfigMulti = {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  options: FilterOption[];
  single?: false;
};

export type FilterConfig = FilterConfigSingle | FilterConfigMulti;

type FilterButtonProps = {
  filters?: FilterConfig[];
  children?: ReactNode;
  /** Quantidade de filtros ativos quando usando children. */
  activeCount?: number;
  onClear?: () => void;
  /**
   * Chave da tela. Quando definida (e houver ≥ ADAPTIVE_MIN filtros), liga o
   * layout de 3 colunas no desktop (1ª = "Mais usados", adaptativa por uso do
   * usuário; 2ª/3ª = todos os filtros na ordem fixa em que `filters` é passado)
   * e rastreia o uso por-usuário. No mobile continua 1 coluna.
   */
  screen?: string;
};

/**
 * Filtro multi-seleção como DROPDOWN: um trigger (mesmo gabarito do SelectTrigger dos
 * filtros single) que abre um popover próprio com a lista de checkboxes. Resumo no
 * trigger: "Todos" (nada marcado) · o rótulo (1) · "N selecionados" (≥2). Espelha o
 * idioma do multi-select do cadastro (Popover + Checkbox + array).
 */
function MultiFilter({ f, onRecord }: { f: FilterConfigMulti; onRecord: (label: string) => void }) {
  const [open, setOpen] = useState(false);
  const active = f.value.length > 0;
  const selectedLabels = f.options.filter((o) => f.value.includes(o.id)).map((o) => o.nome);
  const resumo =
    selectedLabels.length === 0 ? "Todos" : selectedLabels.length === 1 ? selectedLabels[0] : `${selectedLabels.length} selecionados`;
  const toggle = (id: string) => {
    const has = f.value.includes(id);
    if (!has) onRecord(f.label); // só conta aplicação real, não desmarque
    f.onChange(has ? f.value.filter((v) => v !== id) : [...f.value, id]);
  };
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{f.label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            // h-8 desktop / h-11 toque — mesmo gabarito do SelectTrigger dos filtros single.
            className={`h-8 max-md:h-11 w-full justify-between px-3 text-sm font-normal ${filtroAtivoClass(active)}`}
          >
            <span className="truncate text-left">{resumo}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {f.options.map((o) => (
              <label
                key={o.id}
                // max-md:min-h-11 = linha clicável de 44px no toque (§Q/§G).
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted max-md:min-h-11"
              >
                <Checkbox checked={f.value.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
                <span>{o.nome}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function FilterButton({ filters, children, activeCount, onClear, screen }: FilterButtonProps) {
  const { counts, record } = useFilterUsage(screen);

  // "Ativo" = multi (default) com ao menos 1 marcado, ou single com valor ≠ vazio.
  // (Cuidado: `Boolean([])` é `true` — por isso o multi checa `.length`, não a truthiness.)
  const isActive = (f: FilterConfig) =>
    f.single ? Boolean(f.value) && f.value !== (f.emptyValue ?? "all") : f.value.length > 0;

  const computedCount =
    activeCount ?? (filters ? filters.filter(isActive).length : 0);

  const handleClear = () => {
    if (onClear) onClear();
    else if (filters) {
      filters.forEach((f) => (f.single ? f.onChange(f.emptyValue ?? "all") : f.onChange([])));
    }
  };

  // Um <Select> (single) ou uma lista de checkboxes (multi, default) por filtro; renderizável
  // tanto na coluna "Mais usados" quanto na lista fixa (mesmo estado — mudar num lugar
  // reflete no outro).
  const renderFilter = (f: FilterConfig) => {
    if (!f.single) return <MultiFilter key={f.label} f={f} onRecord={record} />;
    const empty = f.emptyValue ?? "all";
    const active = Boolean(f.value) && f.value !== empty;
    return (
      <div key={f.label} className="grid gap-1">
        <Label className="text-xs">{f.label}</Label>
        <Select
          value={f.value}
          onValueChange={(v) => {
            if (v !== empty) record(f.label); // só conta aplicação real, não limpeza
            f.onChange(v);
          }}
        >
          {/* Ativo (valor ≠ vazio) ganha borda/peso — reconhecer o que filtra sem varrer todos. */}
          {/* h-8 compacto no desktop; max-md:h-11 = toque 44px no mobile (§Q/§G — o mesmo
              popover serve desktop E mobile; explícito p/ não depender do merge do primitivo). */}
          <SelectTrigger className={`h-8 max-md:h-11 text-sm ${filtroAtivoClass(active)}`}>
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
    );
  };

  const adaptive = Boolean(screen) && !!filters && filters.length >= ADAPTIVE_MIN;
  const mostUsed = adaptive
    ? [...filters!]
        .filter((f) => (counts[f.label] ?? 0) > 0)
        .sort((a, b) => (counts[b.label] ?? 0) - (counts[a.label] ?? 0))
        .slice(0, MOST_USED_MAX)
    : [];

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
      <PopoverContent
        align="end"
        className={`max-h-[75vh] space-y-3 overflow-y-auto ${adaptive ? "w-[22rem] sm:w-[46rem]" : "w-72"}`}
      >
        {filters ? (
          <>
          {adaptive ? (
            <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-3">
              {/* Coluna 1 — Mais usados (adaptativa por usuário) */}
              <div className="space-y-3 sm:border-r sm:pr-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Mais usados
                </p>
                {mostUsed.length ? (
                  mostUsed.map(renderFilter)
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground/70">
                    Os filtros que você mais usa aparecem aqui.
                  </p>
                )}
              </div>
              {/* Colunas 2–3 — todos os filtros na ordem fixa da tela */}
              <div className="sm:col-span-2">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Todos os filtros
                </p>
                <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
                  {filters.map(renderFilter)}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">{filters.map(renderFilter)}</div>
          )}
          {/* Filtros custom (ex.: intervalo de datas) renderizados abaixo dos dropdowns. */}
          {children}
          </>
        ) : (
          children
        )}
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
            // max-md:min-h-11 = linha clicável de 44px no toque (§Q/§G); py-1.5 compacto no desktop.
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted max-md:min-h-11"
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
  const isMobile = useIsMobile();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  // MOBILE: a lupa abre um Dialog para digitar (o input inline ficava espremido no header).
  // Um ponto no ícone sinaliza busca ativa. Desktop segue com o input inline expansível.
  if (isMobile) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => setDialogOpen(true)}
          aria-label="Buscar"
        >
          <Search className="h-4 w-4" />
          {value && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" aria-hidden />}
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Buscar</DialogTitle></DialogHeader>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setDialogOpen(false); }}
                className="h-11 pl-8 pr-8 text-base"
              />
              {value && (
                <button
                  type="button"
                  onClick={() => onChange("")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-muted"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

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
