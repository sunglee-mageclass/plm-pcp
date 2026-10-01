import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarDays } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { brToIso as brToIsoLim, processarDigitacao } from "@/lib/date-field";

/**
 * Campo de data SEMPRE no padrão dd/mm/aaaa, independente do idioma do aparelho.
 * Substitui `<input type="date">` (que o navegador exibe no locale do device).
 * - Mostra/edita como texto mascarado dd/mm/aaaa + um calendário pop-up (pt-BR).
 * - Guarda/emite ISO `yyyy-MM-dd` (mesmo "value" do input nativo), e o onChange é
 *   compatível: `(e) => ...(e.target.value)` segue funcionando.
 */
export type DateFieldProps = {
  value: string; // ISO "yyyy-MM-dd" (ou "")
  onChange?: (e: { target: { value: string } }) => void;
  onBlur?: () => void;
  /**
   * Confirmação da data (p/ quem persiste na hora): dispara no blur com data válida (ou campo limpo = ""), no Enter e ao
   * escolher no calendário — nunca a cada tecla. `onChange` continua emitindo quando o ISO fica completo.
   */
  onCommit?: (iso: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  min?: string; // ISO
  max?: string; // ISO
  defaultMonth?: string; // ISO — mês que o calendário abre quando o campo está vazio
  required?: boolean;
  className?: string;
  "aria-label"?: string;
  // Colab (spec 2026-08-03): presença/conflito por campo lê `dataset.colabPath` de
  // `e.target` no foco — precisa estar no <input> real (foco não pousa no wrapper).
  "data-colab-path"?: string;
  title?: string;
  inputClassName?: string;
};

const isoToDate = (iso: string): Date | undefined => {
  const s = (iso ?? "").slice(0, 10);
  if (!s) return undefined;
  const d = parse(s, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : undefined;
};
const isoToBr = (iso: string): string => {
  const d = isoToDate(iso);
  return d ? format(d, "dd/MM/yyyy") : "";
};
export function DateField({
  value,
  onChange,
  onBlur,
  onCommit,
  disabled,
  readOnly,
  id,
  min,
  max,
  defaultMonth,
  required,
  className,
  "aria-label": ariaLabel,
  "data-colab-path": dataColabPath,
  title,
  inputClassName,
}: DateFieldProps) {
  const [text, setText] = useState(() => isoToBr(value));
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorPendente = useRef<number | null>(null);
  const lim = { min, max };
  const brToIso = (br: string) => brToIsoLim(br, lim);

  // Sincroniza quando o value externo muda e não corresponde ao texto atual.
  useEffect(() => {
    const cur = brToIso(text) ?? "";
    if (cur !== (value ?? "").slice(0, 10)) setText(isoToBr(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Reposiciona o cursor depois do mascaramento (o React joga o cursor pro fim ao trocar o value).
  useLayoutEffect(() => {
    const pos = cursorPendente.current;
    cursorPendente.current = null;
    const el = inputRef.current;
    if (pos != null && el && document.activeElement === el) el.setSelectionRange(pos, pos);
  }, [text]);

  const emit = (iso: string) => onChange?.({ target: { value: iso } });

  const onText = (raw: string, cursorRaw: number) => {
    const r = processarDigitacao(raw, cursorRaw, lim);
    cursorPendente.current = r.cursor;
    setText(r.texto);
    // iso null = incompleto / inválido / ano fora de 1900–2100 / fora de min-max / dígito a mais: não emite.
    if (r.iso !== null) emit(r.iso);
  };

  const onBlurInternal = () => {
    // Saiu com texto incompleto/inválido → volta pro último valor válido.
    const iso = brToIso(text);
    if (text !== "" && !iso) setText(isoToBr(value));
    else onCommit?.(iso ?? ""); // "" = campo limpo
    onBlur?.();
  };

  const selected = isoToDate(value);
  const minDate = isoToDate(min ?? "");
  const maxDate = isoToDate(max ?? "");

  return (
    <div className={cn("relative h-9 max-md:h-11", className)}>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        value={text}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-label={ariaLabel}
        data-colab-path={dataColabPath}
        title={title}
        ref={inputRef}
        onChange={(e) => onText(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onBlur={onBlurInternal}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const iso = text === "" ? "" : brToIso(text);
            if (iso !== null) onCommit?.(iso);
          }
        }}
        className={cn("h-full w-full pr-9 max-md:pr-11", inputClassName)}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || readOnly}
            aria-label="Abrir calendário"
            className="absolute inset-y-0 right-0 grid w-9 max-md:w-11 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? isoToDate(defaultMonth ?? "") ?? new Date()}
            disabled={[
              ...(minDate ? [{ before: minDate }] : []),
              ...(maxDate ? [{ after: maxDate }] : []),
            ]}
            onSelect={(d) => {
              if (d) {
                setText(format(d, "dd/MM/yyyy"));
                emit(format(d, "yyyy-MM-dd"));
                onCommit?.(format(d, "yyyy-MM-dd"));
              }
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
