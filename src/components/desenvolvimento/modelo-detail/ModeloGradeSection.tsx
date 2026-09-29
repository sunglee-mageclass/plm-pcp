import { useMemo, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Field } from "./shared";
import type { GradeRow } from "./types";
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";
import type { TamanhoTipo } from "@/lib/tamanho";
import { tamanhosVisiveis } from "@/lib/tamanho-exibicao";

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
  tamanhoTipo,
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
  /** P-120 A (plano `2026-09-29-tamanho-em`, Tarefa 7) — OPCIONAL: sem ela, o componente é BYTE A BYTE o de hoje (o
   *  Sheet do Dev só-leitura, F5a, depende disso — `tests/unit/f5-dev-somente-leitura*.test.ts`). Com ela, rótulo
   *  pelo lado escolhido (`rotuloDoTamanho`) e colunas filtradas por `tamanhosVisiveis` — mas as chaves de
   *  `grades`/`proporcoes` (e os handlers `onChangeProporcao`/`onChangeGradeCell`) continuam usando a chave CHEIA
   *  de `tamanhos` (ex. "34|PPP"); o filtro é só de EXIBIÇÃO (ressalva #3 do G-plano) — nunca esconde um tamanho
   *  que já tem quantidade lançada (fica esmaecido, não desaparece). */
  tamanhoTipo?: TamanhoTipo | null;
}) {
  const ensureGrade = (n: number): GradeRow =>
    grades.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };

  // Com cálculo automático ligado, a Grade Total é editável: COM proporções distribui na proporção;
  // SEM proporções divide IGUALMENTE entre os tamanhos (mantém Σ células == total). Antes exigia
  // proporção > 0, o que travava o total logo após "Aplicar ao modelo" (Plan. Tecido) sem proporção.
  const somaProp = tamanhos.reduce((s, t) => s + (Number(proporcoes?.[t]) || 0), 0);
  const totalEditavel = gradeAuto;

  // Tamanhos a MOSTRAR (colunas da matriz de proporção E de cada card de variante): `comValor` junta os tamanhos
  // com proporção > 0 OU com alguma quantidade lançada em QUALQUER variante — um solto do lado não-escolhido que já
  // tem dado real nunca desaparece (fica esmaecido). Sem `tamanhoTipo`, mostra TUDO (byte a byte o comportamento
  // de hoje) — `tamanhosVisiveis` só entra em jogo quando o card já sabe o "Tamanho em".
  // Fix M-1 (review T3+T7) — `comValor` é ACUMULATIVO (ref, não recalculado do zero a cada render): um tamanho
  // esmaecido que já entrou na sessão NUNCA sai dela, mesmo que a célula passe por 0 no meio da digitação (ex.:
  // Backspace pra trocar "3" por "5" — o NumberInput emite 0 nesse instante). Sem isto, o tamanho saía de
  // `comValor`, a coluna desmontava na hora (perda de foco, impossível terminar de digitar). A UNIÃO com o valor
  // VIVO garante que um tamanho que ganha dado DEPOIS da montagem também entra (não é só o valor inicial).
  const comValorAcumuladoRef = useRef<Set<string>>(new Set());
  const comValor = useMemo(() => {
    const s = comValorAcumuladoRef.current;
    for (const t of tamanhos) {
      if (Number(proporcoes?.[t]) > 0) { s.add(t); continue; }
      for (const g of grades) if (Number(g.grades?.[t]) > 0) { s.add(t); break; }
    }
    // Devolve uma CÓPIA (nunca a ref viva) — `tamanhosVisiveis` não deve mutar o acumulador, e um consumidor
    // guardando a referência não pode ver o acumulador crescer por baixo sem um novo cálculo.
    return new Set(s);
  }, [tamanhos, proporcoes, grades]);
  const colunas = tamanhoTipo ? tamanhosVisiveis(tamanhos, tamanhoTipo, comValor) : tamanhos.map((t) => ({ chave: t, rotulo: t, esmaecido: false }));

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
          style={{ gridTemplateColumns: `repeat(${colunas.length}, minmax(48px, 1fr))` }}
        >
          {colunas.map(({ chave: t, rotulo, esmaecido }) => (
            // Matriz numérica: rótulo + valor CENTRADOS sob o cabeçalho (leem melhor alinhados). `t` (chave cheia)
            // segue indo pro handler — o filtro/rótulo é só de exibição (ressalva #3).
            <div key={t} className={`grid gap-1 text-center ${esmaecido ? "opacity-50" : ""}`}>
              <Label className="text-xs">{rotulo}</Label>
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
                      data-colab-path={`grade-total:${n}`}
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
                  style={{ gridTemplateColumns: `repeat(${colunas.length}, minmax(48px, 1fr))` }}
                >
                  {colunas.map(({ chave: t, rotulo, esmaecido }) => (
                    <div key={t} className={`grid gap-1 text-center ${esmaecido ? "opacity-50" : ""}`}>
                      <Label className="text-xs">{rotulo}</Label>
                      <NumberInput
                        integer
                        className="text-center tabular-nums"
                        placeholder="0"
                        data-colab-path={`grade-cell:${n}:${t}`}
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
