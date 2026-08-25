import { type ReactNode } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";

/**
 * Foto do modelo (anexo) na lista de produtos, com gatilhos por plataforma:
 *
 *  • `ModeloFotoHoverRow` — envolve a LINHA INTEIRA (`<tr>`) como gatilho do HoverCard no
 *    DESKTOP: passar o mouse em qualquer lugar da linha mostra a foto. `HoverCardContent`
 *    renderiza em portal (fora da tabela) e o `HoverCard` root não emite DOM, então o `<tr>`
 *    segue filho direto do `<tbody>` (HTML válido). `asChild` clona no `<tr>`, preservando o
 *    `onClick` da linha. Conteúdo do hover só monta ao abrir (signed URL lazy). `md:block`.
 *  • `ModeloFotoCelulaMobile` — no MOBILE (card empilhado via `.card-table-foto`), uma célula
 *    `<td data-label="foto">` com o thumbnail SEMPRE VISÍVEL à esquerda do card (sem toque).
 *    Escondida no desktop (`md:hidden`, lá vale o hover). Requer a tabela com a classe
 *    `card-table-foto` (ver styles.css) p/ o card virar flex-row foto-à-esquerda.
 *
 * `fontes` = hierarquia de capa padrão: [fotos_modelo[0], desenho_tecnico_url, croqui_url].
 * Sem foto → `ModeloResumoFoto` mostra um ícone de imagem discreto.
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

/** Célula de foto RETRATO (~64px de largura) à esquerda do card no mobile — sempre visível,
 *  sem toque, esticando na altura do bloco. É um `<td>` (vai direto dentro do `<tr>`),
 *  escondido no desktop. `h-full` faz a foto acompanhar a altura da coluna direita (via o
 *  `align-self: stretch` do `.card-table-foto`); `w-16` (~64px) mantém o retrato estreito. */
export function ModeloFotoCelulaMobile({
  fontes,
  nome,
}: {
  fontes: (string | null | undefined)[];
  nome?: string | null;
}) {
  return (
    <td data-label="foto" className="md:hidden">
      {/* h-full min-h-0: a foto acompanha a altura do bloco de infos (a td faz rowspan e
          estica); w-16 = retrato estreito. SEM altura própria fixa (senão inflaria a 1ª linha
          e criava o vão entre REF e Nome). */}
      <ModeloResumoFoto fontes={fontes} nome={nome} className="h-full min-h-0 w-16" />
    </td>
  );
}
