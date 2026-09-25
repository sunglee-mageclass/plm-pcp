// "Atende a" (Distribuição por produto, spec R14–R16/R20): cada cor de forro/Tecido 2… diz a quais cores do Tecido 1 ela
// serve. Padrão = a mesma cor base (automático); marcar/desmarcar vira lista à mão; "↺ padrão" volta ao automático. O pç
// da cor é a soma das cores atendidas — quem deriva é a normalização do slot (PlanTecidoSheet); aqui só muda a amarração.
import { ChevronDown, RotateCcw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { fmtMetros, varKey } from "@/lib/plan-tecido/calc";
import { alternarAtende, type Atendimento } from "@/lib/plan-tecido/atendimento";
import type { PtVariante } from "@/lib/plan-tecido/types";

/** Path de presença do "atende a" (gatilho e opções — o anel dos outros cai no gatilho; as opções são portal). */
export const pathAtende = (materialKey: string, corKey: string): string => `pt-atende:${materialKey}:${corKey}`;

export function AtendeAPopover({ materialKey, cor, bloco, t1, at, consumo, rotulo, nomeCor, readOnly, onChange }: {
  materialKey: string;
  cor: PtVariante;
  bloco: PtVariante[];
  t1: PtVariante[];
  at: Atendimento;
  consumo: number;
  rotulo: "forro" | "tecido";
  nomeCor: (v: PtVariante) => string;
  readOnly: boolean;
  onChange: (atende: string[] | null) => void;
}) {
  const kb = varKey(cor);
  const servidas = at.porCor.get(kb) ?? [];
  const path = pathAtende(materialKey, kb);
  const t1Por = new Map(t1.map((v) => [varKey(v), v] as const));
  const parcelas = servidas.map((k) => Number(t1Por.get(k)?.grade_total) || 0);
  const total = parcelas.reduce((s, n) => s + n, 0);
  const nomeDono = (kt: string) => {
    const d = bloco.find((b) => varKey(b) === at.servidaPor.get(kt));
    return d ? nomeCor(d) : "—";
  };
  const resumo = servidas.map((k) => (t1Por.get(k) ? nomeCor(t1Por.get(k)!) : "")).filter(Boolean).join(", ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-colab-path={path}
          aria-label={`Atende a: ${resumo || "nenhuma cor do Tecido 1"}`}
          className="flex h-6 shrink-0 items-center gap-0.5 rounded border bg-background px-1 text-[10px] text-muted-foreground hover:bg-muted"
        >
          atende a
          {servidas.slice(0, 3).map((k) => {
            const v = t1Por.get(k);
            return <VarianteSwatch key={k} nome={v?.cor_nome ?? v?.label ?? undefined} />;
          })}
          {servidas.length > 3 && <span>+{servidas.length - 3}</span>}
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 text-xs">
        <p className="mb-1 font-semibold">Atende a · cores do Tecido 1</p>
        <div className="space-y-0.5">
          {t1.map((v) => {
            const kt = varKey(v);
            const dono = at.servidaPor.get(kt);
            const minha = dono === kb;
            const deOutra = !!dono && !minha;
            const padrao = !!v.cor_id && v.cor_id === cor.cor_id;
            return (
              <label key={kt} className={`flex items-center gap-2 rounded px-1 py-1 ${deOutra ? "opacity-55" : "hover:bg-muted"}`}>
                <Checkbox
                  checked={minha}
                  disabled={readOnly || deOutra}
                  data-colab-path={path}
                  aria-label={nomeCor(v)}
                  onCheckedChange={() => onChange(alternarAtende(at, kb, kt))}
                />
                <VarianteSwatch nome={v.cor_nome ?? v.label ?? undefined} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate">
                    {nomeCor(v)}
                    {padrao && <StatusBadge tone="neutral" className="px-1 py-0 normal-case tracking-normal">padrão</StatusBadge>}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {deOutra ? `já atendida por: ${nomeDono(kt)}` : padrao ? "mesma cor base (automático)" : minha ? "escolhida à mão" : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{Number(v.grade_total) || 0} pç</span>
              </label>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between border-t pt-1 font-medium">
          <span>pç deste {rotulo}</span>
          <span className="tabular-nums">{parcelas.length > 1 ? `${parcelas.join(" + ")} = ${total}` : total}</span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Padrão: a mesma cor base. Mudar aqui só troca a amarração — a metragem segue o consumo do {rotulo} ({fmtMetros(consumo)} m/pç).
        </p>
        {at.manual.has(kb) && !readOnly && (
          <Button variant="ghost" size="sm" className="mt-1 h-7 gap-1 text-[11px]" onClick={() => onChange(null)}>
            <RotateCcw className="h-3 w-3" />padrão (mesma cor base)
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
