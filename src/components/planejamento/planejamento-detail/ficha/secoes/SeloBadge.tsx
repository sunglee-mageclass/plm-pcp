// F3.2/F3.3 — selo de completude de seção (StatusBadge §Q + "i" da condição quando falta UM requisito). Saiu do
// BomSecoes na F3.3 p/ servir TODAS as seções do Sheet (numeração/selos — Task 8).
import { AlertTriangle, Check } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { CondicaoInfo } from "@/components/shared/CondicaoInfo";
import type { SeloSecao } from "../selos-bom";

const TOM: Record<SeloSecao["tone"], StatusTone> = { ok: "success", info: "info", warn: "warning", muted: "neutral" };

export function SeloBadge({ selo }: { selo: SeloSecao }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusBadge tone={TOM[selo.tone]} title={selo.title} className="gap-1 rounded-full px-2 py-0.5 text-[11px] normal-case tracking-normal">
        {selo.tone === "ok" ? <Check className="h-3 w-3" /> : selo.tone === "warn" ? <AlertTriangle className="h-3 w-3" /> : null}
        {selo.texto}
      </StatusBadge>
      {selo.condicaoUnica && <CondicaoInfo descricao={selo.condicaoUnica.descricao} aviso={selo.condicaoUnica.aviso} />}
    </span>
  );
}
