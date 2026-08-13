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

## A. Guarda de "alterações não salvas" (dirty) — PADRÃO DO SISTEMA

**Regra:** TODO formulário com botão **Salvar** usa o guarda compartilhado. Enquanto há
edições pendentes, um **selo âmbar** (`● alterações não salvas`) aparece INLINE no **header
da própria tela**, alinhado à DIREITA (acima da linha separadora), via
`<UnsavedIndicator show={dirty} className="ml-auto shrink-0" />` (de
`@/components/shared/UnsavedIndicator`). NÃO é mais flutuante/global — assim nunca sobrepõe
relógio/botões e fica alinhado ao cabeçalho. Ao fechar (X, ESC, clicar fora, Cancelar/Voltar)
— ou, em página inteira, ao NAVEGAR para fora — com pendências, o `<UnsavedChangesGuard>`
mostra um `AlertDialog`: **"Descartar alterações?"** → `Continuar editando` / `Descartar`.

**Primitivos compartilhados (NÃO reinventar):**
- **`src/components/shared/UnsavedChangesGuard.tsx`** exporta:
  - `useUnsavedGuard({ dirty, onClose?, blockNav? })` → `{ requestClose, confirm }`.
    `requestClose()` vai em todo caminho de fechar (Radix `onOpenChange`, Cancelar/X/Voltar);
    abre a confirmação se `dirty`, senão fecha. `blockNav: true` (só página inteira) bloqueia
    a navegação de rota via `useBlocker` do TanStack Router.
  - `<UnsavedChangesGuard confirm message="…" />`: renderiza só o `AlertDialog` de descarte.
    Um por formulário. `message` específico da tela.
  - `<UnsavedIndicator show={dirty} className="ml-auto shrink-0" />` (de
    `@/components/shared/UnsavedIndicator`): o selo INLINE, colocado no header da tela.
- **`src/hooks/useDirtySnapshot.ts`**: `useDirtySnapshot(value)` → `{ dirty, markClean, reset }`.
  Compara um instantâneo (JSON) do estado do formulário. `reset(seed)` ao semear (query async
  ou abrir-para-editar); `markClean()` no `onSuccess` do Salvar.
- **`src/components/shared/OcModalShell.tsx`**: já guarda internamente — telas de OC só passam
  `dirty` (e `discardMessage`) ao shell; não renderizam `<UnsavedChangesGuard>`.

**Como detectar `dirty` (escolha o mais simples):**
- **Caso A** — a tela já tem um booleano `dirty` próprio (ex.: `PlanTecidoSheet`, `PadraoMixSheet`):
  passe-o direto. Zere no `onSuccess` (o próprio já faz `setDirty(false)`).
- **Caso B** — modal simples (1–poucos campos): calcule inline, gated por `open`:
  `const dirty = open && nome !== (editing?.nome ?? "")`. Ref.: `cadastro.destinos.tsx`.
- **Caso C** — formulário grande / estado aninhado / carregado async: `useDirtySnapshot(form)`,
  `dirty = open && changed` (modal) ou `changed` (página); `reset(next)` ao semear; `markClean()`
  no save. Ref.: `admin/configuracoes.tsx` (página inteira + `blockNav`).

```tsx
// Modal (Sheet/Dialog)
const dirty = open && formNome !== (editing?.nome ?? "");        // Caso B
const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: () => setOpen(false) });
<Dialog open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
  <DialogHeader>
    <div className="flex items-center gap-2">
      <DialogTitle>Editar destino</DialogTitle>
      <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />   {/* selo no header */}
    </div>
  </DialogHeader>
  …
  <Button variant="outline" onClick={requestClose}><ArrowLeft/> Voltar</Button>  {/* rodapé */}
</Dialog>
<UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste cadastro." />

// Página inteira (bloqueia navegação)
const { dirty, markClean, reset } = useDirtySnapshot(cfg);
const { confirm } = useUnsavedGuard({ dirty, blockNav: true });  // sem onClose
// reset(next) ao carregar; markClean() no onSuccess do Salvar
<header className="flex items-center gap-2">…<UnsavedIndicator show={dirty} className="ml-auto shrink-0" /></header>
<UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas nas configurações." />
```

> Fora de escopo: `AlertDialog`s de confirmação pura ("Excluir?", "Salvar mesmo assim") e
> pickers/formulários cujo botão principal é "Aplicar"/"Confirmar" e commita na hora.
> Aplicado em ~30 formulários (Sheets, Dialogs e 4 páginas inteiras) — jul/2026.
> O botão Salvar/Salvo em si (desabilita quando `!dirty`) segue como no `PlanTecidoSheet`.

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

**REGRA (ago/2026, decisão do dono): todo campo EDITÁVEL nasce VAZIO com placeholder — nunca pré-preenchido com 0/default.** Vale para valor novo E para round-trip: 0 gravado no banco EXIBE como vazio+placeholder (0 ≡ vazio na exibição; o dado gravado não muda). Placeholder mostra o formato esperado ("0,00", "0", "dd/mm/aaaa"). Receita: `value={x || ""}` + `placeholder="0,00"`; no save, vazio grava 0 (contrato do servidor inalterado). ⚠️ Não quebrar o dirty: normalizar 0≡null na comparação (padrão `moLinhasEqual`, `src/lib/mao-obra.ts`) — adicionar/remover item continua acendendo dirty; só o par (0↔vazio) do MESMO campo não oscila. Jurisprudência: MO por serviço (`32b90e3`), Produto Acabado qtd/valor/desconto/proporção. Telas novas obedecem desde o dia 1; existentes adotam no rollout §P.

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
- Header-com-resumo (referência viva): **`src/components/plan-tecido/PlanTecidoSheet.tsx`** (Collapsible por subcoleção e por linha, com contador "N modelo(s)") e **`src/components/plan-tecido/ModelCard.tsx`** (Accordion "Tecidos/Grade/Custo" dentro do card).

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

## G. Barra de ações + container (Sheet/Dialog) + toque 44px — PADRÃO DO SISTEMA

**Container:** **editar um registro existente = Sheet** (`side="right"`, ~70vw); **criar/novo/formulário/config = Dialog** central. Quando o MESMO componente faz os dois, condicione: `isEdit ? <Sheet…> : <Dialog…>` (ref. `cadastro.aviamentos.tsx`, `criacao.planejamento.tsx` `ModeloDialog`, `OcModalShell`). Páginas de LISTA não são modais.

**Cabeçalho:** toda tela de edição/formulário começa com um `<Breadcrumb items=[…]>` (§B) no formato **"Módulo › Tela › Entidade"** (ex.: `Estilo & Engenharia › Plan. Tecido › {coleção}`, `PCP › Controle de Qualidade › {ref}`, `Entrada & Saída › OC Tecido › {nº}`). Botões de imprimir (Ficha de Corte, Romaneio) ficam no header topo-direita — o indicador de "não salvo" cai logo abaixo deles.

**Botões de ação: barra STICKY no rodapé, em TODOS os tamanhos** (não deixar ação primária no header). **Ordem fixa:** `Voltar` à ESQUERDA (nunca "Cancelar"/"Fechar" — sempre "Voltar" com `ArrowLeft`), `Excluir` logo ao lado (só se a tela tem exclusão; **`variant="destructive"`** — fundo vermelho), `Salvar` à DIREITA (`ml-auto`). Use `flex items-center gap-2`, NÃO `justify-end`.
- **Sheet/Dialog:** rodapé in-flow no fim do container — `<div className="shrink-0 border-t bg-background p-3 flex items-center gap-2">`, com o corpo em `flex-1 overflow-y-auto` (o container é `flex flex-col` — NÃO ponha `overflow-y-auto` no Content inteiro, senão o rodapé rola junto no desktop). `OcModalShell` já entrega esse grid. O corpo dentro do Sheet usa **largura total** (`w-full`), NÃO `container mx-auto` (isso limita a largura e deixa o conteúdo "compacto" dentro do Sheet). Telas dual-mount (página + Sheet) usam `container mx-auto` só no modo página: `${onClose ? "w-full" : "container mx-auto"}`.
- **Página inteira** (edição/formulário/config): **`src/components/shared/PageActionBar.tsx`** — barra fixa no rodapé via **portal no body**, visível em TODOS os tamanhos; container ganha `pb-24`. (Ref.: `admin/configuracoes.tsx`, `admin/identidade.tsx`, `producao.cq.$modeloId.tsx`.)
- **Página de LISTA** (não-edição): mantém o padrão antigo — botão "Novo" no header + **`MobileActionBar`** (`src/components/shared/MobileActionBar.tsx`, só-mobile) no rodapé.

```tsx
// Modal: corpo rola, rodapé cola embaixo (desktop + mobile)
<SheetContent side="right" className="… flex flex-col p-0">
  <div className="shrink-0 border-b p-3">{/* header sem ação */}</div>
  <div className="flex-1 overflow-y-auto p-4">{/* corpo */}</div>
  <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2">
    <Button variant="outline" onClick={requestClose}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
    {isEdit && <Button variant="destructive" onClick={excluir}><Trash2 className="h-4 w-4 mr-1" />Excluir</Button>}
    <Button className="ml-auto" onClick={salvar} disabled={!dirty}>Salvar</Button>
  </div>
  <UnsavedChangesGuard dirty={dirty} confirm={confirm} message="…" />
</SheetContent>

// Página inteira
<div className="container mx-auto p-6 space-y-6 pb-24"> … </div>
<PageActionBar>
  <Button variant="outline" onClick={voltar}>Cancelar</Button>
  <Button className="ml-auto sm:ml-0" onClick={salvar}>Salvar</Button>
</PageActionBar>
```

**Regra de toque 44px:** os componentes base já a aplicam via `max-md:h-11` — `Button` (`src/components/ui/button.tsx:21`), `Input` (`src/components/ui/input.tsx:22`), `SelectTrigger` (`src/components/ui/select.tsx:22`). Botões/áreas clicáveis customizadas usam `min-h-[44px] md:min-h-0`.

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
- Semáforo inline (texto/ícone): **`src/components/plan-tecido/PaletaColecao.tsx`** (OC ⏰ encomendado / 🏠 em casa, via `Clock`/`Home`), **`src/components/otb/ColecaoSheet.tsx:416`**.
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

## J. Dialog PAGINADO (wizard) — 1 página por item a confirmar

**Uso:** confirmar/gerar N artefatos de uma vez, cada um com campos próprios, quando os dados já-sabidos vêm pré-preenchidos e o usuário só completa o que falta (ex.: **Fazer pedido** do Plan. Tecido = 1 página por OC). Um `Dialog` com **cabeçalho "X de N"**, navegação **Anterior/Próxima** e, na última página, a ação final (**"Gerar N …"**), desabilitada quando não há nada a confirmar.

**Regras:**
- Pré-computar as páginas no cliente com a MESMA regra do servidor (ex.: split ≤2 tecidos por OC), pra que "1 página = 1 artefato" não minta.
- Estado por página em `Record<number, Resposta>` (respostas independentes); o dado pré-preenchido (imutável) vem da prévia, o "a preencher" é por página.
- Campos já-sabidos = read-only; campos a preencher = editáveis. Reusar os inputs padrão (`DateField`, `NumberInput`, `ResponsavelSelect`) — **igual à tela do artefato final** (não inventar campos diferentes da OC).
- Avisos que não geram artefato (ex.: "sem fornecedor", "bloqueios") aparecem na 1ª página, e a ação final conta só o que de fato gera.

**Reutilizar:** **`src/components/plan-tecido/FazerPedidoWizard.tsx`** (páginas via `paginasDe(previa)`, `passo`/`respostas`, footer Anterior/Próxima/Gerar). Base: **`src/components/ui/dialog.tsx`**.

```tsx
<Dialog open onOpenChange={(o) => { if (!o && !mut.isPending) onClose(); }}>
  <DialogContent className="max-w-2xl">
    <DialogHeader><DialogTitle>Fazer pedido — OC {passo + 1} de {total}</DialogTitle></DialogHeader>
    {/* campos a preencher desta página + tabela pré-preenchida (read-only) */}
    <DialogFooter className="justify-between">
      <Button variant="ghost" disabled={passo === 0} onClick={() => setPasso((p) => p - 1)}>Anterior</Button>
      {ultima
        ? <Button disabled={n === 0} onClick={() => mut.mutate()}>Gerar {n} OC(s)</Button>
        : <Button onClick={() => setPasso((p) => p + 1)}>Próxima</Button>}
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

> **§K–§P — padrões estabelecidos no mockup do Produto Acabado (ago/2026).** Nasceram do redesign da família de revenda (Produto Acabado · OC P. Acabado · card revenda no Plan. Produto) e valem para TODO o sistema — a padronização acontece tela a tela (ver §P). Guia visual desses padrões ainda pendente no `ui-padroes.html`.

## K. Divisão por função — dado de outra tela = RESUMO EM TEXTO, nunca campo travado

- Uma tela só renderiza **CAMPO** para o dado de que ela é **DONA**. Dado cuja edição mora em outra tela aparece como **tira de resumo** (pares rótulo/valor sobre `bg-muted`, `tabular-nums`) + link **⧉ "editar em X"** — NUNCA como input `disabled`/read-only (campo travado parece bug e convida clique).
- `CampoRO` (cinza) fica reservado a **DERIVADOS da própria tela** (§D); espelho de outra tela = texto.
- Exemplo canônico: card do Produto Acabado — identidade/taxonomia (dono = Plan. Produto, que já edita nome/grupo/categoria/subcats hoje) vira resumo no header; só a COMPRA (fornecedor, REF forn., proporção, qtd, valores, desconto) tem campos.
- Componente a criar: **`<InfoStrip>`** em `src/components/shared/` (lista de `{label, valor, hi?}`; flex-wrap; gap 8×22).

## L. Ações de CICLO na tela; ações do ITEM no card

- **Voltar · Excluir · [ação de negócio] · Salvar** são da **TELA** (barra sticky §G) — nunca aparecem por card. **Excluir = destructive PREENCHIDO** (fundo vermelho), não outline.
- O **card** carrega só o que é do item: atalho **⧉** (abre a tela dona) e menu **⋯** (ações secundárias: criar card, aplicar, excluir o item — com AlertDialog).
- Canvas-planejador (Plan. Tecido, Produto Acabado): rodapé = **Voltar/Subcoleções · Fazer pedido · Salvar** (sem Excluir de tela).
- Pílula âmbar "alterações não salvas" no **topo-direito** (header da tela e/ou do card aberto) — `UnsavedIndicator` (§A).

## M. Canvas de cards — colapsáveis + setores acordeão

- Card default **COLAPSADO** (só header; chevron ▸/▾ via CSS `::before`); densidade alvo **4–5 cards por tela**; lanes por categoria com contador **"N produtos · X pç"**.
- Card aberto: **setores numerados em acordeão**; setor colapsado carrega **resumo inline na própria linha** (pill à direita — ex.: Preço → "Varejo R$ 210,50 · Atacado R$ 151,56"), então colapsar não esconde a informação-chave.
- Header do card aberto = identidade completa em 2 linhas (nome; REF `AUTO` · fornecedor · Σ pç; taxonomia › coleção · ⧉) — evita seção "Geral" duplicando o header.
- Navegação do canvas: coleção → subcoleção por **grids de cards + breadcrumb** (padrão vivo do Plan. Tecido), não tabs; rail de resumo à esquerda colapsável.

## N. Grade, proporção (peso) e variantes

- Grade de proporção: **TODAS as size-keys cadastradas**, `0` como placeholder apagado; pesos usados em destaque âmbar. Nunca resumir em texto ("38·1 40·1") nem esconder tamanhos não usados.
- Distribuição por peso: total → destrincha **automática** (método do **maior resto** — Σ células ≡ total, re-derivado no servidor) → células **editáveis** (visual `primary-soft`); rotular "auto + editável".
- Variante SEMPRE **"cor base · cor apelido"** via `src/lib/variante.ts`; cabeçalho de coluna **"Variante"**, não "Cor".
- Cadeia monetária SEMPRE explícita e completa: bruto → desconto (campo) → total c/ desconto → v. unitário real (derivados em InfoStrip §K) — não pular passos.
- **Bloco de compra** (fornecedor · REF forn. · qtd · valor): campos **empilhados, 1 por linha** — rótulo à esquerda (~150px), valor à direita (numérico com largura contida) — formato da planilha de referência do dono. Grid de 4 colunas fica pros forms densos de registro (§O).
- Preço: **o preço é o campo digitado**; markup real = preço ÷ base (derivado); markup da linha do cadastro = sugestão (sugerido arredonda p/ ,90 — `preco.ts`). Não introduzir markup digitável por item sem decisão explícita.

## O. Formulário de registro (padrão OC)

- Editar = **Sheet 70vw**; Novo = **Dialog com o MESMO formulário** (`OcModalShell`) — o form curto "só essencial" no Dialog diverge do padrão.
- Seções numeradas **"N ·" CONTÍNUAS** (não colapsáveis) + **trilho de âncoras** à esquerda com scroll-spy e cadeado nas seções travadas (`OcAnchorRail`).
- Anexos = **chips FileField** (nome do arquivo + ícone zoom; clique = Dialog de visualização) — thumbnails só em galeria de fotos de modelo.
- Lista com **abas por status** (ex.: Encomendadas · Recebidas · Estoque) + ações contextuais por aba.
- Rodapé: Voltar · Excluir · **[transição de status]** (ex.: Marcar Recebido) · Salvar.

## P. Rollout — padronização tela a tela

Aplicar §K–§O **de pouco em pouco, uma tela por vez** (cada adoção = rodada própria de mockup→aprovação→implementação). Status em ago/2026:

| Tela | Padrões a aplicar | Status |
|---|---|---|
| Produto Acabado + OC P. Acabado (novas) | K L M N O | ✓ implementado (ago/2026, `.superpowers/sdd/2026-08-07-produto-acabado-revenda/`) |
| OC Tecido | referência do §O | ✓ no ar (Navy Trust v2) |
| Plan. Tecido | referência do §M (navegação/rail) | ✓ no ar; conferir L (Excluir/⋯) e K |
| Plan. Produto (Planejamento) | K (custo/preço como resumo?) · L · M (cards colapsados ✓) · N (variante · apelido) | a alinhar |
| Desenvolvimento | K (dados do Planejamento) · N | a alinhar |
| OC Aviamento / OC Insumo | O (Sheet+âncoras+chips+abas) | a alinhar |
| PCP Serviços / CQ | N (variante · apelido nas grades destrinchadas) · K | a alinhar |
| Estoque / Direcionamento / Financeiro | K · L (barras/Excluir) | a alinhar |
| Cadastros | L · O parcial (Sheet/Dialog ✓) | conferir |

---

## Checklist rápido (dev)

- [ ] Cor via token semântico, nunca hex solto. Dirty/estimativa/atenção = `--warning` (`amber-*`).
- [ ] Rótulo de variante SEMPRE via `src/lib/variante.ts` (`labelVarianteRow`/`varianteLabel`).
- [ ] Valor calculado = `CampoRO` (`bg-muted`); valor editável = `Input`/`NumberInput` (branco).
- [ ] Tela de EDIÇÃO/formulário: container certo (editar=Sheet, novo=Dialog) + botões em barra sticky no rodapé (rodapé do modal, ou `<PageActionBar>`+`pb-24` em página) — NÃO no header. Lista: header + `<MobileActionBar>`.
- [ ] Toque ≥ 44px no mobile (`max-md:h-11` / `min-h-[44px] md:min-h-0`).
- [ ] Status via `StatusBadge` (tone semântico), não classes soltas.
- [ ] Formulário com Salvar: guarda de descarte via `useUnsavedGuard` + `<UnsavedChangesGuard>` (§A); nunca refazer à mão.
- [ ] Componentes novos (Breadcrumb, VarianteSwatch): criar em `src/components/shared/`, não em `src/components/ui/`.
- [ ] Dado de OUTRA tela = resumo em texto + ⧉ (§K), nunca input travado; campo só do que a tela é dona.
- [ ] Editável nasce VAZIO com placeholder — nunca 0/default preenchido; 0 do banco exibe vazio (§D); dirty normaliza 0≡null.
- [ ] Ações de ciclo (Voltar/Excluir/Salvar) = da TELA; card só ⧉ + menu ⋯ (§L). Excluir sempre preenchido.
- [ ] Grade de proporção com TODAS as size-keys (0 placeholder); variante "cor base · apelido"; split auto por maior resto, células editáveis (§N).
- [ ] Form de registro segue §O: Sheet 70vw + Dialog mesmo form + seções "N ·" com trilho de âncoras + anexos em chip.
```

---

## Q. Padrões v3 (cartilha) — referência rápida

> **Status:** aprovado como direção pelo dono, ago/2026. Tokens/componentes da cartilha **ainda não
> foram implementados** (camada 1 fica para depois) — até lá, **§Q vale para código NOVO**; código
> existente segue §A–§P até a rodada de implementação alcançá-lo (rollout tela a tela, como §P).
> Guia visual completo (12 padrões, demonstração Hoje→v3, "porquê" por padrão): artifact
> [`d03a192e-79ff-4b70-9f58-a6d58e8e1cdd`](https://claude.ai/code/artifact/d03a192e-79ff-4b70-9f58-a6d58e8e1cdd).
> Teste anti-drift (scanner, desligado até a implementação): `tests/unit/ui-padroes-antidrift.test.ts`.

### Q1. Espaçamento — escala base-4, 10 degraus

| Token | Valor |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-10` | 40px |
| `--space-12` | 48px |
| `--space-16` | 64px |

Defaults: página 24 desktop / 16 mobile · padding de card confortável 16 / compacto 12 · entre
seções 20–24 · label→controle 4 · entre campos 12–16 · ícone→texto 8 inline / 4 em chip. Nada fora
da escala.

### Q2. Títulos — hierarquia por papel, não por instinto

| Papel | Tamanho | Peso | Família | Extra |
|---|---|---|---|---|
| H1 de página | 22px (`--text-xl`) | 600 | Outfit | tracking `-0.01em` |
| Título Dialog/Sheet | 18px (`--text-lg`) | 600 | Outfit | |
| Título de seção | 16px confortável / 13px compacto | 600 | Outfit | |
| Label de campo | 13px (`--text-sm`) | 500 | Figtree | |
| Caption/meta | 12px (`--text-xs`) | 400 | Figtree | `--muted-foreground` |
| Eyebrow/badge/header de tabela | 11px (`--text-2xs`) | 600 | Figtree | UPPERCASE, tracking `.08em` ÚNICO |

Hoje o protótipo varia entre `.04em/.05em/.06em/.08em/.09em/.1em/.14em` (7 valores) pro mesmo papel
de "texto em caixa alta") — v3 fixa **`.08em`** único.

### Q3. Cores — 3 camadas, disciplina não muda a paleta

**Primitivo** (oklch bruto, nunca usado direto) → **semântico** (sempre `var(--…)`) → **componente**
(derivado de tela). A paleta em si **não muda** — já é a de `src/styles.css`; o que muda é a
disciplina: **zero hex solto** em componente fora de `src/components/ui/`.

| Token semântico | oklch | Hex aprox. |
|---|---|---|
| `--primary` | `oklch(0.52 0.09 248)` | `#3b6fa0` |
| `--background` / `--foreground` / `--card` / `--border` / `--muted` / `--accent` / `--destructive` / `--success` / `--warning` | (ver §0 no topo deste doc) | |

### Q4. Botões

- Altura **36px** (compacto **30px**), toque **44px** no mobile — **mantido**, já é regra hoje
  (`max-md:h-11` em `button.tsx`). Raio **8px**.
- Ordem FIXA na barra de ações: **Voltar** (outline, ícone `ArrowLeft`, esquerda) · **Excluir**
  (destructive PREENCHIDO — nunca outline) · **Salvar** (primary preenchido, `ml-auto`, direita).
- `disabled`: deixa de ser `opacity:.5` (hoje, `button.tsx:8`) → vira `background:var(--muted)` +
  `color:var(--muted-foreground)`, sólido (motivo sempre visível).
- Foco: `outline:2px solid var(--ring); outline-offset:2px` (hoje é `ring-1`, 1px sem offset).

### Q5. Fontes — par mantido, escala fechada

- **Figtree** (corpo, `--font-sans`) + **Outfit** (display/títulos/números-hero, `--font-display`) —
  já é o par de `src/styles.css:43-44`.
- Só **4 pesos**: 400 · 500 · 600 · 700.
- Escala de **9 degraus**, razão ~1,2, arredondada a inteiro:

| Token | px |
|---|---|
| `--text-2xs` | 11 |
| `--text-xs` | 12 |
| `--text-sm` | 13 |
| `--text-base` | 14 |
| `--text-md` | 16 |
| `--text-lg` | 18 |
| `--text-xl` | 22 |
| `--text-2xl` | 28 |
| `--text-3xl` | 34 |

Hoje: tamanhos soltos por tela, incluindo fracionários (`13.5`/`12.5`/`11.5`/`10.5`/`9.5`px) — v3
proíbe fracionário arbitrário fora da escala.

### Q6. Tamanhos — dois modos nomeados

| Modo | Controle | Padding de card | Uso |
|---|---|---|---|
| Confortável | 40px | 16 | forms / detalhe / dialogs |
| Compacto | 30–32px desktop, linha 32–36px | 12 | tabelas / canvas / listas densas |

Regra de ouro: nunca encolher um **INPUT de digitação** abaixo de 44px no toque, nem em modo
compacto. Raio: `--radius` 10px base · `--radius-sm` 7px (chip pequeno) · `--radius-lg` 14px
(Dialog/Sheet).

### Q7. Elevação — 5 níveis com propósito

| Nível | Sombra (claro) | Uso |
|---|---|---|
| 0 | flush (sem sombra) | input / tabela / célula |
| 1 | `0 1px 2px oklch(.20 .04 265 / .06)` | card em repouso |
| 2 | `0 2px 8px oklch(.20 .04 265 / .09)` | card em hover (+ `translate:0 -1px`) / dropdown |
| 3 | `0 8px 24px oklch(.20 .04 265 / .13)` | popover, rail, **barra de ações sticky** |
| 4 | `0 16px 48px oklch(.20 .04 265 / .20)` | Dialog / Sheet |

No escuro a sombra some — todo nível ≥1 pareia com um hairline (`inset 0 1px 0 branco/.05–.08`).
Hoje: 1 sombra plana única pra tudo (`shadow-sm`/`shadow` do shadcn).

### Q8. Ícones — lucide, 4 tamanhos

| Token | px | Uso |
|---|---|---|
| `--icon-xs` | 14 | badge |
| `--icon-sm` | 16 | inline com texto, botão |
| `--icon-md` | 20 | cabeçalho de página |
| `--icon-lg` | 24 | chip / hero |

`stroke-width:2` (1,75 em ≤14px). `color:currentColor`, nunca abaixo de 12px. Hoje: 8 tamanhos
soltos no protótipo (11/13/15/16/17/18/19/20px).

### Q9. Tons — fórmula única por tom

5 tons de feedback — **success/warning/danger/info/neutral** — cada um com `bg`/`fg` por fórmula
ÚNICA fixa: `color-mix(in oklab, tom X%, var(--card))` (fundo) e
`color-mix(in oklab, tom Y%, var(--foreground))` (texto).

| Tom | bg % (claro) | fg % (claro) | bg % (escuro) | fg % (escuro) |
|---|---|---|---|---|
| success | 15 | 62 | 20 | 66 |
| warning | 22 | 46 | 20 | 72 |
| danger | 13 | 66 | 20 | 70 |
| info | 13 | 70 | 20 | 74 |
| neutral | `--muted` direto | `--muted-foreground` direto | idem | idem |

Hoje (`StatusBadge.tsx`) o fundo mistura contra `transparent`, não contra `--card` — a cor final
depende do que está por trás e lava no tema escuro.

### Q10. Estados — receita única por estado

- **hover**: `bg:var(--accent)` ou elevação 2 + `translate:0 -1px`.
- **focus-visible OBRIGATÓRIO** em todo interativo: `outline:2px solid var(--ring); outline-offset:2px`
  (hoje: sem regra global de `:focus-visible` fora do `ring-1` do botão).
- **disabled**: `bg:var(--muted)` + texto `--muted-foreground` + motivo sempre visível — **nunca
  opacity**.
- **loading**: skeleton com shimmer que para em `prefers-reduced-motion`.
- **erro de carga**: `"—"` + `"tentar de novo"` — nunca `"0"`.

### Q11. Placeholders — já é regra do dono (§D)

Todo campo **EDITÁVEL** nasce **VAZIO** com placeholder — nunca pré-preenchido com 0/default. Vale
no round-trip: 0 gravado no banco EXIBE vazio+placeholder (0 ≡ vazio na exibição; o dado gravado não
muda). Placeholder mostra o **FORMATO** ("0,00" / "0" / "dd/mm/aaaa"), não substitui o label. Receita:
`value={x || ""}` + `placeholder`; salvar grava 0 se vazio; dirty normaliza 0≡null (não quebra o
selo de "não salvo"). §Q só formaliza visualmente o que §D já decidiu — sem mudança de regra.

### Q12. Números — decimais e inteiros

pt-BR sempre: milhar "." · decimal ",".

| Tipo | Casas | Helper |
|---|---|---|
| Dinheiro | SEMPRE 2 | `brl()` / `fmtNum()` (`src/lib/format.ts`) |
| Metragem/consumo | mínimo 2, até 4 sem arredondar alta precisão | `fmtNumEdit` |
| Quantidade/peça | inteiro, sem casas | `NumberInput integer` |
| % | **1 casa decimal (proposta — pendente confirmação do dono)** | sem helper central hoje |

Toda célula numérica: `tabular-nums`, alinhada à **direita**, `nowrap` — dinheiro nunca quebra
linha. Hoje isso já vale nos **inputs** (`MoneyInput`/`CampoRO`); v3 estende pra QUALQUER exibição
numérica (tabela, badge, KPI) via classe `.num`.
