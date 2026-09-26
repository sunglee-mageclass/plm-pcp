// F3.3 — menu ⋯ do rodapé do Sheet do Planejamento (mockup gen_main.py:108-116; ui-padroes §L "ações de ciclo na tela
// + ⋯ no card"): Duplicar · Importar dados · Ficha Técnica ("após Enviar") · ── · Cancelar Ordem de Criação. Mesmo
// Popover do precedente ProdutoCard.tsx:505-560. Item sem handler: Importar/Cancelar somem; Ficha Técnica fica
// desabilitada com a dica.
import { Copy, Download, MoreHorizontal, Printer, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ITEM = "flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

export function MenuMaisAcoes({ className, onDuplicar, duplicando, duplicandoTitle, onImportar, onFichaTecnica, onCancelarOrdem, cancelandoOrdem }: {
  className?: string;
  /** P-53 A (fix 1, m-5) — ausente = sem permissão de ações do Planejamento: o item SOME (como
   *  Importar/Cancelar), em vez de ficar preso em "carregando…" pra sempre. */
  onDuplicar?: () => void;
  duplicando: boolean;
  /**
   * Fix T9 I1 — dica quando `duplicando` vem `true` SÓ por "Carregando a ficha…" (round 4 da F3.2, item 7,
   * 67e363f ~:1387-1388: a `mutationFn` do Duplicar lê `fichaRef.current.carregado`/`.estado.blocks` — clicar
   * ANTES de carregar caía no fallback `tecidos_planejados.slice(0,3)` em vez dos artigos reais do BOM).
   * `undefined` = desabilitado por estar realmente em voo (`duplicate.isPending`, sem dica extra).
   */
  duplicandoTitle?: string;
  /** Ausente = ficha não editável (o item some — Dev :2732-2736 só com o card editável). */
  onImportar?: () => void;
  /** Ausente = ainda não enviado à Explosão (item desabilitado — "após Enviar"). */
  onFichaTecnica?: () => void;
  /** Ausente = Ordem de Criação ainda não enviada (o item some). */
  onCancelarOrdem?: () => void;
  cancelandoOrdem?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label="Mais ações" title="Mais ações" className={`shrink-0 max-sm:aspect-square max-sm:px-0 ${className ?? ""}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-60 p-1">
        {onDuplicar && (
          <PopoverClose asChild>
            <button
              type="button"
              className={ITEM}
              onClick={onDuplicar}
              disabled={duplicando}
              title={duplicando ? duplicandoTitle : undefined}
            >
              <Copy className="h-4 w-4 shrink-0" /> Duplicar
              {duplicando && duplicandoTitle && <span className="ml-auto text-xs text-muted-foreground">carregando…</span>}
            </button>
          </PopoverClose>
        )}
        {onImportar && (
          <PopoverClose asChild>
            <button type="button" className={ITEM} onClick={onImportar}>
              <Download className="h-4 w-4 shrink-0" /> Importar dados
            </button>
          </PopoverClose>
        )}
        <PopoverClose asChild>
          <button
            type="button"
            className={ITEM}
            onClick={onFichaTecnica}
            disabled={!onFichaTecnica}
            title={onFichaTecnica ? undefined : "Disponível após Enviar à Explosão"}
          >
            <Printer className="h-4 w-4 shrink-0" /> Ficha Técnica
            {!onFichaTecnica && <span className="ml-auto text-xs text-muted-foreground">após Enviar</span>}
          </button>
        </PopoverClose>
        {onCancelarOrdem && (
          <>
            <div className="my-1 border-t" />
            {/* NEUTRO como os demais itens — o mockup aprovado o pinta com `color: var(--fg)` (gen_main.py:115); ruling R7
                do G-plano F3.3: seguir o mockup (vermelho fica só no Excluir do rodapé). */}
            <PopoverClose asChild>
              <button type="button" className={ITEM} onClick={onCancelarOrdem} disabled={cancelandoOrdem}>
                <Undo2 className="h-4 w-4 shrink-0" /> Cancelar Ordem de Criação
              </button>
            </PopoverClose>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
