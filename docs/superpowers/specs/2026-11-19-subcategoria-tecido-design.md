# Subcategoria de tecido — Design

**Data:** 2026-11-19
**Frente:** Subcategoria de tecido (demanda 6 do dono, 19/nov)
**Branch:** `feature/plan-tecido-a1`
**Tipo:** arquitetural — **TEM BANCO** (tabela nova + coluna + FK + RLS); deploy PRÓPRIO, separado do lote front.

---

## Entendimento (intenção do dono, confirmada no brainstorm 19/nov)

Criar **subcategoria de tecido** (hoje só existe categoria de tecido). Hierárquica: cada
subcategoria pertence a uma categoria de tecido — exatamente como já existe para **aviamento**
(`subcategorias_aviamento`, filtrada por `categoria_aviamento_id`) e **produto**
(`subcategorias1_produto`, filtrada por `categoria_id`). Esta frente REPLICA esse padrão existente.

**Decisões do dono:**
1. **Hierárquica:** subcategoria pertence a uma categoria de tecido (FK → `categorias_tecido`).
2. **Uma subcategoria por categoria escolhida:** o tecido (artigo) pode ter VÁRIAS categorias de
   tecido (N:N via `artigo_categorias_tecido`, editadas como checkboxes no Sheet do tecido). Para
   CADA categoria marcada, o usuário escolhe UMA subcategoria daquela categoria. A subcategoria
   escolhida mora no par (tecido, categoria) — ou seja, numa coluna nova em
   `artigo_categorias_tecido`.
3. **Cadastro em Cadastro > Atributos, aninhado à categoria** — como a subcategoria de aviamento
   já é (um atributo novo que filtra pela categoria de tecido).
4. **No Sheet do tecido:** ao lado de cada categoria MARCADA, aparece um select de subcategoria com
   as subs daquela categoria; grava no salvar.
5. **No Desenvolvimento e na Ficha Técnica: só EXIBIDA** (leitura) — a sub é definida no cadastro do
   tecido; Dev/Ficha mostram a sub junto da categoria, sem editar.

**Sucesso:** cadastra-se subcategorias dentro de cada categoria de tecido; ao cadastrar um tecido,
escolhe-se a subcategoria de cada categoria dele; a subcategoria aparece no Dev e na Ficha.

## Fatos técnicos apurados (molde já existente — NÃO reinventar)

- **`categorias_tecido`** (tabela, criada em `20260611162249`): id, tenant_id, nome. RLS tenant.
- **`artigo_categorias_tecido`** (N:N tecido↔categoria, `20260612170256`): `artigo_id`,
  `categoria_tecido_id` (FK, ON DELETE CASCADE), tenant_id, RLS tenant (select/insert/update/delete),
  índice por tenant. É o que o Sheet do tecido edita (`catIds: string[]`).
- **Molde a copiar — subcategoria de AVIAMENTO:** `subcategorias_aviamento` (FK
  `categoria_aviamento_id`), cadastrada em `cadastro.atributos.tsx` como atributo `sub_aviamento`
  (`usage: aviamentos.subcategoria_aviamento_id`). A subcategoria de produto (`subcategorias1_produto`,
  FK `categoria_id`, `set_tenant_id_trg`, índices) é o 2º precedente.
- **Cadastro de atributos** (`cadastro.atributos.tsx`) tem o `cat_tecido` (atributo simples da
  categoria de tecido) e já renderiza subcategorias (de produto/aviamento) filtradas pela categoria.
- **Sheet do tecido** (`cadastro.tecidos.$artigoId.tsx`): `catIds: string[]` por checkbox; lê/grava
  via `artigo_categorias_tecido` (`set_artigo_categorias` atômico — invariante do projeto).

## Modelagem (banco)

**Migration nova** (segue o molde de `subcategorias_aviamento`):
1. **Tabela `subcategorias_tecido`:** `id uuid pk`, `tenant_id uuid not null`, `nome text not null`,
   `categoria_tecido_id uuid not null references categorias_tecido(id) on delete cascade`,
   `ativo boolean not null default true`, `created_at`. `set_tenant_id_trg` before insert. RLS
   tenant (select/insert/update/delete por `tenant_id = get_user_tenant_id()`). Índices:
   `(tenant_id)`, `(categoria_tecido_id)`. GRANT como as outras tabelas de atributo.
2. **Coluna `artigo_categorias_tecido.subcategoria_tecido_id uuid` (nullable), FK →
   `subcategorias_tecido(id)` ON DELETE SET NULL** (apagar a subcategoria não apaga o vínculo
   tecido↔categoria; só zera a sub). Índice parcial `WHERE subcategoria_tecido_id IS NOT NULL`.
   - ⚠️ A sub escolhida deve pertencer à MESMA categoria do par: a UI garante (o select só lista as
     subs da categoria daquela linha); no banco, um gatilho BEFORE INSERT/UPDATE valida que
     `subcategoria_tecido_id`, se não-nula, tem `categoria_tecido_id` = o `categoria_tecido_id` da
     linha (senão P0001 PT) — evita sub de outra categoria por API.
3. **Sem backfill** (ninguém tem sub ainda; nasce tudo null).

**Escrita:** o `set_artigo_categorias` (RPC atômica que grava os pares tecido↔categoria) passa a
aceitar a sub por par. Se hoje recebe `categoria_tecido_id[]`, passa a receber
`[{categoria_tecido_id, subcategoria_tecido_id|null}]` — confirmar a assinatura atual e estender
preservando a atomicidade (diff-validar `pg_get_functiondef` antes/depois).

## UI

**Cadastro > Atributos (`cadastro.atributos.tsx`):** adicionar o atributo `sub_tecido` (molde do
`sub_aviamento`): `table: "subcategorias_tecido"`, filtrado por `categoria_tecido_id`, `usage:
[{ table: "artigo_categorias_tecido", column: "subcategoria_tecido_id" }]`. Aninhado à categoria de
tecido, como a sub de aviamento/produto já é. Checagem de uso (não excluir sub em uso) sai de graça
pelo padrão `usage`.

**Sheet do tecido (`cadastro.tecidos.$artigoId.tsx`):** ao lado/abaixo de cada categoria MARCADA
(checkbox em `catIds`), um `Select` da subcategoria (opções = `subcategorias_tecido` daquela
categoria + "nenhuma"). O estado passa de `catIds: string[]` para também guardar a sub por categoria
(ex.: `subPorCat: Record<categoriaId, subId|null>`); o save manda os pares ao
`set_artigo_categorias` estendido. Marcar/desmarcar a categoria mostra/esconde o select da sub;
desmarcar limpa a sub daquela categoria. Categoria sem subcategorias cadastradas → o select some ou
mostra "sem subcategorias".

**Desenvolvimento e Ficha Técnica (só leitura):** onde a categoria do tecido é exibida hoje (o
rótulo do tecido/variante na ficha), mostrar também a subcategoria (ex.: "Categoria › Subcategoria").
Confirmar o(s) ponto(s) exato(s) de exibição no plano (a Ficha imprime de `useFichaTecnica`/BOM; o
Dev mostra o tecido escolhido). Nenhuma edição — só exibição do que o cadastro definiu.

## Restrições globais
- **Banco ANTES do site** (site novo + banco velho = coluna/tabela inexistente). Deploy PRÓPRIO.
- RLS tenant em tudo (molde do aviamento). `set_tenant_id_trg`. GRANT como as outras tabelas de atributo.
- A sub só pode ser de categoria que o tecido TEM e da MESMA categoria do par (gatilho valida).
- Reusa o padrão `usage` do cadastro de atributos (checagem de exclusão em uso automática).
- RAISE 5xx só ASCII (regra do projeto); mensagens PT traduzidas no front.
- `set_artigo_categorias` estendido de forma atômica + diff-validado.

## Review Focus
- **Sub de categoria que o tecido NÃO tem** (ou de outra categoria): o gatilho recusa; a UI nunca oferece. Testar.
- **Desmarcar a categoria no Sheet:** a sub daquela categoria é limpa (não fica órfã). Testar.
- **Excluir uma subcategoria em uso:** bloqueado pelo `usage` (como as outras). Testar.
- **Categoria sem nenhuma subcategoria:** o select da sub some/"sem subcategorias"; salvar não quebra. Testar.
- **Apagar a categoria de tecido:** cascateia o par (já é ON DELETE CASCADE na N:N); a sub da linha vai junto. Confirmar.

## Arquivos (previstos)
- **Banco:** 1 migration nova (`subcategorias_tecido` + coluna em `artigo_categorias_tecido` + gatilho de validação + `set_artigo_categorias` estendido) + inverso em `supabase/rollback/`.
- **UI:** `cadastro.atributos.tsx` (atributo `sub_tecido`), `cadastro.tecidos.$artigoId.tsx` (select da sub por categoria), e os pontos de exibição no Dev/Ficha (a confirmar no plano).
- **Testes:** integração (txn revertida) do `set_artigo_categorias` estendido + do gatilho de validação; unit do estado `subPorCat` no Sheet.

## Riscos
1. **`set_artigo_categorias` quebrar a atomicidade** ao estender — mitigado: diff-validar, manter a
   transação única, testes de integração.
2. **Sub órfã de categoria** (sub de categoria que o tecido perdeu) — mitigado: gatilho de validação
   + limpar a sub ao desmarcar a categoria na UI.
3. **Exibição no Dev/Ficha em ponto errado** — mitigado: confirmar os pontos reais no plano (mapear
   onde a categoria do tecido já aparece hoje e pôr a sub ao lado).
4. **Loja só-estoque / módulos** — seguir o gate das outras subcategorias (a de produto tem
   `!isStockOnly` no cadastro de atributos; replicar o comportamento coerente).
