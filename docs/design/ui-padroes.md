# Padrões de UI — sisTrama (Navy Trust)

Referência escrita do design system. Para cada padrão: **token/uso** → **qual componente real reutilizar** (`arquivo:linha`) → **snippet copiável**. Guia visual ao vivo em [`ui-padroes.html`](./ui-padroes.html) (abre direto no navegador, sem servidor).

> Regra de ouro: **use o token semântico** (`bg-primary`, `text-muted-foreground`, `border`), nunca um hex solto. **Não edite `src/components/ui/`** (shadcn gerado). Onde propomos um componente novo, crie em `src/components/shared/`.

---

## 0. Fundação — tokens de cor

Fonte de verdade: **`src/styles.css`** (bloco `:root`, tema claro). Valores oklch reais:

| Token | oklch | Uso |
|---|---|---|
| `--background` | `oklch(0.984 0.003 248)` (~#f8fafc) | fundo da app |
| `--foreground` | `oklch(0.20 0.04 265)` | texto principal |
| `--card` | `#fff` | fundo de card |
| `--primary` | `oklch(0.52 0.09 248)` (#3b6fa0) | ação primária, foco, links |
| `--muted` / `--muted-foreground` | `oklch(0.965 0.005 248)` / `oklch(0.5 0.02 260)` | superfícies calmas / texto secundário |
| `--accent` | `oklch(0.94 0.012 248)` | hover de itens |
| `--border` / `--input` | `oklch(0.90 0.01 248)` / `oklch(0.93 0.008 248)` | bordas / bordas de input |
| `--destructive` | `oklch(0.58 0.21 27)` | erro / excluir |
| `--success` | `oklch(0.62 0.14 152)` | ok / confirmado |
| `--warning` | `oklch(0.78 0.14 80)` | atenção / rascunho / estimativa / **dirty** |
| `--sidebar` / `-foreground` | `oklch(0.21 0.07 265)` / `oklch(0.93 0.012 248)` | navy escuro da barra |

Fontes: **Figtree** (corpo, `--font-sans`), **Outfit** (títulos/display, `--font-display`) — declaradas em `src/styles.css:43`.

Raios: `--radius: 0.625rem` → utilitários `rounded-md` (~8px) são o padrão de cantos.

---

## A. Indicador "alterações não salvas" (dirty) + Salvar/Salvo + guarda de descarte

**Uso:** telas/Sheets com rascunho local editável. Enquanto `dirty`, mostra um **ponto âmbar (`--warning`)** no título e o botão **Salvar**; quando `!dirty`, botão fica desabilitado e vira "Salvo". Ao fechar com alterações pendentes, um `AlertDialog` confirma o descarte.

**Reutilizar:**
- Padrão dirty completo (estado, ponto âmbar, botão): **`src/components/otb/SimulacaoSheet.tsx`**
  - `:359` — `const [dirty, setDirty] = useState(false)`
  - `:714` — `const upd = (fn) => { setDraft(fn); setDirty(true); }` (todo patch do rascunho passa aqui)
  - `:1152` — ponto âmbar: `<span className="ml-1 text-amber-600" title="não salvo">•</span>`
  - `:1713` — botão Salvar/Salvo (`disabled={!dirty || salvar.isPending}`)
  - `:1749` — `AlertDialog` de descarte destrutivo ("Restaurar do zero")
- `AlertDialog` base: **`src/components/ui/alert-dialog.tsx`** (`AlertDialog`, `AlertDialogContent/Header/Title/Description/Footer/Cancel/Action`).

```tsx
const [dirty, setDirty] = useState(false);
const upd = (fn) => { setDraft(fn); setDirty(true); }; // toda mutação do rascunho

// Ponto âmbar no título
<span>{nome}{dirty && <span className="ml-1 text-amber-600" title="não salvo">•</span>}</span>

// Botão Salvar / Salvo
<Button onClick={() => salvar.mutate()} disabled={!dirty || salvar.isPending}>
  <Save className="h-4 w-4 mr-1" />
  {dirty ? (salvar.isPending ? "Salvando…" : "Salvar") : "Salvo"}
</Button>

// Guarda de descarte ao sair
<AlertDialog open={confirmSair} onOpenChange={setConfirmSair}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
      <AlertDialogDescription>Há alterações não salvas neste rascunho.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Continuar editando</AlertDialogCancel>
      <AlertDialogAction
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onClick={onClose}>Descartar</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

> `text-amber-600` do Tailwind é o equivalente prático do token `--warning`. Em mutations de Salvar, zere `dirty` no `onSuccess` (`setDirty(false)` — ver `SimulacaoSheet.tsx:973`).

---

## B. Breadcrumb de contexto "Módulo › Tela › Entidade"

**Uso:** ancorar o usuário no topo de uma tela de detalhe/Sheet. Texto em `muted-foreground`; a **entidade atual** em `foreground` + `font-semibold`. Separador `›` fica no ícone (`ChevronRight`), não no texto.

**Reutilizar:** **não existe** breadcrumb no repo hoje (verificado — `ChevronRight` só aparece em menus/collapsibles). **Proposta:** criar **`src/components/shared/Breadcrumb.tsx`** (código completo abaixo).

```tsx
// src/components/shared/Breadcrumb.tsx
import { ChevronRight } from "lucide-react";

type Crumb = { label: string; href?: string };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex items-center flex-wrap gap-1.5 text-sm text-muted-foreground">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 opacity-50" />}
            <span className={last ? "text-foreground font-semibold" : ""}>{c.label}</span>
          </span>
        );
      })}
    </nav>
  );
}

// uso
<Breadcrumb items={[
  { label: "Estilo & Engenharia" },
  { label: "Plan. Tecido" },
  { label: "Coleção Verão 26" },
]} />
```

> Manter simples (só texto por enquanto). Se depois virar navegável, envolver os `!last` num `Link` do TanStack Router — mas o último item nunca é link (é a página atual).

---

## C. Swatch de cor ao lado da variante

**Uso:** ao listar variantes de tecido. Quadradinho **12px, `rounded-[3px]`, borda sutil** + rótulo. O rótulo vem SEMPRE de `src/lib/variante.ts` no formato **"nome - cor - apelido"** (partes vazias omitidas; cai p/ `codigo_variante` → "—").

**Como derivar a cor do swatch:** usar o **hex da cor base** da variante. ⚠️ **Verificado:** as tabelas `cores` e `variantes_tecido` **não têm coluna hex** hoje (`src/integrations/supabase/types.ts`). Enquanto não houver hex, o swatch cai num **neutro (`var(--muted)`)**. Quando a coluna existir (ex.: `cores.hex`), o embed já é `cor:cor_id(nome)` → passa a `cor:cor_id(nome, hex)`.

**Reutilizar:**
- Rótulo: **`src/lib/variante.ts`**
  - `varianteLabel({ nome, cor, apelido })` → `:10`
  - `labelVarianteRow(row)` → `:32` (aceita `row.cor.nome` / `row.cores.nome` + `row.apelido.nome`)
- Swatch: **não existe** — proposta **`src/components/shared/VarianteSwatch.tsx`**.

```tsx
// src/components/shared/VarianteSwatch.tsx
import { labelVarianteRow } from "@/lib/variante";

// row = linha embedada de variantes_tecido:
//   { nome_variante, codigo_variante, cor: { nome, hex? }, apelido: { nome } }
export function VarianteSwatch({ row }: { row: any }) {
  const hex = row?.cor?.hex ?? null; // coluna hex ainda NÃO existe no banco
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="h-3 w-3 rounded-[3px] border shrink-0"
        style={{ backgroundColor: hex ?? "var(--muted)" }}
        aria-hidden
      />
      <span className="truncate">{labelVarianteRow(row)}</span>
    </span>
  );
}
```

> Formato do rótulo (`variante.ts:5`): `junta(nome, cor, apelido)` = `"nome - cor - apelido"`, filtrando vazios, com fallback final `"—"`. Em Serviços o apelido vem na frente (`corApelidoLabelServico`, `:24`) — usar essa variante só naquele contexto.

---

## D. Campo editável (branco) vs derivado (cinza)

**Uso:** formulários que misturam entradas e valores calculados. **Editável** = `Input`/`NumberInput` (fundo `card`/branco). **Derivado** (calculado, não editável) = caixa `bg-muted` via helper **`CampoRO`**. A convenção comunica, à distância, o que o usuário controla.

**Reutilizar:**
- Helper `CampoRO`: **`src/routes/_authenticated/criacao.planejamento.tsx:1033`** (uso na "Simulação de custo" em `:1589`). É pequeno o bastante para copiar; se for reusado em 3+ telas, promover para `src/components/shared/`.
- Input branco: **`src/components/ui/input.tsx`** — base `h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 ... max-md:h-11`.
- Numérico: **`src/components/shared/NumberInput.tsx`** (`forwardRef`, aceita todas as props do `Input` + `integer?`; exibe pt-BR em repouso, texto cru ao focar, normaliza vírgula→ponto no `onChange`).

```tsx
// Editável
<div className="grid gap-1">
  <Label>Consumo de tecido (m)</Label>
  <NumberInput value={consumo} onChange={(e) => setConsumo(Number(e.target.value))} />
</div>

// Derivado (calculado) — helper CampoRO
function CampoRO({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <div className="h-9 px-3 flex items-center rounded-md border bg-muted text-sm tabular-nums">
        {value}
      </div>
    </div>
  );
}

<CampoRO label="Custo estimado" value={brl(total)} />
```

> `tabular-nums` na caixa derivada mantém números alinhados. Valores vazios exibem `"—"`, não `0` nem `R$ 0,00`.

---

## E. Banner âmbar de estimativa / aviso

**Uso:** sobre um bloco cujos números são estimados/provisórios (não o dado final/real). Ícone `AlertTriangle`, borda + fundo âmbar (`--warning`), texto curto e direto.

**Reutilizar:** padrão inline (sem componente próprio) — **`src/routes/_authenticated/criacao.planejamento.tsx:1555`**. Ícone de `lucide-react`.

```tsx
<div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800
                dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 flex items-start gap-2">
  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
  <span>Estimativa — <strong>não</strong> é o custo nem o preço real (esses vêm do BOM/CAD).</span>
</div>
```

> `items-start` + `mt-0.5` no ícone o alinham com a 1ª linha do texto (padrão mobile do repo: ícone plano, `mt-0.5`). As classes `amber-*` casam com `--warning`. Se virar recorrente, extrair `<AvisoEstimativa>` em `src/components/shared/`.

---

## F. Densidade colapsável (Collapsible / Accordion)

**Uso:** `Collapsible` para nós de árvore (OC, subcoleção, cor…); `Accordion` para seções de formulário. **Header colapsado carrega um resumo** — `ref · total · ✓/⚠` — para o usuário decidir sem abrir.

**Reutilizar:**
- **`src/components/ui/collapsible.tsx`** (`Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` — Radix puro).
- **`src/components/ui/accordion.tsx`** (`Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` — já inclui o chevron que rotaciona no `data-state=open`).
- Header-com-resumo (referência viva): **`src/components/otb/SimulacaoSheet.tsx:203`** (OC com ✓/⚠ + saldo) e `:160` (mix por categoria com total).

```tsx
<Collapsible defaultOpen className="group/oc">
  <CollapsibleTrigger asChild>
    <button className="w-full flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2
                       text-left hover:bg-muted/40 min-h-[44px] md:min-h-0">
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform
                               group-data-[state=open]/oc:rotate-90" />
      <span className="flex-1 text-xs font-medium truncate">OC {num}</span>
      {/* resumo colapsado */}
      <span className={ok ? "text-green-600" : "text-amber-600"}>{ok ? "✓" : "⚠"}</span>
      <span className={saldo >= 0 ? "text-green-600" : "text-destructive"}>{fmt(saldo)}m</span>
    </button>
  </CollapsibleTrigger>
  <CollapsibleContent>{/* corpo em pl-2 border-l ml-3 */}</CollapsibleContent>
</Collapsible>
```

> O `group/nome` + `group-data-[state=open]/nome:rotate-90` nomeia o grupo para não vazar rotação entre collapsibles aninhados. No mobile o header usa `min-h-[44px] md:min-h-0` (toque).

---

## G. MobileActionBar + regra de toque 44px

**Uso:** toda tela com ação primária. Desktop: ação no header. Mobile (`<sm`): a ação desce para uma **barra fixa no rodapé**, renderizada por **portal** no `body` (a sidebar seria "containing block" de `fixed` e a barra descolaria).

**Reutilizar:** **`src/components/shared/MobileActionBar.tsx`** (`<MobileActionBar>{children}</MobileActionBar>`).

Três passos (documentados no próprio componente):
1. Container da página: `max-sm:pb-24` (conteúdo não fica atrás da barra).
2. Botão de ação do header: `max-sm:hidden` (some no mobile).
3. `<MobileActionBar>` no fim da página com a versão mobile da ação (+ voltar).

```tsx
// container
<div className="… max-sm:pb-24"> … </div>

// header (some no mobile)
<Button className="max-sm:hidden" onClick={salvar}>Salvar</Button>

// rodapé mobile
<MobileActionBar>
  <Button variant="outline" size="icon" onClick={voltar} aria-label="Voltar">
    <ArrowLeft className="h-4 w-4" />
  </Button>
  <Button className="flex-1" onClick={salvar}>Salvar</Button>
</MobileActionBar>
```

**Regra de toque 44px:** os componentes base já a aplicam via `max-md:h-11` — `Button` (`src/components/ui/button.tsx:21`), `Input` (`src/components/ui/input.tsx:22`), `SelectTrigger` (`src/components/ui/select.tsx:22`). Botões/áreas clicáveis customizadas (ex.: header de collapsible, alça de drag) usam `min-h-[44px] md:min-h-0`.

---

## H. Badges de status / procedência

**Uso:** chips pequenos para **procedência de valor** (BOM/CAD/est.) ou **estado** (rascunho/confirmada; status de pedido 🔴🟡🟢). Cores **semânticas**:

| tone | token | quando |
|---|---|---|
| `success` | `--color-success` | ok, confirmado, no prazo |
| `warning` | `--color-warning` | atenção, rascunho, adiantado/estimado |
| `danger` | `--color-destructive` | erro, atrasado, bloqueado |
| `info` | `--primary` | informativo (BOM/CAD, marcador) |
| `neutral` | `--muted` | sem estado / "est." |

**Reutilizar:**
- **`src/components/shared/StatusBadge.tsx`** — `<StatusBadge tone="success|warning|danger|info|neutral">…</StatusBadge>`. Já mapeia cada tone ao token via `color-mix` (fundo translúcido + texto na cor) — **prefira este** a montar classes à mão.
- Base: **`src/components/ui/badge.tsx`** (variants `default | secondary | destructive | outline`).
- Semáforo inline (texto): **`src/components/otb/SimulacaoSheet.tsx:212`**, **`src/components/otb/ColecaoSheet.tsx:416`**.
- Prazo de OC (badge dinâmico atrasado/adiantado): **`src/components/shared/oc-prazo-badge.tsx:31`**.

```tsx
<StatusBadge tone="success">Confirmada</StatusBadge>
<StatusBadge tone="warning">Rascunho</StatusBadge>
<StatusBadge tone="danger">Atrasado 3 dias</StatusBadge>
<StatusBadge tone="info">CAD</StatusBadge>
<StatusBadge tone="neutral">est.</StatusBadge>

// semáforo de status (texto/ponto)
<span className={atrasado ? "text-destructive" : atencao ? "text-amber-600" : "text-green-600"}>●</span>
```

> `StatusBadge` já vem com `uppercase tracking-wider text-[10px]` — não reaplicar. Para um badge sólido de ação (raro em status), use `<Badge variant="default">` (fundo `--primary`).

---

## I. Cartões em 2 colunas que expandem na própria coluna

**Uso:** páginas de config/detalhe com blocos independentes. `grid md:grid-cols-2` **+ `items-start`** — cada card cresce sozinho, sem esticar o vizinho. Sem `items-start`, o grid iguala a altura dos dois pela maior (esticando o card curto).

**Reutilizar:** padrão inline — **`src/routes/_authenticated/admin/configuracoes.tsx:267`** e **`src/routes/_authenticated/admin/identidade.tsx:158`** (ambos `grid grid-cols-1 gap-4 lg:grid-cols-2 items-start`).

```tsx
<div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
  <Card>{/* bloco A (curto) */}</Card>
  <Card>{/* bloco B (cresce sozinho) */}</Card>
</div>
```

> Use `md:grid-cols-2` quando quer 2 colunas já em tablet; `lg:grid-cols-2` quando os cards têm conteúdo largo (config/identidade preferem `lg`). O `items-start` é o detalhe que faz o padrão.

---

## Checklist rápido (dev)

- [ ] Cor via token semântico, nunca hex solto. Dirty/estimativa/atenção = `--warning` (`amber-*`).
- [ ] Rótulo de variante SEMPRE via `src/lib/variante.ts` (`labelVarianteRow`/`varianteLabel`).
- [ ] Valor calculado = `CampoRO` (`bg-muted`); valor editável = `Input`/`NumberInput` (branco).
- [ ] Ação primária: header desktop (`max-sm:hidden`) + `<MobileActionBar>` mobile + `max-sm:pb-24` no container.
- [ ] Toque ≥ 44px no mobile (`max-md:h-11` / `min-h-[44px] md:min-h-0`).
- [ ] Status via `StatusBadge` (tone semântico), não classes soltas.
- [ ] Rascunho editável: estado `dirty`, ponto âmbar, Salvar/Salvo, `AlertDialog` de descarte.
- [ ] Componentes novos (Breadcrumb, VarianteSwatch): criar em `src/components/shared/`, não em `src/components/ui/`.
```
