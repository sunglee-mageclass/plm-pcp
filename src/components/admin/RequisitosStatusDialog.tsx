import { useState } from "react";
import { ListChecks, ArrowDownToLine } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { MODULOS, CONDICOES } from "@/lib/kanban-condicoes";

/**
 * Botão "Requisitos" por status do kanban → dialog com as condições agrupadas por
 * módulo (checkboxes). O que estiver marcado é REQUISITO DE ENTRADA (todos em E) para
 * um card poder entrar naquele status. Edita `tenant_config.kanban_requisitos[key]`.
 *
 * CASCATA (set/2026): além dos requisitos PRÓPRIOS desta etapa, mostra os HERDADOS das etapas
 * anteriores (na ordem do board) — marcados, com selo "herdado de {etapa}". Desmarcar um herdado
 * NÃO o remove da etapa de origem; registra uma EXCEÇÃO local (com alerta de que fura a
 * progressão). Um requisito próprio marcado que também é herdado conta como próprio.
 */
export function RequisitosStatusButton({
  label,
  requisitos,
  onChange,
  condsIndisponiveis,
  herdados,
  excecoes,
  onExcecoesChange,
  nomeEtapa,
}: {
  label: string;
  requisitos: string[];
  onChange: (next: string[]) => void;
  // Opcional: keys de condições "n/a" para este contexto (ex.: REVENDA_COND_NA no fluxo
  // de Revenda) — ficam esmaecidas, com tag "n/a revenda" e NÃO togglam. Ausente (uso
  // normal do kanban_requisitos) = todas selecionáveis, comportamento intocado.
  condsIndisponiveis?: string[];
  // CASCATA: requisitos herdados das etapas anteriores {key, origem: statusKey da etapa fonte}.
  // Ausente = sem cascata (revenda ou 1ª etapa) → comportamento clássico.
  herdados?: { key: string; origem: string }[];
  // Exceções desta etapa (herdados desligados aqui). Ausente = nenhuma.
  excecoes?: string[];
  onExcecoesChange?: (next: string[]) => void;
  // Resolve o statusKey de origem → nome legível da etapa (p/ o selo "herdado de X").
  nomeEtapa?: (statusKey: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmarExcecao, setConfirmarExcecao] = useState<{ key: string; label: string } | null>(null);
  const set = new Set(requisitos);
  const naSet = new Set(condsIndisponiveis ?? []);
  const herdMap = new Map((herdados ?? []).map((h) => [h.key, h.origem]));
  const excSet = new Set(excecoes ?? []);

  const toggle = (key: string, v: boolean) => {
    if (naSet.has(key)) return; // condição n/a — não togglável
    const n = new Set(requisitos);
    if (v) n.add(key); else n.delete(key);
    onChange(Array.from(n));
  };

  // Herdado: marcado se não estiver na exceção. Desmarcar → confirma exceção (alerta).
  const toggleHerdado = (key: string, v: boolean, cLabel: string) => {
    if (!onExcecoesChange) return;
    if (v) {
      // re-marcar um herdado = remover da exceção
      onExcecoesChange((excecoes ?? []).filter((k) => k !== key));
    } else {
      // desmarcar herdado = pedir confirmação (fura a cascata)
      setConfirmarExcecao({ key, label: cLabel });
    }
  };
  const confirmarDesligarHerdado = () => {
    if (confirmarExcecao && onExcecoesChange) {
      onExcecoesChange([...new Set([...(excecoes ?? []), confirmarExcecao.key])]);
    }
    setConfirmarExcecao(null);
  };

  // total selecionado por módulo (próprios + herdados ativos) — p/ o contador do accordion.
  const contaSel = (keys: string[]) =>
    keys.filter((k) => !naSet.has(k) && ((set.has(k)) || (herdMap.has(k) && !excSet.has(k)))).length;

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 max-md:h-11 max-md:w-11 max-md:p-0">
          <ListChecks className="h-4 w-4 sm:mr-1" />
          <span className="max-sm:sr-only">Requisitos{requisitos.length ? ` (${requisitos.length})` : ""}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Requisitos para entrar em “{label}”</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Um card só entra neste status quando <strong>todas</strong> as condições marcadas
          estiverem satisfeitas.
          {herdMap.size > 0 && (
            <> Os itens <span className="font-medium text-foreground">herdados</span> vêm das etapas
            anteriores (cascata) — desmarcá-los aqui abre uma exceção.</>
          )}
        </p>
        <Accordion type="multiple" className="space-y-1">
          {MODULOS.map((m) => {
            const conds = CONDICOES.filter((c) => c.modulo === m.key);
            if (conds.length === 0) return null;
            const nSel = contaSel(conds.map((c) => c.key));
            return (
              <AccordionItem key={m.key} value={m.key} className="rounded-md border px-3">
                <AccordionTrigger className="py-2 text-sm hover:no-underline">
                  <span className="flex-1 text-left font-medium">{m.label}</span>
                  {nSel > 0 && <span className="mr-2 text-xs font-semibold text-primary">{nSel}</span>}
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-3">
                  {conds.map((c) => {
                    const na = naSet.has(c.key);
                    const origem = herdMap.get(c.key);
                    const ehHerdado = origem != null && !set.has(c.key); // herdado e não próprio
                    const herdadoAtivo = ehHerdado && !excSet.has(c.key);
                    const marcado = na ? false : (set.has(c.key) || herdadoAtivo);
                    return (
                      <label
                        key={c.key}
                        className={
                          "flex items-start gap-2" +
                          (na ? " cursor-not-allowed opacity-50" : " cursor-pointer")
                        }
                      >
                        <Checkbox
                          checked={marcado}
                          disabled={na}
                          onCheckedChange={(v) => (ehHerdado ? toggleHerdado(c.key, !!v, c.label) : toggle(c.key, !!v))}
                          className="mt-0.5"
                        />
                        <span className="text-sm leading-tight">
                          {c.label}
                          {na && (
                            <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground">
                              n/a revenda
                            </span>
                          )}
                          {ehHerdado && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground">
                              <ArrowDownToLine className="h-3 w-3" />
                              herdado{nomeEtapa ? ` de ${nomeEtapa(origem!)}` : ""}
                            </span>
                          )}
                          {ehHerdado && excSet.has(c.key) && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-amber-800">
                              exceção — não exigido aqui
                            </span>
                          )}
                          {c.descricao && <span className="block text-xs text-muted-foreground">{c.descricao}</span>}
                        </span>
                      </label>
                    );
                  })}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
        <div className="flex justify-end">
          <Button type="button" onClick={() => setOpen(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmarExcecao != null} onOpenChange={(o) => { if (!o) setConfirmarExcecao(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Abrir exceção na cascata?</AlertDialogTitle>
          <AlertDialogDescription>
            “{confirmarExcecao?.label}” é herdado de uma etapa anterior. Ao desmarcá-lo aqui, um card
            poderá entrar em “{label}” <strong>sem</strong> cumprir esse requisito — furando a
            progressão do fluxo. A etapa de origem continua exigindo. Confirmar a exceção?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={confirmarDesligarHerdado}>Abrir exceção</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
