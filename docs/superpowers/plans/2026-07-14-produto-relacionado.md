# Produto Relacionado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir agrupar modelos num "conjunto" (vendidos juntos), editável no setor "Produto Relacionado" do Planejamento e visível como miniaturas clicáveis no diálogo de Produção > Lançamentos.

**Architecture:** Uma coluna-tag `modelos.conjunto_id` (mesmos = mesmo conjunto, simétrico). Duas RPCs `SECURITY DEFINER` atômicas (`conjunto_adicionar`/`conjunto_remover`) fazem a lógica (criar/mover/dissolver-singleton), tenant-scoped. Um componente auto-contido no Planejamento e uma seção no diálogo já existente de Lançamentos consomem as RPCs / leem os membros.

**Tech Stack:** Postgres (Supabase, migrations via `psql`), React + TanStack Query, TypeScript, shadcn/ui, Vitest (integração txn-revertida via `pg`).

## Global Constraints

- **Invariante #9:** toda RPC `DEFINER` → `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO authenticated`.
- **Tenant:** as RPCs confinam ao tenant do chamador (`modelos.tenant_id = get_user_tenant_id()`, senão `RAISE`).
- **Invariante do conjunto:** nunca um `conjunto_id` com exatamente 1 membro (as RPCs dissolvem).
- **`npm run build` NÃO roda tsc** → sempre `npx tsc --noEmit 2>&1 | grep -cE "error TS"` (esperado 0).
- **Colunas novas fora do types.ts gerado** → cast (`as never` / `as unknown as`), padrão do repo.
- **Migrations:** aplicar com `psql "$(cat /tmp/dburl.txt)" -f <arquivo>`; em transação (`BEGIN/COMMIT`).
- **Dev server do usuário:** para screenshots, reusar a porta (`PORT=$(lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | grep -oE "517[0-9]" | head -1)`, default 5173). **NUNCA** `pkill -f vite`.
- **Testes de integração** rodam contra PRODUÇÃO em txn revertida (`tests/integration/db.ts`): `withTx`, `comoUsuario`, `um`, `TENANT_TESTE`, `USER_TESTE`.

## File Structure

- `supabase/migrations/20260718220000_produto_relacionado.sql` — coluna `conjunto_id` + índice + 2 RPCs + REVOKE/GRANT. (Task 1)
- `tests/integration/rpc-conjunto.test.ts` — testes das RPCs. (Task 1)
- `src/components/planejamento/ProdutoRelacionadoSetor.tsx` — setor auto-contido do Planejamento. (Task 2)
- `src/routes/_authenticated/criacao.planejamento.tsx` — renderiza o setor abaixo de "Lançamento". (Task 2)
- `src/routes/_authenticated/producao.lancamentos.tsx` — `conjunto_id` na query + seção "Produto relacionado" no diálogo. (Task 3)

---

### Task 1: Backend — coluna, RPCs, testes de integração

**Files:**
- Create: `supabase/migrations/20260718220000_produto_relacionado.sql`
- Create: `tests/integration/rpc-conjunto.test.ts`

**Interfaces:**
- Produces: `modelos.conjunto_id uuid` (nullable); `conjunto_adicionar(_modelo_id uuid, _add_id uuid) RETURNS uuid`; `conjunto_remover(_modelo_id uuid) RETURNS void`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260718220000_produto_relacionado.sql`:

```sql
-- Produto Relacionado: conjunto de modelos vendidos juntos. conjunto_id compartilhado
-- (mesmos = mesmo conjunto, simétrico). RPCs atômicas cuidam de criar/mover/dissolver.
BEGIN;

ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS conjunto_id uuid;
CREATE INDEX IF NOT EXISTS idx_modelos_conjunto ON public.modelos(conjunto_id) WHERE conjunto_id IS NOT NULL;

-- Adiciona _add_id ao conjunto de _modelo_id (cria o conjunto se _modelo_id não tem).
-- Se _add_id já estava noutro conjunto, sai dele; se o antigo ficou com 1, dissolve.
CREATE OR REPLACE FUNCTION public.conjunto_adicionar(_modelo_id uuid, _add_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid; v_target uuid; v_old uuid; v_a_tenant uuid; v_b_tenant uuid;
BEGIN
  IF _modelo_id = _add_id THEN
    RAISE EXCEPTION 'Não é possível relacionar um produto a ele mesmo.';
  END IF;
  v_tenant := get_user_tenant_id();
  SELECT tenant_id, conjunto_id INTO v_a_tenant, v_target FROM public.modelos WHERE id = _modelo_id;
  SELECT tenant_id, conjunto_id INTO v_b_tenant, v_old FROM public.modelos WHERE id = _add_id;
  IF v_a_tenant IS NULL OR v_b_tenant IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado.';
  END IF;
  IF v_a_tenant <> v_tenant OR v_b_tenant <> v_tenant THEN
    RAISE EXCEPTION 'Produto de outra loja.';
  END IF;
  IF v_target IS NULL THEN
    v_target := gen_random_uuid();
    UPDATE public.modelos SET conjunto_id = v_target WHERE id = _modelo_id;
  END IF;
  UPDATE public.modelos SET conjunto_id = v_target WHERE id = _add_id;
  IF v_old IS NOT NULL AND v_old <> v_target THEN
    UPDATE public.modelos SET conjunto_id = NULL
    WHERE conjunto_id = v_old
      AND (SELECT count(*) FROM public.modelos WHERE conjunto_id = v_old) = 1;
  END IF;
  RETURN v_target;
END; $$;

-- Remove _modelo_id do seu conjunto; se o conjunto ficou com 1, dissolve.
CREATE OR REPLACE FUNCTION public.conjunto_remover(_modelo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid; v_old uuid; v_mt uuid;
BEGIN
  v_tenant := get_user_tenant_id();
  SELECT tenant_id, conjunto_id INTO v_mt, v_old FROM public.modelos WHERE id = _modelo_id;
  IF v_mt IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  IF v_mt <> v_tenant THEN RAISE EXCEPTION 'Produto de outra loja.'; END IF;
  IF v_old IS NULL THEN RETURN; END IF;
  UPDATE public.modelos SET conjunto_id = NULL WHERE id = _modelo_id;
  UPDATE public.modelos SET conjunto_id = NULL
  WHERE conjunto_id = v_old
    AND (SELECT count(*) FROM public.modelos WHERE conjunto_id = v_old) = 1;
END; $$;

REVOKE EXECUTE ON FUNCTION public.conjunto_adicionar(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conjunto_adicionar(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.conjunto_remover(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conjunto_remover(uuid) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Escrever os testes de integração (falham antes de aplicar a migration)**

Criar `tests/integration/rpc-conjunto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // outro tenant (cross-tenant)

async function novoModelo(c: any, tenant = TENANT_TESTE): Promise<string> {
  // set_tenant_id_trg (BEFORE INSERT em modelos) força o tenant do CHAMADOR (TENANT_TESTE),
  // ignorando um tenant_id explícito no insert. Para o caso cross-tenant, corrigimos por
  // UPDATE (não há trigger de tenant no UPDATE de modelos).
  const r = await um<{ id: string }>(c, `insert into modelos(nome) values ('ITEST conj') returning id`, []);
  if (tenant !== TENANT_TESTE) {
    await c.query(`update modelos set tenant_id=$1 where id=$2`, [tenant, r.id]);
  }
  return r.id;
}
const conj = (c: any, id: string) =>
  um<{ conjunto_id: string | null }>(c, `select conjunto_id from modelos where id=$1`, [id]).then((r) => r.conjunto_id);

describe.skipIf(!hasDb)("RPC conjunto — agrupar/mover/dissolver", () => {
  it("adiciona B a A cria o conjunto e junta os dois", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), b = await novoModelo(c);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, b]);
      const ca = await conj(c, a), cb = await conj(c, b);
      expect(ca).not.toBeNull();
      expect(cb).toBe(ca);
    });
  });

  it("adicionar um terceiro junta os três", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), b = await novoModelo(c), cc = await novoModelo(c);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, b]);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, cc]);
      const ca = await conj(c, a);
      expect(await conj(c, b)).toBe(ca);
      expect(await conj(c, cc)).toBe(ca);
    });
  });

  it("mover B p/ outro conjunto dissolve o antigo que ficou com 1", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), b = await novoModelo(c), d = await novoModelo(c);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, b]); // {A,B}
      await c.query(`select conjunto_adicionar($1,$2)`, [d, b]); // move B -> {D,B}; {A} dissolve
      expect(await conj(c, a)).toBeNull();
      const cd = await conj(c, d);
      expect(cd).not.toBeNull();
      expect(await conj(c, b)).toBe(cd);
    });
  });

  it("remover dissolve quando sobra 1", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), b = await novoModelo(c);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, b]); // {A,B}
      await c.query(`select conjunto_remover($1)`, [b]);          // B sai; {A} dissolve
      expect(await conj(c, b)).toBeNull();
      expect(await conj(c, a)).toBeNull();
    });
  });

  it("recusa relacionar a si mesmo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c);
      await expect(c.query(`select conjunto_adicionar($1,$1)`, [a])).rejects.toThrow();
    });
  });

  it("recusa produto de outra loja", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), x = await novoModelo(c, AVE_RARA);
      await expect(c.query(`select conjunto_adicionar($1,$2)`, [a, x])).rejects.toThrow();
    });
  });

  it("nunca deixa conjunto com exatamente 1 membro", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await novoModelo(c), b = await novoModelo(c), cc = await novoModelo(c);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, b]);
      await c.query(`select conjunto_adicionar($1,$2)`, [a, cc]);
      await c.query(`select conjunto_remover($1)`, [b]);
      const solos = await um<{ n: string }>(
        c,
        `select count(*) n from (select conjunto_id from modelos where conjunto_id is not null group by conjunto_id having count(*)=1) s`,
      );
      expect(Number(solos.n)).toBe(0);
    });
  });
});
```

- [ ] **Step 3: Rodar os testes e ver FALHAR**

Run: `npm test -- rpc-conjunto`
Expected: FAIL (função `conjunto_adicionar` não existe / coluna `conjunto_id` não existe).

- [ ] **Step 4: Aplicar a migration**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260718220000_produto_relacionado.sql`
Expected: `BEGIN … ALTER TABLE … CREATE FUNCTION … GRANT … COMMIT` sem erro.

- [ ] **Step 5: Rodar os testes e ver PASSAR**

Run: `npm test -- rpc-conjunto`
Expected: 7 passed.

- [ ] **Step 6: Verificar invariante #9 no banco**

Run: `psql "$(cat /tmp/dburl.txt)" -c "select has_function_privilege('authenticated','public.conjunto_adicionar(uuid,uuid)','execute') a, has_function_privilege('anon','public.conjunto_adicionar(uuid,uuid)','execute') b;"`
Expected: `a=t`, `b=f`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260718220000_produto_relacionado.sql tests/integration/rpc-conjunto.test.ts
git commit -m "feat(conjunto): coluna modelos.conjunto_id + RPCs adicionar/remover (atomicas, #9)"
```

---

### Task 2: Planejamento — setor "Produto Relacionado"

**Files:**
- Create: `src/components/planejamento/ProdutoRelacionadoSetor.tsx`
- Modify: `src/routes/_authenticated/criacao.planejamento.tsx` (import + render abaixo do `<Secao titulo="Lançamento">`, que fecha na linha ~1374)

**Interfaces:**
- Consumes: `conjunto_adicionar(_modelo_id, _add_id)`, `conjunto_remover(_modelo_id)` (Task 1); `useSignedUrl(path, "modelos")` (`src/hooks/useSignedUrl.ts`); `<Secao titulo>` (definido em `criacao.planejamento.tsx:864`).
- Produces: `<ProdutoRelacionadoSetor modeloId={string} />`.

- [ ] **Step 1: Criar o componente**

Criar `src/components/planejamento/ProdutoRelacionadoSetor.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, ImageOff } from "lucide-react";

type Membro = { id: string; ref: string | null; nome: string; fotos_modelo: string[] | null };
type Resultado = Membro & { conjunto_id: string | null };

function Thumb({ path, alt }: { path: string | null; alt: string }) {
  const url = useSignedUrl(path, "modelos");
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
      {url ? <img src={url} alt={alt} className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

export function ProdutoRelacionadoSetor({ modeloId }: { modeloId: string }) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [mover, setMover] = useState<Resultado | null>(null);

  const { data: conjuntoId = null } = useQuery({
    queryKey: ["modelo-conjunto", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase.from("modelos").select("conjunto_id").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return ((data as { conjunto_id?: string | null } | null)?.conjunto_id) ?? null;
    },
  });

  const { data: membros = [] } = useQuery({
    queryKey: ["conjunto-membros", conjuntoId, modeloId],
    enabled: !!conjuntoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos").select("id, ref, nome, fotos_modelo")
        .eq("conjunto_id", conjuntoId as string).neq("id", modeloId);
      if (error) throw error;
      return (data ?? []) as unknown as Membro[];
    },
  });

  const memberIds = new Set([modeloId, ...membros.map((m) => m.id)]);
  const { data: resultados = [] } = useQuery({
    queryKey: ["conjunto-busca", busca, modeloId],
    enabled: pickerOpen && busca.trim().length >= 1,
    queryFn: async () => {
      const q = busca.trim().replace(/[%,]/g, "");
      const { data, error } = await supabase
        .from("modelos").select("id, ref, nome, fotos_modelo, conjunto_id")
        .or(`ref.ilike.%${q}%,nome.ilike.%${q}%`).limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Resultado[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["modelo-conjunto", modeloId] });
    qc.invalidateQueries({ queryKey: ["conjunto-membros"] });
    qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
  };

  const adicionar = useMutation({
    mutationFn: async (addId: string) => {
      const { error } = await supabase.rpc("conjunto_adicionar" as never, { _modelo_id: modeloId, _add_id: addId } as never);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setPickerOpen(false); setBusca(""); setMover(null); toast.success("Produto relacionado adicionado."); },
    onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao relacionar.")),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("conjunto_remover" as never, { _modelo_id: id } as never);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Produto removido do conjunto."); },
    onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao remover.")),
  });

  const escolher = (r: Resultado) => (r.conjunto_id ? setMover(r) : adicionar.mutate(r.id));
  const visiveis = resultados.filter((r) => !memberIds.has(r.id));

  return (
    <div className="space-y-3">
      {membros.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum produto relacionado.</p>
      ) : (
        <ul className="space-y-2">
          {membros.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-md border p-2">
              <Thumb path={m.fotos_modelo?.[0] ?? null} alt={m.ref ?? m.nome} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-primary">{m.ref ?? "—"}</p>
                <p className="truncate text-sm">{m.nome}</p>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label="Remover" onClick={() => remover.mutate(m.id)} disabled={remover.isPending}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" onClick={() => setPickerOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> Adicionar produto
      </Button>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Relacionar produto</DialogTitle></DialogHeader>
          <Input autoFocus placeholder="Buscar por referência ou nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {visiveis.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => escolher(r)} className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted">
                  <Thumb path={r.fotos_modelo?.[0] ?? null} alt={r.ref ?? r.nome} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-primary">{r.ref ?? "—"}</p>
                    <p className="truncate text-sm">{r.nome}</p>
                  </div>
                  {r.conjunto_id && <span className="shrink-0 text-[10px] text-amber-600">em outro conjunto</span>}
                </button>
              </li>
            ))}
            {busca.trim().length >= 1 && visiveis.length === 0 && (
              <li className="p-2 text-sm text-muted-foreground">Nenhum produto encontrado.</li>
            )}
          </ul>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!mover} onOpenChange={(o) => !o && setMover(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mover produto?</AlertDialogTitle>
            <AlertDialogDescription>
              "{mover?.nome}" já está em outro conjunto e será movido para este. Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => mover && adicionar.mutate(mover.id)} disabled={adicionar.isPending}>Mover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 2: Importar o componente no Planejamento**

Em `src/routes/_authenticated/criacao.planejamento.tsx`, adicionar junto aos imports de componentes (perto dos outros `@/components/...`):

```tsx
import { ProdutoRelacionadoSetor } from "@/components/planejamento/ProdutoRelacionadoSetor";
```

- [ ] **Step 3: Renderizar o setor abaixo de "Lançamento"**

Em `criacao.planejamento.tsx`, logo APÓS o fechamento do setor Lançamento (`</Secao>` seguido de `)}` na linha ~1374-1375) e ANTES do `</div>` (linha ~1376), inserir:

```tsx
          {isEdit && modeloId && (
            <Secao titulo="Produto Relacionado">
              <ProdutoRelacionadoSetor modeloId={modeloId} />
            </Secao>
          )}
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -cE "error TS"` → esperado `0`
Run: `npm run build 2>&1 | tail -1` → esperado `✓ built`

- [ ] **Step 5: Verificar visualmente (screenshot no dev server do usuário)**

Detectar a porta (`PORT=$(lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | grep -oE "517[0-9]" | head -1)`; default 5173). Via Playwright (login `E2E_EMAIL`/`E2E_PASSWORD` do `.env`, aguardar `**/home`), abrir `/criacao/planejamento`, clicar num card existente (abre o Sheet), rolar até o setor "Produto Relacionado", screenshot. Confirmar: o setor aparece abaixo de "Lançamento", com "Nenhum produto relacionado." + botão "Adicionar produto". Abrir o picker, buscar por uma ref, escolher → o membro aparece na lista.

- [ ] **Step 6: Commit**

```bash
git add src/components/planejamento/ProdutoRelacionadoSetor.tsx src/routes/_authenticated/criacao.planejamento.tsx
git commit -m "feat(conjunto): setor Produto Relacionado no Planejamento"
```

---

### Task 3: Lançamentos — faixa "Produto relacionado" no diálogo

**Files:**
- Modify: `src/routes/_authenticated/producao.lancamentos.tsx` (query select + tipo do card + mapping + seção no `DialogContent`, que fecha na linha ~652)

**Interfaces:**
- Consumes: `useSignedUrl(path, "modelos")`; `ImagePreview` (`src/components/shared/ImagePreview.tsx`, API `<ImagePreview src={string} alt={string}>{trigger}</ImagePreview>`); a coluna `modelos.conjunto_id` (Task 1).

- [ ] **Step 1: Trazer `conjunto_id` na query dos cards**

Em `producao.lancamentos.tsx`, no `.select(...)` da query dos cards (linha ~112), acrescentar `conjunto_id` à lista de colunas de `modelos` — trocar o começo `"id, ref, nome, colecao, subcolecao, ...` por incluir `conjunto_id`:

```ts
        .select("id, ref, nome, conjunto_id, colecao, subcolecao, semana, data_lancamento, mes_id, ano_id, linha_id, versao, preco_venda, revisao_pendente, fotos_modelo, categoria_principal_id, subcategoria1_id, linha:linha_id(nome, markup), categorias_produto:categoria_principal_id(nome, grupo_id, grupo:grupo_id(nome)), subcategorias1_produto:subcategoria1_id(nome), cad(id, controle_qualidade(id, status, status_pos, fotografado_variantes), producao_terceirizados(ativo, categorias_terceirizado(etapa)))")
```

- [ ] **Step 2: Adicionar `conjunto_id` ao tipo do card e ao mapping**

Localizar o tipo do card (perto de `fotos_modelo: string[];`, linha ~62) e adicionar:

```ts
  conjunto_id: string | null;
```

No mapping que monta o card (perto de `fotos_modelo: Array.isArray(m.fotos_modelo) ? m.fotos_modelo : [],`, linha ~195) adicionar:

```ts
          conjunto_id: (m as { conjunto_id?: string | null }).conjunto_id ?? null,
```

- [ ] **Step 3: Adicionar imports (topo do arquivo)**

```tsx
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { ImagePreview } from "@/components/shared/ImagePreview";
```

- [ ] **Step 4: Componentes da faixa (adicionar no fim do arquivo, nível de módulo)**

No fim de `producao.lancamentos.tsx`, adicionar:

```tsx
function RelThumb({ path, refLabel }: { path: string | null; refLabel: string | null }) {
  const url = useSignedUrl(path, "modelos");
  const inner = (
    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded border bg-muted/40">
      {url ? <img src={url} alt={refLabel ?? ""} className="h-full w-full object-cover" /> : <span className="text-[9px] text-muted-foreground">Sem foto</span>}
    </div>
  );
  return (
    <div className="w-16 text-center">
      {url ? <ImagePreview src={url} alt={refLabel ?? ""}>{inner}</ImagePreview> : inner}
      <p className="mt-0.5 truncate font-mono text-[10px] text-primary">{refLabel ?? "—"}</p>
    </div>
  );
}

function RelacionadosLancamento({ conjuntoId, modeloId }: { conjuntoId: string | null; modeloId: string }) {
  const { data: membros = [] } = useQuery({
    queryKey: ["lanc-relacionados", conjuntoId, modeloId],
    enabled: !!conjuntoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos").select("id, ref, fotos_modelo")
        .eq("conjunto_id", conjuntoId as string).neq("id", modeloId);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; ref: string | null; fotos_modelo: string[] | null }[];
    },
  });
  if (!conjuntoId || membros.length === 0) return null;
  return (
    <div className="mt-1 border-t pt-2">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">Produto relacionado</p>
      <div className="flex flex-wrap gap-2">
        {membros.map((m) => <RelThumb key={m.id} path={m.fotos_modelo?.[0] ?? null} refLabel={m.ref} />)}
      </div>
    </div>
  );
}
```

(Se `useQuery`/`supabase` ainda não estiverem importados no arquivo, eles já estão — a tela usa ambos.)

- [ ] **Step 5: Renderizar a faixa no diálogo (abaixo da lista de variantes)**

No `DialogContent` do card, logo APÓS o `</div>` que fecha a lista de variantes (linha ~651) e ANTES de `</DialogContent>` (linha ~652), inserir:

```tsx
        <RelacionadosLancamento conjuntoId={card.conjunto_id} modeloId={card.modelo_id} />
```

- [ ] **Step 6: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -cE "error TS"` → esperado `0`
Run: `npm run build 2>&1 | tail -1` → esperado `✓ built`

- [ ] **Step 7: Verificar visualmente**

No dev server do usuário (porta detectada), abrir `/producao/lancamentos`, clicar num card de um modelo que esteja num conjunto (relacionar dois via Planejamento antes, se necessário), confirmar no diálogo: abaixo das "Fotos por variante" aparece "Produto relacionado" com a(s) miniatura(s); clicar na miniatura abre o lightbox (imagem ampliada). Screenshot.

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/producao.lancamentos.tsx
git commit -m "feat(conjunto): faixa Produto relacionado no dialogo de Lancamentos"
```

---

## Notas de verificação final (após as 3 tasks)

- `npm test` (unit + integração) verde; `npx tsc --noEmit` = 0; `npm run build` ✓.
- Fluxo ponta a ponta: relacionar A↔B no Planejamento → aparecem um no outro (recarregar o card) → em Lançamentos, o diálogo de A mostra B em miniatura (e vice-versa) → clicar amplia.
- `git push origin main` (workflow do dono: sempre terminar com push).
