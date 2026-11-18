# Realtime Onda 1 — "ninguém mais aperta F5" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o recarregamento manual (F5): Oficina ganha realtime + proteção de versão no molde; 6 telas "parciais" refletem via extensão do mapa de invalidação; e os 4 residuais de merge da Camada são resolvidos.

**Architecture:** Adesão ao motor de realtime já existente (`useColabRegistro` por registro + `useRealtimeInvalidation` global por tabela). Oficina copia o padrão do CQ. As tabelas-filha que faltam entram no mapa de invalidação e são publicadas no Realtime (migration aditiva). Os residuais de merge são ajustes pontuais em funções puras já existentes.

**Tech Stack:** React + TanStack Query + Supabase Realtime (`postgres_changes`, `ALTER PUBLICATION`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-realtime-coedicao-ondas-design.md` (Onda 1).

## Global Constraints

- Deploy ÚNICO com a frente da revenda — acumula na branch `feature/plan-tecido-a1`; publicação é portão do dono.
- Reusar o motor existente: NÃO reescrever `useColabRegistro`/`useRealtimeInvalidation`/`mergeLinhas`.
- Migration só ADITIVA: `ALTER PUBLICATION supabase_realtime ADD TABLE public.<t>` (idempotente, `IF NOT EXISTS` via `DO`/`pg_publication_tables`). Banco ANTES do site.
- Já publicadas no Realtime (cópia local, não republicar): `cad`, `variantes_aviamento`, `variantes_etiqueta`. FALTA publicar: `producao_oficina`, `tipos_colaborador`, `empresa_categorias_fornecedor`, `empresa_categorias_servico`, `enderecamento_tecido` (todas REPLICA IDENTITY default/PK — suficiente para invalidação de lista).
- `cad` JÁ tem coluna `rev` — o molde da Oficina usa `.eq("rev", base)`; nenhuma migration para isso.
- RAISE 5xx só ASCII; erros PT; `tsc --noEmit | grep TS2304` após imports.
- Testes de integração: `export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"` (cópia LOCAL; fallback = produção) + `--no-file-parallelism`.

## Review Focus

- **Oficina: lost update do molde** — 2 pessoas editam "Partes do Molde" do mesmo CAD; sem rev, a 2ª apaga a 1ª sem aviso. Task 1 cobre (rev + P0409).
- **Oficina: eco do próprio save** — o realtime do próprio UPDATE não pode re-disparar merge/aviso falso ao autor. Task 1 cobre (padrão do CQ: o `onMudancaServidor` re-busca; o save em voo não acende conflito).
- **Parciais: tabela publicada mas key errada** — publicar a tabela mas mapear a queryKey errada = lista não atualiza. Task 2 cobre (testa que o evento invalida a key da lista certa).
- **Plan.Tecido: linha removida ressuscita** — sem `removidasIds`, o merge da árvore ressuscita um slot que eu removi. Task 3 cobre.
- **OC rolo: plano de rolos sobrescrito** — `rolos_planejados` fora do merge sobrescreve o plano alheio. Task 4 cobre.

---

### Task 1: Oficina — realtime + rev no molde (funde o residual M2 do PCP)

**Files:**
- Modify: `src/routes/_authenticated/pcp.oficina.$modeloId.tsx` (adicionar `useColabRegistro`; `rev` no UPDATE do molde ~:256; tratamento P0409)
- Test: `tests/integration/oficina-molde-rev.test.ts`

**Interfaces:**
- Consumes: `useColabRegistro` de `@/hooks/useColabRegistro` (assinatura do CQ: `{canal, tabela, filtroColuna, registroId, tabelasExtra?, onMudancaServidor, campoFocado?}`); `cad.rev` (já existe); queryKeys da Oficina (`["oficina-cad", modeloId]`, `["producao-oficina", cad.id]`, `["cad-grades", cad.id, "full"]`).
- Produces: nada exportado; a Oficina passa a refletir sem F5 e a proteger o molde.

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/oficina-molde-rev.test.ts
// Prova no banco (cópia local, txn revertida) que gravar observacoes_molde com rev desatualizado
// é recusado (lost update fechado). Hoje o UPDATE é cru (sem .eq rev) e sobrescreve.
import { describe, it, expect } from "vitest";
import { comTxn } from "./db";

describe("Oficina: molde protegido por rev", () => {
  it("UPDATE de observacoes_molde com rev antigo NÃO sobrescreve (0 linhas)", async () => {
    await comTxn(async (c) => {
      const cadId = await seedCadComMolde(c, "molde A", /*rev*/ 1); // helper: cria cad com rev=1
      // simula outra pessoa salvando (rev sobe para 2)
      await c.query("update cad set observacoes_molde='molde B', rev=rev+1 where id=$1", [cadId]);
      // meu save com rev base=1 (desatualizado): .eq rev=1 não casa → 0 linhas
      const r = await c.query("update cad set observacoes_molde='molde C' where id=$1 and rev=1 returning id", [cadId]);
      expect(r.rowCount).toBe(0);
      const atual = await c.query("select observacoes_molde from cad where id=$1", [cadId]);
      expect(atual.rows[0].observacoes_molde).toBe("molde B"); // a edição alheia sobrevive
    });
  });
});
```
(O implementador escreve `seedCadComMolde` seguindo o harness de `tests/integration/`. Se um cad precisa de modelo/colecao pai, reusar seeds existentes.)

- [ ] **Step 2: Run test to verify it fails**

Run: `export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" && npx vitest run tests/integration/oficina-molde-rev.test.ts --no-file-parallelism`
Expected: o teste do banco PASSA (a semântica `.eq rev` já é do Postgres) — este teste fixa o CONTRATO que o front deve usar. Se o helper não existir, falha por isso até ser escrito. (Este teste documenta a regra; a mudança real é no front, Step 3.)

- [ ] **Step 3: Implementação — useColabRegistro na Oficina**

Em `pcp.oficina.$modeloId.tsx`, adicionar (espelho do CQ `expedicao.cq.$modeloId.tsx:758`):
```ts
import { useColabRegistro } from "@/hooks/useColabRegistro";
// ... dentro do componente, após `cad` resolver:
const { presentes } = useColabRegistro({
  canal: cad?.id ? `colab:oficina:${cad.id}` : null,
  tabela: "cad",
  filtroColuna: "id",
  registroId: cad?.id ?? null,
  tabelasExtra: cad?.id ? [{ tabela: "producao_oficina", filtroColuna: "cad_id", valor: cad.id }] : [],
  onMudancaServidor: () => {
    qc.invalidateQueries({ queryKey: ["oficina-cad", modeloId] });
    qc.invalidateQueries({ queryKey: ["producao-oficina", cad?.id] });
    qc.invalidateQueries({ queryKey: ["cad-grades", cad?.id, "full"] });
  },
  campoFocado,  // se a tela já rastreia foco; senão omitir (presença de campo entra na Onda 2)
});
```
⚠️ Se a Oficina re-hidrata o form a cada mudança do servidor, respeitar o dirty (não sobrescrever o que o usuário digitou e não salvou) — seguir o padrão do CQ/`useRevendaPlanejamento` (só re-semeia quando não há edição pendente).

- [ ] **Step 4: Implementação — rev no UPDATE do molde**

No `mutationFn` que grava o molde (~:256), trocar o UPDATE cru por um com `.eq("rev", revBase)` e tratar 0 linhas como P0409:
```ts
const { data: upd, error: cadErr } = await supabase
  .from("cad")
  .update({ observacoes_molde: f.observacoes_molde || null } as any)
  .eq("id", cad.id)
  .eq("rev", revBaseRef.current)   // revBaseRef = rev lido ao carregar o cad
  .select("id");
if (cadErr) throw cadErr;
if (!upd || upd.length === 0) throw erroValidacao("Outra pessoa alterou o molde deste CAD. Recarregue e tente de novo.");
```
Guardar `revBaseRef` ao carregar o `cad` e re-semear no `onMudancaServidor`/após salvar (o `cad.rev` sobe via trigger de colab existente). Mensagem em PT (o AlertDialog/toast da tela).

- [ ] **Step 5: Run test + tsc**

Run: `export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" && npx vitest run tests/integration/oficina-molde-rev.test.ts --no-file-parallelism`
Run: `npx tsc --noEmit 2>&1 | grep -E "oficina|TS2304" | head`
Expected: teste PASS; tsc vazio.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_authenticated/pcp.oficina.$modeloId.tsx tests/integration/oficina-molde-rev.test.ts
git commit -m "feat(realtime): Oficina reflete sem F5 + molde protegido por rev (M2)"
```

---

### Task 2: Parciais — publicar tabelas-filha + estender o mapa de invalidação

**Files:**
- Create: `supabase/migrations/20261208100000_realtime_onda1_publicar_filhas.sql`
- Create: `supabase/rollback/20261208100000_realtime_onda1_publicar_filhas_down.sql`
- Modify: `src/lib/realtime-invalidation-map.ts` (adicionar as tabelas-filha + keys de lista)
- Test: `tests/unit/realtime-invalidation-map.test.ts` (se existir; senão adicionar asserção ao teste do mapa)

**Interfaces:**
- Consumes: a estrutura de `realtime-invalidation-map.ts` (mapa tabela→queryKeys de lista).
- Produces: eventos nessas 5 tabelas passam a invalidar as listas correspondentes.

- [ ] **Step 1: Migration de publicação (idempotente)**

```sql
-- supabase/migrations/20261208100000_realtime_onda1_publicar_filhas.sql
-- Onda 1 do realtime: publica no supabase_realtime as tabelas-filha que ainda faltam, para a
-- invalidação de lista (useRealtimeInvalidation) refletir sem F5. ADITIVO, idempotente.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['producao_oficina','tipos_colaborador','empresa_categorias_fornecedor','empresa_categorias_servico','enderecamento_tecido']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
```
Rollback (`..._down.sql`): `ALTER PUBLICATION supabase_realtime DROP TABLE public.<t>` para cada uma, guardado por `IF EXISTS`.

- [ ] **Step 2: Aplicar na cópia e conferir**

Run: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20261208100000_realtime_onda1_publicar_filhas.sql`
Run: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres -At -c "select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename in ('producao_oficina','tipos_colaborador','empresa_categorias_fornecedor','empresa_categorias_servico','enderecamento_tecido') order by 1"`
Expected: as 5 listadas.

- [ ] **Step 3: Estender o mapa**

Em `src/lib/realtime-invalidation-map.ts`, adicionar as 5 tabelas ao mapa com as queryKeys de LISTA que elas alimentam (ler o arquivo para o formato exato — provavelmente `{ tabela: [keys] }` ou tokens). As keys de lista de cada tela:
- `tipos_colaborador` → a key da lista de tipos em Cadastro › Colaboradores.
- `variantes_etiqueta` → já publicada; adicionar ao mapa se faltar, key da lista de Etiquetas.
- `variantes_aviamento` → idem, Aviamentos.
- `empresa_categorias_fornecedor`/`empresa_categorias_servico` → key da lista/vínculos de Serviço.
- `enderecamento_tecido` → key da lista de estoque/endereçamento.
(O implementador abre cada tela e confirma a queryKey de lista real; o mapa invalida LISTA, não detalhe.)

- [ ] **Step 4: Teste do mapa**

Adicionar/estender teste que assevera que as 5 tabelas estão no mapa com ≥1 key de lista cada. Run: `npx vitest run tests/unit/realtime-invalidation-map.test.ts --no-file-parallelism` (ou o nome real do teste do mapa; criar se não houver).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261208100000_realtime_onda1_publicar_filhas.sql supabase/rollback/20261208100000_realtime_onda1_publicar_filhas_down.sql src/lib/realtime-invalidation-map.ts tests/unit/realtime-invalidation-map.test.ts
git commit -m "feat(realtime): publica 5 tabelas-filha + estende o mapa de invalidacao (parciais sem F5)"
```

---

### Task 3: Residual #2 — merge da árvore do Plan.Tecido com `removidasIds`

**Files:**
- Modify: `src/lib/plan-tecido/colab-merge-arvore.ts` (`mergeArvorePorSlot` aceita e repassa `removidasIds`)
- Modify: o consumidor em `src/components/plan-tecido/` que chama `mergeArvorePorSlot` (passar o set de ids removidos)
- Test: `tests/unit/plan-tecido-merge-removidas.test.ts`

**Interfaces:**
- Consumes: `mergeLinhas({..., removidasIds})` (já aceita o parâmetro — `src/lib/colab/merge.ts:34`).
- Produces: `mergeArvorePorSlot(o: {base, draft, fresh, touchedIds, removidasIds?})` — novo campo opcional.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/plan-tecido-merge-removidas.test.ts
import { describe, it, expect } from "vitest";
import { mergeArvorePorSlot } from "@/lib/plan-tecido/colab-merge-arvore";
// monta base/draft/fresh com um slot S que EU removi (draft sem S) e o servidor NÃO mexeu (fresh tem S igual à base)
it("slot que eu removi e o servidor não mexeu continua removido (não ressuscita)", () => {
  const r = mergeArvorePorSlot({ base, draft, fresh, touchedIds: new Set(), removidasIds: new Set(["slot-S-id"]) });
  const existe = achatar(r.arvore).some((s) => s.id === "slot-S-id");
  expect(existe).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/plan-tecido-merge-removidas.test.ts --no-file-parallelism`
Expected: FAIL — hoje `mergeArvorePorSlot` não aceita `removidasIds`, o slot ressuscita do fresh.

- [ ] **Step 3: Implementação**

Em `mergeArvorePorSlot`, adicionar `removidasIds?: ReadonlySet<string>` ao parâmetro e repassá-lo ao `mergeLinhas` que a função já chama (linha ~38): `mergeLinhas({ base: baseFlat, draft: ..., fresh: freshFlat, touchedIds: o.touchedIds, removidasIds: o.removidasIds })`. A remontagem a partir do `fresh` precisa PULAR os ids em `removidasIds` que o `mergeLinhas` marcou como removidos (não re-inserir no `arvore` final). Seguir a semântica do `mergeLinhas`: removido sem mudança alheia não volta; removido com mudança alheia vira conflito (`conflitos`). No consumidor, passar o set de ids que o usuário removeu na sessão (como as telas de OC fazem com `setItemsTracked`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/plan-tecido-merge-removidas.test.ts --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "colab-merge-arvore|plan-tecido|TS2304" | head
git add src/lib/plan-tecido/colab-merge-arvore.ts src/components/plan-tecido/ tests/unit/plan-tecido-merge-removidas.test.ts
git commit -m "feat(realtime): merge da arvore do Plan.Tecido trata linha removida (removidasIds)"
```

---

### Task 4: Residual #3 — `rolos_planejados` no merge da OC Tecido modo rolo

**Files:**
- Modify: o merge da OC Tecido modo rolo em `src/components/oc-tecido/` (incluir `rolos_planejados` no estado mesclado)
- Test: `tests/unit/oc-tecido-merge-rolos.test.ts`

**Interfaces:**
- Consumes: o merge existente da OC Tecido (`mergeDraft`/`mergeLinhas` + `rolosPorItem`).
- Produces: o plano de rolos de uma pessoa não é sobrescrito pelo Salvar de outra.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/oc-tecido-merge-rolos.test.ts
// Duas pessoas: A planeja rolos no item X; B editou outro campo e salvou. O merge deve PRESERVAR
// os rolos de A (não sobrescrever com o estado de B que não tinha os rolos de A).
it("rolos_planejados de um item não são perdidos no merge concorrente", () => {
  // montar base/draft(meu, com rolos)/fresh(servidor, sem meus rolos) e asseverar que o merge mantém meus rolos
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/oc-tecido-merge-rolos.test.ts --no-file-parallelism`
Expected: FAIL — hoje `rolos_planejados` fica fora do merge e é sobrescrito.

- [ ] **Step 3: Implementação**

Localizar onde a OC Tecido modo rolo monta o estado para o merge (procurar `rolosPorItem`/`rolos_planejados` em `src/components/oc-tecido/`). Incluir `rolos_planejados` no objeto mesclado por item (como os outros campos por-item já entram no `mergeDraft`/`mergeLinhas`), de forma que o rolo que EU planejei e o servidor não mexeu seja preservado. Se for estado por-item, tratar como campo do item no merge de linhas.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/oc-tecido-merge-rolos.test.ts --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "oc-tecido|TS2304" | head
git add src/components/oc-tecido/ tests/unit/oc-tecido-merge-rolos.test.ts
git commit -m "feat(realtime): rolos_planejados entram no merge da OC Tecido modo rolo"
```

---

## Decisões adiadas (Ruling no plano, não bloqueiam)

- **Admin (tenants/users/system_settings/audit_log) no realtime:** FORA da Onda 1 — baixo valor colaborativo (poucas pessoas editam loja/usuário a várias mãos). Vira débito/Onda 2 se o dono pedir. (Ruling: incluir custaria publicar 4 tabelas + mapear keys, sem ganho claro; se errado, custo = essas telas seguem precisando de F5, que é o estado de hoje.)
- **Defesa de servidor "lista efetivamente vazia" das OCs (#5b):** FORA da Onda 1 — a tela SEMPRE manda as chaves do item hoje, então o buraco é só teórico (aba adulterada). Vira débito. (Ruling: se errado, uma aba adulterada poderia apagar itens — mas exige adulteração deliberada; baixo risco real.)

## QA no navegador (:5190, após as 4 tasks)

Duas abas na mesma Oficina (mesmo CAD): editar o molde numa, salvar; a outra atualiza sem F5; editar nas duas e salvar → a 2ª recebe aviso de conflito (não sobrescreve). Telas parciais (Etiquetas/Aviamentos/Colaboradores/Serviço/Endereçamento): editar a tabela-filha numa aba; a lista de outra aba atualiza sem F5. Plan.Tecido: remover um slot numa aba enquanto outra edita; salvar; o slot removido não ressuscita. OC Tecido modo rolo: planejar rolos em 2 abas; nenhuma perde o plano da outra.
