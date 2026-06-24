
# Plano — destravar build (só frontend) e depois revisar UI

## Diagnóstico

Hoje o preview do Lovable não carrega ("Failed to fetch dynamically imported module") porque há ~70 erros de TypeScript. **97% deles têm uma única causa raiz**: `src/integrations/supabase/types.ts` (gerado pelo Lovable Cloud contra o banco antigo `wccapbvbbejjzpvlvyuf`) está desatualizado em relação ao código fonte (escrito contra o seu Supabase próprio `ruinwcuabilumcspeyjk`). Faltam no types:

- Colunas: `ocs_tecido.is_rolo`, `modelos.revisao_pendente`, `cad.direcionamento_status`, `ocs_tecido_itens.estoque_zerado`, `ocs_tecido_itens.rendimento`
- Retorno de `get_user_tenant_id()` virou `string | null` no types antigo, mas no código atual é sempre `string` (sentinela nil) — quebra ~12 chamadas
- Parâmetros novos das RPCs `dashboard_estoque` e `dashboard_producao` (p_inicio, p_fim, p_colecao, p_linha)

Os outros 2–3 erros são bugs reais de frontend.

## Estratégia

Como você quer **parar de usar o Lovable para o banco**, e o Lovable continua re-gerando o types.ts contra o ref antigo, a forma "frontend-only" de destravar é **editar `src/integrations/supabase/types.ts` manualmente** com as definições que o código já usa. Não toca em nada de backend, nem em RPC, nem em RLS. É um arquivo de tipos no repositório.

Depois disso, com o build verde e o preview carregando, faço a passada visual desktop+mobile.

## Etapas

### 1. Inspecionar o estado atual (read-only)
- Ler `src/integrations/supabase/types.ts` para mapear o que falta
- Ler os ~12 arquivos que reclamam de `string | null` para confirmar que todos chamam `get_user_tenant_id()` ou `useActiveTenantId()`
- Ler trechos de `Rolos.tsx`, `oc-tecido.tsx`, `consumo-oc.tsx`, `entrada-saida.estoque.tsx`, `producao.direcionamento.$modeloId.tsx`, `dashboard.tsx`, `RevisaoErro.tsx` nos pontos com erro
- Confirmar com `npx tsc --noEmit` a lista completa

### 2. Patch único em `src/integrations/supabase/types.ts`
- `ocs_tecido.Row/Insert/Update`: adicionar `is_rolo: boolean | null`
- `ocs_tecido_itens.Row/Insert/Update`: adicionar `rendimento: number | null` e `estoque_zerado: boolean | null`
- `modelos.Row`: adicionar `revisao_pendente: boolean | null`
- `cad.Row`: adicionar `direcionamento_status: string | null`
- Funções `get_user_tenant_id`, `meu_tenant_ativo`, `is_super_admin`, `is_tenant_admin`: `Returns: string` (em vez de `string | null`)
- RPCs `dashboard_estoque` e `dashboard_producao`: adicionar Args `{ p_inicio?: string; p_fim?: string; p_colecao?: string; p_linha?: string }`
- Manter tudo que já existe; só somar

### 3. Corrigir os 2–3 bugs reais de frontend
- `entrada-saida.oc-tecido.tsx:335` — incluir `rendimento` no objeto retornado pelo `.map(i => ...)` (campo já vem da query, só não está no spread)
- `Rolos.tsx:511-514` — tipar o `update()` corretamente para sair do `never`
- Qualquer outro erro residual após o patch de types (auditar com `tsc --noEmit`)

### 4. Verificar build verde
- `npx tsc --noEmit` deve voltar 0 erros
- `npm run build` deve passar
- Esperar preview recarregar e confirmar que não há mais "Failed to fetch dynamically imported module"

### 5. Revisão visual desktop (1236px)
- Rota atual `/` (dashboard) e principais módulos: cadastro, criação, entrada-saida, produção, financeiro, admin
- Validar PageHeader, StatusBadge, tabelas, modais, sidebar
- Listar achados (arquivo:linha + severidade) **sem corrigir ainda**

### 6. Revisão visual mobile (375px via `set_preview_device_viewport`)
- Mesmas rotas, foco em: sidebar/drawer, headers de tela, tabelas largas, modais, formulários
- Validar padrões do `responsive-layout-patterns` (grid + min-w-0 + shrink-0)
- Listar achados

### 7. Entregar relatório
Lista priorizada de achados (P1/P2/P3) com sugestão de correção. **Não aplico nenhuma correção visual nesta rodada** — você decide o que vale a pena mexer.

## O que NÃO vai ser feito

- Nenhuma migration, RPC, policy, trigger ou alteração de schema
- Nada no `supabase/`, nada no banco
- Não vou regenerar types.ts via Lovable Cloud (continuaria desatualizado contra o ref antigo)
- Não vou tocar em `src/integrations/supabase/client.ts` (auto-gerado)
- Não vou aplicar correções visuais ainda — primeiro o relatório, depois você aprova

## Arquivos que serão editados

- `src/integrations/supabase/types.ts` (patch incremental)
- `src/routes/_authenticated/entrada-saida.oc-tecido.tsx` (1 linha — campo rendimento no map)
- `src/components/oc-tecido/Rolos.tsx` (3-4 linhas — tipagem do update)
- Possivelmente 1–2 arquivos extras se o `tsc` ainda reclamar pós-patch

Total estimado: 4–5 arquivos frontend, 0 arquivos backend.
