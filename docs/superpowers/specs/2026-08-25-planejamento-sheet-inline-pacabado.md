# Sheet do Planejamento inline no Produto Acabado — Design

**Data:** 2026-08-25 · **Origem:** requisição 4 do dono ("o botão que redireciona pro Planejamento deve abrir o sheet ali mesmo, sem sair da tela")

## Objetivo

No Produto Acabado, o botão do card que hoje **navega** para `/criacao/planejamento?modelo=<id>` passa a **abrir o sheet do Planejamento (do modelo) inline**, por cima do Produto Acabado — sem trocar de tela, sem perder o contexto. Fechar volta pra onde estava. Sem salvar → confirma descarte. Ao fechar após salvar, os cards do P. Acabado atualizam.

## Estado atual (investigação)

- **Botão:** `src/components/produto-acabado/ProdutoCard.tsx:354-363` — `navigate({ to: "/criacao/planejamento", search: { modelo: produto.modelo_id } })`, ícone `ExternalLink`, `title="Abrir card no Plan. Produto"`. `produto.modelo_id` disponível.
- **Sheet do Planejamento = `ModeloDialog`** (`criacao.planejamento.tsx:1387`) — função NÃO-exportada, presa no arquivo (3474 linhas, exporta só `Route`). Abre seu PRÓPRIO `<Sheet>` internamente quando `isEdit=!!modeloId` (Dialog quando novo). Props: `modeloId`, 7 listas de opções (`estilistas/linhas/meses/anos/grupos/categorias/artigos`, buscadas por `useQuery` no `PlanejamentoPage` L335-363), `onClose`, `onSaved`. Depende de tipos/helpers privados do mesmo arquivo: `Draft`(1240), `emptyDraft`(1269), `draftFromModeloRow`(1286), `Opt`/`CatOpt`/`LinhaOpt`/`ArtigoOpt`, e sub-componentes `Secao`, `FieldText`, `FieldSelect`, `MultiArtigosField`, `PhotoList`, `FileThumb`, `SingleFileField`.
- **Precedente de reuso inline** (o padrão a espelhar): `CqDetail`/`TerceirizadosDetail`/`DirecionamentoDetail` são exportados dos arquivos `$modeloId` e importados nas listas, renderizados num `<Sheet open={!!sheetId}><SheetContent size="editor">{sheetId && <XDetail modeloId onClose .../>}</SheetContent></Sheet>` com `useUnsavedGuard`. `CqDetail` é route-agnóstico (só `useQueryClient`/`useReadOnly`/`useActiveTenantId`).
- **Botões internos do `ModeloDialog` que navegam p/ P. Acabado** (2, caminhos absolutos `/criacao/produto-acabado`, ~L1771 e ~L2159 do arquivo): o dono confirmou que "Ver no Produto Acabado" só faz sentido aberto pelo Planejamento; aberto DENTRO do P. Acabado deve sumir; e o "Voltar" deve fechar o sheet (não navegar).

## Decisões (confirmadas com o dono)

1. **Comportamento:** botão → abre o sheet do Planejamento inline; Voltar/Esc/fora fecha e volta pro P. Acabado.
2. **"Ver no Produto Acabado"** (e o 2º botão de navegar p/ P. Acabado) **escondidos** quando o sheet é aberto de dentro do P. Acabado.
3. **Atualiza ao fechar** (após salvar): os cards do P. Acabado recarregam.
4. **Não-salvo → confirma descarte** (guarda padrão `useUnsavedGuard`, como os outros sheets).
5. **Extração limpa:** `ModeloDialog` vira componente próprio exportado + hook das opções (não deixar acoplamento cruzado feio). Planejamento continua igual.

## Arquitetura

### 1. Extração do `ModeloDialog` → `PlanejamentoDetail` (componente próprio)

- **Novo arquivo** `src/components/planejamento/PlanejamentoDetail.tsx` (ou `ModeloDialog.tsx`): recebe o `ModeloDialog` + os tipos/helpers/sub-componentes privados que SÓ ele usa. O que for compartilhado com `PlanejamentoPage` (ex. `Opt`, `emptyDraft`) vai p/ um módulo de tipos/helpers (`src/components/planejamento/modelo-shared.ts`) importado por ambos.
- **Hook `usePlanejamentoOpts()`** (`src/hooks/usePlanejamentoOpts.ts` ou no shared): encapsula as 7 `useQuery` de opções. `PlanejamentoPage` passa a usá-lo (em vez das queries inline) E o P. Acabado usa também. Zero mudança de comportamento no Planejamento (mesmos queryKeys → cache compartilhado, sem refetch duplicado).
- `PlanejamentoDetail` recebe `modeloId`, `onClose`, `onSaved`, e as opções (via prop ou chamando o hook internamente — decidir no plano; provavelmente o hook internamente, p/ o caller não precisar montar 7 props).
- **Nova prop `contexto?: "planejamento" | "produto-acabado"`** (default `"planejamento"`): quando `"produto-acabado"`, esconde os 2 botões de navegar p/ P. Acabado.
- ⚠️ RISCO PRINCIPAL: a extração não pode mudar NADA no comportamento do Planejamento. O `ModeloDialog` é grande; mover exige levar todas as dependências privadas juntas. Estratégia: mover em bloco, ajustar imports, e diff-QA o Planejamento (abrir/editar/salvar/novo modelo) antes de tocar o P. Acabado.

### 2. Planejamento passa a importar o extraído

- `criacao.planejamento.tsx`: remove a definição local do `ModeloDialog` (+ helpers movidos), importa `PlanejamentoDetail` e `usePlanejamentoOpts`, renderiza igual (`{(openNew || openId) && <PlanejamentoDetail modeloId={openId} onClose=... onSaved=... />}`). Comportamento idêntico.

### 3. Produto Acabado abre o sheet inline

- Container = `src/components/produto-acabado/ProdutoAcabadoSheet.tsx` (onde `ProdutoCard` é renderizado). O estado do sheet vive ali (não em cada card):
  `const [planModeloId, setPlanModeloId] = useState<string|null>(null)`.
- O `ProdutoCard` recebe `onAbrirPlanejamento(modeloId: string)` via prop; o botão (`:354`) troca `navigate(...)` por `onAbrirPlanejamento(produto.modelo_id)`.
- No container, renderiza (SEM `<Sheet>` externo — o detail abre o próprio):
  `{planModeloId && <PlanejamentoDetail modeloId={planModeloId} contexto="produto-acabado" onClose={() => setPlanModeloId(null)} onSaved={() => { /* invalidar queries dos cards do P.Acabado */ }} />}`.
- `onSaved` invalida as queries do P. Acabado (recarrega os cards) — descobrir os queryKeys no plano (as queries que alimentam os `ProdutoCard`).
- O guard de não-salvo é INTERNO ao detail (ver Dirty/guard) — o `onClose` só é chamado após a confirmação.

### Dirty/guard (CONFIRMADO: o ModeloDialog já cuida sozinho)
- O `ModeloDialog` JÁ tem guarda interna própria: `useDirtySnapshot(draft)` + `dirty` combinado (draft + MO + grade revenda) + `useUnsavedGuard({ dirty, onClose })` + `<UnsavedChangesGuard>` + `<UnsavedIndicator>`. O botão "Voltar" já chama `requestClose` (confirma antes de fechar).
- **Consequência:** o container do P. Acabado NÃO precisa gerenciar dirty nem `useUnsavedGuard` próprio — só monta `<PlanejamentoDetail>` e passa `onClose` (que fecha o Sheet local) + `onSaved`. O guard interno do detail já pede confirmação no Voltar/Esc/fora, e ao confirmar chama o `onClose`. Simplifica o item (d).
- ⚠️ O `ModeloDialog` abre o PRÓPRIO `<Sheet open>` (não recebe `open`); o "monte = aberto" é o sinal. Então no P. Acabado NÃO envolvo num `<Sheet>` externo — só faço `{planModeloId && <PlanejamentoDetail modeloId={planModeloId} ... />}` (ele mesmo abre o Sheet). O `onClose` desmonta (setPlanModeloId(null)).

## Fora de escopo
- Mudar o conteúdo/campos do sheet do Planejamento (só reusá-lo).
- Abrir o sheet em outras telas além do P. Acabado.
- O caso "novo modelo" (Dialog) — o botão do P. Acabado só abre EDIÇÃO de um modelo existente (`modelo_id` presente), então é sempre o modo Sheet.

## Riscos
- (a) **Extração quebrar o Planejamento** — o maior risco. Mitigar: mover com todas as deps, QA completo do Planejamento (abrir/editar/salvar/novo/fechar-com-dirty) ANTES do P. Acabado; a review final compara o comportamento.
- (b) opções duplicadas: o hook `usePlanejamentoOpts` deve usar os MESMOS queryKeys das queries atuais (cache compartilhado, sem refetch).
- (c) os 2 botões internos de navegar: esconder por `contexto`, não remover (o Planejamento ainda os usa).
- (d) o "Voltar" do detail: já é `onClose` (fecha o sheet) — no P. Acabado o `onClose` fecha o Sheet local, então "volta" naturalmente. Confirmar que não há um `navigate` hardcoded no Voltar.
- (e) types.ts / tsc: a extração mexe em muitos imports — rodar `tsc --noEmit` a cada passo.
