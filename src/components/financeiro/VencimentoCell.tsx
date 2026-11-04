import { useEffect, useRef, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { DateField } from "@/components/shared/DateField";
import { Button } from "@/components/ui/button";

/**
 * Célula de vencimento como RASCUNHO por linha (camada intermediária): editar o campo (digitar,
 * Enter, blur ou escolher no calendário) NUNCA grava — só mexe no estado local `v`. Quando `v` difere
 * do `value` (o salvo) aparecem ✓ Salvar e ↺ Desfazer na própria célula e o campo ganha borda âmbar
 * (selo "não salvo"). ✓ chama `onSave` (a mutation do chamador); ↺ volta ao `value`. Sem diferença os
 * ícones somem. Quem não pode editar (`podeEditar=false`/`disabled`) não vê ✓/↺.
 *
 * Sincronia com o servidor: se `value` muda de fora (salvou, refetch, outro usuário) e a pessoa NÃO tem
 * rascunho, o campo acompanha; com rascunho em curso o rascunho é preservado (↺ passa a voltar ao novo
 * salvo). Se `value` passa a ser igual ao rascunho (gravou), o rascunho se resolve sozinho. No erro do
 * `onSave` o rascunho fica (✓ liberado para tentar de novo). Vencimento é obrigatório: limpar e sair
 * volta à data guardada com aviso.
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
  const [salvando, setSalvando] = useState(false);
  const salvandoRef = useRef(false); // anti-duplo-commit: clique duplo no ✓ antes de o re-render desabilitar
  const valorAnterior = useRef(value);
  useEffect(() => {
    const anterior = valorAnterior.current;
    valorAnterior.current = value;
    // sem rascunho (v == antigo salvo) ou rascunho que virou o salvo → acompanha; senão preserva o rascunho.
    setV((cur) => (cur === anterior || cur === value ? value : cur));
    salvandoRef.current = false;
    setSalvando(false);
  }, [value]);

  const editavel = podeEditar && !disabled;
  const sujo = editavel && v !== "" && v !== value;

  const salvar = () => {
    if (!sujo || salvandoRef.current) return;
    const iso = v;
    salvandoRef.current = true;
    setSalvando(true);
    onSave(iso, {
      onError: () => {
        salvandoRef.current = false;
        setSalvando(false);
      },
    });
  };
  const desfazer = () => {
    setV(value);
    setObrigatorio(false);
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <DateField
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            setObrigatorio(false);
          }}
          onCommit={(iso) => {
            // Confirmar NÃO grava. Só o vencimento obrigatório: limpar e sair volta ao salvo.
            if (!iso && value) {
              setV(value);
              setObrigatorio(true);
            }
          }}
          className="w-36 shrink-0 max-lg:w-40"
          inputClassName={sujo ? "border-warning ring-1 ring-warning" : undefined}
          disabled={!editavel}
        />
        {sujo && (
          <span className="inline-flex shrink-0 items-center gap-0.5" data-testid="venc-rascunho">
            <Button
              type="button"
              size="iconSm"
              variant="ghost"
              aria-label="Salvar vencimento"
              title="Salvar vencimento"
              data-testid="venc-salvar"
              disabled={salvando}
              onClick={salvar}
            >
              <Check className="h-4 w-4 text-success" aria-hidden />
            </Button>
            <Button
              type="button"
              size="iconSm"
              variant="ghost"
              aria-label="Desfazer alteração do vencimento"
              title="Desfazer"
              data-testid="venc-desfazer"
              disabled={salvando}
              onClick={desfazer}
            >
              <Undo2 className="h-4 w-4" aria-hidden />
            </Button>
          </span>
        )}
      </div>
      {obrigatorio && (
        <span role="alert" className="block text-xs text-destructive">
          Vencimento obrigatório
        </span>
      )}
    </>
  );
}
