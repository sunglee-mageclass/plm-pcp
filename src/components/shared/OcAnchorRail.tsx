import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// Trilho de âncoras do form de OC (padrão §O — extraído de entrada-saida.oc-tecido.tsx
// pra ser reutilizado por outras telas de OC, ex. OC P. Acabado). Só sm:+; itens travados
// (seções indisponíveis antes de salvar) mostram cadeado e não clicam.
export type SecaoOc = { id: string; n: number; label: string; locked?: boolean };

export function OcAnchorRail({ secoes, ativa, onIr }: { secoes: SecaoOc[]; ativa: string; onIr: (id: string) => void }) {
  return (
    <nav aria-label="Seções da OC" className="hidden w-40 shrink-0 flex-col gap-1 self-start sm:flex">
      {secoes.map((s) =>
        s.locked ? (
          <span
            key={s.id}
            title="Disponível após salvar"
            className="flex cursor-not-allowed select-none items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
          >
            <span className="tabular-nums">{s.n} ·</span> {s.label}
            <Lock className="ml-auto h-3.5 w-3.5" />
          </span>
        ) : (
          <button
            key={s.id}
            type="button"
            onClick={() => onIr(s.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
              ativa === s.id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground",
            )}
          >
            <span className="tabular-nums">{s.n} ·</span> {s.label}
          </button>
        ),
      )}
    </nav>
  );
}
