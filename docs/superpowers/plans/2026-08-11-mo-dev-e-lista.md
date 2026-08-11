# MO por serviço no Dev + aprovação na lista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps com `- [ ]`.

**Goal:** (1) Custos do Desenvolvimento ganha o MESMO editor de Mão de obra por serviço do Planejamento (bidirecional — mesma tabela/RPCs); (2) a lista de cards do Planejamento ganha uma seção expandida de MO com Aprovar/Reprovar por serviço.

**Architecture:** Zero mudança de banco. `modelo_servico_mo` é a fonte única; `MaoObraEditor` (controlado puro) é reusado no Dev; a lista reusa os dados que JÁ busca (`["mo-resumo-list", modeloIdsAll]` → `modelo_mo_resumo(_ids)` com `linhas[]` mascaradas) e a mutation de aprovar que JÁ existe no route. Bidirecionalidade = cross-invalidation de queryKeys entre as 2 telas.

**Decisões do dono:** seção EXPANDIDA no card (sempre visível, não popover); só na lista do Planejamento.

## Global Constraints
- Branch `feature/plan-tecido-a1`; gates `npx tsc --noEmit` 0 + `npm run build` + `npx vitest run tests/unit`; commits com `Co-Authored-By: Claude Fable 5 <noreply@antropic.com>` (corrigir: noreply@anthropic.com).
- NÃO tocar em RPCs/triggers de MO (invariantes #8/#12 — enforcement por linha já existe no servidor); `aprovar_servico_mo` é o ÚNICO caminho de aprovar; **reprovar exige motivo** (AlertDialog com Action disabled sem motivo — padrão do `MaoObraEditor.tsx:119`).
- Máscara de custos: valores vêm NULL da RPC p/ quem não vê custos — a UI esconde `R$` nesses casos (nunca renderizar "R$ null").
- Revenda (`origem='revenda'`) NÃO tem MO — as superfícies novas não aparecem p/ revenda (paridade com `:2460`).

## Fatos pinados (verificados)
- `MaoObraEditor` props: `{linhas, categorias, podeVerCustos, podeAprovar, onChangeLinhas, onAprovar(catId), onReprovar(catId,motivo)}` (`MaoObraEditor.tsx:22-33`).
- Planejamento: linhas de `["mo-resumo", modeloId]` (`criacao.planejamento.tsx:1405-1415`); salva no submit via `salvar_modelo_servico_mo` (`:1879`, estado completo, gated podeVerCustos+mudou); aprova via mutation route-level `:1656-1679` invalidando `["mo-resumo"], ["mo-resumo-list"], ["modelo"], ["plan-custo-unit"], ["modelos-planejamento"]`.
- Dev: seção Custos `s5` gated `canView("criacao_desenvolvimento:custos")` (`ModeloDetailPanel.tsx:187-188, 1295, 2580`); hoje MO é linha read-only (`ModeloCustosSection.tsx:63-80`) com dados de `["modelo-mo-resumo", modeloId]` (`ModeloDetailPanel.tsx:252-262`).
- Lista: card = `ModeloCard` inline no route (`:935`, corpo `:966-1066`); já recebe `moEstado` de `moResumoLista` (`:390-397`); badge MO `:995-1000`/`:1027-1038`; `podeVerCustos`/`podeAprovarMaoObra` em `:945-946`.

### Task 1: Dev Custos — editor completo de MO (bidirecional)

**Files:** Modify `src/components/desenvolvimento/ModeloDetailPanel.tsx`, `src/components/desenvolvimento/modelo-detail/ModeloCustosSection.tsx` (ou hospedar o editor no Panel ao lado, mantendo a section enxuta — decidir pelo menor diff).

- [ ] Substituir a linha read-only de MO por `<MaoObraEditor>` completo dentro do setor Custos (s5): `linhas` semeadas de `moResumo.linhas` (mesmo seed do Planejamento `:1405-1415` — copiar a normalização); `categorias` = mesma query de `categorias_terceirizado` ativo=true que o Planejamento usa (localizar e replicar); `podeVerCustos = canView("criacao_desenvolvimento:custos")` (sempre true aqui — a seção já é gated); `podeAprovar = isEditando && canEdit("producao_servico_aprovacao")`.
- [ ] **Salvar**: no fluxo de save do card do Dev (onde `salvar_modelo_bom` roda), adicionar o mesmo passo do Planejamento `:1878-1879`: se linhas mudaram do snapshot → `salvar_modelo_servico_mo` (estado completo, nunca toca aprovado). Manter atômico na UX (mesmo botão Salvar).
- [ ] **Aprovar/Reprovar**: mutation no Dev espelhando `:1656-1679` (mesma RPC, motivo obrigatório no reprovar).
- [ ] **Cross-invalidation (a bidirecionalidade)**: toda escrita de MO no Dev invalida `["modelo-mo-resumo"]` E `["mo-resumo"]` E `["mo-resumo-list"]` E `["plan-custo-unit"]` E `["modelos-planejamento"]` (prefixos); no Planejamento, ADICIONAR `["modelo-mo-resumo"]` à lista de invalidations existente (`:1672-1676` e no onSuccess do salvar) — hoje o Dev não fica sabendo de edições do Planejamento sem refetch manual.
- [ ] Revenda: setor Custos do Dev p/ modelo revenda NÃO mostra o editor (MO não se aplica — conferir o que a seção mostra hoje p/ revenda e preservar).
- [ ] Gates + commit `feat(mo): Desenvolvimento edita/aprova MO por serviço (mesmo editor do Planejamento, bidirecional)`.

### Task 2: Lista do Planejamento — seção MO expandida com aprovar por serviço

**Files:** Modify `src/routes/_authenticated/criacao.planejamento.tsx` (ModeloCard + wiring); possivelmente extrair subcomponente `MoListaSection` no próprio arquivo ou em `src/components/planejamento/`.

- [ ] No `ModeloCard` (variante completa; avaliar compacta), abaixo do badge MO atual: seção expandida listando `moResumoLista[modelo.id].linhas` — por linha: nome do serviço · valor (`R$` SÓ se `podeVerCustos`; mascarado = omitir) · estado (✓ aprovada / ✗ reprovada c/ tooltip do motivo / pendente) · botões **Aprovar**/**Reprovar** inline quando `podeAprovarMaoObra` e linha pendente/reprovada (aprovada ganha "Desfazer"? NÃO — manter paridade com o editor: aprovada mostra estado; desaprovar não existe no editor da lista — verificar o que o MaoObraEditor oferece p/ linha aprovada e ESPELHAR exatamente).
- [ ] Reprovar abre o MESMO AlertDialog com motivo obrigatório (extrair/reusar o dialog do `MaoObraEditor` — se acoplado, extrair `MoReprovarDialog` compartilhado SEM mudar o editor por fora).
- [ ] Reusar a mutation de aprovar route-level existente (`:1656`) — se ela depende de estado do card aberto, generalizar por parâmetro `modeloId` (sem duplicar a lógica de invalidation; incluir a nova `["modelo-mo-resumo"]`).
- [ ] Visibilidade: seção só quando `(podeVerCustos || podeAprovarMaoObra)` && estado ≠ `sem_servico` && `origem !== 'revenda'`. Cards compactos (`:995`): manter só o badge (seção expandida é do card completo) — confirmar com screenshot.
- [ ] Densidade: linhas `py-1 text-xs`, botões `size="iconSm"`/xs (padrão tabela compacta) — a lista não pode dobrar de altura; se o modelo tem >3 serviços, truncar com "+N" expandível.
- [ ] QA visual (Playwright do repo, desktop+mobile): lista com cards de 1/3/5 serviços, usuário aprovador sem custos (valores omitidos) e com custos; screenshot no scratchpad da sessão.
- [ ] Gates + commit `feat(mo): aprovar MO por serviço direto na lista de cards do Planejamento`.

## Self-review
Cobertura: pedido (a) Task 1 (editor + bidirecional via cross-invalidation); pedido (b) Task 2 (aprovação por categoria na lista). Sem banco. Riscos: arquivo gigante planejamento.tsx (mudanças cirúrgicas); paridade de comportamento com o editor é o critério de review.
