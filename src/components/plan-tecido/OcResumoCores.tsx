import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { fmtMetros } from "@/lib/plan-tecido/calc";
import type { SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";

// Tabela Cor · Pedido · Reserva · Sobra de UMA OC (extraída do OcVinculadaDialog, set/2026) — reusada
// pelo dialog E pelo popover de hover (card travado / seção OCs do resumo). Semântica ÚNICA (decisão
// do dono jul/2026, espelha `contabilizarOc` em calc.ts): Reserva = max(comprometido, baixa) — NÃO a
// soma (se sobrepõem, dupla-contaria); Sobra = ENTREGUE − Reserva (físico que chegou, não a metragem
// pedida; NÃO clampa: negativo = déficit em vermelho). Agrega por variante ANTES de exibir (a RPC de
// situação não tem GROUP BY — 2 itens da mesma OC×variante viriam em 2 linhas com a mesma key).
export function linhasResumoOc(situacaoRows: SituacaoOcRow[], ocId: string) {
  const porVar = new Map<string, { variante_tecido_id: string; variante_label: string | null; pedida: number; entregue: number; usada: number; comprometida: number }>();
  for (const r of situacaoRows.filter((x) => x.oc_tecido_id === ocId)) {
    const g = porVar.get(r.variante_tecido_id) ?? { variante_tecido_id: r.variante_tecido_id, variante_label: r.variante_label, pedida: 0, entregue: 0, usada: 0, comprometida: 0 };
    g.pedida += r.pedida_m; g.entregue += r.entregue_m; g.usada += r.usada_m; g.comprometida += r.comprometida_m;
    porVar.set(r.variante_tecido_id, g);
  }
  return [...porVar.values()].map((g) => {
    const reserva = Math.max(g.comprometida, g.usada);
    return { ...g, reserva, sobra: g.entregue - reserva };
  });
}

/** Tabela Cor · Pedido · Reserva · Sobra + Total de uma OC. `compact` = fontes/altura menores (popover). */
export function OcResumoCores({ situacaoRows, ocId, compact }: { situacaoRows: SituacaoOcRow[]; ocId: string; compact?: boolean }) {
  const linhas = linhasResumoOc(situacaoRows, ocId);
  const tot = linhas.reduce((a, r) => { a.pedida += r.pedida; a.reserva += r.reserva; a.sobra += r.sobra; return a; }, { pedida: 0, reserva: 0, sobra: 0 });
  const cols = "grid grid-cols-[minmax(0,1fr)_5rem_5rem_5rem] items-center gap-2";
  const px = compact ? "px-2" : "px-3";
  const txt = compact ? "text-[11px]" : "text-xs";
  // Colunas numéricas de largura FIXA (5rem): cada linha é um grid INDEPENDENTE — com `auto`, cada uma
  // dimensionava as colunas pelo próprio conteúdo ("0" virava coluna de 10px) e desalinhava o cabeçalho.
  return (
    <div className={`rounded-lg border ${compact ? "min-w-[16rem]" : ""}`}>
      <div className={`${cols} border-b bg-muted ${px} py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
        <span>Cor</span><span className="text-right">Pedido</span><span className="text-right">Reserva</span><span className="text-right">Sobra</span>
      </div>
      <div className={compact ? "max-h-56 overflow-y-auto" : "max-h-64 overflow-y-auto"}>
        {linhas.length === 0 ? (
          <div className={`${px} py-3 text-center text-xs text-muted-foreground`}>Sem cores nesta OC.</div>
        ) : linhas.map((r) => (
          <div key={r.variante_tecido_id} className={`${cols} border-b ${px} py-1.5 ${txt} last:border-b-0`}>
            <span className="flex min-w-0 items-center gap-1.5">
              <VarianteSwatch nome={r.variante_label ?? undefined} />
              <span className="truncate">{r.variante_label ?? "Variante"}</span>
            </span>
            <span className="text-right tabular-nums">{fmtMetros(r.pedida)}</span>
            <span className="text-right tabular-nums text-amber-700">{fmtMetros(r.reserva)}</span>
            <span className={`text-right tabular-nums font-medium ${r.sobra < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmtMetros(r.sobra)}</span>
          </div>
        ))}
      </div>
      {linhas.length > 0 && (
        <div className={`${cols} border-t bg-muted ${px} py-1.5 ${txt} font-bold`}>
          <span className="uppercase text-muted-foreground">Total</span>
          <span className="text-right tabular-nums">{fmtMetros(tot.pedida)}</span>
          <span className="text-right tabular-nums text-amber-700">{fmtMetros(tot.reserva)}</span>
          <span className={`text-right tabular-nums ${tot.sobra < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmtMetros(tot.sobra)}</span>
        </div>
      )}
    </div>
  );
}
