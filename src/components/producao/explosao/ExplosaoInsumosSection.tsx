/**
 * ExplosaoInsumosSection — bloco "Insumos / Etiquetas" da Explosão (set/2026).
 *
 * Espelha o ExplosaoAviamentosSection, mas para etiquetas (cad_etiquetas). Cada linha é uma
 * etiqueta × cor com: consumo por peça, quantidade necessária (consumo × grade total) e a
 * ÚNICA coluna editável — "A separar/enviar" (gate `editing`, mesmo lápis do painel), que grava
 * em `cad_etiquetas.quantidade_enviar` pela `id` (RPC `salvar_explosao_etiqueta_enviar`).
 *
 * Aparece para TODOS os modelos que têm etiqueta no CAD. Para a REVENDA é a peça-chave: a troca
 * de etiqueta é separada aqui (a etiqueta é materializada no recebimento da OC — ver
 * _receber_oc_p_acabado_core). Modelo sem etiqueta no CAD ⇒ a seção não aparece (linhas vazias).
 */
import { Tag } from "lucide-react";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { NumberInput } from "@/components/shared/NumberInput";
import { fmtNum, fmtNumEdit } from "@/lib/format";

export type InsumoLinha = {
  /** id da linha em cad_etiquetas (chave de gravação). */
  id: string;
  etiqueta_nome: string;
  /** Nome da cor (só p/ o swatch — o banco não guarda hex). */
  cor?: string | null;
  cor_label?: string | null;
  /** consumo por peça (cad_etiquetas.consumo). */
  consumo: number;
  /** consumo × grade total do modelo (qtd necessária p/ toda a grade). */
  quantidade: number;
  /** Qtd a enviar/separar (cad_etiquetas.quantidade_enviar). Editável na Explosão. */
  aEnviar: number;
};

type Props = {
  linhas: InsumoLinha[];
  /** Grade total do modelo (Σ das grades planejadas) — exibida no cabeçalho como base do cálculo. */
  gradeTotalGeral: number;
  /** Modo de edição do painel (lápis). Fora dele, "A separar/enviar" fica read-only. */
  editing: boolean;
  /** Grava a nova "a enviar" de uma linha de etiqueta (0 quando limpo). */
  onEnviarChange: (id: string, valor: number) => void;
};

export function ExplosaoInsumosSection({ linhas, gradeTotalGeral, editing, onEnviarChange }: Props) {
  // Sem etiqueta no CAD: não renderiza nada (não polui a tela dos modelos que não usam insumo).
  if (linhas.length === 0) return null;

  const totalEnviar = linhas.reduce((s, l) => s + l.aEnviar, 0);

  return (
    <div className="border rounded-[11px] overflow-hidden">
      <div className="flex items-center gap-2.5 flex-wrap px-3.5 py-2.5 border-b bg-muted/30">
        <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
        <b className="font-display text-sm">Insumos / Etiquetas</b>
        <span className="text-[11px] text-muted-foreground">
          necessária = consumo por peça × grade total ({fmtNum(gradeTotalGeral)}); só "a enviar" é editável
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          A enviar <b className="text-foreground num">{fmtNum(totalEnviar)}</b>
        </span>
      </div>

      <div className="overflow-x-auto p-3.5">
        <table className="w-full text-xs border card-table">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-2 py-1 text-left">Etiqueta / Insumo</th>
              <th className="px-2 py-1 text-right">Consumo/peça</th>
              <th className="px-2 py-1 text-right">Qtd necessária</th>
              <th className="px-2 py-1 text-right bg-primary/10 text-primary rounded-t">A separar/enviar</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-2 py-1">
                  {l.cor ? <VarianteSwatch nome={l.cor} className="mr-1" /> : null}
                  {l.etiqueta_nome}
                  {l.cor_label ? <span className="text-muted-foreground"> · {l.cor_label}</span> : null}
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
                      value={l.aEnviar || ""}
                      onChange={(e) => onEnviarChange(l.id, Math.max(0, Number(e.target.value)))}
                    />
                  ) : (
                    <span className="block text-right num font-semibold">{fmtNum(l.aEnviar)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
