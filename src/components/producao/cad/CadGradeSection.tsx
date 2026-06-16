import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GradeRow } from "./types";

type Props = {
  grades: GradeRow[];
  tamanhosAll: string[];
  updateGradeCell: (gi: number, tamanho: string, value: number) => void;
  labelByNumero?: Record<number, string>;
  gradeAuto?: boolean;
  onToggleGradeAuto?: (v: boolean) => void;
  proporcoes?: Record<string, number>;
  onChangeProporcao?: (tam: string, val: number) => void;
};

export function CadGradeSection({
  grades,
  tamanhosAll,
  updateGradeCell,
  labelByNumero,
  gradeAuto,
  onToggleGradeAuto,
  proporcoes,
  onChangeProporcao,
}: Props) {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Grade</h2>
        {onToggleGradeAuto && (
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={!!gradeAuto}
              onChange={(e) => onToggleGradeAuto(e.target.checked)}
            />
            Cálculo automático pela proporção
          </label>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Esta grade é a mesma do Desenvolvimento — o que mudar aqui vale como grade final.
      </p>

      {onChangeProporcao && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Proporções por Tamanho</p>
          <div className="overflow-x-auto">
            <div
              className="grid gap-2 pb-1"
              style={{ gridTemplateColumns: `repeat(${tamanhosAll.length}, minmax(64px, 1fr))` }}
            >
              {tamanhosAll.map((t) => (
                <div key={t} className="grid gap-1">
                  <Label className="text-[11px]">{t}</Label>
                  <Input
                    type="number"
                    className="h-8"
                    value={proporcoes?.[t] ?? 0}
                    onChange={(e) => onChangeProporcao(t, Number(e.target.value) || 0)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {gradeAuto && (
        <p className="text-[11px] text-muted-foreground">
          Digite um tamanho em qualquer variante e os demais preenchem na proporção acima.
        </p>
      )}

      {grades.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma grade definida.</p>
      )}

      {grades.map((g, gi) => (
        <div key={g.variante_numero} className="space-y-2">
          <div className="text-sm font-medium">
            {labelByNumero?.[g.variante_numero] ?? `Variante ${g.variante_numero}`}
          </div>
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
                  <td className="px-2 py-1 text-muted-foreground">Grade</td>
                  {tamanhosAll.map((t) => (
                    <td key={t} className="px-2 py-1">
                      <Input
                        type="number"
                        value={g.grades[t] ?? 0}
                        onChange={(e) => updateGradeCell(gi, t, Number(e.target.value))}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1 font-medium text-center">{g.grade_total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </Card>
  );
}
