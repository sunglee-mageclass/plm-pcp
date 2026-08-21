import { Milestone } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateField } from "@/components/shared/DateField";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { etapaDoBloco, type EtapaCfg, type BlocoEtapa } from "@/lib/pcp-etapas";

// Etapas PL (Fase 1, módulo opt-in `etapas_pl`): painel destacado no bloco PL do sheet de
// Serviços. Mostra a etapa ATUAL do card (badge, via etapaDoBloco — mesma fonte que vai
// alimentar o kanban de Etapas PL) + a seção "Peça Teste" (as 3 colunas que definem a 1ª
// etapa: saída/entrada/aprovação). As demais etapas (2–4) são alimentadas por campos que já
// existem no bloco (Data Enviado / Grade Cortada / Data Entregue+Recebida) — a nota abaixo só
// explica onde encontrá-los, sem duplicar os campos aqui.
const ETAPA_TONE: Record<string, StatusTone> = {
  peca_teste: "warning",
  separacao: "info",
  retorno_grade: "info",
  oficina: "info",
  finalizacao: "success",
};

export function EtapasPlPanel({
  bloco,
  etapasCfg,
  onChange,
  readOnly,
}: {
  bloco: BlocoEtapa;
  etapasCfg: EtapaCfg[];
  onChange: (campo: "pt_data_saida" | "pt_data_entrada" | "pt_aprovacao", valor: string | null) => void;
  readOnly?: boolean;
}) {
  const { key: etapaKey, reprovada } = etapaDoBloco(bloco, etapasCfg);
  const etapaLabel = etapasCfg.find((e) => e.key === etapaKey)?.label ?? "—";

  return (
    <div className="col-span-full rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Milestone className="h-4 w-4 text-primary" />
          Etapas PL
        </div>
        <StatusBadge tone={reprovada ? "danger" : (ETAPA_TONE[etapaKey ?? ""] ?? "neutral")}>
          {reprovada ? "Reprovado — refazer Peça Teste" : etapaLabel}
        </StatusBadge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label className="text-xs">Peça Teste — Data de saída</Label>
          <DateField
            value={bloco.pt_data_saida ?? ""}
            onChange={(e) => onChange("pt_data_saida", e.target.value || null)}
            disabled={readOnly}
          />
        </div>
        <div>
          <Label className="text-xs">Peça Teste — Data de entrada</Label>
          <DateField
            value={bloco.pt_data_entrada ?? ""}
            onChange={(e) => onChange("pt_data_entrada", e.target.value || null)}
            disabled={readOnly}
          />
        </div>
        <div>
          <Label className="text-xs">Peça Teste — Aprovação</Label>
          <Select
            value={bloco.pt_aprovacao ?? ""}
            onValueChange={(v) => onChange("pt_aprovacao", v || null)}
            disabled={readOnly}
          >
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="aprovado">Aprovado</SelectItem>
              <SelectItem value="reprovado">Reprovado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Próximas etapas (campos já existentes acima): <b>2 — Separação de Materiais</b> = Data
        Enviado; <b>3 — Retorno de Grade de Corte</b> = Grade Cortada; <b>4 — Oficina</b> = Data
        Entregue + Qtd Recebida.
      </p>
    </div>
  );
}
