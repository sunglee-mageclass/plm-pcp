# Nº de Pedido automático T/A/I (composto) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** Toda OC (Tecido/Aviamento/Insumo) ganha Nº de Pedido automático composto `<T|A|I>-<sigForn><sigMat>-NNNNN`, sequência própria por prefixo/tenant, mostrado AO VIVO (editável) no dialog de criação conforme escolhe fornecedor+material. Edição manual trava o auto.

**Architecture:** RPC única `proximo_numero_oc(_tipo, _fornecedor_id, _material_id)` calcula sigla (via `_aviamento_sigla`) + sequência e devolve o número pronto (fonte única — front só exibe). UNIQUE index no Insumo (`ocs_etiqueta`, que não tem). Loop de colisão nos 3 save-cores (belt) + o UNIQUE index (backstop). Plan. Tecido passa a prefixar `T-`. Front: 3 dialogs ganham preview ao vivo + flag `numeroEditadoManual`.

**Tech Stack:** Vite+React+TS, TanStack, Supabase, Vitest.

## Global Constraints

- Migrations via `psql "$(cat /tmp/dburl.txt)" -f`; `BEGIN;…COMMIT;`. Editar função = diff-validar (`pg_get_functiondef` antes/depois, só o delta), `CREATE OR REPLACE` (nunca DROP), restatar REVOKE se o padrão exigir.
- **Tabelas/colunas confirmadas** (via DB vivo): material da sigla = Tecido→`artigos.nome`, Aviamento→`aviamentos.codigo_nome` (NÃO `nome` — aviamentos não tem `nome`!), Insumo→`etiquetas.nome`. Fornecedor = `empresa_id` nas 3 OCs → `empresas.nome_fantasia`. Tabelas OC: `ocs_tecido`/`ocs_aviamento`/`ocs_etiqueta`. Itens: `ocs_tecido_itens.artigo_id`, `ocs_aviamento_itens.aviamento_id`, `ocs_etiqueta_itens.etiqueta_id`.
- Sigla = `_aviamento_sigla(nome)` (existe, IMMUTABLE, trata acento, 3 chars A-Z upper). REUSAR — não reinventar.
- RPC nova: `SECURITY DEFINER`, filtra por `get_user_tenant_id()`, REVOKE PUBLIC/anon, grant authenticated.
- Coluna fora do types.ts → `as any`. Antes de commit front: `tsc --noEmit | grep TS2304`, `npm run build`, anti-drift.
- Auto-preenchimento SÓ em modo CRIAÇÃO (não edição) — não sobrescrever número de OC existente.
- Sequência = max+1 sobre `regexp_replace(numero_pedido,'^.*\D','','')::int` filtrado por `like prefixo||'%'` e `~ (prefixo||'\d+$')`, por tenant. `lpad(seq,5,'0')`.

---

### Task 1: Migration — RPC `proximo_numero_oc` + UNIQUE index no Insumo

**Files:** Create `supabase/migrations/20260824200000_oc_numero_pedido_tai.sql`

**Interfaces:** Produces RPC `public.proximo_numero_oc(_tipo text, _fornecedor_id uuid, _material_id uuid) returns text` + partial unique index `ux_ocs_etiqueta_numero`.

- [ ] **Step 1:** Escrever a migration:
  ```sql
  BEGIN;
  -- gap: Insumo não tinha o unique index que Tecido/Aviamento têm
  CREATE UNIQUE INDEX IF NOT EXISTS ux_ocs_etiqueta_numero
    ON public.ocs_etiqueta (tenant_id, numero_pedido)
    WHERE numero_pedido IS NOT NULL AND numero_pedido <> '';

  CREATE OR REPLACE FUNCTION public.proximo_numero_oc(_tipo text, _fornecedor_id uuid, _material_id uuid)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
  DECLARE
    v_tenant uuid := get_user_tenant_id();
    v_letra text; v_tab text; v_matnome text; v_sigF text; v_sigM text; v_prefixo text; v_seq int;
  BEGIN
    IF _fornecedor_id IS NULL OR _material_id IS NULL THEN RETURN NULL; END IF;
    IF _tipo = 'tecido' THEN v_letra := 'T'; v_tab := 'ocs_tecido';
       SELECT nome INTO v_matnome FROM artigos WHERE id = _material_id;
    ELSIF _tipo = 'aviamento' THEN v_letra := 'A'; v_tab := 'ocs_aviamento';
       SELECT codigo_nome INTO v_matnome FROM aviamentos WHERE id = _material_id;
    ELSIF _tipo = 'insumo' THEN v_letra := 'I'; v_tab := 'ocs_etiqueta';
       SELECT nome INTO v_matnome FROM etiquetas WHERE id = _material_id;
    ELSE RAISE EXCEPTION 'tipo inválido: %', _tipo; END IF;
    v_sigF := _aviamento_sigla((SELECT nome_fantasia FROM empresas WHERE id = _fornecedor_id));
    v_sigM := _aviamento_sigla(v_matnome);
    v_prefixo := v_letra || '-' || coalesce(nullif(v_sigF,''),'FOR') || coalesce(nullif(v_sigM,''),'MAT') || '-';
    -- max+1 por prefixo/tenant sobre a tabela certa (EXECUTE por causa do nome dinâmico)
    EXECUTE format(
      'SELECT coalesce(max(nullif(regexp_replace(numero_pedido,''^.*\D'','''',''),'''')::int),0)+1
         FROM %I WHERE tenant_id = $1 AND numero_pedido LIKE $2 || ''%%'' AND numero_pedido ~ ($2 || ''\d+$'')',
      v_tab) INTO v_seq USING v_tenant, v_prefixo;
    RETURN v_prefixo || lpad(v_seq::text, 5, '0');
  END $fn$;

  REVOKE EXECUTE ON FUNCTION public.proximo_numero_oc(text, uuid, uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.proximo_numero_oc(text, uuid, uuid) TO authenticated;
  COMMIT;
  ```
- [ ] **Step 2:** Aplicar `psql -f`. Confirmar: índice existe (`\d ocs_etiqueta` ou pg_indexes); RPC existe e ACL (`has_function_privilege('anon',...)=f`, `authenticated=t`). Testar: `select proximo_numero_oc('tecido', <um empresa_id real>, <um artigo_id real>)` → `T-XXXYYY-00001` (ou 000NN se já houver). E `select proximo_numero_oc('aviamento', null, null)` → NULL.
- [ ] **Step 3: Commit** `feat(oc): RPC proximo_numero_oc (T/A/I + siglas + sequência) + unique index Insumo`

---

### Task 2: Migration — loop de colisão nos 3 save-cores + Plan. Tecido prefixo T-

**Files:** Create `supabase/migrations/20260824210000_oc_numero_colisao_e_plan_t.sql`

**Interfaces:** Consumes nada novo. Produces: `_salvar_oc_tecido_core`/`_salvar_oc_aviamento_core`/`salvar_oc_etiqueta` com guard de colisão no INSERT; `_plan_tecido_fazer_pedido_core` com prefixo `T-`.

- [ ] **Step 1:** Dump VIVO das 4 funções (`pg_get_functiondef`) p/ /tmp. Localizar em cada save-core o ponto do INSERT onde `numero_pedido` entra (via `_oc->>'numero_pedido'`).
- [ ] **Step 2:** Em cada um dos 3 save-cores, no INSERT (só quando é criação, `_oc_id null`), ANTES do INSERT, se `numero_pedido` não-vazio, rodar o loop de colisão:
  ```sql
  v_num := _oc->>'numero_pedido';
  IF v_num IS NOT NULL AND v_num <> '' THEN
    WHILE EXISTS (SELECT 1 FROM <tabela> WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
      -- bump o sufixo numérico
      v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D','',''))::int + 1)::text, 5, '0'));
    END LOOP;
  END IF;
  -- usar v_num no INSERT em vez de _oc->>'numero_pedido'
  ```
  (declarar `v_num text`; usar o `v_tenant` que a função já tem). Diff-validar: só esse bloco + a troca de `_oc->>'numero_pedido'` por `v_num` no INSERT. NADA mais.
- [ ] **Step 3:** Em `_plan_tecido_fazer_pedido_core` (`20260803130000` é o vivo): trocar `v_prefix := coalesce(nullif(v_sig_emp,''),'OC') || coalesce(nullif(v_sig_tec,''),'TEC') || '-';` por `v_prefix := 'T-' || coalesce(nullif(v_sig_emp,''),'FOR') || coalesce(nullif(v_sig_tec,''),'MAT') || '-';` e (opcional, consistência) trocar a sigla inline por `_aviamento_sigla(...)`. Diff-validar só essa linha (+ sigla se trocar).
- [ ] **Step 4:** Aplicar + diff-validar as 4 (cada diff = só o delta planejado). ACLs preservadas. QA SQL transacional: criar uma OC via `salvar_oc_tecido` com um número já existente → o loop bumpa; Plan. Tecido gera `T-...`.
- [ ] **Step 5: Commit** `feat(oc): guard de colisão nos save-cores + Plan. Tecido prefixo T- (diff-validado)`

---

### Task 3: Front — hook compartilhado `useNumeroPedidoAuto`

**Files:** Create `src/hooks/useNumeroPedidoAuto.ts`

**Interfaces:** Produces um hook que encapsula o preview ao vivo + trava manual, reusável nos 3 dialogs.

- [ ] **Step 1:** Implementar:
  ```ts
  export function useNumeroPedidoAuto(opts: {
    tipo: "tecido" | "aviamento" | "insumo";
    fornecedorId: string | null;
    materialId: string | null;   // material do 1º item
    numero: string;
    setNumero: (v: string) => void;
    ativo: boolean;              // só em modo CRIAÇÃO
  }) { ... }
  ```
  - Estado interno `editadoManual` (ref/state). Expor `onNumeroChange(v)` que seta `editadoManual = v.trim() !== "" ` ... na verdade: onChange do usuário → `editadoManual = true`; se v vazio → `editadoManual = false`. Chamar `setNumero(v)`.
  - `useEffect([tipo, fornecedorId, materialId, ativo])`: se `ativo && !editadoManual && fornecedorId && materialId` → chama `supabase.rpc("proximo_numero_oc", { _tipo: tipo, _fornecedor_id: fornecedorId, _material_id: materialId })` (debounce ~300ms via timeout no effect cleanup), seta `setNumero(data ?? "")`. Se faltar id → `setNumero("")`.
  - Retornar `{ onNumeroChange, placeholder }` onde placeholder = `"T-… (escolha fornecedor e material)"` conforme tipo (T/A/I).
- [ ] **Step 2:** Teste unit da parte pura se houver (a lógica de editadoManual/placeholder). O effect que chama supabase é difícil de testar em node — extrair o `placeholderDe(tipo)` como função pura testável.
- [ ] **Step 3:** `tsc --noEmit | grep useNumeroPedidoAuto`. Commit `feat(oc): hook useNumeroPedidoAuto (preview ao vivo + trava manual)`

---

### Task 4/5/6: Front — os 3 dialogs (PARALELIZÁVEIS após Task 3)

Cada um: consumir `useNumeroPedidoAuto`, ligar o campo "Número do Pedido" ao preview, pegar o materialId do 1º item.

- [ ] **Task 4 — OC Tecido** (`src/components/oc-tecido/OcTecidoForm.tsx` + `entrada-saida.oc-tecido.tsx`): fornecedorId = `draft.empresa_id`; materialId = `artigo_id` do 1º item do draft. `ativo = !isEdit`. Trocar o onChange do `<Input>` (`:112`) por `onNumeroChange`; `placeholder` do hook. Cuidado colab: o auto-preenchimento não pode marcar dirty falsamente — só roda em criação (sem OC prévia, snapshot ainda não armado ou o número já entra no snapshot inicial). Verificar o guard de unsaved.
- [ ] **Task 5 — OC Aviamento** (`src/routes/_authenticated/entrada-saida.oc-aviamento.tsx`): fornecedorId = `draft.empresa_id`; materialId = `aviamento_id` do 1º item. `ativo = !isEdit`. Campo em `:789`.
- [ ] **Task 6 — OC Insumo** (`src/routes/_authenticated/entrada-saida.oc-insumo.tsx`): usa `useState` flat (`numero`/`setNumero`). fornecedorId = a empresa selecionada; materialId = `etiqueta_id` do 1º item. `ativo = !isEdit`. Campo em `:472`.

Cada task 4/5/6: ligar o hook, `tsc` limpo no arquivo, `npm run build`, anti-drift, QA :5173 (abrir dialog novo, escolher fornecedor+material → número aparece T-/A-/I-; editar trava; limpar volta). Commit `feat(oc): {tipo} — nº de pedido ao vivo no dialog`.

---

### Task 7: Fechamento

- [ ] **Step 1:** `tsc --noEmit` = 0; `npm run build`; anti-drift. QA visual das 3 OCs (criar nova, ver o número compondo ao vivo, editar/limpar).
- [ ] **Step 2:** Review final da branch (opus): a RPC (sigla+sequência+tenant+colisão), os 3 dialogs coerentes (materialId do 1º item, ativo só em criação, trava manual), Plan. Tecido `T-`, o UNIQUE index Insumo, sem regressão no passthrough dos save-cores.

## Self-Review

**Spec coverage:** RPC calcula-tudo → T1; unique Insumo → T1; colisão + Plan T- → T2; hook → T3; 3 dialogs ao vivo+trava → T4/5/6. Fora: renumeração retroativa, plan aviamento/insumo.

**Placeholder scan:** T1/T2 têm SQL completo + método diff; T3 tem a assinatura + lógica; T4/5/6 têm arquivo:linha + de onde vem fornecedorId/materialId. A âncora do "1º item" pode variar por dialog — o agente confirma no arquivo real.

**Type consistency:** `proximo_numero_oc(_tipo,_fornecedor_id,_material_id)` idêntico em T1 (def), T3 (rpc call). `useNumeroPedidoAuto` opts idêntico nos 3 dialogs. Materiais: artigos.nome / aviamentos.codigo_nome / etiquetas.nome (T1).

**Riscos:** (a) aviamentos.nome NÃO EXISTE — é `codigo_nome` (T1 destaca); (b) EXECUTE dinâmico na RPC — nome de tabela é literal controlado (não input do user), seguro; (c) diff-validar 4 funções em T2; (d) colab dirty no Tecido (T4 destaca); (e) debounce no effect p/ não spammar a RPC a cada tecla.
