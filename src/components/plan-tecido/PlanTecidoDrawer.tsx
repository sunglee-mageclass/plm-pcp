import { Fragment } from "react";
import { X } from "lucide-react";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import type { SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";

export type DrawerKind = "comprar" | "oc" | "ocnum";
export type DrawerState = { kind: DrawerKind; arg: string | null };

const nMet = (n: number) => `${Math.round(n)}`;
const encomenda = (s: PtSlot) => !(s.usar_estoque ?? false);

/** Σ pedida/entregue/usada por variante, a partir das linhas da RPC (filtradas por OC se preciso). */
function situPorVariante(rows: SituacaoOcRow[]) {
  const m = new Map<string, { pedida: number; entregue: number; usada: number }>();
  for (const r of rows) {
    const cur = m.get(r.variante_tecido_id) ?? { pedida: 0, entregue: 0, usada: 0 };
    cur.pedida += r.pedida_m; cur.entregue += r.entregue_m; cur.usada += r.usada_m;
    m.set(r.variante_tecido_id, cur);
  }
  return m;
}

const sobraCls = (s: number) => (s < 0 ? "text-red-600" : "text-emerald-600");

export function PlanTecidoDrawer({
  state, subArvore, colecaoArvore, situacao, slotOcMap, ocNumeroDe, onClose,
}: {
  state: DrawerState;
  subArvore: PtArvore;
  colecaoArvore: PtArvore;
  situacao: SituacaoOcRow[];
  slotOcMap: Record<string, string[]>;
  ocNumeroDe: (ocId: string) => string | null;
  onClose: () => void;
}) {
  const { kind, arg } = state;

  // fonte das linhas = NECESSIDADE (tecidos planejados); OC entra por lookup de variante
  const nec =
    kind === "comprar"
      ? necessidadePorTecido(subArvore, encomenda)
      : kind === "ocnum" && arg
        ? necessidadePorTecido(colecaoArvore, (s) => encomenda(s) && !!s.id && (slotOcMap[s.id] ?? []).includes(arg))
        : necessidadePorTecido(colecaoArvore, encomenda);

  const situRows = kind === "ocnum" && arg ? situacao.filter((r) => r.oc_tecido_id === arg) : situacao;
  const situ = situPorVariante(situRows);
  const total = nec.reduce((a, t) => a + t.totalMetros, 0);

  const titulo =
    kind === "comprar" ? "A comprar — por tecido e variante"
      : kind === "ocnum" ? `${(arg && ocNumeroDe(arg)) || "OC"} — por tecido e variante`
        : "Situação da OC — por tecido e variante";
  const sub =
    kind === "comprar" ? `total ${nMet(total)} m`
      : kind === "ocnum" ? `${nec.length} tecido(s) atribuído(s)`
        : "coleção · valores das OCs (m)";

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold">{titulo}</h3>
          <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
        </div>
        <button type="button" onClick={onClose} className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {kind === "comprar" ? (
              <tr><th className="p-1.5 text-left font-medium">Tecido / variante</th><th className="p-1.5 text-right font-medium">Metragem</th></tr>
            ) : (
              <tr>
                <th className="p-1.5 text-left font-medium">Tecido / variante</th>
                <th className="p-1.5 text-right font-medium">Ped.</th>
                <th className="p-1.5 text-right font-medium">Entr.</th>
                <th className="p-1.5 text-right font-medium">Res.</th>
                <th className="p-1.5 text-right font-medium">Usada</th>
                <th className="p-1.5 text-right font-medium">Sobra</th>
              </tr>
            )}
          </thead>
          <tbody>
            {nec.length === 0 ? (
              <tr><td colSpan={kind === "comprar" ? 2 : 6} className="p-3 text-center text-muted-foreground">
                {kind === "ocnum" ? "Nenhum modelo atribuído a esta OC — use “OC vinculada” no card." : "Nenhum tecido planejado."}
              </td></tr>
            ) : nec.map((t) => (
              <Fragment key={t.artigo_id}>
                <tr className="border-t bg-muted/40">
                  <td className="p-1.5 font-medium" colSpan={kind === "comprar" ? 1 : 6}>{t.artigo_nome}</td>
                  {kind === "comprar" && <td className="p-1.5 text-right font-medium">{nMet(t.totalMetros)} m</td>}
                </tr>
                {t.variantes.map((v) => {
                  const s = situ.get(v.variante_tecido_id) ?? { pedida: 0, entregue: 0, usada: 0 };
                  const sobra = s.pedida - v.metros; // sobra prevista = pedida − reservada
                  return (
                    <tr key={v.variante_tecido_id} className="border-t">
                      <td className="p-1.5">
                        <span className="flex min-w-0 items-center gap-1">
                          <VarianteSwatch nome={v.cor_nome ?? v.label} /><span className="truncate">{v.label || "—"}</span>
                        </span>
                      </td>
                      {kind === "comprar" ? (
                        <td className="p-1.5 text-right">{nMet(v.metros)} m</td>
                      ) : (
                        <>
                          <td className="p-1.5 text-right">{nMet(s.pedida)}</td>
                          <td className="p-1.5 text-right">{nMet(s.entregue)}</td>
                          <td className="p-1.5 text-right text-muted-foreground">{nMet(v.metros)}</td>
                          <td className="p-1.5 text-right">{nMet(s.usada)}</td>
                          <td className={`p-1.5 text-right font-medium ${sobraCls(sobra)}`}>{sobra > 0 ? "+" : ""}{nMet(sobra)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
