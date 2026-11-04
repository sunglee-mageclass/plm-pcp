import { useEffect, useRef, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { Button } from "@/components/ui/button";

/** Preço salvo -> texto canônico do rascunho ("298.5"); sem preço (null/0) = "". */
const semente = (p: number | null | undefined) => (p != null && p > 0 ? String(p) : "");

/** Preço salvo normalizado: 0/negativo/nulo = sem preço (null), igual ao que o rascunho vazio representa. */
const salvoN = (p: number | null | undefined): number | null => (p != null && p > 0 ? p : null);

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
  // Último ✓ disparado (e ainda sem edição depois): `de` = salvo no momento do clique.
  const tentativaRef = useRef<{ de: number | null; em: number } | null>(null);
  useEffect(() => {
    const anterior = salvoAnterior.current;
    salvoAnterior.current = precoVenda;
    if (anterior === precoVenda) return;
    const t = tentativaRef.current;
    if (t && Date.now() - t.em < 60_000 && salvoN(precoVenda) !== t.de) {
      // O salvo mudou logo depois do MEU ✓ e eu não editei mais: foi o meu save (talvez com preço derivado
      // diferente do que mandei) -> adota o que o servidor devolveu.
      tentativaRef.current = null;
      setDraft(semente(precoVenda));
      return;
    }
    // sem rascunho (campo == antigo salvo) ou rascunho que virou o salvo -> acompanha; senão preserva.
    setDraft((cur) => {
      const curN = precoDoRascunho(cur);
      return curN === salvoN(anterior) || curN === salvoN(precoVenda) ? semente(precoVenda) : cur;
    });
  }, [precoVenda]);

  const sujo = precoDoRascunho(draft) !== salvoN(precoVenda);
  const salvar = () => {
    if (!sujo) return;
    tentativaRef.current = { de: salvoN(precoVenda), em: Date.now() };
    onSave(precoDoRascunho(draft));
  };
  const desfazer = () => {
    tentativaRef.current = null;
    setDraft(semente(precoVenda));
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <MoneyInput
        value={draft}
        fixedDecimals
        placeholder={placeholder}
        data-colab-path={colabPath}
        onChange={(e) => {
          tentativaRef.current = null; // editou depois do ✓: o rascunho em voo não pode ser sobrescrito
          setDraft(e.target.value);
        }}
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
