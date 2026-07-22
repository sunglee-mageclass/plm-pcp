import type { PtSlot } from "@/lib/plan-tecido/types";

export function GradeSection({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  return <div className="p-2 text-xs text-muted-foreground">Grade na Task 10 ({slot.materiais.length} materiais) {typeof onChange}</div>;
}
