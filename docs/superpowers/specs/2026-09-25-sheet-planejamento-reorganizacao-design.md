# Reorganização do Sheet do Planejamento de Produto — especificação (F3.6)

**Data:** 25/set/2026 · **Status:** desenho — mockup APROVADO pelo dono ("gostei. assim que
terminar o SKU pode aplicar o mockup") · **Campanha:** Planejamento unificado + Kanban automático
(fase nova F3.6; sequência A/B/C na §8)

Mockup aprovado: https://claude.ai/artifact/9DaBF3wXk9bbtUgojZ3rHP (fonte:
`mock-sheet/project/Main.dc.html` — citado abaixo como "mockup").

## 1. Contexto e objetivo

O Sheet do Planejamento de Produto (`src/components/planejamento/PlanejamentoDetail.tsx`, 2000
linhas, + seções extraídas em `src/components/planejamento/planejamento-detail/`) hoje edita 17
seções numeradas 1–17 (`ORDEM_SECOES_SHEET`,
`src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts:14-17`), reunidas pela
campanha F3 (Planejamento + Desenvolvimento fundidos num único editor — ver bloco "Sheet
unificado do Planejamento" do `CLAUDE.md`). O dono pediu uma reorganização pontual dessa tela,
aprovada por mockup em 25/set:

1. Seção 1 ganha um campo de **Título para a página** (automático, editável, com botão de
   reverter) e um bloco de **Peso/medidas** (kg/cm) — dados novos, hoje inexistentes em `modelos`.
2. Seção 3 ("Desenvolvimento — equipe e cronograma") perde a REF, que muda de seção.
3. Uma seção nova, **"4. Códigos"**, reúne a REF (que saiu da seção 3) e uma tabela de **SKU por
   variante × tamanho** — geração condicionada ao F3.5a (banco do SKU) estar em produção.
4. A seção "Mão de obra" deixa de existir como seção própria: os serviços entram como linhas
   **dentro** da tabela "Preço e Custos", na linha "Mão de obra" (que hoje já existe, mas só como
   leitura — `PrecoTabela.tsx:367-377`).
5. Todas as seções depois da 4 renumeram (a Mão de obra sai da contagem; Códigos entra).

Este documento é só o DESENHO (schema, telas, regras) — sem código, sem migration aplicada.

## 2. Decisões do dono (verbatim/resumo, 25/set)

- Seção 1 "Informações Gerais do Produto": L1 Status | Estilista | Origem · L2 Nome do Modelo
  (50%) | Versão (25%) | **NCM do Produto** (25%, decisão NOVA do dono, 25/set — ver abaixo) · L3
  Grupo, Categoria, Subcategoria 1, Subcategoria 2 · L4 **Título para a página** (texto; auto
  "Nome do Modelo | Nome da Marca", ex. "Vestido Longo Poema | Ave Rara") · L5 Descrição do
  produto · L6 **Peso (kg, 3 decimais), Comprimento (cm, 2 dec.), Largura (cm, 2 dec.), Altura
  (cm, 2 dec.)**.
- **NCM do Produto (decisão NOVA do dono, 25/set):** "quanto ao NCM do produto, vamos deixar campo
  editável simplesmente, isso ficaria na linha 2 em informações gerais do produto: nome do modelo
  | versão | NCM do Produto, sendo 50% nome do modelo 25% versão 25% ncm". Campo de texto simples
  — **sem validação contra tabela oficial e sem sugestão automática** (o estudo de sugestão por
  regra malha/plano × público × tipo de peça × fibra, `project_ncm_produto`, segue em discussão
  separada e fora de escopo aqui; só o campo editável entra). Isso substitui/antecipa uma fatia do
  que estava "em discussão" — o campo em si deixa de ser fora de escopo, a SUGESTÃO continua fora.
- Seção 2 Coleção: L1 Coleção | Subcoleção | Linha · L2 Lançamento | Mês do planejamento | Ano.
  (Sem mudança — já é assim hoje, `PlanejamentoDetail.tsx:1376-1417`.)
- Seção 3 "Desenvolvimento" (o título perde "— equipe e cronograma"): L1 Modelista · L2 Piloteiro
  1 | Data Piloto 1 · "+ adicionar piloto" (até 3 — opção A; o 2º/3º têm "×"; já existe hoje em
  `DevEquipeSection.tsx`) · L3 Data do Desenho Técnico | Data da Aprovação · L4 Observações
  Técnicas. **A REF sai daqui.**
- Seção 4 NOVA "Códigos": L1 REF · tabela de SKU por variante (cores = variantes do Tecido 1; no
  comprado, as variantes do produto espelho) — uma linha de grupo e, abaixo, uma linha por tamanho
  da Grade com o SKU (REF + cor + tamanho, pelo Formato do SKU da Config). É a **F3.5b** do SKU
  (spec `docs/superpowers/specs/2026-09-24-sku-automatico-design.md` §4.3 "Planejamento — seção
  REF e SKUs": "Tamanho em" Letra|Número, SKU editável/manual, "Falta sigla" com link, "Regerar
  SKUs" com AlertDialog). **Implementa DEPOIS de o banco do SKU (F3.5a) estar em produção**
  ("assim que terminar o SKU").
- "Preços e Custos" (vira seção 11): a Mão de obra entra NA TABELA — na linha "Mão de obra" (antes
  do Custo Total), com os serviços (valor, aprovar/reprovar p/ quem tem permissão, remover) e "+
  adicionar serviço". Abaixo do Custo Total, a "Observação de mão de obra". **A seção "Mão de
  obra" separada deixa de existir.** Revenda/importado: o mesmo encaixe no bloco de preço deles
  (opção A). A parte "Mão de obra — quanto cabe p/ atingir o preço em cada faixa" (Mín/Ideal/Máx)
  continua LOGO DEPOIS de Preços (pedido anterior do dono, commit `726f399`).
- Seções não citadas ficam iguais; só renumeram: 5 Ajustes na Prova, 6 Tecidos, 7 Aviamentos, 8
  Insumos, 9 Grade, 10 CAD, 11 Preço e Custos, 12 Anexos, 13 Observações, 14 Lançamento, 15 Produto
  Relacionado.
- Título: "se alguém editar, não é automaticamente mudado até que cliquem em ↺" — acompanha o nome
  enquanto ninguém editar; marca = nome da loja.

## 3. Rulings do controlador (decisões travadas — "custo se errado")

1. **Título.** Coluna `modelos.titulo_pagina text NULL`. `NULL` = automático (calculado na tela e
   por um helper SQL, para consumidores/ERP); não-`NULL` = editado à mão; o botão ↺ grava `NULL`.
   Automático = nome do modelo em "iniciais maiúsculas" (cada palavra com a 1ª letra maiúscula e o
   resto minúsculo; conectivos PT `de/da/do/das/dos/e/com/em/para` em minúsculo, salvo no início da
   string) + `" | "` + `tenants.nome` (é a MARCA da loja — não `system_settings.nome_sistema`/
   WISH360; confirmado: não existe hoje leitura de `tenants.nome` dentro do
   `PlanejamentoDetail.tsx`, mas o padrão já é usado em `TenantSwitcher.tsx:27` e
   `useTenantBranding.ts:36`). Exemplo do mockup: nome "VESTIDO LONGO POEMA" → título "Vestido
   Longo Poema | Ave Rara" (mockup linha 97).
2. **Peso/medidas.** `modelos.peso_kg numeric(10,3)`, `comprimento_cm/largura_cm/altura_cm
   numeric(10,2)`. `NULL` = vazio (nasce vazio com placeholder — ui-padroes §D); `CHECK (>= 0)`.
   Input decimal com vírgula, padrão do repo (`MoneyInput`/`NumberInput`; ver
   `src/components/shared/NumberInput.tsx` e `src/lib/money-mask.ts`). Nenhuma dessas 4 colunas
   existe hoje em `modelos` (confirmado — as ocorrências de `peso_kg` no grep são só de
   `produto_importado`/`produtos_importados`, tabela diferente).
3. **NCM do Produto (ruling do controlador sobre a decisão NOVA do dono, 25/set).**
   `modelos.ncm text NULL`. Campo de texto simples, **sem validação contra tabela oficial e sem
   sugestão automática** — o campo só grava o que foi digitado. Placeholder `"0000.00.00"`
   (formato NCM de 8 dígitos); aceita só dígitos e pontos, até 10 caracteres (8 dígitos + 2 pontos
   do formato pontuado); vazio grava `NULL` (mesma regra `textoOuNull` de `descricao_produto`/
   `titulo_pagina`). Sem máscara obrigatória — o usuário pode digitar só dígitos ou já pontuado; a
   validação de caracteres é client-side (input `pattern`/filtro), não uma constraint `CHECK` no
   banco (evita rejeitar um NCM digitado sem pontuação ainda incompleto durante a digitação). O
   campo vai na MESMA migration aditiva da Parte B (junto de Título e Peso/medidas — ver ruling 4).
4. **Migration.** PRÓPRIA e aditiva (`ADD COLUMN IF NOT EXISTS`), número maior que
   `20261003100000` (a do SKU — spec do SKU §4.1, ainda não aplicada). Inverso próprio que avisa
   que apaga o digitado (padrão `supabase/rollback/`, ex.
   `20260930180000_modelo_descricao_produto_down.sql`). Passa pelo G-migration e pelo processo de
   produção (cópia → guardiões → dono aplica), igual à Data da Nota de Entrada e à F3.1
   (`20260930180000_modelo_descricao_produto.sql`, que é o precedente mais próximo: campo novo de
   texto em `modelos`, aplicado por ÚLTIMO no arquivo por travar `ACCESS EXCLUSIVE`). Sem DDL de
   policy.
5. **Duplicar / Replicar.**
   - **Duplicar** (botão do menu ⋯ do Sheet, `camposParaDuplicar` em
     `src/components/planejamento/planejamento-detail/helpers.ts:137-143`): copia peso/medidas,
     descrição **e o NCM** (mesmo tipo de produto — decisão do dono/ruling 3); título volta ao
     AUTOMÁTICO (`NULL`) porque o nome muda (a duplicata nasce com nome diferente — nunca faz
     sentido herdar um título fixado no nome antigo).
   - **Replicar card(s)** (Plan. Tecido — `_replicar_cards_plan_tecido_core`, lista fixa de
     colunas do INSERT, redefinida pela última vez em
     `supabase/migrations/20260930180000_modelo_descricao_produto.sql:97-119`): leva peso/medidas,
     **o título e o NCM** (é o mesmo produto, só em outra coleção — ao contrário do Duplicar, aqui
     o nome não muda, então o título também não precisa recalcular, e o NCM continua o mesmo
     produto físico). Redefinir a função NA MESMA migration desta spec, com diff
     `pg_get_functiondef` antes/depois e inverso, seguindo a receita documentada no cabeçalho de
     `20260930180000_modelo_descricao_produto.sql:1-24` (ordem: função antes do `ALTER TABLE`,
     porque o plpgsql só resolve a coluna nova ao EXECUTAR, não ao criar; `ALTER` por último —
     trava `ACCESS EXCLUSIVE` só no fim do arquivo).
6. **Motivo do Cancelamento** (só com status Reprovado — `MotivoCancelamento.tsx`, hoje renderizado
   no fim da seção 3 pelo orquestrador): fica no fim da seção 3, como hoje (posição inalterada por
   esta spec — só o título da seção 3 muda, de "Desenvolvimento — equipe e cronograma" para
   "Desenvolvimento").
7. **Selos.**
   - O selo de "Preço e Custos" passa a considerar também as condições de mão de obra: as chaves
     de `CONDICOES_SECAO_SHEET.mao_obra` (`["servico_aprovado", "servico_mo_decidido",
     "servico_mo_preenchido"]`, `selos-secoes.ts:44-51`) migram para `CONDICOES_SECAO_SHEET.preco`
     (que hoje só tem `["preco_venda_preenchido"]`, mesma linha). A chave `mao_obra` do mapa (e o
     `SecaoSheetKey` inteiro) deixa de ter selo próprio — a seção deixa de existir.
   - Seção Códigos: selo **"N SKU(s) sem sigla"** (âmbar) quando houver, senão nenhum selo ou "ok",
     conforme a regra de seção vazia já usada nas demais (função `seloDeSecao`, importada de
     `./selos-bom` em `selos-secoes.ts:5`, introduzida no commit `893ac80` — mesmo padrão: seção
     sem nada preenchido não mostra selo, exceto o aviso âmbar de um requisito de kanban pendente
     daquela seção).
8. **Dialog "Novo Modelo".** Seção 1 recebe os mesmos campos novos (título automático visível;
   peso/medidas e NCM opcionais). Continua numerando só 1 e 2 — `SECOES_NUMERADAS_DIALOG_NOVO =
   new Set(["info", "colecao"])` em `selos-secoes.ts:24` não muda (Título, Peso/medidas e NCM
   moram DENTRO da seção "info", que já é numerada; não são seções próprias).
9. **Colaboração.** Os campos novos entram em:
   - `Draft`/`emptyDraft`/`draftFromModeloRow` (`src/components/planejamento/modelo-shared.ts:76-202`);
   - o payload do Salvar (`usePlanejamentoSave` — o arquivo não foi lido nesta spec por completo,
     mas é o consumidor natural do `Draft`; qualquer campo novo do `Draft` que não precise das
     regras de `aplicarRegrasCamposDev` — Título e Peso/medidas são do Planejamento, não do Dev —
     entra direto no payload, como `descricao_produto` hoje);
   - os rótulos de conflito `ROTULO_CONFLITO_PLAN` (`helpers.ts:11-32`), com `data-colab-path` nos
     campos (padrão de todo campo do Draft: ver `descricao_produto` em `helpers.ts:29` e
     `InfoGeraisSecao.tsx:142`).
   - O título automático (`NULL`) nunca vira conflito só por mudança do nome: o merge 3-vias
     (`mergeDraft`, `src/lib/colab/merge.ts`) compara o campo `titulo_pagina` como qualquer outro —
     como ele fica `NULL` enquanto automático, uma mudança de `nome` sem mudança de
     `titulo_pagina` não gera divergência nesse campo (é o comportamento natural do merge por
     campo tocado; não precisa de exceção especial no código do merge, só said aqui para deixar
     explícito que ninguém deve adicionar uma).
10. **Sequência (3 partes do dono).**
   - **Parte A** = reorganização só de tela (seções 1–3 + MO dentro de Preço), sem banco.
   - **Parte B** = campos novos (migration + tela): Título, Peso/medidas, NCM.
   - **Parte C** = Códigos (REF agora + tabela SKU depois do F3.5a em produção).
   Como o dono pediu "assim que terminar o SKU", a implementação começa depois do F3.5a em
   produção; A e B podem ser planejadas e testadas na cópia antes.
11. **Fora de escopo.** A SUGESTÃO automática de NCM por regra malha/plano × público × tipo de
    peça × fibra (discussão separada — `project_ncm_produto`; o CAMPO editável em si ENTRA nesta
    spec, ver ruling 3); Sheet do Dev (`src/components/desenvolvimento/`, `ModeloDetailPanel.tsx`)
    intocado até a F5 (decisão 8 travada da campanha, gate reproduzível citado no `CLAUDE.md`: `git
    diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/
    src/components/producao/cad/CadTecidosSection.tsx` deve dar vazio).

## 4. Estado atual do código (fatos levantados, 25/set)

- **Ordem/numeração de seções:** `ORDEM_SECOES_SHEET` em `selos-secoes.ts:14-17` — hoje:
  `info, colecao, desenvolvimento, prova, tecidos, aviamentos, insumos, grade, cad, tecidos_novo,
  preco, mao_obra, produto_acabado, grade_revenda, anexos, observacoes, lancamento, relacionado`.
  A numeração é DINÂMICA (`numerarSecoes`, `selos-secoes.ts:26-35`): conta só as chaves visíveis
  (`vis`, `PlanejamentoDetail.tsx:1133-1157`), então "N." nunca descola do que está na tela.
- **Render das seções no orquestrador** (`PlanejamentoDetail.tsx`):
  - `info` → `<InfoGeraisSecao>` (linha 1368, componente próprio,
    `InfoGeraisSecao.tsx:1-147`);
  - `colecao` → `<Secao id="colecao" ...>` inline (linha 1376);
  - `desenvolvimento` → `<Secao id="desenvolvimento" titulo="Desenvolvimento — equipe e
    cronograma" ...>` (linha 1423) envolvendo `<DevEquipeSection>` (componente próprio,
    `src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx:1-221`);
  - `preco` → `<Secao id="preco" titulo="Preço e Custos" ...>` (linha 1485) renderizando
    `<PrecoTabela>` (manufaturado,
    `src/components/planejamento/planejamento-detail/PrecoTabela.tsx:1-403`) ou
    `<PrecoRevendaBloco>` (comprado, `RevendaSetores.tsx:22-90+`);
  - `mao_obra` → `<Secao id="mao_obra" titulo="Mão de obra" ...>` (linha 1560) renderizando
    `<MaoObraEditor>` (`src/components/planejamento/MaoObraEditor.tsx`) + `<ObsMaoObraField>`.
  - Não existe hoje seção "Códigos"; a REF é editada dentro de `DevEquipeSection` (campo
    `refVisivel`, `DevEquipeSection.tsx:108-115`), condicionada a `kanbanCard.refVisivel`
    (posição derivada do kanban — invariante #11 do `CLAUDE.md`).
- **REF hoje:** campo dentro de `DevEquipeSection`, visível/editável conforme
  `refVisivel`/`bloqueado` (mesma trava `devBloqueado` de todo o resto da seção 3). REF NÃO
  aparece no header do card como campo editável — só como texto read-only
  (`PlanejamentoDetail.tsx:1303-1305`, `{isEdit && draft.ref && <span>REF {draft.ref}</span>}`).
- **Mão de obra hoje na tabela de Preço:** já existe uma linha "Mão de obra" em `PrecoTabela.tsx`
  (linhas 367-377) — mas é SÓ LEITURA: mostra o total (`maoObraDev`) e o texto "na seção Mão de
  obra abaixo" (linha 376) quando não há `moBadge`. Essa linha precisa VIRAR o bloco expandido com
  os serviços (o `MaoObraEditor` inteiro, hoje numa seção à parte) — não é uma seção nova, é mover
  o conteúdo de uma seção pra dentro da tabela de outra.
- **Gate de exibição/edição da MO hoje:** `vis.mao_obra = (!isComprado ? true : isEdit) &&
  (veCustos || (isEdit && podeAprovarMaoObra))` (`PlanejamentoDetail.tsx:1148`) — essa condição
  precisa se tornar o gate de exibir o BLOCO de MO dentro da seção `preco` (a seção `preco` em si
  já é `vis.preco = isEdit`, linha 1143, mais ampla — então o bloco MO dentro dela continua tendo
  seu próprio show/hide interno).
- **Título/Peso/medidas:** não existem em nenhuma camada hoje — nem coluna, nem `Draft`, nem UI.
  `titulo_pagina`/`peso_kg`(em `modelos`)/`comprimento_cm`/`largura_cm`/`altura_cm`: zero
  ocorrências em `src/` e `supabase/migrations/` para essas colunas em `modelos` (confirmado por
  grep; `peso_kg` só existe hoje em `produtos_importados`/`produto_importado_variantes`, tabela e
  contexto diferentes).
- **Permissões relevantes já existentes** (não mudam nesta spec, só se aplicam às seções
  reorganizadas):
  - `veCustos = podeVerCustos || ficha.podeVerCustos` (`PlanejamentoDetail.tsx:444`) — união das
    permissões `criacao_planejamento:custos` e `criacao_desenvolvimento:custos`
    (`permissions-catalog.ts:126,130`), gate de VER valores em Preço/Custos/MO.
  - `podeAprovarMaoObra = canEdit("producao_servico_aprovacao")` (linha 156) — gate de
    aprovar/reprovar POR LINHA na MO (invariante #12 do `CLAUDE.md`; enforçado no servidor por
    `trg_enforce_servico_mo_aprovacao`).
  - `podeEditarDev = canEdit("criacao_desenvolvimento")` (linha 159) — gate de editar a seção
    Desenvolvimento (Modelista/Pilotos/Datas/Obs. Técnicas/REF), refletido no
    `<fieldset disabled={devBloqueado}>` que envolve `DevEquipeSection`
    (`PlanejamentoDetail.tsx:1425-1435`).
  - Nenhuma dessas 3 permissões precisa de chave nova para Título/Peso/medidas: são campos do
    Planejamento (seção 1, como `descricao_produto`), então seguem a mesma trava de
    `criacao_planejamento` (ver/editar a página) que hoje já governa `nome`/`estilista_id`/etc. em
    `InfoGeraisSecao`.

## 5. Desenho

### 5.1 Telas

Ordem final das seções do Sheet (após a reorganização completa, Partes A+B+C):

| Nº | Seção | Origem |
|---|---|---|
| 1 | Informações Gerais do Produto (+ Título + Peso/medidas) | existente + campos novos |
| 2 | Coleção | existente, sem mudança |
| 3 | Desenvolvimento (sem "— equipe e cronograma"; sem REF) | existente, REF sai |
| 4 | **Códigos** (REF + tabela de SKU) | NOVA (Parte C) |
| 5 | Ajustes na Prova | existente, renumera |
| 6 | Tecidos / Forros / Entretelas | existente, renumera |
| 7 | Aviamentos | existente, renumera |
| 8 | Insumos | existente, renumera |
| 9 | Grade | existente, renumera |
| 10 | CAD | existente, renumera |
| 11 | Preço e Custos (com MO embutida na tabela) | existente + MO absorvida |
| 12 | Anexos | existente, renumera |
| 13 | Observações | existente, renumera |
| 14 | Lançamento | existente, renumera |
| 15 | Produto Relacionado | existente, renumera |

`tecidos_novo` (seção "Tecidos" só do Dialog "Novo Modelo") e `produto_acabado`/`grade_revenda`
(comprado) seguem existindo com a MESMA regra de visibilidade condicional de hoje — só saem/entram
da contagem quando aparecem, como já funciona (`numerarSecoes` já é dinâmico, `selos-secoes.ts:26-35`).

**Seção 1 — Informações Gerais do Produto** (`InfoGeraisSecao.tsx`), ordem final dos campos:
- L1: Status | Estilista | Origem (inalterado, `InfoGeraisSecao.tsx:37-75`).
- **L2 MUDA — Nome do Modelo (50%) | Versão (25%) | NCM do Produto (25%)** (decisão NOVA do dono,
  25/set). Hoje Nome e Versão estão em 2 grids separados (`InfoGeraisSecao.tsx:47-52` dentro do
  grid de 4 colunas da L1, e `:79-92` num grid próprio de 4 colunas só com Versão) — a
  reorganização os une numa ÚNICA linha de 3 campos com larguras proporcionais 50/25/25 (ex.
  `grid-template-columns: 2fr 1fr 1fr`, já que o padrão `sm:grid-cols-2 lg:grid-cols-4` uniforme
  usado no resto da seção não expressa proporção — decisão de implementação do CSS exato, mantendo
  a proporção pedida). Campo NCM: `Input` de texto simples, placeholder `"0000.00.00"`, filtro de
  entrada só dígitos e pontos até 10 caracteres, `data-colab-path="ncm"`; sem validação contra
  tabela oficial nem sugestão automática (ruling 3) — grava exatamente o que foi digitado, vazio
  vira `NULL`.
- L3: Grupo, Categoria, Subcategoria 1, Subcategoria 2 (inalterado, linhas 95-130).
- **L4 NOVA — Título para a página** (campo texto + badge "automático"/nada + botão "↺
  automático"):
  - Estado vazio nunca ocorre de verdade (o helper sempre calcula algo a partir do nome — ver
    §5.2), mas o campo nasce com o valor calculado assim que há Nome + loja identificada.
  - Estado "automático" (`titulo_pagina IS NULL` no servidor / draft local equivalente): input
    mostra o valor CALCULADO ao vivo (recalcula a cada tecla no Nome do Modelo, client-side, sem
    round-trip); badge "automático" visível; botão ↺ desabilitado (não há o que reverter — mockup
    linha 95-99, `disabled` + opacidade reduzida).
  - Estado "editado": usuário digitou algo diferente do calculado → vira manual; badge some (ou
    vira "editado", livre para o implementador); botão ↺ habilita. Salvar grava o texto digitado
    (trim; vazio volta a NULL/automático — mesma regra de `textoOuNull` já usada em
    `descricao_produto`, `helpers.ts:88-90`).
  - Botão ↺ grava `NULL` no draft local (volta a mostrar o calculado) — client-side, não precisa de
    RPC própria; o Salvar da página persiste o `NULL`.
  - Hint sob o campo (mockup linha 100): "Acompanha o Nome do Modelo + o nome da loja enquanto
    ninguém editar. Editado à mão, fica fixo até clicar em ↺."
- L5: Descrição do produto (inalterado, `InfoGeraisSecao.tsx:135-144`).
- **L6 NOVA — Peso (kg) | Comprimento (cm) | Largura (cm) | Altura (cm)**, grid de 4 colunas (igual
  ao padrão `sm:grid-cols-2 lg:grid-cols-4` já usado nas outras linhas da seção):
  - `NumberInput` decimal (vírgula), 3 casas para Peso, 2 casas para as 3 medidas — mesmo padrão de
    `ProdutoImportadoCard.tsx:677` (`NumberInput blankZero ... placeholder="0,00"`), mas SEM
    `blankZero` (o requisito é NULL = vazio com placeholder "0,000"/"0,00", não zero — ui-padroes
    §D); `data-colab-path` em cada um (`peso_kg`, `comprimento_cm`, `largura_cm`, `altura_cm`).
  - Sem gate de permissão além da já existente da página (ver ↑ e Draft, mesma trava de
    `criacao_planejamento`).
  - No Dialog "Novo Modelo": mesmos campos, opcionais (nenhum obrigatório para criar o card).

**Seção 3 — Desenvolvimento** (`DevEquipeSection.tsx` + orquestrador):
- Título do `<Secao>` muda de `"Desenvolvimento — equipe e cronograma"` para
  `"Desenvolvimento"` (`PlanejamentoDetail.tsx:1423`).
- REF sai da seção: remover o bloco `{refVisivel && (...)}` de `DevEquipeSection.tsx:108-115` (a
  prop `refVisivel` deixa de ser usada por este componente — passa a ser consumida pela seção
  Códigos, ver abaixo). Layout resultante: a linha que hoje é `grid-cols-2` (REF | Modelista)
  passa a ter só Modelista, ou some se `!verModelista` (mesma lógica condicional de hoje, linha
  108, só tirando o `refVisivel ||` do `if`).
- Resto da seção (Cronograma & pilotos, Observações Técnicas, Motivo do Cancelamento no fim, via
  orquestrador) — inalterado.

**Seção 4 — Códigos (NOVA, Parte C, só após F3.5a em produção):**
- Componente novo `CodigosSecao.tsx` (nome sugerido, mesmo padrão de arquivo próprio por seção de
  `InfoGeraisSecao.tsx`/`DevEquipeSection.tsx`), renderizado no orquestrador logo após a seção
  `desenvolvimento` e antes de `prova`/`tecidos` no `ORDEM_SECOES_SHEET`.
- L1: REF (mesmo campo/estilo que saiu da seção 3 — `Input className="font-mono"` com
  `data-colab-path="ref"`, mesma trava `bloqueado`/`refVisivel` de hoje) | "Tamanho em" (Letra |
  Número, radio ou segmentado — espelha a decisão Q3 da spec do SKU §2: "um OU outro por card"; o
  card novo nasce com o padrão da loja) | botão "↻ Regerar SKUs" alinhado à direita (mockup linhas
  150-158).
- Tabela "SKUs por variante e tamanho" (mockup linhas 159-174): colunas Variante/Tamanho | SKU |
  Situação. Uma linha de grupo por variante (rótulo "Variante N · Cor Base (SIGLA) · apelido Cor
  Apelido (SIGLA)" ou "sem apelido"), e abaixo uma linha por tamanho da Grade com:
  - input mono do SKU (editável — marca `manual=true` ao editar, RPC `salvar_sku_manual` da spec
    do SKU §4.2);
  - situação: "automático" (texto discreto), "editado à mão" (badge info), ou "Falta sigla:
    <atributo> <nome>" (badge âmbar) + link "cadastrar" para o cadastro da sigla faltante.
  - Hint no rodapé da seção (mockup linha 174): "As variantes vêm do Tecido 1 (seção Tecidos) e os
    tamanhos, da Grade. Formato: REF - cor base + apelido + tamanho (Config da Loja › Formato do
    SKU). 'Regerar SKUs' pede confirmação e nunca muda os editados à mão."
  - "Regerar SKUs" abre `AlertDialog` de confirmação ("SKUs editados à mão não mudam" — já previsto
    na spec do SKU §4.3) antes de chamar `gerar_skus_modelo(_modelo_id, _regerar=true)`.
- No comprado (revenda/importado): variantes vêm do produto espelho, não do Tecido 1 (mesma fonte
  que `useGradeComprado` já usa para a grade cor×tamanho — `RevendaSetores.tsx`,
  `useGradeComprado.ts`).
- Dependência dura: esta seção só entra em produção depois que a Parte A do F3.5a (colunas
  `cores.sigla_sku`, `cores_apelido.sigla_sku`, `tenant_config.tamanhos_sku`,
  `tenant_config.sku_config`, tabela `modelo_skus`, RPCs `gerar_skus_modelo`/`salvar_sku_manual`)
  estiver aplicada em produção — nenhum desses objetos existe ainda (confirmado: "zero ocorrências
  de 'sku' em `src/` e `supabase/migrations/`", spec do SKU §3, "'sku': zero ocorrências").

**Seção "Preço e Custos" (vira 11) — Mão de obra embutida na tabela:**
- A linha "Mão de obra" de `PrecoTabela.tsx:367-377` deixa de ser só leitura e passa a expandir,
  logo abaixo dela (dentro do mesmo `<tbody>`), o conteúdo hoje renderizado pela seção separada
  `mao_obra` (`PlanejamentoDetail.tsx:1560-1583`):
  - as linhas de serviço do `MaoObraEditor` (categoria/serviço, valor `MoneyInput`, badge de
    estado pendente/aprovada/reprovada, botões Aprovar/Reprovar — gated por `podeAprovar` — e
    remover), seguidas de "+ adicionar serviço" (mockup linhas 201-204);
  - a linha "Custo total" continua logo abaixo (já existe, `PrecoTabela.tsx:378-385`);
  - abaixo do Custo Total: o campo "Observação de mão de obra" (`ObsMaoObraField`, hoje em
    `PlanejamentoDetail.tsx:1575-1579`, mockup linha 208).
  - `PrecoTabela` precisa de props novas para receber o `MaoObraEditor` (ou renderizá-lo por
    dentro): `moLinhas`, `catsServico`, `veCustos`, `podeAprovar`, `onChangeLinhas`, `onAprovar`,
    `onReprovar`, `pendingLinhaId`, `linhasPersistidas` — o mesmo conjunto de props que hoje
    `MaoObraEditor` recebe em `PlanejamentoDetail.tsx:1561-1571`, só repassado por `PrecoTabela` em
    vez de instanciado direto no orquestrador. Como uma tabela HTML não aceita um `<fieldset>`
    dentro do `<tbody>` (mesma observação já registrada no comentário de
    `PrecoTabela.tsx:283-284` sobre custos do BOM), a trava usa `disabled` por controle, igual ao
    padrão já usado ali.
  - Gate de exibir o BLOCO de MO (linhas de serviço + observação): a MESMA condição de hoje,
    `vis.mao_obra = (!isComprado ? true : isEdit) && (veCustos || (isEdit && podeAprovarMaoObra))`
    (`PlanejamentoDetail.tsx:1148`) — só que agora controla um bloco DENTRO da seção `preco`, não
    uma seção própria. Sem essa permissão, a linha "Mão de obra" da tabela mostra só o total (como
    hoje mostra a leitura), sem o bloco expandido.
  - `SecaoSheetKey` perde `"mao_obra"` como seção própria (a chave do TIPO — `mao_obra` deixa de
    estar em `ORDEM_SECOES_SHEET`); o texto "Mão de obra" continua existindo como RÓTULO da linha
    da tabela e como título do bloco interno, só não é mais uma entrada do array de seções
    numeradas.
  - Revenda/importado (`PrecoRevendaBloco`, `RevendaSetores.tsx`): mesmo encaixe (opção A do dono)
    — a MO entra como bloco dentro do bloco de preço deles, não como seção própria. A UI exata do
    `PrecoRevendaBloco` (hoje um grid de campos RO/editáveis, sem tabela) precisa de um bloco
    equivalente ao da tabela manufaturada — decisão de layout do implementador, desde que a MO
    apareça DENTRO do bloco de preço da revenda/importado, não fora.

**Renumeração das demais seções:** puramente mecânica — `ORDEM_SECOES_SHEET` passa a ser
`info, colecao, desenvolvimento, codigos, prova, tecidos, aviamentos, insumos, grade, cad,
tecidos_novo, preco, produto_acabado, grade_revenda, anexos, observacoes, lancamento, relacionado`
(tirando `mao_obra`, acrescentando `codigos` logo após `desenvolvimento`). `numerarSecoes` já
deriva o número certo automaticamente — nenhuma mudança na função, só no array de entrada.

### 5.2 Dados

**Migration própria (Parte B), aditiva:**
```sql
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS titulo_pagina text;
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS peso_kg numeric(10,3) CHECK (peso_kg >= 0);
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS comprimento_cm numeric(10,2) CHECK (comprimento_cm >= 0);
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS largura_cm numeric(10,2) CHECK (largura_cm >= 0);
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS altura_cm numeric(10,2) CHECK (altura_cm >= 0);
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS ncm text;
```
(`ncm` sem `CHECK`: a validação de formato fica no client — ruling 3 — para não rejeitar um NCM
parcial gravado no meio da digitação/importação.)
(Os `CHECK` podem ir em constraints nomeadas separadas se o padrão do repo preferir — ver
migrations recentes de `modelos` para o estilo exato; não há precedente de `CHECK >= 0` numérico
recente em `modelos` para copiar literalmente, então o implementador escolhe a sintaxe dentro do
padrão Postgres/do repo.) Número de migration: escolher algo MAIOR que `20261003100000` (a do
SKU — ainda não aplicada; se a ordem real de aplicação mudar, ajustar para ficar depois da última
migration realmente aplicada em produção no momento, seguindo a regra "sempre depois da mais
recente"). `ALTER TABLE` de `modelos` por ÚLTIMO no arquivo (mesma receita de
`20260930180000_modelo_descricao_produto.sql:12-16`: a tabela `modelos` é a mais usada do app,
então a trava `ACCESS EXCLUSIVE` fica só no resto do arquivo, não no arquivo inteiro).

**Helper do Título — dois espelhos, mesmo padrão de `ref-montar.ts`/`sku-montar.ts`:**
- SQL: função `_titulo_pagina_calculado(nome text, tenant_nome text) RETURNS text` (ou nome
  equivalente), usada (a) por um helper de leitura para consumidores/ERP que precisam do título
  mesmo quando `titulo_pagina IS NULL` (o doc `docs/api-integracao-erp.md` ganha a nota — mesma
  prática já usada pelo SKU, spec do SKU §5, "o quê + quando o dado é final"), e (b) opcionalmente
  por uma VIEW ou por leitura direta no front (o front pode calcular client-side sem round-trip,
  como já dito em §5.1).
- TS: `tituloPaginaCalculado(nome: string, tenantNome: string): string` em algum lugar de
  `src/lib/` (ex. `src/lib/titulo-pagina.ts`), com teste anti-drift comparando os dois lados
  byte-a-byte — mesmo padrão de `norm3`/`_norm3` (`ref-montar.ts` linha 1-4) e
  `montarSku`/`gerar_skus_modelo` (spec do SKU §4.2, "Espelho TS").
- Regra de capitalização: cada palavra do Nome do Modelo com 1ª letra maiúscula e resto minúsculo;
  lista fixa de conectivos PT (`de, da, do, das, dos, e, com, em, para`) fica em minúsculo, EXCETO
  se for a primeira palavra da string (aí capitaliza normalmente). Concatena `" | "` + `tenants.nome`
  (sem transformação de caixa no nome da loja — usa como está gravado).
  Exemplo do mockup: nome "VESTIDO LONGO POEMA" (gravado em maiúsculas, comum no cadastro) →
  "Vestido Longo Poema" + " | " + "Ave Rara" = "Vestido Longo Poema | Ave Rara".

**Draft/payload (Parte B):**
- `Draft` (`modelo-shared.ts:76-131`) ganha: `titulo_pagina: string | null`, `peso_kg: number |
  null`, `comprimento_cm: number | null`, `largura_cm: number | null`, `altura_cm: number | null`,
  `ncm: string | null`.
- `emptyDraft()` (linhas 132-148): os 6 campos nascem `null`.
- `draftFromModeloRow()` (linhas 155-202): `titulo_pagina: data.titulo_pagina ?? null`, `ncm:
  data.ncm ?? null`, mesma regra para os 4 numéricos (`?? null`, sem coerção — são numéricos de
  verdade vindos do PostgREST, ao contrário de textos que usam `?? ""`).
- `ROTULO_CONFLITO_PLAN` (`helpers.ts:11-32`) ganha: `titulo_pagina: "Título para a página"`,
  `peso_kg: "Peso (kg)"`, `comprimento_cm: "Comprimento (cm)"`, `largura_cm: "Largura (cm)"`,
  `altura_cm: "Altura (cm)"`, `ncm: "NCM do Produto"`.
- Payload do Salvar: os 6 campos são do Planejamento (não do Dev) — vão direto no payload, sem
  passar por `aplicarRegrasCamposDev`/`CAMPOS_DEV_DRAFT` (mesma classe de `descricao_produto`, que
  também não está em `CAMPOS_DEV_DRAFT`, `helpers.ts:75-84`). `titulo_pagina`/`ncm`: trim +
  vazio→NULL (`textoOuNull`, já existe em `helpers.ts:88-90`); `ncm` além disso filtra para só
  dígitos e pontos antes de gravar (client-side, ruling 3); os 4 numéricos: `Number(v) > 0 ?
  Number(v) : null` seguindo o padrão de `preco_venda`/`markup_editado` no `Draft` (mas aceitando 0
  quando o CHECK permite — como o CHECK é `>= 0`, 0 é um peso/medida válido; usar `v !== null && v
  !== "" ? Number(v) : null`, não o padrão "0 vira null" de `numOr0` usado em preço).
- `camposParaDuplicar()` (`helpers.ts:137-143`): leva `peso_kg`/`comprimento_cm`/`largura_cm`/
  `altura_cm`/`ncm`/`descricao_produto` (já leva `descricao_produto`; `ncm` entra porque é o mesmo
  tipo de produto — decisão do dono, ruling 5); **tira `titulo_pagina`** (fica de fora do objeto
  retornado, igual a `ref`/`versao`/`modelo_base_id` hoje) — o novo card duplicado nasce com
  `titulo_pagina` ausente do payload de INSERT, ou seja `NULL` = automático, recalculado do nome
  novo.
- `_replicar_cards_plan_tecido_core` (ruling 5): acrescenta `peso_kg, comprimento_cm, largura_cm,
  altura_cm, titulo_pagina, ncm` nas colunas do INSERT e `o.peso_kg, o.comprimento_cm,
  o.largura_cm, o.altura_cm, o.titulo_pagina, o.ncm` nos valores — mesma técnica de
  `descricao_produto` na migration `20260930180000` (linhas 107 e 118: acrescentado ao FINAL da
  lista de colunas/valores, preservando tudo o resto byte-a-byte). Diff esperado: exatamente essas
  2 linhas adicionadas (mesmo padrão de verificação que o teste de `descricao_produto` já faz —
  ver `tests/integration/modelo-descricao-produto.test.ts`, citado no comentário da migration
  linha 7).

### 5.3 Kanban / selos

- `CONDICOES_SECAO_SHEET.preco` passa de `["preco_venda_preenchido"]` para
  `["preco_venda_preenchido", "servico_aprovado", "servico_mo_decidido", "servico_mo_preenchido"]`
  (união com o que hoje é `CONDICOES_SECAO_SHEET.mao_obra`, `selos-secoes.ts:44-51`); a entrada
  `mao_obra` do mapa é removida.
- `selosSecoesSheet()` (`selos-secoes.ts:154-186`): a linha `out.mao_obra = seloDeSecao(...)`
  (linha 178) é removida; a lógica de `precoInformativo`/`out.preco` (linhas 168-172) passa a levar
  em conta também o estado de MO no texto do selo informativo se fizer sentido — MÍNIMO viável:
  manter o selo de Preço mostrando só preço/markup como hoje (o requisito satisfeito/pendente já
  aparece via `r("preco")`, que agora inclui as chaves de MO); não é obrigatório fundir o TEXTO
  informativo de MO dentro do texto de Preço, só o REQUISITO (âmbar quando pendente).
- `EntradaSelosSheet.maoObra` (tipo, linhas 87) deixa de virar um selo PRÓPRIO
  (`out.mao_obra`) — mas o dado (`estadoMO`/`total`) ainda é útil para o bloco de MO dentro da
  tabela de Preço (badge pendente/aprovada/reprovada por linha já vem de `MaoObraEditor`
  diretamente das linhas, não do agregado `EntradaSelosSheet.maoObra` — então este campo do tipo
  pode até ser removido se não tiver mais consumidor; checar no momento da implementação se
  `moEstadoLocal`/`maoObraDevLive`, usados em `PlanejamentoDetail.tsx:1190`, têm outro consumidor
  além do selo).
- Seção Códigos (Parte C): selo próprio, calculado a partir de `modelo_skus` — "N SKU(s) sem
  sigla" (âmbar, conta linhas com `faltas[]` não vazio na última chamada de `gerar_skus_modelo` ou
  numa RPC de leitura equivalente) quando `N > 0`; senão, `seloDeSecao` decide entre "nenhum selo"
  (seção vazia sem requisito pendente) e o que fizer sentido para "ok" (a spec do SKU §4.3 já prevê
  "completo / falta sigla / aviso — só apelido sem sigla" como os 3 estados possíveis do selo desta
  seção).
- `ORDEM_SECOES_SHEET`/`SecaoSheetKey`: acrescentar `"codigos"` (Parte C) e remover `"mao_obra"`
  (Parte A) — ver §5.1 para a ordem exata.

### 5.4 Colaboração

- Título/Peso/medidas/NCM seguem o padrão já estabelecido por `descricao_produto`
  (`data-colab-path`, entrada no `ROTULO_CONFLITO_PLAN`, campo do `Draft` comparado pelo merge
  3-vias `mergeDraft`) — nenhum mecanismo novo de colaboração é necessário.
- REF (movida de seção, mas o campo/`data-colab-path="ref"` é o mesmo) não muda de comportamento
  colaborativo — é o mesmo input, só noutro componente/seção.
- MO embutida na tabela de Preço: os `data-colab-path` das linhas de serviço
  (`mo:${linhaId}`, já existe em `MaoObraEditor.tsx`, ver uso de `data-colab-path` na linha do
  `MoneyInput`) continuam os mesmos — mover o componente de seção não muda os paths, então o merge
  e o anel de presença continuam funcionando sem alteração.
- SKU (Parte C): cada `SKU` editado manualmente precisa de `data-colab-path` próprio (ex.
  `sku:${varianteKey}:${tamanhoKey}`) para entrar no merge por campo — mas a edição de SKU não
  passa pelo Salvar da página (é uma RPC imediata, `salvar_sku_manual`, como Aprovar/Reprovar MO
  hoje) — então não compõe o payload do `Draft`/merge 3-vias da página; o "conflito" relevante aqui
  é o padrão já usado por linhas MO individuais (RPC própria + rev), não o merge do Sheet inteiro.

## 6. Riscos

- **Selo de MO saindo da própria seção.** Quem hoje confia no selo "N pendente(s)"/"reprovada" da
  seção Mão de obra (badge próprio, visível fechado) só vai ver esse sinal fechando/abrindo a seção
  Preço e Custos agora — o selo textual pode ficar mais escondido numa tabela mais longa. Mitigação:
  o requisito do kanban (`r("preco")`) já força o badge âmbar no cabeçalho de "Preço e Custos"
  quando MO está pendente, então o sinal de "falta algo" continua visível fechado — só o detalhe
  "quantos/quais serviços" exige abrir a seção (como já exige hoje abrir "Mão de obra" para ver as
  linhas).
- **Numeração mudando.** Documentação, prints e treinamento de usuário que citam "seção 11 = Preço"
  ou "seção 4 = Ajustes na Prova" ficam desatualizados assim que a Parte A entra em produção (a
  Parte A sozinha já muda a numeração de tudo depois da seção 3, mesmo sem a seção Códigos ainda
  existir — MO some, então TUDO depois de "Desenvolvimento" recua 1 posição até a Parte C entrar e
  recompensar). Mitigação: comunicar a mudança de numeração junto do release da Parte A; não há
  mitigação técnica (a numeração é sempre dinâmica por design).
- **Título automático em telas de terceiros/ERP.** O helper SQL de leitura precisa existir e ser
  documentado em `docs/api-integracao-erp.md` ANTES de qualquer integração externa passar a
  depender de "o título da página" — se um consumidor ler `modelos.titulo_pagina` cru via API,
  verá `NULL` na maioria dos casos (automático) e vai quebrar sem o helper. Mitigação: nunca expor
  a coluna crua para ERP — só o valor calculado (helper/view), igual à recomendação já registrada
  para o SKU.
- **Sequenciamento com o SKU (F3.5a).** A seção Códigos depende de objetos de banco que ainda não
  existem (`modelo_skus`, `sku_config`, etc.) — se a Parte C for implementada antes do F3.5a estar
  em produção, a seção nasce quebrada (sem dados para popular a tabela). Mitigação: já é a ordem
  pedida pelo dono ("assim que terminar o SKU") — não implementar a Parte C até confirmar F3.5a
  aplicado em produção.
- **`_replicar_cards_plan_tecido_core` reescrita duas vezes em pouco tempo.** A função já foi
  redefinida em `20260930180000` para acrescentar `descricao_produto`; esta spec pede outra
  redefinição (Parte B) para acrescentar os 5 campos novos. Cada redefinição precisa repetir o
  corpo INTEIRO (não há "ALTER FUNCTION ADD COLUMN") — risco de divergência acidental de alguma
  outra parte do corpo entre as duas versões se não for feito por diff estrito
  (`pg_get_functiondef` antes/depois, só as linhas esperadas mudando). Mitigação: seguir a mesma
  receita de verificação já documentada no cabeçalho da migration de `descricao_produto`.
- **Revenda/importado sem tabela de Preço.** `PrecoRevendaBloco` hoje é um grid de campos, não uma
  tabela — encaixar a MO "no mesmo lugar" (opção A) exige um layout novo ali, não uma reaproveitação
  1:1 do que foi feito para `PrecoTabela`. Risco de inconsistência visual entre os dois blocos de
  preço (manufaturado em tabela, comprado em grid) se o implementador não seguir a mesma
  organização visual (Preços → MO → Custos, mesma ordem lógica).

## 7. Testes

- **Unit:**
  - `tituloPaginaCalculado()` × espelho SQL (`_titulo_pagina_calculado`), anti-drift — casos:
    nome em maiúsculas, nome com conectivo no início ("Da Vinci"), nome com conectivo no meio
    ("Vestido de Festa"), nome vazio (edge case — decisão do implementador: string vazia ou só " |
    Loja"?), tenant sem nome (não deveria ocorrer, mas testar fallback).
  - `numerarSecoes()` com o novo `ORDEM_SECOES_SHEET` (sem `mao_obra`, com `codigos`) — conferir que
    a numeração das seções 5-15 desloca corretamente com/sem `codigos` visível (antes/depois da
    Parte C).
  - `selosSecoesSheet()` — `CONDICOES_SECAO_SHEET.preco` incluindo as chaves de MO; confirmar que o
    selo de "Preço e Custos" fica âmbar quando só uma condição de MO falha (mesmo com preço
    preenchido).
  - `camposParaDuplicar()` — confirma que `titulo_pagina` NÃO está no objeto retornado, e que os 4
    campos numéricos + `ncm` + `descricao_produto` estão.
  - Filtro de entrada do NCM (client-side): só dígitos e pontos passam, corta em 10 caracteres;
    `textoOuNull` aplicado por cima (vazio → `NULL`).
- **Integração (SÓ na cópia local, `exigeBancoLocal` — ver `tests/README.md`):**
  - Migration da Parte B: `ADD COLUMN IF NOT EXISTS` idempotente (rodar 2×); `CHECK (>= 0)` rejeita
    negativo nos 4 campos numéricos; `ncm` aceita qualquer texto (sem CHECK); inverso remove as
    colunas e avisa perda.
  - `_replicar_cards_plan_tecido_core`: diff `pg_get_functiondef` antes/depois só nas linhas
    esperadas (colunas + valores novos); teste funcional replicando um card com
    peso/medidas/título/NCM preenchidos e conferindo que o card novo os herda (título e NCM
    idênticos ao original; peso/medidas idênticos).
  - Duplicar (via RPC/fluxo do Salvar com `camposParaDuplicar`): card duplicado nasce com
    `titulo_pagina = NULL` mesmo que o original tivesse título editado à mão; `ncm` é copiado
    igual ao original.
  - (Parte C, depois do F3.5a): fluxo completo de `gerar_skus_modelo` chamado a partir da seção
    Códigos — já coberto pela spec do SKU §7; esta spec não duplica esses testes, só garante que a
    UI nova chama a RPC certa nos momentos certos (1ª geração automática pós-Salvar-com-REF, e
    "Regerar SKUs" manual).
- **QA Playwright** (na variante de teste do app, `E2E_BASE_URL=localhost:5173` —
  `reference_qa_baseurl_producao`): abrir card existente → conferir seção 1 com Título
  automático mostrando "Nome | Loja" → editar Título → salvar → reabrir → título editado
  persiste → clicar ↺ → volta a acompanhar o nome; L2 com Nome (50%) | Versão (25%) | NCM (25%),
  digitar NCM com letras (rejeitadas pelo filtro) e com dígitos/pontos (aceito); seção 3 sem REF;
  seção "Preço e Custos" com MO embutida (adicionar serviço, aprovar, remover) sem a seção "Mão de
  obra" separada existir mais; numeração 1-15 batendo com a tabela da §5.1. (Parte C, depois do
  F3.5a: abrir seção Códigos, conferir REF + tabela de SKU populada, editar um SKU à mão, Regerar
  SKUs com AlertDialog.)

## 8. Fora de escopo

- A SUGESTÃO automática de NCM por regra malha/plano × público × tipo de peça × fibra (discussão
  separada, `project_ncm_produto`) — o campo editável simples ENTRA nesta spec (ruling 3); validação
  contra tabela oficial de NCM também fica fora.
- Sheet do Desenvolvimento (`src/components/desenvolvimento/`) — intocado até a F5.
- Qualquer parte da geração de SKU em si (RPCs, colunas de sigla, Config do Formato do SKU) — já
  especificada em `docs/superpowers/specs/2026-09-24-sku-automatico-design.md`; esta spec só
  consome esses objetos na seção Códigos, não os redesenha.
- Exportação de Título/Peso/medidas/NCM/SKU para o ERP — só a nota em
  `docs/api-integracao-erp.md` quanto a "não ler `titulo_pagina` cru"; a integração em si é etapa
  futura.
- Ficha Técnica / impressão: Título/Peso/medidas não foram pedidos para entrar na Ficha Técnica
  impressa (mesma decisão já tomada para `descricao_produto`, `InfoGeraisSecao.tsx:134`, "Não vai
  para a Ficha Técnica").

## 9. Ordem de entrega

Segue a sequência do dono (ruling 10), com o gate adicional do banco do SKU:

1. **Parte A — reorganização de tela, sem banco.** Remove REF da seção 3 (renomeia título),
   funde MO dentro da tabela de Preço/Custos (remove a seção própria), ajusta
   `ORDEM_SECOES_SHEET`/`CONDICOES_SECAO_SHEET`/`selosSecoesSheet`. Pode implementar e testar na
   cópia local imediatamente.
2. **Parte B — campos novos (migration + tela).** Título para a página, Peso/Comprimento/
   Largura/Altura, NCM do Produto. Inclui a migration aditiva (as 6 colunas juntas), o helper
   SQL+TS espelhado do Título, `Draft`/payload/`ROTULO_CONFLITO_PLAN`, redefinição de
   `_replicar_cards_plan_tecido_core`, ajuste de `camposParaDuplicar`. Pode ser planejada e testada
   na cópia local em paralelo com a Parte A; aplicação em produção segue o G-migration (cópia →
   guardiões → dono aplica) ANTES do deploy do front que grava as colunas novas (mesma ordem
   obrigatória já usada para `descricao_produto`).
3. **Parte C — seção Códigos (REF + tabela de SKU).** Só começa depois que o banco do SKU (F3.5a
   da spec `2026-09-24-sku-automatico-design.md`) estiver aplicado em produção. Consome
   `modelo_skus`/`gerar_skus_modelo`/`salvar_sku_manual` já prontos; a REF muda de seção nesta
   etapa (fisicamente sai de "Desenvolvimento" e entra em "Códigos" — mas o CAMPO já não estava
   mais na seção 3 desde a Parte A, que só tirou o rótulo antigo "— equipe e cronograma"; a Parte
   C é quando a REF ganha um LAR novo em vez de ficar solta/realocada provisoriamente — decisão do
   implementador: pode adiar a remoção física da REF da seção 3 até a Parte C estar pronta, para
   não deixar o campo "sem seção" no meio do caminho, desde que o título da seção 3 já mude na
   Parte A).

## Dúvidas para o dono

1. **REF entre a Parte A e a Parte C:** a REF pode ficar temporariamente ainda dentro da seção
   "Desenvolvimento" (só renomeada, sem "— equipe e cronograma") até a Parte C estar pronta, ou o
   dono prefere que a Parte A já esconda/mova a REF para algum lugar provisório assim que ela sai
   do lugar de hoje? (Esta spec assume que ela pode ficar onde está até a Parte C nascer com a
   seção Códigos pronta para recebê-la — evita um estado intermediário estranho.)
2. **Texto do Título quando o Nome do Modelo está vazio:** o card novo nasce sem nome preenchido
   por padrão. O que o campo Título deve mostrar nesse instante — vazio, ou só " | Nome da Loja"?
   (Sugestão desta spec: vazio até o Nome ter ao menos 1 caractere, para não mostrar um título
   estranho tipo " | Ave Rara" logo na abertura do Dialog "Novo Modelo".)
3. **Casas decimais na digitação vs. no banco:** o ruling define `numeric(10,3)` para peso e
   `numeric(10,2)` para as medidas — confirmar se o campo deve TRUNCAR/ARREDONDAR no client-side
   ao digitar mais casas do que o banco aceita, ou se isso é responsabilidade só do banco
   (arredondamento silencioso do Postgres no INSERT/UPDATE).
