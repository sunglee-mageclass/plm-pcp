# Fluxo de Revenda configurável (por loja) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** Config própria da revenda por loja (Config da Loja): quais colunas do kanban a revenda passa, requisitos por coluna, e quais seções/campos do sheet a revenda usa. Destrava os produtos de revenda (que hoje travam no gate de Tecido/CAD/Data). Fluxo interno intocado.

**Architecture:** 3 chaves novas em `tenant_config` (jsonb, sem migração de schema): `revenda_kanban_colunas: string[]`, `revenda_kanban_requisitos: Record<colKey,condKey[]>`, `revenda_campos: Record<string,boolean>`. Lidas em 4 pontos SÓ quando `origem==='revenda'`: seções do sheet, campos de Info Básicas, gate `cadMissing`, kanban board+status Select. UI nova em `admin/configuracoes.tsx` (card "Fluxo de Revenda", gated `produto_acabado`), reusando `RequisitosStatusDialog` + toggles.

**Tech Stack:** Vite+React+TS, Supabase (só jsonb em tenant_config), Vitest. Spec: `docs/superpowers/specs/2026-08-26-fluxo-revenda-configuravel-design.md`. Mockup: artifact `00ec5c95`.

## Global Constraints
- **SEM migração de schema.** As 3 chaves ridem no payload do `save` (`configuracoes.tsx:224` spread) e são semeadas no `DEFAULTS`/hidratação. `tenant_config` é jsonb-friendly.
- **Fluxo INTERNO byte-a-byte intocado.** Todo branch novo é `isRevenda ? configRevenda : <regra de hoje literal>`. Teste/QA: modelo não-revenda idêntico.
- **Fallbacks:** `revenda_kanban_colunas` ausente/[] ⇒ revenda usa TODAS as colunas (sem trava por omissão). `revenda_kanban_requisitos` ausente ⇒ sem requisitos (passa livre). `revenda_campos[k]` ausente ⇒ TRUE (visível), MAS o DEFAULTS de fábrica semeia FALSE para os 9: campos `modelista_id, piloteiro1_id, piloteiro2_id, piloteiro3_id, data_piloto1, data_piloto2, data_piloto3, data_desenho_tecnico, data_aprovacao` + seções `prova, s2, s-cad`. "Nome" nunca desligável.
- `REVENDA_COND_NA` (condições impossíveis p/ revenda, esmaecidas no dialog): `tecido_planejado, tecido_com_variante, grade_todas_variantes, cad_preenchido, enviado_cad, servico_finalizado, grade_cortada_lancada`. Const nova em `kanban-condicoes.ts`.
- `status_kanban` guarda LABELS (resolvidas p/ keys por `normalizeKanbanStatuses`). `revenda_kanban_colunas`/`revenda_kanban_requisitos` usam KEYS. UI mostra label, grava key.
- `npm run build` NÃO roda tsc → `npx tsc --noEmit`. Teste: `npx vitest run --no-file-parallelism`. Anti-drift verde. Padrões UI §Q (Switch/Dialog/Card primitivos; sem hex/px cru).
- Coluna fora de `revenda_kanban_colunas` p/ revenda = BLOQUEADA (esmaece igual falta-de-requisito).

---

### Task 1: Fundamentos — helper `revenda-config.ts` + defaults + catálogo NA + testes

**Files:** Create `src/lib/revenda-config.ts`, `tests/unit/revenda-config.test.ts`; Modify `src/lib/kanban-condicoes.ts`

**Interfaces:** Produz o tipo `RevendaConfig` + helpers puros que TODOS os 4 pontos de leitura usam (sem drift). Produz `REVENDA_COND_NA` e o mapa de campos-default.

- [ ] **Step 1:** `kanban-condicoes.ts`: adicionar `export const REVENDA_COND_NA: string[] = ["tecido_planejado","tecido_com_variante","grade_todas_variantes","cad_preenchido","enviado_cad","servico_finalizado","grade_cortada_lancada"];` com comentário (condições que revenda nunca satisfaz — estruturais). NÃO mudar `CONDICOES`/RPC (anti-drift intacto).
- [ ] **Step 2:** `src/lib/revenda-config.ts` — tipo e helpers PUROS:
  ```ts
  export type RevendaConfig = {
    colunas: string[];              // keys de colunas; [] = todas
    requisitos: Record<string, string[]>;
    campos: Record<string, boolean>; // seção/campo key -> visível
  };
  // Chaves de campo configuráveis (Info Básicas) + seções:
  export const REVENDA_CAMPOS_DEFAULT_OFF = ["modelista_id","piloteiro1_id","piloteiro2_id","piloteiro3_id","data_piloto1","data_piloto2","data_piloto3","data_desenho_tecnico","data_aprovacao","prova","s2","s-cad"];
  export const REVENDA_CAMPO_KEYS = [ ...9 campos... ]; // p/ a UI
  export const REVENDA_SECAO_KEYS = ["s1","prova","s2","s-cad","s3","s3e","s4","s5","s6"];
  // visível?(cfg, key): campo/seção aparece p/ revenda?
  export function revendaCampoVisivel(cfg: RevendaConfig|null|undefined, key: string): boolean {
    if (key === "nome" || key === "s1") return true; // sempre
    const v = cfg?.campos?.[key];
    if (v === undefined) return !REVENDA_CAMPOS_DEFAULT_OFF.includes(key); // default: OFF p/ os 9, ON p/ o resto
    return v !== false;
  }
  // coluna permitida p/ revenda?
  export function revendaColunaPermitida(cfg: RevendaConfig|null|undefined, colKey: string): boolean {
    const cols = cfg?.colunas ?? [];
    return cols.length === 0 || cols.includes(colKey); // [] = todas
  }
  // requisitos da revenda p/ uma coluna
  export function revendaRequisitos(cfg: RevendaConfig|null|undefined, colKey: string): string[] {
    return cfg?.requisitos?.[colKey] ?? [];
  }
  // monta o RevendaConfig do tenant_config bruto (as any)
  export function lerRevendaConfig(tc: any): RevendaConfig { ... colunas/requisitos/campos com defaults ... }
  ```
- [ ] **Step 3:** teste unit (`tests/unit/revenda-config.test.ts`): (a) `revendaCampoVisivel` — os 9 default OFF; "nome"/"s1" sempre ON; campo não-listado ON; override explícito respeitado; (b) `revendaColunaPermitida` — [] = todas true; lista = só as da lista; (c) `revendaRequisitos` — ausente = []; (d) `lerRevendaConfig` — parse robusto de tenant_config nulo/parcial.
- [ ] **Step 4: Commit** `feat(revenda): helpers puros de config de revenda (campos/colunas/requisitos) + REVENDA_COND_NA + testes`

---

### Task 2: Config da Loja — card "Fluxo de Revenda" (UI + persistência)

**Files:** Modify `src/routes/_authenticated/admin/configuracoes.tsx`; possivelmente `src/components/admin/RequisitosStatusDialog.tsx` (prop p/ esmaecer NA)

**Interfaces:** Consome `revenda-config.ts` + `status_kanban` (colunas) + `CONDICOES`. Produz as 3 chaves no `tenant_config` via o `save` existente.

- [ ] **Step 1 — defaults + hidratação.** `DEFAULTS`/`ConfigState` (`configuracoes.tsx:80-124`): adicionar `revenda_kanban_colunas: []`, `revenda_kanban_requisitos: {}`, `revenda_campos: <objeto semeando os 9 OFF>`. Na query de load (`:156-174`) incluir as 3 colunas no `.select`; na hidratação (`:176-213`) popular `cfg`. O `save` (`:224` spread) já persiste (confirmar que NÃO estão na lista de strip `:221`).
- [ ] **Step 2 — card "Fluxo de Revenda".** Novo `<Card>` no grid (`:315`), APÓS "Status do Kanban" (`:411`), **gated pelo módulo `produto_acabado`** (usar `useTenantModules`/`isModuleEnabled("produto_acabado")` — ver como o card Etapas PL faz o gate `etapas_pl` em `:1033`). Título "Fluxo de Revenda", descrição do mockup, badge "módulo Produto Acabado".
- [ ] **Step 3 — Bloco 1 (colunas + requisitos).** Listar as colunas de `cfg.status_kanban` (resolver label→key via `resolveStatusKey`); cada linha: label + toggle (Switch) que adiciona/remove a KEY de `cfg.revenda_kanban_colunas` + botão "Requisitos" (só habilitado se a coluna está ligada) que abre `RequisitosStatusDialog` com `requisitos={cfg.revenda_kanban_requisitos[key] ?? []}` e `onChange` gravando em `cfg.revenda_kanban_requisitos[key]`. Contador de requisitos na pílula.
- [ ] **Step 4 — RequisitosStatusDialog: esmaecer NA.** Passar uma prop nova `condsIndisponiveis?: string[]` (= `REVENDA_COND_NA`); no render das condições (`RequisitosStatusDialog.tsx:49-78`), as em `condsIndisponiveis` ficam disabled + tag "n/a revenda" + não togglam. Quando o dialog é aberto pelo fluxo NORMAL (kanban_requisitos), NÃO passa a prop (todas selecionáveis) — comportamento de hoje intocado.
- [ ] **Step 5 — Bloco 2 (seções + campos).** Listar `REVENDA_SECAO_KEYS` com rótulos amigáveis (mapa key→label: s1="1. Informações Básicas", prova="Ajustes na Prova", s2="Tecidos/Forros/Entretelas", s-cad="CAD", s3="Aviamentos", s3e="Insumos", s4="Grade", s5="Custos", s6="Anexos"); cada uma um Switch gravando `cfg.revenda_campos[secKey]`. A seção `s1` expande os `REVENDA_CAMPO_KEYS` (rótulos: modelista_id="Modelista", piloteiro1_id="Piloteiro 1"…, data_desenho_tecnico="Data Desenho Técnico", data_aprovacao="Data de Aprovação") com Switch cada gravando `cfg.revenda_campos[campoKey]`. "Nome" mostrado como travado ON (disabled). `s1` não desligável (sempre ON).
- [ ] **Step 6 — verificação.** `npx tsc --noEmit 2>&1 | grep -E 'TS2304|configuracoes|Requisitos'` vazio; `npm run build`; anti-drift. QA :5173 (reusar vite; módulo produto_acabado ligado numa loja): o card aparece, os toggles salvam, o dialog de requisitos esmaece as NA, recarregar preserva. Screenshot.
- [ ] **Step 7: Commit** `feat(revenda): card "Fluxo de Revenda" em Config da Loja (colunas+requisitos+seções/campos)`

---

### Task 3: Sheet — seções e campos escondidos p/ revenda + gate `cadMissing` afrouxado

**Files:** Modify `src/components/desenvolvimento/ModeloDetailPanel.tsx`, `src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx`

**Interfaces:** Consome `revendaCampoVisivel(cfg,key)`. O `secOrdem`, o `cadMissing` e o `ModeloInfoSection` passam a respeitar a config quando `isRevenda`.

- [ ] **Step 1 — ler a config no Panel.** O Panel já tem a query `["tenant-config-grade"]` (`:252-261`) — ampliar o `.select` p/ trazer `revenda_kanban_colunas, revenda_kanban_requisitos, revenda_campos`. Montar `const revendaCfg = useMemo(() => lerRevendaConfig(tenantCfg), [tenantCfg])`. `isRevenda` já existe (`:1518`).
- [ ] **Step 2 — secOrdem.** (`:1536-1540`) cada `{key, on}` passa a: `on: isRevenda ? revendaCampoVisivel(revendaCfg, key) && <regra-de-hoje-se-houver> : <regra-de-hoje>`. Ex.: `s5` hoje `on: podeVerCustos||podeAprovarMaoObra` → revenda: `revendaCampoVisivel(cfg,"s5") && (podeVerCustos||podeAprovarMaoObra)`. Demais seções hoje `on:true` → revenda: `revendaCampoVisivel(cfg,key)`. NÃO mudar o ramo não-revenda.
- [ ] **Step 3 — ModeloInfoSection: esconder campos.** Passar `isRevenda` + `revendaCfg` (ou uma função `campoVisivel(key)` pronta) como prop. Em cada campo dos 9 (`modelista_id` :227, `piloteiro1/2/3` :249/269/291, `data_piloto1/2/3` :250/270/292, `data_desenho_tecnico` :318, `data_aprovacao` :327): envolver em `{campoVisivel("<key>") && (...)}`. Cuidado: piloto2/3 já são condicionais (piloteiro2Aberto etc.) — combinar com `&&`. NÃO tocar Nome/Estilista/Categoria/Origem.
- [ ] **Step 4 — cadMissing afrouxado.** (`:1496-1512`) cada push condicional ganha guard de config p/ revenda:
  - "Data Desenho Técnico": `if ((!isRevenda || revendaCampoVisivel(cfg,"data_desenho_tecnico")) && (draft?.data_desenho_tecnico ?? "").trim()==="") push`.
  - "Data Piloto 1/2/3": idem com `data_piloto1/2/3`.
  - "ao menos 1 tecido com variante" / "grade preenchida": só exigir se a SEÇÃO estiver ligada — `if ((!isRevenda || revendaCampoVisivel(cfg,"s2")) && !hasTecidoComVariante) push` e `if ((!isRevenda || revendaCampoVisivel(cfg,"s4")) && gradeTotalGeral<=0) push`.
  - Nome/REF/Estilista/Categoria: continuam exigidos (mínimos). NÃO afrouxar p/ não-revenda.
- [ ] **Step 5 — verificação.** `tsc`/build/anti-drift. QA :5173: abrir um modelo de revenda (há 8 c/ ordem_criacao_enviada=true) numa loja c/ a config default → seções Tecidos/CAD/Prova somem, campos Modelista/Piloteiros/Datas somem, e o gate de "Enviar à Explosão" NÃO lista mais Tecido/Grade/Data (destrava). Modelo NÃO-revenda = seções/campos/gate idênticos. Screenshots dos dois.
- [ ] **Step 6: Commit** `feat(revenda): sheet esconde seções/campos e afrouxa o gate de envio conforme a config (destrava revenda)`

---

### Task 4: Kanban — colunas permitidas + requisitos da revenda no board e no status Select

**Files:** Modify `src/routes/_authenticated/criacao.desenvolvimento.tsx`, `src/components/desenvolvimento/ModeloDetailPanel.tsx`

**Interfaces:** Consome `revendaColunaPermitida`/`revendaRequisitos`. `podeEntrar`/`podeEntrarStatus` ganham branch por origem.

- [ ] **Step 1 — board: ler a config.** `criacao.desenvolvimento.tsx` já lê `status_kanban` (`:201-213`) e `kanban_requisitos` (`:216-223`); adicionar uma query (ou ampliar) p/ `revenda_kanban_colunas, revenda_kanban_requisitos, revenda_campos` → `revendaCfg`.
- [ ] **Step 2 — podeEntrar por origem.** `podeEntrar(modeloId, statusKey)` (`:287-288`): buscar o modelo (`modelos.find`), se `origem==='revenda'`: (a) se `!revendaColunaPermitida(cfg, statusKey)` → retornar bloqueado (`{ok:false, faltando:[{label:"coluna não faz parte do fluxo de revenda"}]}`); (b) senão, avaliar `revendaRequisitos(cfg, statusKey)` em vez de `kanbanRequisitos[statusKey]`. Não-revenda: intocado.
- [ ] **Step 3 — status Select no sheet.** `ModeloDetailPanel.podeEntrarStatus` (`:293-294`): mesmo branch por `isRevenda` (colunas permitidas + requisitos da revenda). `statusOptions` p/ revenda pode opcionalmente esconder/esmaecer as colunas não-permitidas (ou deixá-las bloqueadas ao tentar) — decisão: manter no dropdown mas bloqueadas (consistente com o board).
- [ ] **Step 4 — verificação.** `tsc`/build/anti-drift/`vitest`. QA :5173: card de revenda no board — só as colunas permitidas aceitam (drag/Select), as fora ficam esmaecidas; requisitos da revenda aplicados (não os do fluxo interno). Não-revenda: board idêntico. Screenshot.
- [ ] **Step 5: Commit** `feat(revenda): kanban respeita colunas permitidas e requisitos da revenda (board + status select)`

---

### Task 5: Fechamento
- [ ] **Step 1:** `tsc`=0; build; anti-drift; `npx vitest run --no-file-parallelism` (novo teste do helper verde + 4 pre-existentes). QA E2E: config em Config da Loja → abrir revenda → seções/campos escondidos + gate destravado + kanban respeitando colunas/requisitos; modelo INTERNO 100% idêntico ao de hoje (seções, campos, gate, board). Screenshots comparativos.
- [ ] **Step 2:** Review final (opus): 3 chaves em tenant_config (sem migração); fluxo interno byte-a-byte intocado (o branch `isRevenda?` preserva a regra atual em secOrdem/cadMissing/podeEntrar); helper puro compartilhado (sem drift entre os 4 pontos); UI gated por produto_acabado; RequisitosStatusDialog esmaece NA só quando revenda; defaults semeiam os 9 OFF; fallback config-vazia não trava. Atualizar CLAUDE.md (nota no invariante #13) + docs/mapeamento + memória.

## Self-Review
**Spec coverage:** helper+catálogo NA (T1); UI de config (T2); sheet seções/campos/gate (T3); kanban colunas/requisitos (T4); fechamento+review (T5). Cobre os 3 eixos + os 4 pontos de leitura da spec.
**Placeholder scan:** T1 tem as assinaturas dos helpers + as listas exatas (9 campos, 7 NA, 9 seções); T2/T3/T4 têm arquivo+âncora (linhas do secOrdem/cadMissing/podeEntrar/ModeloInfoSection/configuracoes). Rótulos key→label listados no T2 Step 5.
**Type consistency:** `RevendaConfig {colunas:string[], requisitos:Record<string,string[]>, campos:Record<string,boolean>}` idêntico em T1(helper)/T2(save)/T3-T4(leitura). `revendaCampoVisivel(cfg,key)`/`revendaColunaPermitida`/`revendaRequisitos` mesma assinatura em todos os consumidores.
**Riscos:** (a) byte-a-byte não-revenda — o branch `isRevenda?configRevenda:<hoje>` em secOrdem/cadMissing/podeEntrar; teste no fechamento compara não-revenda. (b) piloto2/3 já condicionais — combinar com `&&`, não sobrescrever. (c) `s5` gated por custos — revenda combina config `&&` custos. (d) dialog NA só p/ revenda — prop opt-in, normal intocado. (e) coluna label→key — gravar key, mostrar label.

> **CORREÇÃO (T2):** a premissa 'sem migração' estava ERRADA — tenant_config tem 1 coluna jsonb tipada por chave. A migração 20260826130000 adiciona as 3 colunas (aditiva/idempotente). As Tasks 3/4 leem dessas colunas.
