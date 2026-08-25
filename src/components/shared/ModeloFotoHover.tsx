import { type ReactNode } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";

/**
 * Foto do modelo (anexo) na lista de produtos:
 *
 *  • `ModeloFotoHoverRow` — envolve a LINHA (`<tr>`) como gatilho do HoverCard no DESKTOP:
 *    passar o mouse em qualquer lugar da linha mostra a foto grande. `HoverCard` root não emite
 *    DOM e `HoverCardContent` vai p/ portal → o `<tr>` segue filho direto do `<tbody>` (válido).
 *    `md:block` (só desktop; no mobile a foto já está no card).
 *  • `ModeloResumoLinhaMobile` — no MOBILE, uma célula `<td>` (full-width, `md:hidden`) que
 *    renderiza o CARD do modelo: foto à esquerda + "REF — Nome" em destaque + "Categoria •
 *    Coleção" abaixo. Espelha o header dos sheets de detalhe (padrão já usado no sistema).
 *    Requer o `<tr>` com `data-card-linha` (o CSS esconde as demais `<td>` no mobile).
 *
 * `fontes` = hierarquia de capa: [fotos_modelo[0], desenho_tecnico_url, croqui_url].
 */

/** Envolve o `<tr>` (children) como gatilho do HoverCard — hover na linha inteira (desktop). */
export function ModeloFotoHoverRow({
  fontes,
  nome,
  children,
}: {
  fontes: (string | null | undefined)[];
  nome?: string | null;
  children: ReactNode;
}) {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" side="right" className="hidden w-auto p-1 md:block">
        <ModeloResumoFoto fontes={fontes} nome={nome} className="h-40 w-40" />
      </HoverCardContent>
    </HoverCard>
  );
}

/** Card do modelo no mobile: foto à esquerda + "REF — Nome" + "Categoria • Coleção".
 *  É uma `<td>` que ocupa o card inteiro (o CSS `.card-table-foto` esconde as demais no mobile
 *  e mostra só esta). `ref`/`nome`/`categoria`/`colecao` = o que a lista já carrega. */
export function ModeloResumoLinhaMobile({
  fontes,
  refModelo,
  nome,
  categoria,
  colecao,
  extra,
}: {
  fontes: (string | null | undefined)[];
  refModelo?: string | null; // "ref" é reservado pelo React em JSX — usar refModelo
  nome?: string | null;
  categoria?: string | null;
  colecao?: string | null;
  /** slot opcional à direita (ex. badge de status/situação). */
  extra?: ReactNode;
}) {
  const meta = [categoria, colecao].filter(Boolean).join(" • ");
  return (
    <td data-label="card" className="md:hidden">
      <div className="flex items-center gap-3">
        <ModeloResumoFoto fontes={fontes} nome={nome} className="h-14 w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base font-semibold tracking-tight">
            {refModelo ?? "—"}{nome ? ` — ${nome}` : ""}
          </div>
          {meta ? <div className="truncate text-xs text-muted-foreground">{meta}</div> : null}
          {extra ? <div className="mt-1">{extra}</div> : null}
        </div>
      </div>
    </td>
  );
}
