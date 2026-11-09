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
  /** F2 D — filtro de STATUS dentro do mesmo popover "Filtrar" (antes era um Select solto no toolbar). Omitido = sem seção. */
  status?: "todos" | "sem_reprovado";
  onStatus?: (v: "todos" | "sem_reprovado") => void;
  /** Filtro de LINHA (multi) no mesmo popover. `linhas` = só as linhas com card na vista (+ as já marcadas); `null` no set =
   *  "Sem linha". Omitido = sem seção. */
  linhas?: { id: string; nome: string; n: number }[];
  semLinha?: { n: number } | null;
  filtroLinhas?: Set<string | null>;
  onToggleLinha?: (id: string | null) => void;
  onLimparLinhas?: () => void;
  /** Mostra a seção de famílias (só nos modos em que o filtro de família faz sentido). Padrão true. */
  mostrarCategorias?: boolean;
};

const STATUS_PADRAO = "sem_reprovado";

/**
 * Botão-filtro de categoria de tecido (Popover + checkboxes, multi-seleção) — substitui os
 * chips antigos, que misturavam categorias sem card nenhum (chip-armadilha: clicar dava lista
 * vazia). Só lista categorias que TÊM pelo menos 1 card (`cats` já vem filtrado assim); a
 * categorização em si (Tecido 1) não muda. Mesmo idioma do `AgrupamentoButton`/`RecolherMenu`
 * vizinhos (src/components/shared/filters.tsx, src/components/plan-tecido/RecolherMenu.tsx).
 */
export function CategoriaTecidoFilter({
  cats, catNome, contagem, temSemCategoria, selecionadas, onToggle, onLimpar, status, onStatus, linhas, semLinha, filtroLinhas, onToggleLinha, onLimparLinhas, mostrarCategorias = true,
}: CategoriaTecidoFilterProps) {
  const statusAtivo = status !== undefined && status !== STATUS_PADRAO;
  const nAtivos = (mostrarCategorias ? selecionadas.size : 0) + (statusAtivo ? 1 : 0) + (filtroLinhas?.size ?? 0);
  const secaoLinha = !!linhas && !!filtroLinhas && !!onToggleLinha && (linhas.length > 0 || !!semLinha);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Filter className="h-3.5 w-3.5" />
          Filtrar
          {nAtivos > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
              {nAtivos}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {status !== undefined && onStatus && (
          <div className="mb-1 border-b pb-1" role="radiogroup" aria-label="Filtro de status">
            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">Status</div>
            {([["sem_reprovado", "Todos menos reprovado"], ["todos", "Todos"]] as const).map(([v, rotulo]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent max-md:min-h-11">
                <input type="radio" name="filtro-status" className="accent-primary" checked={status === v} onChange={() => onStatus(v)} />
                <span>{rotulo}</span>
              </label>
            ))}
          </div>
        )}
        {secaoLinha && (
          <div className="mb-1 border-b pb-1" role="group" aria-label="Filtro de linha">
            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">Linha</div>
            {linhas!.map((l) => (
              <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent max-md:min-h-11">
                <Checkbox checked={filtroLinhas!.has(l.id)} onCheckedChange={() => onToggleLinha!(l.id)} />
                <span>{l.nome} ({l.n})</span>
              </label>
            ))}
            {semLinha && (
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent max-md:min-h-11">
                <Checkbox checked={filtroLinhas!.has(null)} onCheckedChange={() => onToggleLinha!(null)} />
                <span>Sem linha ({semLinha.n})</span>
              </label>
            )}
            {filtroLinhas!.size > 0 && onLimparLinhas && (
              <Button type="button" variant="ghost" size="sm" className="mt-1 w-full border-t" onClick={onLimparLinhas}>
                Limpar
              </Button>
            )}
          </div>
        )}
        {mostrarCategorias && cats.map((cid) => (
          <label
            key={cid}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent max-md:min-h-11"
          >
            <Checkbox checked={selecionadas.has(cid)} onCheckedChange={() => onToggle(cid)} />
            <span>{catNome(cid)} ({contagem(cid)})</span>
          </label>
        ))}
        {mostrarCategorias && temSemCategoria && (
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent max-md:min-h-11">
            <Checkbox checked={selecionadas.has(null)} onCheckedChange={() => onToggle(null)} />
            <span>Sem categoria ({contagem(null)})</span>
          </label>
        )}
        {/* "Limpar" ABAIXO da lista (dono set/2026) — no topo ele empurrava as opções e confundia. */}
        {mostrarCategorias && selecionadas.size > 0 && (
          <Button type="button" variant="ghost" size="sm" className="mt-1 w-full border-t" onClick={onLimpar}>
            Limpar
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
