import type { PtMaterial } from "@/lib/plan-tecido/types";

export function MaterialBlock({ material, onChange, onRemove }: { material: PtMaterial; onChange: (m: PtMaterial) => void; onRemove: () => void }) {
  return <div className="mb-2 rounded border p-2 text-xs">{material.tipo} {material.numero} — conteúdo na Task 9 {typeof onChange}{typeof onRemove}</div>;
}
