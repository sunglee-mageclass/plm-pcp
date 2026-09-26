// Distribuição por produto → Direcionamento: card "Plano de distribuição do modelo" (spec §5.3, R34). Só leitura — o plano
// SALVO do Plan. Tecido (loja × variante × tamanho). "Preencher com o plano" só mexe no RASCUNHO da tela (R22).
import { Fragment } from "react";
import { Wand2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TEXTO_MOTIVO_SEM_PLANO, celulaPlano, totalPlanoVariante, type MotivoSemPlano, type PlanoModelo } from "@/lib/direcionamento-plano";

const CEL = "border px-2 py-1 text-center";
const COL1 = "sticky left-0 z-10 border px-2 py-1 text-left";

export function PlanoDoModeloCard({ plano, motivo, tamanhos, rotuloTam, rotuloVariante, podePreencher, onPreencher }: {
  plano: PlanoModelo | null;
  motivo: MotivoSemPlano | null;
  tamanhos: string[];
  rotuloTam: (t: string) => string;
  rotuloVariante: (vnum: number) => string;
  podePreencher: boolean;
  onPreencher: () => void;
}) {
  const vnums = (plano?.variantes ?? []).filter((v) => v.variante_numero != null).map((v) => v.variante_numero as number);
  const totalTam = (t: string) => vnums.reduce((s, vn) => s + (totalPlanoVariante(plano, vn).porTamanho[t] ?? 0), 0);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-base font-semibold">Plano de distribuição do modelo</h2>
        <StatusBadge tone="neutral">só leitura</StatusBadge>
        <span className="text-xs text-muted-foreground">do Plan. Tecido › Distribuir por loja</span>
        {plano && (
          <Button variant="outline" size="sm" className="ml-auto max-sm:h-11" onClick={onPreencher} disabled={!podePreencher}
            title="Reaplica a regra: preenche onde bate com a Grade Real">
            <Wand2 className="mr-1 h-4 w-4" />Preencher com o plano
          </Button>
        )}
      </div>
      {!plano ? (
        <p className="text-sm text-muted-foreground">Sem plano — {TEXTO_MOTIVO_SEM_PLANO[motivo ?? "sem_distribuicao"]}.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm tabular-nums" aria-label="Plano de distribuição do modelo">
              <thead className="!bg-muted">
                <tr>
                  <th className={`${COL1} !bg-muted`}>Loja / Variante</th>
                  {tamanhos.map((t) => <th key={t} className={CEL}>{rotuloTam(t)}</th>)}
                  <th className={CEL}>Total</th>
                </tr>
              </thead>
              <tbody>
                {plano.lojas.map((l) => {
                  const sub = tamanhos.map((t) => vnums.reduce((s, vn) => s + (celulaPlano(plano, l.loja_id, vn, t) ?? 0), 0));
                  return (
                    <Fragment key={l.loja_id}>
                      <tr className={`!bg-secondary font-semibold ${l.ativo ? "" : "text-muted-foreground"}`}>
                        <td className={`${COL1} !bg-secondary`}>{l.nome}{l.ativo ? "" : " (inativa)"}</td>
                        {sub.map((q, i) => <td key={tamanhos[i]} className={CEL}>{q}</td>)}
                        <td className={CEL}>{sub.reduce((s, q) => s + q, 0)}</td>
                      </tr>
                      {vnums.map((vn) => {
                        const tem = plano.celulas.some((c) => c.loja_id === l.loja_id && c.variante_numero === vn);
                        const qs = tamanhos.map((t) => celulaPlano(plano, l.loja_id, vn, t) ?? 0);
                        return (
                          <tr key={vn}>
                            <td className={`${COL1} !bg-background pl-4`}>{rotuloVariante(vn)}</td>
                            {qs.map((q, i) => <td key={tamanhos[i]} className={`${CEL} text-muted-foreground`}>{tem ? q : "—"}</td>)}
                            <td className={CEL}>{tem ? qs.reduce((s, q) => s + q, 0) : "—"}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className={`${COL1} !bg-background`}>Total do plano</td>
                  {tamanhos.map((t) => <td key={t} className={CEL}>{totalTam(t)}</td>)}
                  <td className={CEL}>{tamanhos.reduce((s, t) => s + totalTam(t), 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {plano.sem_correspondencia.length > 0 && (
            <p className="text-xs text-amber-700">
              Cor do plano sem variante neste modelo (ex.: cor planejada) — fica fora do preenchimento:{" "}
              {plano.sem_correspondencia.map((s) => `${[s.cor_nome, s.apelido_nome].filter(Boolean).join(" · ") || "—"} (${s.total})`).join(", ")}.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            O plano é o que foi distribuído no Plan. Tecido (com as correções feitas à mão). “Preencher com o plano” reaplica a regra abaixo, para recomeçar.
          </p>
        </>
      )}
    </Card>
  );
}
