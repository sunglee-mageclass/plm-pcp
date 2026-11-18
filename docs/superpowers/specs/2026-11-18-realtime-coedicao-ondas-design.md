# Realtime universal + co-edição ao vivo (em ondas) — design

**Data:** 2026-11-18
**Branch:** `feature/plan-tecido-a1`.
**Relacionado:** [[project_realtime_universal_roadmap]] (roadmap aprovado set/2026, Fase 1 feita) — esta spec
RETOMA e atualiza esse roadmap com o que o dono pediu em 18/nov. Camada: [[project_camada_intermediaria]].

## Intenção (acordada com o dono, 18/nov)

Colaboração em tempo real plena, construída EM ONDAS, até chegar na **co-edição ao vivo** (o campo muda na
tela de todos enquanto o outro digita) em todas as telas onde faz sentido. **Deploy é ÚNICO** — as ondas são a
ordem de CONSTRUÇÃO (acumulam na branch); a publicação é um deploy só, no portão do dono, junto da frente
"Salvar por card da revenda" já pronta.

**Sucesso:** (1) nenhuma tela exige F5 quando outro usuário salva; (2) vê-se nome+cor de quem edita cada campo
em toda tela possível; (3) nos campos marcados, o conteúdo muda ao vivo enquanto o outro digita.

## Estado atual (verificado no código, 18/nov)

**Motor já pronto (não reconstruir):**
- `useRealtimeInvalidation` (1× no layout `_authenticated.tsx`) + `src/lib/realtime-invalidation-map.ts`
  (41 tabelas): quando uma tabela PUBLICADA no Realtime muda, invalida as queryKeys de LISTA → listas/kanban
  atualizam sem F5. Só nível lista (não detalhe, de propósito).
- `useColabRegistro` (`src/hooks/useColabRegistro.ts`): por registro aberto, escuta `postgres_changes` na
  linha-raiz → `onMudancaServidor()` re-busca e faz merge; + presença (nome+cor) + broadcast `campoFocado`.
  Usado em ~18 sheets/dialogs.
- Presença de campo: `ColabPresenceOverlay` (anel+nome flutuante por `data-colab-path`), `presenca-cor.ts`
  (cor determinística por usuário), em ~53 telas/seções. `FieldPresence` é passthrough (desativado).
- Broadcast do Supabase já trafega `campoFocado` (o path do campo) — base para transmitir conteúdo na Onda 3.
- Publicar tabela no Realtime = `ALTER PUBLICATION supabase_realtime ADD TABLE public.<t>` (migration aditiva).

**Lacunas (o que esta frente fecha):**
- **Precisa de F5 (6 totais):** Oficina (`pcp.oficina.$modeloId.tsx` — viva, sem item de menu mas alcançável;
  grava `cad.observacoes_molde` por UPDATE cru SEM colab nem rev, :256; e `producao_oficina` :247/250) +
  5 de Admin (Identidade/system_settings, Lojas/tenants, Usuários, Usuários-Loja, Auditoria).
- **Parciais (6):** cabeçalho reflete, tabela-filha não — Colaboradores (`tipos_colaborador`), Etiquetas
  (`variantes_etiqueta`), Aviamentos (`variantes_aviamento`), Serviço (`empresa_categorias_*`), Endereçamento
  (`enderecamento_tecido`), Planejamento (gravações em `cad`).
- **Presença de campo ausente:** Oficina, Admin, vários Cadastros, e todas as telas de LISTA/kanban (nelas
  falta um mecanismo de presença POR CAMPO numa grade — hoje só há presença de PÁGINA via
  `useColabPresencaPagina`).
- **4 residuais da Camada** (colaboração): merge árvore Plan.Tecido sem `removidasIds`
  (`src/lib/plan-tecido/colab-merge-arvore.ts`); rolos (`rolos_planejados`) fora do merge da OC Tecido modo
  rolo; molde da Oficina sem rev (= M2 do PCP, funde ao bloco Oficina); defesa de servidor "lista
  efetivamente vazia" nas OCs.
- **Co-edição ao vivo:** inexistente. Sem lib CRDT (Yjs/Automerge) no projeto.

## As 3 ondas

### ONDA 1 — "ninguém mais aperta F5" (+ os 4 residuais da Camada)

Fecha o recarregamento manual. Padrão já existente; risco baixo.

- **Oficina ganha realtime + rev (funde o residual M2):**
  - `useColabRegistro` na Oficina, espelhando o CQ (`expedicao.cq.$modeloId.tsx:758`): `canal:
    colab:oficina:${cad.id}`, `tabela:"cad"`, `filtroColuna:"cad_id"` (+ `tabelasExtra` para
    `producao_oficina` por `cad_id`), `onMudancaServidor` invalida as queries da Oficina
    (`["oficina", cad.id]` / a key real da tela). Presença de campo vem junto (overlay + data-colab-path no
    textarea do molde).
  - O UPDATE do molde (`cad.observacoes_molde`, :256) passa a ter `.eq("rev", revBase)` + tratamento de P0409
    (molde do `_rev_base`), como as outras telas — fecha o lost-update (M2).
  - `cad` publicado no Realtime se ainda não estiver (migration aditiva; confirmar na cópia).
- **Parciais via extensão do mapa:** adicionar ao `realtime-invalidation-map.ts` as tabelas-filha que faltam
  (`variantes_etiqueta`, `variantes_aviamento`, `tipos_colaborador`, `empresa_categorias_fornecedor`,
  `empresa_categorias_servico`, `enderecamento_tecido`) com as queryKeys de lista que elas alimentam; publicar
  no Realtime as que não estiverem. Admin (tenants/users/system_settings/audit_log) entra no mapa com as keys
  das respectivas telas (baixo churn; opcional por decisão do dono — são pouco colaborativas).
- **4 residuais da Camada:**
  - Plan.Tecido: `mergeArvorePorSlot` passa a aceitar `removidasIds` (padrão de `mergeLinhas` em
    `src/lib/colab/merge.ts`): slot que EU removi e o servidor não mexeu continua removido; se o servidor mexeu,
    vira conflito visível. Não ressuscita nem apaga calado.
  - OC Tecido modo rolo: `rolos_planejados` entra no merge (hoje sobrescreve o plano alheio).
  - Defesa de servidor: "lista não-vazia sem as chaves do item" nas OCs não apaga tudo (a tela já manda as
    chaves; é rede de segurança — decidir se entra agora ou vira débito).

### ONDA 2 — "quem está onde" em toda tela

Estende a presença de campo (nome+cor) às telas de detalhe que faltam e cria o mecanismo para listas/kanban.

- **Detalhe faltante (Oficina, Admin, Cadastros):** aderir ao padrão — montar `ColabPresenceOverlay` no
  sheet/form + marcar inputs com `data-colab-path`. O overlay é auto-instrumentado (pega qualquer campo com
  path), então a adesão é por tela, não campo a campo.
- **Listas/kanban (mecanismo NOVO):** presença POR CAMPO numa grade exige escopo de presença de linha/célula —
  hoje só há presença de PÁGINA (`useColabPresencaPagina`). Desenhar um `useColabPresencaGrade` (ou estender o
  de página) que transmita `{linhaId, campo}` por broadcast e desenhe o anel na célula. Telas: Desenvolvimento
  (kanban), Financeiro, OTB, Lançamentos, Dashboard (só leitura — presença de "quem está vendo", não editar),
  PCP Etapas, Armário. YAGNI: só onde há edição colaborativa real (kanban/Financeiro/OTB primeiro).

### ONDA 3 — co-edição ao vivo (HÍBRIDA por tipo de campo)

O campo muda enquanto o outro digita. Decisão do dono (18/nov): **híbrido**.

- **Campos simples (número, data, seleção, texto curto) = "último que digita aparece":** o conteúdo do campo
  é transmitido por BROADCAST (o mesmo canal que já leva `campoFocado`), com throttle (ex.: 80–150ms). Quem
  recebe atualiza o campo SE não estiver editando aquele campo (não rouba o foco/cursor de quem digita). Se 2
  digitam o MESMO campo, o último caractere recebido vence (pode "brigar" — aceitável para campos que 1 pessoa
  edita por vez). Reusa o broadcast; nenhuma lib nova.
- **Textos longos (observações, descrição, molde) = merge real (CRDT):** nova dependência **Yjs** (+
  y-protocols) sobre o canal de broadcast do Supabase (ou `y-webrtc`/custom provider). Dois digitando no mesmo
  parágrafo: as letras se intercalam sem conflito. Só nos poucos campos de texto longo. É o item mais pesado
  e o único que traz dependência nova.
- **Persistência inalterada:** co-edição ao vivo é só a VISÃO em tempo real; a gravação continua no Salvar de
  cada um (ou no auto-save existente). Isto NÃO é a Camada (que tirou a gravação-na-hora) — é ortogonal: o
  rascunho é compartilhado ao vivo, mas só o Salvar grava.

## Restrição real (conexões / plano)

O plano atual já teve incidente de conexões no MICRO ([[project_incidente_conexoes_integracao]]; hoje em
MEDIUM). A Onda 3 (broadcast de digitação) aumenta o tráfego realtime: exige **throttle/debounce** e
**vigilância**; pode exigir upgrade de plano se muitas telas co-editarem ao vivo com muitos usuários. As Ondas
1 e 2 usam o mesmo canal já existente (impacto marginal). Decidir na Onda 3: limitar co-edição ao vivo às
telas de maior valor, não a todas.

## Arquitetura / isolamento

- Onda 1 e 2 são ADESÃO ao motor existente + 1 mecanismo novo (presença de grade). Sem lib nova.
- Onda 3 introduz Yjs SÓ para texto longo; o resto é broadcast simples. A estratégia por campo vive num mapa
  declarativo (`campo → "ultimo-vence" | "crdt" | "nenhum"`), não espalhada no código.
- Cada onda é testável e deployável sozinha, mas acumulam na branch para UM deploy.

## Testes (por onda)

- **Onda 1:** integração (cópia local) — Oficina: 2 "usuários", um salva o molde, o outro recebe sem F5 +
  P0409 quando os dois salvam; parciais: evento na tabela-filha invalida a lista. Unit: `mergeArvorePorSlot`
  com `removidasIds` (fixtures como `mergeLinhas`); rolos no merge. Front: Oficina mostra anel de presença.
- **Onda 2:** unit do `useColabPresencaGrade` (transmite/recebe `{linhaId,campo}`); render do anel na célula.
- **Onda 3:** unit do mapa de estratégia por campo; broadcast "último vence" (recebe e aplica sem roubar foco);
  CRDT — 2 edições concorrentes no mesmo texto convergem (teste do Yjs doc). QA: digitar em 2 abas.

## Decisões em aberto (resolver no plano de cada onda, não agora)

- Onda 1: Admin (tenants/users) entra no realtime ou fica de fora (baixo valor colaborativo)?
- Onda 1: a defesa de servidor "lista vazia" das OCs entra agora ou vira débito?
- Onda 3: lista final de campos por estratégia; qual provider Yjs sobre o Supabase; teto de conexões.

## Fora de escopo

- Reescrever o motor de colaboração (já existe e funciona).
- Co-edição ao vivo em campos simples que 1 pessoa edita por vez com baixo valor (YAGNI).
- Presença de campo em telas só-leitura (Dashboard): só "quem está vendo", se tanto.
