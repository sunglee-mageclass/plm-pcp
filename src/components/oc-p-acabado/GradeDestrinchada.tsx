import { NumberInput } from "@/components/shared/NumberInput";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";
import type { CelulaGrade, GradeDetalhe, VarianteDraft } from "./shared";

const CELULA_VAZIA: CelulaGrade = { pedida: 0, recebida: 0, defeito: 0 };

// Grade cor×tamanho editável (§N) — variantes em linha (via `MatrizGradeResponsiva`,
// mobile-friendly), tamanhos em coluna, célula = um dos 3 campos de `CelulaGrade`
// (pedida na seção 2; recebida/defeito na seção 4 de Recebimento). Auto-preenchida por
// `redistribuirPedida`/`redistribuirVariantesPorPeso` (maior resto); sempre editável.
export function GradeDestrinchada({
  variantes,
  tamanhos,
  grade,
  campo,
  onChange,
  labelFor,
  disabled = false,
  emptyLabel = "Nenhuma variante — adicione ao menos uma na tabela acima.",
}: {
  variantes: VarianteDraft[];
  tamanhos: string[];
  grade: GradeDetalhe;
  campo: keyof CelulaGrade;
  onChange: (next: GradeDetalhe) => void;
  labelFor: (ordem: number) => string;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const cel = (ordem: number, tam: string): CelulaGrade => grade[String(ordem)]?.[tam] ?? CELULA_VAZIA;

  const set = (ordem: number, tam: string, v: number) => {
    const key = String(ordem);
    const linha = { ...(grade[key] ?? {}) };
    linha[tam] = { ...(linha[tam] ?? CELULA_VAZIA), [campo]: v };
    onChange({ ...grade, [key]: linha });
  };

  const mrVariantes = variantes.map((v) => ({ num: v.ordem, label: labelFor(v.ordem) }));

  return (
    <MatrizGradeResponsiva
      tamanhos={tamanhos}
      variantes={mrVariantes}
      emptyLabel={emptyLabel}
      total={(num) => tamanhos.reduce((s, t) => s + (Number(cel(num, t)[campo]) || 0), 0)}
      renderCell={(num, t) => (
        <NumberInput
          integer
          disabled={disabled}
          className="h-8 max-md:h-11 w-full border-0 text-center"
          value={cel(num, t)[campo]}
          onChange={(e) => set(num, t, Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
        />
      )}
    />
  );
}
