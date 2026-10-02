import { ArrowLeft, Loader2, Save, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { KanbanStatus } from "@/lib/kanban-status";
import { labelDaColuna } from "@/lib/kanban-auto-ui";
import { tituloRefsReveladas, type PreviaRefRevelar } from "@/lib/ref-revelar";

const RODAPE =
  "border-t bg-background -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3 flex-row flex-wrap items-center gap-2";

/**
 * Leves L3 kanban #21 (P-211 A): prévia do Salvar da Config da Loja quando a etapa de revelar a REF muda — "N REFs serão
 * reveladas (não voltam)". Mesmo padrão do `KanbanSalvarDialog` (prévia só leitura → confirmar → o Salvar grava e revela na
 * mesma transação). A prévia vem de `ref_previa_revelar` (nada grava); a revelação de verdade é do `salvar_config_loja`.
 */
export function RefRevelarDialog({
  previa,
  cols,
  salvando,
  onConfirmar,
  onClose,
}: {
  previa: PreviaRefRevelar;
  /** Board da tela (rótulo da etapa e do status de cada card). */
  cols: KanbanStatus[];
  salvando: boolean;
  onConfirmar: () => void;
  onClose: () => void;
}) {
  const resto = Math.max(0, previa.total - previa.amostra.length);
  const etapa = labelDaColuna(previa.etapa, cols);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !salvando) onClose();
      }}
    >
      <DialogContent fixedFooter mobileFull className="max-w-2xl" data-testid="ref-revelar-dialogo">
        <DialogHeader>
          <DialogTitle>{`${tituloRefsReveladas(previa.total)} (não voltam)`}</DialogTitle>
          <DialogDescription>
            Com a REF revelada a partir da etapa “{etapa}”, estes cards já estão nela (ou depois) e
            passam a mostrar a REF assim que você salvar. A REF revelada não volta a ficar escondida
            — nem se a etapa mudar de novo.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div
            className="space-y-1 rounded-md border px-3 py-2 text-sm"
            data-testid="ref-revelar-lista"
          >
            <p className="flex items-center gap-1.5 font-medium">
              <Tag className="h-4 w-4" />
              {tituloRefsReveladas(previa.total)}
            </p>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs">
              {previa.amostra.map((c) => (
                <li key={c.modelo_id}>
                  {c.nome ?? "Sem nome"}{" "}
                  <span className="font-mono text-muted-foreground">{c.ref_auto}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    — etapa {labelDaColuna(c.status, cols)}
                  </span>
                </li>
              ))}
            </ul>
            {resto > 0 && <p className="text-xs text-muted-foreground">e mais {resto}.</p>}
            {previa.travadas_integracao > 0 && (
              <p
                className="text-xs text-[var(--tone-warning-fg)]"
                data-testid="ref-revelar-travadas"
              >
                {previa.travadas_integracao === 1
                  ? "1 card travado pela Integração (REF/SKU marcado) continua com a REF escondida."
                  : `${previa.travadas_integracao} cards travados pela Integração (REF/SKU marcado) continuam com a REF escondida.`}
              </p>
            )}
          </div>
        </DialogBody>
        <DialogFooter className={RODAPE}>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Voltar
          </Button>
          <Button className="ml-auto" onClick={onConfirmar} disabled={salvando}>
            {salvando ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            {previa.total === 1
              ? "Salvar e revelar 1 REF"
              : `Salvar e revelar ${previa.total} REFs`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
