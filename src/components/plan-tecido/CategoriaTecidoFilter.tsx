import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type CategoriaTecidoFilterProps = {
  /** Categorias das lanes DO CANVAS (categorias com card ∪ famílias declaradas via "+ Família",
   *  mesmo vazias) — espelha o que o canvas mostra. Categorias nunca usadas na sub não entram. */
  cats: string[];
  catNome: (id: string) => string;
  /** Contagem de slots de uma categoria (ou de "sem categoria" com `null`). */
  contagem: (id: string | null) => number;
  /** Se algum slot está sem categoria — só aí a opção "Sem categoria" aparece. */
  temSemCategoria: boolean;
  selecionadas: Set<string | null>;
  onToggle: (id: string | null) => void;
  onLimpar: () => void;
};

/**
 * Botão-filtro de categoria de tecido (Popover + checkboxes, multi-seleção) — substitui os
 * chips antigos, que misturavam categorias sem card nenhum (chip-armadilha: clicar dava lista
 * vazia). Só lista categorias que TÊM pelo menos 1 card (`cats` já vem filtrado assim); a
 * categorização em si (Tecido 1) não muda. Mesmo idioma do `AgrupamentoButton`/`RecolherMenu`
 * vizinhos (src/components/shared/filters.tsx, src/components/plan-tecido/RecolherMenu.tsx).
 */
export function CategoriaTecidoFilter({
  cats, catNome, contagem, temSemCategoria, selecionadas, onToggle, onLimpar,
}: CategoriaTecidoFilterProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Filter className="h-3.5 w-3.5" />
          Filtrar
          {selecionadas.size > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
              {selecionadas.size}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {selecionadas.size > 0 && (
          <Button type="button" variant="ghost" size="sm" className="mb-1 w-full" onClick={onLimpar}>
            Limpar
          </Button>
        )}
        {cats.map((cid) => (
          <label
            key={cid}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent max-md:min-h-11"
          >
            <Checkbox checked={selecionadas.has(cid)} onCheckedChange={() => onToggle(cid)} />
            <span>{catNome(cid)} ({contagem(cid)})</span>
          </label>
        ))}
        {temSemCategoria && (
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent max-md:min-h-11">
            <Checkbox checked={selecionadas.has(null)} onCheckedChange={() => onToggle(null)} />
            <span>Sem categoria ({contagem(null)})</span>
          </label>
        )}
      </PopoverContent>
    </Popover>
  );
}
