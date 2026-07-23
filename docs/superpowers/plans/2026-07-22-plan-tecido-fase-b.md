# Plan. Tecido Fase B — Fazer Pedido + Status na Lista

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao PlanTecidoSheet (Fase A.1) o fluxo de "Fazer pedido" (prévia por fornecedor → gerar OCs) + "Desfazer pedido" (com confirmação), e na lista de coleções adicionar badge+borda colorida com o status de pedido de cada coleção.

**Architecture:** Duas partes independentes: (1) novo Dialog "Prévia do pedido" dentro de `PlanTecidoSheet.tsx` — query `plan_tecido_previa_pedido`, estado editável por fornecedor, mutation `plan_tecido_fazer_pedido`; AlertDialog de confirmação para `plan_tecido_desfazer_pedido`. (2) nova query `["plan-tecido-status-pedidos"]` em `criacao.plan-tecido.tsx` → Map de status por coleção → borda+Badge nos cards. O backend está pronto; o front só consome as RPCs.

**Tech Stack:** Vite + React + TypeScript, TanStack Query, Supabase (rpc `as any`), Radix/shadcn Dialog + AlertDialog, Tailwind, `<DateField>` (`@/components/shared/DateField`), `<VarianteSwatch>` (`@/components/shared/VarianteSwatch`), `<NumberInput>` (`@/components/shared/NumberInput`), `<MobileActionBar>`.

## Global Constraints

- **RPCs novas:** chamar via `supabase.rpc("nome" as any, { ... })` — `types.ts` está desatualizado.
- **NÃO** fazer `.insert/.update/.delete` diretamente em tabelas de produção — só as 4 RPCs listadas no spec.
- **tsc 0 erros:** após implementar, rodar `npx tsc --noEmit 2>&1 | grep -E "TS[0-9]+"`. Se erros, corrigir antes de commitar.
- **`npm run build`** deve passar (0 erros).
- **`DateField`:** sempre `value: string` (ISO `yyyy-MM-dd`), `onChange: (e: { target: { value: string } }) => void`. NÃO `<input type="date">`.
- **`VarianteSwatch`:** props `nome?: string`, `label?: string`. Usar `nome` com o nome da variante/cor, `label` com o texto de rótulo.
- **`mensagemErro(e, fallback)`** em todos os `toast.error`.
- **Trailers de commit:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (linha em branco antes).
- **Invalidações corretas após gerar/desfazer:** `["ocs_tecido"]`, `["plan-tecido-status-pedidos"]`, `["estoque-tecidos"]`, `["dash-estoque"]`. NÃO `["parcelas"]`.
- **Report final:** gravar em `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/task-faseB-report.md` (≤ 15 linhas).

---

## File Structure

**Modificar:**
- `src/components/plan-tecido/PlanTecidoSheet.tsx` — adicionar estado/lógica para "Fazer pedido" (Dialog prévia) e "Desfazer pedido" (AlertDialog). Botões no header sticky e no MobileActionBar.
- `src/routes/_authenticated/criacao.plan-tecido.tsx` — adicionar query `plan_tecido_status_pedidos`, Map de status, borda `border-l-4` + `<Badge>` nos cards da lista.

**NÃO criar** novos arquivos de componente — toda a lógica cabe nos dois arquivos acima.

---

## Task 1: Badge + borda de status na lista de coleções

**Files:**
- Modify: `src/routes/_authenticated/criacao.plan-tecido.tsx`

**Interfaces:**
- Consumes: RPC `plan_tecido_status_pedidos()` → `{ colecao_id: string; status: "encomendado" | "entregue" }[]`
- Produces: Map `statusMap: Map<string, "encomendado" | "entregue">` usado nos cards.

- [ ] **Step 1: Adicionar a query de status**

Abrir `src/routes/_authenticated/criacao.plan-tecido.tsx`.

Após as queries existentes (`colecoes`, `meses`, `anos`), dentro de `PlanTecidoListPage`, adicionar:

```typescript
const { data: statusPedidos = [] } = useQuery({
  queryKey: ["plan-tecido-status-pedidos"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("plan_tecido_status_pedidos" as any);
    if (error) throw error;
    return (data ?? []) as { colecao_id: string; status: "encomendado" | "entregue" }[];
  },
});

const statusMap = useMemo(
  () => new Map(statusPedidos.map((r) => [r.colecao_id, r.status])),
  [statusPedidos],
);
```

- [ ] **Step 2: Atualizar o card para mostrar borda e Badge**

Localizar o bloco do card (o `<button key={c.id} ...>`). Trocar para:

```tsx
<button key={c.id} type="button" className="text-left" onClick={() => setOpenColecaoId(c.id)}>
  <Card className={cn(
    "transition-shadow hover:shadow-md border-l-4",
    statusMap.get(c.id) === "entregue"
      ? "border-l-emerald-500"
      : statusMap.get(c.id) === "encomendado"
        ? "border-l-amber-500"
        : "border-l-red-500",
  )}>
    <CardHeader className="pb-2">
      <CardTitle className="text-base">{c.nome}</CardTitle>
      <p className="text-xs text-muted-foreground">{mesAno(c)}</p>
    </CardHeader>
    <CardContent className="flex flex-wrap gap-2 text-xs text-muted-foreground">
      <Badge variant="secondary">{c.tipo === "poder_venda" ? "Poder de Venda" : "Orçamento"}</Badge>
      <Badge variant={c.status === "confirmada" ? "default" : "outline"}>
        {c.status === "confirmada" ? "Confirmada" : "Rascunho"}
      </Badge>
      {statusMap.get(c.id) === "entregue" ? (
        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Entregue</Badge>
      ) : statusMap.get(c.id) === "encomendado" ? (
        <Badge className="bg-amber-100 text-amber-800 border-amber-300">Encomendado</Badge>
      ) : (
        <Badge className="bg-red-100 text-red-800 border-red-300">Não pedido</Badge>
      )}
    </CardContent>
  </Card>
</button>
```

- [ ] **Step 3: Adicionar `cn` ao import se ausente**

Verificar se `cn` já está importado. Se não estiver:

```typescript
import { cn } from "@/lib/utils";
```

- [ ] **Step 4: Verificar e rodar build**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run build 2>&1 | tail -20
npx tsc --noEmit 2>&1 | grep -E "TS[0-9]+"
```

Esperado: build OK, 0 erros TS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git add src/routes/_authenticated/criacao.plan-tecido.tsx
git commit -m "$(cat <<'EOF'
feat(plan-tecido): badge + borda de status de pedido nos cards da lista

Adiciona query plan_tecido_status_pedidos e mapa de status; cada card
ganha border-l-4 colorida (não pedido=vermelho, encomendado=âmbar,
entregue=verde) + Badge textual com o mesmo significado.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Dialog "Prévia do pedido" — estado e tipos locais

**Files:**
- Modify: `src/components/plan-tecido/PlanTecidoSheet.tsx`

**Interfaces:**
- Produces: tipos locais `PreviaFornecedor`, `PreviaItem`, `PreviaResposta` que representam a forma da RPC `plan_tecido_previa_pedido`.
- Produces: estado `[previaOpen, setPreviaOpen]`, `[previaData, setPreviaData]`, `[previaEditada, setPreviaEditada]`.

- [ ] **Step 1: Adicionar tipos locais no topo do arquivo (após os imports)**

Logo após as linhas de `import type`, antes da função `FormAplicarTecido`, adicionar:

```typescript
// ---------- Prévia do pedido ----------
type PreviaItemRpc = {
  artigo_id: string;
  artigo_nome: string;
  unidade_medida: string;
  rendimento: number | null;
  variante_tecido_id: string;
  label: string;
  necessidade_m: number;
  estoque_m: number;
  deficit_m: number;
  qtd: number;
  unidade: string;
  preco: number;
};

type PreviaFornecedorRpc = {
  empresa_id: string;
  representante_id: string | null;
  empresa_nome: string;
  representante_nome: string | null;
  itens: PreviaItemRpc[];
};

type PreviaRpc = {
  fornecedores: PreviaFornecedorRpc[];
  sem_fornecedor: { artigo_id: string; artigo_nome: string }[];
  bloqueios: { artigo_nome: string; motivo: string }[];
};

// Estado editável por fornecedor (qtd editável por item; data/prazo por fornecedor)
type ItemEditado = PreviaItemRpc & { qtd_editada: number };

type FornecedorEditado = {
  empresa_id: string;
  representante_id: string | null;
  empresa_nome: string;
  representante_nome: string | null;
  data_prevista_entrega: string; // ISO yyyy-MM-dd ou ""
  prazo_pagamento: string;       // texto, ex.: "30/60/90"
  itens: ItemEditado[];
};
```

- [ ] **Step 2: Adicionar estado da prévia dentro de `PlanTecidoSheet`**

Dentro da função `PlanTecidoSheet`, após os estados existentes (por ex. `viewMode`, `selecao`, `mostrarFormTecido`), adicionar:

```typescript
const [previaOpen, setPreviaOpen] = useState(false);
const [previaData, setPreviaData] = useState<PreviaRpc | null>(null);
const [previaEditada, setPreviaEditada] = useState<FornecedorEditado[]>([]);
const [previaLoading, setPreviaLoading] = useState(false);
const [desfazerOpen, setDesfazerOpen] = useState(false);
```

- [ ] **Step 3: Verificar build parcial**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | grep -E "TS[0-9]+"
```

Esperado: 0 erros (os estados ainda não são usados, mas os tipos devem estar corretos).

---

## Task 3: Lógica "Fazer pedido" — buscar prévia e abrir Dialog

**Files:**
- Modify: `src/components/plan-tecido/PlanTecidoSheet.tsx`

**Interfaces:**
- Consumes: RPC `plan_tecido_previa_pedido(_colecao_id)` → jsonb com shape `PreviaRpc`.
- Consumes: estado `dirty` (desabilita o botão se houver alterações não salvas).
- Produces: função `handleAbrirPrevia()` que busca a RPC e popula o estado editável.

- [ ] **Step 1: Adicionar função `handleAbrirPrevia` dentro de `PlanTecidoSheet`**

Logo após a função `aplicarTecidoEmMassa`, adicionar:

```typescript
async function handleAbrirPrevia() {
  setPreviaLoading(true);
  try {
    const { data, error } = await supabase.rpc("plan_tecido_previa_pedido" as any, {
      _colecao_id: colecaoId,
    });
    if (error) throw error;
    const rpc = data as PreviaRpc;
    setPreviaData(rpc);
    // Inicializa o estado editável: data e prazo em branco, qtd_editada = qtd da RPC
    setPreviaEditada(
      rpc.fornecedores.map((f) => ({
        empresa_id: f.empresa_id,
        representante_id: f.representante_id,
        empresa_nome: f.empresa_nome,
        representante_nome: f.representante_nome,
        data_prevista_entrega: "",
        prazo_pagamento: "",
        itens: f.itens.map((it) => ({ ...it, qtd_editada: it.qtd })),
      })),
    );
    setPreviaOpen(true);
  } catch (e) {
    toast.error(mensagemErro(e, "Não foi possível carregar a prévia do pedido."));
  } finally {
    setPreviaLoading(false);
  }
}
```

- [ ] **Step 2: Adicionar mutation `fazerPedidoMut`**

Logo após `salvarMut`, adicionar:

```typescript
const fazerPedidoMut = useMutation({
  mutationFn: async (pedidos: FornecedorEditado[]) => {
    const payload = pedidos.map((f) => ({
      empresa_id: f.empresa_id,
      representante_id: f.representante_id,
      data_prevista_entrega: f.data_prevista_entrega || null,
      prazo_pagamento: f.prazo_pagamento || null,
      quantidade_prazos: f.prazo_pagamento
        ? f.prazo_pagamento.split("/").filter(Boolean).length
        : 1,
      itens: f.itens.map((it) => ({
        artigo_id: it.artigo_id,
        variante_tecido_id: it.variante_tecido_id,
        quantidade_pedida: it.qtd_editada,
        preco: it.preco,
        rendimento: it.rendimento,
      })),
    }));
    const { data, error } = await supabase.rpc("plan_tecido_fazer_pedido" as any, {
      _colecao_id: colecaoId,
      _pedidos: payload,
    });
    if (error) throw error;
    return data as { criadas: number; ocs: string[] };
  },
  onSuccess: (result) => {
    toast.success(`${result.criadas} OC(s) criada(s).`);
    setPreviaOpen(false);
    qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
    qc.invalidateQueries({ queryKey: ["plan-tecido-status-pedidos"] });
    qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    qc.invalidateQueries({ queryKey: ["dash-estoque"] });
  },
  onError: (e) => toast.error(mensagemErro(e, "Não foi possível gerar os pedidos.")),
});
```

- [ ] **Step 3: Adicionar mutation `desfazerPedidoMut`**

Logo após `fazerPedidoMut`, adicionar:

```typescript
const desfazerPedidoMut = useMutation({
  mutationFn: async () => {
    const { data, error } = await supabase.rpc("plan_tecido_desfazer_pedido" as any, {
      _colecao_id: colecaoId,
    });
    if (error) throw error;
    return data as number;
  },
  onSuccess: (removidas) => {
    toast.success(`Pedido desfeito (${removidas} OC(s) removida(s)).`);
    setDesfazerOpen(false);
    qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
    qc.invalidateQueries({ queryKey: ["plan-tecido-status-pedidos"] });
    qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    qc.invalidateQueries({ queryKey: ["dash-estoque"] });
  },
  onError: (e) => toast.error(mensagemErro(e, "Não foi possível desfazer o pedido.")),
});
```

- [ ] **Step 4: Verificar tsc**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | grep -E "TS[0-9]+"
```

Esperado: 0 erros.

---

## Task 4: Botões no header + MobileActionBar + imports Dialog

**Files:**
- Modify: `src/components/plan-tecido/PlanTecidoSheet.tsx`

**Interfaces:**
- Consumes: `handleAbrirPrevia`, `previaLoading`, `dirty`, `desfazerOpen`, `setDesfazerOpen`, `desfazerPedidoMut`.
- Produces: botão "Fazer pedido" no header (desabilitado se `dirty`), botão "Desfazer pedido" no header, ambos replicados no `MobileActionBar`.

- [ ] **Step 1: Adicionar imports de Dialog no topo do arquivo**

Adicionar ao bloco de imports do shadcn/ui:

```typescript
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { DateField } from "@/components/shared/DateField";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { ShoppingCart, Undo2 } from "lucide-react";
```

(Verificar se `ShoppingCart` e `Undo2` existem em lucide-react; se não, usar `Package` e `RotateCcw` como alternativas.)

- [ ] **Step 2: Adicionar botões no header sticky**

Localizar o bloco do header (o `<div className="sticky top-0 z-10 ..."`). **Antes** do `<Button className="max-sm:hidden" ... >Salvar</Button>`, inserir:

```tsx
<Button
  variant="outline"
  size="sm"
  className="max-sm:hidden"
  disabled={desfazerPedidoMut.isPending}
  onClick={() => setDesfazerOpen(true)}
>
  <Undo2 className="mr-1 h-4 w-4" />
  Desfazer pedido
</Button>
<Button
  variant="default"
  size="sm"
  className="max-sm:hidden"
  disabled={dirty || previaLoading}
  title={dirty ? "Salve o plano antes de pedir" : undefined}
  onClick={handleAbrirPrevia}
>
  <ShoppingCart className="mr-1 h-4 w-4" />
  {previaLoading ? "Carregando…" : "Fazer pedido"}
</Button>
```

- [ ] **Step 3: Atualizar MobileActionBar**

Localizar o `<MobileActionBar>` existente e adicionar os botões de pedido:

```tsx
<MobileActionBar>
  <Button variant="ghost" size="sm" onClick={fechar}>
    <ArrowLeft className="mr-1 h-4 w-4" />
    Voltar
  </Button>
  <Button
    variant="outline"
    size="sm"
    disabled={desfazerPedidoMut.isPending}
    onClick={() => setDesfazerOpen(true)}
  >
    <Undo2 className="h-4 w-4" />
  </Button>
  <Button
    size="sm"
    variant="secondary"
    disabled={dirty || previaLoading}
    title={dirty ? "Salve antes de pedir" : undefined}
    onClick={handleAbrirPrevia}
  >
    <ShoppingCart className="h-4 w-4" />
  </Button>
  <Button
    className="ml-auto"
    disabled={!dirty || salvarMut.isPending}
    onClick={() => salvarMut.mutate()}
  >
    {dirty ? "Salvar" : "Salvo"}
  </Button>
</MobileActionBar>
```

- [ ] **Step 4: Verificar tsc**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | grep -E "TS[0-9]+"
```

Se `ShoppingCart`/`Undo2` não existirem, substituir por `Package`/`RotateCcw`:
```bash
grep -r "ShoppingCart\|Undo2" node_modules/lucide-react/dist/lucide-react.d.ts | head -5
```

---

## Task 5: Dialog "Prévia do pedido" — render completo

**Files:**
- Modify: `src/components/plan-tecido/PlanTecidoSheet.tsx`

**Interfaces:**
- Consumes: `previaOpen`, `setPreviaOpen`, `previaData`, `previaEditada`, `setPreviaEditada`, `fazerPedidoMut`.
- Produces: Dialog completo com seções por fornecedor (data, prazo, tabela de itens com qtd editável), blocos "sem fornecedor" e "bloqueios", botão "Gerar N OC(s)".

- [ ] **Step 1: Adicionar Dialog da prévia antes do `</SheetContent>`**

Localizar `</SheetContent>` no retorno JSX. Antes dele, após o AlertDialog de `confirmSair` e o AlertDialog de `mostrarFormTecido`, adicionar:

```tsx
{/* ===== Dialog: Prévia do pedido ===== */}
<Dialog open={previaOpen} onOpenChange={setPreviaOpen}>
  <DialogContent className="max-w-3xl">
    <DialogHeader>
      <DialogTitle>Prévia do pedido</DialogTitle>
      <DialogDescription>
        Revise os pedidos por fornecedor. Ajuste as quantidades antes de gerar as OCs.
      </DialogDescription>
    </DialogHeader>

    <div className="max-h-[60vh] overflow-y-auto space-y-6 py-2">
      {/* Bloco por fornecedor */}
      {previaEditada.map((f, fi) => (
        <div key={f.empresa_id} className="rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-2">
            <p className="font-semibold text-sm">{f.empresa_nome}</p>
            {f.representante_nome && (
              <p className="text-xs text-muted-foreground">{f.representante_nome}</p>
            )}
          </div>
          <div className="p-3 space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
                <label className="text-xs font-medium">Data prevista de entrega</label>
                <DateField
                  value={f.data_prevista_entrega}
                  onChange={(e) => {
                    setPreviaEditada((prev) =>
                      prev.map((x, i) =>
                        i === fi ? { ...x, data_prevista_entrega: e.target.value } : x,
                      ),
                    );
                  }}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
                <label className="text-xs font-medium">Prazo de pagamento</label>
                <input
                  className="rounded border bg-background px-2 py-1.5 text-sm h-9"
                  placeholder="ex: 30/60/90"
                  value={f.prazo_pagamento}
                  onChange={(e) =>
                    setPreviaEditada((prev) =>
                      prev.map((x, i) =>
                        i === fi ? { ...x, prazo_pagamento: e.target.value } : x,
                      ),
                    )
                  }
                />
              </div>
            </div>
            {/* Tabela de itens */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1 text-left font-medium">Artigo</th>
                    <th className="py-1 text-left font-medium">Variante</th>
                    <th className="py-1 text-right font-medium">Necessidade</th>
                    <th className="py-1 text-right font-medium">Estoque</th>
                    <th className="py-1 text-right font-medium">Déficit</th>
                    <th className="py-1 text-right font-medium">Qtd a pedir</th>
                    <th className="py-1 text-left font-medium">Unid.</th>
                    <th className="py-1 text-right font-medium">Preço</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {f.itens.map((it, ii) => (
                    <tr key={`${it.artigo_id}-${it.variante_tecido_id}`}>
                      <td className="py-1.5 pr-2">{it.artigo_nome}</td>
                      <td className="py-1.5 pr-2">
                        <VarianteSwatch nome={it.label} label={it.label} />
                      </td>
                      <td className="py-1.5 pr-2 text-right">{it.necessidade_m.toFixed(1)}</td>
                      <td className="py-1.5 pr-2 text-right">{it.estoque_m.toFixed(1)}</td>
                      <td className={`py-1.5 pr-2 text-right ${it.deficit_m > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                        {it.deficit_m.toFixed(1)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <NumberInput
                          className="h-7 w-20 text-right"
                          value={it.qtd_editada}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            setPreviaEditada((prev) =>
                              prev.map((x, xi) =>
                                xi === fi
                                  ? {
                                      ...x,
                                      itens: x.itens.map((item, iii) =>
                                        iii === ii ? { ...item, qtd_editada: val } : item,
                                      ),
                                    }
                                  : x,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="py-1.5 text-muted-foreground">{it.unidade}</td>
                      <td className="py-1.5 text-right">
                        {it.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}

      {/* Sem fornecedor */}
      {previaData && previaData.sem_fornecedor.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-700">Sem fornecedor cadastrado</p>
          <p className="mt-1 text-xs text-red-600">
            Cadastre o fornecedor para:{" "}
            {previaData.sem_fornecedor.map((s) => s.artigo_nome).join(", ")}.
            Esses tecidos não gerarão OC.
          </p>
        </div>
      )}

      {/* Bloqueios */}
      {previaData && previaData.bloqueios.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-700">Bloqueios</p>
          <ul className="mt-1 space-y-0.5 text-xs text-red-600">
            {previaData.bloqueios.map((b, i) => (
              <li key={i}>{b.artigo_nome}: {b.motivo}</li>
            ))}
          </ul>
        </div>
      )}
    </div>

    <DialogFooter>
      <Button variant="outline" onClick={() => setPreviaOpen(false)}>
        Cancelar
      </Button>
      <Button
        disabled={previaEditada.length === 0 || fazerPedidoMut.isPending}
        onClick={() => fazerPedidoMut.mutate(previaEditada)}
      >
        {fazerPedidoMut.isPending
          ? "Gerando…"
          : `Gerar ${previaEditada.length} OC(s)`}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 2: Verificar tsc e build**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | grep -E "TS[0-9]+"
npm run build 2>&1 | tail -20
```

Esperado: 0 erros em ambos.

---

## Task 6: AlertDialog "Desfazer pedido"

**Files:**
- Modify: `src/components/plan-tecido/PlanTecidoSheet.tsx`

**Interfaces:**
- Consumes: `desfazerOpen`, `setDesfazerOpen`, `desfazerPedidoMut`.
- Produces: AlertDialog de confirmação que chama `desfazerPedidoMut.mutate()`.

- [ ] **Step 1: Adicionar AlertDialog de desfazer pedido**

Após o AlertDialog de `mostrarFormTecido` e antes do Dialog de prévia, adicionar:

```tsx
{/* AlertDialog: Desfazer pedido */}
<AlertDialog open={desfazerOpen} onOpenChange={setDesfazerOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Desfazer pedido?</AlertDialogTitle>
      <AlertDialogDescription>
        As OCs de tecido desta coleção serão removidas (apenas as não recebidas).
        Essa ação não pode ser desfeita.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction
        disabled={desfazerPedidoMut.isPending}
        onClick={() => desfazerPedidoMut.mutate()}
      >
        {desfazerPedidoMut.isPending ? "Desfazendo…" : "Desfazer"}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 2: Rodar build e tsc finais**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run build 2>&1 | tail -20 && npx tsc --noEmit 2>&1 | grep -E "TS[0-9]+"
```

Esperado: 0 erros.

- [ ] **Step 3: Commit Task 2–6 juntos (tudo no PlanTecidoSheet)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git add src/components/plan-tecido/PlanTecidoSheet.tsx
git commit -m "$(cat <<'EOF'
feat(plan-tecido): fazer pedido (prévia + gerar OCs) e desfazer pedido

Adiciona botões "Fazer pedido" (disabled se dirty) e "Desfazer pedido"
no header + MobileActionBar do PlanTecidoSheet. "Fazer pedido" busca
plan_tecido_previa_pedido e abre Dialog com itens editáveis (qtd, data
de entrega via DateField, prazo) por fornecedor; gera via
plan_tecido_fazer_pedido e invalida ocs_tecido/status-pedidos/
estoque-tecidos/dash-estoque. "Desfazer pedido" usa AlertDialog de
confirmação e chama plan_tecido_desfazer_pedido.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Report final + push

**Files:**
- Create: `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/task-faseB-report.md`

- [ ] **Step 1: Rodar build e tsc definitivos**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run build 2>&1 | tail -10 && npx tsc --noEmit 2>&1 | grep -cE "TS[0-9]+" || echo "0 erros tsc"
```

- [ ] **Step 2: Gravar report**

Criar `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/task-faseB-report.md` com até 15 linhas:

```markdown
# Report Fase B — Plan. Tecido

**Status:** DONE
**Commits:** (hash do commit Task 1) + (hash do commit Task 2–6)
**Build/tsc:** npm run build OK, npx tsc --noEmit 0 erros
**O que fez:**
- Badge + borda border-l-4 (vermelho/âmbar/verde) em cada card da lista (criacao.plan-tecido.tsx)
- Query ["plan-tecido-status-pedidos"] → Map → aplicado nos cards
- Tipos locais PreviaRpc/FornecedorEditado/ItemEditado no PlanTecidoSheet
- Botões "Fazer pedido" (disabled se dirty) + "Desfazer pedido" no header + MobileActionBar
- Dialog "Prévia do pedido": blocos por fornecedor (DateField + prazo + tabela qtd editável), sem_fornecedor, bloqueios, botão "Gerar N OC(s)"
- AlertDialog "Desfazer pedido" com confirmação
- Invalidações: ocs_tecido, plan-tecido-status-pedidos, estoque-tecidos, dash-estoque
**Concerns:** nenhum; RPCs são `as any` (types.ts pendente de regen)
**Report:** /Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/task-faseB-report.md
```

- [ ] **Step 3: Push**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && git push origin feature/plan-tecido-a1
```

---

## Spec Coverage Self-Check

| Requisito | Task que implementa |
|-----------|-------------------|
| Botão "Fazer pedido" no header + MobileActionBar | Task 4 |
| Desabilitado se `dirty` | Task 4 |
| Busca `plan_tecido_previa_pedido(colecaoId)` | Task 3 |
| Dialog com bloco por fornecedor | Task 5 |
| `<DateField>` para data prevista de entrega | Task 5 |
| Campo prazo de pagamento | Task 5 |
| Tabela: artigo, variante (VarianteSwatch), necessidade, estoque, déficit, qtd editável, unidade, preço | Task 5 |
| Bloco "Sem fornecedor" (vermelho) | Task 5 |
| Bloco "Bloqueios" (vermelho) | Task 5 |
| Botão "Gerar N OC(s)" → `plan_tecido_fazer_pedido` | Task 3 + 5 |
| Toast success/error + fechar dialog | Task 3 |
| Invalidações corretas (sem `["parcelas"]`) | Task 3 |
| Botão "Desfazer pedido" + AlertDialog | Task 4 + 6 |
| `plan_tecido_desfazer_pedido` + toast + invalidações | Task 3 |
| Query `plan_tecido_status_pedidos` na lista | Task 1 |
| `border-l-4` colorida por status nos cards | Task 1 |
| Badge textual com texto por status | Task 1 |
| `tsc --noEmit` 0 erros | Task 1 Step 4, Task 2 Step 3, Task 3 Step 4, Task 4 Step 4, Task 5 Step 2, Task 6 Step 2 |
| `npm run build` OK | Task 1 Step 4, Task 5 Step 2, Task 6 Step 2 |
| Commits com trailer `Co-Authored-By` | Task 1 Step 5, Task 6 Step 3 |
