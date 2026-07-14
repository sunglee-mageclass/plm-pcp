# Produto Relacionado (conjunto/vendido junto) — Design

**Data:** 2026-07-14
**Escopo:** relacionar produtos (modelos) num **conjunto** (vendidos juntos), editável no
Planejamento e visível em Produção > Lançamentos.

## Objetivo

Permitir marcar que um grupo de peças forma um **conjunto** (um look/kit vendido junto).
No Planejamento, um setor novo "Produto Relacionado" (abaixo do setor Lançamento) monta o
conjunto. Em Lançamentos, o diálogo do card mostra as outras peças do conjunto em miniatura,
clicáveis para ampliar.

## Decisões (aprovadas no brainstorming)

- **Conjunto = vários** (2+ peças), **simétrico** (todos do conjunto se relacionam entre si), **sem direção**.
- **Cada modelo em no máximo 1 conjunto.**
- **Sem tabela nova e sem nome** — o conjunto é identificado pelas próprias peças (uma coluna `conjunto_id` compartilhada).
- **Conjunto sempre com ≥2 peças**: ao ficar com 1, dissolve sozinho (a peça restante volta a `conjunto_id = null`).
- Ao adicionar uma peça que **já está em outro conjunto**: **move** (sai do antigo, entra neste), com **aviso** antes.
- Escopo: só modelos da **mesma loja** (tenant); **qualquer coleção**.
- **Sem impacto downstream** — é metadado comercial (não mexe em produção/CQ/estoque/financeiro).

## Modelo de dados

Migration aditiva:

```sql
ALTER TABLE public.modelos ADD COLUMN conjunto_id uuid;
CREATE INDEX idx_modelos_conjunto ON public.modelos(conjunto_id) WHERE conjunto_id IS NOT NULL;
```

- `conjunto_id` nullable. Modelos com o **mesmo** `conjunto_id` (não nulo) = mesmo conjunto.
- Sem FK/tabela `conjuntos` (é uma tag de agrupamento). Sem coluna de nome.
- `conjunto_id` NÃO entra no payload de save do draft do modelo (é gerido por RPC própria, ver abaixo) —
  espelha o padrão do "Lançar" (ação imediata, independente do Salvar), pois cada operação também mexe em OUTRO modelo.

## RPCs (atômicas, tenant-scoped, invariante #9)

Ambas `SECURITY DEFINER`, `search_path=public`, `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` +
`GRANT EXECUTE TO authenticated`. Confinam ao tenant do chamador: todo modelo tocado precisa ter
`tenant_id = get_user_tenant_id()`, senão `RAISE`. (Permissão de tela = `criacao_planejamento`,
enforçada na UI; a RPC garante o tenant.)

### `conjunto_adicionar(_modelo_id uuid, _add_id uuid) RETURNS uuid`

1. `RAISE` se `_modelo_id = _add_id`.
2. `RAISE` se qualquer um dos dois não existe ou `tenant_id <> get_user_tenant_id()`.
3. Alvo: se `_modelo_id.conjunto_id IS NULL`, gera `gen_random_uuid()` e grava em `_modelo_id`. Alvo = `_modelo_id.conjunto_id`.
4. Guarda `old_c := _add_id.conjunto_id`.
5. `UPDATE modelos SET conjunto_id = alvo WHERE id = _add_id`.
6. Se `old_c IS NOT NULL AND old_c <> alvo`: dissolve órfão — se `old_c` ficou com **1** membro, zera o `conjunto_id` desse membro.
7. Retorna `alvo`.

### `conjunto_remover(_modelo_id uuid) RETURNS void`

1. `RAISE` se `_modelo_id` não existe ou tenant divergente.
2. `old_c := _modelo_id.conjunto_id`; se null, retorna.
3. `UPDATE modelos SET conjunto_id = NULL WHERE id = _modelo_id`.
4. Se `old_c` ficou com **1** membro, zera o `conjunto_id` desse membro (dissolve).

## Planejamento — setor "Produto Relacionado"

**Onde:** no Sheet do Planejamento (`src/routes/_authenticated/criacao.planejamento.tsx`), como um bloco/setor
**abaixo do setor "Lançamento"**. Componente próprio `ProdutoRelacionadoSetor` (novo, em
`src/components/planejamento/ProdutoRelacionadoSetor.tsx`) recebe `modeloId`, `conjuntoId`, `tenantId`, `readOnly`.

**Lê:** os OUTROS membros do conjunto —
`supabase.from("modelos").select("id, ref, nome, fotos_modelo").eq("conjunto_id", conjuntoId).neq("id", modeloId)`
(só quando `conjuntoId` não é null). queryKey `["conjunto-membros", conjuntoId, modeloId]`.

**Renderiza:**
- Lista dos membros: miniatura (1ª foto do `fotos_modelo`, signed URL do bucket `modelos`) + `ref` + `nome` + botão **Remover** (ícone lixeira).
- Vazio: "Nenhum produto relacionado."
- Botão **Adicionar produto** (escondido se `readOnly`).

**Adicionar (picker):** um Dialog/Popover com input de busca que consulta modelos do tenant por `ref`/`nome`
(`ilike`), excluindo o próprio e os já-membros; mostra ref+nome+miniatura. Ao escolher B:
- Se `B.conjunto_id` não é null → **AlertDialog** de aviso ("Essa peça já está em outro conjunto e será movida para este. Continuar?"). Ao confirmar, segue.
- Chama `rpc conjunto_adicionar(_modelo_id = modeloId, _add_id = B.id)`.
- Sucesso → invalida `["conjunto-membros", ...]` e a lista/detalhe do Planejamento (as queryKeys que leem modelos); toast "Produto relacionado adicionado."

**Remover:** `rpc conjunto_remover(_modelo_id = membroId)` → invalida + toast. (Remover todos os outros dissolve o conjunto do próprio modelo automaticamente pela regra do ≥2.)

**Nota de refetch do conjuntoId:** como `conjunto_adicionar` pode criar o conjunto do próprio modelo, após a
ação é preciso reler o `conjunto_id` do modelo atual (invalidar a query que carrega o modelo no Sheet).

## Lançamentos — faixa no diálogo

**Onde:** `src/routes/_authenticated/producao.lancamentos.tsx`, dentro do `DialogContent` do card
("Fotos por variante"), **abaixo da lista de variantes**.

- Adicionar `conjunto_id` ao `select` da query de cards (e ao tipo do card).
- Nova query (enabled quando o diálogo abre E `card.conjunto_id` não é null):
  `modelos.select("id, ref, fotos_modelo").eq("conjunto_id", card.conjunto_id).neq("id", card.modelo_id)`.
- Seção **"Produto relacionado"**: miniaturas (foto[0], signed URL bucket `modelos`) + `ref` embaixo. Some se vazio/sem conjunto.
- Clicar numa miniatura **amplia** a imagem — reusar `src/components/shared/ImagePreview.tsx` (lightbox já existente;
  cuidado com o bug de portal já resolvido lá).

## Casos de borda

- **Auto-relacionar (A=B):** bloqueado na RPC + o picker exclui o próprio.
- **Peça em outro conjunto:** move com aviso (AlertDialog no cliente + a RPC dissolve o órfão de 1).
- **Conjunto de 1:** nunca persiste — dissolvido pelas RPCs.
- **Cross-tenant:** RPC recusa (`tenant_id <> get_user_tenant_id()` → RAISE); o picker só busca no tenant (RLS).
- **Sem foto:** miniatura mostra placeholder "Sem foto" (mesmo padrão dos cards).
- **Excluir um modelo do conjunto (fora desta feature):** `conjunto_id` é só uma tag; se um membro é
  apagado, o conjunto pode ficar com 1 — aceitável (a próxima edição/leitura não quebra; opcional: gatilho
  de limpeza, fora do escopo).

## Segurança

- RPCs `DEFINER` com REVOKE #9 + tenant enforce.
- Leitura dos membros passa pela RLS de `modelos` (tenant) — sem vazamento cross-tenant.
- Sem colunas sensíveis expostas (ref/nome/foto são dados do próprio tenant).

## Testes

- **Integração (txn revertida)** das RPCs:
  - criar conjunto (A+B): ambos com o mesmo `conjunto_id`.
  - adicionar C: os 3 juntos.
  - mover B (que estava em {A,B}) para {D}: {A} dissolve (A.conjunto_id null), B fica com D.
  - remover até sobrar 1: dissolve.
  - cross-tenant: RAISE.
  - auto (A=B): RAISE.
  - invariante: nenhum `conjunto_id` com exatamente 1 membro após as operações.
- **Front:** tsc/build; screenshot do setor no Planejamento e da faixa no diálogo de Lançamentos.

## Fora de escopo (YAGNI)

- Nomear o conjunto.
- Um modelo em vários conjuntos.
- Selo/badge de conjunto no card da LISTA de Lançamentos (só no diálogo).
- Agrupar visualmente os cards do conjunto na lista.
- Mostrar o conjunto em outras telas (Dashboard, Financeiro, Romaneio).
- Ordem/“peça principal” dentro do conjunto.
