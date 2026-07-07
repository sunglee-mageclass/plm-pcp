# Fornecedores: Empresa (material|serviço) + Representante — spec & plano

Data: 2026-07-07. Status: **Fase 0 em execução.**

## Problema / intenção (do dono)
Hoje a tela "Fornecedores" (`/cadastro/servico`) tem 3 entidades separadas: **Empresas** (fornecedores de material), **Terceirizados** (serviços) e **Representantes** (hoje sem uso). O dono quer **unificar**: quem presta serviço vira **Empresa** também; **Representante** vira o intermediário opcional (com CNPJ próprio) de qualquer empresa.

## Decisões travadas (com o dono)
1. **Empresa tem `tipo`: material XOR serviço** (nunca os dois).
2. **Categorias:** material → `categorias_fornecedor`; serviço → `categorias_terceirizado` (que já tem **etapa pré/pós**). Pré/pós só existe em empresa de serviço.
3. **"Serviço" (terceirizados) deixa de ser entidade** → os 6 viram 6 empresas tipo serviço.
4. **Representante**: CNPJ próprio, ligado a **uma** empresa (rep que atende N empresas = N cadastros, ok). Intermediário **opcional**.
5. **Seleção** (Produção Serviços/Oficina, OC Tecido/Aviamento): filtra por categoria → escolhe a empresa e, opcionalmente, um representante dela. "Direto na empresa" vs "via Representante X" é **explícito/distinguível**.
6. **Onde guarda:** cada registro grava `empresa_id` (sempre) + `representante_id` (opcional).
7. **Financeiro:** paga **quem foi selecionado** — via rep → CNPJ do rep; direto → CNPJ da empresa. Valores não mudam, só o destino.

## Modelo atual (mapa de impacto)
- `empresas` referenciada por: representantes, artigos, aviamentos, ocs_tecido, ocs_aviamento, parcelas, empresa_categorias_fornecedor.
- `terceirizado_id` em: `producao_terceirizados`, `producao_oficina`, `terceirizado_categorias`.
- Financeiro de serviço: `parcelas_servico.producao_terceirizado_id` (prestador vem por dentro).
- `representantes(empresa_id, cnpj, razao_social, …)` — já tem CNPJ+empresa; **0 referências** hoje (cadastro sem uso).
- 17 RPCs mencionam serviço/terceirizado; ~14 telas no front.
- Volumes: empresas 4, terceirizados 6, producao_terceirizados 6, representantes 2.

## Plano em fases (expand → migrate → contract; nada é dropado até a Fase 5)
### Fase 0 — Fundação aditiva (invisível) — `20260707200000` (revisada pós-review do time)
- `empresas.tipo` ('material' default | 'servico', check).
- **`empresas` ganha campos fiscais** (cnpj, razao_social, situacao_cadastral, telefone, email, logradouro, cep, municipio, uf, contato, observacoes) — hoje a empresa só tinha `nome_fantasia`; o CNPJ vivia só no representante. Necessário pra empresa ser payee.
- `empresa_categorias_servico` — espelha `empresa_categorias_fornecedor` (RLS via empresa `to authenticated` + trigger de tenant com `revoke execute`).
- `representante_id` (nullable, FK NO ACTION) em: **ocs_tecido, ocs_aviamento, producao_terceirizados**. NÃO em `parcelas` (payee sai por join com a OC) nem `producao_oficina` (tabela morta; oficina viva = producao_terceirizados cat "Oficina").
- **Trigger mesmo-tenant** (`enforce_representante_tenant`) nas 3 tabelas: impede vincular rep de outra loja (a FK não garante tenant).

### Fase 1 — Migração serviço→empresa
- Cada `terceirizados` → 1 `empresas` (tipo servico). **Só há `nome_responsavel` pra copiar** (`terceirizados` não tem CNPJ) → vira `empresas.nome_fantasia`; campos fiscais ficam pro dono preencher depois (F2). Mapa terceirizado_id→empresa_id.
- `terceirizado_categorias` → `empresa_categorias_servico`.
- Add `empresa_id` em producao_terceirizados (só ela — `producao_oficina` é morta); backfill via mapa; **manter terceirizado_id** (dual) até F5.
- **Guarda tipo↔categoria**: trigger/CHECK impedindo `empresa_categorias_servico` em empresa tipo material (e vice-versa no fornecedor). A regra "material XOR serviço" passa a valer no banco, não só na UI.
- Atualizar RPCs de leitura pra usar empresa_id (dashboards, custo, cq_oficina, ranking, servicos_financeiro).

### Fase 2 — Tela Fornecedores nova
- Aba **Empresas** ganha `tipo`; empresa de serviço mostra categorias de serviço (pré/pós). Some a aba "Serviços".
- Aba **Representantes** passa a ser usada; guarda de exclusão (rep em uso).
- **Notas do review da F1 (resolver na F2):**
  - **Re-sincronizar no início da F2**: a tela "Serviços" segue escrevendo só em `terceirizados` até a F2. Ao reorganizar, (a) re-rodar a F1 (idempotente) p/ pegar serviços criados no intervalo e (b) trocar o caminho de escrita p/ `empresas`/`empresa_categorias_servico` (com DELETE de categoria removida — o insert-only da F1 deixaria fantasma). Nada quebra antes disso pq nada lê `empresa_id`/`empresa_categorias_servico` até a F3.
  - **Renome + proveniência**: as 6 empresas migradas têm nome de FUNÇÃO/pessoa ("Bordador", "Caseador", "Edson"…). A F2 deve mostrar "migrado de Serviço" (via `origem_terceirizado_id`) e pedir pro dono revisar nome + preencher CNPJ antes de virarem payee.
  - **Select de empresa do Representante** (`cadastro.servico.tsx:280`, key `["empresas-options"]`): por design lista empresas de qualquer tipo (rep serve material E serviço) — deixar distinguível (tipo) na F2.

### Fase 3 — Seleção empresa + representante
- Produção Serviços + OC Tecido/Aviamento: seletor por categoria → empresa + rep opcional, com "direto" vs "via rep" distinguível. (Oficina roda em producao_terceirizados.)
- Grava empresa_id + representante_id (a trava mesmo-tenant já está no banco desde F0).
- **Rep só quando `producao_terceirizados.interno = false`** (serviço interno/PL não tem representante).

### Fase 4 — Financeiro
- Payee **derivado por join com o pedido** (não denormaliza coluna no financeiro): OC via `ocs_*.representante_id`, serviço via `parcelas_servico → producao_terceirizados.representante_id`.
- Regra: rep preenchido → CNPJ do rep; senão CNPJ da empresa. Valores não mudam. (Se precisar de snapshot do payee na parcela, decidir aqui.)

### Fase 5 — Limpeza
- Dropar `terceirizados` + `terceirizado_id` (producao_*), após tudo migrado e validado.

## Riscos & mitigação
- Migração de dado (F1) é o maior risco → volume minúsculo, expand/migrate/contract reversível, validado em txn.
- Superfície grande (17 RPCs / ~14 telas) → fases testadas (tsc/build + suíte de integração).
- Financeiro (F4) sensível → valores não mudam, só destino; fase tardia.

## Time (por fase)
- **data-engineer / architect-system**: schema + migração (F0/F1).
- **security-auditor**: RLS/tenant nas tabelas/colunas novas + financeiro.
- **domain-plm-pcp**: regras de negócio em cada fase.
- **code-reviewer**: antes de cada commit. **qa-engineer**: testes.
- **ui-ux-mobile / cognitive-ergonomist / ux-tester**: seleção (F3).
- **docs-keeper**: este doc + CLAUDE.md/memória. **release-shipper**: entrega.
