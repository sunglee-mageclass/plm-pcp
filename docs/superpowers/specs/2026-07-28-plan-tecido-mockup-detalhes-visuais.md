# Plan. Tecido — Guia de detalhes visuais do mockup (referência obrigatória por fase)

> **Propósito:** extrair TODOS os detalhes visuais/comportamentais do protótipo (v10) para que a
> implementação de cada fase já saia com a cara do mockup — sem o dono ter que corrigir peça por peça.
> **Fonte viva:** o Artifact do protótipo. **Regra:** ao implementar qualquer peça, conferir a seção
> correspondente aqui ANTES de considerar a peça pronta. Marcado por fase: `[1b]` `[2]` `[3]` `[4]` `[4.2]`.

## 0. Tokens (já batem com a paleta oklch do projeto — usar via Tailwind)
`ground #F4F6F9 · surface #FFF · surface-2 #EEF2F7 · ink #16233B · ink-2 #33455F · muted #647389 ·
border #DCE3ED · border-2 #C7D2E0 · accent #2F5C93 · accent-strong #1E3E63 · accent-soft #E7EFF8`.
Semânticas: âmbar `#B06E12/bg #FBEED6`, verde `#2E7D4F/bg #E4F1E9`, vermelho `#C4453B/bg #F8E4E2`.
Raios 12/8px. **Dark theme espelhado** (o projeto já tem). `tabular-nums` em toda métrica. Números
digitáveis SEM setinhas (`NumberInput` type=text já resolve).

## Padrões gerais (todas as telas)
- **App-shell**: header/topbar + conteúdo scrollável + **action bar inferior sticky** (nunca ações no topo).
- **Breadcrumb clicável** (topbar): segmentos navegáveis com `cursor-pointer` + underline no hover. `[1b ✔]`
- **Chips**: pill `rounded-full`, texto 12px semibold; ativo = fundo accent + texto branco; inativo = borda + texto muted, hover borda accent.
- **Cards de lista**: `rounded-lg border`, `shadow` suave, hover `translateY(-2px)` + borda accent.
- **Selos de status** (chip): âmbar (pendente/sem fornecedor), verde (ok/pronto), com bolinha `d`.
- **Badges de proveniência** (excelente do mockup — manter): `est.` (estimativa), `auto`, `Dev` (com tooltip "vem do Desenvolvimento"), `prev.`. Estilo: 9px uppercase, fundo surface-2/borda. `[4]`
- **Ações destrutivas** (remover cor/material/categoria): AlertDialog de confirmação (padrão do sistema). `[4/4.2]`
- **Alvos de toque ≥44px no mobile** (padrão do projeto). `:focus-visible` visível em TODO interativo.

## 1. Tela COLEÇÕES `[1b — aplicar agora]`
- Header: **eyebrow** "Estilo & Engenharia" (11px uppercase accent) + **h1** "Plan. Tecido" (22px, -0.4 tracking) + subtítulo muted "Escolha uma coleção. (Só clicar e entrar.)".
- Grid de `colcard` (min 240px): **só o nome** (16px semibold) + "abrir →" (accent, à direita). Hover lift + borda accent. **Sem descrição, sem métricas** (decisão do dono).
- Mantém filtros/ordenação existentes, mas os CARDS no padrão acima.

## 2. Tela SUBCOLEÇÕES `[1b — polir agora]`
- Header: eyebrow "Planejamento de tecido" + h1 {coleção} + subtítulo.
- `subcard` (min 300px): **nome** + **chip de status** (sem fornecedor / N/N prontas / pronto p/ pedido) na mesma linha; **chips das categorias** de tecido (accent-soft) + "N sem categoria" (muted); rodapé **"N modelos"** e **Poder de venda** (gated → "R$ —" até ter fornecedor `[3]`).
- **Action bar inferior**: `[‹ Coleções]` · spacer · **Poder de venda total** (métrica) · **[Fazer pedido — coleção inteira]** (verde; gated + tooltip do motivo). `[2]`

## 3. CANVAS — layout `[1b estrutura ✔ · polir]`
- **Trilho do resumo** (46px, fixo à esquerda, sempre visível): botões verticais **Resumo · A comprar · OC**; ativo destacado. Resumo/detalhar abrem como **extensão** (empurram, não sobrepõem). `[3]`
- **Painel Resumo** (322px, à esquerda do trilho quando aberto). Blocos `[3]` — ver §4.
- **Drawer/subsheet** (420px) entre resumo e work; abre por "detalhar" (toggle); tabela por tecido→variante. `[3]`
- **Área de trabalho**: chips de filtro (Todos (N) | Categoria (N) | Sem categoria (N)) `[1b ✔]`; header "Tecidos · N categorias" + **Recolher/Expandir todos** `[4.1 ✔]` + **+ categoria** `[1b ✔]`; lanes.
- **Action bar inferior do canvas**: `[‹ Subcoleções]` · **selo salvo/não-salvo** (chip) · spacer · **Poder de venda · {sub}** · **[Fazer pedido — {sub}]** (verde, gated) · **[Salvar]** (primary). `[2/3]` (hoje tem Voltar/Desfazer/Pedido/Salvar).

## 4. Painel Resumo — blocos (ordem) `[3]`
1. **Pendências p/ planejamento**: linhas com bolinha âmbar + contagem (sem categoria, sem tecido/fornecedor, sem card, mão de obra não aprovada, divergência de cor). "Sem pendências" (verde) quando zerado.
2. **A comprar (encomenda)** + "detalhar": linha por categoria com **bolinha de status** (g/a/n) + metros; linha "Forros (dentro dos modelos)"; **Total = tecido + forro** (NÃO duplicar forro na linha da categoria). `[1b: usar tecidoMetros]`
3. **Poder de venda (previsto)**: valor grande; **gated** → "R$ —" + aviso âmbar até ter fornecedor; senão mostra realizado + "N de M modelos com fornecedor".
4. **OCs vinculadas**: cada OC = **número + tecidos** (linha clicável → drawer da OC) + "vincular OC existente".
5. **Situação da OC — por OC**: um quadro por OC (Pedida/Entregue/Reservada/Usada/Sobra) + "detalhar"; **reserva/sobra AO VIVO** (recalculam com a edição dos cards).

## 5. LANE (por categoria) `[1b estrutura ✔ · polir]`
- Header: **nome da categoria** (semibold) + **count pill** "N modelos · X m" + **selo de prontidão** (`sem fornecedor` cinza / `X/N com fornecedor` âmbar / `pronta p/ pedido` verde) + `[Pedir]` verde (quando pronta) `[2]` + "×" remover categoria `[1b ✔]`.
- Track: `flex gap overflow-x-auto`, cards `shrink-0`. Lane vazia = placeholder tracejado com instrução. `[1b ✔]`

## 6. CARD editável `[4 — o grosso do polimento]`
- **Largura 342px** (colapsado 300px). Faixa **âmbar 3px à esquerda** quando algum material sem fornecedor.
- **Header**: checkbox seleção (canto) · **thumb 36px** (gradiente + iniciais / foto) · nome (13px semibold) + sub-linha (ref · N pç · X m) · **selo de status** (verde "ok" / âmbar "N/M") · ícone divergência âmbar se houver `[4.2]` · **caret recolher**. Header é a alça de arraste `[4.2 dnd]`.
- **Grade — proporção por tamanho** (fixa no topo, não colapsável): caixas 30px, número centrado, placeholder 0, label do tamanho embaixo. `[4.1 ✔]`
- **OC vinculada** (quando a subcoleção tem OCs): select filtrado pelos tecidos do modelo — **só quando NÃO há vínculo do Desenvolvimento** (se houver, mostra o do Dev com cadeado, read-only). Ao **Aplicar ao modelo**, a OC escolhida no plano deve **propagar pro modelo/Dev** (decidir com o dono se cria o vínculo que congela custo). `[2]`
- **Acordeão** (estado aberto persistido): **Tecidos & Forros** (múltiplos tecidos/forros, cada um: seletor de tecido **filtrado pela categoria da lane** `[4.2]` + fornecedor inline verde + consumo m/pç com selo est./Dev-lock `[4.2]` + **cores/variantes com grade em pç** + "+ adicionar cor" cor base+apelido `[4.2]` + alerta divergência `[4.2]`); **Custo & Preço** (custo tecido auto + custo forro auto `[4.1 ✔]` + materiais prev./Dev + mão de obra prev./Dev + **Aprovar/Reprovar mão de obra** só se avançado + custo total + markup linha + preço sugerido + preço p/ venda).
- **Rodapé**: **Criar card no Planejamento** (se não existe) OU **Aplicar ao modelo** (se avançado) OU nota "avance no Desenvolvimento". (Já existe.)
- **Colapsado**: mostra **variantes + metragem por variante** (mini), não só o total. `[4]`

## 7. Diálogos
- **+ adicionar cor** `[4.2]`: menu de cor **base + apelido**; **filtra pelas cores do tecido** quando há artigo; senão, todas as combinações.
- **Aplicar categoria** `[1b ✔]`: lista categorias da subcoleção + "Sem categoria" + "+ nova".
- **Fazer pedido** `[2]`: **paginado, 1 OC por fornecedor**; por OC: **prazo de pagamento DIGITÁVEL (dias)** + **parcelas de recebimento** + data prevista (`DateField`) + itens; Anterior/Próxima + "Gerar N OC(s)"; vincula OC à subcoleção + auto-atribui ao modelo.
- **Aplicar ao modelo** `[4]`: confirma (staging) grade/cores/custos → grava no Salvar do Dev.

## 8. Comportamentos-chave
- **Poder de venda gated** por fornecedor (resumo/cards/subcoleção). `[3]`
- **Pedido gated por categoria** (todos os modelos da categoria com fornecedor); botão desabilitado com **tooltip do motivo**. `[2]`
- **Situação da OC ao vivo**: reserva = demanda dos cards atribuídos; sobra recalcula. `[3]`
- **Divergência de cor**: cor planejada que não existe no tecido → alerta + "remover divergentes". `[4.2]`
- **Consumo compartilhado com Dev**: travado + selo quando o modelo é avançado. `[4.2]`
- **Re-render cirúrgico**: não reconstruir o canvas a cada tecla (preservar scroll/foco). `[4]`

## Features pré-existentes — decisões manter/dropar (aprovadas pelo dono, jul/2026)
- **"Por linha / Por tecido" (VisaoPorTecido)** → **DROPADO** `[1b ✔]`.
- **PaletaColecao ("Insumos da coleção")** → **DROPAR**: o seletor de tecido do card passa a filtrar **só pela categoria da lane** (não mais pela paleta manual). Ajustar `MaterialBlock` (filtro por categoria) e o "Aplicar tecido" em massa. `[4.2]`
- **"Usar estoque existente" (por card)** → **MANTER**: se vai usar estoque, precisa da funcionalidade (a-comprar vs usar-do-estoque). `[manter]`
- **Categoria de PRODUTO no card** → **MANTER**: é dado do modelo (alimenta o "Criar card"); não confundir com a categoria de tecido (lane). `[manter]`
- **OC por SLOT (SlotOcHint)** → **SUBSTITUIR** pelo **"OC vinculada" por modelo** da Fase 2 (filtrado pelo tecido + auto-atribuição no pedido). Um conceito só. `[2]`
- **OC vinculada do Desenvolvimento (vinculos, congela custo)** → **MANTER** (é o vínculo do Dev, cadeado; diferente do hint do plano). `[manter]`

## Status de aplicação (atualizar conforme avança)
- `[1b]` estrutura FEITA (nav, lanes, chips, aplicar categoria, resumo escopado). Falta polir cards de coleção/subcoleção.
- `[4.1]` FEITO: grade compacta no topo, recolher/expandir todos, custo tec/forro separado.
- Pendente: coleções/subcoleções polimento `[1b]`; Fase 2 (pedido); Fase 3 (resumo/detalhar/trilho); Fase 4 card + 4.2 (forro grade própria, divergência, consumo Dev, cor-primeiro).
