// F3.2/F3.3 — selo de completude de seção (StatusBadge §Q + "i" da condição quando falta UM requisito). Saiu do
// BomSecoes na F3.3 p/ servir TODAS as seções do Sheet (numeração/selos — Task 8).
import { AlertTriangle, Check } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { CondicaoInfo } from "@/components/shared/CondicaoInfo";
import type { SeloSecao } from "../selos-bom";

const TOM: Record<SeloSecao["tone"], StatusTone> = { ok: "success", info: "info", warn: "warning", muted: "neutral" };

export function SeloBadge({ selo }: { selo: SeloSecao }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {/* Fix pós-T9 (item 3) — `title` SEMPRE preenchido (fallback pro próprio texto): os selos da Coleção e do
          Preço (selos-secoes.ts) não definem `selo.title`; sem fallback, o hover não mostrava nada quando o
          `truncate` abaixo cortava o texto em 360px. */}
      <StatusBadge tone={TOM[selo.tone]} title={selo.title ?? selo.texto} className="min-w-0 gap-1 rounded-full px-2 py-0.5 text-[11px] normal-case tracking-normal">
        {selo.tone === "ok" ? <Check className="h-3 w-3 shrink-0" /> : selo.tone === "warn" ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
        {/* Fix pós-T9 (item 3) — o `truncate` mora no TEXTO (não no wrapper flex de fora, `SecaoBom.tsx`/`campos.tsx`
            Secao): um `<span>` interno com `overflow:hidden`/`text-overflow:ellipsis` dentro do StatusBadge flex
            trunca de verdade; truncar o `inline-flex` de fora não reduz o conteúdo do badge em si. */}
        <span className="truncate">{selo.texto}</span>
      </StatusBadge>
      {/* Fix pós-T9 (item 3) — o "i" já nasce `shrink-0` DENTRO do `CondicaoInfo` (botão do componente, `CondicaoInfo.tsx`
          linha 29): com o wrapper deste `<span>` agora `min-w-0`, confirma que ele nunca encolhe/some no truncamento. */}
      {selo.condicaoUnica && <CondicaoInfo descricao={selo.condicaoUnica.descricao} aviso={selo.condicaoUnica.aviso} />}
    </span>
  );
}
