import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cadeiaValores } from "@/lib/produto-acabado";
import { fmtMoney, somaPecas, type ProdutoDraft } from "./shared";

/** Bloco colapsável do Resumo — mesmo padrão de src/components/plan-tecido/ResumoPanel.tsx
 *  (`Secao`): header com chevron + título, estado próprio por bloco. */
function Secao({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 border-b p-2 text-left font-display text-xs font-semibold"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="flex-1">{title}</span>
      </button>
      {open && children}
    </div>
  );
}

/**
 * Rail esquerdo colapsável do canvas (§M) — réplica dos padrões visuais de ResumoPanel.tsx
 * (Plan. Tecido), adaptados às métricas de revenda: Poder de venda, Custo previsto,
 * Produtos·peças, OTB comprometido (barra) e Tipos de itens por categoria.
 */
export function ResumoRevendaPanel({
  produtos,
  categoriaNome,
  otbAlvo,
}: {
  produtos: ProdutoDraft[];
  categoriaNome: (id: string | null) => string;
  /** Σ colecao_semanas.qtd_planejada da subcoleção ativa (null = sem alvo/coleção sem OTB). */
  otbAlvo: number | null;
}) {
  const totalPecas = produtos.reduce((a, p) => a + somaPecas(p), 0);
  // Poder de venda = Σ preco_venda do espelho × peças do produto (§ regra preco.ts — aqui o
  // preço é digitado no Plan. Produto, não derivado por markup; produto sem espelho não conta).
  const poderVenda = produtos.reduce((a, p) => a + (p.modeloPrecoVenda ?? 0) * somaPecas(p), 0);
  const comFornec = produtos.filter((p) => p.modeloPrecoVenda != null).length;
  // Custo previsto = Σ valor com desconto (cadeia bruto→desconto da própria compra).
  const custoPrevisto = produtos.reduce((a, p) => a + cadeiaValores(p.qtd_total, p.valor_unitario, p.desconto_pct).totalDesc, 0);

  const pctOtb = otbAlvo && otbAlvo > 0 ? Math.min(100, Math.round((totalPecas / otbAlvo) * 100)) : null;

  const porCategoria = new Map<string, { nome: string; produtos: number; pecas: number }>();
  for (const p of produtos) {
    const key = p.categoria_id ?? "__sem__";
    const cur = porCategoria.get(key) ?? { nome: p.categoria_id ? categoriaNome(p.categoria_id) : "Sem categoria", produtos: 0, pecas: 0 };
    cur.produtos += 1;
    cur.pecas += somaPecas(p);
    porCategoria.set(key, cur);
  }
  const tipos = [...porCategoria.entries()].sort(([a], [b]) => (a === "__sem__" ? 1 : b === "__sem__" ? -1 : porCategoria.get(a)!.nome.localeCompare(porCategoria.get(b)!.nome, "pt-BR")));

  return (
    <div className="space-y-2">
      <Secao title="Poder de venda (previsto)">
        {comFornec > 0 ? (
          <div className="p-2">
            <div className="flex justify-between text-xs"><span>Σ preço × peças</span><b>{fmtMoney(poderVenda)}</b></div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{comFornec} de {produtos.length} produtos com card/preço</div>
          </div>
        ) : (
          <div className="p-2 text-[11px] text-muted-foreground">Aparece quando um produto tiver card com preço para venda.</div>
        )}
      </Secao>

      <Secao title="Custo previsto">
        <div className="p-2">
          <div className="flex justify-between text-xs"><span>Σ valor c/ desconto</span><b>{fmtMoney(custoPrevisto)}</b></div>
        </div>
      </Secao>

      <Secao title="Produtos · peças">
        <div className="p-2">
          <div className="flex justify-between text-xs"><span>Produtos</span><b>{produtos.length}</b></div>
          <div className="flex justify-between text-xs"><span>Peças</span><b>{totalPecas}</b></div>
        </div>
      </Secao>

      <Secao title="OTB comprometido">
        {otbAlvo != null ? (
          <div className="p-2">
            <div className="flex justify-between text-xs">
              <span>{totalPecas} / {otbAlvo} pç</span>
              {pctOtb != null && <b className={pctOtb >= 100 ? "text-emerald-700" : "text-foreground"}>{pctOtb}%</b>}
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${pctOtb != null && pctOtb >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pctOtb ?? 0}%` }} />
            </div>
          </div>
        ) : (
          <div className="p-2 text-[11px] text-muted-foreground">Sem alvo de OTB para esta subcoleção.</div>
        )}
      </Secao>

      <Secao title="Tipos de itens">
        {tipos.length ? tipos.map(([key, t]) => (
          <div key={key} className="flex items-center justify-between gap-2 border-b px-2 py-1.5 text-xs last:border-b-0">
            <span className={`truncate ${key === "__sem__" ? "text-muted-foreground" : ""}`}>{t.nome}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{t.produtos} produto(s) · {t.pecas} pç</span>
          </div>
        )) : (
          <div className="p-2 text-[11px] text-muted-foreground">Nenhum produto ainda.</div>
        )}
      </Secao>
    </div>
  );
}
