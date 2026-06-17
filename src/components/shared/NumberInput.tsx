import { forwardRef, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

type InputProps = React.ComponentPropsWithoutRef<typeof Input>;

/**
 * Campo numérico apenas-digitável: sem setas de incremento/decremento e que
 * permite apagar / deixar em branco (vazio conta como 0). Mantém um texto local
 * enquanto está em edição e sincroniza com o valor externo ao perder o foco ou
 * quando o valor muda de fora (ex.: cálculo automático).
 *
 * Repassa o `onChange` com `e.target.value` já normalizado para um número válido
 * (vazio/parcial -> "0"), então handlers existentes (`Number(e.target.value)`)
 * seguem funcionando sem alteração. É `type="text"` por dentro (sem spinners),
 * sobrescrevendo qualquer `type` recebido.
 */
export const NumberInput = forwardRef<HTMLInputElement, InputProps>(function NumberInput(
  { value, onChange, onFocus, onBlur, ...rest },
  ref,
) {
  const toText = (v: InputProps["value"]) =>
    v === undefined || v === null || (v as unknown) === "" ? "" : String(v);
  const [text, setText] = useState(() => toText(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(toText(value));
  }, [value]);

  return (
    <Input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={(e) => { focused.current = true; onFocus?.(e); }}
      onBlur={(e) => { focused.current = false; setText(toText(value)); onBlur?.(e); }}
      onChange={(e) => {
        const v = e.target.value;
        // Aceita apenas número/decimal (ponto) e negativo; vazio é permitido.
        if (v !== "" && !/^-?\d*\.?\d*$/.test(v)) return;
        setText(v);
        const ns = v === "" || v === "-" || v === "." || v === "-." ? "0" : v;
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
