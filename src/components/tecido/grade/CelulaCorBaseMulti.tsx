// Multi-seleção de cores na célula "Cor base" da linha-PAI da grade "Lista tipo Excel" de Cadastro > Tecidos.
// Marcar cores NOVAS e confirmar CRIA as linhas-filhas (uma cor cada, com o preço herdado do pai) — só ADICIONA: as cores que o tecido
// já tem aparecem marcadas e travadas (não duplica) e desmarcar nunca remove nada (remover é pelo botão de excluir). O Select de 1 cor
// do pai continua ao lado (`children`): trocar a cor do próprio pai segue como antes. Só DESENHA: quem cria as linhas é o `onAdicionar`.
import { useState, type ReactNode } from "react";
import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { OpcaoSelect } from "@/lib/tecido-grade/celulas";

export function CelulaCorBaseMulti({ cores, presentes, onAdicionar, ariaLabel, desabilitado = false, children }: {
  /** Cores base cadastradas (`opcoes.cores`). */
  cores: OpcaoSelect[];
  /** Cores que o tecido JÁ tem (existentes + novas no rascunho): marcadas e travadas. */
  presentes: readonly string[];
  /** Recebe só as cores NOVAS marcadas (as já presentes nunca voltam). */
  onAdicionar: (corIds: string[]) => void;
  ariaLabel: string;
  desabilitado?: boolean;
  /** O Select de 1 cor do pai. */
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const jaTem = new Set(presentes);
  const visiveis = cores.filter((c) => c.nome.toLowerCase().includes(busca.trim().toLowerCase()));

  const mudarAberto = (o: boolean) => {
    setAberto(o);
    if (!o) {
      setMarcadas([]);
      setBusca("");
    }
  };
  const alternar = (id: string) => setMarcadas((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const confirmar = () => {
    if (marcadas.length === 0) return;
    onAdicionar(marcadas);
    mudarAberto(false);
  };

  return (
    <div className="flex items-center gap-1" data-cor-multi>
      {children}
      <Popover open={aberto} onOpenChange={mudarAberto}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={desabilitado}
            aria-label={ariaLabel}
            title="Adicionar várias cores de uma vez"
            data-controle="cor-multi"
            className="h-8 w-8 shrink-0"
          >
            <ListPlus className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <p className="px-2 pb-1 text-xs text-muted-foreground">
            Marque as cores a adicionar: cada uma vira uma linha nova (com o preço do tecido). Desmarcar não remove.
          </p>
          <Input
            aria-label="Buscar cor"
            placeholder="Buscar cor…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="mb-1 h-8"
          />
          <div className="max-h-56 space-y-1 overflow-y-auto overscroll-contain" data-lista-cores>
            {cores.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground">Nenhuma cor cadastrada.</div>
            ) : visiveis.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground">Nenhuma cor encontrada.</div>
            ) : (
              visiveis.map((c) => {
                const existente = jaTem.has(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted aria-disabled:cursor-default aria-disabled:opacity-60"
                    aria-disabled={existente || undefined}
                    title={existente ? "Este tecido já tem esta cor" : undefined}
                  >
                    <Checkbox
                      checked={existente || marcadas.includes(c.id)}
                      disabled={existente}
                      onCheckedChange={() => alternar(c.id)}
                      aria-label={`Cor ${c.nome}`}
                      data-cor-id={c.id}
                    />
                    <span className="text-sm">{c.nome}</span>
                    {existente && <span className="ml-auto text-xs text-muted-foreground">já tem</span>}
                  </label>
                );
              })
            )}
          </div>
          <div className="mt-2 flex justify-end border-t pt-2">
            <Button type="button" size="sm" disabled={marcadas.length === 0} onClick={confirmar}>
              {marcadas.length === 0 ? "Adicionar cores" : `Adicionar ${marcadas.length} ${marcadas.length === 1 ? "cor" : "cores"}`}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
