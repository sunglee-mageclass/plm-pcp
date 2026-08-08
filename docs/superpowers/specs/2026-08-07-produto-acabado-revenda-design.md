# Produto Acabado (Revenda) — Design (aprovado em mockup)

**Objetivo:** fluxo de **revenda** — comprar produto pronto em vez de produzir a partir de tecido. Duas telas novas (**Produto Acabado**, planejador; **OC P. Acabado**, ordem de compra) + card **origem=revenda** no Plan. Produto. Pula tecido/CAD/produção; passa por **Explosão (só insumos) → CQ → Direcionamento → Lançar**. Módulo **opt-in por loja** (default OFF). Mockup aprovado em 9 iterações (artifact `a6204a84`, ago/2026); padrões de UI consolidados em `docs/design/ui-padroes.md` **§K–§P**.

## Contexto atual (verificado no código)

- `modelos` já tem o seletor **Origem interno/revenda** no card do Planejamento (`planejamento.tsx:1919`). O Planejamento é **dono** de identidade/taxonomia (nome, grupo, categoria, subcats), coleção/subcoleção/linha/semana/mês/ano, anexos e do **preço digitado** ("Preço para venda" é o único input do setor Preço; markup por modelo NÃO é digitável — `precoInfo`: custo × `linhas.markup` → sugerido `,90` → efetivo; markup real = efetivo ÷ custo, `src/lib/preco.ts`).
- CQ/Direcionamento/Lançar: gate único `cqLiberado()`; grade real em `cad_grades.grades_reais` (invariante #6, escrita atômica); Direcionamento lê grade real por (cad × loja × variante) (#10); Pós do CQ só é exigido se há serviço pós-costura ativo; MO: "sem linha nenhuma = liberada" (#8) — revenda passa nos dois gates sem mudança.
- Padrões vivos: `OcModalShell` (Sheet 70vw / Dialog mesmo form), `OcAnchorRail`, `FileField` (chips + zoom); Plan. Tecido = navegação por grids de cards + rail esquerdo; variante = **cor base · cor apelido** (`src/lib/variante.ts`); módulos opt-in (padrão OTB: `useTenantModules.DEFAULTS` + `admin/lojas MODULE_DEFAULTS`); Insumos: BOM → Explosão → OC Insumo; Financeiro: parcelas por prazo (30/60/90) ≠ parcelas de entrega (#1).

## 1. Modelo de dados (entidade separada + modelo espelho)

- **`produtos_acabados`**: tenant, **`modelo_id`** (espelho em `modelos`, 1:1 via trigger `enforce_unique_fk` — NUNCA UNIQUE em coluna embedada; NULLABLE até criar o card). **Identidade**: o produto NASCE com nome/grupo/categoria/subcats próprios (dialog "+ Novo produto" — necessários pra REF e agrupamento); ao **criar o card**, o modelo espelho herda tudo e **vira o dono** (o produto passa a só espelhar — §K). Demais campos: fornecedor (`empresa_id`+`representante_id`), `ref_fornecedor`, **proporção de grade** (jsonb peso por size-key — todas as cadastradas, 0 = não usa), `qtd_total`, `valor_unitario`, `desconto_pct`, composição. Derivados (bruto, total c/ desconto, v. unit real) **re-derivados no servidor** ao salvar.
- **`produto_acabado_variantes`**: cor base (`cor_id`) + cor apelido (`cor_apelido_id`) + `peso` + `qtd` (auto = total × peso ÷ Σpesos, **maior resto**, editável; Σ ≡ total validado no servidor).
- **`ocs_p_acabado`** (+ variantes/grade): `numero` AUTO por trigger, **`produto_acabado_id` NULLABLE** (OC avulsa permitida — vincular depois), fornecedor, datas (pedido, prevista, entrega), `prazo_pagamento`, `parcelas_entrega`, desconto/valores, grade destrinchada **cor×tamanho** `{pedida, recebida, defeito}` (padrão jsonb tipo `grade_detalhe`), NF, **responsável pelo recebimento** (colaborador), devolução, revisão, `status ∈ {encomendado, recebido}`, anexos (pedido PDF, NF — chips).
- **Códigos automáticos** (trigger, contador por loja): REF do modelo revenda = 2 letras grupo + 1 categoria + 2 subcat1 + **7 dígitos** (`FEVES0000001`); **GRUPO Acessórios** (o gatilho é o grupo, não a categoria) = 2 letras do grupo + **3 letras da categoria** (`ACBOL`) e **grade única** (sem tamanhos). Nº da OC = 3 iniciais do fornecedor + 1 grupo + 2 categoria + `-00001` (5 díg., contador por sigla/tenant, padrão `fn_aviamento_codigo`); grupo Acessórios = 3 fornecedor + literal **`ACE`** (`BELACE-00003`). REF de revenda é gerada **na criação** (não espera Dev); segue editável/manual como hoje.
- Vínculo v1: **1 OC ativa por produto** ("Vincular OC existente" troca); com vínculo, **custo real congela pela OC vinculada** (padrão do tecido — [[project_custo_oc_congelado]]).

## 2. Produto Acabado — planejador (`/criacao/produto-acabado`, entre Plan. Tecido e Plan. Produto)

- Navegação = Plan. Tecido real (§M): página-lista de coleções (OTB) → Sheet full-screen → grid de subcoleções → canvas com breadcrumb + `UnsavedIndicator` no header; **rail esquerdo** colapsável: **Poder de venda · Custo previsto · Produtos·peças · OTB comprometido (qtd, barra) · Tipos de itens**; lanes por **categoria** com contador "N produtos · X pç"; Agrupar/Filtros na toolbar.
- Cards **colapsados por default** (~4–5/tela, chevron CSS). Card aberto = header 2 linhas (nome; REF AUTO · fornecedor · Σpç; taxonomia › coleção · **⧉ editar no Plan. Produto**) + **3 setores acordeão**:
  1. **Compra & variantes** (editável — a tela é dona da COMPRA): fornecedor, REF forn., qtd total, valor unitário — **empilhados, 1 campo por linha** (rótulo à esquerda, valor à direita; formato da planilha de referência do dono); grade de proporção (peso) — **grupo Acessórios: linha de proporção SOME (grade única)**; tabela de variantes (cor base · apelido, peso → qtd por cor, **só por cor** — sem tamanho aqui); desconto → InfoStrip bruto/total/v. unit real/Σ peso.
  2. **Preço** (colapsado com resumo inline "Varejo R$ … · Atacado R$ … · base R$ …"; expandido = InfoStrip §K somente-leitura — preço se digita no Plan. Produto).
  3. **OC vinculada**: InfoStrip (nº ⧉ · status · pedida · recebida · v. unit real da OC) + **Vincular OC existente** / **Fazer pedido (nova OC)** — o caminho pode ser OC primeiro (avulsa → vincular).
- Menu **⋯** no header do card: Criar card em Planejamento · **Aplicar ao modelo** (re-empurra qtd/variantes/custo do produto pro modelo espelho já existente — staging, grava no Salvar) · Excluir produto (AlertDialog). Rodapé da tela: **Subcoleções · Fazer pedido · Salvar** (§L; sem Excluir de tela).
- "Criar card" cria o **modelo espelho** (origem=revenda, com coleção/subcoleção/semana do contexto) → conta no OTB (`otb_orcamento`); "Fazer pedido" cria a OC preenchida e vincula. Caminho inverso: no Plan. Produto, origem=revenda + "criar produto acabado".

## 3. OC P. Acabado (`/entrada-saida/oc-p-acabado`, abaixo de Alertas de Tecido)

- Lista com abas **Encomendadas · Recebidas · Estoque** (Estoque = saldo físico por produto: grade real recebida − Σ direcionado, por variante). Padrão §O: abrir = **Sheet 70vw**; **+ Novo Pedido** = Dialog com o **mesmo formulário**; seções contínuas "N ·" + trilho de âncoras (Recebimento com cadeado até criar/salvar).
  1. **Dados do pedido**: nome, fornecedor, REF forn., nº AUTO, composição, data do pedido, **data prevista de entrega**, prazo de pagamento (30/60/90), **parcelas de entrega** + InfoStrip do **produto vinculado** (ou aviso de OC avulsa).
  2. **Grade, variantes & valores**: proporção de grade (peso); grade destrinchada **cor×tamanho** auto do total pelo peso (**maior resto**, células editáveis); bruto → desconto → total c/ desconto → **v. unit real** (InfoStrip).
  3. **Anexos**: chips `FileField` (pedido PDF; NF anexa ao receber).
  4. **Recebimento**: data de entrega, NF, **responsável pelo recebimento**, devolução, **revisão**; grades **Recebida** e **Defeito** destrinchadas (cor×tamanho, editáveis); **grade real = recebida − defeito** (célula, ≥0). Bloco de valores (peso total/qtd/valor) também empilhado 1 por linha.
- Rodapé: Voltar · Excluir · **Marcar Recebido** · Salvar. Dialog de novo pedido inclui grupo/categoria/subcats 1-2 (necessários pro nº e pro espelho), qtd/valor, prazo, parcelas de entrega, data prevista, proporção de grade e variantes+peso+qtd (+ Adicionar variante).
- **Financeiro**: parcelas a pagar geradas do **prazo** sobre o total c/ desconto — reusar o motor de parcelas existente (paridade com tecido/aviamento; entrega é OUTRA série). Saves atômicos via RPC (padrão `salvar_oc_tecido`); Σ e totais re-derivados no servidor.

## 4. Plan. Produto — card revenda

- Card origem=revenda é **dono**: identidade/taxonomia, anexos & fotos (foto do fornecedor compartilhada — exibida também no Produto Acabado), **insumos** (BOM), **grade cor×tamanho** (auto da qtd por cor pelo peso de tamanho, maior resto, editável) e **preço**: base = v. unit real + Σ insumos; **Preço p/ venda (varejo)** e **Preço atacado** DIGITADOS (2 canais — atacado é campo novo); markup real derivado (preço ÷ base); markup da linha = sugestão (`,90`). Poder de venda usa o varejo (regra única `preco.ts`).
- Custos: `custo_unitario_modelos` ganha ramo revenda — custo = v. unit real (da OC vinculada; previsto = valor unitário do produto) + Σ insumos; máscara de permissão de custos (#12) preservada.
- **Lançar** (botão existente): gates atuais funcionam sem mudança — CQ só Pré (sem serviço pós), MO liberada (sem linhas).

## 5. Fluxo físico (recebimento → downstream, sem fork)

- **Marcar Recebido** (RPC atômica): materializa o **espelho de produção** do modelo — `cad` (1/modelo, trigger existente) + `cad_tecido_variantes` espelhando as variantes do produto (ordem/número + rótulo cor·apelido) + **`cad_grades.grades_reais` = recebida − defeito** pelo **caminho único** (#6) — e abre o CQ (pendente, grade pré-carregada). CQ confirma (pode ajustar; [C1] Σ>0 vale) → Direcionamento (#10) → Lançar. Nada downstream muda.
- **Explosão**: modelo revenda tem BOM só de insumos → a explosão existente naturalmente só traz insumos (falta → OC Insumo); garantir que modelos revenda entram no escopo da explosão.

## 6. Módulo, permissões, segurança

- Módulo **`produto_acabado`** opt-in default OFF (override nos DOIS pontos, padrão OTB) + toggle em Config da Loja; gate na sidebar E nas RPCs (`tenant_module_enabled`). Desligar não apaga dados.
- Page keys novas `criacao_produto_acabado` / `entrada_oc_p_acabado` (canView/canEdit, sidebar). Custos/preços respeitam `_pode_ver_custos()`. RPCs padrão wrapper+`_core` com REVOKE dos TRÊS (#9); RLS por tenant em todas as tabelas novas; storage por `tenantPrefix()`.

## Testes

- **Unit**: split maior resto (Σ ≡ total; casos 198÷3 e 100÷3), geradores de REF/nº (inclusive grupo Acessórios → ACE/3 letras), cadeia de preço (bruto→desconto→unit real→base→markup real), saldo da aba Estoque.
- **Integração transacional**: criar produto → criar card (conta no OTB) → fazer pedido → receber (espelho cad+variantes+grades_reais atômico) → CQ→Direcionamento gate; OC avulsa → vincular; parcelas por prazo; troca de vínculo; módulo OFF bloqueia RPC; permissão de custos mascara; deletes com guarda.
- QA visual das 2 telas (claro+escuro, mobile) contra §K–§P.

## Fora de escopo (YAGNI)

Colab (rev+merge) nas telas novas (adotar depois se houver edição simultânea real); workflow completo de devolução (campo texto v1); múltiplas OCs simultâneas por produto; código de barras; leitura ERP; edição em massa; sync retroativo de preço atacado para modelos manufaturados.
