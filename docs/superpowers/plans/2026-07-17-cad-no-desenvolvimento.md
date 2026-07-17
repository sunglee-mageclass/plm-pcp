# CAD dentro do Desenvolvimento (CAD extinto como tela) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps usam checkbox (`- [ ]`).

**Goal:** Extinguir a TELA de CAD; o cálculo de corte vira seção "4. CAD" do card (pós-Enviar), a baixa de estoque vira a tela "Explosão", as fichas imprimem do card, e o fluxo vai dev → Explosão → Serviços. Mantendo a entidade `cad` como encanamento invisível (0 refactor de FK).

**Spec:** `docs/superpowers/specs/2026-07-17-cad-no-desenvolvimento-design.md` (§11 = revisão crítica).
**Impacto:** `docs/superpowers/specs/2026-07-17-cad-no-desenvolvimento-impacto.md`.
**Checkpoint de reversão:** tag `estavel-pre-cad-2026-07-17` (commit 55e7e85).

**Tech:** Vite+React+TS+TanStack Router/Query+Supabase. Build: `npm run build`; tsc: `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339|TS2322" || echo OK`.

## Global Constraints
- **Reversibilidade (regra do dono):** cada fase é validada em produção ANTES da próxima. A **tela de CAD roda em PARALELO** durante F1+F2 (nada removido). F3 (extinguir) só depois de F2 validada. Rollback total: `git reset --hard estavel-pre-cad-2026-07-17`.
- **Decisões travadas:** (1) card **TRAVA** BOM/grade após "Enviar" (edição = reverter o Enviar) — sem re-sync. (2) Fichas + cálculo "4. CAD" só **após Enviar** (cad existe) — sem fallback de `useFichaData`, sem colunas draft.
- **`cad` invisível:** tabelas `cad`/`cad_grades`/`cad_id` FICAM. **Corte NÃO escreve `grades_reais`** (já semeada = grade cheia na criação do `cad`, no Enviar). CQ refina por defeito, como hoje. Nenhuma dupla-escrita.
- **Sidebar gate:** não mudar o gate de módulo do Consumo por OC (fica `producao`); só reposicionar visualmente.
- Antes de commitar: build + tsc. Migration (se houver) por `psql "$(cat /tmp/dburl.txt)" -f`, idempotente. Revisar embeds/RLS/queryKeys.

---

# FASE 1 — Sidebar (isolada, executável agora)
Renomear grupos + reposicionar Consumo por OC. **Validar em produção antes da F2.**

### Task 1.1: Renomear grupos (Criação→Estilo & Engenharia, Produção→PCP)

**Files:** Modify `src/components/app-sidebar.tsx` (MODULE_META, linhas 64-71).

- [ ] **Step 1: Editar MODULE_META**
```ts
criacao: { title: "Estilo & Engenharia", icon: Palette },
producao: { title: "PCP", icon: Factory },
```
- [ ] **Step 2: Conferir override por-loja.** O título é `tabLabels[m.module] || MODULE_META...` (linha 188), e `tabLabels` vem de `useTabLabels()` (linha 135, do `tenant_config`). Se a loja-alvo tem `tab_labels.criacao`/`.producao` fixando o nome antigo, o rename NÃO aparece. Verificar:
```bash
psql "$(cat /tmp/dburl.txt)" -tA -c "select tenant_id, tab_labels from tenant_config where tab_labels ? 'criacao' or tab_labels ? 'producao';"
```
Se houver, remover as chaves (por loja): `update tenant_config set tab_labels = tab_labels - 'criacao' - 'producao' where tenant_id = '<id>';` (envolver em `BEGIN;…COMMIT;`). Documentar quais lojas foram limpas.
- [ ] **Step 3:** `npx tsc --noEmit … || echo OK` → OK; `npm run build` → sucesso.
- [ ] **Step 4: Commit** `feat(sidebar): Criação→Estilo & Engenharia, Produção→PCP`.

### Task 1.2: Consumo por OC abaixo de Desenvolvimento (sem mudar o gate)

**Files:** Modify `src/components/app-sidebar.tsx` (pós-processamento de `visibleMainItems`, perto das linhas 194-204).

**Abordagem (mínima, sem tocar permissão/gate):** o item `producao_consumo_oc` continua sendo construído dentro do grupo `producao` (gate `isModuleEnabled('producao')` intacto). Depois de montar `visibleMainItems`, **mover o sub-item** de consumo-oc do grupo Produção/PCP para o grupo Estilo & Engenharia, logo após Desenvolvimento. Se `producao` estiver desligado, o sub não foi construído e nada aparece (correto: consumo é feature de produção).

- [ ] **Step 1: Adicionar o move após `moveTop(...)`** (linha ~200):
```ts
// Consumo por OC é feature de Produção (gate producao), mas exibido no grupo Estilo &
// Engenharia, logo abaixo de Desenvolvimento (pedido do dono). Move só a exibição.
const eng = visibleMainItems.find((x) => x.url === "/criacao");
const pcp = visibleMainItems.find((x) => x.url === "/producao");
if (eng && pcp) {
  const ci = pcp.subs.findIndex((s) => s.key === "producao_consumo_oc");
  if (ci >= 0) {
    const [consumo] = pcp.subs.splice(ci, 1);
    const di = eng.subs.findIndex((s) => s.key === "criacao_desenvolvimento");
    eng.subs.splice(di >= 0 ? di + 1 : eng.subs.length, 0, consumo);
  }
}
```
- [ ] **Step 2: Verificação manual** (headless ou navegador): logar, conferir que "Consumo por OC" aparece sob Desenvolvimento em Estilo & Engenharia, some de PCP, e o link `/producao/consumo-oc` abre. Com `producao` desligado, não aparece.
- [ ] **Step 3:** tsc + build.
- [ ] **Step 4: Commit** `feat(sidebar): Consumo por OC abaixo de Desenvolvimento (gate producao mantido)`.

### Task 1.3: Validação da F1 + push
- [ ] Build + tsc + smoke (abrir sidebar, ver os 2 nomes novos + Consumo por OC no lugar).
- [ ] `git push origin main`. **PARAR e validar em produção** antes da F2.

---

# FASE 2 — CAD no card + tela "Explosão"
Tela de CAD **continua ativa em paralelo**. Só depois de F2 validada é que a F3 a extingue.
> Cada task abaixo terá detalhamento TDD/bite-sized no momento da execução da F2 (após F1 validada). Aqui: escopo, arquivos, código-chave e riscos já mapeados.

### Task 2.1: Verificar/garantir a semeadura da grade real no "Enviar"
**Objetivo:** confirmar que `enviar_modelo_para_cad` deixa `cad_grades.grades_reais = grade cheia` (planejada) na criação. Se já faz (investigação indica que sim: copia `planejada=real`), **nenhuma mudança de banco**. Se não, ajustar a RPC (aditivo).
- [ ] Ler `pg_get_functiondef('public.enviar_modelo_para_cad')`; confirmar cópia de grades com `grades_reais = grades_planejadas`.
- [ ] Teste de integração transacional (`withTx`/`comoUsuario`): enviar um modelo → `cad_grades.grades_reais` = grade do modelo. (Se já verde, marcar OK sem migration.)

### Task 2.2: Botão único "Enviar" no card
**Files:** Modify `src/components/desenvolvimento/ModeloDetailPanel.tsx` (botão "Enviar ao CAD" ~763-784).
- Renomear/repurpor "Enviar ao CAD" → **"Enviar"** (mesma RPC `enviar_modelo_para_cad`; mesmas guardas de "pode enviar": aprovado + BOM completo + grade). Texto/toast: "Enviado" (aparece em Explosão).
- Manter a **trava** existente (`locked = enviado_cad && !editing`) — decisão (1): pós-Enviar o BOM/grade congela; "Editar" = reverter (destrava, hoje via `excluir_cad`/reverter). Confirmar o caminho de reverter o Enviar.
- [ ] tsc + build.

### Task 2.3: Seção "4. CAD" no card (pós-Enviar) + botões de ficha
**Files:** Modify `ModeloDetailPanel.tsx` (accordion); reuse `src/components/producao/cad/CadTecidosSection.tsx` (tamanho folha/metragem), `useFichaData.ts`, `FichaTecnica.tsx`, `CadFichaCorte.tsx`, `PrintFicha.tsx`.
- Inserir seção **"4. CAD"** (renumerando: 5.Aviamentos, 6.Insumos, 7.Grade, 8.Custos, 9.Anexos). Só ativa quando `enviado_cad` (cad existe) — antes, placeholder "Envie para calcular o corte".
- Conteúdo: o **cálculo** (folhas/tamanho da folha/metragem planejada) lendo/gravando `cad_tecido_variantes` (reaproveitar `CadTecidosSection`, sem re-digitar consumo — reflete de "3. Tecidos").
- Botões **"Imprimir Ficha de Corte" / "Imprimir Ficha Técnica"** (montam `CadFichaCorte`/`FichaTecnica` via `PrintFicha` + `PrintArea` em portal; habilitam só com `cad` existente — decisão (2)).
- **Risco (custo congelado):** garantir que salvar o "4. CAD" não zera `cad_tecidos.custo_cad` (Fase B) — cobrir com teste (regressão do agente).
- [ ] tsc + build + smoke de impressão.

### Task 2.4: Nova tela "Explosão"
**Files:** Create `src/routes/_authenticated/criacao.explosao.tsx` (+ index/$id conforme padrão). Permissão `criacao_explosao` em `permissions-catalog.ts` + `PAGE_URLS` em `app-sidebar.tsx` + item no grupo Estilo & Engenharia (entre Desenvolvimento e Consumo por OC). Reuse a mutation de `baixar_estoque_tecido_corte` (hoje em `producao.cad.$modeloId.tsx:742-768`) e `CadTecidosSection` (metragem a enviar).
- Lista modelos **enviados e não cortados** (`enviado_cad=true` e `cad.enviado_corte=false`).
- Por modelo: **quantidade a enviar** (= grade cheia) + explosão (tecido/aviamentos/insumos derivados) + botão **"Dar baixa"** → `baixar_estoque_tecido_corte(_cad_id)` (baixa atômica + **déficit**; toast de déficit). Marca `enviado_corte=true` → aparece em Serviços.
- **Corte NÃO escreve `grades_reais`** (já real desde o Enviar). Reverter = `reverter_corte_tecido` (existe).
- Permissão nova: registrar `criacao_explosao` no catálogo + seed em `user_permissions`/`permissions` se necessário (validar como a permissão é semeada por loja).
- [ ] tsc + build + integração (baixa + déficit).

### Task 2.5: Sidebar da F2 + validação
- Adicionar item "Explosão" no grupo Estilo & Engenharia (ordem: Planejamento · Desenvolvimento · Explosão · Consumo por OC).
- [ ] Build + tsc + smoke do fluxo dev → Enviar → Explosão → baixa → Serviços. `git push`. **Validar em produção antes da F3.**

---

# FASE 3 — Extinguir a TELA de CAD (só após F2 validada; reversível)
**Files:** `src/routes/_authenticated/producao.cad*.tsx` (rota), `app-sidebar.tsx` / `permissions-catalog.ts` (item), + os ~5 links.

### Task 3.1: Redirecionar a rota + remover do sidebar
- Fazer `/producao/cad*` **redirecionar** para o destino novo (ex.: `/criacao/explosao` ou o card) em vez de 404 puro — evita quebra de bookmarks. Remover a entrada `producao_cad` do grupo PCP no `PAGES_CATALOG` (o item some do menu; a permissão `producao_cad` pode ficar p/ a ação "Corte/desmarcar" do `DownstreamImpactAlert`).
### Task 3.2: Atualizar os links que apontam pra tela de CAD
Da revisão (Agent 3): `DownstreamImpactAlert.tsx:36` (etapa "CAD"), `CadActions.tsx:42,60` (voltar), `producao.cad.$modeloId.tsx:54` (redirect pós-excluir), `producao.index.tsx:12` (hub). Cada `<Link>`/`navigate` → destino novo (card/Explosão) ou remover.
### Task 3.3: Manter tabelas + validar
- **NÃO** dropar `cad`/`cad_grades`/RPCs. Build + tsc + smoke (nenhum 404; fluxo intacto). `git push`.
- **Reversão da F3:** `git revert <commit F3>` restaura rota + item; dados intactos.

---

## Self-review (writing-plans)
- **Cobertura:** sidebar renames+move (F1) ✓; "Enviar" único (2.2) ✓; "4. CAD" no card + fichas (2.3) ✓; Explosão + baixa (2.4) ✓; extinguir tela + links (F3) ✓; grade real semeada no Enviar (2.1) ✓; reversibilidade (checkpoint + paralelo + revert) ✓.
- **Sem placeholder na F1** (código concreto). F2/F3: tasks com arquivos/código-chave/riscos; detalhamento TDD por task no momento da execução (após validar a fase anterior — regra de reversibilidade do dono).
- **Riscos da revisão endereçados:** gate×grupo (2.1.2/1.2 move sem mudar gate); tabLabels (1.1.2); custo congelado (2.3 risco+teste); links de CAD (3.2); permissão Explosão (2.4).
