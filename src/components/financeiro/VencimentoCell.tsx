import { useEffect, useRef, useState } from "react";
import { DateField } from "@/components/shared/DateField";

/**
 * Célula de vencimento com estado local. SALVA só ao confirmar (`onCommit` do DateField): blur,
 * Enter ou escolha no calendário — nunca a cada emissão do onChange. `ultimo` evita gravar duas
 * vezes (Enter seguido de blur) antes de o valor do servidor chegar; no erro é liberado para
 * redigitar a mesma data tentar de novo. Vencimento é obrigatório: limpar e sair volta à data guardada.
 */
export function VencimentoCell({
  value,
  onSave,
  disabled,
  podeEditar,
}: {
  value: string;
  onSave: (v: string, h?: { onError: () => void }) => void;
  disabled?: boolean;
  podeEditar: boolean;
}) {
  const [v, setV] = useState(value);
  const [obrigatorio, setObrigatorio] = useState(false);
  const ultimo = useRef(value);
  useEffect(() => {
    setV(value);
    ultimo.current = value;
  }, [value]);
  return (
    <>
      <DateField
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          setObrigatorio(false);
        }}
        onCommit={(iso) => {
          if (!iso) {
            if (v === "" && value) {
              setV(value);
              setObrigatorio(true);
            }
            return;
          }
          if (iso === ultimo.current) return;
          const anterior = ultimo.current;
          ultimo.current = iso;
          onSave(iso, {
            onError: () => {
              ultimo.current = anterior;
            },
          });
        }}
        className="w-36 shrink-0 max-lg:w-40"
        disabled={!podeEditar || disabled}
      />
      {obrigatorio && (
        <span role="alert" className="block text-xs text-destructive">
          Vencimento obrigatório
        </span>
      )}
    </>
  );
}
