// Banner de colaboração: presença ("Fulano também está aqui") + resultado de merge
// ("Alguém salvou agora — N campos atualizados · M em conflito"). Sem bloquear o trabalho —
// só informa; a resolução por campo (manter/usar o novo) acontece nos próprios campos.
import { Users } from "lucide-react";
import type { Conflito } from "@/lib/colab/merge";
import type { PresencaColab } from "@/hooks/useColabRegistro";

export function ColabBanner({ presentes, ultimoMerge }: {
  presentes: PresencaColab[];
  ultimoMerge: { atualizados: number; conflitos: Conflito[] } | null;
}) {
  if (presentes.length === 0 && !ultimoMerge) return null;
  return (
    <div className="space-y-1">
      {presentes.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
          <Users className="h-3.5 w-3.5 shrink-0" />
          {presentes.map((p) => p.nome).join(", ")} também {presentes.length > 1 ? "estão" : "está"} nesta tela
        </div>
      )}
      {ultimoMerge && (ultimoMerge.atualizados > 0 || ultimoMerge.conflitos.length > 0) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Alguém salvou agora — {ultimoMerge.atualizados} campo(s) atualizado(s)
          {ultimoMerge.conflitos.length > 0 && <> · <b>{ultimoMerge.conflitos.length} em conflito</b> (escolha manter ou usar o novo em cada campo destacado)</>}
        </div>
      )}
    </div>
  );
}
