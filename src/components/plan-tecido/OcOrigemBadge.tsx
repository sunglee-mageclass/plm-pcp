import { cn } from "@/lib/utils";

/**
 * Selo de ORIGEM de uma opção OC/Rolo nos seletores do Plan. Tecido (decisão do dono 17/ago/2026,
 * junto da aposentadoria do flag "usar estoque existente"; rótulos revistos 17/ago/2026).
 * Três classes, tokens §Q (sem cor solta):
 *  - Rolo   → estoque físico por rolo (mantém o selo "Rolo" de sempre): primary-tint, CAIXA ALTA.
 *  - comprado → OC COMPRADA pela tela/"Fazer pedido" DESTA coleção e vinculada (existe linha em
 *               plan_tecido_ocs ligando OC→coleção): primary-tint (é "nossa", o plano a comprou).
 *  - existente → OC que JÁ existia (avulsa ou de outra coleção), vinculada só p/ acompanhamento:
 *               tom azul/informativo (sky), distinto do primary.
 * `isRolo` vence `owned` (um rolo nunca é "comprado" — rolo não sai do Fazer pedido). `owned`
 * undefined = origem desconhecida (ex.: contexto sem a coleção) → não renderiza selo de OC.
 */
export function OcOrigemBadge({
  owned,
  isRolo,
  className,
}: {
  owned?: boolean;
  isRolo?: boolean | null;
  className?: string;
}) {
  const base = "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold";
  if (isRolo)
    return (
      <span
        className={cn(base, "bg-primary/10 uppercase tracking-wide text-primary", className)}
        title="Rolo — estoque físico (abate o 'a comprar' pelo saldo não separado)"
      >
        Rolo
      </span>
    );
  if (owned === undefined) return null;
  return owned ? (
    <span
      className={cn(base, "bg-primary/10 text-primary", className)}
      title="OC comprada pela tela / Fazer pedido desta coleção e vinculada"
    >
      comprado
    </span>
  ) : (
    <span
      className={cn(base, "bg-sky-100 font-medium text-sky-700", className)}
      title="OC que já existia (avulsa ou de outra coleção) — vinculada só para acompanhamento"
    >
      existente
    </span>
  );
}
