// Resumo AUTOMÁTICO da coleção/subcoleção (demonstrativo, read-only). Deriva dos modelos reais
// via RPC distribuicao_resumo. Mostra total de grade, roupa×acessório, repetições, grade por
// tamanho, % por categoria (roupa) e % por linha.

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type ResumoData = {
  n_modelos: number;
  total_grade: number;
  repeticoes: number;
  grade_por_tamanho: Record<string, number>;
  roupa: number;
  acessorio: number;
  por_categoria: { nome: string; qtd: number }[];
  por_linha: { nome: string; qtd: number }[];
};

// rótulo do tamanho a partir da chave "num|sigla" (ou "UN").
function labelTam(k: string): string {
  return k.includes("|") ? k.split("|")[0] : k;
}

function Barras({ itens, total }: { itens: { nome: string; qtd: number }[]; total: number }) {
  return (
    <div className="flex flex-col gap-1.5 mt-1.5">
      {itens.map((it) => {
        const pct = total > 0 ? Math.round((it.qtd / total) * 100) : 0;
        return (
          <div key={it.nome} className="flex items-center gap-2 text-xs">
            <span className="w-20 truncate">{it.nome}</span>
            <span className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <span className="block h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </span>
            <span className="w-9 text-right tabular-nums text-muted-foreground">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

export function ResumoColecao({ resumo }: { resumo: ResumoData }) {
  const totCat = resumo.roupa; // % por categoria é sobre as roupas
  const totLinha = resumo.por_linha.reduce((a, b) => a + b.qtd, 0);
  const totRA = resumo.roupa + resumo.acessorio;
  const tams = Object.keys(resumo.grade_por_tamanho);

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="font-display text-sm font-semibold mb-3 flex items-center gap-2">
        Resumo da coleção
        <Badge variant="secondary" className="font-normal">automático · apenas demonstrativo</Badge>
      </h2>
      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total de grade</div>
          <div className="font-display text-2xl font-semibold tabular-nums mt-0.5">
            {resumo.total_grade.toLocaleString("pt-BR")} <span className="text-xs font-normal text-muted-foreground">peças</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{resumo.n_modelos} modelos</div>
        </Card>

        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Roupa × Acessório</div>
          <Barras itens={[{ nome: "Roupa", qtd: resumo.roupa }, { nome: "Acessório", qtd: resumo.acessorio }]} total={totRA} />
        </Card>

        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Repetições (versão)</div>
          <div className="font-display text-2xl font-semibold tabular-nums mt-0.5">{resumo.repeticoes}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">modelos versionados (reposição)</div>
        </Card>

        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Grade por tamanho</div>
          <div className="grid gap-1.5 mt-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(tams.length, 6)}, minmax(0,1fr))` }}>
            {tams.map((k) => (
              <div key={k} className="border rounded-md px-1 py-1 text-center">
                <div className="text-[10px] text-muted-foreground">{labelTam(k)}</div>
                <div className="text-xs font-semibold tabular-nums">{resumo.grade_por_tamanho[k]}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-3 md:col-span-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">% por categoria (roupa)</div>
          {resumo.por_categoria.length ? <Barras itens={resumo.por_categoria} total={totCat} /> : <p className="text-xs text-muted-foreground mt-1">Sem roupas.</p>}
        </Card>

        <Card className="p-3 md:col-span-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">% por linha</div>
          {resumo.por_linha.length ? <Barras itens={resumo.por_linha} total={totLinha} /> : <p className="text-xs text-muted-foreground mt-1">Sem linhas.</p>}
        </Card>
      </div>
    </Card>
  );
}
