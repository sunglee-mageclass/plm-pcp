// Release I3 — "Categoria do tecido" (grupo NÃO Acessórios) / "Material do aviamento" (grupo Acessórios) no card do
// Produto Acabado e do Produto Importado. Campo informativo (alimenta "Categoria do Tecido Principal" da Integração):
// opcional, nunca trava nem bloqueia. Um único componente p/ os dois cards (consistência de rótulo/comportamento).
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Opt = { id: string; nome: string };
const NENHUMA = "__nenhuma__";

export function CategoriaTecidoField({
  acessorio, categoriaTecidoId, materialAviamentoId, categoriasTecido, materiaisAviamento, onChange, labelClass, colabPath, disabled,
}: {
  acessorio: boolean;
  categoriaTecidoId: string | null;
  materialAviamentoId: string | null;
  categoriasTecido: Opt[];
  materiaisAviamento: Opt[];
  /** Muda SÓ a chave que se aplica ao grupo; a do outro grupo permanece no rascunho (nunca é apagada). */
  onChange: (patch: { categoria_tecido_id: string | null } | { material_aviamento_id: string | null }) => void;
  labelClass: string;
  /** Prefixo do `data-colab-path` (ex.: `card:<id>`). */
  colabPath: string;
  disabled?: boolean;
}) {
  const valor = (acessorio ? materialAviamentoId : categoriaTecidoId) ?? NENHUMA;
  const opcoes = acessorio ? materiaisAviamento : categoriasTecido;
  const rotulo = acessorio ? "Material do aviamento" : "Categoria do tecido";
  return (
    <div className="flex items-center gap-3">
      <Label className={labelClass}>{rotulo}</Label>
      <div className="flex-1">
        <Select
          value={valor}
          onValueChange={(v) => {
            const id = v === NENHUMA ? null : v;
            onChange(acessorio ? { material_aviamento_id: id } : { categoria_tecido_id: id });
          }}
          disabled={disabled}
        >
          <SelectTrigger data-colab-path={`${colabPath}:${acessorio ? "material_aviamento" : "categoria_tecido"}`}>
            <SelectValue placeholder="— nenhuma —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NENHUMA}>— nenhuma —</SelectItem>
            {opcoes.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
