# Exportar dados — CSV/Excel de produtos (dentro da Integração)

> Desenho para aprovação do dono ANTES do plano. Pedido URGENTE (11/nov). Deploy PRÓPRIO (não espera a F6).

## Objetivo (pedido do dono, 11/nov)

Uma aba **"Exportar"** dentro da Integração onde o usuário monta a própria exportação de produtos:
filtra por Coleção + Subcoleção, marca as COLUNAS (campos do produto) e marca os NÍVEIS de SKU
(pai / até cor / até tamanho), e baixa um CSV (1 nível) ou um Excel com uma aba por nível (2-3).

## Decisões travadas (do dono, 11/nov)

1. **Onde:** aba nova dentro da Integração (ao lado de Produtos/Campos da API/API/Manual/Log). Herda o
   gate `integracao` (super admin + quem o super admin autorizou). NÃO é rota nova.
2. **Formato:** 1 nível marcado = **CSV**; 2 ou 3 níveis = **Excel .xlsx com 1 aba por nível**.
3. **Níveis:** (1) SKU pai = 1 linha por produto; (2) até a cor = 1 linha por variante de cor, com o
   PAI na 1ª linha; (3) até tamanho = 1 linha por SKU cor×tamanho, com o PAI na 1ª linha.
4. **Produtos:** TODOS — interno (Planejamento) + revenda (Produto Acabado) + importado. Do recorte
   coleção+subcoleção, **incluindo reprovados** (diferente da Integração, que os exclui).
5. **Colunas:** TODAS disponíveis sem gate extra — inclusive preço de custo e preço de venda. O acesso
   à aba (gate `integracao`) é o controle. (O dono aceitou: quem acessa a Integração já vê sensível.)
6. **RPC nova** (caminho robusto, não só-front): a montagem pai/variante/tamanho e a regra de custo
   vivem em SQL; o PostgREST corta em 1.000 linhas. RPC dedicada resolve limpo.
7. **Deploy próprio**, assim que pronta (banco antes do site). Não espera a F6.

## Reaproveitamento (o que já existe)

- **`xlsx` (SheetJS) JÁ instalado** (`package.json`), já gera .xlsx com 1 aba por descritor
  (`src/lib/import/template.ts`: `aoa_to_sheet` + `book_append_sheet` + `XLSX.writeFile`). Para CSV:
  `XLSX.utils.sheet_to_csv`. É o padrão pronto para "uma aba por nível".
- **Catálogo de 21 campos** `src/lib/integracao/campos.ts` (type `CampoDef`, com `soVariante`/`tipo`):
  nome, ref_sku, preco_anterior, preco_venda, peso, ncm, preco_custo, cor_base, cor_apelido, tamanho,
  titulo, descricao, keywords, metatag, comprimento/largura/altura, foto, colecao, categoria_tecido,
  linha. Reusar para montar os checkboxes de colunas (e `soVariante` decide em que nível cada coluna
  faz sentido: cor_base/cor_apelido só nos níveis 2-3, tamanho só no 3).
- **Opções de Coleção/Subcoleção** `opcoes_colecao_modelos()` / `src/lib/opcoes-colecao.ts` — pronto.
- **Fontes dos campos** (todas mapeadas): SKU=`modelo_skus`; REF=`modelos.ref`; custo=derivado
  (`_custo_unitario_modelos_core`); preço venda/anterior=`modelos.preco_venda/preco_anterior`;
  cor/tamanho=variante/grade; NCM/peso/medidas/título/descrição=`modelos.*`;
  coleção/categoria_tecido/linha=`_integracao_extras(modelo)`.
- **NÃO reusar `integracao_listar` inteiro:** vem acoplado a estado de integração (assinatura HMAC,
  gates, faltas, trava, exclui reprovados). A exportação quer todos os produtos, sem esse peso.

## Arquitetura

### Banco — RPC `exportar_produtos` (wrapper + `_core`, padrão da casa)

`exportar_produtos(_colecao_id uuid, _subcolecao text, _campos text[], _niveis int[]) RETURNS jsonb`
- **Wrapper:** login + módulo + `user_can_view('integracao')` (mesmo gate da tela); DEFINER.
- **`_core`** (EXECUTE revogado dos 3): recorte de produtos = a base de `_integracao_base` SEM o filtro
  que exclui reprovados (traz TODOS), filtrada por `colecao_id`/`subcolecao`. Monta, por produto:
  - **nível 1 (pai):** 1 objeto com os campos do produto selecionados.
  - **nível 2 (até cor):** o pai + 1 objeto por variante de cor (campos `soVariante` da cor + herdados
    do pai).
  - **nível 3 (até tamanho):** o pai + 1 objeto por SKU cor×tamanho (reusa `_skus_calc_ref_tipo` +
    `modelo_skus`, como o retrato da Integração).
  - Retorna `{ colunas: [...], niveis: { "1": [linhas], "2": [linhas], "3": [linhas] } }` — só os
    níveis pedidos; cada "linha" é um objeto chave→valor pelos campos selecionados.
- **Custo:** como o dono liberou todas as colunas, o `_core` calcula o custo direto (chama o
  `_custo_unitario_modelos_core`), SEM mascaramento. (Não precisa do wrapper gated.)
- **Teto:** a RPC devolve tudo do recorte (um recorte coleção+subcoleção é limitado; não há paginação
  de 500 como a Integração). Se um recorte for enorme, a RPC ainda é 1 chamada (não sofre o teto de
  1.000 linhas do PostgREST, que é por tabela via REST, não por RPC).
- RAISE 5xx só ASCII; rollback em `supabase/rollback/`.

### Front

- **`src/components/integracao/ExportarAba.tsx`** (novo): UI da aba.
  - Filtros: Coleção (dropdown de `opcoes_colecao_modelos`) + Subcoleção (dependente da coleção).
  - Colunas: checkboxes dos 21 campos (de `campos.ts`); `soVariante` agrupa "campos de variante".
  - Níveis: 3 checkboxes (pai / até cor / até tamanho).
  - Botão "Exportar" → chama `exportar_produtos` → monta o arquivo e baixa.
- **`src/lib/export/exportar.ts`** (novo, puro): recebe o retorno da RPC + a escolha de níveis e monta:
  - 1 nível → CSV (`XLSX.utils.sheet_to_csv` sobre o `aoa_to_sheet`).
  - 2-3 níveis → workbook .xlsx com 1 aba por nível (`book_append_sheet`), `XLSX.writeFile`.
  - Cabeçalho = os rótulos dos campos selecionados (de `campos.ts`); nos níveis 2-3, o pai é a 1ª linha
    de cada grupo de filhos (como o dono pediu).
- **`src/lib/integracao/abas.ts`**: +aba "exportar" em `Aba`, `ROTULO_ABA`, `abasVisiveis`.
- **`src/components/integracao/IntegracaoPage.tsx`**: +entrada em `CONTEUDO_ABA` (Aba→componente).

## O que NÃO entra

- Gate de custo/mascaramento (dono liberou todas as colunas).
- Reuso de `integracao_listar` (acoplado demais).
- Agendamento/exportação automática, histórico de exportações — só o export manual sob demanda.
- Preço atacado como coluna separada (não está no layout da Integração; se o dono quiser, é 1 campo
  novo — fora deste escopo salvo pedido explícito).

## Riscos / cuidados

- **Reprovados incluídos** (diferente da Integração) — a RPC NÃO reaproveita o filtro que os exclui.
- **Pai na 1ª linha dos filhos:** nos níveis 2-3, cada produto gera o pai seguido dos filhos; a ordem
  importa (o dono especificou). O `exportar.ts` monta a matriz na ordem certa.
- **Campos `soVariante`** (cor/tamanho) não fazem sentido no nível 1 (pai) — a UI desabilita/ignora.
- **Tamanho do arquivo:** um recorte grande gera muitas linhas; aceitável (é sob demanda, 1 recorte).
- **ASCII nos RAISE**; **banco antes do site** (o front chama a RPC nova).

## Verificação

- **Integração (cópia, txn revertida):** `exportar_produtos` devolve os 3 níveis certos para um recorte
  com produtos das 3 origens (interno/revenda/importado) + um reprovado (deve aparecer); os campos
  selecionados batem com as fontes; custo vem calculado.
- **Unit (TS):** `exportar.ts` — 1 nível vira CSV; 2-3 viram workbook com N abas; pai na 1ª linha dos
  filhos; cabeçalho = rótulos dos campos.
- **QA na prévia (5190):** abrir Integração › Exportar; filtrar Resort 27 › R1; marcar SKU + preço de
  custo + preço de venda; marcar 1 nível → baixa CSV; marcar 3 níveis → baixa Excel com 3 abas; conferir
  que os reprovados aparecem e que custo/preço vêm preenchidos.
- `npm run build` + `tsc --noEmit`; code-reviewer; guardião na RPC nova.
