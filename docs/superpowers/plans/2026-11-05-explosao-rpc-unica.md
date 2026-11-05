# Explosão em RPC única atômica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar as 3 RPCs soltas do Salvar da Explosão (e as 4 do Enviar para PCP) por UMA RPC única atômica `salvar_explosao(..., _enviar)`, com um único `_rev_base` real conferido uma vez — eliminando a perda de dado silenciosa (R1) e o aviso falso ao próprio autor (R-02).

**Architecture:** Nova RPC DEFINER `salvar_explosao(_cad_id, _variantes, _aviamentos, _etiquetas, _rev_base, _enviar)` orquestra, numa transação só, a lógica das 3 saves atuais (extraída para 3 `_core` INVOKER internos, sem portão) + a trava de rev (uma vez, rev real) + os portões (uma vez) + a baixa do corte (`_baixar_estoque_tecido_corte_core`) quando `_enviar=true`. A tela chama 1 RPC por botão em vez de 3/4; `baseServidorRef` re-baseia no ENVIADO no `onSuccess` do Salvar (mata o eco/aviso falso). As 3 RPCs estreitas antigas FICAM (compat de abas velhas) — a nova não as usa.

**Tech Stack:** Postgres 17 (plpgsql, SECURITY DEFINER), Supabase; React + TanStack Query; Vitest (integração txn revertida + unit com fake).

**Spec:** desenho aprovado no painel (m363 + P-401 A "uma função com chave enviar"). Decisão do dono: 05/nov. Mapa factual do código: `scratchpad/explosao-mapa.md`. Base do desenho da Camada: `.superpowers/sdd/2026-10-05-camada/desenho.md` (N3, R-02, F6a, C9).

## Global Constraints

- **Padrão wrapper + `_core` (invariante #9):** a nova `salvar_explosao` é DEFINER e confere os portões; os `_core` por seção são INVOKER (ou DEFINER sem portão, rodando dentro da RPC) com `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`. Conferir com `has_function_privilege('anon'|'authenticated', '_fn(args)', 'EXECUTE') = false`.
- **Portões da Explosão, uma vez (ordem exata das 3 RPCs vivas):** login (`auth.uid()`) → `tenant_module_enabled('criacao')` (42501) → `_exige_modulos('entrada_saida')` → `_seg_exige_pagina('producao_explosao')` → tenant/CAD (`cad.tenant_id = get_user_tenant_id()` OU super) → `_explosao_check_rev(_cad_id, _rev_base)` → escritas.
- **`_rev_base` real e único:** a nova RPC recebe UM `_rev_base` (o `cad.rev` que a tela leu) e chama `_explosao_check_rev` UMA vez, no início, com esse valor. Nunca `null` nas seções. `_rev_base` null continua sendo bypass de manutenção/teste (o helper já trata).
- **RAISE 5xx só ASCII** (`reference_raise_5xx_ascii`): qualquer `RAISE ... USING ERRCODE` que o PostgREST devolva como 5xx (P0409/P0002) tem mensagem só-ASCII. O P0409 reusado (`_explosao_check_rev`) já é ASCII (`conflito_versao: ...`).
- **Déficit por metros** (invariante #7): a baixa roda por `cad_tecido_variantes.metragem_enviada`, NÃO por grade. A nova RPC NÃO toca nisso — só chama `_baixar_estoque_tecido_corte_core(_cad_id)` como está.
- **DATABASE_URL local SEMPRE nos testes** (`feedback_subagente_database_url_local`): fallback = PRODUÇÃO. Todo brief de executor/teste exporta a URL da cópia local (Docker PG17.6 porta 54422). NUNCA `\i` migration dentro de txn de teste; DDL só na cópia local.
- **Diff-validar função redefinida:** `pg_get_functiondef` antes/depois das 3 RPCs estreitas (devem ficar INTOCADAS) e das novas. Teste em txn revertida (`BEGIN; SET LOCAL ... ; ROLLBACK;`).
- **Build não roda tsc:** após mexer em imports/identificadores TS, `npx tsc --noEmit`. Suíte com `--no-file-parallelism`.
- **Banco ANTES do site** no deploy (a tela nova chama a RPC nova).

## Review Focus

- **Conflito real de 2 pessoas (P0409) numa seção que EU não toquei:** hoje a seção aviamento/etiqueta grava com `_rev_base: null` e sobrescreve calado. Com a RPC única, se o `cad.rev` mudou desde que eu abri, TODO o Salvar tem de dar P0409 e NÃO gravar nada — inclusive quando eu só mexi na metragem e a outra pessoa mexeu no aviamento. Teste em Task 2 (duas conexões).
- **Eco do próprio autor (R-02):** depois de MEU Salvar bem-sucedido, o refetch NÃO pode gerar "atualizada por outra pessoa". A `baseServidorRef` precisa re-basear no payload ENVIADO (como a receita do OC Tecido). Teste em Task 4 (atualiza `camada-c4-explosao-f6a`).
- **F6a — carga parcial/falha:** Salvar e Enviar continuam recusando antes de qualquer escrita quando `!podeGravar` (carga incompleta). A RPC única não enfraquece isso (o guard síncrono fica no `mutationFn`). Teste em Task 4.
- **Enviar com déficit:** `_enviar=true` roda a baixa na MESMA transação e retorna `{cad_id, rev, deficit[]}`; a tela mostra o toast "faltou estoque" igual a hoje. Se a baixa falhar (ex.: lock), a transação inteira volta — nada de metragem gravada sem a baixa. Teste em Task 2.
- **Idempotência das seções vazias:** `_enviar=false` com uma seção `[]`/ausente não apaga a outra (cada seção é um UPDATE seletivo por id, não delete-and-reinsert). Mantém o comportamento no-op de hoje. Teste em Task 2.

---

## File Structure

- **`supabase/migrations/20261110100000_explosao_rpc_unica.sql`** (criar) — 3 `_core` por seção (extraídos do corpo das 3 RPCs vivas, byte-a-byte) + a RPC única `salvar_explosao`. Nada de DROP das 3 estreitas. REVOKE dos `_core`.
- **`supabase/rollback/20261110100000_explosao_rpc_unica_down.sql`** (criar) — DROP da `salvar_explosao` e dos 3 `_core` (NEUTRO; as 3 estreitas nunca foram tocadas, então a tela velha volta a funcionar sozinha).
- **`src/components/producao/explosao/ExplosaoDetail.tsx`** (modificar) — `salvarMut` e `enviarCorte` passam a chamar 1 RPC (`salvar_explosao`); `onSuccess` do Salvar re-baseia `baseServidorRef`/`cadRevRef` no ENVIADO. Builders e guards (F6a, conflito) ficam.
- **`tests/integration/explosao-rpc-unica.test.ts`** (criar) — atomicidade, P0409 único, seções vazias, enviar+déficit, portões, ACL.
- **`tests/unit/_fix_hidratacao/camada-c4-explosao-f6a.test.ts`** (modificar) — atualizar para a RPC única: aviso falso some; F6a e P0409 seguem; agora 1 RPC por botão.
- **`tests/unit/_fix_hidratacao/explosao-fake.ts`** (modificar) — `rpcExplosao` ganha `salvar_explosao` (fake).

---

## Task 1: RPC única no banco (`salvar_explosao`)

**Files:**
- Create: `supabase/migrations/20261110100000_explosao_rpc_unica.sql`
- Create: `supabase/rollback/20261110100000_explosao_rpc_unica_down.sql`

**Interfaces:**
- Consumes: `_explosao_check_rev(uuid, integer)` (20260916260000), `_baixar_estoque_tecido_corte_core(uuid)` (20260619420000, retorna `jsonb {linhas, quantidade, deficit_total, deficit[]}`), `_exige_modulos`, `_seg_exige_pagina`, `tenant_module_enabled`.
- Produces (Task 3 consome): `salvar_explosao(_cad_id uuid, _variantes jsonb, _aviamentos jsonb, _etiquetas jsonb, _rev_base integer DEFAULT NULL, _enviar boolean DEFAULT false) RETURNS jsonb` → `{ cad_id, rev, deficit }` (`deficit` = `[]` quando `_enviar=false`).

- [ ] **Step 1: Escrever a migration.** Dentro de `BEGIN; ... COMMIT;`. Conteúdo:
  1. 3 helpers `_core` INVOKER (corpo copiado do loop de cada RPC viva, SEM os portões nem o `_explosao_check_rev` — esses ficam na RPC única):
     - `_salvar_explosao_metragem_core(_cad_id uuid, _variantes jsonb)` — o `FOR it IN jsonb_array_elements(_variantes)` que atualiza `cad_tecido_variantes.metragem_enviada/quantidade_folhas` (de `20261103100000:449-457`).
     - `_salvar_explosao_aviamento_separar_core(_cad_id uuid, _linhas jsonb)` — o loop `cad_aviamentos.quantidade_separar` (cheio na menor `numero`, resto zera) de `20261103100000:482-496`.
     - `_salvar_explosao_etiqueta_enviar_core(_cad_id uuid, _linhas jsonb)` — o loop `cad_etiquetas.quantidade_enviar` de `20261103100000:521-528`.
  2. `REVOKE EXECUTE ON FUNCTION public._salvar_explosao_metragem_core(uuid,jsonb), public._salvar_explosao_aviamento_separar_core(uuid,jsonb), public._salvar_explosao_etiqueta_enviar_core(uuid,jsonb) FROM PUBLIC, anon, authenticated;`
  3. A RPC única (DEFINER), com os portões UMA vez, na ordem canônica, depois `_explosao_check_rev(_cad_id, _rev_base)` UMA vez, depois as 3 `_core` (sempre as 3; `_variantes/_aviamentos/_etiquetas` podem ser `[]`/null — cada `_core` já trata `jsonb_typeof(...) <> 'array'` como no-op), depois, se `_enviar`, chama o core da baixa e devolve o deficit:

```sql
CREATE OR REPLACE FUNCTION public.salvar_explosao(
  _cad_id uuid,
  _variantes jsonb DEFAULT '[]'::jsonb,
  _aviamentos jsonb DEFAULT '[]'::jsonb,
  _etiquetas jsonb DEFAULT '[]'::jsonb,
  _rev_base integer DEFAULT NULL::integer,
  _enviar boolean DEFAULT false
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_rev integer; v_baixa jsonb := jsonb_build_object('deficit', '[]'::jsonb);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado' USING ERRCODE='42501'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Modulo criacao nao habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._exige_modulos('entrada_saida');
  PERFORM public._seg_exige_pagina('producao_explosao');
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'nao_encontrado: cad' USING ERRCODE='P0002'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissao para este CAD' USING ERRCODE='42501';
  END IF;
  PERFORM public._explosao_check_rev(_cad_id, _rev_base);  -- UMA vez, rev real
  PERFORM public._salvar_explosao_metragem_core(_cad_id, _variantes);
  PERFORM public._salvar_explosao_aviamento_separar_core(_cad_id, _aviamentos);
  PERFORM public._salvar_explosao_etiqueta_enviar_core(_cad_id, _etiquetas);
  IF _enviar THEN
    v_baixa := public._baixar_estoque_tecido_corte_core(_cad_id);  -- mesma txn
  END IF;
  SELECT rev INTO v_rev FROM public.cad WHERE id = _cad_id;  -- rev final pos-bump
  RETURN jsonb_build_object('cad_id', _cad_id, 'rev', v_rev, 'deficit', COALESCE(v_baixa->'deficit', '[]'::jsonb));
END; $function$;
REVOKE EXECUTE ON FUNCTION public.salvar_explosao(uuid,jsonb,jsonb,jsonb,integer,boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_explosao(uuid,jsonb,jsonb,jsonb,integer,boolean) TO authenticated, service_role;
```
  (⚠️ CONFERIR ao implementar: copiar os 3 corpos `_core` EXATAMENTE dos loops vigentes em `20261103100000` — a mensagem "CAD nao encontrado" das estreitas é texto livre; aqui uso `nao_encontrado: cad` P0002 por já ser o padrão B3 ASCII, mas confirmar que o `mensagemBackend` traduz `nao_encontrado: cad`. Se não traduzir, manter o texto das estreitas.)

- [ ] **Step 2: Escrever o rollback** (`..._down.sql`): `DROP FUNCTION IF EXISTS public.salvar_explosao(uuid,jsonb,jsonb,jsonb,integer,boolean);` + DROP dos 3 `_core`. Comentar que as 3 RPCs estreitas nunca foram tocadas, então a tela velha volta a funcionar.

- [ ] **Step 3: Aplicar na CÓPIA LOCAL e diff-validar.** `export DATABASE_URL=<cópia local 54422>` (NUNCA produção). `psql "$DATABASE_URL" -f supabase/migrations/20261110100000_explosao_rpc_unica.sql`. Depois:
  - `pg_get_functiondef` das 3 RPCs estreitas ANTES e DEPOIS → devem ser IDÊNTICAS (a migration não as toca).
  - `has_function_privilege('anon','salvar_explosao(uuid,jsonb,jsonb,jsonb,integer,boolean)','EXECUTE')` = false; `authenticated` = true.
  - `has_function_privilege('anon'|'authenticated', '_salvar_explosao_metragem_core(uuid,jsonb)', 'EXECUTE')` = false (os 3 core).

- [ ] **Step 4: Commit** (`git commit --only supabase/migrations/20261110100000_explosao_rpc_unica.sql supabase/rollback/20261110100000_explosao_rpc_unica_down.sql`).

## Task 2: Teste de integração da RPC (txn revertida)

**Files:**
- Create: `tests/integration/explosao-rpc-unica.test.ts`

**Interfaces:**
- Consumes: `salvar_explosao(...)` da Task 1; infra de teste `tests/integration/db.ts` (withTx, set_config de claims).

- [ ] **Step 1: Escrever os casos** (cada um em `BEGIN; ... ROLLBACK;` com claims de usuário da loja; semear um `cad` com `cad_tecidos/cad_tecido_variantes`, `cad_aviamentos`, `cad_etiquetas`):
  1. **Atomicidade do Salvar (`_enviar=false`):** uma chamada grava metragem + aviamento + etiqueta; conferir os 3 UPDATEs numa só transação; `rev` subiu 1× (B2 — rev 1×/txn; medir com a receita `salvaTopo`/SAVEPOINT da T5, não dentro de SAVEPOINT).
  2. **P0409 único:** com `_rev_base` = rev velho (simular outra txn que bumpou o `cad.rev` — ex.: um UPDATE numa filha antes), a chamada dá `P0409 conflito_versao` e NADA grava (metragem/aviamento/etiqueta inalterados). Incluir o caso "eu só mandei metragem, mas o rev mudou por aviamento alheio" → ainda P0409.
  3. **Seção vazia é no-op:** `_aviamentos: []` não zera o que já existe em `cad_aviamentos`; idem `_etiquetas: []`, `_variantes: []`.
  4. **Enviar (`_enviar=true`):** grava as 3 seções + baixa estoque na MESMA txn; retorno tem `deficit` (array); semear metragem > estoque → `deficit` não vazio; `estoque_tecido_baixas` ganhou linha(s) `origem='fifo'`. Reverter tudo (ROLLBACK) confirma txn única.
  5. **Portões:** sem a página `producao_explosao` → 42501 `sem_permissao_pagina`; módulo `entrada_saida` desligado (sem claims de super) → 42501 `modulo_desligado`; `cad` de outra loja → sem permissão.
  6. **ACL:** `has_function_privilege` dos `_core` = false para anon/authenticated.
  7. **(2 conexões / deadlock)** opcional porém recomendado: duas conexões salvando o MESMO cad; a 2ª deve pegar P0409 (a 1ª bumpou o rev), não lost-update.
- [ ] **Step 2: Rodar** `DATABASE_URL=<local> npx vitest run --no-file-parallelism tests/integration/explosao-rpc-unica.test.ts` → verde.
- [ ] **Step 3: Commit.**

## Task 3: Tela — `salvarMut` e `enviarCorte` chamam a RPC única

**Files:**
- Modify: `src/components/producao/explosao/ExplosaoDetail.tsx`

**Interfaces:**
- Consumes: `salvar_explosao(...)` (Task 1); builders existentes `buildVariantesPayload`/`buildAviamentoSepararPayload`/`buildEtiquetaEnviarPayload`; refs `cadRevRef`, `baseServidorRef`, `tecidosLiveRef`/`aviSepararLiveRef`/`etiEnviarLiveRef`, `podeGravarRef`, `conflitosRef`.

- [ ] **Step 1: `salvarMut.mutationFn`** (`:870-901`) — trocar as 3 chamadas por UMA. Guards (conflito :875, F6a :877) FICAM. Capturar o payload ANTES (para re-basear no `onSuccess`):

```ts
const vars = buildVariantesPayload();
const avis = buildAviamentoSepararPayload();
const etis = buildEtiquetaEnviarPayload();
const { data, error } = await supabase.rpc("salvar_explosao" as any, {
  _cad_id: cadRow.id,
  _variantes: vars,
  _aviamentos: avis,
  _etiquetas: etis,
  _rev_base: cadRevRef.current,  // rev REAL, único
  _enviar: false,
});
if (error) throw error;
return data as any;  // { cad_id, rev, deficit }
```

- [ ] **Step 2: `salvarMut.onSuccess`** — re-basear o 3-vias no ENVIADO (mata R-02, o aviso falso). Usar o `rev` devolvido e os payloads capturados:

```ts
onSuccess: (data: any) => {
  toast.success("Salvo");
  markClean(); setEditing(false);
  tocouMetragemRef.current = false; tocouAviRef.current = false; tocouEtiRef.current = false;
  // [R-02] re-basa o 3-vias no ENVIADO (como a receita do OC Tecido) → eco do refetch vira no-op
  if (typeof data?.rev === "number") cadRevRef.current = data.rev;
  baseServidorRef.current = {
    metragemBlob: metragemBlobDeTecidos(tecidosLiveRef.current),
    aviBlob: { ...aviSepararLiveRef.current },
    etiBlob: { ...etiEnviarLiveRef.current },
  };
  qc.invalidateQueries(...);  // mesmas invalidações de hoje
},
```
  (⚠️ CONFERIR os nomes exatos de `metragemBlobDeTecidos`/`aviSepararLiveRef`/`etiEnviarLiveRef` no arquivo — o seed em `:386-392` já monta `baseServidorRef` assim. Reusar a MESMA construção.)

- [ ] **Step 3: `enviarCorte.mutationFn`** (`:925-966`) — trocar as 4 chamadas por UMA com `_enviar: true`; o retorno já traz `deficit`:

```ts
const { data, error } = await supabase.rpc("salvar_explosao" as any, {
  _cad_id: cadRow.id,
  _variantes: buildVariantesPayload(),
  _aviamentos: buildAviamentoSepararPayload(),
  _etiquetas: buildEtiquetaEnviarPayload(),
  _rev_base: cadRevRef.current,
  _enviar: true,
});
if (error) throw error;
return data as any;  // { cad_id, rev, deficit }
```
  `onSuccess` (:970) continua lendo `res.deficit` — sem mudança (o `onEnviado()` fecha o Sheet, não precisa re-basear).

- [ ] **Step 4: tsc + build.** `npx tsc --noEmit` (0 erros nos arquivos tocados) e `npm run build`.
- [ ] **Step 5: Commit.**

## Task 4: Atualizar os testes de front (F6a + fake)

**Files:**
- Modify: `tests/unit/_fix_hidratacao/camada-c4-explosao-f6a.test.ts`
- Modify: `tests/unit/_fix_hidratacao/explosao-fake.ts`

**Interfaces:**
- Consumes: o `rpcExplosao` fake; o componente `ExplosaoDetail` (ou o molde que o teste usa).

- [ ] **Step 1: `explosao-fake.ts`** — `rpcExplosao` ganha `salvar_explosao` (devolve `{ cad_id, rev: <rev+1>, deficit: [] }` por padrão; com `_enviar` simula `deficit`). Manter as 3 estreitas no fake (compat; não são mais chamadas pela tela, mas outros testes podem usar).
- [ ] **Step 2: `camada-c4-explosao-f6a.test.ts`** — reescrever as asserções de contagem de RPC: Salvar = 1 chamada `salvar_explosao` (`_enviar:false`), Enviar = 1 chamada (`_enviar:true`). **Remover o `[RULING R1]` que fixava o aviso falso** e trocar por: após MEU Salvar bem-sucedido, NENHUM toast "atualizada por outra pessoa" (o eco do refetch é no-op porque `baseServidorRef` foi re-baseado). Manter: F6a (carga parcial → nada grava, botões disabled, "Tentar de novo"), conflito pendente trava o Salvar, P0409 → toast de conflito e nada "Salvo".
- [ ] **Step 3: Rodar** `npx vitest run --no-file-parallelism tests/unit/_fix_hidratacao/camada-c4-explosao-f6a.test.ts tests/unit/_fix_hidratacao/camada-c4-explosao-tamanho-vinculado.test.ts` → verde.
- [ ] **Step 4: Commit.**

## Task 5: Prova na cópia + suíte relevante

- [ ] **Step 1:** Rodar a suíte de integração/unit relevante na cópia local (`DATABASE_URL=<local>`, `--no-file-parallelism`): `explosao-rpc-unica`, `explosao-envio`, `explosao-aviamento-separar`, `explosao-aviamentos`, `explosao-insumo-tamanho`, `camada-c4-explosao-*`.
- [ ] **Step 2:** `npx tsc --noEmit` + `npm run build` limpos.
- [ ] **Step 3:** (prévia manual do dono depois) — subir a cópia local e conferir Salvar + Enviar nos dois caminhos (com e sem déficit; 2 abas para conflito). Documentar no relatório.

## Self-Review

- **Cobertura:** Task 1 cria a RPC única (núcleo); Task 2 prova atomicidade/P0409/portões/ACL no banco; Task 3 liga a tela; Task 4 atualiza os testes de front (mata o aviso falso fixado de propósito); Task 5 prova. Review Focus: conflito cross-seção (T2 caso 2), eco do autor (T4), F6a (T4), enviar+déficit (T2 caso 4), seção vazia no-op (T2 caso 3) — todos com teste.
- **Tipos:** retorno `{cad_id, rev, deficit}` consistente entre Task 1 (SQL) e Task 3 (TS lê `data.rev`/`res.deficit`).
- **Sem placeholder:** os 3 `_core` são cópia literal dos loops vigentes (caminhos/linhas citados); a RPC única tem o SQL completo; a tela tem o TS completo.
- **Risco:** as 3 RPCs estreitas FICAM intocadas (diff-validado em T1 Step 3), então aba velha e os testes `explosao-aviamento-separar` (que chamam a estreita com 2 args) seguem passando. A nova RPC é aditiva.
