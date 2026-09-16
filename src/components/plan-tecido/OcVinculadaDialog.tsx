import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { ModeloThumb } from "./ModeloThumb";
import { fmtMetros } from "@/lib/plan-tecido/calc";
import type { SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";
import type { PtSlot } from "@/lib/plan-tecido/types";

// Dialog de uma OC vinculada (Modo Plano, set/2026). Mostra, daquela OC:
//  • Cores: Pedido · Reserva · Sobra por variante (de `situacaoRows` filtrado pela OC).
//    Reserva = usada (baixa real) + comprometida (uso planejado/enviado); Sobra = pedida − reserva.
//  • Modelos que usam a OC: foto (ModeloThumb) + nome + REF (os slots do grupo vinculados à OC).
export function OcVinculadaDialog({
  open, onOpenChange, ocId, numero, fornecedor, status, situacaoRows, modelosDaOc,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ocId: string;
  numero: string | null;
  fornecedor: string | null;
  status: string | null;
  situacaoRows: SituacaoOcRow[];
  modelosDaOc: PtSlot[];
}) {
  const recebido = status === "recebido";
  // Semântica ÚNICA (decisão do dono jul/2026, espelha `contabilizarOc` em calc.ts:124-133):
  //  • Reserva = max(comprometido, baixa) — NÃO a soma (o comprometido e a baixa da MESMA demanda se
  //    sobrepõem; somar dupla-conta).
  //  • Sobra = ENTREGUE − Reserva (o físico que REALMENTE chegou, não a metragem pedida). NÃO clampa:
  //    negativo = déficit real (vermelho), igual ao Resumo. Encomendada (entregue 0) → sobra negativa.
  // Agrega por variante ANTES de exibir (a RPC de situação não tem GROUP BY — 2 itens da mesma OC×
  // variante viriam como 2 linhas com a mesma key; somar aqui corrige display e a key).
  const porVar = new Map<string, { variante_tecido_id: string; variante_label: string | null; pedida: number; entregue: number; usada: number; comprometida: number }>();
  for (const r of situacaoRows.filter((x) => x.oc_tecido_id === ocId)) {
    const g = porVar.get(r.variante_tecido_id) ?? { variante_tecido_id: r.variante_tecido_id, variante_label: r.variante_label, pedida: 0, entregue: 0, usada: 0, comprometida: 0 };
    g.pedida += r.pedida_m; g.entregue += r.entregue_m; g.usada += r.usada_m; g.comprometida += r.comprometida_m;
    porVar.set(r.variante_tecido_id, g);
  }
  const linhas = [...porVar.values()].map((g) => {
    const reserva = Math.max(g.comprometida, g.usada);
    return { ...g, reserva, sobra: g.entregue - reserva };
  });
  const tot = linhas.reduce((a, r) => { a.pedida += r.pedida; a.reserva += r.reserva; a.sobra += r.sobra; return a; }, { pedida: 0, reserva: 0, sobra: 0 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>OC {numero ?? "s/ nº"}</span>
            {fornecedor && <span className="text-sm font-normal text-muted-foreground">{fornecedor}</span>}
            <StatusBadge tone={recebido ? "success" : "warning"} className="normal-case tracking-normal">
              {recebido ? "Recebido" : "Encomendado"}
            </StatusBadge>
          </DialogTitle>
        </DialogHeader>

        {/* Cores: Pedido · Reserva · Sobra */}
        <div className="rounded-lg border">
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b bg-muted px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Cor</span><span className="text-right">Pedido</span><span className="text-right">Reserva</span><span className="text-right">Sobra</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {linhas.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">Sem cores nesta OC.</div>
            ) : linhas.map((r) => (
                <div key={r.variante_tecido_id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0">
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
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-t bg-muted px-3 py-1.5 text-xs font-bold">
              <span className="uppercase text-muted-foreground">Total</span>
              <span className="text-right tabular-nums">{fmtMetros(tot.pedida)}</span>
              <span className="text-right tabular-nums text-amber-700">{fmtMetros(tot.reserva)}</span>
              <span className={`text-right tabular-nums ${tot.sobra < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmtMetros(tot.sobra)}</span>
            </div>
          )}
        </div>

        {/* Modelos que usam a OC */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Modelos que usam esta OC</p>
          {modelosDaOc.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum modelo vinculado.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
              {modelosDaOc.map((s) => (
                <div key={s.id ?? s.modelo_id ?? s.ref} className="overflow-hidden rounded-lg border">
                  <ModeloThumb path={s.thumb_path ?? s.referencia_paths?.[0] ?? null} className="aspect-[4/5] w-full" zoom alt={s.nome ?? "Modelo"} />
                  <div className="px-2 py-1">
                    <div className="truncate text-xs font-medium">{s.nome ?? "Modelo"}</div>
                    {s.ref && <div className="truncate text-[10px] tabular-nums text-muted-foreground">{s.ref}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
