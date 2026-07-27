import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Campo de observação livre sobre mão de obra do modelo (`modelos.observacoes_mao_obra`).
 * Reutilizado no Planejamento (dentro de uma Seção própria, sem `label`) e no
 * Desenvolvimento, seção "8. Custos" (com `label`). Só UI — grava pelo UPDATE/INSERT
 * de `modelos` que já existe nesses fluxos.
 */
export function ObsMaoObraField({
  value,
  onChange,
  label,
  id = "obs-mao-obra",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  id?: string;
}) {
  return (
    <div className="grid gap-1">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Observações sobre a mão de obra deste modelo…"
        rows={3}
      />
    </div>
  );
}
