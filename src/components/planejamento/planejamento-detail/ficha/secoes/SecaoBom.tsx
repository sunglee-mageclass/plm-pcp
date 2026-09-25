// F3.2 — cabeçalho de seção vinda do Desenvolvimento no Sheet do Planejamento (mockup Main/Anotado:
// título + selo à direita; chip "do Desenvolvimento" REMOVIDO 25/set — fusão Planejamento+Dev tornou
// a origem irrelevante). Recolhida por padrão (decisão travada 6). O botão de
// abrir e o selo são IRMÃOS (o selo pode ter o "i" do CondicaoInfo, que é um <button> — botão dentro de
// botão é HTML inválido). `open`/`onOpenChange` opcionais p/ a F3.3 abrir a seção por link.
import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { usePedidoAbertura } from "@/components/planejamento/planejamento-detail/secoes-abertas";

export function SecaoBom({ id, titulo, numero, selo, defaultOpen = false, open: openProp, onOpenChange, oculta = false, children }: {
  id: string;
  titulo: string;
  /** F3.3 — numeração dinâmica "N." (selos-secoes.ts `numerarSecoes`). */
  numero?: number;
  selo?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  /** F3.4 — seção fora do fluxo desta origem (comprado: "Fluxo de Revenda"). Os hooks rodam antes do retorno. */
  oculta?: boolean;
  children: ReactNode;
}) {
  const [openLocal, setOpenLocal] = useState(defaultOpen);
  const open = openProp ?? openLocal;
  const alternar = () => {
    const v = !open;
    if (openProp === undefined) setOpenLocal(v);
    onOpenChange?.(v);
  };
  // F3.3 — link "Para enviar, falta…" pede esta seção: abre e rola até ela.
  const ref = useRef<HTMLElement>(null);
  usePedidoAbertura(id, () => {
    if (openProp === undefined) setOpenLocal(true);
    onOpenChange?.(true);
  }, ref);
  // F3.4 — depois dos hooks (regra dos hooks): a seção some sem mudar a ordem deles.
  if (oculta) return null;
  return (
    <section ref={ref} className="space-y-3" data-secao={id}>
      <div className="flex items-center gap-2 border-b pb-1.5">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold text-foreground"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{numero ? `${numero}. ` : ""}{titulo}</span>
        </button>
        {/* Lote B (revisão do commit 6fac668, minor) — `min-w-0` + `truncate` (não `shrink-0`, que IMPEDE encolher):
            selos com texto longo (ex.: resumo da Coleção, "Verão 2027 · Casual · lanç. 2 · mar/2027") estouravam a
            largura em telas estreitas (360px); o `title` do StatusBadge (dentro de `selo`) já traz o texto completo.
            Fix pós-T9 (item 3) — o `truncate` saiu deste wrapper (o corte de verdade agora é NO TEXTO, dentro do
            `SeloBadge`); aqui fica só `max-w-[60%]` — teto que garante que o TÍTULO da seção (`flex-1` à esquerda)
            nunca vai a 0px de largura mesmo com o selo pedindo mais espaço do que cabe. */}
        {selo && <span className="ml-auto inline-flex min-w-0 max-w-[60%] items-center gap-1">{selo}</span>}
      </div>
      {open && children}
    </section>
  );
}
