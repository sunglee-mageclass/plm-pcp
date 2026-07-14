# Ajustes na Prova como comentários — design (sisTrama)

Data: 2026-07-14. Status: escopo aprovado pelo dono (Partes 1 e 2); pendente review do spec.

## 1. Objetivo

No card de **Desenvolvimento** (`ModeloDetailPanel`), o campo "Ajustes na Prova" hoje é um
`<Textarea>` de texto livre (coluna `modelos.ajustes_prova`), dentro da seção "1. Informações
Básicas". Transformar isso num **fio de comentários** próprio, numa **seção nova
"2. Ajustes na Prova"** (empurrando as demais seções pra 3–7), onde o usuário registra ajustes
como comentários, com autor, data e hora.

## 2. Decisões do dono (brainstorming)

- **Seção própria** no accordion, posição **2** (após "1. Informações Básicas"); "2. Tecidos…"
  passa a "3." e assim por diante (renumerar 3–7).
- **Respostas ANINHADAS** (fio de 2 níveis): responder qualquer comentário anexa a resposta ao
  comentário de TOPO do fio (resposta de resposta achata no mesmo fio).
- **Abas** `Abertos` | `Resolvidos`. Resolver move o fio pra aba Resolvidos; **Reabrir** volta.
- **Ordem**: fios de topo mais recentes primeiro (Abertos por `created_at` desc; Resolvidos por
  `resolvido_at` desc). Respostas em ordem cronológica sob o fio (asc).
- **Excluir**: só o **autor** do comentário (nem admin). Excluir fio de topo leva as respostas
  junto; excluir resposta remove só ela.
- **Resolver/Reabrir**: qualquer usuário com acesso ao card.
- **Migração**: cada `modelos.ajustes_prova` não-vazio (6 modelos hoje) vira o 1º comentário de
  topo daquele modelo, marcado como **importado** (`user_id` null, `created_at` = criação do
  modelo, `resolvido` false).
- Sem **edição** de comentário (não há "editar"; texto é imutável).

## 3. Arquitetura (abordagem A — tabela dedicada + RLS)

### 3.1 Tabela `modelo_prova_comentarios`

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `tenant_id` | uuid NOT NULL | RLS; preenchido por trigger |
| `modelo_id` | uuid NOT NULL | → `modelos(id)` ON DELETE CASCADE |
| `parent_id` | uuid NULL | → `modelo_prova_comentarios(id)` ON DELETE CASCADE. **null = fio de topo**; preenchido = resposta (aponta SEMPRE pro topo) |
| `user_id` | uuid NULL | → `users(id)`. **null = importado** |
| `texto` | text NOT NULL | imutável (sem edição) |
| `resolvido` | boolean NOT NULL default false | só no fio de topo |
| `resolvido_at` | timestamptz NULL | quando resolvido |
| `resolvido_por` | uuid NULL | → `users(id)`, quem resolveu |
| `created_at` | timestamptz NOT NULL default now() | |

Índices: `(modelo_id, parent_id, created_at)`, `(tenant_id)`. RLS habilitado.

**Regra de 2 níveis (aplicada no INSERT):** se `parent_id` referencia uma linha que já é resposta
(`parent_id` do pai não-nulo), reancorar para o topo — a resposta grava o `parent_id` do fio de
topo. Feito na RPC de responder (não confia no cliente).

### 3.2 Segurança (RLS + RPCs)

- **SELECT**: policy `tenant_id = get_user_tenant_id()`.
- **INSERT/responder/resolver/reabrir/excluir via RPCs** (padrão wrapper + `_core`, invariante #9;
  `_core` revogado de PUBLIC/anon/authenticated):
  - `prova_comentar(_modelo_id, _texto, _parent_id?)` — cria comentário/resposta; grava
    `tenant_id = get_user_tenant_id()`, `user_id = auth.uid()`; valida que o modelo é do tenant;
    reancora `_parent_id` pro topo. RAISE se texto vazio.
  - `prova_resolver(_id, _resolvido bool)` — só em fio de topo; seta `resolvido`/`resolvido_at`/
    `resolvido_por`. Qualquer usuário do tenant.
  - `prova_excluir(_id)` — **só o autor** (`user_id = auth.uid()`); senão RAISE 42501. CASCADE
    apaga respostas do fio.
- Sem policy de UPDATE/DELETE direto pro cliente (tudo via RPC) — texto fica imutável e as regras
  centralizadas. (Alternativa mais leve seria policies diretas, mas RPC dá controle de coluna +
  reancoragem + autor num lugar só.)

### 3.3 Migração (uma vez)

Para cada `modelos` com `trim(ajustes_prova)` não-vazio: `INSERT` um comentário de topo
(`user_id` null, `texto` = ajustes_prova, `created_at` = `modelos.created_at`, `resolvido` false).
Idempotente (não duplicar se já houver comentário importado do modelo). A coluna
`modelos.ajustes_prova` fica como **legado** (a UI para de ler/escrever); dropar depois, à parte
(migration destrutiva separada, `BEGIN/COMMIT`).

## 4. Frontend

### 4.1 Componente `ModeloAjustesProvaSection.tsx` (em `components/desenvolvimento/modelo-detail/`)

- Recebe `modeloId` (+ `readOnly`). Query `["prova-comentarios", modeloId]` traz os comentários
  (embed do autor: `user:user_id(nome)` e `resolvido_por(nome)`), ordenados no cliente.
- **Caixa de envio** no topo: `<Textarea>` + botão **Enviar** → `prova_comentar` (parent null).
- **Abas** (`Tabs`): `Abertos (N)` | `Resolvidos (N)`.
  - **Abertos**: fios com `resolvido=false`, `created_at` desc. Cada fio:
    - Topo: **nome · data/hora** (fuso da loja via `useStoreTimezone`, pt-BR `dd/mm/aaaa hh:mm`) +
      texto; ações **Responder** · **Resolver** · **Excluir** (Excluir só se `user_id === meu id`).
    - Respostas indentadas (asc), cada uma com nome · data/hora · texto · **Excluir** (autor).
    - **Responder** abre um input inline; enviar → `prova_comentar(parent = id do topo)`.
  - **Resolvidos**: fios `resolvido=true`, `resolvido_at` desc; esmaecido; **Reabrir** no lugar de
    Resolver.
- **Vazio**: "Nenhum ajuste ainda. Envie o primeiro comentário."
- Cada mutação (`prova_comentar`/`prova_resolver`/`prova_excluir`) invalida `["prova-comentarios",
  modeloId]`. Erros em PT-BR via `mensagemErro`. Excluir pede confirmação (AlertDialog) — destrutivo.

### 4.2 Integração no `ModeloDetailPanel`

- Remover o `<Field label="Ajustes na Prova">` + `ajustes_prova` do `ModeloInfoSection` e do
  `draft`/save do painel (para de ler/gravar a coluna legada).
- Inserir um `AccordionItem value="prova"` **entre** "1. Informações Básicas" e a atual seção de
  Tecidos, com trigger **"2. Ajustes na Prova"**, renderizando `ModeloAjustesProvaSection`.
- Renumerar os triggers seguintes: Tecidos→3, Aviamentos→4, Grade→5, Custos→6, Anexos→7.

## 5. Fora de escopo / adiado

- Editar comentário (não há edição). Menções/@usuário. Anexos/imagens no comentário.
- Notificações. Dropar `modelos.ajustes_prova` (cleanup posterior). Reuso genérico de comentários
  em outras telas (seria a abordagem C).

## 6. Verificação

- Migration + RPCs testadas em txn revertida (`BEGIN…ROLLBACK`): comentar cria fio; responder
  reancora no topo (2 níveis); resolver/reabrir move de aba; excluir só pelo autor (RAISE p/
  outro); CASCADE apaga respostas; migração cria 1º comentário dos 6 modelos sem duplicar.
- REVOKE dos `_core` conferido (`has_function_privilege` = false p/ os 3).
- Front: tsc 0 · build ✓ · screenshot da seção (abas, fio com resposta, resolver→aba Resolvidos).

## 7. Riscos / notas

- **Concorrência**: linhas reais + RPCs → sem lost update (vantagem sobre jsonb).
- **Fuso**: data/hora exibida no fuso da loja (`useStoreTimezone`), não do device.
- **queryKey única** `["prova-comentarios", modeloId]` (não compartilhar).
- Excluir fio de topo com respostas de OUTROS autores: o CASCADE apaga as respostas junto (o dono
  do fio "arrasta" as respostas). Aceito no escopo; se incomodar, revisitar (ex.: bloquear excluir
  topo com respostas de terceiros).
