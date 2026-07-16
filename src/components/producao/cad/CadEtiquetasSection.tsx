import { Tag, Trash2, AlertTriangle } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { EtiquetaRow } from "./types";

type EtqVar = { tamanho: string | null; cor_id: string | null; cor_nome: string | null; preco: number | null };
type Opt = { id: string; nome: string; tamanho: string | null; formato_tamanho: string; preco: number | null; variantes: EtqVar[] };

// "38|P" conforme o formato da etiqueta.
const fmtTam = (t: string, formato: string) => {
  const [num, sig] = t.split("|");
  if (!sig) return t;
  if (formato === "numero") return num;
  if (formato === "letra") return sig;
  return `${sig} · ${num}`;
};

// Etiquetas no CAD: escolhe a COR; o tamanho EXPLODE pela grade (uma qtd por tamanho),
// usando a variante (tamanho, cor). Avisa quando falta variante nessa cor.
export function CadEtiquetasSection({
  etiquetas, disponiveis, gradeTamanhos, gradeSumByTamanho, gradeTotalGeral, onUpdate, onAdd, onRemove,
}: {
  etiquetas: EtiquetaRow[];
  disponiveis: Opt[];
  gradeTamanhos: string[];
  gradeSumByTamanho: (tamanho: string) => number;
  gradeTotalGeral: number;
  onUpdate: (i: number, patch: Partial<EtiquetaRow>) => void;
  onAdd: (etiquetaId: string) => void;
  onRemove: (i: number) => void;
}) {
  const infoDe = (id: string) => disponiveis.find((d) => d.id === id);

  return (
    <Card className="p-5 max-md:p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Tag className="h-4 w-4" /> Explosão de Insumos</h2>
        <Select value="" onValueChange={(v) => v && onAdd(v)}>
          <SelectTrigger className="h-8 w-56 max-md:w-full"><SelectValue placeholder="Adicionar etiqueta…" /></SelectTrigger>
          <SelectContent>
            {disponiveis.length === 0 ? (
              <div className="p-2 text-xs text-muted-foreground">Cadastre em Cadastro &gt; Insumos.</div>
            ) : (
              disponiveis.map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)
            )}
          </SelectContent>
        </Select>
      </div>

      {etiquetas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma etiqueta. Vêm do Desenvolvimento ou adicione acima.</p>
      ) : (
        <div className="space-y-3">
          {etiquetas.map((e, i) => {
            const info = infoDe(e.etiqueta_id);
            const formato = info?.formato_tamanho ?? "ambos";
            const vars = info?.variantes ?? [];
            const semTamanho = formato === "nenhum" || vars.every((v) => !v.tamanho);
            const cores = (() => {
              const m = new Map<string, string>();
              vars.forEach((v) => { if (v.cor_id) m.set(v.cor_id, v.cor_nome ?? "—"); });
              return Array.from(m.entries()).map(([id, nome]) => ({ id, nome }));
            })();
            const temVar = (t: string | null) =>
              vars.some((v) => (v.tamanho ?? null) === (t ?? null) && (v.cor_id ?? null) === (e.cor_id ?? null));
            const faltando = semTamanho ? [] : gradeTamanhos.filter((t) => !temVar(t));
            return (
              <Card key={`${e.etiqueta_id}-${e.cor_id ?? ""}-${i}`} className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{info?.nome ?? e.etiqueta_nome}</span>
                  <Button type="button" size="iconSm" variant="ghost" onClick={() => onRemove(i)} aria-label="Remover">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <div className={cores.length > 0 ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
                  {/* Insumo colorido: cor é OBRIGATÓRIA (estoque por cor+tamanho). Sem cor → campo some. */}
                  {cores.length > 0 && (
                    <div className="grid gap-1">
                      <Label className="text-xs">Cor</Label>
                      <Select value={e.cor_id ?? ""} onValueChange={(v) => onUpdate(i, { cor_id: v || null })}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Escolha a cor" /></SelectTrigger>
                        <SelectContent>
                          {cores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="grid gap-1">
                    <Label className="text-xs">Consumo</Label>
                    <NumberInput type="number" step="0.0001" placeholder="0,00" value={e.consumo || ""} onChange={(ev) => onUpdate(i, { consumo: Number(ev.target.value) })} />
                  </div>
                </div>

                {faltando.length > 0 && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> Sem variante nesta cor para: {faltando.map((t) => fmtTam(t, formato)).join(", ")}.
                  </p>
                )}

                {/* Explosão pela grade (auto): qtd por tamanho = grade × consumo. */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border card-table">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-2 py-1 text-left">Tamanho</th>
                        <th className="px-2 py-1">Grade</th>
                        <th className="px-2 py-1">Qtd planejada</th>
                        <th className="px-2 py-1">Qtd a Enviar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {semTamanho ? (
                        <tr className="border-t">
                          <td className="px-2 py-1" data-label="Tamanho">Geral</td>
                          <td className="px-2 py-1 text-center" data-label="Grade">{gradeTotalGeral}</td>
                          <td className="px-2 py-1 text-center font-medium" data-label="Qtd planejada">{fmtNum(Number((e.consumo * gradeTotalGeral).toFixed(2)))}</td>
                          <td className="px-2 py-1" data-label="Qtd a Enviar">
                            <NumberInput type="number" step="0.01" className="max-md:w-28"
                              placeholder={fmtNum(Number((e.consumo * gradeTotalGeral).toFixed(2)))}
                              value={e.quantidade_enviar || ""}
                              onChange={(ev) => onUpdate(i, { quantidade_enviar: Number(ev.target.value) })} />
                          </td>
                        </tr>
                      ) : gradeTamanhos.length === 0 ? (
                        <tr className="border-t"><td colSpan={4} className="px-2 py-1 text-muted-foreground">Defina a grade para ver a explosão.</td></tr>
                      ) : (
                        gradeTamanhos.map((t) => {
                          const base = gradeSumByTamanho(t);
                          const planej = Number((e.consumo * base).toFixed(2));
                          return (
                            <tr key={t} className="border-t">
                              <td className="px-2 py-1" data-label="Tamanho">
                                {fmtTam(t, formato)}{!temVar(t) && <span className="text-amber-600" title="Sem variante nesta cor"> ⚠</span>}
                              </td>
                              <td className="px-2 py-1 text-center" data-label="Grade">{base}</td>
                              <td className="px-2 py-1 text-center font-medium" data-label="Qtd planejada">{fmtNum(planej)}</td>
                              <td className="px-2 py-1" data-label="Qtd a Enviar">
                                {temVar(t) ? (
                                  <NumberInput type="number" step="0.01" className="max-md:w-28"
                                    placeholder={fmtNum(planej)}
                                    value={e.enviarPorTamanho[t] ?? ""}
                                    onChange={(ev) => onUpdate(i, { enviarPorTamanho: { ...e.enviarPorTamanho, [t]: Number(ev.target.value) } })} />
                                ) : (
                                  <span className="text-xs text-muted-foreground" title="Sem variante nesta cor — cadastre a variante para consumir/baixar">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Card>
  );
}
