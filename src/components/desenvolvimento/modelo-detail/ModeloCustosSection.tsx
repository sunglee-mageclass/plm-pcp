import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Row } from "./shared";

export function ModeloCustosSection({
  totals,
  custoTerceirizados,
  onChangeTerceirizados,
}: {
  totals: { tecido: number; forro: number; entretela: number; aviamento: number; peca: number };
  custoTerceirizados: number;
  onChangeTerceirizados: (v: number) => void;
}) {
  return (
    <Card className="p-4 space-y-1.5 text-sm">
      <Row label="Tecido" value={totals.tecido} />
      <Row label="Forro" value={totals.forro} />
      <Row label="Entretela" value={totals.entretela} />
      <Row label="Aviamento" value={totals.aviamento} />
      <div className="flex justify-between items-center">
        <Label>Previsão de Mão de Obra</Label>
        <NumberInput
          className="w-32 text-right"
          type="number"
          step="0.01"
          value={custoTerceirizados}
          onChange={(e) => onChangeTerceirizados(Number(e.target.value) || 0)}
        />
      </div>
      <Separator className="my-2" />
      <Row label="Custo de 1 Peça" value={totals.peca} strong />
    </Card>
  );
}
