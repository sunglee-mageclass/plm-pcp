# Sheet do Planejamento inline no Produto Acabado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** O botão do card do Produto Acabado (hoje navega p/ `/criacao/planejamento?modelo=<id>`) passa a abrir o sheet do Planejamento inline, sem sair da tela. Voltar/Esc/fora fecha e volta pro P. Acabado; não-salvo confirma descarte (guard interno do sheet); "Ver no Produto Acabado" some quando aberto de lá; fechar após salvar recarrega os cards.

**Architecture:** Extrair o `ModeloDialog` (hoje função privada em `criacao.planejamento.tsx`, 3474 linhas) + suas dependências privadas para um componente exportado `PlanejamentoDetail` (arquivo próprio) + um hook `usePlanejamentoOpts` p/ as 7 listas de opções. O Planejamento passa a importá-lo (comportamento idêntico). O P. Acabado (`ProdutoAcabadoSheet`) importa e monta o `PlanejamentoDetail` com `contexto="produto-acabado"`. O guard de não-salvo é INTERNO ao sheet (já existe).

**Tech Stack:** Vite+React+TS, TanStack Query/Router, shadcn, Vitest.

## Global Constraints

- **NÃO mudar o comportamento do Planejamento** — a extração é refactor puro. QA completo do Planejamento (abrir modelo, editar, salvar, novo modelo, fechar-com-dirty, deep-link `?modelo=`) ANTES de tocar o P. Acabado.
- `tsc --noEmit` a CADA passo (a extração mexe em muitos imports; TS2304 = símbolo movido não reexportado). `npm run build` + anti-drift antes de cada commit.
- Preservar os queryKeys das 7 opções no `usePlanejamentoOpts` (cache compartilhado, sem refetch): estilistas `["colab-estilistas"]`? — CONFIRMAR os keys reais lendo `criacao.planejamento.tsx:335-363` e reproduzi-los EXATOS.
- O `ModeloDialog` abre o próprio `<Sheet>` — NÃO envolver num `<Sheet>` externo no P. Acabado (montar = abrir).
- Guard de não-salvo é interno (`useDirtySnapshot`+`useUnsavedGuard`+`UnsavedChangesGuard` no ModeloDialog) — não recriar no container.
- `size="editor"` no SheetContent já é interno ao ModeloDialog — não mexer.

---

### Task 1: Extrair `ModeloDialog` → `PlanejamentoDetail` (componente exportado) + `usePlanejamentoOpts`

**Files:**
- Create: `src/components/planejamento/PlanejamentoDetail.tsx` (o ModeloDialog + deps privadas que SÓ ele usa)
- Create: `src/components/planejamento/modelo-shared.ts` (tipos/helpers compartilhados entre a página e o detail: `Opt`, `CatOpt`, `LinhaOpt`, `ArtigoOpt`, `Draft`, `emptyDraft`, `draftFromModeloRow`, e o que mais for usado por AMBOS)
- Create: `src/hooks/usePlanejamentoOpts.ts` (as 7 `useQuery` de opções)
- Modify: `src/routes/_authenticated/criacao.planejamento.tsx` (remove as defs movidas, importa)

**Interfaces:**
- Produces: `export function PlanejamentoDetail({ modeloId, onClose, onSaved, contexto }: { modeloId: string | null; onClose: () => void; onSaved: () => void; contexto?: "planejamento" | "produto-acabado" })`. `contexto` default `"planejamento"`.
- Produces: `export function usePlanejamentoOpts(): { estilistas; linhas; meses; anos; grupos; categorias; artigos }` (mesmos tipos/keys de hoje).

- [ ] **Step 1:** Ler `criacao.planejamento.tsx` inteiro nas regiões do `ModeloDialog` (1387..~2996) + os helpers/tipos/sub-componentes privados que ele usa (`Draft` 1240, `emptyDraft` 1269, `draftFromModeloRow` 1286, `Opt`/`CatOpt`/`LinhaOpt`/`ArtigoOpt`, `Secao`, `FieldText`, `FieldSelect`, `MultiArtigosField`, `PhotoList`, `FileThumb`, `SingleFileField`, e quaisquer consts/helpers). Mapear quais são usados SÓ pelo dialog (vão p/ `PlanejamentoDetail.tsx`) vs também pela página (vão p/ `modelo-shared.ts`).
- [ ] **Step 2:** Criar `modelo-shared.ts` com os tipos/helpers compartilhados; criar `usePlanejamentoOpts.ts` movendo as 7 `useQuery` (keys EXATOS). Criar `PlanejamentoDetail.tsx` com o `ModeloDialog` renomeado p/ `PlanejamentoDetail` + as deps exclusivas dele; o componente chama `usePlanejamentoOpts()` internamente (o caller não passa as 7 props). `contexto` prop adicionada (default "planejamento").
- [ ] **Step 3:** Ajustar os 2 pontos de navegar-p/-P.Acabado por `contexto`:
  - (a) `:2674-2676` "**Ver no Produto Acabado**" (botão visível, ramo revenda): envolver em `{contexto !== "produto-acabado" && (...)}` — some quando aberto de lá.
  - (b) `:1768-1772` `criarProdutoAcabado.onSuccess` — é NAVEGAÇÃO automática pós-criar (não botão). Quando `contexto === "produto-acabado"`, NÃO navegar (`navigate` levaria pra tela onde já está); em vez disso chamar `onClose()` (fecha o sheet; o `onSaved`/invalidate do container recarrega os cards com o novo produto). Ou seja: `contexto === "produto-acabado" ? onClose() : navigate({...})`. O toast de sucesso e o invalidate `["pa-produto-modelo"]` permanecem nos dois casos.
  - ⚠️ Nota: o BOTÃO que dispara `criarProdutoAcabado` (o "Criar produto acabado" no ramo manufaturado) pode CONTINUAR visível no contexto P.Acabado (criar/vincular ainda faz sentido) — só a NAVEGAÇÃO final muda p/ fechar. Confirmar lendo onde o botão está; se preferir, esconder o botão também é aceitável, mas o mínimo é não navegar.
- [ ] **Step 4:** Em `criacao.planejamento.tsx`: remover as defs movidas, importar `PlanejamentoDetail` + `usePlanejamentoOpts` (usar o hook no lugar das 7 queries inline); trocar `<ModeloDialog modeloId={openId} estilistas=... .../>` por `<PlanejamentoDetail modeloId={openId} onClose=... onSaved=... />` (sem as 7 props — o hook cuida). Manter o `{(openNew || openId) && ...}` e o deep-link `?modelo=`.
- [ ] **Step 5:** `npx tsc --noEmit` = 0 (o mais crítico — confirma que nada quebrou na movimentação). `npm run build`. anti-drift. **QA :5173 do PLANEJAMENTO** (não do P. Acabado ainda): abrir um modelo → sheet abre igual; editar+salvar → salva e fecha; novo modelo (botão Novo) → Dialog abre; fechar com edição pendente → confirma descarte; deep-link `/criacao/planejamento?modelo=<id>` → abre o sheet. TUDO idêntico ao de antes.
- [ ] **Step 6: Commit** `refactor(planejamento): extrai ModeloDialog→PlanejamentoDetail + usePlanejamentoOpts (comportamento idêntico)`

---

### Task 2: Produto Acabado abre o `PlanejamentoDetail` inline

**Files:**
- Modify: `src/components/produto-acabado/ProdutoAcabadoSheet.tsx` (estado + render do detail)
- Modify: `src/components/produto-acabado/ProdutoCard.tsx` (botão → prop `onAbrirPlanejamento`)

**Interfaces:**
- Consumes: `PlanejamentoDetail` (Task 1).
- Produces: `ProdutoCard` ganha prop `onAbrirPlanejamento?: (modeloId: string) => void`.

- [ ] **Step 1:** `ProdutoCard.tsx`: adicionar `onAbrirPlanejamento?: (modeloId: string) => void` às props. No botão (`:354-363`), trocar `onClick={(e) => { e.stopPropagation(); navigate({ to: "/criacao/planejamento", search: { modelo: produto.modelo_id } }); }}` por `onClick={(e) => { e.stopPropagation(); onAbrirPlanejamento?.(produto.modelo_id!); }}`. Manter o `title`. (Se `onAbrirPlanejamento` não vier, o botão pode cair no navigate antigo como fallback OU só não fazer nada — preferir: se a prop existe, usa; senão mantém o navigate. Assim não quebra outros usos do ProdutoCard, se houver.)
- [ ] **Step 2:** `ProdutoAcabadoSheet.tsx`: `const [planModeloId, setPlanModeloId] = useState<string | null>(null);`. No `<ProdutoCard ... />` (`:456`), adicionar `onAbrirPlanejamento={setPlanModeloId}`.
- [ ] **Step 3:** No `ProdutoAcabadoSheet`, renderizar (fora do map de cards, no corpo do componente):
  ```tsx
  {planModeloId && (
    <PlanejamentoDetail
      modeloId={planModeloId}
      contexto="produto-acabado"
      onClose={() => setPlanModeloId(null)}
      onSaved={() => qc.invalidateQueries({ queryKey: ["produtos-acabados", colecaoId] })}
    />
  )}
  ```
  (`qc` = `useQueryClient()` já existe :159; `colecaoId` já no escopo. A query dos cards é `["produtos-acabados", colecaoId]` :305 — invalidar recarrega os cards.)
- [ ] **Step 4:** import do `PlanejamentoDetail` em `ProdutoAcabadoSheet.tsx`.
- [ ] **Step 5:** `npx tsc --noEmit`; `npm run build`; anti-drift. QA :5173 no P. Acabado: abrir uma subcoleção → clicar no botão do card → o sheet do Planejamento abre POR CIMA (não navega); "Ver no Produto Acabado" NÃO aparece; editar+salvar → fecha e os cards atualizam; Voltar/Esc com edição pendente → confirma descarte; sem edição → fecha e volta pro P. Acabado.
- [ ] **Step 6: Commit** `feat(produto-acabado): botão do card abre o sheet do Planejamento inline (sem navegar)`

---

### Task 3: Fechamento

- [ ] **Step 1:** `tsc --noEmit`=0; build; anti-drift. QA final dos DOIS fluxos (Planejamento normal intacto + P. Acabado inline).
- [ ] **Step 2:** Review final da branch (opus): a extração não mudou o Planejamento (props/estado/guard/deep-link preservados); o `usePlanejamentoOpts` usa os keys certos (sem refetch duplicado); o `contexto` esconde os 2 botões certos; o P. Acabado monta/desmonta o detail corretamente e invalida os cards; guard de não-salvo funciona nos 2 contextos.

## Self-Review

**Spec coverage:** extração reutilizável → T1; botão inline + esconder "Ver no P.Acabado" + atualizar cards + guard → T1(contexto)+T2. Fora: mudar campos do sheet, novo-modelo pelo P.Acabado (só edição), abrir em outras telas.

**Placeholder scan:** T1 tem o método (mapear deps privadas, mover, reimportar) — o agente LÊ o arquivo real p/ a lista exata de deps (não dá p/ enumerar 100% sem ler); T2 tem arquivo:linha exatos (botão :354, card :456, query :305, guard interno confirmado).

**Type consistency:** `PlanejamentoDetail` props idênticas em T1(def)/T1(planejamento usa)/T2(P.Acabado usa). `usePlanejamentoOpts` retorno = tipos de hoje. `contexto` string literal.

**Riscos:** (a) extração quebrar o Planejamento — T1 Step 5 é o gate (QA completo antes do P.Acabado); a review final compara. (b) deps privadas esquecidas na movimentação → TS2304 (tsc pega). (c) queryKeys divergentes no hook → refetch/duplicação (Step 2 exige keys exatos). (d) o :1771 é navegação pós-mutation, não um botão simples — ler o contexto e esconder o BOTÃO/ação certa, não a mutation.