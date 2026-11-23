// Célula Foto de uma cor JÁ cadastrada na grade de Aviamentos: liga o upload (grava na hora) à célula de desenho `CelulaAviamento`.
import { CelulaAviamento } from "./CelulaAviamento";
import { useFotoVariante } from "./useFotoVariante";
import type { ColunaGrade } from "@/lib/aviamento-grade/colunas";

export function CelulaFotoVariante({
  coluna,
  ariaLabel,
  variante,
  readOnly,
}: {
  coluna: ColunaGrade;
  ariaLabel: string;
  variante: { id: string; aviamento_id: string; foto_url: string | null };
  readOnly: boolean;
}) {
  const { enviar, enviando } = useFotoVariante(variante);
  return (
    <CelulaAviamento
      coluna={coluna}
      ariaLabel={ariaLabel}
      foto={{ path: variante.foto_url, enviando, onEnviar: readOnly ? undefined : enviar }}
    />
  );
}
