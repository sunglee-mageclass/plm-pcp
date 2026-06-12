import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldSelectOpt } from "./shared";
import { STATUS_DESENV_OPTS, type Opt } from "./types";

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
  canEnviarCad,
  onEnviarCad,
  enviarCadPending,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  linhas: Opt[];
  modelistas: Opt[];
  piloteiros: Opt[];
  isAprovado: boolean;
  isReprovado: boolean;
  canEnviarCad: boolean;
  onEnviarCad: () => void;
  enviarCadPending: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Nome">
          <Input value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} />
        </Field>
        <Field label="Status">
          <Select value={draft.status_desenvolvimento} onValueChange={(v) => setDraft({ ...draft, status_desenvolvimento: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_DESENV_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {isAprovado && (
          <Field label="REF">
            <Input value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} />
          </Field>
        )}
        {isReprovado && (
          <Field label="Motivo do Cancelamento" full>
            <Textarea rows={2} value={draft.motivo_cancelamento} onChange={(e) => setDraft({ ...draft, motivo_cancelamento: e.target.value })} />
          </Field>
        )}
        <FieldSelectOpt label="Linha" value={draft.linha_id} onChange={(v) => setDraft({ ...draft, linha_id: v })} options={linhas} />
        <FieldSelectOpt label="Modelista" value={draft.modelista_id} onChange={(v) => setDraft({ ...draft, modelista_id: v })} options={modelistas} />
        <FieldSelectOpt label="Piloteiro 1" value={draft.piloteiro1_id} onChange={(v) => setDraft({ ...draft, piloteiro1_id: v })} options={piloteiros} />
        <Field label="Data Piloto 1">
          <Input type="date" value={draft.data_piloto1 ?? ""} onChange={(e) => setDraft({ ...draft, data_piloto1: e.target.value })} />
        </Field>
        <FieldSelectOpt label="Piloteiro 2" value={draft.piloteiro2_id} onChange={(v) => setDraft({ ...draft, piloteiro2_id: v })} options={piloteiros} />
        <Field label="Data Piloto 2">
          <Input type="date" value={draft.data_piloto2 ?? ""} onChange={(e) => setDraft({ ...draft, data_piloto2: e.target.value })} />
        </Field>
        <FieldSelectOpt label="Piloteiro 3" value={draft.piloteiro3_id} onChange={(v) => setDraft({ ...draft, piloteiro3_id: v })} options={piloteiros} />
        <Field label="Data Piloto 3">
          <Input type="date" value={draft.data_piloto3 ?? ""} onChange={(e) => setDraft({ ...draft, data_piloto3: e.target.value })} />
        </Field>
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
      {canEnviarCad && (
        <Button onClick={onEnviarCad} disabled={enviarCadPending} className="w-full">
          <Send className="h-4 w-4 mr-2" /> Enviar para o CAD
        </Button>
      )}
      {draft.enviado_cad && (
        <p className="text-xs text-muted-foreground text-center">✓ Já enviado para o CAD</p>
      )}
    </div>
  );
}
