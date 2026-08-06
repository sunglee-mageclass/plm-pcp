import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";

export type CustoAdicional = { descricao: string; valor: number };

// Régua ÚNICA da coluna de valores + calha reservada da lixeira em TODAS as linhas — assim os
// valores (texto e input) terminam no MESMO eixo à direita, mesmo nas linhas com lixeira (laudo).
const VAL = "w-28 shrink-0 text-right tabular-nums";
const GUT = "w-9 max-md:w-11 shrink-0";

function LinhaFixa({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${strong ? "font-semibold text-base" : ""}`}>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {/* pr-3 = padding interno do input → o "0,00" do texto alinha com o "0,00" digitado. */}
      <span className={`${VAL} pr-3`}>R$ {fmtNum(value)}</span>
      <span className={GUT} aria-hidden />
    </div>
  );
}

export function ModeloCustosSection({
  totals,
  custoTerceirizados,
  maoObraEstado,
  custosAdicionais,
  onChangeCustos,
  camposCopiados = new Set(),
  onCampoEditado,
}: {
  totals: { tecido: number; forro: number; entretela: number; aviamento: number; etiqueta: number; peca: number };
  /** MO planejada por serviço (Σ modelo_servico_mo.valor) — READ-ONLY; editar/aprovar é por serviço, no Planejamento. */
  custoTerceirizados: number;
  /** Estado da MO por serviço (aprovada|pendente|reprovada|sem_servico); undefined = sem custo/mascarado. */
  maoObraEstado?: string;
  custosAdicionais: CustoAdicional[];
  onChangeCustos: (v: CustoAdicional[]) => void;
  camposCopiados?: Set<string>;
  onCampoEditado?: (k: string) => void;
}) {
  const patch = (i: number, p: Partial<CustoAdicional>) => {
    onChangeCustos(custosAdicionais.map((c, idx) => (idx === i ? { ...c, ...p } : c)));
    onCampoEditado?.("custos_adicionais");
  };
  const add = () => { onChangeCustos([...custosAdicionais, { descricao: "", valor: 0 }]); onCampoEditado?.("custos_adicionais"); };
  const remove = (i: number) => { onChangeCustos(custosAdicionais.filter((_, idx) => idx !== i)); onCampoEditado?.("custos_adicionais"); };

  return (
    <Card className="p-4 space-y-1.5 text-sm">
      <LinhaFixa label="Tecido" value={totals.tecido} />
      <LinhaFixa label="Forro" value={totals.forro} />
      <LinhaFixa label="Entretela" value={totals.entretela} />
      <LinhaFixa label="Aviamento" value={totals.aviamento} />
      <LinhaFixa label="Etiquetas" value={totals.etiqueta} />

      {/* Mão de obra: READ-ONLY, fonte ÚNICA = MO por serviço (Σ modelo_servico_mo.valor).
          Editar/aprovar a MO é POR SERVIÇO, no card do Planejamento — aqui só reflete o total. */}
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 flex items-center gap-2">
          <Label>Mão de Obra (por serviço)</Label>
          {/* Reflexo (read-only) do estado da MO por serviço — aprovação é por serviço, no Planejamento.
              undefined (sem custo/mascarado) ou sem_servico → sem selo. */}
          {maoObraEstado && maoObraEstado !== "sem_servico" && (
            <span className={`text-[10px] rounded px-1.5 py-0.5 ${maoObraEstado === "aprovada" ? "bg-emerald-100 text-emerald-700" : maoObraEstado === "reprovada" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
              title="Estado da mão de obra (aprovação por serviço, no Planejamento)">
              {maoObraEstado === "aprovada" ? "Aprovada" : maoObraEstado === "reprovada" ? "Reprovada" : "Pendente"}
            </span>
          )}
        </span>
        <span className={`${VAL} pr-3`}>R$ {fmtNum(custoTerceirizados)}</span>
        <span className={GUT} aria-hidden />
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">Definida por serviço no Planejamento.</p>

      {/* Custos adicionais (descrição + valor por peça) — entram no Custo de 1 Peça E no custo real.
          Valor na régua VAL + lixeira na calha GUT: alinha com as linhas fixas e a mão de obra. */}
      <div className={classeCopiado(camposCopiados, "custos_adicionais")}>
        {custosAdicionais.map((c, i) => (
          <div key={i} className="flex items-center gap-2 mb-1">
            <Input
              className="flex-1 min-w-0"
              placeholder="Descrição do custo"
              value={c.descricao}
              onChange={(e) => patch(i, { descricao: e.target.value })}
            />
            <NumberInput
              className={VAL}
              placeholder="0,00"
              value={c.valor || ""}
              onChange={(e) => patch(i, { valor: Number(e.target.value) || 0 })}
            />
            <Button variant="ghost" size="icon" className="h-9 w-9 max-md:h-11 max-md:w-11 shrink-0 text-muted-foreground" onClick={() => remove(i)} aria-label="Remover custo" title="Remover">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {/* "Adicionar custo": link leve (mockup) em vez de botão outline full-width. */}
      <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        <Plus className="h-3.5 w-3.5" /> Adicionar custo
      </button>

      <Separator className="my-2" />
      <LinhaFixa label="Custo de 1 Peça" value={totals.peca} strong />
    </Card>
  );
}
