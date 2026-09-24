# SKU automático — especificação (F3.5)

**Data:** 24/set/2026 · **Status:** desenho APROVADO pelo dono (24/set) · **Campanha:** Planejamento unificado + Kanban
automático (fase nova F3.5, entregue em duas partes, F3.5a e F3.5b)

## 1. Objetivo

Gerar e manter o **SKU de cada variante × tamanho** do produto a partir da REF, das siglas cadastradas e de um formato
configurável por loja. O SKU fica gravado e pode ser editado à mão. Ele prepara as próximas etapas: integração com ERP
e e-commerce.

Exemplo (formato `REF · Cor · Tamanho`, sem separador):

| Variante | Tamanho | SKU |
|---|---|---|
| 1 — Amarelo | 34 · 36 · 38 | `REF00000001AM34` · `REF00000001AM36` · `REF00000001AM38` |
| 2 — Verde | PPP · PP | `REF00000001VDPPP` · `REF00000001VDPP` |

## 2. Decisões do dono (24/set)

| # | Pergunta | Decisão |
|---|---|---|
| Q1 | SKU gravado ou calculado na hora? | **Gerado automaticamente, mas editável.** Fica gravado. |
| Q2 | Depois de gerado, acompanha mudanças de sigla, formato ou tamanho? | **Fica fixo.** Só muda pelo botão **"Regerar SKUs"**. O SKU **editado à mão nunca é sobrescrito**, nem pelo Regerar. |
| Q3 | "Tamanho em: Letra \| Número" | **Um OU outro por card.** O card novo nasce com o **padrão da loja**, definido na Config. |
| Q4 | Falta sigla (cor, apelido ou tamanho) | **Não gera o SKU daquela linha.** Mostra **"Falta sigla: \<atributo\> \<nome\>"** com link para o cadastro; depois de cadastrar, usa-se "Regerar". |
| — | Encaixe na campanha | Fase própria **F3.5**. A **F3.5a** (banco + cadastros + Config) roda em paralelo. A **F3.5b** (card do Planejamento + "Tamanho em" nos quatro cards) vem depois da F3.4, porque mexe nos mesmos arquivos. |

## 3. Estado atual (levantado em 24/set, na cópia local e no código)

- **Cores:**
  - `cores(id, tenant_id, nome)` e `cores_apelido(id, tenant_id, nome, cor_base_id)` não têm sigla nem código.
  - A edição é feita pelo componente genérico `AttributeTab` em `src/routes/_authenticated/cadastro.atributos.tsx`.
- **Tamanhos:**
  - Ficam em `tenant_config.tamanhos_grade` (jsonb com array de strings), no formato **"Número|Sigla"**, por exemplo `["34|PPP","36|PP",…]`. O editor é `src/components/shared/GradeTamanhosCard.tsx`.
  - Pelo menos uma loja tem itens soltos, sem "|" (`["36","38",…,"PP","P"]`).
  - O split do "|" está reimplementado em ~15 arquivos, sem helper central.
  - A grade do modelo (`modelo_grades.grades`) é jsonb **chaveado pela string inteira** ("34|PPP").
- **REF:**
  - `tenant_config.ref_config` jsonb define `partes`, `num_*`, `sigla_familia` e `sigla_taxonomia`, editado pelo `FormatoRefCard`.
  - A geração fica nos triggers `fn_modelo_ref_auto`/`fn_produto_acabado_ref`/`fn_produto_importado_ref` (helpers `_ref_montar_sigla`/`_ref_juntar`).
  - O espelho TS está em `src/lib/ref-montar.ts`, casado byte a byte com o SQL (`norm3` ↔ `_norm3`).
- **Variantes:**
  - Interno: `modelo_tecido_variantes` → `variantes_tecido(cor_id, cor_apelido_id)`, a partir do Tecido 1.
  - Revenda/importado: `produto_acabado_variantes`/`produto_importado_variantes(cor_id, cor_apelido_id)`.
- **Cards com "tamanho":** Plan. Tecido (os cards são `modelos`), Produto Acabado e Produto Importado. Nenhum tem "tipo de tamanho" hoje.
- **"sku":** zero ocorrências em `src/` e em `supabase/migrations/`. A funcionalidade é inteiramente nova.

## 4. Desenho

### 4.1 Dados (migration própria, F3.5a)

- `cores.sigla_sku text` e `cores_apelido.sigla_sku text`: opcionais, normalizados no salvar. *(G-plano 24/set, R4 → D6 do plano, pendente do dono; recomendação implementada:)* sem acento (lista fixa), só A–Z/0–9, maiúsculas, vazia = sem sigla — o SKU inteiro fica em A–Z, 0–9 e `- . _ /`.
- **Siglas de tamanho:** `tenant_config.tamanhos_sku jsonb`, um mapa de **cada lado do par** para a sua sigla. Exemplo:
  `{"34":"34","PPP":"PPP","36":"36","PP":"PP"}`.
  - `tamanhos_grade` não muda: os pares continuam como estão.
  - Tamanho solto (sem "|") é classificado automaticamente: só dígitos → **Número**, o resto → **Letra**.
  - Helper puro **único** `parseTamanho("34|PPP") → { numero: "34", letra: "PPP" }`, com espelho SQL e teste anti-drift. Os ~15 splits espalhados NÃO são migrados nesta fase (fora de escopo), mas código novo usa só o helper.
- `tenant_config.sku_config jsonb`:
  `{ partes: ["ref","cor_base","cor_apelido","tamanho"], separadores: { "<parteA>|<parteB>": "<sep>" }, tamanho_padrao: "letra" | "numero" }`.
  - Partes ausentes da lista não entram no SKU. Separador vazio = sem separador.
  - Sem `sku_config`, a loja não gera SKU e a seção mostra "Configure o Formato do SKU".
- `modelos.tamanho_tipo text check in ('letra','numero')`, onde null = padrão da loja. Fonte ÚNICA por card:
  - os cards do Plan. Tecido são `modelos`;
  - os Sheets de Produto Acabado e Importado mostram e editam o do **modelo espelho** (1:1, invariante #13);
  - antes de existir o espelho, o produto guarda o valor e o passa ao espelho quando o card nasce.
- **Tabela `modelo_skus`:**
  - colunas: `(id, tenant_id, modelo_id, variante_key, tamanho_key, sku, ref, manual boolean default false, gerado_em, rev)` (`ref` = REF do card na gravação);
  - `variante_key` = chave derivada da COR da variante (cor base + cor apelido), igual no interno e no comprado *(G-plano R1: o id da linha de variante muda a cada Salvar — o do produto é apagado e regravado; o do interno muda ao trocar o tecido mantendo as cores)*;
  - `tamanho_key` = a chave da grade ("34|PPP");
  - SKU único na loja, EXCETO entre réplicas/versões do mesmo produto (mesma REF + mesma cor + mesmo tamanho), que reusam o SKU do original — garantido por gatilho, no lugar da UNIQUE `(tenant_id, sku)` *(G-plano R2 → D5 do plano, pendente do dono; variante B = unicidade estrita)*. `(modelo_id, variante_key, tamanho_key)` continua UNIQUE composta;
  - RLS por tenant + modgate do módulo `criacao`;
  - `_core` com EXECUTE revogado dos três (invariante #9).
- Inverso em `supabase/rollback/`. Aplicação: primeiro na cópia local; em produção só com o G-migration + OK do dono.

### 4.2 Geração (servidor, fonte única)

- **RPC `gerar_skus_modelo(_modelo_id uuid, _regerar boolean default false)`** (wrapper + `_core`):
  - para cada **variante do produto** × **tamanho da grade com quantidade > 0**, monta o SKU pelas `partes`/`separadores`;
  - usa a REF (`modelos.ref`), as siglas de cor base/apelido da variante e a sigla do lado do tamanho escolhido pelo `tamanho_tipo`;
  - sem REF → não gera nada e devolve "aguardando REF";
  - falta sigla → não gera aquela linha e devolve `faltas[] = {atributo, id, nome}`;
  - linha `manual=true` → **nunca** é tocada;
  - `_regerar=false` → só cria as linhas que faltam;
  - `_regerar=true` → recalcula as automáticas;
  - conflito de unicidade (SKU igual a outro da loja que não seja a réplica — D5) → não grava aquela linha e devolve `conflitos[]`, com mensagem em PT.
- **Quando roda:** automaticamente depois do Salvar que deixa o card com REF e sem SKUs (1ª geração), e pelo botão "Regerar SKUs".
  Não roda a cada Salvar (Q2: fixo).
- **Edição manual:** `salvar_sku_manual(_id, _sku, _rev_base, _modelo_id, _variante_key, _tamanho_key)` marca `manual=true`; com `_id` nulo cria a linha manual da variante × tamanho que ainda não tem SKU (em conflito ou com falta de sigla — G-plano R3). Sujeita à mesma unicidade. **Não** trava depois do envio à Explosão: a decisão F3 #1 trava só o que veio do Desenvolvimento, e o SKU é campo novo, de identidade comercial, do Planejamento.
- **Espelho TS** `montarSku(...)` em `src/lib/sku-montar.ts`, só para a **pré-visualização** da Config, com teste anti-drift × SQL (padrão `ref-montar.ts`).

### 4.3 Telas

- **Cadastro > Atributos (F3.5a):**
  - Cor base e Cor apelido ganham a coluna/campo "Sigla SKU".
  - A Grade de Tamanhos ganha uma sigla por lado de cada par, com prévia "34 → 34 · PPP → PPP".
- **Config da Loja (F3.5a):** no card do Formato da REF, um bloco "Formato do SKU" com:
  - escolher e ordenar as partes (chips/arrastar ou setas);
  - campo curto de separador entre cada par;
  - "Tamanho em (padrão)";
  - **pré-visualização ao vivo** com um exemplo real da loja.
  - Salva só `sku_config`, sem upsert da linha inteira (lição RP3 da F2).
- **Planejamento — seção "REF e SKUs" (F3.5b):**
  - REF, "Tamanho em" (Letra | Número) e uma tabela Variante × Tamanho: SKU editável, marcador "manual", linhas "Falta sigla: …" com link e "Regerar SKUs" (AlertDialog: "SKUs editados à mão não mudam").
  - Selo da seção (completo / falta sigla / aguardando REF).
- **"Tamanho em" nos cards (F3.5b):** Plan. Tecido, Produto Acabado e Importado (checkbox/segmentado Letra | Número). A grade exibida em todos segue a escolha; a chave interna segue "34|PPP".

### 4.4 Permissões

- **Siglas e Formato:** quem edita Cadastro > Atributos e a Config da Loja (os mesmos gates de hoje).
- **SKUs do card:** ver = quem vê o Planejamento; editar/Regerar = `canEdit("criacao_planejamento")`. O servidor checa no wrapper.

## 5. Fora de escopo

- Migrar os ~15 `split("|")` existentes para o helper.
- Exportar SKUs para o ERP (etapa seguinte; o doc `api-integracao-erp.md` ganha a nota).
- Código de barras/EAN.
- SKU de insumo/aviamento.

## 6. Riscos

- **REF NÃO é única** *(correção do G-plano, 24/set — o texto anterior dizia "impossíveis pela REF única")*: há 7 pares de cards com a mesma REF na cópia (8 em produção em 22/set), quase todos redigitados à mão (v1/v2), e o Replicar do Plan. Tecido MANTÉM a REF por regra do dono (7c4486b). Réplica/versão reusa o SKU do original (D5, pendente do dono); REF igual por engano em produtos diferentes também dividiria o SKU nas linhas de mesma cor/tamanho — a lista de REFs repetidas vai ao dono antes de gerar. SKU manual pode colidir; o servidor devolve o conflito em PT.
- **Loja com tamanhos soltos:** a classificação automática número/letra pode errar num caso raro (ex.: "3M"). A sigla é editável e resolve.
- **Revenda/importado:** as variantes vêm do produto espelho. Se a F3.4 mudar a grade do comprado, a F3.5b segue a grade única da F3.4.
- **`tamanho_tipo` em cards antigos:** null = padrão da loja. Nenhum dado existente muda.

## 7. Verificação

- Unit: `montarSku` × SQL (anti-drift), `parseTamanho`, classificação de soltos, separadores.
- Integração (SÓ na cópia local, `exigeBancoLocal`):
  - `gerar_skus_modelo`: sem REF, falta sigla, manual preservado, regerar e UNIQUE;
  - ACL dos `_core`.
- QA na cópia (variante própria do app de teste): Cadastro → Config (prévia) → card com REF → SKUs → editar → Regerar.
