import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cadeiaValores } from "@/lib/produto-acabado";
import type { Bucket } from "@/components/otb/orcamento";
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
 * Produtos·peças, OTB comprometido (barra) e Tipos de itens — por categoria OU por grupo,
 * seguindo o toggle de agrupamento do canvas (`agruparPor`).
 */
export function ResumoRevendaPanel({
  produtos,
  agruparPor,
  categoriaNome,
  grupoNome,
  otbBucket,
}: {
  produtos: ProdutoDraft[];
  /** Segue o agrupamento ATIVO do canvas (item 3 do pedido) — "Tipos de itens" mostra por
   *  grupo quando o canvas está agrupado por grupo, evitando o rail e as lanes divergirem. */
  agruparPor: "categoria" | "grupo";
  categoriaNome: (id: string | null) => string;
  grupoNome: (id: string | null) => string;
  /** Bucket GLOBAL da subcoleção ativa (`orc.subcolecao()`, MESMA fonte/queryKey que o Sheet
   *  usa pras "vagas" disponíveis) — null = sem alvo/coleção sem OTB. FIX (relatado pelo
   *  dono): o OTB é orçamento COMPARTILHADO da subcoleção entre TODOS os planejadores
   *  (manufaturados do Plan. Tecido/Produto + revenda daqui) — `realizado` conta `count(*)
   *  from modelos` da subcoleção inteira (`_otb_orcamento_core`), NUNCA `produtos.length`
   *  (só os produtos_acabados deste planejador — undercounta sempre que há manufaturados
   *  na mesma subcoleção). Consistência interna: se as "vagas" mostram `total-realizado`,
   *  "comprometido" tem que mostrar EXATAMENTE esse mesmo `realizado`/`total`. */
  otbBucket: Bucket | null;
}) {
  const totalPecas = produtos.reduce((a, p) => a + somaPecas(p), 0);
  // Poder de venda = Σ preco_venda do espelho × peças do produto (§ regra preco.ts — aqui o
  // preço é digitado no Plan. Produto, não derivado por markup; produto sem espelho não conta).
  const poderVenda = produtos.reduce((a, p) => a + (p.modeloPrecoVenda ?? 0) * somaPecas(p), 0);
  const comFornec = produtos.filter((p) => p.modeloPrecoVenda != null).length;
  // Custo previsto = Σ valor com desconto (cadeia bruto→desconto da própria compra).
  const custoPrevisto = produtos.reduce((a, p) => a + cadeiaValores(p.qtd_total, p.valor_unitario, p.desconto_pct).totalDesc, 0);

  // OTB comprometido é sobre MODELOS (cards) da subcoleção INTEIRA, não só os produtos deste
  // planejador — ver comentário do prop `otbBucket` acima.
  const realizadoGlobal = otbBucket?.realizado ?? 0;
  const alvoGlobal = otbBucket?.total ?? 0;
  const pctOtb = otbBucket && alvoGlobal > 0 ? Math.min(100, Math.round((realizadoGlobal / alvoGlobal) * 100)) : null;

  const tipoFallback = agruparPor === "grupo" ? "Sem grupo" : "Sem categoria";
  const tipoNome = agruparPor === "grupo" ? grupoNome : categoriaNome;
  const porTipo = new Map<string, { nome: string; produtos: number; pecas: number }>();
  for (const p of produtos) {
    const id = agruparPor === "grupo" ? p.grupo_id : p.categoria_id;
    const key = id ?? "__sem__";
    const cur = porTipo.get(key) ?? { nome: id ? tipoNome(id) : tipoFallback, produtos: 0, pecas: 0 };
    cur.produtos += 1;
    cur.pecas += somaPecas(p);
    porTipo.set(key, cur);
  }
  const tipos = [...porTipo.entries()].sort(([a], [b]) => (a === "__sem__" ? 1 : b === "__sem__" ? -1 : porTipo.get(a)!.nome.localeCompare(porTipo.get(b)!.nome, "pt-BR")));

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
        {otbBucket ? (
          <div className="p-2">
            <div className="flex justify-between text-xs">
              <span>{realizadoGlobal} de {alvoGlobal} modelos</span>
              {pctOtb != null && <b className={pctOtb >= 100 ? "text-emerald-700" : "text-foreground"}>{pctOtb}%</b>}
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${pctOtb != null && pctOtb >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pctOtb ?? 0}%` }} />
            </div>
            {/* Discrimina quantos desse total são produtos deste planejador (revenda) — o
                restante do `realizado` são manufaturados (Plan. Tecido/Produto) e outros
                produtos de revenda fora desta subcoleção-view, se houver. */}
            <div className="mt-1 text-[10px] text-muted-foreground">{produtos.length} produto{produtos.length === 1 ? "" : "s"} deste planejador</div>
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
