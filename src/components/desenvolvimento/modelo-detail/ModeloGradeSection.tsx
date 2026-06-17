import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Field } from "./shared";
import type { GradeRow } from "./types";

export type GradeVarianteInfo = { numero: number; label: string };

export function ModeloGradeSection({
  tamanhos,
  proporcoes,
  onChangeProporcao,
  grades,
  onChangeGradeTotal,
  onChangeGradeCell,
  tecido1Variantes,
  gradeAuto,
  onToggleGradeAuto,
}: {
  tamanhos: string[];
  proporcoes: Record<string, number>;
  onChangeProporcao: (tam: string, val: number) => void;
  grades: GradeRow[];
  onChangeGradeTotal: (n: number, total: number) => void;
  onChangeGradeCell: (n: number, tam: string, qty: number) => void;
  tecido1Variantes: GradeVarianteInfo[];
  gradeAuto: boolean;
  onToggleGradeAuto: (v: boolean) => void;
}) {
  const ensureGrade = (n: number): GradeRow =>
    grades.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-xs font-semibold">Proporções por Tamanho</p>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={gradeAuto}
              onChange={(e) => onToggleGradeAuto(e.target.checked)}
            />
            Cálculo automático pela proporção
          </label>
        </div>
        <div
          className="grid gap-2 overflow-x-auto pb-1"
          style={{ gridTemplateColumns: `repeat(${tamanhos.length}, minmax(64px, 1fr))` }}
        >
          {tamanhos.map((t) => (
            <Field key={t} label={t}>
              <NumberInput
                type="number"
                value={proporcoes?.[t] ?? 0}
                onChange={(e) => onChangeProporcao(t, Math.max(0, Number(e.target.value) || 0))}
              />
            </Field>
          ))}
        </div>
      </div>
      {gradeAuto && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          Digite um tamanho em qualquer variante e os demais preenchem na proporção acima.
        </p>
      )}
      <Separator />
      {tecido1Variantes.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Selecione as variantes do Tecido 1 para preencher a grade.
        </p>
      ) : (
        <div className="space-y-2">
          {tecido1Variantes.map(({ numero: n, label }) => {
            const g = ensureGrade(n);
            return (
              <Card key={n} className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">
                    Variante {n}
                    {label ? <span className="text-muted-foreground font-normal"> — {label}</span> : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Grade Total</Label>
                    <NumberInput
                      className="w-24 bg-muted"
                      type="number"
                      readOnly
                      tabIndex={-1}
                      value={g.grade_total}
                    />
                  </div>
                </div>
                <div
                  className="grid gap-2 overflow-x-auto pb-1"
                  style={{ gridTemplateColumns: `repeat(${tamanhos.length}, minmax(64px, 1fr))` }}
                >
                  {tamanhos.map((t) => (
                    <Field key={t} label={t}>
                      <NumberInput
                        type="number"
                        min={0}
                        value={g.grades[t] ?? 0}
                        onChange={(e) => onChangeGradeCell(n, t, Math.max(0, Number(e.target.value) || 0))}
                      />
                    </Field>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
