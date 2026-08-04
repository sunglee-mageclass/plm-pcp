/**
 * ExplosaoMetragemSection — hero "Quanto separar / enviar" da Explosão.
 *
 * Componente PRÓPRIO da Explosão (NÃO é o `CadTecidosSection`, que é compartilhado com a
 * página CAD — mexer nele afeta as duas telas). Aqui o resto do CAD (consumo, % loss,
 * custo, tamanho da folha, qtd. de folhas, metr. planejada) é SEMPRE somente-leitura como
 * texto puro; a ÚNICA coluna editável é "Metr. a Separar/Enviar", e só em modo edição
 * (gate `editing` — o mesmo lápis/trava do painel).
 */
import { AlertTriangle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/shared/NumberInput";
import { EtiquetaLavagemArtigoView } from "@/components/shared/EtiquetaLavagemArtigo";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { fmtNum } from "@/lib/format";
import { varianteLabel } from "@/lib/variante";
import { cn } from "@/lib/utils";
import type { TecidoRow, VarianteRow } from "@/components/producao/cad/types";

type Props = {
  tecidos: TecidoRow[];
  updateVar: (i: number, j: number, patch: Partial<VarianteRow>) => void;
  /** Modo de edição do painel (lápis). Fora dele, "Metr. a Separar/Enviar" e os botões
   *  "Usar planejada" ficam travados/ocultos — só dá pra reenviar o que já estava salvo. */
  editing: boolean;
  /** Copia metragem_planejada → metragem_enviada em TODAS as variantes DESTE tecido. */
  onUsarPlanejadaTecido: (tecidoIndex: number) => void;
  /** Copia metragem_planejada → metragem_enviada em TODAS as variantes de TODOS os tecidos. */
  onUsarPlanejadaTudo: () => void;
};

export function ExplosaoMetragemSection({
  tecidos,
  updateVar,
  editing,
  onUsarPlanejadaTecido,
  onUsarPlanejadaTudo,
}: Props) {
  const separarReadOnly = !editing;

  return (
    <div className="border rounded-[11px] overflow-hidden">
      <div className="flex items-center gap-2.5 flex-wrap px-3.5 py-2.5 border-b bg-muted/30">
        <b className="font-display text-sm">Quanto separar / enviar</b>
        <span className="text-[11px] text-muted-foreground">
          só esta coluna é editável — o resto vem do CAD
        </span>
        {editing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onUsarPlanejadaTudo}
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            Usar planejada em tudo
          </Button>
        )}
      </div>

      {tecidos.length === 0 && (
        <p className="text-sm text-muted-foreground p-4">Nenhum tecido planejado neste modelo.</p>
      )}

      {tecidos.map((t, i) => {
        const zeradas = t.variantes.filter(
          (v) => Number(v.metragem_planejada ?? 0) > 0 && Number(v.metragem_enviada ?? 0) === 0,
        ).length;
        return (
          <div
            key={`${t.tipo}-${t.numero}-${i}`}
            className={cn("p-3.5", i < tecidos.length - 1 && "border-b")}
          >
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge variant="secondary" className="capitalize shrink-0">
                {t.tipo} {t.numero}
              </Badge>
              <span className="font-display font-semibold text-sm">
                {t.artigo_nome ?? "Sem artigo"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                R$ {fmtNum(t.preco)}/m
                {Number(t.largura ?? 0) > 0 ? ` · largura ${fmtNum(t.largura)} m` : ""}
              </span>
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-primary h-7 px-2 text-[11px] shrink-0"
                  onClick={() => onUsarPlanejadaTecido(i)}
                >
                  Usar planejada
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3.5 flex-wrap mb-2.5">
              {t.artigo_id && <EtiquetaLavagemArtigoView artigoId={t.artigo_id} size="sm" />}
              <div className="flex flex-wrap gap-3.5 items-center text-[11px] text-muted-foreground">
                <span>
                  Consumo CAD{" "}
                  <b className="text-foreground tabular-nums">{fmtNum(t.consumo_cad)} m</b>
                </span>
                <span>
                  % Loss{" "}
                  <b className="text-foreground tabular-nums">{fmtNum(t.loss_percent_cad)}</b>
                </span>
                <span>
                  Custo CAD <b className="text-foreground tabular-nums">R$ {fmtNum(t.custo_cad)}</b>
                </span>
                {/* Tamanho da folha EM DESTAQUE — pedido do dono. */}
                <span className="text-primary font-medium">
                  Tamanho da folha <b className="tabular-nums">{fmtNum(t.tamanho_folha)} m</b>
                </span>
              </div>
            </div>

            {t.variantes.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border card-table">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1 text-left">Variante</th>
                      <th className="px-2 py-1 text-right">Qtd Folhas</th>
                      <th className="px-2 py-1 text-right">Metr. Planejada</th>
                      <th className="px-2 py-1 text-right bg-primary/10 text-primary rounded-t">
                        Metr. a Separar/Enviar
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.variantes.map((v, j) => (
                      <tr key={`${v.variante_tecido_id}-${j}`} className="border-t">
                        <td className="px-2 py-1">
                          <VarianteSwatch nome={v.variante_cor ?? undefined} className="mr-1" />
                          {varianteLabel({
                            nome: v.variante_nome,
                            cor: v.variante_cor,
                            apelido: v.variante_apelido,
                          })}
                        </td>
                        <td
                          className="px-2 py-1 text-right tabular-nums text-muted-foreground"
                          data-label="Qtd Folhas"
                        >
                          {fmtNum(v.quantidade_folhas)}
                        </td>
                        <td
                          className="px-2 py-1 text-right tabular-nums text-muted-foreground"
                          data-label="Metr. Planejada"
                        >
                          {fmtNum(v.metragem_planejada)}
                        </td>
                        <td className="px-2 py-1 bg-primary/5" data-label="Metr. a Separar/Enviar">
                          {separarReadOnly ? (
                            <span className="block text-right tabular-nums font-semibold">
                              {fmtNum(v.metragem_enviada)}
                            </span>
                          ) : (
                            <NumberInput
                              type="number"
                              step="0.01"
                              placeholder="0,00"
                              className="ml-auto w-24 max-md:w-28 bg-card text-right font-semibold"
                              value={v.metragem_enviada || ""}
                              onChange={(e) =>
                                updateVar(i, j, {
                                  metragem_enviada: Math.max(0, Number(e.target.value)),
                                })
                              }
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {zeradas > 0 && (
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-warning flex-wrap">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>
                  <b>
                    {zeradas} variante{zeradas > 1 ? "s" : ""} zerada{zeradas > 1 ? "s" : ""}
                  </b>{" "}
                  — não será separada.
                </span>
                {editing && (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => onUsarPlanejadaTecido(i)}
                  >
                    Usar planejada
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
