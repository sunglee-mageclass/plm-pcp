// O banco só guarda o NOME da cor (sem hex). O swatch deriva um hex aproximado do nome
// via corParaHex(); se o nome não casar (ou não vier), cai no fallback neutro var(--muted).
// Um `color` explícito (hex) sempre tem prioridade.
import { cn } from "@/lib/utils";
import { corParaHex } from "@/lib/cor-hex";

interface VarianteSwatchProps {
  color?: string;
  nome?: string;
  label?: string;
  className?: string;
}

export function VarianteSwatch({ color, nome, label, className }: VarianteSwatchProps) {
  const bg = color ?? corParaHex(nome) ?? "var(--muted)";
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <div className="h-3 w-3 rounded-sm border" style={{ backgroundColor: bg }} />
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </span>
  );
}
