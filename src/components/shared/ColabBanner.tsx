// Banner de colaboração: presença ("Fulano também está aqui") + resultado de merge
// ("Alguém salvou agora — N campos atualizados · M em conflito") + RESOLUÇÃO GENÉRICA
// de cada conflito pendente (rótulo + "meu" vs "novo" + manter/usar o novo).
//
// Por que a resolução no banner (round 4): o merge 3-vias (`mergeDraft`) compara TODAS as
// chaves do Draft — um conflito pode nascer em campos SEM UI de resolução inline
// (Fornecedor, Responsável, Obs. de entrega, parcelas…). O guard do save bloqueia salvar
// enquanto houver QUALQUER conflito; sem uma saída genérica, um conflito em campo não
// instrumentado deixava o Salvar travado pra sempre (deadlock). Aqui TODO conflito ganha
// botões "manter meu · usar o novo". Os campos com UI inline (numero_pedido/datas/prazo/
// linhas) continuam com sua resolução própria — as duas vias chamam o mesmo `onResolver`.
import { Users, AlertTriangle } from "lucide-react";
import type { Conflito } from "@/lib/colab/merge";
import type { PresencaColab } from "@/hooks/useColabRegistro";

// Formata um valor de campo curto p/ o banner: objetos/arrays viram resumo ("[3 itens]"),
// escalares viram texto truncado; null/vazio vira "—".
function resumoValor(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return `[${v.length} ${v.length === 1 ? "item" : "itens"}]`;
  if (typeof v === "object") {
    const n = Object.keys(v as object).length;
    return `[${n} ${n === 1 ? "campo" : "campos"}]`;
  }
  if (typeof v === "boolean") return v ? "sim" : "não";
  const s = String(v).trim();
  if (s === "") return "—";
  return s.length > 48 ? s.slice(0, 48) + "…" : s;
}

export function ColabBanner({ presentes, ultimoMerge, conflitos, onResolver, rotulo }: {
  presentes: PresencaColab[];
  ultimoMerge: { atualizados: number; conflitos: Conflito[] } | null;
  // Colab round 4 — resolução genérica (props opcionais/retrocompatíveis):
  conflitos?: Conflito[];
  onResolver?: (path: string, escolha: "meu" | "dele") => void;
  rotulo?: (path: string) => string;
}) {
  const pendentes = conflitos ?? [];
  if (presentes.length === 0 && !ultimoMerge && pendentes.length === 0) return null;
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
          {ultimoMerge.conflitos.length > 0 && <> · <b>{ultimoMerge.conflitos.length} em conflito</b> (escolha manter ou usar o novo em cada item abaixo)</>}
        </div>
      )}
      {pendentes.length > 0 && onResolver && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
          <div className="mb-1.5 flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {pendentes.length === 1 ? "1 conflito a resolver" : `${pendentes.length} conflitos a resolver`} antes de salvar
          </div>
          <ul className="space-y-1.5">
            {pendentes.map((c) => (
              <li key={c.path} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-amber-900 dark:text-amber-200">{(rotulo ? rotulo(c.path) : c.path)}:</span>
                <span className="text-amber-700 dark:text-amber-400">
                  meu <b>{resumoValor(c.meu)}</b> · novo <b>{resumoValor(c.dele)}</b>
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <button type="button" className="underline underline-offset-2 text-amber-800 dark:text-amber-300" onClick={() => onResolver(c.path, "meu")}>manter meu</button>
                  <span aria-hidden className="text-amber-400">·</span>
                  <button type="button" className="underline underline-offset-2 text-amber-800 dark:text-amber-300" onClick={() => onResolver(c.path, "dele")}>usar o novo</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
