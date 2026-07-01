import { forwardRef, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { fmtNumEdit } from "@/lib/format";

type InputProps = React.ComponentPropsWithoutRef<typeof Input> & { integer?: boolean };

/**
 * Campo numérico apenas-digitável: sem setas de incremento, permite apagar /
 * deixar em branco (vazio conta como 0). Em repouso mostra o número formatado em
 * pt-BR (vírgula decimal, ponto de milhar, ≥2 casas); ao focar mostra um texto
 * editável simples (sem separador de milhar). Aceita vírgula ou ponto como
 * decimal e repassa o onChange com e.target.value já normalizado (ponto), então
 * handlers existentes (Number(e.target.value)) seguem funcionando.
 *
 * `integer`: só dígitos, sem casas decimais (ex.: grade em peças) — exibe 1.234
 * (sem ,00) e bloqueia separador decimal na digitação.
 */
export const NumberInput = forwardRef<HTMLInputElement, InputProps>(function NumberInput(
  { value, onChange, onFocus, onBlur, integer, ...rest },
  ref,
) {
  const isEmpty = (v: InputProps["value"]) => v === undefined || v === null || (v as unknown) === "";
  const asInt = (v: InputProps["value"]) => {
    const num = Number(v);
    return Number.isNaN(num) ? "" : Math.trunc(num).toLocaleString("pt-BR");
  };
  // Texto enquanto edita: número puro com vírgula, sem milhar (ex.: 1234,5).
  const toEdit = (v: InputProps["value"]) =>
    isEmpty(v) ? "" : integer ? String(Math.trunc(Number(v))) : String(v).replace(".", ",");
  // Texto em repouso: formatado pt-BR (1.234,50) — ou inteiro (1.234) quando integer.
  const toDisplay = (v: InputProps["value"]) =>
    isEmpty(v) ? "" : integer ? asInt(v) : fmtNumEdit(v as number | string);

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
      inputMode={integer ? "numeric" : "decimal"}
      value={text}
      onFocus={(e) => { focused.current = true; setText(toEdit(value)); onFocus?.(e); }}
      onBlur={(e) => { focused.current = false; setText(toDisplay(value)); onBlur?.(e); }}
      onChange={(e) => {
        const raw = e.target.value;
        // aceita dígitos (+ separador decimal, salvo modo inteiro) e negativo
        if (raw !== "" && !(integer ? /^-?\d*$/ : /^-?\d*[.,]?\d*$/).test(raw)) return;
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
