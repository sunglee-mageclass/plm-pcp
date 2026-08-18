// Camada mobile do Dashboard (breakpoint md). O desktop fica INTACTO — estes primitivos
// só são montados quando `useIsMobile()` é verdadeiro (ou sob classes md:hidden). Seguem a
// régua §Q/§R: cor por token (nunca hex/hsl solto), alvos de toque ≥ 44px, status com ícone.
//
//  • SegmentedTabs — as 7 abas viram pílulas roláveis (ativa em navy), fade na borda.
//  • MobileFilterBar — chip "Filtros (N)" que abre bottom sheet (rodapé fixo Limpar/Aplicar).
//  • KpiCardMobile — stat tile tocável (número + variação + sparkline); toque abre o gráfico.
//  • ChartSheet — sheet de tela cheia com o gráfico completo do desktop (X pra fechar).
//  • Sparkline — micro-tendência SVG leve (só onde há série temporal; senão nem renderiza).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MobileFilterSheet } from "@/components/shared/MobileFilterSheet";
import { PeriodoPicker, type Periodo } from "@/components/shared/PeriodoPicker";
import type { FilterConfig } from "@/components/shared/filters";

/* ------------------------------------------------------------------ Sparkline */

export type SparkTone = "success" | "danger" | "primary" | "neutral";

const SPARK_STROKE: Record<SparkTone, string> = {
  success: "var(--success)",
  danger: "var(--destructive)",
  primary: "var(--primary)",
  neutral: "var(--muted-foreground)",
};

/** Micro-tendência (Tufte/R8): polilinha SVG sem eixo/legenda. Série < 2 pontos finitos = null
 *  (honesto — só aparece onde há dado temporal). Coordenadas por aritmética (sem .toFixed). */
export function Sparkline({
  points, tone = "neutral", width = 66, height = 24,
}: { points: number[]; tone?: SparkTone; width?: number; height?: number }) {
  const vals = points.filter((p) => Number.isFinite(p));
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pad = 3;
  const stepX = (width - pad * 2) / (vals.length - 1);
  const coords = vals.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / span);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const stroke = SPARK_STROKE[tone];
  const last = coords[coords.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden className="block">
      <polyline
        points={coords.map((c) => c.join(",")).join(" ")}
        fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.4} fill={stroke} />
    </svg>
  );
}

/* --------------------------------------------------------------- KpiCardMobile */

export type KpiDelta = { dir: "up" | "down" | "flat"; text: string; color?: string };

const DELTA_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus } as const;
const DELTA_COLOR: Record<KpiDelta["dir"], string> = {
  up: "var(--destructive)",
  down: "var(--success)",
  flat: "var(--muted-foreground)",
};

/** Stat tile tocável do mobile: número-título + variação + sparkline (R8). Com `onOpen` o
 *  card inteiro vira botão (alvo ≥ 44px) que abre o gráfico completo num ChartSheet. */
export function KpiCardMobile({
  label, value, valueTitle, sub, delta, spark, sparkTone = "neutral",
  onOpen, tapLabel = "toque para abrir", compact,
}: {
  label: string;
  value: ReactNode;
  valueTitle?: string;
  sub?: ReactNode;
  delta?: KpiDelta;
  spark?: number[];
  sparkTone?: SparkTone;
  onOpen?: () => void;
  tapLabel?: string;
  compact?: boolean;
}) {
  const DeltaIcon = delta ? DELTA_ICON[delta.dir] : null;
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
        <div className={cn("mt-0.5 font-bold leading-tight tabular-nums", compact ? "text-xl" : "text-2xl")} title={valueTitle}>
          {value}
        </div>
        {delta && DeltaIcon && (
          <div className="mt-0.5 text-[11px] font-semibold" style={{ color: delta.color ?? DELTA_COLOR[delta.dir] }}>
            <DeltaIcon className="mr-0.5 inline h-3 w-3 align-[-1px]" aria-hidden />
            {delta.text}
          </div>
        )}
        {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      {(spark || onOpen) && (
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {spark && <Sparkline points={spark} tone={sparkTone} width={compact ? 40 : 66} height={compact ? 18 : 24} />}
          {onOpen && (
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-[10px] text-muted-foreground">
              {tapLabel} <ChevronRight className="h-3 w-3" aria-hidden />
            </span>
          )}
        </div>
      )}
    </>
  );
  const base = "flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left min-h-[66px]";
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(base, "transition-colors hover:bg-muted/40 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

/* -------------------------------------------------------------------- ChartSheet */

/** Sheet de tela cheia (rola no corpo) que embrulha o MESMO gráfico do desktop. Fechar = X
 *  (canto sup. dir., já provido pelo SheetContent) ou toque no scrim. */
export function ChartSheet({
  open, onOpenChange, title, subtitle, children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[92vh] flex-col gap-0 rounded-t-2xl p-0">
        <SheetHeader className="shrink-0 space-y-0.5 border-b p-4 pr-12 text-left">
          <SheetTitle className="text-base">{title}</SheetTitle>
          {subtitle ? <SheetDescription className="text-xs">{subtitle}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ SegmentedTabs */

/** As 7 abas como pílulas roláveis (ativa em navy). Rola só na horizontal, com fade na borda
 *  direita; a ativa entra em vista ao trocar. Substitui o dropdown de abas no mobile. */
export function SegmentedTabs({
  tabs, value, onChange,
}: { tabs: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // fades por LADO, só quando há conteúdo escondido naquele lado — senão o gradiente
  // "borra" a pílula ativa quando ela é a última (report do dono, ago/2026).
  const [fade, setFade] = useState({ left: false, right: false });
  const medirFade = () => {
    const el = ref.current;
    if (!el) return;
    setFade({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  };
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>(`[data-seg="${value}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    medirFade();
  }, [value]);
  useEffect(() => {
    medirFade();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(medirFade);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={medirFade}
        className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const on = t.value === value;
          return (
            <button
              key={t.value}
              data-seg={t.value}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => onChange(t.value)}
              className={cn(
                "min-h-[44px] shrink-0 whitespace-nowrap rounded-full border px-4 text-[13px] font-semibold transition-colors",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {fade.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
      )}
      {fade.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- MobileFilterBar */

/** Chip "Filtros (N)" + bottom sheet com os filtros REAIS da aba (coleção/subcoleção/período/…),
 *  rodapé fixo Limpar · Aplicar (padrão mobile do projeto). Os filtros aplicam ao vivo (onChange);
 *  "Aplicar" só fecha; "Limpar" zera tudo. N = filtros ativos + período. Alvos ≥ 44px. */
export function MobileFilterBar({
  className, filters, periodo, onPeriodo,
}: {
  className?: string;
  filters?: FilterConfig[];
  periodo?: Periodo;
  onPeriodo?: (p: Periodo) => void;
}) {
  const fs = filters ?? [];
  const activeCount = fs.filter((f) => f.value && f.value !== (f.emptyValue ?? "all")).length;
  const count = activeCount + (periodo?.from ? 1 : 0);
  const clearAll = () => {
    fs.forEach((f) => f.onChange(f.emptyValue ?? "all"));
    onPeriodo?.(undefined);
  };
  // UMA casca só: o `MobileFilterSheet` (shared) provê chip + bottom sheet + rodapé fixo
  // Limpar·Aplicar. Aqui só montamos o CORPO (período + selects) como children — o chrome
  // era duplicado quase verbatim entre os dois (dashboard × financeiro) e agora é fonte única.
  return (
    <MobileFilterSheet className={className} activeCount={count} onClear={clearAll}>
      {onPeriodo && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Período</label>
          <div><PeriodoPicker value={periodo} onChange={onPeriodo} /></div>
        </div>
      )}
      {fs.map((f) => {
        const empty = f.emptyValue ?? "all";
        const active = Boolean(f.value) && f.value !== empty;
        return (
          <div key={f.label} className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
            <Select value={f.value} onValueChange={f.onChange}>
              <SelectTrigger className={cn("h-11 text-sm", active && "border-primary font-medium text-foreground")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {f.options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </MobileFilterSheet>
  );
}
