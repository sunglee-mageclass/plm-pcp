import { useEffect, useRef, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { Button } from "@/components/ui/button";

/** Preço salvo -> texto canônico do rascunho ("298.5"); sem preço (null/0) = "". */
const semente = (p: number | null | undefined) => (p != null && p > 0 ? String(p) : "");

/**
 * Preço canônico do rascunho. O `MoneyInput` emite o valor CANÔNICO (ponto decimal, "1234.5"), então
 * `Number()` aqui é seguro — NUNCA aplicar `Number()` ao texto mascarado ("1.234,50" viraria NaN).
 * Vazio/zero/NaN = sem preço (null).
 */
export const precoDoRascunho = (draft: string): number | null => {
  const n = Number(draft);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Preço de venda do card do Planejamento como RASCUNHO (camada intermediária): digitar, Enter ou sair do
 * campo NUNCA grava — só mexe no estado local. Quando o rascunho difere do preço salvo (`precoVenda`)
 * aparecem ✓ Salvar e ↺ Desfazer ao lado do campo e o campo ganha borda âmbar (selo "não salvo"). ✓ chama
 * `onSave` (o `onPrecoVenda` do mount, que decide a mutation por origem: interno / revenda / importado);
 * ↺ volta ao salvo. Sem diferença os ícones somem. Sem `podeEditar` (permissão ou trava da Integração)
 * este componente não deve ser usado — o chamador mostra o valor só leitura.
 *
 * Sincronia com o servidor: se `precoVenda` muda de fora (salvou, refetch, outro usuário) e NÃO há rascunho
 * em curso, o campo acompanha; com rascunho o rascunho é preservado (↺ volta ao novo salvo). O rascunho é
 * local ao card: some ao desmontar (sair da página / trocar de filtro). Isso é aceito de propósito — a grade
 * não tem rascunho de página; o selo âmbar mostra o que está pendente.
 */
export function PrecoVendaCell({
  precoVenda,
  placeholder,
  colabPath,
  onSave,
}: {
  precoVenda: number | null;
  placeholder: string;
  colabPath?: string;
  onSave: (preco: number | null) => void;
}) {
  const [draft, setDraft] = useState<string>(semente(precoVenda));
  const salvoAnterior = useRef(precoVenda);
  useEffect(() => {
    const anterior = salvoAnterior.current;
    salvoAnterior.current = precoVenda;
    if (anterior === precoVenda) return;
    // sem rascunho (campo == antigo salvo) ou rascunho que virou o salvo -> acompanha; senão preserva.
    setDraft((cur) => {
      const curN = precoDoRascunho(cur);
      return curN === (anterior ?? null) || curN === (precoVenda ?? null) ? semente(precoVenda) : cur;
    });
  }, [precoVenda]);

  const sujo = precoDoRascunho(draft) !== (precoVenda ?? null);
  const salvar = () => {
    if (!sujo) return;
    onSave(precoDoRascunho(draft));
  };
  const desfazer = () => setDraft(semente(precoVenda));

  return (
    <div className="flex items-center justify-end gap-1">
      <MoneyInput
        value={draft}
        fixedDecimals
        placeholder={placeholder}
        data-colab-path={colabPath}
        onChange={(e) => setDraft(e.target.value)}
        // Enter NÃO grava (nada grava antes do ✓); só evita submit de formulário ao redor.
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
        className={`h-7 w-full min-w-0 max-w-[7.5rem] text-right text-xs tabular-nums ${sujo ? "border-warning ring-1 ring-warning" : ""}`}
      />
      {sujo && (
        <span className="inline-flex shrink-0 items-center gap-0.5" data-testid="preco-rascunho">
          <Button type="button" size="iconSm" variant="ghost" title="Confirmar preço" aria-label="Confirmar preço"
            data-testid="preco-salvar" onClick={salvar}>
            <Check className="h-3.5 w-3.5 text-success" aria-hidden />
          </Button>
          <Button type="button" size="iconSm" variant="ghost" title="Desfazer" aria-label="Desfazer alteração do preço"
            data-testid="preco-desfazer" onClick={desfazer}>
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </span>
      )}
    </div>
  );
}
