import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { GradeRow } from "./types";

type Props = {
  grades: GradeRow[];
  tamanhosAll: string[];
  updateGradePlan: (gi: number, tamanho: string, value: number) => void;
  updateGradeCell: (gi: number, tamanho: string, value: number) => void;
};

export function CadGradeSection({ grades, tamanhosAll, updateGradePlan, updateGradeCell }: Props) {
  return (
    <Card className="p-5 space-y-3">
      <h2 className="font-semibold">Grade Replanejada</h2>
      {grades.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma grade definida.</p>
      )}
      {grades.map((g, gi) => (
        <div key={g.variante_numero} className="space-y-2">
          <div className="text-sm font-medium">Variante {g.variante_numero}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-2 py-1 text-left">Tamanho</th>
                  {tamanhosAll.map((t) => <th key={t} className="px-2 py-1">{t}</th>)}
                  <th className="px-2 py-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-2 py-1 text-muted-foreground">Planejada</td>
                  {tamanhosAll.map((t) => (
                    <td key={t} className="px-2 py-1">
                      <Input type="number" value={g.grades_planejadas[t] ?? 0}
                        onChange={(e) => updateGradePlan(gi, t, Number(e.target.value))} />
                    </td>
                  ))}
                  <td className="px-2 py-1 font-medium text-center">{g.grade_total_planejada}</td>
                </tr>
                <tr className="border-t">
                  <td className="px-2 py-1 text-muted-foreground">Real</td>
                  {tamanhosAll.map((t) => (
                    <td key={t} className="px-2 py-1">
                      <Input type="number" value={g.grades_reais[t] ?? 0}
                        onChange={(e) => updateGradeCell(gi, t, Number(e.target.value))} />
                    </td>
                  ))}
                  <td className="px-2 py-1 font-medium text-center">{g.grade_total_real}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </Card>
  );
}
