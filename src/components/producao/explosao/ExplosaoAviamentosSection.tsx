/**
 * ExplosaoAviamentosSection — bloco "Aviamentos necessários" da Explosão.
 *
 * Espelha a estrutura do ExplosaoMetragemSection (tecido), mas para aviamentos: agrega por
 * AVIAMENTO × VARIANTE (`variante_aviamento_id`) e mostra a quantidade total necessária =
 * Σ (consumo por peça) × grade total do modelo — a MESMA fórmula que o
 * `_enviar_modelo_para_cad_core` usa ao copiar o BOM p/ o CAD (`consumo * grade_total`).
 *
 * Fonte = `modelo_aviamentos` (BOM), pois é onde a variante do aviamento é preenchida.
 * A ÚNICA coluna editável é "A separar/enviar" (gate `editing`, mesmo lápis do painel) —
 * espelha o `metragem_enviada` do tecido; grava em `cad_aviamentos.quantidade_separar` por
 * aviamento×variante (RPC `salvar_explosao_aviamento_separar`). Aviamento legado SEM variante
 * aparece como linha "Sem variante" — nunca some; editá-la grava na(s) entrada(s) sem variante.
 */
import { Package } from "lucide-react";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { NumberInput } from "@/components/shared/NumberInput";
import { fmtNum, fmtNumEdit } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AviGrupo } from "@/lib/explosao-aviamentos";

type Props = {
  grupos: AviGrupo[];
  /** Grade total do modelo (Σ das grades planejadas) — exibida no cabeçalho como base do cálculo. */
  gradeTotalGeral: number;
  /** Modo de edição do painel (lápis). Fora dele, "A separar/enviar" fica read-only. */
  editing: boolean;
  /** Grava a nova "a separar" de um aviamento×variante (0 quando limpo). */
  onSepararChange: (aviamentoId: string, varianteId: string | null, valor: number) => void;
};

export function ExplosaoAviamentosSection({ grupos, gradeTotalGeral, editing, onSepararChange }: Props) {
  return (
    <div className="border rounded-[11px] overflow-hidden">
      <div className="flex items-center gap-2.5 flex-wrap px-3.5 py-2.5 border-b bg-muted/30">
        <Package className="h-4 w-4 text-muted-foreground shrink-0" />
        <b className="font-display text-sm">Aviamentos necessários</b>
        <span className="text-[11px] text-muted-foreground">
          necessária = consumo por peça × grade total ({fmtNum(gradeTotalGeral)}); só "a separar" é editável
        </span>
      </div>

      {grupos.length === 0 && (
        <p className="text-sm text-muted-foreground p-4">Nenhum aviamento neste modelo.</p>
      )}

      {grupos.map((g, i) => (
        <div key={g.aviamento_id} className={cn("p-3.5", i < grupos.length - 1 && "border-b")}>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-display font-semibold text-sm">{g.aviamento_nome}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              Necessário <b className="text-foreground num">{fmtNum(g.totalQtd)}</b>
            </span>
            <span className="text-[11px] text-muted-foreground">
              A separar <b className="text-foreground num">{fmtNum(g.totalSeparar)}</b>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border card-table">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-2 py-1 text-left">Variante</th>
                  <th className="px-2 py-1 text-right">Consumo/peça</th>
                  <th className="px-2 py-1 text-right">Qtd necessária</th>
                  <th className="px-2 py-1 text-right bg-primary/10 text-primary rounded-t">A separar/enviar</th>
                </tr>
              </thead>
              <tbody>
                {g.linhas.map((l) => (
                  <tr key={l.key} className="border-t">
                    <td className="px-2 py-1">
                      {l.variante_aviamento_id ? (
                        <>
                          <VarianteSwatch nome={l.cor ?? undefined} className="mr-1" />
                          {l.label}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Sem variante</span>
                      )}
                    </td>
                    <td className="px-2 py-1 num text-muted-foreground" data-label="Consumo/peça">
                      {fmtNumEdit(l.consumo) || "0"}
                    </td>
                    <td className="px-2 py-1 num text-muted-foreground" data-label="Qtd necessária">
                      {fmtNum(l.quantidade)}
                    </td>
                    <td className="px-2 py-1 bg-primary/5" data-label="A separar/enviar">
                      {editing ? (
                        <NumberInput
                          blankZero
                          placeholder="0,00"
                          className="ml-auto w-24 max-md:w-28 bg-card text-right font-semibold num"
                          value={l.aSeparar || ""}
                          onChange={(e) =>
                            onSepararChange(g.aviamento_id, l.variante_aviamento_id, Math.max(0, Number(e.target.value)))
                          }
                        />
                      ) : (
                        <span className="block text-right num font-semibold">{fmtNum(l.aSeparar)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
