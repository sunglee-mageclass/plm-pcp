import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/shared/DateField";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GradeDestrinchada } from "./GradeDestrinchada";
import { TEXTO_GRAVA_AO_SALVAR } from "@/lib/oc-multi-itens";
import { somaGrade, type GradeDetalhe, type VarianteDraft } from "./shared";

export type ColaboradorOpt = { id: string; nome: string };

/** Os campos de recebimento DE UM PRODUTO da OC (iguais no Produto Acabado e no Importado). */
export type RecebimentoValor = {
  data_entrega: string;
  nota_fiscal: string;
  responsavel_recebimento_id: string | null;
  devolucao: string;
  revisao: string;
};

/**
 * "Recebimento deste produto" (R13): data de entrega, NF, responsável, revisão, devolução e as grades recebida/defeito DE UM item da OC.
 * Genérico: a OC de Produto Acabado (T7) e a de Importado (T8) usam o mesmo bloco — o botão "Marcar este produto como recebido" e o
 * aviso de pendência chegam em `rodape` (quem usa sabe a RPC). A Data da Nota de Entrada NÃO é daqui: é do cabeçalho da OC.
 *
 * `pathPrefix` (`item:<id>:`) deixa único o caminho de presença de cada campo (vários produtos na mesma tela).
 */
export function OcPaRecebimento({
  valor, onChange, variantes, tamanhos, grade, onGradeChange, labelVariante, colaboradores, readOnly = false, pathPrefix = "", rodape,
  mostrarAvisoGravaAoSalvar = false,
}: {
  valor: RecebimentoValor;
  onChange: (patch: Partial<RecebimentoValor>) => void;
  variantes: VarianteDraft[];
  tamanhos: string[];
  grade: GradeDetalhe;
  onGradeChange: (next: GradeDetalhe) => void;
  labelVariante: (v: VarianteDraft) => string;
  colaboradores: ColaboradorOpt[];
  readOnly?: boolean;
  pathPrefix?: string;
  /** Botão de marcar recebido + dica do que falta. */
  rodape?: ReactNode;
  /** Item ainda não recebido: avisa que NF/responsável/revisão/devolução/data são gravados no Salvar e que "recebido" é uma ação à parte. */
  mostrarAvisoGravaAoSalvar?: boolean;
}) {
  const somaPedida = somaGrade(grade, tamanhos, "pedida");
  const somaRecebida = somaGrade(grade, tamanhos, "recebida");
  const somaDefeito = somaGrade(grade, tamanhos, "defeito");
  const somaReal = Math.max(0, somaRecebida - somaDefeito);
  const rotulo = (ordem: number) => {
    const v = variantes.find((x) => x.ordem === ordem);
    return v ? labelVariante(v) : `Variante ${ordem}`;
  };

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold tracking-wide text-muted-foreground">Recebimento deste produto</div>
      {mostrarAvisoGravaAoSalvar && !readOnly && <p className="text-xs text-muted-foreground">{TEXTO_GRAVA_AO_SALVAR}</p>}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="grid gap-1">
          <Label>Data de entrega</Label>
          <DateField value={valor.data_entrega} disabled={readOnly} data-colab-path={`${pathPrefix}data_entrega`} onChange={(e) => onChange({ data_entrega: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label>Nota Fiscal (nº)</Label>
          <Input value={valor.nota_fiscal} disabled={readOnly} data-colab-path={`${pathPrefix}nota_fiscal`} onChange={(e) => onChange({ nota_fiscal: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label>Responsável pelo recebimento</Label>
          <Select value={valor.responsavel_recebimento_id ?? ""} onValueChange={(v) => onChange({ responsavel_recebimento_id: v || null })} disabled={readOnly}>
            <SelectTrigger data-colab-path={`${pathPrefix}responsavel_recebimento_id`}><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              {colaboradores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Revisão</Label>
          <Textarea value={valor.revisao} disabled={readOnly} data-colab-path={`${pathPrefix}revisao`} onChange={(e) => onChange({ revisao: e.target.value })} />
        </div>
        <div className="sm:col-span-2 grid gap-1">
          <Label>Devolução</Label>
          <Textarea value={valor.devolucao} disabled={readOnly} data-colab-path={`${pathPrefix}devolucao`} onChange={(e) => onChange({ devolucao: e.target.value })} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Grade recebida (destrinchada)</Label>
        <GradeDestrinchada
          variantes={variantes} tamanhos={tamanhos} grade={grade} campo="recebida" onChange={onGradeChange}
          labelFor={rotulo} disabled={readOnly} pathPrefix={pathPrefix}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Grade com defeito (destrinchada)</Label>
        <GradeDestrinchada
          variantes={variantes} tamanhos={tamanhos} grade={grade} campo="defeito" onChange={onGradeChange}
          labelFor={rotulo} disabled={readOnly} pathPrefix={pathPrefix}
        />
      </div>

      <InfoStrip
        itens={[
          { label: "Σ pedida", valor: somaPedida },
          { label: "Σ recebida", valor: somaRecebida },
          { label: "Σ defeito", valor: somaDefeito },
          { label: "Grade real (recebida − defeito)", valor: somaReal, hi: true },
        ]}
      />

      {rodape && <div className="flex flex-wrap items-center gap-2">{rodape}</div>}
    </div>
  );
}
