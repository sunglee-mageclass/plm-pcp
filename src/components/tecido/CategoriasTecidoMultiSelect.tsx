import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Opcao = { id: string; nome: string };

/**
 * Lista de checkboxes das categorias de tecido (o miolo do popover). Extraída do Sheet do tecido
 * (`cadastro.tecidos.$artigoId`) para a grade reusar DENTRO do popover da própria célula (um popover só, sem aninhar).
 */
export function CategoriasTecidoLista({
  options,
  value,
  onChange,
}: {
  options: Opcao[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };
  return (
    <div className="max-h-64 overflow-y-auto space-y-1">
      {options.length === 0 ? (
        <div className="text-sm text-muted-foreground p-2">Nenhuma categoria cadastrada.</div>
      ) : (
        options.map((o) => (
          <label
            key={o.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
          >
            <Checkbox
              checked={value.includes(o.id)}
              onCheckedChange={() => toggle(o.id)}
            />
            <span className="text-sm">{o.nome}</span>
          </label>
        ))
      )}
    </div>
  );
}

/** Seletor de categorias do tecido (botão + popover com a lista). Usado no Sheet do tecido. */
export function CategoriasTecidoMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Selecione categorias…",
}: {
  options: Opcao[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabels = options.filter((o) => value.includes(o.id)).map((o) => o.nome);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          <span className="truncate text-left">
            {selectedLabels.length === 0
              ? placeholder
              : selectedLabels.length <= 2
                ? selectedLabels.join(", ")
                : `${selectedLabels.length} categorias`}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <CategoriasTecidoLista options={options} value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
