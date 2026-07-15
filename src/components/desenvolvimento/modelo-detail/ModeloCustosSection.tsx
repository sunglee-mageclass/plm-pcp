import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { Row } from "./shared";

export type CustoAdicional = { descricao: string; valor: number };

export function ModeloCustosSection({
  totals,
  custoTerceirizados,
  onChangeTerceirizados,
  custosAdicionais,
  onChangeCustos,
}: {
  totals: { tecido: number; forro: number; entretela: number; aviamento: number; etiqueta: number; peca: number };
  custoTerceirizados: number;
  onChangeTerceirizados: (v: number) => void;
  custosAdicionais: CustoAdicional[];
  onChangeCustos: (v: CustoAdicional[]) => void;
}) {
  const patch = (i: number, p: Partial<CustoAdicional>) =>
    onChangeCustos(custosAdicionais.map((c, idx) => (idx === i ? { ...c, ...p } : c)));
  const add = () => onChangeCustos([...custosAdicionais, { descricao: "", valor: 0 }]);
  const remove = (i: number) => onChangeCustos(custosAdicionais.filter((_, idx) => idx !== i));

  return (
    <Card className="p-4 space-y-1.5 text-sm">
      <Row label="Tecido" value={totals.tecido} />
      <Row label="Forro" value={totals.forro} />
      <Row label="Entretela" value={totals.entretela} />
      <Row label="Aviamento" value={totals.aviamento} />
      <Row label="Etiquetas" value={totals.etiqueta} />
      <div className="flex justify-between items-center">
        <Label>Previsão de Mão de Obra</Label>
        <NumberInput
          className="w-32 text-right"
          placeholder="0,00"
          // 0 aparece como placeholder (não como valor a apagar) — digita direto.
          value={custoTerceirizados || ""}
          onChange={(e) => onChangeTerceirizados(Number(e.target.value) || 0)}
        />
      </div>

      {/* Custos adicionais (descrição + valor por peça) — entram no Custo de 1 Peça E no custo real. */}
      {custosAdicionais.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            className="flex-1 h-9"
            placeholder="Descrição do custo"
            value={c.descricao}
            onChange={(e) => patch(i, { descricao: e.target.value })}
          />
          <NumberInput
            className="w-28 text-right h-9"
            placeholder="0,00"
            value={c.valor || ""}
            onChange={(e) => patch(i, { valor: Number(e.target.value) || 0 })}
          />
          <Button variant="ghost" size="iconSm" onClick={() => remove(i)} aria-label="Remover custo" title="Remover">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="w-full">
        <Plus className="h-4 w-4" /> Adicionar custo
      </Button>

      <Separator className="my-2" />
      <Row label="Custo de 1 Peça" value={totals.peca} strong />
    </Card>
  );
}
