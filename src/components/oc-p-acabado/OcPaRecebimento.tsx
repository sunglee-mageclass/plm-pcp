import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/shared/DateField";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OcSecTitle } from "@/components/oc-tecido/OcTecidoForm";
import { GradeDestrinchada } from "./GradeDestrinchada";
import { somaGrade, type Draft, type GradeDetalhe, type VarianteDraft } from "./shared";
import { varianteLabel } from "@/lib/variante";

export type ColaboradorOpt = { id: string; nome: string };

export function OcPaRecebimento({
  draft, setDraft,
  grade, setGrade,
  tamanhos,
  cores, coresApelido,
  colaboradores,
  readOnly = false,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  grade: GradeDetalhe;
  setGrade: React.Dispatch<React.SetStateAction<GradeDetalhe>>;
  tamanhos: string[];
  cores: { id: string; nome: string }[];
  coresApelido: { id: string; nome: string; cor_base_id: string | null }[];
  colaboradores: ColaboradorOpt[];
  readOnly?: boolean;
}) {
  const corNome = (id: string | null) => cores.find((c) => c.id === id)?.nome ?? null;
  const apelidoNome = (id: string | null) => coresApelido.find((c) => c.id === id)?.nome ?? null;
  const labelVarianteRow = (v: VarianteDraft) => `${v.ordem} · ${varianteLabel({ cor: corNome(v.cor_id), apelido: apelidoNome(v.cor_apelido_id) })}`;

  const somaPedida = somaGrade(grade, tamanhos, "pedida");
  const somaRecebida = somaGrade(grade, tamanhos, "recebida");
  const somaDefeito = somaGrade(grade, tamanhos, "defeito");
  const somaReal = Math.max(0, somaRecebida - somaDefeito);

  return (
    <section id="ocpa-sec-recebimento" className="scroll-mt-2 space-y-4">
      <OcSecTitle n={4}>Recebimento</OcSecTitle>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="grid gap-1">
          <Label>Data de entrega</Label>
          <DateField value={draft.data_entrega} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, data_entrega: e.target.value }))} />
        </div>
        <div className="grid gap-1">
          <Label>Nota Fiscal (nº)</Label>
          <Input value={draft.nota_fiscal} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, nota_fiscal: e.target.value }))} />
        </div>
        <div className="grid gap-1">
          <Label>Responsável pelo recebimento</Label>
          <Select value={draft.responsavel_recebimento_id ?? ""} onValueChange={(v) => setDraft((d) => ({ ...d, responsavel_recebimento_id: v || null }))} disabled={readOnly}>
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              {colaboradores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Revisão</Label>
          <Textarea value={draft.revisao} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, revisao: e.target.value }))} />
        </div>
        <div className="sm:col-span-2 grid gap-1">
          <Label>Devolução</Label>
          <Textarea value={draft.devolucao} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, devolucao: e.target.value }))} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Grade recebida (destrinchada)</Label>
        <GradeDestrinchada
          variantes={draft.variantes}
          tamanhos={tamanhos}
          grade={grade}
          campo="recebida"
          onChange={setGrade}
          labelFor={(ordem) => labelVarianteRow(draft.variantes.find((v) => v.ordem === ordem)!)}
          disabled={readOnly}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Grade com defeito (destrinchada)</Label>
        <GradeDestrinchada
          variantes={draft.variantes}
          tamanhos={tamanhos}
          grade={grade}
          campo="defeito"
          onChange={setGrade}
          labelFor={(ordem) => labelVarianteRow(draft.variantes.find((v) => v.ordem === ordem)!)}
          disabled={readOnly}
        />
      </div>

      <InfoStrip
        itens={[
          { label: "Σ pedida", valor: somaPedida },
          { label: "Σ recebida", valor: somaRecebida },
          { label: "Σ defeito", valor: somaDefeito },
          { label: "Grade real (recebida − defeito)", valor: somaReal, hi: true },
        ]}
      />
    </section>
  );
}
