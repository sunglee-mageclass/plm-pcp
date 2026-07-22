import type { PtSlot } from "@/lib/plan-tecido/types";

export function CustoSection({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  return <div className="p-2 text-xs text-muted-foreground">Custo na Task 11 {typeof slot}{typeof onChange}</div>;
}
