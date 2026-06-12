import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
}: {
  tamanhos: string[];
  proporcoes: Record<string, number>;
  onChangeProporcao: (tam: string, val: number) => void;
  grades: GradeRow[];
  onChangeGradeTotal: (n: number, total: number) => void;
  onChangeGradeCell: (n: number, tam: string, qty: number) => void;
  tecido1Variantes: GradeVarianteInfo[];
}) {
  const ensureGrade = (n: number): GradeRow =>
    grades.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold mb-2">Proporções por Tamanho</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {tamanhos.map((t) => (
            <Field key={t} label={t}>
              <Input
                type="number"
                value={proporcoes?.[t] ?? 0}
                onChange={(e) => onChangeProporcao(t, Number(e.target.value) || 0)}
              />
            </Field>
          ))}
        </div>
      </div>
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
                    <Input
                      className="w-24 bg-muted"
                      type="number"
                      readOnly
                      tabIndex={-1}
                      value={g.grade_total}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {tamanhos.map((t) => (
                    <Field key={t} label={t}>
                      <Input
                        type="number"
                        min={0}
                        value={g.grades[t] ?? 0}
                        onChange={(e) => onChangeGradeCell(n, t, Number(e.target.value) || 0)}
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
