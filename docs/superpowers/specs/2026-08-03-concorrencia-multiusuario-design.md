# Concorrência multi-usuário (anti lost-update) — Design

**Data:** 2026-08-03 · **Status:** aprovado pelo dono (brainstorm) · **Escopo:** 4 telas quentes

## Problema

Dois usuários na mesma tela: A salva; a tela de B não reflete e B salva o rascunho
velho por cima → o save de A some em silêncio (lost update). Hoje não há defesa:
as tabelas de negócio não têm versão/`updated_at`, o rascunho das telas semeia uma
vez e não re-semeia quando a query re-busca, e nenhuma tela usa Realtime.

## Decisões do dono (brainstorm)

1. **Escopo:** telas quentes primeiro — OC Tecido, Desenvolvimento (Sheet),
   Plan. Produto, Plan. Tecido. Demais telas adotam depois, uma a uma.
2. **UX de conflito:** merge ao vivo — campos que B não tocou atualizam sozinhos
   quando A salva; só campo tocado pelos dois vira conflito (escolha inline).
3. **Presença:** sim — de TELA ("Mayara também está aqui") e de CAMPO ("Mayara
   está neste campo", contorno no campo focado pelo outro).
4. **Nível Docs (digitação ao vivo/CRDT): FORA do escopo** — avaliado e
   descartado (custo 5-10×, quebra o modelo rascunho+Salvar, e a trava da
   abordagem A seria pré-requisito de qualquer forma). A propagação é **no save**
   (<1s via Realtime), não por tecla.
5. Abordagem escolhida: **A — Realtime + merge por campo + trava otimista no
   servidor** (a trava é a rede de segurança; funciona mesmo com Realtime fora).

## 1 · Banco — `rev` + trava otimista

- Coluna **`rev int not null default 1`** nos agregados-raiz:
  - `modelos.rev` — ⚠️ NÃO usar o nome `versao`: `modelos.versao` já existe e é
    conceito de negócio (v1/v2/v3 do modelo, `VersaoBadge`).
  - `ocs_tecido.rev`
  - `colecoes.plan_rev` (a árvore do Plan. Tecido pertence à coleção; não há
    tabela "plano").
- **Triggers (mecanismo limpo, sem loop possível):**
  - `BEFORE UPDATE` na raiz → `NEW.rev = OLD.rev + 1`, sempre (a raiz não toca
    filhas, então não há recursão).
  - Nas tabelas **filhas** (ocs_tecido_itens; modelo_tecidos, modelo_grades,
    modelo_aviamentos, modelo_etiquetas, modelo_observacoes…; plan_tecido_slots,
    plan_tecido_slot_materiais…) → `AFTER INSERT/UPDATE/DELETE` faz um UPDATE
    no-op na raiz (`SET id = id`) — o BEFORE da raiz converte em `rev+1`.
  - Duplo papel do bump na raiz: (a) muda `rev` (trava); (b) gera evento UPDATE
    na linha-raiz → o front escuta **só a raiz** no Realtime e cobre os filhos.
  - O valor absoluto de `rev` não importa (pode pular vários por save); só a
    DESIGUALDADE entre `rev` carregado e `rev` atual.
- **Save com trava:** as RPCs de salvar — **`salvar_oc_tecido`**,
  **`salvar_modelo_bom`** e **`salvar_plan_tecido`** (nomes verificados no banco;
  wrappers + `_core`) — ganham parâmetro **`_rev_base int default null`**:
  - `null` → comportamento atual (compat: telas não migradas seguem funcionando).
  - preenchido e ≠ `rev` atual da raiz → `RAISE ... USING ERRCODE = 'P0409'`
    (custom, mnemônico HTTP 409) com mensagem estável `conflito_versao`, traduzida
    no `mensagemErro` ("Fulano salvou antes — a tela foi atualizada").
  - **Plan. Produto salva por UPDATE DIRETO em `modelos`** (verificado:
    criacao.planejamento.tsx:232/1375/1470, sem RPC) → contrato equivalente:
    `.update(...).eq('id', id).eq('rev', base).select()` → 0 linhas = conflito.
- Padrão wrapper+`_core` e REVOKE (invariante #9) preservado nas RPCs alteradas.
- Diff-validar `pg_get_functiondef` antes/depois; migração idempotente.

## 2 · Front — hook `useColabRegistro`

Um canal Supabase por registro-agregado: `colab:oc:{id}`, `colab:modelo:{id}`,
`colab:plan:{colecaoId}`.

**a) Escuta do save:** `postgres_changes` (UPDATE) na LINHA-RAIZ (graças ao bump).
Ao receber: re-busca os dados da tela e roda o merge. (Fallback natural: o
`refetchOnWindowFocus` do TanStack continua valendo; o merge é o mesmo.)

**b) Merge por campo — helper puro `mergeDraft` (unit-testável):**
Entradas por campo escalar: `base` (o que a tela carregou/último merge),
`draft` (o que estou vendo), `fresh` (o que chegou), `touched` (Set<path> que a
tela marca no onChange — mesmo espírito do `camposCopiados` do Importar dados).
- não tocado → assume `fresh`;
- tocado e `base === fresh` (servidor não mudou aquele campo) → mantém `draft`;
- tocado e `base !== fresh` → **conflito** `{path, meu, dele}`.
- **Coleções** (itens de OC, variantes, grades, slots): merge **POR LINHA**
  (chave = id da linha): linha tocada só por um → resolve sozinha; tocada pelos
  dois → conflito de LINHA (não por célula); adição dos dois lados → união;
  remoção do outro × edição minha → conflito de linha.
- Após merge sem conflitos: `base` avança para `fresh` e o `rev` local avança.

**c) Presença:** `channel.track({ user_id, nome, campo_focado })`.
- Tela: avatares/iniciais no topo, excluindo o próprio usuário.
- Campo: o campo cujo `campo_focado` de OUTRO usuário casa com o path ganha
  contorno + etiqueta "{nome} está neste campo". Broadcast de foco/blur apenas —
  conteúdo do rascunho NÃO trafega.

**UI de conflito:** banner no topo do form ("Mayara salvou agora — N campos
atualizados · M em conflito") + campo em âmbar com escolha inline
"manter meu · usar o dela". Resolver escolhe o valor e remove do set de conflitos.
Sem AlertDialog bloqueante (o trabalho continua).

**Save protegido:** envia `rev` base conhecido. Se a RPC recusar (corrida na
janela entre merge e clique): re-busca → re-merge → sem conflitos, **re-tenta 1×
sozinho**; com conflitos, mostra e NÃO salva. Nunca sobrescreve às cegas.

**Guardas existentes preservadas:** `useUnsavedGuard`/`useDirtySnapshot` seguem
funcionando; o merge de campos não-tocados NÃO marca dirty; conflito resolvido
com "usar o dele" também não (é o valor do servidor).

## 3 · Adoção, testes, limites

**Ordem:** 1) **OC Tecido** (piloto — agregado contido, RPC atômica pronta, dano
alto) · 2) Desenvolvimento Sheet · 3) Plan. Produto · 4) Plan. Tecido (maior
rascunho). Cada tela: mapear paths do rascunho, marcar `touched` no onChange,
ligar o hook, definir merge das coleções da tela.

**Testes:**
- Unit `mergeDraft`: os 6 casos (não-tocado atualiza · tocado igual mantém ·
  tocado+mudado conflita · linha um-só resolve · linha dois conflita · adições
  unem) + remoção×edição.
- Integração transacional (padrão da suíte, revertida): `_rev_base` correto passa
  · errado recusa com o errcode · `null` passa (compat).
- QA ao vivo com 2 sessões logadas: save de A reflete em B <1s; conflito aparece
  e resolve; presença de tela e campo; Realtime derrubado → save velho ainda é
  recusado pela trava (rede de segurança).

**Fora do escopo:** CRDT/digitação ao vivo · lock pessimista · histórico de
versões · telas frias (adoção posterior).

**Riscos/pré-requisitos:**
- **VERIFICADO: a publicação `supabase_realtime` está VAZIA hoje** (nenhuma tabela
  publica eventos). Adicionar as 3 raízes (`modelos`, `ocs_tecido`, `colecoes`)
  à publicação é parte OBRIGATÓRIA da migração — sem isso o postgres_changes não
  dispara e só resta a trava (que segura a correção, mas sem o "ao vivo").
- RLS vale no Realtime → cada loja só recebe os próprios eventos (multi-tenant ok).
- Volume de canais: 1 canal por registro aberto por usuário — baixo (Sheet aberto).
- Triggers de bump em filhas rodam por statement — atenção a saves que reescrevem
  muitas linhas (árvore do Plan. Tecido): usar trigger por STATEMENT quando
  possível para não inflar o rev à toa (só a desigualdade importa, então inflar
  não quebra — é só higiene).
