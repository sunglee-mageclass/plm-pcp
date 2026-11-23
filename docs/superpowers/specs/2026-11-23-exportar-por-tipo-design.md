# Exportar dados por TIPO — Design

**Data:** 2026-11-23
**Frente:** "Exportar dados por TIPO" (demanda 5 do dono, brainstorm 23/nov) — adicionar TECIDO,
AVIAMENTO e INSUMO ao "Exportar dados" (hoje só produto), replicando o padrão do export de produto.
**Branch:** `feature/plan-tecido-a1` (mesmo da sidebar/Integração)
**Tipo:** arquitetural — **TEM BANCO** (3 RPCs novas + `_core` + REVOKE dos 3; leitura apenas, sem
tabela/coluna nova); deploy PRÓPRIO (banco ANTES do site).

Contexto completo do brainstorm (decisões travadas + fatos técnicos): `.superpowers/sdd/2026-11-23-exportar-por-tipo/decisoes-dono.md`.

---

## Entendimento (intenção do dono, decisões travadas 23/nov)

Hoje a tela "Exportar dados" (`src/components/exportar/ExportarDados.tsx`, rota
`/exportar-dados`, permissão própria `exportar_dados`) exporta **só produto**: recorte por
coleção/subcoleção, níveis SKU pai / até cor / até tamanho, catálogo `campos-export.ts`,
prévia (20 produtos) + baixar CSV/Excel, pela RPC `exportar_produtos`. O dono quer um **seletor
de TIPO** na mesma tela para também exportar TECIDO, AVIAMENTO e INSUMO, cada um com suas
colunas e filtro próprios, replicando a forma do export de produto.

**Decisões travadas (do dono — NÃO reabrir):**
1. **Seletor de TIPO na MESMA tela** (produto / tecido / aviamento / insumo). Trocar o tipo troca
   os filtros + as colunas daquele tipo. Produto continua como está hoje.
2. **Filtro por atributo de cada tipo**, com opção "todos" (como o "Todas as coleções" do produto):
   - TECIDO: por **categoria N:N** (`artigo_categorias_tecido`) — pega o tecido que TEM aquela
     categoria (não só a principal). Casa com multi-categoria e a subcategoria de tecido nova.
   - AVIAMENTO: por `categoria_aviamento_id` OU `material_aviamento_id` (FK direto no cabeçalho).
   - INSUMO: por `tipo_insumo_id` (`tipos_insumo`).
3. **Níveis como o produto** onde há variante (cabeçalho / até variante):
   - TECIDO: variante = cor base + apelido (`variantes_tecido`).
   - AVIAMENTO: variante = cor base + apelido (`variantes_aviamento`).
   - INSUMO: variante = cor × tamanho (`variantes_etiqueta`; SEM apelido). "Até variante" no insumo
     já carrega o tamanho.
4. **Colunas do TECIDO incluem categoria(s) + subcategoria de tecido** (aproveita a feature de
   19/nov), além de nome/composição/NCM/preço/rendimento/unidade/largura/fornecedor/mês-ano/cor.
5. **Gate:** as 3 RPCs novas reusam o MESMO portão da tela de exportação (ver "Fatos técnicos ›
   Gate"); REVOKE dos 3 no `_core`; multi-tenant via wrapper que lê a loja e passa `_tenant` ao
   `_core` (como `exportar_produtos`).
6. **Molde = `exportar_produtos` (`20261122100000`):** mesma forma de resposta (`jsonb
   {colunas, total, niveis}`), mesma prévia (`_limite`), os mesmos erros `P0001` ASCII, reaproveitar
   `export.ts` (`baixarExport`) e a estrutura da tela.

**Sucesso:** na mesma tela "Exportar dados", escolhe-se TIPO; para tecido/aviamento/insumo
escolhe-se o filtro do tipo (categoria / categoria-ou-material / tipo de insumo, ou "todos"),
colunas e níveis; prévia mostra 20 itens; "Baixar" gera CSV (1 nível) ou Excel (1 aba por nível),
pela MESMA infra de arquivo que o produto já usa.

## Fatos técnicos apurados (molde + o mapa dos 3 tipos — usar os nomes REAIS)

### Molde (produto) — NÃO reinventar
- **RPCs** (`supabase/migrations/20261122100000_exportar_dados.sql`):
  `public._exportar_produtos_core(_tenant, _colecao, _subcolecao, _campos, _niveis, _limite) -> jsonb`
  (DEFINER, `STABLE`, `SET search_path TO 'public'`; **EXECUTE revogado de PUBLIC/anon/authenticated**,
  GRANT só service_role) e o wrapper `public.exportar_produtos(_colecao, _subcolecao, _campos,
  _niveis, _limite DEFAULT NULL)` (DEFINER; lê a loja pelo portão e chama o `_core`). Mais a
  `exportar_subcolecoes(_colecao)` para as opções do 2º filtro.
- **Forma da resposta:** `jsonb_build_object('colunas', <array ordenado/deduplicado>, 'total',
  <nº de itens do recorte INTEIRO>, 'niveis', {'1':[...],'2':[...],'3':[...]})`. Cada linha é um
  objeto `chave -> valor`; números saem como número JSON, `<= 0`/vazio = `null`. A ORDEM das colunas
  vem de `colunas` (jsonb não preserva ordem de chaves) — o front monta a matriz por `colunas`.
- **Prévia:** `_limite` limita o nº de ITENS do nível-pai (o item e seus filhos vêm completos);
  `total` é sempre o recorte inteiro (antes do limite). `NULL` = tudo (o "Baixar" manda `null`).
- **Erros** (`P0001`, ASCII; a tela traduz): `exportar_sem_loja`, `exportar_campos_vazio`,
  `exportar_campo_invalido: <chave>`, `exportar_niveis_vazio`, `exportar_nivel_invalido: <valor>`,
  `exportar_limite_invalido`. Login/permissão pelo portão (42501).
- **Front:** catálogo `src/lib/integracao/campos-export.ts` (`{key, rotulo, soVariante}`, a ordem do
  array = ordem das colunas); geração de arquivo `src/lib/integracao/export.ts`
  (`montarMatriz` puro + `baixarExport`; CSV com 1 nível, Excel 1 aba/nível, escapa fórmula de
  célula). Tela `ExportarDados.tsx`: persistência `useUserPref("export", "integracao", <chave>,
  string[])`; filtro "Todas as coleções" como escolha explícita (sentinela), 3 estados (nada
  escolhido / todas / específica); prévia do MENOR nível marcado.

### Gate (estado REAL hoje — ⚠️ diverge do texto do brainstorm)
O brainstorm diz "reusar `_integracao_exige`". **Mas o export de produto NÃO usa mais
`_integracao_exige`**: a migration `20261201130000_exportar_dados_permissao.sql` trocou os dois
wrappers para o portão PRÓPRIO `public._exportar_exige()` — login (42501) + loja ativa (42501) +
`_exportar_pode()` (= `is_super_admin()` OU a linha `exportar_dados` `pode_ver` em
`_perm_efetiva(auth.uid())`; SEM atalho de `tenant_admin`, como a Integração). As 3 RPCs novas
**reusam `_exportar_exige()`** (o portão que o `exportar_produtos` usa HOJE). Decisão de arquiteto
D-1 abaixo (o intento do dono — "mesmo portão do export de produto" — fica honrado; só o nome mudou).

### TECIDO — `public.artigos` (+ `variantes_tecido`)
- Cabeçalho: `nome` (varchar), `unidade_medida`, `composicao`, `rendimento`, `ncm`, `preco`,
  `preco_por_metro`, `largura_estimada`, `empresa_id`/`representante_id` (fornecedor), `mes_id`/`ano_id`,
  `categoria_tecido_id` (principal — single). `artigoLabel()` = `nome [unidade]`.
- Categoria: **N:N** em `artigo_categorias_tecido` (`artigo_id`, `categoria_tecido_id`,
  `subcategoria_tecido_id` por par) + a principal single (`artigos.categoria_tecido_id`). Lookups:
  `categorias_tecido(nome)`, `subcategorias_tecido(nome, categoria_tecido_id)`.
- Variante: `variantes_tecido` (`cor_id`, `cor_apelido_id`, `codigo_variante`). `cores(nome, sigla_sku)`,
  `cores_apelido(nome, sigla_sku)`.
- Fornecedor: `empresas.nome_fantasia` (+ opcional `representantes.nome`), via `empresa_id`/`representante_id`.
- Mês/Ano: `meses.mes`, `anos.ano`.

### AVIAMENTO — `public.aviamentos` (+ `variantes_aviamento`)
- ⚠️ **O "Nome" do aviamento é `codigo_nome`, NÃO existe coluna `nome`.** Demais: `codigo` (auto),
  `ncm`, `composicao`, `preco`, `cor_id`/`cor_apelido_id` (cabeçalho), `categoria_aviamento_id`,
  `subcategoria_aviamento_id`, `material_aviamento_id`, `empresa_id`/`representante_id`.
- Lookups: `categorias_aviamento(nome)`, `subcategorias_aviamento(nome, categoria_aviamento_id)`,
  `materiais_aviamento(nome)`.
- Variante: `variantes_aviamento` (`cor_id`, `cor_apelido_id`, `codigo_variante`, `preco`).

### INSUMO — `public.etiquetas` (+ `variantes_etiqueta`)
- Cabeçalho: `nome` (varchar), `unidade`, `preco`, `tipo_insumo_id`, `formato_tamanho`,
  `tamanho_vinculado`, `empresa_id`/`representante_id`, `observacoes`.
- Lookup: `tipos_insumo(nome)`.
- Variante: `variantes_etiqueta` (`tamanho`, `cor_id` **SEM apelido**, `preco`). `cores(nome)`.

### Multi-tenant
`artigos`/`aviamentos`/`etiquetas` + as 3 tabelas de variante têm `tenant_id` + RLS tenant. O `_core`
recebe `_tenant` por parâmetro e por isso NÃO é chamável pelo cliente (REVOKE dos três); todo lookup
(cor/categoria/sub/material/fornecedor/mês/ano) é filtrado pela MESMA loja do item (espelho de como o
`_exportar_produtos_core` filtra taxonomia pela loja do modelo), para não vazar nome de outra loja via id solto.

---

## Modelagem (banco)

### D-2 — Um `_core` + wrapper por TIPO (3 pares novos)

Seguindo o molde, UM `_core` DEFINER por tipo (recebe `_tenant`, filtro, `_campos`, `_niveis`,
`_limite`) + UM wrapper DEFINER (lê a loja pelo portão, chama o `_core`). Nomes e assinaturas:

| Tipo | wrapper (cliente chama) | `_core` (REVOKE dos 3) |
|---|---|---|
| Tecido | `exportar_tecidos(_categoria text, _campos text[], _niveis text[], _limite int DEFAULT NULL)` | `_exportar_tecidos_core(_tenant uuid, _categoria text, _campos text[], _niveis text[], _limite int)` |
| Aviamento | `exportar_aviamentos(_categoria text, _material text, _campos text[], _niveis text[], _limite int DEFAULT NULL)` | `_exportar_aviamentos_core(_tenant uuid, _categoria text, _material text, _campos text[], _niveis text[], _limite int)` |
| Insumo | `exportar_insumos(_tipo_insumo text, _campos text[], _niveis text[], _limite int DEFAULT NULL)` | `_exportar_insumos_core(_tenant uuid, _tipo_insumo text, _campos text[], _niveis text[], _limite int)` |

Decisões de assinatura (arquiteto):
- **Tecido:** UM parâmetro de filtro `_categoria text` (id da categoria como texto, ou `NULL`/vazio =
  todas). N:N → o recorte é `EXISTS (artigo_categorias_tecido act WHERE act.artigo_id = a.id AND
  act.categoria_tecido_id = _categoria::uuid)`. **`_categoria` vale um id, não um nome** (o seletor
  da tela carrega as categorias da loja e manda o id; texto não-uuid = `exportar_filtro_invalido`).
- **Aviamento (decisão do dono 23/nov):** DOIS filtros INDEPENDENTES — `_categoria text` e
  `_material text` (cada um id de categoria/material ou NULL/vazio = "todos" naquele eixo). A tela
  mostra DOIS dropdowns (Categoria e Material), cada um opcional. **Combinação = E (AND):** o recorte
  é `(_categoria vazio OR aviamentos.categoria_aviamento_id = _categoria::uuid) AND (_material vazio OR
  aviamentos.material_aviamento_id = _material::uuid)`. Cada id não-uuid/não-da-loja (quando não vazio)
  = `exportar_filtro_invalido`. (O `_filtro_tipo` único foi DESCARTADO pelo dono — ele quer os dois
  eixos ao mesmo tempo.)
- **Insumo:** UM parâmetro `_tipo_insumo text` (id de `tipos_insumo`, NULL/vazio = todos).
- **Resposta IDÊNTICA ao produto:** `{colunas, total, niveis}`, mesma montagem `v_l1/v_l2` por
  `unnest(v_ids) WITH ORDINALITY`, mesma prévia `_limite` (limita ITENS, filhos completos), mesmo
  conjunto de erros `P0001` ASCII — **com acréscimo de um erro novo** `exportar_filtro_invalido`
  (quando o id de filtro não é uuid válido/não é da loja)
  Os erros `exportar_sem_loja`/`_campos_vazio`/
  `_campo_invalido`/`_niveis_vazio`/`_nivel_invalido`/`_limite_invalido` são reaproveitados tal qual.
- **Níveis dos 3 tipos = SÓ `'1'` e `'2'`** (cabeçalho / até variante). `'3'` não existe para
  tecido/aviamento/insumo (não há a hierarquia cor→tamanho com SKU do produto). O `_core` valida
  `_niveis ⊆ {'1','2'}` (`'3'` → `exportar_nivel_invalido: 3`). **Insumo nível 2 já carrega o
  tamanho** na mesma linha da variante (cor × tamanho = uma linha), então não precisa de nível 3.
- **ORDER BY** estável por tipo: tecido/insumo por `nome, id`; aviamento por `codigo_nome, id`.
  `total` = `count(*)` do recorte; `v_ids` = o recorte com `LIMIT _limite`.
- **Dedup N:N (tecido):** o filtro por `EXISTS` (não por `JOIN`) garante **1 linha por tecido** mesmo
  que ele tenha a categoria em mais de um par (ver Review Focus 2). A coluna de categoria(s) é montada
  por subconsulta agregada (ver Review Focus 5), não pelo join do filtro.

Cada `_core`: `SECURITY DEFINER`, `SET search_path TO 'public'`, `STABLE`, leitura apenas. Pós-condições
de ACL iguais às do molde (o `_core` não executável por anon/authenticated; o wrapper não por anon).
`GRANT EXECUTE ... TO authenticated, service_role` nos 3 wrappers; `... TO service_role` nos 3 `_core`.

### Catálogos de colunas por tipo

**D-3 — Catálogo POR TIPO (3 arquivos novos), não um discriminador em `campos-export.ts`.**
Justificativa: os conjuntos de colunas são disjuntos (um `discriminador` obrigaria cada `CampoExport`
a declarar a que tipos pertence e a tela/`export.ts` a filtrar por tipo em todo lugar); as colunas
`soVariante` têm semântica diferente por tipo (cor+apelido no tecido/aviamento, cor+tamanho no
insumo); e o `campos-export.ts` atual é explicitamente "shape próprio do produto". Três catálogos
pequenos, mesmo shape `CampoExport = {key, rotulo, soVariante}`, cada um com seu `BY_KEY`/`KEYS_VALIDAS`/
`ordenar…` (ou um pequeno helper genérico que recebe o array). `export.ts` passa a receber o mapa de
rótulos do tipo ativo (hoje importa `CAMPO_EXPORT_BY_KEY`/`KEYS_VALIDAS` fixos — refatorar para receber
por parâmetro, sem mudar `montarMatriz`/`baixarExport` no essencial). **Ordem do array = ordem das
colunas no arquivo.** O servidor valida as chaves contra o catálogo do tipo (lista `v_catalogo` em cada
`_core`) — o TS e o SQL têm de listar as MESMAS chaves (anti-drift recomendado, espelho do padrão
`sku-casos.ts`/`campos-i3`).

Arquivos: `src/lib/exportar/campos-export-tecido.ts`, `…-aviamento.ts`, `…-insumo.ts` (ou um só
`src/lib/exportar/campos-por-tipo.ts` exportando os 3 arrays + um `catalogoDoTipo(tipo)`). O catálogo
do produto continua em `src/lib/integracao/campos-export.ts` (intocado).

**TECIDO** (`v_catalogo` do `_exportar_tecidos_core`):

| key | rótulo | soVariante | fonte |
|---|---|---|---|
| `nome` | Nome | não | `artigos.nome` |
| `unidade` | Unidade | não | `artigos.unidade_medida` |
| `composicao` | Composição | não | `artigos.composicao` |
| `rendimento` | Rendimento | não | `artigos.rendimento` |
| `ncm` | NCM | não | `artigos.ncm` |
| `preco` | Preço | não | `artigos.preco` |
| `preco_por_metro` | Preço por metro | não | `artigos.preco_por_metro` |
| `largura` | Largura estimada | não | `artigos.largura_estimada` |
| `fornecedor` | Fornecedor | não | `empresas.nome_fantasia` [+ `representantes.nome`] |
| `mes` | Mês | não | `meses.mes` |
| `ano` | Ano | não | `anos.ano` |
| `categorias` | Categoria(s) | não | `artigo_categorias_tecido` → `categorias_tecido.nome` (agregado; ver RF-5) |
| `subcategoria_tecido` | Subcategoria de tecido | não | `artigo_categorias_tecido.subcategoria_tecido_id` → `subcategorias_tecido.nome` (agregado) |
| `cor_base` | Cor base | **sim** | `variantes_tecido.cor_id` → `cores.nome` |
| `cor_apelido` | Cor apelido | **sim** | `variantes_tecido.cor_apelido_id` → `cores_apelido.nome` |
| `codigo_variante` | Código da variante | **sim** | `variantes_tecido.codigo_variante` |

**AVIAMENTO** (`v_catalogo` do `_exportar_aviamentos_core`):

| key | rótulo | soVariante | fonte |
|---|---|---|---|
| `nome` | Nome | não | `aviamentos.codigo_nome` ⚠️ (NÃO `nome`) |
| `codigo` | Código | não | `aviamentos.codigo` |
| `ncm` | NCM | não | `aviamentos.ncm` |
| `composicao` | Composição | não | `aviamentos.composicao` |
| `preco` | Preço | não | `aviamentos.preco` |
| `categoria` | Categoria | não | `categorias_aviamento.nome` |
| `subcategoria` | Subcategoria | não | `subcategorias_aviamento.nome` |
| `material` | Material | não | `materiais_aviamento.nome` |
| `fornecedor` | Fornecedor | não | `empresas.nome_fantasia` [+ `representantes.nome`] |
| `cor_base_cab` | Cor base (cabeçalho) | não | `aviamentos.cor_id` → `cores.nome` |
| `cor_apelido_cab` | Cor apelido (cabeçalho) | não | `aviamentos.cor_apelido_id` → `cores_apelido.nome` |
| `cor_base` | Cor base | **sim** | `variantes_aviamento.cor_id` → `cores.nome` |
| `cor_apelido` | Cor apelido | **sim** | `variantes_aviamento.cor_apelido_id` → `cores_apelido.nome` |
| `codigo_variante` | Código da variante | **sim** | `variantes_aviamento.codigo_variante` |
| `preco_variante` | Preço da variante | **sim** | `variantes_aviamento.preco` |

**INSUMO** (`v_catalogo` do `_exportar_insumos_core`):

| key | rótulo | soVariante | fonte |
|---|---|---|---|
| `nome` | Nome | não | `etiquetas.nome` |
| `unidade` | Unidade | não | `etiquetas.unidade` |
| `tipo_insumo` | Tipo de insumo | não | `tipos_insumo.nome` |
| `formato_tamanho` | Formato de tamanho | não | `etiquetas.formato_tamanho` |
| `preco` | Preço | não | `etiquetas.preco` |
| `fornecedor` | Fornecedor | não | `empresas.nome_fantasia` [+ `representantes.nome`] |
| `observacoes` | Observações | não | `etiquetas.observacoes` |
| `cor` | Cor | **sim** | `variantes_etiqueta.cor_id` → `cores.nome` (SEM apelido) |
| `tamanho` | Tamanho | **sim** | `variantes_etiqueta.tamanho` |
| `preco_variante` | Preço da variante | **sim** | `variantes_etiqueta.preco` |

Observações de montagem (espelham o molde):
- A linha-pai traz todos os campos pedidos **que não são `soVariante`**; os `soVariante` ficam `null` na
  linha-pai e só têm valor nas linhas de variante (nível 2). Em cada linha de variante os campos não-variante
  **herdam** o valor do pai (como o produto).
- Fornecedor é um texto só: `nome_fantasia` e, se houver `representante_id`, `" — " || representante.nome`
  (ASCII " - " no SQL para não cair na armadilha do 5xx acentuado; o travessão fica para o rótulo/UI).
  Alinhar com o `FornecedorSelect` existente é desejável, mas o export é só leitura de texto.
- Insumo sem nenhuma variante (`formato_tamanho='nenhum'` / sem linha em `variantes_etiqueta`) sai só com
  o pai no nível 2 (como o produto sem variante).

### Como TIPO + filtro persistem

**D-4 — `useUserPref` scope `"export"`, chaves por tipo.** Hoje o produto usa
`useUserPref("export", "integracao", <colecao|subcolecao|colunas|niveis>, [])`. Acrescentar:
- `useUserPref("export", "tipo", "tipo", [])` — o TIPO ativo (array de 1: `["produto"]` default).
- Por tipo, chaves próprias para não colidir com o produto:
  - tecido: `("export","tecido","categoria",[])`, `("export","tecido","colunas",[])`, `("export","tecido","niveis",[])`.
  - aviamento: `("export","aviamento","categoria",[])`, `("export","aviamento","material",[])`, `…"colunas"`, `…"niveis"`.
  - insumo: `("export","insumo","tipo_insumo",[])`, `…"colunas"`, `…"niveis"`.
  Tudo `string[]` (como o produto: coleção = array de 1, colunas/níveis = arrays). "Todos" = sentinela
  explícita (espelho do `TODAS_COLECOES`): `"__todos__"` guardado no pref do filtro; vazio = nada escolhido
  (prévia não consulta), nunca "todos". Ao ler, a seleção só vale se o id ainda existir na lista carregada
  (mesma regra que o produto aplica à coleção).

### Níveis por tipo (nomenclatura)

- **Produto:** mantém os 3 — "SKU pai" / "Até cor" / "Até tamanho".
- **Tecido / Aviamento:** 2 níveis — **"1. Cabeçalho"** (1 linha por item) e **"2. Até variante"**
  (o cabeçalho + 1 linha por variante cor base+apelido).
- **Insumo:** 2 níveis — **"1. Cabeçalho"** e **"2. Até variante (cor × tamanho)"** (o cabeçalho + 1
  linha por variante cor×tamanho). O rótulo da aba no Excel segue o do nível (`export.ts` ganha mapa
  de nome-de-aba por tipo, ou recebe `{"1":"Cabeçalho","2":"Até variante"}` do chamador).

## UI

**Mesma tela `ExportarDados.tsx`**, com um **seletor de TIPO no topo** (antes do recorte): um
`Select`/segmented de 4 valores (produto / tecido / aviamento / insumo). Trocar o tipo:
- troca o bloco de **filtro** (produto = coleção+subcoleção; tecido = Categoria; aviamento =
  dois dropdowns Categoria e Material (ambos opcionais, combinam com E); insumo = Tipo de insumo), cada um com a opção "Todos";
- troca o **catálogo de colunas** (checkboxes por tipo, com o sub-bloco "Campos de variante" igual ao
  produto — os `soVariante` ficam vazios no cabeçalho);
- troca os **níveis** (produto = 3; demais = 2) e os rótulos;
- troca a **prévia** (chama a RPC do tipo) e o **Baixar** (RPC do tipo, `_limite=null`, `baixarExport`).

Para não inchar o componente, extrair a parte comum (colunas/níveis/prévia/baixar) e manter 4 "drivers"
de recorte (um por tipo) que fornecem: o(s) seletor(es) de filtro, a função `chamarRpc(filtro, campos,
niveis, limite)`, o catálogo, os níveis e o nome-base do arquivo. O produto fica byte-a-byte como hoje
(só movido para dentro do driver "produto"). Opções dos filtros via queries próprias:
`exportar_opcoes_tecido` não é necessária — as categorias/materiais/tipos de insumo já têm listas lidas
pelo Cadastro; reusar essas queries (ou uma RPC de opções enxuta por tipo, mesma ideia de
`buscarOpcoesColecao`). Persistência por tipo (D-4). Erros traduzidos por `mensagemErro`
(acrescentar os 2 prefixos novos: `exportar_filtro_invalido`).

Nome-base do arquivo: `export-tecido-<categoria|todas>`, `export-aviamento-<categoria|material|todos>`,
`export-insumo-<tipo|todos>` (espelho do `export-<colecao>-<sub>` do produto).

## Restrições globais

- **Banco ANTES do site** (site novo chamando RPC inexistente = quebra; site velho + banco novo =
  inofensivo, as RPCs novas ficam ociosas). Deploy PRÓPRIO (não entra em kit destrutivo).
- **Leitura apenas** — zero DDL de dado (nenhuma tabela/coluna/gatilho novo); só CREATE FUNCTION +
  GRANT/REVOKE. Trava só de catálogo. Idempotente (`CREATE OR REPLACE`). Aplicar `psql -f` fora de txn.
- **REVOKE dos TRÊS** em cada `_core` (`FROM PUBLIC, anon, authenticated`) + pós-condição
  `has_function_privilege(...) = false` (invariante #9; já houve IDOR por revogar só anon/authenticated).
- **Gate = `_exportar_exige()`** nos 3 wrappers (o portão do export de produto HOJE; D-1).
- **Multi-tenant:** `_core` recebe `_tenant`; todo lookup filtrado pela loja do item.
- **RAISE 5xx só ASCII** (regra do projeto): `P0001`/`42501` são 400/403 e aceitam acento, mas manter o
  padrão ASCII do molde nos prefixos de erro; textos PT no front.
- **`soVariante`** fica vazio no cabeçalho (nível 1) — igual ao produto.
- **Anti-drift catálogo** TS ⇄ SQL por tipo (recomendado) — a chave que a tela oferece tem de estar na
  lista `v_catalogo` do `_core`, senão `exportar_campo_invalido`.

## Review Focus (5 riscos)

1. **Aviamento usar `nome` que não existe** (é `codigo_nome`). Se o `_core` fizer `a.nome` → erro de
   coluna / export vazio. → A fonte de `nome` do aviamento é **`codigo_nome`**; testar que a coluna
   "Nome" do aviamento traz o `codigo_nome` e que não há referência a `aviamentos.nome` em lugar nenhum.
2. **Filtro de tecido N:N trazer o tecido duplicado.** Um `JOIN artigo_categorias_tecido` multiplicaria
   a linha do tecido por cada par de categoria. → O recorte usa **`EXISTS`** (não `JOIN`) e o `count`/
   `v_ids` são sobre `artigos` distintos; testar um tecido com 2 categorias → 1 linha no nível 1.
3. **Variante de insumo (cor × tamanho) explodir linhas.** `variantes_etiqueta` tem N linhas por insumo
   (cor×tamanho). → Nível 1 = 1 linha por insumo (as variantes só no nível 2, 1 linha por
   `variantes_etiqueta`); testar insumo com 3 variantes → 1 linha no nível 1 e 3 no nível 2. Insumo sem
   variante = só o pai no nível 2.
4. **RPC nova sem o REVOKE dos 3 (IDOR, invariante #9).** O `_core` recebe `_tenant` por parâmetro; se
   ficar executável por anon/authenticated, qualquer usuário lê a loja de outro passando um uuid. → REVOKE
   `FROM PUBLIC, anon, authenticated` + pós-condição `has_function_privilege = false` nos 3 `_core`
   (e wrapper não executável por anon). Espelhar o bloco `$pos$` do molde.
5. **Coluna de categoria N:N do tecido com várias categorias por tecido — como representar numa célula.**
   Um tecido pode ter 2+ categorias (e 2+ subcategorias). → **Concatenar numa célula**, separador `" | "`
   (o mesmo que o produto usa para `foto`), ordenado por nome, via subconsulta agregada
   (`string_agg(DISTINCT c.nome, ' | ' ORDER BY c.nome)`), NÃO uma linha por categoria (não explodir o
   nível 1). `subcategoria_tecido` idem (as subs dos pares, agregadas; par sem sub não entra). Decisão de
   arquiteto D-5; validar com o dono se prefere concatenar vs. só as categorias do FILTRO.

## Riscos + mitigações

1. **Divergência catálogo TS × `v_catalogo` SQL** (coluna oferecida na tela que o `_core` rejeita). →
   Anti-drift por tipo (fixture com as chaves), como `sku-casos.ts`/`integracao-campos-i3`.
2. **`ExportarDados.tsx` virar monólito** ao somar 4 tipos. → Extrair "driver de recorte" por tipo;
   produto movido sem mudança de comportamento; a parte comum (colunas/níveis/prévia/baixar) compartilhada.
3. **Prefs antigas do produto colidirem com as novas** (mesmo scope `"export"`). → Namespaces distintos
   por tipo (`"tecido"`/`"aviamento"`/`"insumo"` vs `"integracao"` do produto); leitura valida contra a
   lista carregada (regra do produto).
4. **`export.ts` acoplado ao catálogo do produto** (importa `CAMPO_EXPORT_BY_KEY`/`KEYS_VALIDAS` fixos).
   → Refatorar `baixarExport`/`montarMatriz` para receber o mapa de rótulos + nomes de aba por parâmetro,
   sem mudar a geração CSV/Excel; produto passa a chamar com o seu mapa.
5. **Vazamento cross-tenant em lookup por id solto** (cor/categoria/material/fornecedor de outra loja). →
   Todo lookup `... AND x.tenant_id = <loja do item>` (espelho do molde); o `_core` recebe `_tenant`; o
   filtro de categoria/material/tipo valida que o id é da loja (senão `exportar_filtro_invalido`).
6. **Gate divergente do brainstorm** (o texto cita `_integracao_exige`; o código usa `_exportar_exige`).
   → D-1: reusar `_exportar_exige()` (o portão vivo do export de produto); o intento do dono é "mesmo
   portão do export de produto", honrado.

## Arquivos previstos

- **Banco:** 1 migration nova (`exportar_dados_por_tipo`): `_exportar_tecidos_core`/`exportar_tecidos`,
  `_exportar_aviamentos_core`/`exportar_aviamentos`, `_exportar_insumos_core`/`exportar_insumos` +
  GRANT/REVOKE + guarda de dependências (`_exportar_exige` existe) + bloco `$pos$` de ACL. Inverso em
  `supabase/rollback/` (DROP das 6 funções). Opcional: RPCs de opções por tipo
  (`exportar_opcoes_aviamento`, etc.) se reusar as queries do Cadastro não bastar.
- **UI:** `src/components/exportar/ExportarDados.tsx` (seletor de tipo + 4 drivers de recorte);
  `src/lib/exportar/campos-export-tecido.ts`, `…-aviamento.ts`, `…-insumo.ts` (ou `campos-por-tipo.ts`);
  `src/lib/integracao/export.ts` (receber mapa de rótulos/abas por parâmetro); `src/lib/erro-mensagem.ts`
  (traduzir `exportar_filtro_invalido`). Queries de opções de filtro
  (reuso das listas do Cadastro).
- **Testes:** integração txn revertida dos 3 `_core` (recorte, níveis 1/2, dedup N:N do tecido,
  insumo cor×tamanho, `codigo_nome` do aviamento, ACL/REVOKE) + unit dos catálogos (anti-drift TS⇄SQL) e
  do estado por tipo na tela.

---

## Decisões de arquiteto (D-1..D-5 — validar com o dono)

- **D-1 Gate.** As 3 RPCs reusam **`_exportar_exige()`** (o portão do export de produto HOJE), não
  `_integracao_exige` (o brainstorm cita o nome antigo; a migration `20261201130000` já trocou o produto
  para o portão próprio `exportar_dados`). Intento do dono preservado.
- **D-2 Uma RPC por tipo** (`exportar_tecidos`/`_aviamentos`/`_insumos` + `_core`), não uma RPC única com
  `_tipo` — isola filtros/colunas/validação e segue o molde 1:1. Aviamento com DOIS filtros independentes `_categoria`+`_material` (E)
  (Categoria E Material, dois dropdowns independentes).
- **D-3 Catálogo por tipo** (3 arquivos/arrays novos em `src/lib/exportar/`), não um discriminador no
  `campos-export.ts` do produto — conjuntos disjuntos e `soVariante` com semântica diferente por tipo.
- **D-4 Persistência** `useUserPref("export", <tipo>, <chave>, [])` com namespaces por tipo e sentinela
  `"__todos__"` para "todos" (espelho do `TODAS_COLECOES`).
- **D-5 Categoria(s)/sub do tecido numa célula** concatenadas por `" | "` (agregado, ordenado), 1 linha por
  tecido — não explodir a N:N em linhas.

## Self-review

- **Placeholders:** nenhum — todos os nomes de tabela/coluna foram conferidos no schema vivo da cópia
  local (artigos, variantes_tecido, aviamentos, variantes_aviamento, etiquetas, variantes_etiqueta,
  artigo_categorias_tecido, lookups); o aviamento usa `codigo_nome` (confirmado: não há `aviamentos.nome`);
  `variantes_etiqueta` não tem apelido (confirmado: só `cor_id`).
- **Contradição resolvida:** o brainstorm pede gate `_integracao_exige`; o código já migrou o export de
  produto para `_exportar_exige()` — registrado como D-1 e nos riscos (6), não silenciado.
- **Escopo:** só spec (sem código de produção); banco antes do site; leitura apenas; produto intocado. As 5
  decisões de arquiteto estão marcadas para validação. Review Focus cobre os 5 riscos pedidos (codigo_nome,
  dedup N:N, explosão de variante do insumo, REVOKE/IDOR, célula de categoria N:N).
