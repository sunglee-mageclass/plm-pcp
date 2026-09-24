// F3.2 — "alterações não salvas" do BOM. SUBSTITUI a heurística de estabilidade do Dev
// (ModeloDetailPanel.tsx:1679-1751: `seedSettled` + confirmação em 2 renders) por uma regra mais simples,
// possível aqui porque TODO handler do BOM marca "tocado" (colecoesTouchadasRef):
//   • enquanto NÃO tocado, o baseline ACOMPANHA o estado (absorve a semeadura, a herança de grade e as
//     recargas do servidor sem acusar "não salvo" — o motivo de toda a heurística do Dev);
//   • tocado ⇒ "não salvo" = snapshot atual ≠ baseline (tocar e desfazer volta a limpo).
// O snapshot ignora `id` e `custo_previsto` (ver `snapshotBom`): preço chegando depois não suja.
import { useEffect, useRef, useState } from "react";

export function useFichaGuarda({ modeloId, snapshot, tocado, hidratado }: {
  modeloId: string | null; snapshot: string; tocado: boolean; hidratado: boolean;
}) {
  const baselineRef = useRef<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => { baselineRef.current = null; }, [modeloId]);
  useEffect(() => {
    if (hidratado && !tocado) baselineRef.current = snapshot;
  }, [snapshot, tocado, hidratado]);
  const dirty = hidratado && tocado && baselineRef.current !== null && snapshot !== baselineRef.current;
  /** Pós-save com edição EM VOO: baseline = o que foi ENVIADO (o selo segue aceso — receita 2419d0f). */
  const rebasear = (s: string) => { baselineRef.current = s; setTick((n) => n + 1); };
  return { dirty, baselineRef, rebasear };
}
