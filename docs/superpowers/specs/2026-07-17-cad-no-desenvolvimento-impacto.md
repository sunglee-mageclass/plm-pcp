# CAD dentro do Desenvolvimento — Análise de Impacto (pré-design)

**Data:** 2026-07-17
**Status:** investigação (feita por 6 lentes paralelas) — insumo para o brainstorm do design.

## A proposta (do dono)
1. **CAD vira seção "4. CAD"** dentro do card de Desenvolvimento (não é mais tela separada).
2. A **grade do CAD deixa de existir** — a grade fica na seção de Grade do card (hoje "6. Grade", vira **"7. Grade"** com o CAD entrando como 4).
3. **Imprimir Ficha de Corte** e **Imprimir Ficha Técnica** passam pro card de Desenvolvimento.
4. **Desenvolvimento não envia mais ao CAD** — vai **direto para Serviços**.
5. Sidebar: **Consumo por OC** entra logo abaixo de Desenvolvimento; **"Criação" → "Estilo & Engenharia"**, **"Produção" → "PCP"**.

## Descoberta central: 2 camadas com riscos MUITO diferentes

### Camada A — UI/UX (risco baixo-médio)
Mover as seções do CAD (tecidos/aviamentos/etiquetas/grade), os botões de impressão e o "enviar ao corte" para dentro do card, e reorganizar/renomear o sidebar. As fichas (`FichaTecnica`, `CadFichaCorte`) já são **agnósticas ao lugar** — consomem `useFichaData(modeloId)`; `PrintFicha`/`PrintArea` (portal no body) funcionam em qualquer tela. Botões e seções são portáveis.

### Camada B — Dados/fluxo (risco ALTO)
O `cad` (entidade) e a **grade real** (`cad_grades.grades_reais`) são a espinha dorsal de meia dúzia de fluxos.

**`cad_id` é FK-âncora de ~9 tabelas:**
`estoque_tecido_baixas` (NO ACTION), `cad_grades`, `controle_qualidade`, `producao_terceirizados`, `producao_oficina`, `lancamentos`, `cad_tecidos`, `cad_aviamentos`, `cad_etiquetas`.

**`cad_grades.grades_reais` (a grade real) alimenta:**
- **Direcionamento** (split e-commerce/loja física; servidor lê a grade real autoritativa; trigger `trg_rebaixa_direcionamento_grade` rebaixa se ela muda).
- **CQ Pré**: é QUEM escreve a grade real (`_salvar_cq_core` faz UPSERT em `cad_grades` ao confirmar; desmarcar reverte pra planejada). CQ Pós lê como baseline.
- **Custo real por peça** (`custo_unitario_modelos`, `_dashboard_custos_core`): divide custo por `grade_total_real`.
- **Lançamentos** (foto-amostra por variante), **Oficina/Serviços** (qtd de peças), **Dashboard Comercial** (poder de venda/margem).
- **Corte**: `baixar_estoque_tecido_corte(_cad_id)` — baixa atômica + `deficit[]`; grava o ledger `estoque_tecido_baixas.cad_id`. Custo congelado em `cad_tecidos.custo_cad` (via preço da OC vinculada).

**Onde a grade vive hoje:**
- `modelo_grades` = grade **planejada** (editada no card de dev, seção 6. Grade; e re-editável na tela de CAD — é a MESMA tabela).
- `cad_grades.grades_planejadas` = cópia da planejada ao enviar ao CAD.
- `cad_grades.grades_reais` = grade **REAL**, nasce no **CQ** (Recebimento − Defeito). Só o CQ escreve.

**Gates do fluxo hoje:** Dev(aprovado)→[enviar ao CAD]→CAD→[enviar ao corte, baixa estoque]→Serviços(pré)→CQ Pré(grade real)→[CQ Pós se houver]→Direcionamento→Lançar. Gate único `cqLiberado()`.

## A decisão que define tudo: o que acontece com a ENTIDADE `cad`?

- **Opção A — Remover o `cad` de verdade.** Re-ancorar ~9 tabelas em `modelo_id`, mover grade real pra `modelo_grades` (nova coluna `grades_reais`), reescrever ~15 RPCs (CQ, direcionamento, custo, corte, dashboards, consumo), triggers e testes. **Estimativa dos agentes: semanas; risco de regressão alto** (mexe em invariantes #4/#6/#7/#9/#10).
- **Opção B (recomendada pelas 6 lentes) — Manter o `cad` como registro INVISÍVEL/automático.** As tabelas `cad`/`cad_grades`/`cad_id` continuam; o `cad` é criado **automaticamente** (sem passo manual "enviar ao CAD"). O card de Desenvolvimento passa a **mostrar/editar** as seções do CAD + grade + corte + impressão, lendo/gravando as MESMAS tabelas. Downstream (CQ, direcionamento, corte, custo, dashboards) continua funcionando quase sem mudança de banco. "Enviar ao corte" vira botão no card; "enviar ao CAD" some (vira automático). Sidebar/telas do CAD são aposentadas como tela separada.

**Opção B entrega o objetivo de UX do dono (sem tela de CAD separada, tudo no card, dev→serviços) com uma fração do risco.** O `cad` sobrevive como "encanamento".

## A ambiguidade crítica a resolver: "grade real"
O dono disse "a **grade real** já será no 7. Grade". Mas hoje a grade real é um **fato de produção** (contagem após corte/defeito), que nasce no **CQ** — não dá pra "saber" no dev antes de produzir. Dois entendimentos possíveis:
- **(i) Só unifica a EDIÇÃO da grade**: a seção 7. Grade do dev é a grade **planejada** (como hoje, uma só, sem re-edição no CAD). A grade **real** continua nascendo no CQ (contagem real). Downstream inalterado. ← compatível com Opção B, baixo risco.
- **(ii) Elimina a distinção planejada/real**: existe UMA grade (definida no dev) usada em tudo; o CQ deixa de recontar uma grade real separada. ← muda Direcionamento/custo/CQ profundamente (a grade real deixa de existir como conceito).

## Sidebar (Camada A, confirmado do dono)
- **Consumo por OC** movido pra logo abaixo de **Desenvolvimento** (hoje fica em Produção/PCP). Ordem lógica.
- Renomear seções: **Criação → Estilo & Engenharia**, **Produção → PCP** (só rótulo de UI, sem mexer em rotas/chaves).

## Recomendação para o design
1. **Adotar Opção B** (cad invisível/automático) — atinge a UX sem o refactor de 9 FKs.
2. **Entendimento (i) da grade** (planejada no dev, real no CQ) salvo decisão contrária do dono — mantém Direcionamento/custo/CQ intactos.
3. Fazer em fases: (F1) sidebar reorg/renames + Consumo por OC; (F2) trazer seções/impressão do CAD pro card + "enviar ao corte" no card + cad automático; (F3) aposentar a tela de CAD.

## Arquivos-chave (referência)
- Tela CAD: `src/routes/_authenticated/producao.cad*.tsx`, `src/components/producao/cad/*` (CadEditor, CadActions, CadGradeSection, CadFichaCorte, useFichaData).
- Dev card: `src/components/desenvolvimento/ModeloDetailPanel.tsx` (botão "Enviar ao CAD" ~763-784), `modelo-detail/ModeloGradeSection.tsx`.
- Grade real / RPCs: `_salvar_cq_core`, `_desmarcar_cq_core`, `_salvar_direcionamento_core`, `baixar_estoque_tecido_corte`, `custo_unitario_modelos`, `enviar_modelo_para_cad`, `salvar_cad_completo`.
- Fichas: `FichaTecnica.tsx`, `cad/CadFichaCorte.tsx`, `cad/useFichaData.ts`, `PrintFicha.tsx`, `PrintArea.tsx`.
- Sidebar: `src/components/app-sidebar.tsx`.
