// Marcação de presença POR CAMPO estilo Google Sheets (Fase 1 do realtime universal, set/2026):
// quando OUTRO usuário está com um campo focado, o campo ganha um anel na COR daquela pessoa + um
// rótulo flutuante com o NOME dela logo acima (canto sup. direito). O dado vem da presença do
// `useColabRegistro` (`presentes[].{userId,nome,campoFocado}`); a cor é estável por usuário
// (`presenca-cor.ts`). Antes disso o feedback era só um `ring-sky-400` fixo, sem nome nem cor.
//
// Uso: envolver o campo com <FieldPresence campo={presencaDoCampo(presentes, "meu-path")}> e marcar
// o INPUT com data-colab-path="meu-path" (o container de foco do sheet lê o dataset p/ trackar).
// O componente é transparente quando `campo` é null (ninguém no campo) — zero custo visual.

import type { ReactNode } from "react";
import type { CorPresenca } from "@/lib/colab/presenca-cor";

// ⚠️ DESATIVADO (set/2026): o anel de presença por campo agora é desenhado pelo
// <ColabPresenceOverlay> (auto-instrumentado, um por sheet, cobre TODOS os campos) — não mais por
// wrapper individual. Este componente virou um passthrough transparente para não desenhar um anel
// DUPLICADO onde ainda houver `<FieldPresence>` remanescente. As props (`campo`) continuam aceitas
// p/ retrocompatibilidade das chamadas existentes, mas são ignoradas. Pode ser removido junto com
// suas últimas chamadas numa limpeza futura.
export function FieldPresence({ children, className }: {
  campo?: CorPresenca | null;
  children: ReactNode;
  className?: string;
}) {
  return className ? <div className={className}>{children}</div> : <>{children}</>;
}
