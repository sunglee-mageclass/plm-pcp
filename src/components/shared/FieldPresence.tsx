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

export function FieldPresence({ campo, children, className }: {
  campo: CorPresenca | null;
  children: ReactNode;
  className?: string;
}) {
  if (!campo) return <div className={className}>{children}</div>;
  return (
    <div className={`relative rounded-md ${className ?? ""}`} style={{ boxShadow: `0 0 0 2px ${campo.solid}` }}>
      {/* rótulo com o nome, na cor da pessoa, no canto sup. direito DENTRO da borda do anel — não
          empurra o layout (absolute) e não colide com a <Label> do campo (que fica ACIMA do wrapper,
          fora dele). z-20 p/ ficar sobre o input; pointer-events-none p/ não bloquear o clique. */}
      <span
        className="pointer-events-none absolute top-0.5 right-0.5 z-20 rounded px-1.5 py-px text-[10px] font-semibold leading-tight shadow-sm"
        style={{ background: campo.solid, color: campo.text }}
      >
        {campo.nome}
      </span>
      {children}
    </div>
  );
}
