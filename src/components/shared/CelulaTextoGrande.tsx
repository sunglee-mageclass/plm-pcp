// Controle de texto GRANDE das grades "Lista tipo Excel" dos cadastros (Tecido/Aviamento/Insumo): um textarea que CRESCE em altura
// (mín. 2 linhas, teto de 6; depois rola) para mostrar tudo sem a pessoa rolar com a seta. Só desenha — valor/onChange vêm do rascunho.
//  • `quebraLinha` (Composição, Observações): Enter QUEBRA a linha (não desce); Tab/Shift+Tab seguem a navegação da grade.
//  • sem `quebraLinha` (Nome): o texto só "quebra" visualmente; Enter desce como em qualquer célula e quebras coladas viram espaço.
import type { KeyboardEvent } from "react";
import { AutoTextarea } from "@/components/shared/AutoTextarea";
import { cn } from "@/lib/utils";

type GradeCel = { "data-grade-cel": string; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };

export function CelulaTextoGrande({
  ariaLabel,
  valor,
  onChange,
  desabilitado,
  quebraLinha,
  gradeProps,
  atributos,
  realce,
  placeholder,
}: {
  ariaLabel: string;
  valor?: string | null;
  onChange?: (v: string | null) => void;
  desabilitado: boolean;
  quebraLinha: boolean;
  gradeProps?: GradeCel;
  /** `title`/`aria-invalid`/`data-aviso-colar` já resolvidos pela célula (motivo do bloqueio, erro ou aviso de colagem). */
  atributos?: { title?: string; "aria-invalid"?: boolean; "data-aviso-colar"?: string };
  realce?: string;
  placeholder?: string;
}) {
  return (
    <AutoTextarea
      aria-label={ariaLabel}
      data-controle="textarea"
      disabled={desabilitado}
      placeholder={placeholder}
      {...gradeProps}
      onKeyDown={
        gradeProps
          ? (e) => {
              if (!quebraLinha || e.key !== "Enter") gradeProps.onKeyDown(e);
            }
          : undefined
      }
      {...atributos}
      className={cn(
        "min-h-8 py-1 whitespace-pre-wrap",
        quebraLinha ? "min-w-[12rem]" : "min-w-[10rem]",
        realce,
      )}
      value={valor ?? ""}
      onChange={(e) => {
        const v = quebraLinha ? e.target.value : e.target.value.replace(/\s*\n+\s*/g, " ");
        onChange?.(v === "" ? null : v);
      }}
    />
  );
}
