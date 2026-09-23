// Motivo do Cancelamento (veio do Dev — `modelos.motivo_cancelamento`). No TOPO do Sheet (Anotado/Prova do
// mockup: "Topo · aparece quando a etapa é Reprovado"), SÓ com a etapa do kanban em Reprovado. Sair de
// Reprovado NÃO apaga o texto (dono, 23/set): ele fica guardado e só some da tela. A trava/permissão é o
// <fieldset> em volta, no orquestrador.
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function MotivoCancelamento({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div data-testid="motivo-cancelamento" className="mt-2 grid gap-1 rounded-md border border-dashed p-2">
      <Label>Motivo do Cancelamento</Label>
      <Textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} data-colab-path="motivo_cancelamento" />
    </div>
  );
}
