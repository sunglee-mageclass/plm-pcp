// F3.2 — cabeçalho de seção vinda do Desenvolvimento no Sheet do Planejamento (mockup Main/Anotado:
// título + chip "do Desenvolvimento" + selo à direita). Recolhida por padrão (decisão travada 6). O botão de
// abrir e o selo são IRMÃOS (o selo pode ter o "i" do CondicaoInfo, que é um <button> — botão dentro de
// botão é HTML inválido). `open`/`onOpenChange` opcionais p/ a F3.3 abrir a seção por link.
import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { usePedidoAbertura } from "@/components/planejamento/planejamento-detail/secoes-abertas";

export function SecaoBom({ id, titulo, numero, selo, origemDev = true, defaultOpen = false, open: openProp, onOpenChange, children }: {
  id: string;
  titulo: string;
  /** F3.3 — numeração dinâmica "N." (selos-secoes.ts `numerarSecoes`). */
  numero?: number;
  selo?: ReactNode;
  origemDev?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
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
          {origemDev && (
            <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground max-sm:hidden">do Desenvolvimento</span>
          )}
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
