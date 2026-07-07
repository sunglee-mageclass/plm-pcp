import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Sentinela do item "Direto na empresa" — grava representante_id = null.
const DIRETO = "__direto__";

export type RepresentanteRef = { id: string; nome: string | null };
export type EmpresaComRepresentantes = {
  id: string;
  representantes?: RepresentanteRef[] | null;
};

/**
 * Select opcional de Representante da empresa/fornecedor escolhido.
 * Habilitado só quando há empresa; lista os representantes DAQUELA empresa
 * (embed to-many `representantes(id, nome)`). Primeiro item "Direto na empresa"
 * → grava null. Trocar a empresa deve limpar o value (feito por quem usa).
 */
export function RepresentanteSelect({
  empresa,
  value,
  onChange,
  label = "Representante (opcional)",
}: {
  empresa: EmpresaComRepresentantes | null | undefined;
  value: string | null;
  onChange: (v: string | null) => void;
  label?: string;
}) {
  const reps = (empresa?.representantes ?? []) as RepresentanteRef[];
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select
        value={value ?? DIRETO}
        onValueChange={(v) => onChange(v === DIRETO ? null : v)}
        disabled={!empresa}
      >
        <SelectTrigger><SelectValue placeholder="Direto na empresa" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={DIRETO}>Direto na empresa</SelectItem>
          {reps.map((r) => (
            <SelectItem key={r.id} value={r.id}>{r.nome ?? "—"}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
