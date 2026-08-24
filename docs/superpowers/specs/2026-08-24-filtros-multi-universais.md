# Filtros multi-select universais — Design

**Data:** 2026-08-24 · **Tipo:** refactor transversal de UI · **Origem:** feedback do dono ("deixar todos os filtros com o mesmo padrão, todos dropdown mas com checkboxes")

## Objetivo

Padronizar TODOS os filtros de lista-de-opções do app como **dropdown-com-checkbox (multi-select)**, mantendo o popover único "Filtros". Seleções **persistem por tela+usuário** (localStorage). Um "Limpar filtros" visível zera tudo (inclusive o persistido). Binários (2 opções) também viram multi (uniformidade 100%). Cascatas (pai→filho) passam a mostrar a UNIÃO dos filhos dos pais marcados.

## Escopo

**DENTRO:** as ~15 telas que já usam `FilterButton`/`FilterConfig` (inventário completo abaixo). **FORA (fast-follow):** `financeiro.tsx` (3 tabs) e `admin/auditoria.tsx` — hoje usam `<Select>` custom em `children` (misturam data/texto), exigem reestruturação antes; ficam single como estão. Filtros custom não-lista (data, texto, número) permanecem como são em qualquer tela.

## Decisões (confirmadas com o dono)

1. **Multi vira o PADRÃO do `FilterButton`.** Um `FilterConfig` sem `multi` explícito renderiza checkbox-dropdown. Single-select vira exceção opt-in (`single: true`) para os poucos casos que precisam (nenhum hoje entre os option-lists — mas o modo continua existindo p/ filtros de escolha realmente única, ex. um "modo de exibição").
2. **Binários também multi.** Marcar as 2 opções = mostrar tudo (= não filtrar). Aceito.
3. **Persistência:** `localStorage` por `screen` + por usuário (mesma infra do "Mais usados"/`useFilterUsage`). Sem URL. Chave inclui o `screen=` e o `label` do filtro.
4. **Limpar:** o "Limpar filtros" do rodapé do popover zera o estado E o localStorage daquela tela.
5. **Cascatas** (pai multi): o filho mostra a UNIÃO dos filhos de todos os pais marcados; ao desmarcar um pai, seleções de filho que ficaram órfãs são podadas.

## Estado atual (o que já existe / foi feito no S6-anterior)

- `FilterButton`/`FilterConfig` em `src/components/shared/filters.tsx`. Já suporta `multi:true` (feito ao atender o filtro Status do Planejamento): união discriminada `FilterConfigSingle | FilterConfigMulti`, componente `MultiFilter` (trigger + popover aninhado de checkboxes), `computedCount`/`handleClear` tratam o caso `[]`=todos.
- `dashboard/mobile.tsx` (`MobileFilterBar`) já tem o branch `f.multi` — converter no array compartilhado atualiza desktop E mobile de graça.
- `useFilterUsage(screen)` (`src/hooks/useFilterUsage.ts`) já persiste USO por-usuário em localStorage keyed por screen — modelo de infra a espelhar p/ persistir SELEÇÃO.
- Planejamento Status já é `multi:true` (prova de conceito ponta-a-ponta).

## Arquitetura

### 1. `FilterButton` — multi por padrão + persistência

- Inverter o default: `FilterConfig` sem `multi` explícito é tratado como multi. Introduzir `FilterConfigSingle` com `single: true` (opt-in) para o raro caso de valor único. `FilterConfigMulti` continua com `value: string[]`.
  - ⚠️ **Migração (verde só no fim — decisão do dono):** hoje 1 filtro é `multi:true` e ~90 são single implícito. Inverter o default sem tocar as telas quebraria as ~90 (que passam `value: string` a um componente que espera `string[]`). O componente NÃO aceita ambos: exige que todo `FilterConfig` sem `single:true` tenha `value: string[]`. A união discriminada faz o **tsc apontar cada tela não-migrada** como erro de tipo — isso é a FEATURE: o tsc é a checklist viva de "faltou migrar esta tela". Durante a execução (numa branch de trabalho) o `tsc --noEmit` fica VERMELHO até a última tela migrar; o gate de verde total é no FECHAMENTO do projeto (a review final). Cada task de tela ainda roda seu próprio build/verificação escopada.
- **Persistência (novo hook `useFilterState`):** um hook que, dado `screen` + a lista de filtros multi, lê/escreve o array de cada filtro em `localStorage` sob a chave `filtros:v1:{screen}:{label}`. Hidrata no mount, grava no change. O `FilterButton` NÃO gerencia o estado (as telas continuam donas do `useState`); o hook é opt-in por tela: a tela troca `useState<string[]>([])` por `useFilterState(screen, label, [])`. Assinatura: `useFilterState(screen: string, key: string, initial: string[]): [string[], (v: string[]) => void]`. Isola serialização + guarda contra JSON corrompido (try/catch → initial).
- **Limpar:** `handleClear` já chama `f.onChange([])` p/ cada multi — com o `useFilterState`, isso já grava `[]` no localStorage. Nada extra além de garantir que o botão apareça sempre que houver qualquer filtro ativo (já aparece).

### 2. Conversão por tela (o grosso, mecânico)

Por filtro de lista, 3 trocas:
- Estado: `useState("all")` → `useFilterState(screen, "Label", [])` (`string[]`).
- Config: remover a opção sintética `{id:"all", nome:"Todos"}` das `options` (o "todos" agora é "nada marcado"); a entrada NÃO precisa de `multi:true` (é o default).
- Predicado (client): `if (fX !== "all" && m.campo !== fX) return false;` → `if (fX.length && !fX.includes(m.campo ?? "")) return false;`.
- Predicado (server, `.eq`→`.in`): `q.eq("col", fX)` (quando `fX!=="all"`) → `if (fX.length) q = q.in("col", fX)`.

### 3. Cascatas (4 — tasks dedicadas)

Padrão geral quando o PAI vira multi (`paiSel: string[]`):
- **Opções do filho** = união: `filhos.filter(f => paiSel.length === 0 || paiSel.includes(f.pai_id))`.
- **Poda ao mudar o pai:** quando `paiSel` muda, remover de `filhoSel` os ids que não pertencem mais à união. Fazer num `useEffect` que observa `paiSel` e chama `setFilhoSel(prev => prev.filter(id => opcoesFilhoValidas.has(id)))` (idempotente; não loopa porque só remove).
- Casos:
  - **Grupo→Categoria** — `criacao.planejamento.tsx` e `criacao.desenvolvimento.tsx` (estado independente, mesma forma).
  - **Categoria→Subcategoria** — `cadastro.aviamentos.tsx`.
  - **Colaborador(tipo)→Responsável(pessoa)** — hook compartilhado `useResponsavelFilter.ts` (3 telas: OC Tecido/Aviamento/Insumo). `tipo` vira `string[]`; `pessoas` = união; predicado já é array (`.in`). Corrigir 1× no hook beneficia as 3.
  - **Coleção→Fornecedor (implícito)** — `pcp.etapas.tsx`. Hoje SEM reset-on-change. Adicionar poda explícita (o único que ganha rede de segurança nova).

### 4. Server-side (`.eq`→`.in`)

- OCs (Tecido/Aviamento/Insumo) tabs Encomendado/Recebido: Fornecedor `.eq("empresa_id")`→`.in`; Colaborador/Responsável já `.in` (via hook).
- **Dashboard: FORA desta leva (decisão do dono).** Seus filtros são server-side via RPCs `dashboard_*` que hoje recebem escalar; torná-los multi exige estender ~5 RPCs p/ aceitar array (toca banco, diff-validação) = sub-projeto próprio. Dashboard permanece single por ora; fast-follow separado. As RPCs e o array de filtros do Dashboard NÃO são tocados neste projeto.

## Inventário (resumo — detalhe no relatório de investigação)

~14 telas client-side com FilterConfig · ~78 filtros de lista (excluindo Dashboard) · 4 cascatas · binários incluídos · Planejamento Status já multi (template).

Telas (DENTRO): Planejamento, Desenvolvimento, Plan. Tecido, Cadastro Aviamentos, Cadastro Tecidos, OC Tecido (3 tabs), OC Aviamento (3 tabs), OC Insumo (2 tabs), Explosão, CQ, Direcionamento, Lançamentos, PCP CAD, PCP Etapas, PCP Oficina, PCP Serviços, OTB.

FORA (fast-follow): Dashboard (5 tabs, server-side RPC), Financeiro (3 tabs, children custom), Auditoria (children custom).

## Fora de escopo
- Financeiro + Auditoria (children custom — fast-follow).
- Persistência em URL / compartilhável (só localStorage).
- Filtros de data/texto/número (permanecem).

## Riscos
- (a) Inverter o default do `FilterButton` é a mudança de maior alcance — TypeScript (união discriminada) é a rede: cada tela não-migrada vira erro de tipo até ser convertida. Fazer a fundação (componente + hook) primeiro, com um teste, e migrar tela a tela.
- (b) Cascata Colaborador→Responsável no hook compartilhado: bug quebra 3 telas — testar bem.
- (c) PCP Etapas cascata implícita sem reset hoje — adicionar poda.
- (d) Dashboard server-side com RPC escalar — decidir degradar ou estender RPC (provavelmente onda final).
- (e) localStorage corrompido/versão antiga — o hook guarda com try/catch e versiona a chave (`v1`).
- (f) Binário multi: marcar as 2 = não filtrar; garantir que o predicado `.length && !includes` já trata (marca 2 → todos passam? NÃO — `includes` de 2 valores num campo que só tem esses 2 → todos passam. Correto).
