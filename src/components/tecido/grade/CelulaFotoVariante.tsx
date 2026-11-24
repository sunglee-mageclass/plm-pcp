// Célula Foto de uma cor JÁ cadastrada na grade: liga o upload (grava na hora) à célula de desenho `CelulaTecido`.
import { MOTIVO_SEM_PERMISSAO } from "@/lib/grade-bloqueio";
import { CelulaTecido } from "./CelulaTecido";
import { useFotoVariante } from "./useFotoVariante";
import type { ColunaGrade } from "@/lib/tecido-grade/colunas";

export function CelulaFotoVariante({
  coluna,
  ariaLabel,
  variante,
  readOnly,
}: {
  coluna: ColunaGrade;
  ariaLabel: string;
  variante: { id: string; artigo_id: string; foto_url: string | null };
  readOnly: boolean;
}) {
  const { enviar, enviando } = useFotoVariante(variante);
  return (
    <CelulaTecido
      coluna={coluna}
      ariaLabel={ariaLabel}
      foto={{ path: variante.foto_url, enviando, onEnviar: readOnly ? undefined : enviar, dica: readOnly ? MOTIVO_SEM_PERMISSAO : undefined }}
    />
  );
}
