# Simulador — Cores reais (variantes por subcoleção) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** No Simulador de Uso de OC, tornar as "cores" **variantes reais** da OC escolhidas na **subcoleção**: identificadas (`artigo·cor·apelido`), multi-seleção livre, resultado **sobra/estoura por cor**, mini cards por modelo; write-back grava `cores` uniforme.

**Architecture:** Nova migration `20260723100000_otb_simulador_cores.sql` (ALTER unidade + nova tabela `otb_simulacao_variantes` + `create or replace` de `salvar_simulacao`/`aplicar_simulacao`). Rework do `src/components/otb/SimulacaoSheet.tsx` (picker de OC → multi-select de variantes na unidade; `cores` derivado; resultado por cor; mini cards). Evolui a feature v1 já no ar.

**Tech Stack:** Vite+React+TS+TanStack Query+Supabase (Postgres/RLS). Testes: Vitest integração transacional (`withTx`/`comoUsuario`).

**Spec:** `docs/superpowers/specs/2026-07-17-otb-simulador-cores-variantes-design.md`.

## Global Constraints

- Migration **destrutiva** (`DROP COLUMN oc_tecido_item_id`) → envolver em `BEGIN; … COMMIT;`, idempotente (`IF EXISTS`/`IF NOT EXISTS`, `create or replace`). Aplicar por `psql "$(cat /tmp/dburl.txt)" -f`.
- Tabela nova `otb_simulacao_variantes`: multi-tenant, RLS = mesmas policies de `colecao_pv_itens` (`tenant_*` por `get_user_tenant_id()`, insert aceita `tenant_id IS NULL`), trigger `set_tenant_id`.
- RPCs **INVOKER** (não DEFINER; sem `_core`), com `revoke execute … from public, anon` + `grant execute … to authenticated` (como o v1). PT-BR, module gate `errcode='42501'`.
- Write-back grava **só o alvo do plano** (`colecao_pv_itens`), nunca `modelos`. `cores` = `count(otb_simulacao_variantes)` da unidade (autoritativo no servidor).
- **Metragem** = espelho de `consumo_por_oc` (`unidade_medida='kg' ? qtd × artigo.rendimento : qtd`).
- **Rótulo de variante** SEMPRE via `src/lib/variante.ts` (`labelVarianteRow`).
- Front acessa símbolos novos com `as any` (types.ts não regenerado — precisa `supabase login`).
- Antes de commitar: `npm run build` + `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339|TS2322|TS2503" || echo OK`.
- Testes de integração transacionais; rodar `npx vitest run tests/integration/otb-simulador.test.ts` (ignorar falhas pré-existentes do sibling `otb.test.ts`). Módulo-off: remover super_admin do **USER_TESTE** (determinístico).

## File Structure

- **Create:** `supabase/migrations/20260723100000_otb_simulador_cores.sql` — ALTER + tabela + RPCs.
- **Modify:** `tests/integration/otb-simulador.test.ts` — atualizar árvore p/ `oc_tecido_id`+`variantes`; asserts de variantes + cores=count.
- **Modify:** `src/components/otb/SimulacaoSheet.tsx` — picker OC→variantes na unidade, `cores` derivado, resultado por cor, mini cards.
- **Modify (Task final):** `CLAUDE.md` (bloco otb) + memória.

---

### Task 1: Migration — schema + `salvar_simulacao` (variantes)

**Files:**
- Create: `supabase/migrations/20260723100000_otb_simulador_cores.sql`
- Test: `tests/integration/otb-simulador.test.ts`

**Interfaces:**
- Produces: `otb_simulacao_unidades.oc_tecido_id` (nova), `otb_simulacao_variantes` (nova tabela); `salvar_simulacao` aceita `_arvore[].oc_tecido_id` + `_arvore[].variantes: [oc_tecido_item_id,…]`.

- [ ] **Step 1: DDL — ALTER + nova tabela + RLS** (início do arquivo)

```sql
-- 20260723100000_otb_simulador_cores.sql — cores reais (variantes por subcoleção).
begin;

alter table public.otb_simulacao_unidades
  add column if not exists oc_tecido_id uuid references public.ocs_tecido(id) on delete set null;
alter table public.otb_simulacao_unidades
  drop column if exists oc_tecido_item_id;

create table if not exists public.otb_simulacao_variantes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid,
  unidade_id        uuid not null references public.otb_simulacao_unidades(id) on delete cascade,
  oc_tecido_item_id uuid references public.ocs_tecido_itens(id) on delete set null,
  ordem             integer not null default 0
);
create index if not exists idx_otb_sim_var_un on public.otb_simulacao_variantes(unidade_id);

alter table public.otb_simulacao_variantes enable row level security;
drop policy if exists tenant_select on public.otb_simulacao_variantes;
drop policy if exists tenant_insert on public.otb_simulacao_variantes;
drop policy if exists tenant_update on public.otb_simulacao_variantes;
drop policy if exists tenant_delete on public.otb_simulacao_variantes;
create policy tenant_select on public.otb_simulacao_variantes for select to authenticated using (tenant_id = get_user_tenant_id());
create policy tenant_insert on public.otb_simulacao_variantes for insert to authenticated with check (tenant_id = get_user_tenant_id() or tenant_id is null);
create policy tenant_update on public.otb_simulacao_variantes for update to authenticated using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id());
create policy tenant_delete on public.otb_simulacao_variantes for delete to authenticated using (tenant_id = get_user_tenant_id());
create or replace trigger set_tenant_id_trg before insert on public.otb_simulacao_variantes for each row execute function set_tenant_id();
```

- [ ] **Step 2: `create or replace salvar_simulacao`** (mesmo arquivo, antes do `commit;`) — grava `oc_tecido_id` na unidade + loop de `variantes`:

```sql
create or replace function public.salvar_simulacao(_id uuid, _header jsonb, _arvore jsonb)
returns uuid language plpgsql set search_path to 'public' as $function$
declare
  v_id uuid := _id; v_colecao uuid; v_un jsonb; v_ln jsonb; v_md jsonb; v_var jsonb;
  v_un_id uuid; v_ln_id uuid; v_li int; v_mi int; v_vi int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  v_colecao := nullif(_header->>'colecao_id','')::uuid;
  if v_colecao is null then raise exception 'Informe a coleção.'; end if;
  if coalesce(btrim(_header->>'nome'),'') = '' then raise exception 'Informe o nome do cenário.'; end if;
  if not exists (select 1 from public.colecoes where id = v_colecao and tenant_id = public.get_user_tenant_id()) then
    raise exception 'Coleção não encontrada.';
  end if;

  if v_id is null then
    insert into public.otb_simulacoes (colecao_id, nome) values (v_colecao, btrim(_header->>'nome')) returning id into v_id;
  else
    update public.otb_simulacoes set nome = btrim(_header->>'nome')
      where id = v_id and colecao_id = v_colecao and tenant_id = public.get_user_tenant_id();
    if not found then raise exception 'Cenário não encontrado.'; end if;
    delete from public.otb_simulacao_unidades where simulacao_id = v_id; -- cascata: variantes/linhas/modelos
  end if;

  for v_un in select value from jsonb_array_elements(coalesce(_arvore,'[]'::jsonb)) loop
    insert into public.otb_simulacao_unidades (simulacao_id, subcolecao_id, oc_tecido_id)
    values (v_id, nullif(v_un->>'subcolecao_id','')::uuid, nullif(v_un->>'oc_tecido_id','')::uuid)
    returning id into v_un_id;

    v_vi := 0;
    for v_var in select value from jsonb_array_elements(coalesce(v_un->'variantes','[]'::jsonb)) loop
      insert into public.otb_simulacao_variantes (unidade_id, oc_tecido_item_id, ordem)
      values (v_un_id, nullif(v_var->>'oc_tecido_item_id','')::uuid, v_vi);
      v_vi := v_vi + 1;
    end loop;

    v_li := 0;
    for v_ln in select value from jsonb_array_elements(coalesce(v_un->'linhas','[]'::jsonb)) loop
      insert into public.otb_simulacao_linhas (unidade_id, linha_id, prof_cor, cores, num_modelos, ordem)
      values (v_un_id, nullif(v_ln->>'linha_id','')::uuid,
              greatest(0, coalesce((v_ln->>'prof_cor')::int, 0)),
              greatest(0, coalesce((v_ln->>'cores')::int, 0)),
              greatest(0, coalesce((v_ln->>'num_modelos')::int, 0)), v_li)
      returning id into v_ln_id;
      v_li := v_li + 1;
      v_mi := 0;
      for v_md in select value from jsonb_array_elements(coalesce(v_ln->'modelos','[]'::jsonb)) loop
        insert into public.otb_simulacao_modelos (linha_ref_id, modelo_id, slot_index, consumo)
        values (v_ln_id, nullif(v_md->>'modelo_id','')::uuid,
                coalesce((v_md->>'slot_index')::int, v_mi),
                greatest(0, coalesce((v_md->>'consumo')::numeric, 0)));
        v_mi := v_mi + 1;
      end loop;
    end loop;
  end loop;
  return v_id;
end $function$;
```

(Nota: `cores` na linha vira derivado no front = nº de variantes; `greatest(0,…)` p/ Orçamento cores=0/1. O `aplicar` — Task 2 — é quem grava cores=count no plano.)

- [ ] **Step 3: REVOKE/GRANT + commit** (antes de fechar; a Task 2 acrescenta o `aplicar` no mesmo arquivo, então mova o `commit;` p/ depois dele — ou repita o REVOKE do `aplicar` na Task 2):

```sql
revoke execute on function public.salvar_simulacao(uuid, jsonb, jsonb) from public, anon;
grant  execute on function public.salvar_simulacao(uuid, jsonb, jsonb) to authenticated;

commit;
```

- [ ] **Step 4: Aplicar a migration** — `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260723100000_otb_simulador_cores.sql` → sem erro.
- [ ] **Step 5: Verificar** — `psql "$(cat /tmp/dburl.txt)" -c '\d public.otb_simulacao_unidades'` (tem `oc_tecido_id`, NÃO tem `oc_tecido_item_id`) + `'\d public.otb_simulacao_variantes'` (policies + trigger).

- [ ] **Step 6: Atualizar/rodar o teste de `salvar_simulacao`** — no `otb-simulador.test.ts`, no bloco "salvar_simulacao", trocar a árvore p/ o shape novo e assert das variantes. Substituir o 1º `it(...)` por:

```ts
  it("cria a árvore com variantes e re-salva substituindo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-SIM2','rascunho') returning id`, []);
      // OC com 2 itens (variantes)
      const oc = await um<{ id: string }>(c, `insert into ocs_tecido (numero_pedido, status) values ('OC-SIM','rascunho') returning id`, []);
      const art = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida, rendimento) values ('Art','metro',1) returning id`, []);
      const i1 = await um<{ id: string }>(c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1,$2,500) returning id`, [oc.id, art.id]);
      const i2 = await um<{ id: string }>(c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1,$2,300) returning id`, [oc.id, art.id]);
      const arvore = [{ subcolecao_id: null, oc_tecido_id: oc.id, variantes: [{ oc_tecido_item_id: i1.id }, { oc_tecido_item_id: i2.id }],
        linhas: [{ linha_id: null, prof_cor: 8, cores: 2, num_modelos: 2, modelos: [{ slot_index: 0, consumo: 1.2 }, { slot_index: 1, consumo: 1.5 }] }] }];
      const id = (await um<{ id: string }>(c, `select public.salvar_simulacao(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cenário A" }), JSON.stringify(arvore)])).id;
      const chk = await um<{ un: string; va: string; oc: string; md: string }>(c,
        `select (select count(*) from otb_simulacao_unidades u where u.simulacao_id=$1)::text un,
                (select count(*) from otb_simulacao_variantes v join otb_simulacao_unidades u on u.id=v.unidade_id where u.simulacao_id=$1)::text va,
                (select oc_tecido_id::text from otb_simulacao_unidades where simulacao_id=$1) oc,
                (select count(*) from otb_simulacao_modelos m join otb_simulacao_linhas l on l.id=m.linha_ref_id join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text md`, [id]);
      expect(chk.un).toBe("1"); expect(chk.va).toBe("2"); expect(chk.oc).toBe(oc.id); expect(chk.md).toBe("2");
      // re-salva com 1 variante → substitui (cascade limpa variantes antigas)
      const arvore2 = [{ subcolecao_id: null, oc_tecido_id: oc.id, variantes: [{ oc_tecido_item_id: i1.id }],
        linhas: [{ linha_id: null, prof_cor: 8, cores: 1, num_modelos: 1, modelos: [{ slot_index: 0, consumo: 2 }] }] }];
      await c.query(`select public.salvar_simulacao($1, $2::jsonb, $3::jsonb)`, [id, JSON.stringify({ colecao_id: col.id, nome: "A2" }), JSON.stringify(arvore2)]);
      const chk2 = await um<{ va: string; md: string }>(c,
        `select (select count(*) from otb_simulacao_variantes v join otb_simulacao_unidades u on u.id=v.unidade_id where u.simulacao_id=$1)::text va,
                (select count(*) from otb_simulacao_modelos m join otb_simulacao_linhas l on l.id=m.linha_ref_id join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text md`, [id]);
      expect(chk2.va).toBe("1"); expect(chk2.md).toBe("1");
    });
  });
```

Também atualizar a árvore do bloco "excluir_simulacao" e "aplicar_simulacao (PV)"/"(Orçamento)" trocando `oc_tecido_item_id: null` por `oc_tecido_id: null, variantes: []` (ou com itens onde fizer sentido) — o RPC ignora chaves ausentes, mas manter o shape correto evita confusão.

- [ ] **Step 7: Rodar** — `npx vitest run tests/integration/otb-simulador.test.ts` → todos passam.
- [ ] **Step 8: Commit** — `git add supabase/migrations/20260723100000_otb_simulador_cores.sql tests/integration/otb-simulador.test.ts && git commit -m "feat(otb): variantes por subcoleção no simulador (schema + salvar_simulacao)"`.

---

### Task 2: `aplicar_simulacao` — `cores` = nº de variantes

**Files:**
- Modify: `supabase/migrations/20260723100000_otb_simulador_cores.sql` (adicionar `create or replace aplicar_simulacao` antes do `commit;`)
- Test: `tests/integration/otb-simulador.test.ts`

**Interfaces:**
- Consumes: `otb_simulacao_variantes` (Task 1). Produces: `aplicar_simulacao` grava `colecao_pv_itens.cores = count(variantes da unidade)` em todas as linhas.

- [ ] **Step 1: Escrever o teste** (novo `it` no bloco "aplicar_simulacao (PV)")

```ts
  it("grava cores = nº de variantes da unidade em todas as linhas", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarOtb(c);
      const linha = await um<{ id: string }>(c, `insert into linhas (nome) values ('L-VAR') returning id`, []);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, tipo, status) values ('C-PV-VAR','poder_venda','rascunho') returning id`, []);
      const sub = await um<{ id: string }>(c, `insert into colecao_subcolecoes (colecao_id, nome, semanas) values ($1,'S','{1,2,3,4,5}') returning id`, [col.id]);
      await c.query(`insert into colecao_pv_itens (colecao_id, subcolecao_id, linha_id, prof_cor, cores, qtd_semanas) values ($1,$2,$3, 4, 9, '{}'::jsonb)`, [col.id, sub.id, linha.id]);
      const oc = await um<{ id: string }>(c, `insert into ocs_tecido (numero_pedido, status) values ('OC-VAR','rascunho') returning id`, []);
      const art = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida, rendimento) values ('A','metro',1) returning id`, []);
      const i1 = await um<{ id: string }>(c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1,$2,100) returning id`, [oc.id, art.id]);
      const i2 = await um<{ id: string }>(c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1,$2,100) returning id`, [oc.id, art.id]);
      const i3 = await um<{ id: string }>(c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1,$2,100) returning id`, [oc.id, art.id]);
      const arvore = [{ subcolecao_id: sub.id, oc_tecido_id: oc.id,
        variantes: [{ oc_tecido_item_id: i1.id }, { oc_tecido_item_id: i2.id }, { oc_tecido_item_id: i3.id }],
        linhas: [{ linha_id: linha.id, prof_cor: 8, cores: 3, num_modelos: 5, modelos: [] }] }];
      const simId = (await um<{ id: string }>(c, `select public.salvar_simulacao(null,$1::jsonb,$2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cen" }), JSON.stringify(arvore)])).id;
      const unId = (await um<{ id: string }>(c, `select id from otb_simulacao_unidades where simulacao_id=$1`, [simId])).id;
      await c.query(`select public.aplicar_simulacao($1,$2)`, [simId, unId]);
      const it = await um<{ prof: number; cores: number }>(c,
        `select prof_cor prof, cores from colecao_pv_itens where colecao_id=$1 and subcolecao_id=$2 and linha_id=$3`, [col.id, sub.id, linha.id]);
      expect(it.prof).toBe(8); expect(it.cores).toBe(3); // = nº de variantes, não o cores do payload
    });
  });
```

- [ ] **Step 2: Rodar** → o teste novo FALHA (a versão atual grava `cores` do payload, não a contagem). Se a versão v1 ainda gravar `v_ln.cores`, o teste do payload (cores=3) coincide — então force o cenário a divergir: no teste, o payload manda `cores: 3` e há 3 variantes → coincide. **Para o teste ser real, torne o payload divergente**: no `linhas[0]` use `cores: 99` (payload errado) e mantenha 3 variantes; o assert `cores).toBe(3)` só passa se o servidor usar a contagem. Ajuste o teste assim antes de rodar o RED.

- [ ] **Step 3: `create or replace aplicar_simulacao`** — reproduzir o corpo ATUAL da função (de `20260722100000_otb_simulador.sql`) e mudar **só** o ramo PV: calcular `v_ncores` e gravar `cores = v_ncores`. Método confiável: no shell, `psql "$(cat /tmp/dburl.txt)" -tA -c "select pg_get_functiondef('public.aplicar_simulacao(uuid,uuid)'::regprocedure)"` p/ pegar o corpo exato, colar no migration e aplicar as 2 mudanças:
  1. No `declare`, somar: `v_ncores int;`.
  2. No início do ramo `if v_tipo = 'poder_venda' then`, antes do loop de linhas: `select count(*) into v_ncores from public.otb_simulacao_variantes where unidade_id = _unidade_id;`
  3. No `update colecao_pv_itens … set cores = greatest(0, v_ln.cores)` → `set cores = v_ncores` (as demais colunas iguais).
  O ramo Orçamento e a guarda de categorias ficam **idênticos**.

- [ ] **Step 4: REVOKE/GRANT do `aplicar`** (garantir no arquivo, antes do `commit;`):
```sql
revoke execute on function public.aplicar_simulacao(uuid, uuid) from public, anon;
grant  execute on function public.aplicar_simulacao(uuid, uuid) to authenticated;
```

- [ ] **Step 5: Reaplicar** a migration → sem erro.
- [ ] **Step 6: Rodar** `npx vitest run tests/integration/otb-simulador.test.ts` → todos passam (o novo prova cores=3 mesmo com payload 99).
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(otb): aplicar_simulacao grava cores = nº de variantes da subcoleção"`.

---

### Task 3: Frontend — variantes por unidade, resultado por cor, mini cards

**Files:**
- Modify: `src/components/otb/SimulacaoSheet.tsx`

**Interfaces:**
- Consome as RPCs/tabelas das Tasks 1–2 (via `as any`).

Reescreve o modelo local + a árvore. Tipos:
```ts
type VarianteSim = { ocItemId: string };                    // uma cor
type ModeloSim  = { id: string; modeloId: string | null; consumo: number; ref?: string | null; nome?: string | null; foto?: string | null };
type LinhaSim   = { id: string; linhaId: string | null; profCor: number; modelos: ModeloSim[] };  // SEM cores (derivado)
type UnidadeSim = { id: string; dbId?: string; subcolecaoId: string | null; nomeUnidade: string; ocId: string | null; variantes: VarianteSim[]; linhas: LinhaSim[] };
```

- [ ] **Step 1: Query da OC com variante embutida** — trocar o `select` de `["otb-sim-ocs"]` p/ trazer a variante:
```ts
.select("id, numero_pedido, itens:ocs_tecido_itens(id, quantidade_pedida, quantidade_recebida, artigo:artigos(nome, unidade_medida, rendimento), variante:variante_tecido_id(nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
```
E a query do plano (`["otb-sim-plano"]`) já traz `itens:colecao_pv_itens(subcolecao_id, linha_id, prof_cor, cores, qtd_semanas)` — manter (usa `cores` só como referência). Import: `import { labelVarianteRow } from "@/lib/variante";`.

- [ ] **Step 2: Query do cenário salvo** — incluir `oc_tecido_id` + variantes:
```ts
.select("id, nome, unidades:otb_simulacao_unidades(id, subcolecao_id, oc_tecido_id, variantes:otb_simulacao_variantes(oc_tecido_item_id, ordem), linhas:otb_simulacao_linhas(id, linha_id, prof_cor, num_modelos, ordem, modelos:otb_simulacao_modelos(id, modelo_id, slot_index, consumo)))")
```

- [ ] **Step 3: `semear()`** — unidade agora tem `ocId=null`, `variantes=[]`; a linha não tem `cores` (removido). Para PV, `numSlots = Σ qtd_semanas` (igual hoje). Para Orçamento idem. Remover qualquer uso de `it.cores`/`l.cores` no seed.

- [ ] **Step 4: `mapCenarioFromDb`** — mapear `ocId: u.oc_tecido_id`, `variantes: (u.variantes||[]).sort(ordem).map(v => ({ ocItemId: v.oc_tecido_item_id }))`; linhas sem `cores`. Manter `dbId` + enriquecimento de modelo (ref/nome/foto via `modelosReais`).

- [ ] **Step 5: `buildArvore`** (payload do salvar) — por unidade: `{ subcolecao_id, oc_tecido_id: u.ocId, variantes: u.variantes.map(v => ({ oc_tecido_item_id: v.ocItemId })), linhas: u.linhas.map(l => ({ linha_id, prof_cor: l.profCor, cores: u.variantes.length, num_modelos: l.modelos.length, modelos:[…] })) }`. (Grava `cores = variantes.length` p/ compatibilidade; o servidor recalcula no aplicar.)

- [ ] **Step 6: UI da unidade** — picker de OC (`ocId`) + **multi-select de variantes** dessa OC:
  - Cada opção/variante usa `labelVarianteRow(item.variante)` (artigo vem do item: mostrar `item.artigo?.nome + " · " + labelVarianteRow(item.variante)`), com a metragem `metragemDisponivel(item.artigo?.unidade_medida, item.quantidade_pedida, item.artigo?.rendimento)`.
  - Chips das variantes escolhidas (add via dropdown das ainda não escolhidas; remover no chip). Ao lado, "plano: N cores" onde N = maior `cores` entre as linhas da subcoleção no `["otb-sim-plano"]` (referência, sem travar).
  - `helper varianteLabelDe(ocItemId)` p/ achar o item na OC e formatar.

- [ ] **Step 7: Linha** — remover o input de `cores`; mostrar `cores = u.variantes.length` como leitura ("cores: N"). `prof/cor` continua input. `+ Modelo` e "aplicar consumo a todos" iguais.

- [ ] **Step 8: Mini card por modelo** — trocar a linha do modelo por um card: foto/ref/nome + lista das **cores** (`u.variantes.map(labelVarianteRow)`) e, por cor, **peças = prof_cor** (e `m` = prof × consumo). Um input de **consumo** por modelo (o `ConsumoInput` decimal já existe) vale p/ todas as cores.

- [ ] **Step 9: Resultado por cor** — no painel da unidade, **uma linha por variante escolhida**:
  - `demandaPorCor = Σ_linhas Σ_modelos (l.profCor × m.consumo)` (usar `demandaLinha(l.profCor, 1, consumos)` somado, ou computar direto — cores=1 aqui porque a demanda é POR cor).
  - Por variante `v`: `disp = metragemDisponivel(item)`, `saldo = disp − demandaPorCor` → verde/vermelho "sobram/faltam X m" + barra. Cabeçalho da variante via `labelVarianteRow`.
  - Sem variantes escolhidas: mensagem "Escolha as cores (variantes) da OC".

- [ ] **Step 10: Write-back/footer** — inalterado (o botão "Aplicar no plano" já existe; o servidor grava cores=count). Garantir que `disabled` e invalidações seguem.

- [ ] **Step 11: Type-check + build** — `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339|TS2322|TS2503" || echo OK` → OK; `npm run build` → sucesso.

- [ ] **Step 12: Commit** — `git add src/components/otb/SimulacaoSheet.tsx && git commit -m "feat(otb): simulador com variantes por subcoleção — cores reais, resultado por cor, mini cards"`.

---

### Task 4: Docs + verificação final + push

**Files:** `CLAUDE.md` (bloco otb — 1 frase sobre cores reais/variantes), memória (`project_otb_open_to_buy.md`).

- [ ] **Step 1:** Ajustar a frase do Simulador no `CLAUDE.md`: cores = variantes reais por subcoleção (identificadas via `variante.ts`), resultado por cor, `otb_simulacao_variantes`, `aplicar` grava cores=count.
- [ ] **Step 2:** Atualizar a nota do simulador na memória (mesma ideia).
- [ ] **Step 3: Verificação final** — `npm run build` ✓; `npx tsc --noEmit … || echo OK` → OK; `npx vitest run tests/integration/otb-simulador.test.ts` → todos passam.
- [ ] **Step 4: Commit + push** — `git commit -m "docs(otb): cores reais do simulador" && git push origin main`.

## Self-review (writing-plans)

- **Cobertura**: identificar variante (Task 3 §6/§8 via `labelVarianteRow`) ✓; multi-seleção (Task 1 tabela + Task 3 §6) ✓; mini cards (Task 3 §8) ✓; resultado por cor (Task 3 §9) ✓; write-back cores uniforme (Task 2) ✓.
- **Tipos**: `UnidadeSim.variantes`/`ocId` usados consistentemente (Steps 4–9). `LinhaSim` sem `cores`. `aplicar` grava `count`, não payload.
- **Sem placeholder** na lógica não-óbvia; o corpo do `aplicar` é obtido por `pg_get_functiondef` + 3 mudanças pontuais (evita transcrição de 70 linhas).
