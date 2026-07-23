# CAD no Desenvolvimento — 4 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quatro correções no fluxo "CAD dentro do Desenvolvimento": (1) botão Enviar some após enviado, (2) nova variante entra no autocálculo do CAD, (3) save do Desenvolvimento atualiza a Explosão, (4) botão "Voltar ao Desenvolvimento" na Explosão com RPC.

**Architecture:** Três patches cirúrgicos em `ModeloDetailPanel.tsx` + um patch em `ExplosaoDetail.tsx` + uma migration de RPC SECURITY INVOKER. O Fix 2 é o mais delicado: introduz um `useEffect` de sincronização (`blocks` → `cadTecidosState`) que roda SOMENTE após `cadSeeded=true` e faz merge conservador (adiciona novas variantes com valores zerados, remove variantes que sumiram), sem tocar valores já digitados das variantes existentes e sem criar loop com o autoFolhas.

**Tech Stack:** React + TypeScript, TanStack Query, Supabase (RPC plpgsql), Tailwind/Radix UI

## Global Constraints

- `npm run build` deve passar ao final de cada task (Vite, não roda tsc sozinho)
- `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339|TS2322|TS6133"` deve retornar vazio (OK) após cada task
- Erros PT-BR via `mensagemErro(e, "fallback")` de `@/lib/erro-mensagem`; toasts de sucesso via `toast.success()`
- `as any` onde faltar tipo (Supabase types.ts desatualizado — não regen aqui)
- Migration: `BEGIN; … COMMIT;` + idempotente (`IF EXISTS / IF NOT EXISTS`), aplica com `psql "$(cat /tmp/dburl.txt)" -f <arq>`
- Padrão RPC: SECURITY INVOKER (default), `REVOKE EXECUTE … FROM public, anon` + `GRANT EXECUTE … TO authenticated` (os TRÊS — ver invariante #9 do CLAUDE.md)
- NÃO criar botão Enviar novo; NÃO apagar nada do CAD; NÃO push ao remoto
- Commit final: `fix(desenvolvimento/explosao): Enviar some após enviado; nova variante entra no autocálculo; save do dev atualiza Explosão; botão Voltar ao Desenvolvimento (RPC voltar_modelo_desenvolvimento)`

---

## File Map

| Arquivo | O que muda |
|---|---|
| `src/components/desenvolvimento/ModeloDetailPanel.tsx` | Fix 1: `canEnviarCad`; Fix 2: novo `useEffect` de sync blocks→cad; Fix 3: invalidações em `save.onSuccess` e `enviarCad.onSuccess` |
| `src/components/producao/explosao/ExplosaoDetail.tsx` | Fix 4: import `RotateCcw`, state `voltarOpen`, mutation `voltarMut`, AlertDialog, botão "Voltar ao Desenvolvimento" |
| `supabase/migrations/20260717200000_voltar_modelo_desenvolvimento.sql` | Nova RPC `voltar_modelo_desenvolvimento(_modelo_id uuid)` |

---

## Contexto essencial para o implementador

### Estrutura de variantes: `blocks` vs `cadTecidosState`

`blocks` (estado da seção "3. Tecidos"):
```ts
// TecidoBlock
{
  tipo: "tecido" | "forro" | "entretela",
  numero: number,           // 1, 2, 3…
  artigo_id: string | null,
  variantes: (string | null)[],  // array[10] de variante_tecido_id, null = slot vazio
  multiplicadores: number[],
  // …outros campos
}
```

`cadTecidosState` (estado da seção "4. CAD"):
```ts
// CadTecidoRow
{
  tipo: "tecido" | "forro" | "entretela",
  numero: number,     // chave de casamento com blocks: tipo+numero
  variantes: CadVarianteRow[],   // só as variantes não-null, indexadas por ordem (1-based)
}

// CadVarianteRow
{
  variante_tecido_id: string | undefined,
  ordem: number,  // posição 1-based no array de 10 do block
  quantidade_folhas: number,
  metragem_planejada: number,
  metragem_enviada: number,
  multiplicador: number,
  variante_nome: string | null,
  variante_cor: string | null,
  variante_apelido: string | null,
}
```

A semeadura (`cadSeeded`) acontece UMA vez. Depois, quando o usuário chama `updateBlockVariante(idx, vIdx, value)`:
- `blocks[idx].variantes[vIdx]` é atualizado
- MAS `cadTecidosState` NÃO é atualizado → nova variante é invisível no "4. CAD" e o autoFolhas não a calcula

### QueryKeys da Explosão

`ExplosaoDetail.tsx` usa:
- `["explosao-modelo", modeloId]`
- `["explosao-cad-row", modeloId]`
- `["explosao-cad-tecidos", cadRow?.id]`
- `["explosao-cad-grades", cadRow?.id]`
- `["explosao-tenant-config-grade", tenantId]`
- `["explosao-oc-links", modeloId]`
- `["producao-explosao-list"]` — lista principal da tela de Explosão

`salvarMut.onSuccess` em `ExplosaoDetail` invalida `["explosao-cad-row", modeloId]`, `["explosao-cad-tecidos", cadRow?.id]`, `["cad-row", modeloId]`.

### Estado atual de `save.onSuccess` em `ModeloDetailPanel` (linha ~1070)

Já invalida (entre outros): `["modelo-detail"]`, `["modelos-desenvolvimento"]`, `["dev-cad-row"]`, `["dev-cad-tecidos"]`, `["estoque-tecidos"]`, `["ft-*"]`.

NÃO invalida as keys da Explosão (`explosao-*` nem `producao-explosao-list`).

### Estado atual de `enviarCad.onSuccess` em `ModeloDetailPanel` (linha ~1117)

Já invalida: `["producao-explosao-list"]`, `["modelos-desenvolvimento"]`, `["modelo-detail"]`, `["modelo-condicoes-kanban"]`, `["modelo-cad-calc"]`, `["ft-*"]`.

NÃO invalida `["explosao-cad-row", modeloId]` nem `["explosao-cad-tecidos"]`.

---

## Task 1: Fix 1 — Botão Enviar some após enviado

**Files:**
- Modify: `src/components/desenvolvimento/ModeloDetailPanel.tsx:866`

**Interfaces:**
- Consumes: `draft?.enviado_cad` (boolean), `isAprovado` (boolean), `cadMissing` (string[])
- Produces: `canEnviarCad` (boolean) — false quando `draft?.enviado_cad === true`

- [ ] **Step 1: Ler a linha atual**

  Localizar no arquivo linha 866 (função `PanelContent`):
  ```ts
  const canEnviarCad = isAprovado && cadMissing.length === 0;
  ```

- [ ] **Step 2: Aplicar o patch**

  Trocar por:
  ```ts
  const canEnviarCad = isAprovado && !draft?.enviado_cad && cadMissing.length === 0;
  ```

  Confirmar que `cadMissing` é usado apenas nas linhas ~851-864 (cálculo de missing) e ~1601-1604 (aviso UI "Para enviar, falta:") — esses usos NÃO dependem de `canEnviarCad`, então não quebram.
  
  O botão "Enviar" em linha ~1631 já está dentro de `{canEnviarCad && (…)}`, então vai sumir automaticamente.

- [ ] **Step 3: Verificar tsc**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339|TS2322|TS6133" || echo OK
  ```
  Esperado: `OK`

- [ ] **Step 4: Commit**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp"
  git add src/components/desenvolvimento/ModeloDetailPanel.tsx
  git commit -m "fix(desenvolvimento): botão Enviar some após enviado_cad=true"
  ```

---

## Task 2: Fix 2 — Nova variante entra no autocálculo do CAD

**Files:**
- Modify: `src/components/desenvolvimento/ModeloDetailPanel.tsx` — novo `useEffect` após linha 784 (depois do autoFolhas effect)

**Interfaces:**
- Consumes: `blocks` (TecidoBlock[]), `cadSeeded` (boolean), `cadTecidosState` (CadTecidoRow[]), `setCadTecidosState`
- Produces: `cadTecidosState` sincronizado com variantes não-null de `blocks`, preservando valores já digitados

**Causa raiz:** O `useEffect` de semeadura (linha 586) roda uma vez (`cadSeeded` vira true e o guard `if (cadSeeded) return` bloqueia re-execuções). Quando o usuário adiciona uma variante via `updateBlockVariante`, `blocks[idx].variantes[vIdx]` recebe o novo `variante_tecido_id`, MAS o `cadSeeded` já é `true` — a semeadura não roda de novo. O `cadTecidosState` não tem a nova variante, então a seção "4. CAD" não a mostra e o autoFolhas não a calcula.

**Solução:** Adicionar um `useEffect` separado que observa `blocks` (DEPOIS do cadSeeded) e faz merge das variantes não-null nos `cadTecidosState` correspondentes (casando por `tipo+numero`). O merge: adiciona variantes novas com `quantidade_folhas=0, metragem_planejada=0, metragem_enviada=0`; remove variantes que sumiram; preserva valores das variantes existentes (casa por `variante_tecido_id`).

**Análise de loop:** O autoFolhas effect (linha 758) tem deps `[autoFolhas, grades, draft?.proporcoes, cadTecidosState]` e só altera `quantidade_folhas` e `metragem_planejada`. O sync effect aqui tem deps `[blocks, cadSeeded]` e só altera as variantes presentes (estrutura). São concerns diferentes e não criam loop entre si porque: sync escreve só a lista de variantes (add/remove), autoFolhas escreve só os valores numéricos dentro das variantes existentes. Se o usuário desligar autoFolhas, o sync não aciona o autoFolhas.

- [ ] **Step 1: Localizar a posição de inserção**

  No arquivo `ModeloDetailPanel.tsx`, após a linha 784 (fim do `useEffect` do autoFolhas), e antes da linha 786 (~helpers `updateCadTec`), inserir o novo efeito.

- [ ] **Step 2: Inserir o useEffect de sync blocks→cadTecidosState**

  ```ts
  // Sincroniza variantes do BOM (blocks) com o cadTecidosState — roda só após a semeadura.
  // Quando o usuário adiciona/remove uma variante na seção "3. Tecidos", o cadTecidosState
  // do tecido correspondente é atualizado: novas variantes ganham folhas/metragem zeradas
  // (prontas pro autoFolhas calcular) e variantes removidas são descartadas.
  // Preserva valores já digitados das variantes existentes (casa por variante_tecido_id).
  useEffect(() => {
    if (!cadSeeded) return; // só após a semeadura inicial
    setCadTecidosState((prev) => {
      let changed = false;
      const next = prev.map((cadTec) => {
        // Acha o block correspondente (mesmo tipo+numero)
        const block = blocks.find((b) => b.tipo === cadTec.tipo && b.numero === cadTec.numero);
        if (!block) return cadTec;

        // Variantes não-null do block, com sua ordem (1-based)
        const bomVars: { variante_tecido_id: string; ordem: number; multiplicador: number }[] = [];
        block.variantes.forEach((vid, i) => {
          if (vid) bomVars.push({ variante_tecido_id: vid, ordem: i + 1, multiplicador: Number(block.multiplicadores?.[i] ?? 1) || 1 });
        });

        // Mapa das variantes já no cadTecidosState (por variante_tecido_id)
        const have = new Map(cadTec.variantes.map((v) => [v.variante_tecido_id, v]));

        // Constrói a nova lista de variantes do cadTec
        const nextVariantes: CadVarianteRow[] = bomVars.map(({ variante_tecido_id, ordem, multiplicador }) => {
          const existing = have.get(variante_tecido_id);
          if (existing) {
            // Preserva valores já digitados; atualiza ordem/multiplicador se mudou
            const ord = existing.ordem !== ordem || existing.multiplicador !== multiplicador
              ? { ...existing, ordem, multiplicador }
              : existing;
            return ord;
          }
          changed = true;
          // Nova variante: zerada, pronta pro autoFolhas
          return {
            variante_tecido_id,
            variante_nome: null,
            variante_cor: null,
            variante_apelido: null,
            multiplicador,
            ordem,
            quantidade_folhas: 0,
            metragem_planejada: 0,
            metragem_enviada: 0,
          } as CadVarianteRow;
        });

        // Checa se alguma variante foi removida
        if (nextVariantes.length !== cadTec.variantes.length) changed = true;

        if (!changed && nextVariantes.every((v, i) => v === cadTec.variantes[i])) return cadTec;
        changed = true;
        return { ...cadTec, variantes: nextVariantes };
      });
      return changed ? next : prev;
    });
  }, [blocks, cadSeeded]); // eslint-disable-line react-hooks/exhaustive-deps
  ```

  **Nota sobre `changed`:** O flag `changed` no início do `setCadTecidosState` é compartilhado pelo closure do map — isso funciona porque o map é síncrono. A flag `changed` final no `return changed ? next : prev` evita re-renders desnecessários quando não houve mudança real.

- [ ] **Step 3: Verificar tsc**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339|TS2322|TS6133" || echo OK
  ```
  Esperado: `OK`

- [ ] **Step 4: Verificar mentalmente o fluxo**

  Cenário: autoFolhas ligado → usuário adiciona variante no bloco Tecido 1 → `blocks` muda → sync effect roda → adiciona a variante em `cadTecidosState[0].variantes` com `quantidade_folhas=0` → autoFolhas effect roda (dep `cadTecidosState` mudou) → calcula `quantidade_folhas` e `metragem_planejada` da nova variante → seção "4. CAD" mostra a variante com valores calculados. ✓

  Cenário sem loop: autoFolhas effect escreve `quantidade_folhas`/`metragem_planejada` → `cadTecidosState` muda → sync effect roda (`blocks` NÃO mudou, `cadSeeded` NÃO mudou) → deps não mudaram → React NÃO re-executa o sync effect. ✓

- [ ] **Step 5: Build**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run build 2>&1 | tail -20
  ```
  Esperado: finaliza sem erro.

- [ ] **Step 6: Commit**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp"
  git add src/components/desenvolvimento/ModeloDetailPanel.tsx
  git commit -m "fix(desenvolvimento): nova variante sincroniza com cadTecidosState para autocálculo"
  ```

---

## Task 3: Fix 3 — Save do Desenvolvimento atualiza a Explosão

**Files:**
- Modify: `src/components/desenvolvimento/ModeloDetailPanel.tsx` — `save.onSuccess` (~linha 1070) e `enviarCad.onSuccess` (~linha 1117)

**Interfaces:**
- Consumes: `qc` (QueryClient), `modeloId` (string), `cadRow?.id` via invalidação por prefixo
- Produces: queries da Explosão invalidadas no onSuccess de save e enviarCad

**Problema:** Quando o dono salva no Desenvolvimento, a tela de Explosão ainda mostra dados velhos porque as queries `explosao-*` não são invalidadas. O `save.onSuccess` invalida `dev-cad-*` (para o próprio card) mas não as queries que o `ExplosaoDetail` usa.

**Solução:**

Em `save.onSuccess` (~linha 1097, após `qc.invalidateQueries({ queryKey: ["modelo-observacoes", modeloId] })`), adicionar:
```ts
// Atualiza a Explosão para refletir o CAD recém-salvo.
qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-tecidos" });
qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-grades" });
qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
```

Em `enviarCad.onSuccess` (~linha 1125, após `qc.invalidateQueries({ queryKey: ["producao-explosao-list"] })`), adicionar:
```ts
// Explosão precisa recarregar os dados do CAD recém-criado/atualizado.
qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-tecidos" });
qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-grades" });
```

Nota: `["explosao-cad-tecidos", cadRow?.id]` e `["explosao-cad-grades", cadRow?.id]` têm o `cadRow.id` como segundo elemento, mas esse id pode não estar disponível em `ModeloDetailPanel`. Por isso, usar `predicate` filtrando pelo prefixo `explosao-cad-tecidos` e `explosao-cad-grades` — isso casa qualquer id.

- [ ] **Step 1: Editar `save.onSuccess`**

  Localizar no arquivo (após linha 1097, antes do `setEditing(false)`):
  ```ts
      qc.invalidateQueries({ queryKey: ["modelo-observacoes", modeloId] });
      setEditing(false); // Salvar re-trava quando já foi enviado à Explosão.
  ```
  
  Inserir as 4 invalidações entre as duas linhas:
  ```ts
      qc.invalidateQueries({ queryKey: ["modelo-observacoes", modeloId] });
      // Atualiza a Explosão para refletir o CAD recém-salvo.
      qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-tecidos" });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-grades" });
      qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
      setEditing(false); // Salvar re-trava quando já foi enviado à Explosão.
  ```

- [ ] **Step 2: Editar `enviarCad.onSuccess`**

  Localizar (linha ~1125):
  ```ts
      qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
  ```
  
  Inserir após `["producao-explosao-list"]`:
  ```ts
      qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
      // Explosão precisa recarregar os dados do CAD recém-criado/atualizado.
      qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-tecidos" });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-grades" });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
  ```

- [ ] **Step 3: Verificar tsc**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339|TS2322|TS6133" || echo OK
  ```
  Esperado: `OK`

- [ ] **Step 4: Commit**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp"
  git add src/components/desenvolvimento/ModeloDetailPanel.tsx
  git commit -m "fix(desenvolvimento): save/enviar invalidam queries da Explosão"
  ```

---

## Task 4: Fix 4a — Migration RPC `voltar_modelo_desenvolvimento`

**Files:**
- Create: `supabase/migrations/20260717200000_voltar_modelo_desenvolvimento.sql`

**Interfaces:**
- Produces: `public.voltar_modelo_desenvolvimento(_modelo_id uuid)` returns void
- SECURITY INVOKER, revogado de public+anon, granted a authenticated

- [ ] **Step 1: Criar a migration**

  Criar o arquivo `/Users/sunglee/PLM + Criação/plm-pcp/supabase/migrations/20260717200000_voltar_modelo_desenvolvimento.sql` com o conteúdo:

  ```sql
  -- 20260717200000_voltar_modelo_desenvolvimento.sql
  -- RPC para reverter o envio de um modelo à Explosão.
  -- Seta modelos.enviado_cad = false (NÃO apaga o CAD; só desmarca o envio).
  -- SECURITY INVOKER + revoke public/anon (padrão invariante #9).
  begin;

  create or replace function public.voltar_modelo_desenvolvimento(_modelo_id uuid)
  returns void
  language plpgsql
  set search_path to 'public'
  as $function$
  begin
    if auth.uid() is null then
      raise exception 'Não autenticado' using errcode = '42501';
    end if;

    if not public.tenant_module_enabled('criacao') then
      raise exception 'Módulo criação não habilitado' using errcode = '42501';
    end if;

    -- Verifica que o modelo pertence ao tenant do usuário (ou é super_admin).
    if not exists (
      select 1 from public.modelos
      where id = _modelo_id
        and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
    ) then
      raise exception 'Modelo não encontrado' using errcode = 'P0002';
    end if;

    update public.modelos
      set enviado_cad = false
    where id = _modelo_id;
  end;
  $function$;

  -- Revoga dos três (PUBLIC herda para anon e authenticated; revogar só anon/auth é inócuo).
  revoke execute on function public.voltar_modelo_desenvolvimento(uuid) from public, anon, authenticated;
  grant  execute on function public.voltar_modelo_desenvolvimento(uuid) to authenticated;

  commit;
  ```

- [ ] **Step 2: Aplicar a migration**

  ```bash
  psql "$(cat /tmp/dburl.txt)" -f "/Users/sunglee/PLM + Criação/plm-pcp/supabase/migrations/20260717200000_voltar_modelo_desenvolvimento.sql"
  ```
  Esperado: `BEGIN`, `CREATE FUNCTION`, `REVOKE`, `GRANT`, `COMMIT` (sem erros).

- [ ] **Step 3: Verificar grants**

  ```bash
  psql "$(cat /tmp/dburl.txt)" -tA -c "select has_function_privilege('authenticated','public.voltar_modelo_desenvolvimento(uuid)','EXECUTE'), has_function_privilege('anon','public.voltar_modelo_desenvolvimento(uuid)','EXECUTE')"
  ```
  Esperado: `t|f`

- [ ] **Step 4: Commit da migration**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp"
  git add "supabase/migrations/20260717200000_voltar_modelo_desenvolvimento.sql"
  git commit -m "feat(db): RPC voltar_modelo_desenvolvimento (INVOKER, revoke public/anon)"
  ```

---

## Task 5: Fix 4b — Botão "Voltar ao Desenvolvimento" na Explosão

**Files:**
- Modify: `src/components/producao/explosao/ExplosaoDetail.tsx`

**Interfaces:**
- Consumes: `public.voltar_modelo_desenvolvimento(uuid)` via `supabase.rpc()`
- Produces: botão no cabeçalho da Explosão que reverte `enviado_cad` e fecha o painel

**O que adicionar no `ExplosaoDetail.tsx`:**

1. Import `RotateCcw` de `lucide-react` (já importa outros ícones da lucide)
2. State `const [voltarOpen, setVoltarOpen] = useState(false);`
3. Mutation `voltarMut`
4. AlertDialog de confirmação
5. Botão "Voltar ao Desenvolvimento" à esquerda dos outros botões no header

- [ ] **Step 1: Adicionar import de `RotateCcw`**

  Localizar linha 15:
  ```ts
  import { ImageIcon, Printer, Save, Send } from "lucide-react";
  ```
  Trocar por:
  ```ts
  import { ImageIcon, Printer, RotateCcw, Save, Send } from "lucide-react";
  ```

- [ ] **Step 2: Adicionar state `voltarOpen`**

  Após linha 50 (`const [confirmZeroOpen, setConfirmZeroOpen] = useState(false);`):
  ```ts
  const [voltarOpen, setVoltarOpen] = useState(false);
  ```

- [ ] **Step 3: Adicionar mutation `voltarMut`**

  Após a mutation `enviarCorte` (após linha 338, antes de `const handleEnviar`):
  ```ts
  // --- voltar ao desenvolvimento ---
  const voltarMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("voltar_modelo_desenvolvimento" as any, {
        _modelo_id: modeloId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Voltou ao Desenvolvimento");
      qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      qc.invalidateQueries({ queryKey: ["explosao-modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && (q.queryKey[0] as string).startsWith("ft-") });
      onEnviado(); // fecha o painel (mesma callback que enviarCorte usa)
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao voltar ao Desenvolvimento")),
  });
  ```

- [ ] **Step 4: Adicionar botão no cabeçalho**

  Localizar (linha ~359):
  ```ts
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => printWithImages()}>
  ```
  
  Inserir o botão ANTES de `Ficha de Corte`:
  ```ts
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVoltarOpen(true)}
              disabled={voltarMut.isPending}
            >
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Voltar ao Desenvolvimento
            </Button>
            <Button variant="outline" size="sm" onClick={() => printWithImages()}>
  ```

- [ ] **Step 5: Adicionar AlertDialog de confirmação**

  Após o AlertDialog `confirmZeroOpen` existente (após linha 456, antes do `</>`):
  ```tsx
      <AlertDialog open={voltarOpen} onOpenChange={setVoltarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voltar ao Desenvolvimento?</AlertDialogTitle>
            <AlertDialogDescription>
              Voltar este modelo ao Desenvolvimento? Ele sai da Explosão e volta a ser editável.
              O CAD existente é mantido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setVoltarOpen(false);
                voltarMut.mutate();
              }}
            >
              Voltar ao Desenvolvimento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
  ```

- [ ] **Step 6: Verificar tsc**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339|TS2322|TS6133" || echo OK
  ```
  Esperado: `OK`

- [ ] **Step 7: Build final**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run build 2>&1 | tail -30
  ```
  Esperado: build sem erros.

- [ ] **Step 8: Commit final**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp"
  git add src/components/producao/explosao/ExplosaoDetail.tsx
  git commit -m "fix(explosao): botão Voltar ao Desenvolvimento com AlertDialog de confirmação"
  ```

---

## Task 6: Commit de integração e relatório

- [ ] **Step 1: Verificação final completa**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp"
  npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339|TS2322|TS6133" || echo OK
  npm run build 2>&1 | tail -10
  psql "$(cat /tmp/dburl.txt)" -tA -c "select has_function_privilege('authenticated','public.voltar_modelo_desenvolvimento(uuid)','EXECUTE'), has_function_privilege('anon','public.voltar_modelo_desenvolvimento(uuid)','EXECUTE')"
  ```

  Esperados:
  - tsc: `OK`
  - build: sem erros
  - grants: `t|f`

- [ ] **Step 2: Commit de integração (se houver mudanças não commitadas)**

  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp"
  git status
  # Se houver arquivos não commitados:
  git add -p  # revisar e staged seletivamente
  git commit -m "fix(desenvolvimento/explosao): Enviar some após enviado; nova variante entra no autocálculo; save do dev atualiza Explosão; botão Voltar ao Desenvolvimento (RPC voltar_modelo_desenvolvimento)"
  ```

- [ ] **Step 3: Escrever relatório**

  Criar `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/task-4g-report.md` com:
  - Fix 1: arquivo:linha alterada, o que mudou
  - Fix 2: causa raiz (cadSeeded bloqueia re-semeadura; blocks muda mas cadTecidosState não), como resolveu (sync effect com merge conservador), análise anti-loop
  - Fix 3: keys invalidadas em save.onSuccess e enviarCad.onSuccess
  - Fix 4: RPC criada, grants, botão + AlertDialog em ExplosaoDetail
  - Resultado tsc + build

---

## Self-Review

**Spec coverage:**
- ✓ Fix 1: `canEnviarCad` inclui `!draft?.enviado_cad` — Task 1
- ✓ Fix 2: novo useEffect de sync blocks→cadTecidosState — Task 2
- ✓ Fix 3: invalidações explosao-* em save.onSuccess e enviarCad.onSuccess — Task 3
- ✓ Fix 4: migration RPC + botão + AlertDialog — Tasks 4+5
- ✓ Verificação tsc+build — Tasks 1,2,3,5,6
- ✓ Verificação grants (`t|f`) — Task 4, Step 3
- ✓ Relatório em `.superpowers/sdd/task-4g-report.md` — Task 6

**Placeholder scan:** Nenhum TBD, TODO, "implement later" ou referência sem definição encontrados.

**Type consistency:**
- `CadVarianteRow` — importado em linha 19 de `ModeloDetailPanel.tsx` de `@/components/producao/cad/types`
- `voltarMut` — usado no botão e na mutation, mesma variável
- `onEnviado` — prop existente de `ExplosaoDetail`, já usada em `enviarCorte.onSuccess`
- `"voltar_modelo_desenvolvimento" as any` — padrão do projeto para RPCs não tipadas
