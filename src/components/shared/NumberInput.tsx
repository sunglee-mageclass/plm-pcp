import { forwardRef, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { fmtNumEdit } from "@/lib/format";

type InputProps = React.ComponentPropsWithoutRef<typeof Input>;

/**
 * Campo numérico apenas-digitável: sem setas de incremento, permite apagar /
 * deixar em branco (vazio conta como 0). Em repouso mostra o número formatado em
 * pt-BR (vírgula decimal, ponto de milhar, ≥2 casas); ao focar mostra um texto
 * editável simples (sem separador de milhar). Aceita vírgula ou ponto como
 * decimal e repassa o onChange com e.target.value já normalizado (ponto), então
 * handlers existentes (Number(e.target.value)) seguem funcionando.
 */
export const NumberInput = forwardRef<HTMLInputElement, InputProps>(function NumberInput(
  { value, onChange, onFocus, onBlur, ...rest },
  ref,
) {
  const isEmpty = (v: InputProps["value"]) => v === undefined || v === null || (v as unknown) === "";
  // Texto enquanto edita: número puro com vírgula, sem milhar (ex.: 1234,5).
  const toEdit = (v: InputProps["value"]) => (isEmpty(v) ? "" : String(v).replace(".", ","));
  // Texto em repouso: formatado pt-BR (1.234,50).
  const toDisplay = (v: InputProps["value"]) => (isEmpty(v) ? "" : fmtNumEdit(v as number | string));

  const [text, setText] = useState(() => toDisplay(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(toDisplay(value));
  }, [value]);

  return (
    <Input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={(e) => { focused.current = true; setText(toEdit(value)); onFocus?.(e); }}
      onBlur={(e) => { focused.current = false; setText(toDisplay(value)); onBlur?.(e); }}
      onChange={(e) => {
        const raw = e.target.value;
        // aceita dígitos, um separador decimal (vírgula ou ponto) e negativo
        if (raw !== "" && !/^-?\d*[.,]?\d*$/.test(raw)) return;
        setText(raw);
        const norm = raw.replace(",", ".");
        const ns = norm === "" || norm === "-" || norm === "." || norm === "-." ? "0" : norm;
        onChange?.({
          target: { value: ns },
          currentTarget: { value: ns },
          preventDefault() {},
          stopPropagation() {},
        } as unknown as React.ChangeEvent<HTMLInputElement>);
      }}
    />
  );
});
