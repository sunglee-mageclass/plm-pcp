import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldSelectOpt } from "./shared";
import { STATUS_DESENV_OPTS, type Opt } from "./types";
import { useFieldLabels } from "@/hooks/useFieldLabels";

type StatusOpt = { value: string; label: string };

type Draft = Record<string, any>;

export function ModeloInfoSection({
  draft,
  setDraft,
  linhas,
  modelistas,
  piloteiros,
  isAprovado,
  isReprovado,
  statusOptions,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  linhas: Opt[];
  modelistas: Opt[];
  piloteiros: Opt[];
  isAprovado: boolean;
  isReprovado: boolean;
  statusOptions?: StatusOpt[];
}) {
  const fl = useFieldLabels();
  const [visiblePilotos, setVisiblePilotos] = useState<Set<number>>(() => {
    const has2 = !!(draft.piloteiro2_id || draft.data_piloto2);
    const has3 = !!(draft.piloteiro3_id || draft.data_piloto3);
    const s = new Set<number>([1]);
    if (has2 || has3) s.add(2);
    if (has3) s.add(3);
    return s;
  });

  const addPiloto = (n: 2 | 3) => {
    setVisiblePilotos((prev) => new Set(prev).add(n));
  };

  const removePiloto = (n: 2 | 3) => {
    const clear: Draft = { [`piloteiro${n}_id`]: null, [`data_piloto${n}`]: "" };
    if (n === 2) {
      clear.piloteiro3_id = null;
      clear.data_piloto3 = "";
    }
    setDraft({ ...draft, ...clear });
    setVisiblePilotos((prev) => {
      const next = new Set(prev);
      next.delete(n);
      if (n === 2) next.delete(3);
      return next;
    });
  };

  const statusList = statusOptions && statusOptions.length > 0 ? statusOptions : STATUS_DESENV_OPTS;
  const currentValue = draft.status_desenvolvimento ?? "";
  const hasCurrent = statusList.some((s) => s.value === currentValue);
  const renderList = hasCurrent || !currentValue
    ? statusList
    : [...statusList, { value: currentValue, label: currentValue }];
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Nome">
          <Input value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} />
        </Field>
        <Field label="Status">
          <Select value={currentValue} onValueChange={(v) => setDraft({ ...draft, status_desenvolvimento: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {renderList.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {isAprovado && (
          <Field label={fl("ref")}>
            <Input value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} />
          </Field>
        )}
        {isReprovado && (
          <Field label="Motivo do Cancelamento" full>
            <Textarea rows={2} value={draft.motivo_cancelamento} onChange={(e) => setDraft({ ...draft, motivo_cancelamento: e.target.value })} />
          </Field>
        )}
        <FieldSelectOpt label={fl("linha")} value={draft.linha_id} onChange={(v) => setDraft({ ...draft, linha_id: v })} options={linhas} />
        <FieldSelectOpt label={fl("modelista")} value={draft.modelista_id} onChange={(v) => setDraft({ ...draft, modelista_id: v })} options={modelistas} />
        {/* Categoria/Subcategoria (definidas no Planejamento) — exibição read-only. */}
        <Field label="Categoria">
          <Input value={draft.categoria_principal_nome ?? "—"} readOnly disabled />
        </Field>
        {draft.categoria_secundaria_nome && (
          <Field label="Subcategoria">
            <Input value={draft.categoria_secundaria_nome} readOnly disabled />
          </Field>
        )}
        <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3">
          <FieldSelectOpt label={`${fl("piloteiro")} 1`} value={draft.piloteiro1_id} onChange={(v) => setDraft({ ...draft, piloteiro1_id: v })} options={piloteiros} />
          <Field label="Data Piloto 1">
            <Input type="date" value={draft.data_piloto1 ?? ""} onChange={(e) => setDraft({ ...draft, data_piloto1: e.target.value })} />
          </Field>
        </div>
        {visiblePilotos.has(2) && (
          <>
            <div className="sm:col-span-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Piloto 2</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => removePiloto(2)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3">
              <FieldSelectOpt label={`${fl("piloteiro")} 2`} value={draft.piloteiro2_id} onChange={(v) => setDraft({ ...draft, piloteiro2_id: v })} options={piloteiros} />
              <Field label="Data Piloto 2">
                <Input type="date" value={draft.data_piloto2 ?? ""} onChange={(e) => setDraft({ ...draft, data_piloto2: e.target.value })} />
              </Field>
            </div>
          </>
        )}
        {visiblePilotos.has(3) && (
          <>
            <div className="sm:col-span-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Piloto 3</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => removePiloto(3)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3">
              <FieldSelectOpt label={`${fl("piloteiro")} 3`} value={draft.piloteiro3_id} onChange={(v) => setDraft({ ...draft, piloteiro3_id: v })} options={piloteiros} />
              <Field label="Data Piloto 3">
                <Input type="date" value={draft.data_piloto3 ?? ""} onChange={(e) => setDraft({ ...draft, data_piloto3: e.target.value })} />
              </Field>
            </div>
          </>
        )}
        {(!visiblePilotos.has(2) || !visiblePilotos.has(3)) && (
          <div className="sm:col-span-2 flex gap-2">
            {!visiblePilotos.has(2) && (
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => addPiloto(2)}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar Piloto 2
              </Button>
            )}
            {visiblePilotos.has(2) && !visiblePilotos.has(3) && (
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => addPiloto(3)}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar Piloto 3
              </Button>
            )}
          </div>
        )}
        <Field label="Data Desenho Técnico">
          <Input type="date" value={draft.data_desenho_tecnico ?? ""} onChange={(e) => setDraft({ ...draft, data_desenho_tecnico: e.target.value })} />
        </Field>
        <Field label="Data Aprovação">
          <Input type="date" value={draft.data_aprovacao ?? ""} onChange={(e) => setDraft({ ...draft, data_aprovacao: e.target.value })} />
        </Field>
      </div>
      <Field label="Observações Técnicas" full>
        <Textarea rows={3} value={draft.observacoes_tecnicas} onChange={(e) => setDraft({ ...draft, observacoes_tecnicas: e.target.value })} />
      </Field>
      <Field label="Ajustes na Prova" full>
        <Textarea rows={3} value={draft.ajustes_prova} onChange={(e) => setDraft({ ...draft, ajustes_prova: e.target.value })} />
      </Field>
    </div>
  );
}
