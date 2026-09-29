// "Tamanho em" (Letra/Número) — Tarefa 3 do plano `.superpowers/sdd/2026-09-29-tamanho-em/plan.md`. Compartilhado
// pelos 3 cards que editam `modelos.tamanho_tipo` (Plan. Tecido, Produto Acabado, Importado); a seção "4. Códigos" do
// Sheet do Planejamento (`CodigosSecao.tsx`) mantém o próprio rádio inline (não usa este componente — troca de rótulo/
// texto própria), mas o visual/estrutura aqui é o MESMO (rádio nativo, `src/components/ui/` não se edita).
import { Label } from "@/components/ui/label";
import { InfoHover } from "@/components/shared/InfoHover";
import { cn } from "@/lib/utils";
import type { TamanhoTipo } from "@/lib/tamanho";

const OPCOES = [{ v: "letra", rotulo: "Letra" }, { v: "numero", rotulo: "Número" }] as const;

/**
 * Rádio "Tamanho em" (Letra/Número). Rádio NATIVO (`role="radiogroup"` rotulado por `<Label>`, `data-colab-path=
 * "tamanho_tipo"` p/ o merge 3-vias/presença de colaboração achar o campo — mesma convenção dos outros campos
 * editáveis). `disabled`/`motivoDesabilitado` espelham a trava da Integração (invariante #14 do CLAUDE.md): quando
 * travado, o rótulo mostra o motivo como selo de texto E como `title` do grupo (tooltip nativo no desktop; no
 * celular, sem hover, o texto ao lado já basta). Quebra abaixo de `sm` (coluna); alvo de toque 44px
 * (`max-sm:min-h-11`) em cada opção, igual ao rádio da seção Códigos.
 */
export function TamanhoEmToggle({
  value, onChange, disabled, motivoDesabilitado, className,
}: {
  value: TamanhoTipo;
  onChange: (v: TamanhoTipo) => void;
  disabled?: boolean;
  /** Motivo da trava (ex.: selo de Integração) — some como texto ao lado do rótulo e como `title` do grupo. */
  motivoDesabilitado?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-1", className)}
      role="radiogroup"
      aria-labelledby="tamanho-em-toggle-label"
      data-colab-path="tamanho_tipo"
      title={disabled && motivoDesabilitado ? motivoDesabilitado : undefined}
    >
      <Label id="tamanho-em-toggle-label" className="flex items-center gap-1">
        Tamanho em
        <InfoHover ariaLabel="Sobre o Tamanho em">
          É o mesmo valor em todas as telas do produto; SKU já gerado não muda — use Regerar no Planejamento.
        </InfoHover>
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:gap-4">
          {OPCOES.map((o) => (
            <label key={o.v} className="flex cursor-pointer items-center gap-1.5 max-sm:min-h-11">
              <input
                type="radio"
                name="tamanho-em-toggle"
                value={o.v}
                className="h-4 w-4 accent-primary"
                checked={value === o.v}
                disabled={disabled}
                onChange={() => onChange(o.v)}
              />
              {o.rotulo}
            </label>
          ))}
        </div>
        {disabled && motivoDesabilitado && (
          <span className="text-xs text-muted-foreground">{motivoDesabilitado}</span>
        )}
      </div>
    </div>
  );
}
