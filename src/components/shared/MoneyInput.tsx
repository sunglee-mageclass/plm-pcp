import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { caretAfterFormat, maskLive, sigBeforeCaret, valueToMasked } from "@/lib/money-mask";

// useLayoutEffect no cliente (posiciona o cursor antes do paint, sem "pulo"); no
// servidor (SSR do @tanstack/react-start) cai pro useEffect p/ não logar warning.
const useIsoLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

type MoneyInputProps = Omit<React.ComponentPropsWithoutRef<typeof Input>, "value" | "onChange"> & {
  /** Valor canônico: número ou string com ponto decimal ("1234.5"); "" / null / undefined = vazio. */
  value: number | string | null | undefined;
  /** Emite o valor canônico como string ("1234.5"; "" quando vazio) — igual ao NumberInput/DateField. */
  onChange?: (e: { target: { value: string } }) => void;
  /** Casas decimais aceitas (padrão 2). 0 = só inteiro. */
  decimals?: number;
};

/**
 * Campo numérico/monetário que mostra o separador de milhar pt-BR (".") ENQUANTO
 * o usuário digita, preservando a posição do cursor (nem DateField nem NumberInput
 * fazem isso). Decimais opcionais com vírgula. Guarda o valor canônico por baixo
 * (ponto decimal) e o `onChange` é compatível: `(e) => ...(e.target.value)`.
 * Lógica de máscara pura em `@/lib/money-mask` (testada em tests/unit/money-mask.test.ts).
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, onFocus, onBlur, decimals = 2, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const focused = useRef(false);
  const caret = useRef<number | null>(null);
  const [text, setText] = useState(() => valueToMasked(value, decimals));

  // Sincroniza o texto quando o value externo muda e o campo não está focado.
  useEffect(() => {
    if (!focused.current) setText(valueToMasked(value, decimals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Restaura o cursor após o reformat (senão o controlled input joga pro fim).
  useIsoLayoutEffect(() => {
    if (caret.current != null && innerRef.current) {
      const p = caret.current;
      innerRef.current.setSelectionRange(p, p);
      caret.current = null;
    }
  });

  const setRefs = (node: HTMLInputElement | null) => {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
  };

  return (
    <Input
      inputMode="decimal"
      {...rest}
      ref={setRefs}
      type="text"
      value={text}
      onFocus={(e) => { focused.current = true; onFocus?.(e); }}
      onBlur={(e) => { focused.current = false; setText(valueToMasked(value, decimals)); onBlur?.(e); }}
      onChange={(e) => {
        const el = e.target;
        const raw = el.value;
        const rawCaret = el.selectionStart ?? raw.length;
        const sigBefore = sigBeforeCaret(raw, rawCaret, decimals);
        const { masked, canonical } = maskLive(raw, decimals);
        setText(masked);
        caret.current = caretAfterFormat(masked, sigBefore);
        onChange?.({ target: { value: canonical } });
      }}
    />
  );
});
