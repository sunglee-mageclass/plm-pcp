import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Field } from "./shared";
import type { GradeRow } from "./types";
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";

// `tecido` só vem preenchido quando o pool do Tecido 1 tem mais de um artigo (substitutos):
// aí o nome do tecido prefixa a variante p/ desambiguar qual variante é de qual tecido.
export type GradeVarianteInfo = {
  numero: number;
  label: string;
  tecido?: string;
  /** Rótulo do par casado (Fatia 1 casar-variantes): '{tecido B} · cor'. Só o TEXTO — a grade em si é a do Tecido 1. */
  complemento?: string;
};

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
  camposCopiados = new Set(),
  onCampoEditado,
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
  camposCopiados?: Set<string>;
  onCampoEditado?: (k: string) => void;
}) {
  const ensureGrade = (n: number): GradeRow =>
    grades.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };

  // Com cálculo automático ligado, a Grade Total é editável: COM proporções distribui na proporção;
  // SEM proporções divide IGUALMENTE entre os tamanhos (mantém Σ células == total). Antes exigia
  // proporção > 0, o que travava o total logo após "Aplicar ao modelo" (Plan. Tecido) sem proporção.
  const somaProp = tamanhos.reduce((s, t) => s + (Number(proporcoes?.[t]) || 0), 0);
  const totalEditavel = gradeAuto;

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
          style={{ gridTemplateColumns: `repeat(${tamanhos.length}, minmax(48px, 1fr))` }}
        >
          {tamanhos.map((t) => (
            // Matriz numérica: rótulo + valor CENTRADOS sob o cabeçalho (leem melhor alinhados).
            <div key={t} className="grid gap-1 text-center">
              <Label className="text-xs">{t}</Label>
              <NumberInput
                integer
                className="text-center tabular-nums"
                placeholder="0"
                value={proporcoes?.[t] || ""}
                onChange={(e) => onChangeProporcao(t, Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          ))}
        </div>
      </div>
      {gradeAuto && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          {somaProp > 0
            ? "Digite a Grade Total ou um tamanho, e os demais preenchem na proporção acima."
            : "Digite a Grade Total (divide igualmente entre os tamanhos) ou defina proporções acima para destrinchar."}
        </p>
      )}
      <Separator />
      {tecido1Variantes.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Selecione as variantes do Tecido 1 para preencher a grade.
        </p>
      ) : (
        <div className="space-y-2">
          {tecido1Variantes.map(({ numero: n, label, tecido, complemento }) => {
            const g = ensureGrade(n);
            return (
              <Card key={n} className={`p-3 space-y-2 ${classeCopiado(camposCopiados, "grade")}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">
                    Variante {n}
                    {label || tecido ? (
                      <span className="text-muted-foreground font-normal">
                        {" — "}
                        {tecido ? <span className="font-medium text-foreground">{tecido}</span> : null}
                        {tecido && label ? " · " : null}
                        {label}
                      </span>
                    ) : null}
                    {complemento ? (
                      <span className="text-muted-foreground font-normal"> · casada com {complemento}</span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Grade Total</Label>
                    <NumberInput
                      integer
                      placeholder="0"
                      className={`w-24 ${totalEditavel ? "" : "bg-muted"}`}
                      readOnly={!totalEditavel}
                      tabIndex={totalEditavel ? undefined : -1}
                      value={g.grade_total || ""}
                      onChange={totalEditavel ? (e) => { onChangeGradeTotal(n, Math.max(0, Number(e.target.value) || 0)); onCampoEditado?.("grade"); } : undefined}
                    />
                  </div>
                </div>
                <div
                  className="grid gap-2 overflow-x-auto pb-1"
                  style={{ gridTemplateColumns: `repeat(${tamanhos.length}, minmax(48px, 1fr))` }}
                >
                  {tamanhos.map((t) => (
                    <div key={t} className="grid gap-1 text-center">
                      <Label className="text-xs">{t}</Label>
                      <NumberInput
                        integer
                        className="text-center tabular-nums"
                        placeholder="0"
                        value={g.grades[t] || ""}
                        onChange={(e) => { onChangeGradeCell(n, t, Math.max(0, Number(e.target.value) || 0)); onCampoEditado?.("grade"); }}
                      />
                    </div>
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
