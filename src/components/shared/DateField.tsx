import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  /** Mensagem (sob o campo, no blur) quando a data digitada é válida mas fora de `min`/`max`. */
  mensagemForaDoLimite?: string;
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
  mensagemForaDoLimite,
}: DateFieldProps) {
  const [text, setText] = useState(() => isoToBr(value));
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorPendente = useRef<number | null>(null);
  const [tick, setTick] = useState(0);
  const [erroLimite, setErroLimite] = useState<string | null>(null);
  const digitou = useRef(false); // o usuário digitou desde o último blur (só aí o aviso de limite faz sentido)
  const erroId = useId();
  const lim = { min, max };
  const brToIso = (br: string) => brToIsoLim(br, lim);

  // Sincroniza quando o value externo muda e não corresponde ao texto atual.
  useEffect(() => {
    const cur = brToIso(text) ?? "";
    if (cur !== (value ?? "").slice(0, 10)) setText(isoToBr(value));
    setErroLimite(null); // valor mudou de fora: o aviso antigo não vale mais
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Reposiciona o cursor depois do mascaramento (o React joga o cursor pro fim ao trocar o value).
  // `tick` força a passada mesmo quando o texto mascarado ficou IGUAL ao anterior (backspace numa "/").
  useLayoutEffect(() => {
    const pos = cursorPendente.current;
    cursorPendente.current = null;
    const el = inputRef.current;
    if (pos != null && el && document.activeElement === el) el.setSelectionRange(pos, pos);
  }, [text, tick]);

  const emit = (iso: string) => onChange?.({ target: { value: iso } });

  const onText = (raw: string, cursorRaw: number) => {
    const r = processarDigitacao(raw, cursorRaw, lim, text);
    cursorPendente.current = r.cursor;
    digitou.current = true;
    setErroLimite(null);
    setText(r.texto);
    setTick((t) => t + 1);
    // iso null = incompleto / inválido / ano fora de 1900–2100 / fora de min-max / dígito a mais (rejeitado).
    if (r.iso !== null) emit(r.iso);
  };

  // Confirma o que está NA TELA: se é uma data válida diferente do `value`, emite antes do commit
  // (tela e estado nunca divergem). Retorna false se o texto é inválido (nada a confirmar).
  const confirmar = (): boolean => {
    const iso = text === "" ? "" : brToIso(text);
    if (iso === null) return false;
    if (iso !== (value ?? "").slice(0, 10)) emit(iso);
    onCommit?.(iso);
    return true;
  };

  const onBlurInternal = () => {
    if (!confirmar()) {
      // Incompleto/inválido/fora do limite → volta pro último valor válido (e explica se for o limite).
      const livre = text.length === 10 ? brToIsoLim(text) : null;
      if (livre && digitou.current) {
        const abaixo = !!min && livre < min.slice(0, 10);
        setErroLimite(
          mensagemForaDoLimite ??
            (abaixo
              ? `Data anterior ao mínimo permitido (${isoToBr(min!)})`
              : `Data posterior ao máximo permitido (${isoToBr(max ?? "")})`),
        );
      }
      setText(isoToBr(value));
    }
    digitou.current = false;
    onBlur?.();
  };

  const selected = isoToDate(value);
  const minDate = isoToDate(min ?? "");
  const maxDate = isoToDate(max ?? "");

  return (
    <div className={className}>
      <div className="relative h-9 max-md:h-11">
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
            if (e.key === "Enter") confirmar();
          }}
          aria-invalid={erroLimite ? true : undefined}
          aria-describedby={erroLimite ? erroId : undefined}
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
                  setErroLimite(null);
                  emit(format(d, "yyyy-MM-dd"));
                  onCommit?.(format(d, "yyyy-MM-dd"));
                }
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      {erroLimite && (
        <p id={erroId} role="alert" className="mt-0.5 text-xs text-destructive">
          {erroLimite}
        </p>
      )}
    </div>
  );
}
