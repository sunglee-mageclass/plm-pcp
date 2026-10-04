# Loja de QA "QA Modularidade (local)" (T0, P-257 A)

Arquivo de apoio da QA da frente Modularidade. **Só existe na cópia local** (`127.0.0.1:54422`); nunca em produção.
Os 3 `.sh` não leem `DATABASE_URL` nem `PG*` (URL fixa da cópia) e cada `.sql` aborta
(`loja_qa: banco nao e a copia local`) se o banco não for a cópia (system_identifier + sem `supautils`).
Nada aqui faz DDL. Rode a partir de qualquer pasta, no terminal normal.

## Scripts

| Script | O que faz |
|---|---|
| `./loja-qa.sh` | Cria/atualiza a loja (idempotente: reexecutar não muda nada; módulos e kanban iniciais só são gravados quando a loja NASCE). |
| `./combo.sh <combo>` | Troca os módulos da loja pela `salvar_loja`, como o super admin `teste@teste.com` (claims só dentro da transação; não troca a loja ativa de ninguém). Depois recarregue a página (o `staleTime` dos módulos é 5 min). |
| `./limpar-loja-qa.sh [--dry-run]` | Apaga tudo o que o T0 criou (logins, loja, dados, auditoria da loja) e confere 0 linhas. `--dry-run` faz tudo e termina em ROLLBACK. **Só a pedido do controlador.** |

## Loja, logins e dados

- Loja: `0a0d1000-0000-4000-8000-00000000a001` ("QA Modularidade (local)", ativa). Nasce com os 11 módulos (combo `completo`).
- Logins (GoTrue local, app de teste em `http://localhost:5199` ou `:5188`; senha só da cópia):

| E-mail | Papel | Senha |
|---|---|---|
| `qa-mod-comum@local.test` | `user` (ver + editar em todas as 67 páginas do catálogo, menos `integracao*`) | `QaMod@Local2026` |
| `qa-mod-admin@local.test` | `tenant_admin` (sem `user_permissions`: admin fura) | `QaMod@Local2026` |

- Super admin só para o que exige (Gerenciar Lojas): `teste@teste.com` (a loja ativa dele continua a Loja Teste).
- Cadastro mínimo: grupo/categoria/subcategoria 1 ("QA Grupo", "QA Categoria", "QA Subcategoria"), linha "QA Linha" (markup 3), cor
  "QA Preto", tecido "QA Tecido Malha" (R$ 30/m, categoria "QA Malha") com 1 variante, aviamento "QA Botao 15mm" (`QAA-0001`),
  fornecedor "QA Fornecedor".
- OTB: coleção **"QA Col A"** (subcoleção "QA Sub A", recebe os 3 cards) e coleção **"QA Col Vazia"** (sem card).
- Cards (interno, todos na "QA Col A"):
  - **QA1 Vestido Planejamento**: em Planejamento; `colecao_id` preenchido e **texto da coleção vazio** (Parte 12).
  - **QA2 Vestido Lancar**: Ordem de Criação enviada, etapa `aprovado`, 1 linha de M.O. aprovada (Corte, R$ 70), sem data de lançamento (Parte 6).
  - **QA3 Vestido Explosao**: Ordem enviada, etapa `aprovado` (o gate padrão da Explosão pede Aprovado ou posterior), 1 tecido + variante + grade 32 peças (Enviar à Explosão pela tela).
- Kanban: board padrão **+ a coluna "Liberado" depois de "Aprovado"** (o board padrão não tem coluna depois de Aprovado);
  `kanban_requisitos = {"aprovado": ["ordem_criacao_enviada"], "liberado": ["cq_liberado"]}` (Aprovado precisa de um requisito
  qualquer para ser coluna AUTOMÁTICA: coluna manual fixa o card onde ele está). `kanban_automatico` fica **desligado** (a QA liga
  pela tela como `qa-mod-admin`). Com a chave ligada: sem Produção, QA2/QA3 passam de Aprovado para Liberado; com Produção, ficam em Aprovado.

## Combos (`./combo.sh <nome>`)

Todas as 11 chaves ficam explícitas (`cadastro`, `entrada_saida`, `criacao`, `producao`, `financeiro`, `dashboard`, `otb`,
`distribuicao`, `produto_acabado`, `produto_importado`, `etapas_pl`); `cadastro` é sempre ligado pela `salvar_loja`.

| Combo | Ligados |
|---|---|
| `so-estoque` | cadastro, entrada_saida |
| `estoque-fin` | cadastro, entrada_saida, financeiro, dashboard |
| `cria-sem-producao` | cadastro, criacao, entrada_saida, otb, financeiro, dashboard |
| `cria-sem-es` | cadastro, criacao, otb, dashboard |
| `sem-otb` | os 6 clássicos (cadastro, entrada_saida, criacao, producao, financeiro, dashboard) |
| `sem-dashboard` | os clássicos menos dashboard |
| `pa-sem-producao` | cadastro, criacao, entrada_saida, otb, produto_acabado |
| `completo` | os 11 |
| `modulos:a,b,c` | combo ad hoc: só as chaves listadas (ex.: `modulos:cadastro,entrada_saida,otb`) |

## Limpar

`./limpar-loja-qa.sh --dry-run` (ensaio) e, quando o controlador mandar, `./limpar-loja-qa.sh`. Depois, `./loja-qa.sh` recria tudo
(mesmos UUIDs e mesma senha). Teste que itera "todas as lojas" enxerga a loja de QA enquanto ela existe (ver `t0-report.md`).
