import { useEffect, useState } from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarDays } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

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
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  min?: string; // ISO
  max?: string; // ISO
  defaultMonth?: string; // ISO — mês que o calendário abre quando o campo está vazio
  required?: boolean;
  className?: string;
  "aria-label"?: string;
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
// "dd/MM/yyyy" -> ISO, ou null se incompleto/inválido (round-trip rejeita 31/02 etc.).
const brToIso = (br: string): string | null => {
  if (br.length !== 10) return null;
  const d = parse(br, "dd/MM/yyyy", new Date());
  if (!isValid(d) || format(d, "dd/MM/yyyy") !== br) return null;
  return format(d, "yyyy-MM-dd");
};
// Formata enquanto digita: só dígitos, injeta as barras dd/mm/aaaa.
const maskBr = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  let s = d.slice(0, 2);
  if (d.length > 2) s += "/" + d.slice(2, 4);
  if (d.length > 4) s += "/" + d.slice(4, 8);
  return s;
};

export function DateField({
  value,
  onChange,
  onBlur,
  disabled,
  readOnly,
  id,
  min,
  max,
  defaultMonth,
  required,
  className,
  "aria-label": ariaLabel,
}: DateFieldProps) {
  const [text, setText] = useState(() => isoToBr(value));
  const [open, setOpen] = useState(false);

  // Sincroniza quando o value externo muda e não corresponde ao texto atual.
  useEffect(() => {
    const cur = brToIso(text) ?? "";
    if (cur !== (value ?? "").slice(0, 10)) setText(isoToBr(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (iso: string) => onChange?.({ target: { value: iso } });

  const onText = (raw: string) => {
    const masked = maskBr(raw);
    setText(masked);
    if (masked === "") return emit("");
    const iso = brToIso(masked);
    if (iso) emit(iso); // incompleto/ inválido: não emite (mantém o valor anterior)
  };

  const onBlurInternal = () => {
    // Saiu com texto incompleto/inválido → volta pro último valor válido.
    if (text !== "" && !brToIso(text)) setText(isoToBr(value));
    onBlur?.();
  };

  const selected = isoToDate(value);
  const minDate = isoToDate(min ?? "");
  const maxDate = isoToDate(max ?? "");

  return (
    <div className={cn("relative h-9", className)}>
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
        onChange={(e) => onText(e.target.value)}
        onBlur={onBlurInternal}
        className="h-full w-full pr-9"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || readOnly}
            aria-label="Abrir calendário"
            className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-50"
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
              }
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
