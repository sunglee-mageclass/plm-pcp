# Testes — sisTrama

Primeira suíte automatizada do projeto (Vitest). Dois níveis:

| Comando | O que roda |
|---|---|
| `npm test` | tudo (unit + integração) |
| `npm run test:unit` | só os puros (sem banco) — rodam em qualquer lugar |
| `npm run test:int` | só integração (precisa de credencial de banco) |
| `npm run test:watch` | modo watch |
| `npm run test:e2e` | E2E Playwright no navegador (padrão = app local; ver seção E2E) |

## Unit (`tests/unit/`) — funções TS puras
Sem banco. Cobrem os helpers reais: `format` (moeda/número pt-BR), `artigo-label`,
`kanban-status` (resolução de status do kanban).

## Integração (`tests/integration/`) — banco real, sempre revertido
Cada teste roda em **`BEGIN … ROLLBACK`**: **nada é gravado** (até os testes que
escrevem — corromper parcela, inserir baixa, e até um `reset_loja` — são desfeitos).

Cobrem a espinha do negócio:
- **segurança**: `get_user_tenant_id`, `meu_tenant_ativo`, `tenant_module_enabled`,
  sentinela nil sem usuário, guarda de super_admin no `reset_loja`.
- **invariantes**: Σ(parcelas) == `valor_real_total` por OC recebida; sem parcela
  cross-tenant; sem parcela paga sem data.
- **RPC de negócio**: `recalcular_parcelas` redistribui pro total exato; baixa no
  ledger reduz o físico pelo valor exato; RPCs-chave existem (guarda contra drop).

### Credenciais
Lê `DATABASE_URL` ou, se ausente, `/tmp/dburl.txt` (Session pooler). **Sem credencial,
a integração se auto-pula** (o `npm test` continua passando só com os unit).

⚠️ Hoje aponta para o banco de **produção** em txn revertida — seguro p/ dados, mas é
**local/manual**. Para CI, criar um banco dedicado (branch do Supabase) e setar
`DATABASE_URL` pra ele — **não** ligar contra produção automaticamente.

### Notas do banco atual (jun/2026)
- Todo usuário é **super_admin** (conta do dono); por isso os testes de "sem privilégio"
  usam um UUID sem papel.
- A âncora é a **Loja Teste** (`37889b78…`). Se ela for resetada/repopulada, os testes
  de integração que dependem de dado (parcelas, estoque) se auto-pulam quando não acham
  linha adequada — não falham à toa.

## E2E (`tests/e2e/`, Playwright) — `npm run test:e2e`
O robô abre o app no navegador e confere as telas. **O padrão é o app LOCAL** (P-238 A, out/2026):
sem `E2E_BASE_URL`, roda contra `http://localhost:5173` (o `npm run dev`, que aponta para a cópia do banco
quando servido pelo banco-local); para outro vite local, `E2E_BASE_URL=http://localhost:5199`.
- **Produção só de propósito, no SHELL:** `E2E_PRODUCAO=sim npm run test:e2e`. O `playwright.config.ts`
  lê essa variável ANTES do `.env`, então um `.env` não consegue liberar sozinho.
- ⚠️ Se o `.env` tiver um `E2E_BASE_URL` de produção (fora de `localhost`/`127.0.0.1`), o `npm run test:e2e`
  agora **para no carregamento do config** com a mensagem "E2E apontando para … (fora do computador)":
  exporte `E2E_BASE_URL=http://localhost:5173` (ou tire a linha do `.env`) para rodar local, ou use
  `E2E_PRODUCAO=sim` se quiser mesmo produção. `[::1]`/`0.0.0.0` também contam como "fora do computador".
- `kanban-auto.spec.ts` só roda contra endereço local (é pulada com `E2E_PRODUCAO=sim` + produção).
- Credenciais `E2E_EMAIL`/`E2E_PASSWORD` no `.env` (usuário dedicado da Loja Teste).
