import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { semAcento } from "@/lib/busca";
import { ocSearchValue, type OcBuscavel } from "@/lib/plan-tecido/oc-busca";
import { OcHoverInfo } from "@/components/plan-tecido/OcPreview";
import { OcOrigemBadge } from "@/components/plan-tecido/OcOrigemBadge";

/** `owned` = OC comprada pelo Fazer pedido DESTA coleção (plan_tecido_ocs) → selo "comprado"; senão
 *  "existente" (undefined = origem desconhecida → sem selo de OC). */
export type OcComboOption = OcBuscavel & { id: string; is_rolo?: boolean | null; owned?: boolean };

/**
 * Combobox de "Adicionar OC/Rolo" com busca ÚNICA (nº · fornecedor · tecido) — substitui o
 * `<select>` nativo do card (SlotOcHint). Cada opção tem preview no hover (desktop) / ícone ⓘ
 * (mobile) via `OcHoverInfo` (variantes×metragem + anexo, lazy).
 */
export function OcRoloCombobox({
  options, onSelect, disabled, placeholder, emptyMessage,
}: {
  options: OcComboOption[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  placeholder: string;
  emptyMessage: string;
}) {
  const [open, setOpen] = useState(false);
  const semOpcoes = options.length === 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || semOpcoes}
          className="h-8 w-full justify-between px-2 text-xs font-normal text-muted-foreground max-md:h-11"
        >
          <span className="truncate">{semOpcoes ? emptyMessage : placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-[260px] p-0">
        <Command filter={(value, search) => (semAcento(value).includes(semAcento(search)) ? 1 : 0)}>
          <CommandInput placeholder="Buscar por tecido, nº da OC ou fornecedor…" />
          <CommandList>
            <CommandEmpty>Nenhuma OC encontrada.</CommandEmpty>
            <CommandGroup>
              {options.map((oc) => (
                <CommandItem
                  key={oc.id}
                  value={`${ocSearchValue(oc)} ${oc.id}`}
                  onSelect={() => { onSelect(oc.id); setOpen(false); }}
                >
                  <OcHoverInfo ocId={oc.id} owned={oc.owned} isRolo={oc.is_rolo}>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <OcOrigemBadge owned={oc.owned} isRolo={oc.is_rolo} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{oc.numero_pedido || (oc.is_rolo ? "Rolo s/ nº" : "OC s/ nº")}</span>
                        {oc.tecidos.length > 0 && (
                          <span className="block truncate text-[10px] text-muted-foreground">{oc.tecidos.join(" · ")}</span>
                        )}
                      </span>
                    </span>
                  </OcHoverInfo>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
