// Célula de campo de CADASTRO na tabela de importação: dropdown com busca + sugestão fuzzy no
// topo (quando o valor digitado não casou) + opção "＋ Cadastrar novo". Verde/neutro quando
// resolvido; VERMELHO quando pendente (não casou). Usado p/ fornecedor, cor, categoria, mês, ano…

import { useMemo, useState } from "react";
import { ChevronsUpDown, Check, Plus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { sugestoes } from "@/lib/import/fuzzy";
import { normalizeCat } from "@/lib/fornecedor-categoria";

export type OpcaoLookup = { id: string; nome: string };

type Props = {
  /** id selecionado (ou null se não resolvido). */
  value: string | null;
  /** texto DIGITADO na planilha (p/ mostrar "digitado: X" e alimentar o fuzzy quando não casou). */
  digitado?: string;
  opcoes: OpcaoLookup[];
  onChange: (id: string | null) => void;
  /** oferece cadastrar o texto digitado como novo registro (fornecedor/cor…). */
  onCadastrarNovo?: (nome: string) => void;
  /** campo OBRIGATÓRIO (ex.: cor base): vazio = pendência (vermelho). Opcional (fornecedor/mês/
   *  ano): vazio = "— nenhum" (neutro), só fica vermelho se DIGITOU algo que não casou. */
  obrigatorio?: boolean;
  placeholder?: string;
  className?: string;
};

export function CelulaLookup({ value, digitado, opcoes, onChange, onCadastrarNovo, obrigatorio, placeholder = "Selecionar…", className }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(""); // busca digitada no popover (filtramos manualmente, shouldFilter=false)
  const selecionado = useMemo(() => opcoes.find((o) => o.id === value) ?? null, [opcoes, value]);
  const temTextoNaoCasado = value == null && !!digitado?.trim();
  // PENDENTE (vermelho) só quando: obrigatório sem valor, OU digitou algo que não casou.
  // Opcional vazio (sem digitar) = neutro "— nenhum", não é pendência.
  const pendente = temTextoNaoCasado || (!!obrigatorio && value == null);
  const vazioOpcional = value == null && !digitado?.trim() && !obrigatorio;
  // sugestões fuzzy do que foi digitado (só quando há texto não-casado).
  const sugeridos = useMemo(
    () => (temTextoNaoCasado && digitado ? sugestoes(digitado, opcoes, (o) => o.nome, 4, 0.4) : []),
    [temTextoNaoCasado, digitado, opcoes],
  );
  const melhor = sugeridos[0]?.item ?? null;
  // lista "Todos" filtrada pela busca do popover (substring sem acento).
  const filtradas = useMemo(() => {
    const t = normalizeCat(q);
    return t ? opcoes.filter((o) => normalizeCat(o.nome).includes(t)) : opcoes;
  }, [opcoes, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-8 min-w-[110px] justify-between gap-1 px-2 text-xs font-normal",
            pendente && "border-destructive bg-destructive/5 text-destructive hover:bg-destructive/10",
            className,
          )}
        >
          {pendente ? (
            <span className="flex items-center gap-1 truncate">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {melhor ? <span className="text-primary font-medium truncate">{melhor.nome}?</span> : <span className="truncate">Corrigir…</span>}
            </span>
          ) : selecionado ? (
            <span className="truncate">{selecionado.nome}</span>
          ) : (
            <span className="truncate text-muted-foreground">{vazioOpcional ? "— nenhum" : placeholder}</span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {/* shouldFilter=false: nós já ranqueamos via `sugestoes`; o filtro do cmdk esconderia a
            sugestão fuzzy e o "Cadastrar" para erros de digitação distantes (achado da revisão). */}
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar…" className="h-9" value={q} onValueChange={setQ} />
          <CommandList>
            {digitado && pendente && (
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground border-b">
                Digitado na planilha: <span className="font-medium text-destructive">“{digitado}”</span>
              </div>
            )}
            <CommandEmpty>
              {onCadastrarNovo && digitado ? (
                <button
                  className="flex w-full items-center gap-2 px-2 py-2 text-sm text-primary hover:bg-accent"
                  onClick={() => { onCadastrarNovo(digitado); setOpen(false); }}
                >
                  <Plus className="h-4 w-4" /> Cadastrar “{digitado}”
                </button>
              ) : (
                <span className="px-2 py-3 text-sm text-muted-foreground">Nada encontrado.</span>
              )}
            </CommandEmpty>
            {sugeridos.length > 0 && (
              <CommandGroup heading="Você quis dizer">
                {sugeridos.map((s) => (
                  <CommandItem key={s.item.id} value={s.item.nome} onSelect={() => { onChange(s.item.id); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === s.item.id ? "opacity-100" : "opacity-0")} />
                    {s.item.nome}
                    <span className="ml-auto text-[10px] text-muted-foreground">{Math.round(s.score * 100)}%</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={sugeridos.length > 0 ? "Todos" : undefined}>
              {filtradas.map((o) => (
                <CommandItem key={o.id} value={o.nome} onSelect={() => { onChange(o.id); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === o.id ? "opacity-100" : "opacity-0")} />
                  {o.nome}
                </CommandItem>
              ))}
            </CommandGroup>
            {onCadastrarNovo && digitado && pendente && (
              <div className="border-t p-1">
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-primary hover:bg-accent"
                  onClick={() => { onCadastrarNovo(digitado); setOpen(false); }}
                >
                  <Plus className="h-4 w-4" /> Cadastrar “{digitado}”
                </button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
