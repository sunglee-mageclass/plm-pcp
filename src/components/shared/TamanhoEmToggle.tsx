// "Tamanho em" (Letra/Número) — Tarefa 3 do plano `.superpowers/sdd/2026-09-29-tamanho-em/plan.md`. Compartilhado
// pelos 3 cards que editam `modelos.tamanho_tipo` (Plan. Tecido, Produto Acabado, Importado); a seção "4. Códigos" do
// Sheet do Planejamento (`CodigosSecao.tsx`) mantém o próprio rádio inline (não usa este componente — troca de rótulo/
// texto própria), mas o visual/estrutura aqui é o MESMO (rádio nativo, `src/components/ui/` não se edita).
import { useId, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { InfoHover } from "@/components/shared/InfoHover";
import { cn } from "@/lib/utils";
import type { TamanhoTipo } from "@/lib/tamanho";

const OPCOES = [{ v: "letra", rotulo: "Letra" }, { v: "numero", rotulo: "Número" }] as const;

/**
 * Rádio "Tamanho em" (Letra/Número). Rádio NATIVO (`role="radiogroup"` rotulado por `<Label>`, `data-colab-path=
 * "tamanho_tipo"` p/ o merge 3-vias/presença de colaboração achar o campo — mesma convenção dos outros campos
 * editáveis). `disabled`/`motivoDesabilitado` espelham a trava da Integração (invariante #14 do CLAUDE.md): quando
 * travado, o rótulo mostra o motivo ao lado (aceita `ReactNode` — o chamador pode passar o selo já pronto da
 * Integração, ex. `textoSelo(...)`, em vez de só texto) e, se der pra extrair texto puro dele, também como `title`
 * do grupo (tooltip nativo no desktop; no celular, sem hover, o conteúdo ao lado já basta). Quebra abaixo de `sm`
 * (coluna); alvo de toque 44px (`max-sm:min-h-11`) em cada opção, igual ao rádio da seção Códigos.
 * `name` do grupo de rádio vem de `useId()` — cada instância do componente tem o seu, então duas instâncias na
 * mesma página (ex. 2 cards abertos) nunca compartilham grupo nativo por engano.
 */
export function TamanhoEmToggle({
  value, onChange, disabled, motivoDesabilitado, tituloDesabilitado, className,
}: {
  value: TamanhoTipo;
  onChange: (v: TamanhoTipo) => void;
  disabled?: boolean;
  /** Motivo da trava (ex.: o selo de texto da Integração) — aparece ao lado do rótulo; string também vira `title`
   *  do grupo (tooltip nativo). */
  motivoDesabilitado?: ReactNode;
  /** Fix M-4 (revisão T3+T7) — `title` do grupo quando `motivoDesabilitado` é um `ReactNode` (não uma string
   *  pura, ex.: o selo já pronto da Integração) — sem isto, só o caso string virava `title` (regra global 9 do
   *  plano pede `title = TEXTO_SKU_TRAVADO`; quem chama com um selo `ReactNode` precisa passar o texto aqui pra
   *  ter tooltip nativo também). Opcional: sem ele, comportamento IDÊNTICO a antes (string vira title, resto não). */
  tituloDesabilitado?: string;
  className?: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const nome = `${id}-tamanho-em`;
  const mostrarMotivo = disabled && !!motivoDesabilitado;
  // Fix M-4 — `title` do grupo: a string de `motivoDesabilitado` (comportamento de sempre) OU `tituloDesabilitado`
  // (novo, explícito) quando `motivoDesabilitado` é um ReactNode sem texto puro extraível.
  const tituloGrupo = mostrarMotivo
    ? (typeof motivoDesabilitado === "string" ? motivoDesabilitado : tituloDesabilitado)
    : undefined;
  return (
    <div
      className={cn("grid gap-1", className)}
      role="radiogroup"
      aria-labelledby={labelId}
      data-colab-path="tamanho_tipo"
      title={tituloGrupo}
    >
      {/* Fix M-4 — o InfoHover (um <button>) sai de DENTRO do <Label> (um <label> sem `htmlFor` ativa o 1º
          elemento rotulável dentro dele — clicar no TEXTO "Tamanho em" clicava no botão por baixo e abria/
          fechava o tooltip). Agora são irmãos numa linha flex; o <Label> perde o papel de wrapper clicável. */}
      <div className="flex items-center gap-1">
        <Label id={labelId}>Tamanho em</Label>
        <InfoHover ariaLabel="Sobre o Tamanho em">
          É o mesmo valor em todas as telas do produto; SKU já gerado não muda — use Regerar no Planejamento.
        </InfoHover>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:gap-4">
          {OPCOES.map((o) => (
            <label
              key={o.v}
              // Fix M-4 (N-3) — desabilitado não mostra "clicável": cursor-not-allowed + esmaecido.
              className={cn(
                "flex items-center gap-1.5 max-sm:min-h-11",
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              )}
            >
              <input
                type="radio"
                name={nome}
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
        {mostrarMotivo && <span className="text-xs text-muted-foreground">{motivoDesabilitado}</span>}
      </div>
    </div>
  );
}
