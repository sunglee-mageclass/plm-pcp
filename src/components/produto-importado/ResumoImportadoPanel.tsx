import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Bucket } from "@/components/otb/orcamento";
import type { Opt, CatOpt } from "@/components/produto-acabado/shared";
import { fmtMoeda } from "@/lib/moeda";
import { custoDoDraft, precosDoDraft, type ProdutoImportadoDraft } from "./shared";

/** Bloco colapsável do Resumo — mesmo padrão de ResumoRevendaPanel.tsx / ResumoPanel.tsx
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
 * Rail esquerdo do canvas do Produto Importado — réplica visual de `ResumoRevendaPanel`
 * (Produto Acabado), adaptada às métricas de IMPORTAÇÃO:
 *  - Poder de venda (varejo) = Σ (preço varejo landed × peças) — varejo derivado do custo
 *    landed × markups (cadeia moeda.ts), não digitado.
 *  - Custo de compra = Σ (custo landed unitário × peças) — landed BRL com frete já rateado.
 *  - Produtos·peças, OTB comprometido (barra), Tipos de itens (por categoria OU grupo).
 * Todos os valores vêm de `custoDoDraft`/`precosDoDraft` (fonte única moeda.ts).
 */
export function ResumoImportadoPanel({
  produtos,
  bucket,
  nivelMacro,
  categorias,
  grupos,
}: {
  produtos: ProdutoImportadoDraft[];
  /** Bucket GLOBAL da subcoleção ativa (`orc.subcolecao()`, MESMA fonte/queryKey que o Sheet
   *  usa pras "vagas") — null = sem alvo/coleção sem OTB. O OTB é orçamento COMPARTILHADO da
   *  subcoleção entre TODOS os planejadores; `realizado` conta modelos da subcoleção inteira. */
  bucket: Bucket | null;
  /** Segue o agrupamento ATIVO do canvas — "Tipos de itens" por grupo quando agrupado por grupo. */
  nivelMacro: "categoria" | "grupo";
  categorias: CatOpt[];
  grupos: Opt[];
}) {
  const categoriaNome = (id: string | null) => categorias.find((c) => c.id === id)?.nome ?? "";
  const grupoNome = (id: string | null) => grupos.find((g) => g.id === id)?.nome ?? "";

  const totalPecas = produtos.reduce((a, p) => a + (Number(p.qtd_total) || 0), 0);

  // Custo de compra (landed) e poder de venda (varejo) — cada produto: unitário × peças.
  // Poder de venda só conta produtos com varejo > 0 (markup preenchido).
  let custoCompra = 0;
  let poderVenda = 0;
  let comPreco = 0;
  for (const p of produtos) {
    const qtd = Number(p.qtd_total) || 0;
    const custo = custoDoDraft(p);
    const precos = precosDoDraft(p, custo);
    custoCompra += custo.unitarioBrl * qtd;
    if (precos.varejo > 0) {
      poderVenda += precos.varejo * qtd;
      comPreco += 1;
    }
  }

  // OTB comprometido — sobre MODELOS (cards) da subcoleção INTEIRA (bucket global), não só os
  // produtos deste planejador. Consistência com as "vagas" (total-realizado) do canvas.
  const realizadoGlobal = bucket?.realizado ?? 0;
  const alvoGlobal = bucket?.total ?? 0;
  const pctOtb = bucket && alvoGlobal > 0 ? Math.min(100, Math.round((realizadoGlobal / alvoGlobal) * 100)) : null;

  // Tipos de itens — por categoria OU grupo, seguindo o agrupamento ativo.
  const tipoFallback = nivelMacro === "grupo" ? "Sem grupo" : "Sem categoria";
  const tipoNome = nivelMacro === "grupo" ? grupoNome : categoriaNome;
  const porTipo = new Map<string, { nome: string; produtos: number; pecas: number }>();
  for (const p of produtos) {
    const id = nivelMacro === "grupo" ? p.grupo_id : p.categoria_id;
    const key = id ?? "__sem__";
    const cur = porTipo.get(key) ?? { nome: id ? tipoNome(id) : tipoFallback, produtos: 0, pecas: 0 };
    cur.produtos += 1;
    cur.pecas += Number(p.qtd_total) || 0;
    porTipo.set(key, cur);
  }
  const tipos = [...porTipo.entries()].sort(([a], [b]) => (a === "__sem__" ? 1 : b === "__sem__" ? -1 : porTipo.get(a)!.nome.localeCompare(porTipo.get(b)!.nome, "pt-BR")));

  return (
    <div className="space-y-2">
      <Secao title="Poder de venda (varejo)">
        {comPreco > 0 ? (
          <div className="p-2">
            <div className="flex justify-between text-xs"><span>Σ varejo × peças</span><b>{fmtMoeda(poderVenda, "BRL")}</b></div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{comPreco} de {produtos.length} produtos com preço</div>
          </div>
        ) : (
          <div className="p-2 text-[11px] text-muted-foreground">Aparece quando um produto tiver markup de varejo.</div>
        )}
      </Secao>

      <Secao title="Custo de compra">
        <div className="p-2">
          <div className="flex justify-between text-xs"><span>Σ landed × peças (BRL)</span><b>{fmtMoeda(custoCompra, "BRL")}</b></div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">frete rateado incluído</div>
        </div>
      </Secao>

      <Secao title="Produtos · peças">
        <div className="p-2">
          <div className="flex justify-between text-xs"><span>Produtos</span><b>{produtos.length}</b></div>
          <div className="flex justify-between text-xs"><span>Peças</span><b>{totalPecas}</b></div>
        </div>
      </Secao>

      <Secao title="OTB comprometido">
        {bucket ? (
          <div className="p-2">
            <div className="flex justify-between text-xs">
              <span>{realizadoGlobal} de {alvoGlobal} modelos</span>
              {pctOtb != null && <b className={pctOtb >= 100 ? "text-emerald-700" : "text-foreground"}>{pctOtb}%</b>}
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${pctOtb != null && pctOtb >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pctOtb ?? 0}%` }} />
            </div>
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
