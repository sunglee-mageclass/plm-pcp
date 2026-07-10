import { Fragment, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Dropdown ÚNICO de fornecedor: lista a empresa (comprar DIRETO) e, quando ela tem
// representante(s), cada representante como opção separada (comprar VIA representante).
// Cada opção codifica (empresa_id, representante_id) — selecionar grava os dois.
// Usado no cadastro de Tecido/Aviamento e nas OCs (Tecido/Aviamento).

export type RepRef = { id: string; nome: string | null };
export type EmpresaFornecedor = {
  id: string;
  nome_fantasia: string;
  representantes?: RepRef[] | null;
};

const EMP = "E:"; // opção "empresa direto"
const REP = "R:"; // opção "empresa via representante"

export function FornecedorSelect({
  empresas,
  empresaId,
  representanteId,
  onChange,
  placeholder = "Selecione…",
  disabled,
}: {
  empresas: EmpresaFornecedor[];
  empresaId: string | null;
  representanteId: string | null;
  onChange: (empresaId: string | null, representanteId: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  // Representante -> empresa dona (p/ resolver a empresa ao escolher um representante).
  const repToEmpresa = useMemo(() => {
    const m = new Map<string, string>();
    empresas.forEach((e) => (e.representantes ?? []).forEach((r) => r && m.set(r.id, e.id)));
    return m;
  }, [empresas]);

  const value = representanteId ? `${REP}${representanteId}` : empresaId ? `${EMP}${empresaId}` : "";

  const handle = (v: string) => {
    if (v.startsWith(REP)) {
      const rid = v.slice(REP.length);
      onChange(repToEmpresa.get(rid) ?? null, rid);
    } else if (v.startsWith(EMP)) {
      onChange(v.slice(EMP.length), null);
    } else {
      onChange(null, null);
    }
  };

  return (
    <Select value={value} onValueChange={handle} disabled={disabled}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {empresas.map((e) => (
          // Empresa (direto) + seus representantes formam um grupo visual.
          <Fragment key={e.id}>
            <SelectItem value={`${EMP}${e.id}`}>{e.nome_fantasia}</SelectItem>
            {(e.representantes ?? []).map((r) => (
              <SelectItem key={r.id} value={`${REP}${r.id}`} className="pl-6">
                {e.nome_fantasia} · {r.nome ?? "—"}
              </SelectItem>
            ))}
          </Fragment>
        ))}
      </SelectContent>
    </Select>
  );
}
