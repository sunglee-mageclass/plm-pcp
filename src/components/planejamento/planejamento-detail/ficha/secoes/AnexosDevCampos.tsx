// Ficha de Medida + Observações Gerais (vieram do Desenvolvimento — F3.1), DENTRO da seção Anexos do Planejamento
// (mockup: "Anexos ganha 2 campos do Dev"). Croqui/Desenho/Fotos seguem os campos de sempre do Planejamento
// (espelho — livres, decisão F3 #1); estes dois travam junto com as seções do Dev (fieldset no orquestrador).
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SingleFileField } from "@/components/planejamento/planejamento-detail/campos";

export function AnexosDevCampos({ fichaMedidaUrl, onUploadFicha, onRemoverFicha, observacoesGerais, onObservacoesGerais }: {
  fichaMedidaUrl: string;
  onUploadFicha: (f: File) => void;
  onRemoverFicha: () => void;
  observacoesGerais: string;
  onObservacoesGerais: (v: string) => void;
}) {
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-4">
        <SingleFileField label="Ficha de Medida" path={fichaMedidaUrl} onUpload={onUploadFicha} onRemove={onRemoverFicha} />
      </div>
      <div className="grid gap-1">
        <Label>Observações Gerais</Label>
        <Textarea rows={3} value={observacoesGerais} onChange={(e) => onObservacoesGerais(e.target.value)} data-colab-path="observacoes_gerais" />
      </div>
    </>
  );
}
