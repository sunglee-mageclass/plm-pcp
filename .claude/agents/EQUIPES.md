# EQUIPES — composição de times por tipo de trabalho

Playbook operacional: **que time montar para cada tipo de tarefa**, quais fichas
(`.claude/agents/*.md`) e SSOTs cada papel carrega, e em que modelo roda. O
orquestrador (sessão principal) consulta ESTE arquivo ao receber uma tarefa.

## Mecânica (como as fichas viram agentes)

- ⚠️ As fichas NÃO são invocáveis por nome no harness (`subagent_type:"code-reviewer"`
  → erro). O orquestrador **lê a ficha e carrega o conteúdo** (papel/checklist/regras)
  no prompt de um subagente `general-purpose`/`Plan`/`Explore`.
- **Modelos por papel** (política do dono): sessão = Opus (coordenação) · planejar =
  **Fable** · executar = **Sonnet** · revisar rotina = **Opus** · revisar/planejar
  SENSÍVEL (banco destrutivo, RLS/RPC, financeiro, arquitetura) = **Fable**. O dono
  NÃO troca `/model` — tudo via subagente.
- **PRÉ-VOO obrigatório**: antes de despachar um time, conferir se a ficha bate com o
  estado atual do sistema na área da tarefa. Ficha defasada → **atualizar a ficha
  PRIMEIRO**, depois despachar (regra do dono, ago/2026). Última auditoria completa
  das 14 fichas: ago/2026.
- Execução paralela: arquivos disjuntos; commit com `git commit --only <path>`
  (SEM o separador `--` — falha no git 2.52) ; nunca `git add .`.
- QA: nunca semear banco; `E2E_BASE_URL=http://localhost:5173` (default é PRODUÇÃO);
  reusar o :5173 do dono sem matar; `domcontentloaded`; limpar temporários só por
  nome próprio (nunca `rm -rf` — scratchpad é compartilhado).
- **Revisão é AUTOMÁTICA**: toda mudança de código passa pelo checklist do
  `code-reviewer` antes de "pronto" — o dono não precisa pedir.

## Times por tipo de trabalho

### 🐛 CORREÇÃO (bug)
| Etapa | Ficha(s) carregada(s) | Modelo |
|---|---|---|
| Trivial (1 linha, causa óbvia) | — (orquestrador direto + verificação) | Opus (sessão) |
| Diagnóstico (não-trivial) | `debug-expert` (mapa de suspeitos, causa raiz ≠ sintoma) | Opus; **Fable** se complicado |
| Correção | executor + `domain-plm-pcp` (se regra de negócio) ou `data-engineer` (se banco) | Sonnet |
| Revisão (automática) | `code-reviewer` | Opus |
| Gate | `qa-engineer` (tsc≠build, anti-drift, suíte, E2E se UI) | Sonnet |
| Pós (se mudou regra de negócio) | `docs-keeper` (3 docs + CLAUDE.md + memória) | Sonnet |

### ✨ FEATURE (comportamento novo)
| Etapa | Ficha(s)/SSOT | Modelo |
|---|---|---|
| Escopo | `product-lead` + `domain-plm-pcp` (não re-propor o que existe; regras de domínio) | Opus |
| Design/mockup (se tem UI) | ver time **DESIGN/MOCKUP** abaixo → **aprovação do dono** | — |
| Plano | `architect-system` + `domain-plm-pcp` (+ `data-engineer` se schema) | **Fable** |
| **Gate: OK do dono no plano** | — | — |
| Build | executor(es); paralelos se arquivos disjuntos | Sonnet |
| Revisão (automática) | `code-reviewer` (+ `security-auditor` se RLS/RPC/storage/permissão) | Opus |
| Gate | `qa-engineer` | Sonnet |
| Entrega | `release-shipper` (build/tsc → migração `psql -f` c/ txn revertida+diff → push na branch ATIVA) | Opus |
| Pós | `docs-keeper` | Sonnet |

### 🔧 MODIFICAÇÃO (mudar comportamento existente / refactor)
Igual à FEATURE, com **2 diferenças obrigatórias**:
1. **Carregar o plano/spec ORIGINAL** da feature em `docs/superpowers/plans|specs/`
   (é pra isso que o histórico serve — as decisões e trade-offs de quando foi construída).
2. Planejamento com ênfase em **invariantes e efeito downstream**: `domain-plm-pcp` +
   `debug-expert` (quem mais lê a mesma RPC/queryKey/coluna/tabela; gates que olham
   2 tabelas; flags derivadas por trigger).

### 🎨 DESIGN / MOCKUP (decisão de layout)
| Item | Fonte |
|---|---|
| Padrões (SSOT) | `docs/design/ui-padroes.md` §A–§R (+ `ui-padroes.html` guia visual) |
| Checklist anti-reincidência | memória `reference_mockup_padroes` (23 itens: fidelidade ao form real, aritmética fecha, Excluir destructive…) |
| Rito | skill `ui-ux-pro-max` (3 lentes → mockup → **aprovação do dono** → implementar) |
| Lentes | `cognitive-ergonomist` (carga cognitiva) + `ui-ux-mobile` (mobile 44px/card-table) | 
| Regras | tema CLARO por default; campos/rótulos REAIS da tela; editar=Sheet / novo=Dialog (regra dura) |
Aprovado → segue como FEATURE (do Plano em diante).

### 🔍 AVALIAÇÃO UX (auditar fluxo existente)
| Item | Fonte |
|---|---|
| Metodologia (SSOT) | `docs/ux-avaliacao-metodologia.md` (3 lentes via Playwright, axe/WCAG, severidade × viewport) |
| Lentes | `ux-tester` (fluxos) + `ui-ux-mobile` (mobile) + `cognitive-ergonomist` (carga) — read-only |
| Laudos anteriores | `docs/ux-avaliacao/` (baseline de jul/2026) |
| Saída | laudo por tela + síntese priorizada → vira backlog do `product-lead` |

### 🗄️ BANCO / MIGRAÇÃO / SEGURANÇA (sensível — ponto de não-retorno)
| Etapa | Ficha(s) | Modelo |
|---|---|---|
| Plano | `data-engineer` (invariantes, UNIQUE→trigger, aviamento por variante) + `security-auditor` (REVOKE-dos-3, IDOR, modgate) | **Fable** |
| **Gate: OK do dono** | — | — |
| Aplicação | `release-shipper`/`devops-specialist` (`psql -f`; destrutiva em `BEGIN…COMMIT` idempotente; diff `pg_get_functiondef`; teste txn revertido) | Sonnet/Opus |
| Revisão | `security-auditor` + `code-reviewer` | **Fable** |
O orquestrador AVISA o dono antes ("essa é sensível") — política de modelos.

### 🚀 ENTREGA / RELEASE
`release-shipper` (ponta a ponta) + gate `qa-engineer` + `devops-specialist` para
deploy Cloudflare (`npm run deploy` é MANUAL, só a pedido do dono).

## SSOTs e docs por contexto (o que carregar além das fichas)

| Contexto da tarefa | Carregar |
|---|---|
| Qualquer | `CLAUDE.md` (automático na sessão) |
| UI/telas | `docs/design/ui-padroes.md` |
| Rotas novas | `src/routes/README.md` (file-based routing; NÃO criar convenção Next/Remix) |
| Testes | `tests/README.md` + ficha `qa-engineer` |
| Dados/fórmulas/etapas | `docs/mapeamento-campos-calculos.md` |
| Integração ERP | `docs/api-integracao-erp.md` |
| Modificar feature existente | o plano dela em `docs/superpowers/plans/` |
| Insumos/etiquetas | `docs/etiquetas-material-completo-design.md` |

**NÃO carregar** (estado de execução, não conhecimento): `.superpowers/sdd/*`,
`.superpowers/tracker-lote*` — são ledgers/relatórios de execuções passadas.

## Manutenção deste playbook

- Novo tipo de trabalho recorrente → adicionar time aqui.
- Ficha atualizada com jurisprudência nova → nada a fazer aqui (o time referencia a
  ficha, não o conteúdo).
- Quem zela: `docs-keeper` (junto do CLAUDE.md) + o orquestrador a cada uso.
