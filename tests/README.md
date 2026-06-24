# Testes — sisTrama

Primeira suíte automatizada do projeto (Vitest). Dois níveis:

| Comando | O que roda |
|---|---|
| `npm test` | tudo (unit + integração) |
| `npm run test:unit` | só os puros (sem banco) — rodam em qualquer lugar |
| `npm run test:int` | só integração (precisa de credencial de banco) |
| `npm run test:watch` | modo watch |

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
