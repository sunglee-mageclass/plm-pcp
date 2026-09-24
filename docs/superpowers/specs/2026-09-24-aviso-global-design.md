# Aviso Global — desenho

**Data:** 24/set/2026 · **Estado:** desenho APROVADO pelo dono (24/set); G-plano APROVA COM RESSALVAS R1–R8, aplicadas (24/set) · **Plano:** `docs/superpowers/plans/2026-09-24-aviso-global.md`
**Fase:** independente da campanha "Planejamento unificado + Kanban automático"; worktree própria `.claude/worktrees/aviso-global` (branch `aviso-global`, da ponta `a044759` de `feature/plan-tecido-a1`).

## 1. Objetivo

Deixar o super admin avisar, na hora, quem está usando o sistema. O caso principal é a manutenção: "o sistema vai entrar em manutenção em 5 minutos, salve o que está fazendo". A motivação são os deploys da campanha do Planejamento: ninguém deve ser pego no meio de um Salvar.

## 2. Decisões do dono (24/set, aprovadas)

| # | Decisão |
|---|---|
| 1 | Quem envia: **só o super admin**, na tela nova **Admin Mestre → Avisos**. |
| 2 | Formulário: texto; nível **Informativo** ou **Manutenção**; destino **todas as lojas** (padrão) ou lojas escolhidas; **início da manutenção** (data e hora, alvo da contagem); **validade** que expira sozinha (padrão: **30 min depois do início**). |
| 3 | Lista dos avisos ativos e antigos, com **"Encerrar agora"**. |
| 4 | **Informativo:** faixa discreta no topo, que o usuário pode fechar. |
| 5 | **Manutenção:** faixa **vermelha fixa** que não fecha, com "Manutenção em mm:ss"; depois do início, "Sistema em manutenção". Junto, um **cartão flutuante no canto** com a mensagem e o botão "Entendi", que **só fecha o cartão**. A faixa continua. |
| 6 | O cartão **não pode interromper o trabalho**: não é Dialog/AlertDialog, não rouba o foco e não fecha o Sheet ou o Dialog aberto. |
| 7 | Entrega **na hora** para quem está com o sistema aberto; quem abrir ou recarregar vê até a validade acabar. Cada usuário só vê os avisos da loja dele (ou os de "todas"). |
| 8 | Segurança no banco: só super admin cria e encerra; o usuário autenticado lê só os ativos destinados à loja dele; loja inativa (sentinela nil) não lê. |
| 9 | Ordem: a migration vai a produção **depois da F1** (o pré-voo da F1 pararia com a tabela a mais), com número `20261001100000`. O deploy do front publica a branch principal inteira. |

## 3. Dados — `public.avisos_globais` (uma tabela nova, aditiva)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `mensagem` | text | 1 a 500 caracteres (depois do `btrim`) |
| `nivel` | text | `informativo` \| `manutencao` |
| `todas_lojas` | boolean | padrão `true`; com `true`, `lojas` fica vazio |
| `lojas` | uuid[] | com `todas_lojas=false`: 1 a 200 lojas, sem NULL e sem o sentinela nil |
| `inicio_em` | timestamptz | Manutenção: alvo da contagem. Informativo: o momento do envio |
| `expira_em` | timestamptz | `> inicio_em` e `≤ inicio_em + 7 dias` |
| `encerrado_em` | timestamptz null | "Encerrar agora"; não volta a NULL |
| `criado_por` | uuid | `auth.uid()` (o cliente não grava nem lê esta coluna — R7) |
| `created_at` | timestamptz | `now()` |

A tabela é global de propósito: não tem `tenant_id`, e o destino fica em `todas_lojas`/`lojas`. "Ativo" quer dizer `encerrado_em IS NULL AND expira_em > now()`. Não há índice além da PK, porque a tabela é mínima. **Não há função, gatilho nem publicação.** Por isso a invariante #9 (`_core` com EXECUTE revogado) não se aplica, e nenhuma tabela existente é travada.

## 4. Segurança e entrega

**RLS (4 policies, `TO authenticated`)**
- Ler (super admin): `is_super_admin()`. A lista do Admin mostra tudo, de todas as lojas.
- Ler (todos): `encerrado_em IS NULL AND expira_em > now() AND get_user_tenant_id() <> nil AND (todas_lojas OR get_user_tenant_id() = ANY(lojas))`.
- Criar: `WITH CHECK (is_super_admin() AND encerrado_em IS NULL AND expira_em > now())`.
- Encerrar: `USING (is_super_admin()) WITH CHECK (is_super_admin() AND encerrado_em IS NOT NULL)`.
- **Sem policy de DELETE**: ninguém apaga pela API, e o histórico fica.

**Permissões:** o padrão do Supabase dá tudo a `anon`/`authenticated` em tabela nova. A migration tira tudo e devolve só:
- `SELECT` **por coluna** para `authenticated` — todas menos `criado_por` (R7). `lojas` continua legível: a policy filtraria sem ela (conferido no Postgres descartável), mas o super admin é o MESMO papel `authenticated` e precisa dela na lista do Admin e no filtro da faixa (risco aceito, §7);
- `INSERT` só em `(mensagem, nivel, todas_lojas, lojas, inicio_em, expira_em)`;
- `UPDATE` só em `(encerrado_em)`;
- `anon` fica sem nada.

Um `DO` no fim da migration confere RLS, policies e permissões na mesma transação.

**Entrega ao vivo — broadcast, não postgres_changes.** Depois de criar ou encerrar um aviso, a tela do super admin manda um "toque" **sem conteúdo** (evento `mudou`) no canal global `avisos-globais`. Todo cliente assina esse canal no layout e **refaz a busca**, e a busca passa pela RLS. Motivos da escolha:

1. O "Encerrar agora" deixa a linha **invisível** para o usuário comum, porque a policy só mostra os ativos. O Realtime não entrega uma mudança que o assinante não pode ler, então com postgres_changes o aviso encerrado ficaria na tela até recarregar.
2. Não mexe na publicação `supabase_realtime`: a migration continua só com objetos novos.
3. O toque não leva dado nenhum, então o canal público não vaza nada. Toques em rajada ou forjados viram **no máximo 1 busca a cada 5 s, com trailing** — o último sempre gera uma busca (R6).

**Rede de segurança**, porque o Realtime pode cair ou a aba pode estar em segundo plano: o cliente refaz a busca ao entrar e ao **reentrar** no canal (`SUBSCRIBED`, o que cobre a reconexão), quando a aba volta a ficar visível e quando o navegador volta a ficar online (mesmo limite de 1 busca a cada 5 s). O TanStack também refaz ao focar a janela. A validade é conferida no cliente a cada segundo, então a faixa some sozinha na hora certa.

**Super admin:** a RLS deixa ele ler todos os avisos. Por isso a faixa filtra no cliente pela **loja em visualização** (`avisoParaLoja`).

## 5. Interface

**Onde aparece:** em todas as telas autenticadas. O componente `<AvisosGlobais/>` é montado uma vez no layout `_authenticated.tsx`, logo abaixo do header, com `sticky top-14 z-30`. A tela "Loja inativa" não mostra aviso.

- **Faixa Informativa:** tom `--tone-info-*`, ícone `Info`, a mensagem em até 2 linhas e um X para fechar (alvo de 44 px no mobile). Fechada, ela fica fechada para aquele usuário naquele navegador (`localStorage`, dentro de try/catch; se o storage falhar, vale só na memória da aba).
- **Faixa de Manutenção:** `bg-destructive text-destructive-foreground`, ícone `Wrench`, sem botão de fechar. Mostra "Manutenção em mm:ss" (ou `h:mm:ss` a partir de 1 hora, arredondando para cima) e, a partir do início, "Sistema em manutenção". A contagem fica em `aria-hidden` e o leitor de tela recebe um texto fixo com o horário.
- **Cartão de Manutenção:** vai por portal no `body`, com `z-[60]`, acima do escurecido do Sheet/Dialog (`z-50`). Fica em **`bottom-20` em todos os tamanhos** (acima da PageActionBar e do rodapé do Sheet — R4): no desktop, no canto esquerdo (o Sheet abre à direita e o toast fica no topo); no mobile, largo. Mostra "Manutenção programada", a contagem, a mensagem e o botão "Entendi". Três proteções evitam que ele interrompa o trabalho:
  1. Um listener **nativo** de `pointerdown` no cartão faz `stopPropagation`. O Radix fecha o modal num `pointerdown` que chega ao `document` vindo de fora, então o Sheet ou o Dialog aberto nem fica sabendo do clique.
  2. `pointer-events-auto` no cartão, porque o modal põe `pointer-events: none` no `body`.
  3. `onMouseDown={preventDefault}` na **raiz** do cartão (R3) e nenhum `autoFocus`: clicar no texto ou no "Entendi" não tira o foco do campo em que a pessoa digita.

  Com mais de uma manutenção ativa, aparece um cartão por vez. Não se usa `DismissableLayerBranch` do Radix porque é um pacote interno ("not intended for public usage") e exigiria dependência nova.
- **Tela Admin → Avisos** (`/admin/avisos`): o gate é igual ao de `lojas.tsx`/`usuarios.tsx` (`isSuperAdmin`; quem não é vai para `/dashboard`). As telas de super admin **não** entram em `nav.ts` nem em `permissions-catalog`: são itens fixos do grupo "Admin Mestre" no `app-sidebar.tsx` e cards do `admin/index.tsx`, e o Avisos segue o mesmo caminho.
  - Tabela `card-table` com mensagem, nível, destino, início, validade, situação (Ativo/Expirado/Encerrado) e a ação "Encerrar agora". Encerrar pede confirmação num AlertDialog, porque não dá para desfazer.
  - "Novo aviso" é um **Dialog** (novo = Dialog) `fixedFooter mobileFull`, com breadcrumb "Admin › Avisos › Novo aviso", guarda de alterações não salvas, rodapé Voltar · Enviar e erros via `mensagemErro()`.
  - Campos: Nível (padrão **Manutenção**), Mensagem (contador x/500), switch "Todas as lojas" com a lista de lojas **ativas** quando desligado, Início da manutenção (**`DateField` + `HoraField`**, este novo: texto mascarado `hh:mm`, porque o `<input type="time">` segue o idioma do aparelho) e Validade.
  - O início sugerido fica ≥ 5 min à frente, no múltiplo de 5 min. A validade sugerida é +30 min e acompanha o início até ser mexida.
  - Horários no fuso do navegador do super admin.
- Tokens apenas (§Q; anti-drift ativo). Mobile 360: nada passa da largura (`min-w-0`, `break-words`, `line-clamp-2`).

## 6. Fora de escopo

- Editar um aviso enviado: encerra-se e envia-se outro.
- Aviso por usuário ou por papel.
- Agendar o **aparecimento**: o aviso aparece ao ser enviado, e a contagem é até o início.
- Som, e-mail ou push.
- Bloquear o sistema durante a manutenção (o aviso só avisa).
- Tela de login / `/auth`.
- Guardar o "Entendi" no banco (vale por navegador).
- Traduções.

## 7. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Front no ar antes da tabela | A leitura engole o erro, a faixa some em silêncio e a tela Avisos mostra o erro. Ordem do plano: **migration em produção → merge → deploy**. |
| Toque perdido (rede, aba em segundo plano) | Busca refeita no SUBSCRIBED/reconexão, na volta da aba, no online e no foco. A validade é conferida no cliente. |
| Relógio do aparelho errado | A contagem usa o relógio local (desvio típico < 1 s com NTP). A RLS usa o `now()` do servidor para o que é ativo. Aceito. |
| Clique no cartão fechar o Sheet | 3 proteções (§5), um teste estático que as trava e o QA na cópia com o Sheet aberto, o foco num campo e o "Entendi". |
| Toque forjado no canal público | Sem dado nenhum: causa no máximo 1 busca a cada 5 s por cliente, com trailing (R6 — `esperaParaBuscar`/`INTERVALO_BUSCA_MS`). |
| Com Sheet/Dialog aberto, a faixa fica sob o escurecido | O cartão fica por cima. Depois do "Entendi", a contagem só aparece de novo ao fechar o Sheet. Levado ao dono (plano §8 D2). |
| Pré-voo da F1 | A migration só vai depois da F1 em produção; o pré-voo do aviso **exige** a F1 no banco. |
| Volta de emergência da F1 depois do aviso | A comparação final da volta da F1 (fidelidade de todo o `public`) acusaria a tabela nova. Logo depois do aviso, grava-se uma referência nova (retrato pré-F1 + as linhas do aviso) e a comparação que a substitui (plano Task 7 Step 3, R2). |
| Toques em rajada ou forjados | No máximo 1 busca a cada 5 s por cliente, com trailing — o último toque sempre gera uma busca (R6). |
| `lojas` legível pela API (**risco aceito**, R7) | Quem lê um aviso vê os UUIDs das outras lojas destinatárias DAQUELE aviso — sem nome nem dado delas. Tirar a coluna quebraria a lista do Admin e o filtro do super admin (mesmo papel `authenticated`). `criado_por` não é legível. |
| Deploy levar commit a mais | Portão duro antes do `npm run deploy`: `src/` limpo e só os commits listados (plano Task 8 Step 3, R1). |
| 1º deploy não é anunciável pelo aviso | Quem está aberto desde antes do deploy só vê avisos depois de recarregar: publicar em horário calmo e pedir por WhatsApp que recarreguem (plano §8 D4, R8). |
| Backup sem PITR | `pg_dump` completo (container 17.6) **antes** do apply, dentro do próprio script. |
