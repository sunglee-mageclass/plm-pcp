# Co-edição ao vivo (Onda 3) — Lock por campo + overlay ao vivo

**Data:** 2026-11-18
**Frente:** Realtime universal / Camada — Onda 3 (co-edição ao vivo)
**Tela-piloto:** Sheet do Planejamento (`src/components/planejamento/PlanejamentoDetail.tsx`)
**Branch:** `feature/plan-tecido-a1`
**Tipo:** front puro — **ZERO migration, ZERO banco** (só broadcast Realtime, que não toca o Postgres)

---

## Entendimento (intenção do dono, confirmada no brainstorm 18/nov)

No Sheet do Planejamento, duas pessoas no mesmo card se editam **ao vivo, estilo Google
Docs** — sem F5, sem "o último Salvar vence", sem ninguém apagar o que o outro digita. O dono
pediu explicitamente "ver o que está sendo editado e o campo realmente atualizar na hora em
tempo real mesmo" e "sincronização em tempo real sem precisar recarregar a página".

**Decisões do dono (brainstorm 18/nov):**
1. **Trava o campo** (ideia do dono, substituiu o merge/Yjs do desenho original): enquanto A
   está num campo, esse campo fica **bloqueado** para B, com "fulano está editando". B só edita
   quando A sai. Como ninguém edita o mesmo campo ao mesmo tempo, **não há conflito a fundir**.
2. **Trava leve + desempate** (não trava garantida pelo banco): a trava viaja pelo broadcast
   que já existe (nada no banco, nenhuma conexão nova). No empate raro de clique simultâneo, um
   desempate determinístico decide o dono em ~100-300ms; o Salvar com P0409 (Ondas 1-2) é a rede
   de segurança final.
3. **Tecla a tecla (espelho ao vivo)**: B vê o campo de A mudando letra a letra, no campo já
   travado. Com **throttle ~100ms** (parece tecla-a-tecla ao olho, 5-10× menos tráfego — seguro
   para o limite de conexões do incidente MICRO).
4. **Expiração do lock = ~10s**: se a aba dona some (crash/net), as outras liberam o campo
   sozinhas após ~10s sem heartbeat. No uso normal (sair do campo) libera na hora.
5. **Piloto:** só o Sheet do Planejamento, todos os campos ao vivo. Outras telas = ondas
   futuras, reusando o mesmo mecanismo.
6. **Valor final (i):** quando o outro solta o campo, o valor dele fica no overlay até o
   **Salvar dele** trazer o valor oficial (`onMudancaServidor`). Cada um salva o que editou; o
   meu draft NUNCA adota a edição do outro sozinho.

**Sucesso:** 2 abas no mesmo card — A digita e B vê as letras ao vivo com o campo travado +
anel colorido; B tenta editar o mesmo campo e está bloqueado; A sai e B assume; fechar a aba de
A libera o campo em ~10s; e o nº de canais Realtime por tela **continua ~4** (nenhum canal novo).

## O que isto NÃO é (YAGNI — cortado do pedido original)

- **Sem Yjs / CRDT.** A trava impede duas pessoas no mesmo campo, então não há conflito a
  fundir — a lib nova e o "híbrido por tipo de campo" deixaram de ser necessários. Texto, número
  e data usam o **mesmo** mecanismo.
- **Sem servidor novo, sem tabela nova, sem canal novo.** Tudo em cima do canal
  `colab:modelo:${modeloId}` que já existe (`useColabRegistro`).

## Abordagem escolhida (A — "camada de overlay ao vivo")

O `draft` local continua sendo **só o que EU edito** (como hoje). O valor ao vivo que chega do
outro vai para um **mapa separado** `valorAoVivoPorPath` — **não** entra no `draft`, **não**
marca `touched`, **não** entra no Salvar. A renderização de cada campo: *se outro tem lock neste
path → mostra o `valorAoVivo` + input travado + "fulano está editando"; senão → mostra o `draft`
normal*. Isolamento total entre "o que eu edito" e "o que vejo ao vivo do outro" — respeita o
princípio da campanha ("Salvar nunca apaga o que o usuário não apagou") e não mexe no
P0409/merge das Ondas 1-2.

(Abordagem B rejeitada — escrever o valor do outro direto no `draft` com "dono por campo" —
porque o valor do outro vazaria para o SEU Salvar em vários pontos; risco de regressão de dado.)

## Terreno existente que a Onda 3 REUSA (não reinventa)

- **Canal** `colab:modelo:${modeloId}` já aberto pelo `useColabRegistro`
  (`src/hooks/useColabRegistro.ts`): presence (nome) + broadcast `campoFocado` (`self:false`,
  com re-eco para late-joiners e volta de background).
- **Path semântico do campo** = `pathDoElemento` / `data-colab-path` / rótulo
  (`src/lib/colab/colab-field-path.ts`): identificador ESTÁVEL derivado do rótulo, igual nos dois
  lados (reencontra o mesmo campo na outra aba mesmo com accordions diferentes). **A Onda 3 não
  inventa path nenhum.**
- **Anel de presença por campo** = `ColabPresenceOverlay` (Onda 2): já reencontra o elemento
  pelo path e desenha o anel. O lock reusa esse mesmo overlay para a etiqueta "fulano está
  editando".
- **`campoFocado`** já rastreado no `PlanejamentoDetail` (onFocusCapture → `pathDoElemento`;
  onBlurCapture → null; `ColabPresenceOverlay` montado no fim do Sheet).
- **Draft isolado**: `draft` + `setDraftTracked` (marca o que EU editei em `touchedRef`) +
  `draftLiveRef` (espelho síncrono para o merge no onError). O overlay fica FORA disso.

## Seção 1 — Arquitetura de rede

Tudo trafega no canal **que já existe** (`colab:modelo:${modeloId}`). Zero canal novo, zero
conexão nova. Dois sinais novos, ambos `self:false` como o `campoFocado` de hoje:

1. **`campoLock`** — `{ key, path, dono, ts }`. **Ruling de desenho:** o lock REUSA o sinal
   `campoFocado` que já existe como base (ele já diz "qual aba está em qual path"); o evento
   `campoLock` só ACRESCENTA o critério de desempate (`presenceKey`) e o heartbeat (`ts`). Assim
   o anel (Onda 2) e o lock (Onda 3) ficam em sincronia por construção — impossível o anel dizer
   "fulano edita" e o campo não travar.
2. **`valorAoVivo`** — `{ key, path, valor }`, com **throttle ~100ms** (função pura própria;
   não há lodash no projeto). Enquanto eu digito num campo travado por mim, emito o valor atual a
   cada ~100ms. Os outros aplicam no overlay (nunca no draft).

**Desempate (empate de foco):** a mensagem `campoLock` carrega o `presenceKey`
(`userId::abaId`, já existe). Se duas abas travam o mesmo path quase junto, **a de menor
`presenceKey` vence**; a perdedora, ao receber um `campoLock` de `presenceKey` menor no path que
ela também travou, **cede** (solta o foco programaticamente, vira "travado pelo outro").
Determinístico, sem servidor, resolve em ~100-300ms.

**Expiração (aba que some):** cada lock ativo guarda `ts`; um heartbeat re-anuncia o lock a cada
~4s (reusa o re-eco que o `useColabPresencaPagina` já faz). Se um lock não é re-anunciado por
**~10s**, os outros o consideram morto e **liberam** o campo. A expiração é **incondicional**
(não depende do dono mandar "soltei") — nunca há campo travado pra sempre.

## Seção 2 — Ciclo de vida do lock por campo

Cada campo, para cada aba, está em um de três estados (derivados do mapa de locks do broadcast):

| Estado | Quando | O que você vê |
|---|---|---|
| **Livre** | ninguém travou este path | input normal, editável |
| **Meu** | EU travei (foquei) | input normal, editável; os outros me veem como dono |
| **Travado por outro** | outra aba travou | input **desabilitado** + anel + etiqueta "Fulano está editando" + (se chegou `valorAoVivo`) o valor dele ao vivo |

**Transições:**
- **Foco (onFocus)** → se *Livre*, viro *Meu* e anuncio o lock. Corrida: se eu focar no mesmo
  instante que o outro, o **desempate por `presenceKey`** decide; se perco, meu foco é solto
  (`blur()`) e o campo vira *Travado por outro*.
- **Blur / fechar o Sheet / trocar de card** → solto o lock na hora (`path:null`); volta a
  *Livre* para os outros.
- **Lock do outro expira (~10s)** → volta a *Livre* para mim, posso assumir.

**Valor final = (i):** quando o outro solta o campo, o `valorAoVivo` já no overlay fica
exibido até o próximo **Salvar dele** trazer o valor oficial (via `onMudancaServidor`, que já
existe). Cada um salva o que editou; o meu draft nunca adota a edição do outro sozinho.

## Seção 3 — Renderização: o campo travado ao vivo

Auto-instrumentada (DOM pós-render), **igual ao anel de hoje** — um hook + uma camada no
container, NÃO N edições de campo.

1. Hook novo **`useCoedicaoAoVivo`** (ao lado do `useColabRegistro`) devolve `locksPorPath`
   (quem trava o quê) e `valorAoVivoPorPath` (o espelho do outro), alimentado pelos eventos da
   Seção 1.
2. No `onInputCapture`/`onChangeCapture` do container (mesmo lugar do `onFocusCapture` de hoje),
   além de `campoFocado`, emito o `valorAoVivo` com throttle quando o campo é *Meu*.
3. Função pura **`aplicarCoedicao(container, locksPorPath, valorAoVivoPorPath, meuKey)`** (num
   `useEffect` após cada atualização) percorre os campos por `COLAB_FIELD_SELECTOR` e, para cada
   path *Travado por outro*: põe `disabled`, injeta o `valorAoVivo` no `.value` do DOM, e deixa o
   `ColabPresenceOverlay` desenhar anel + etiqueta.

**Por que DOM pós-render e não `disabled` via React campo a campo:** exigiria tocar dezenas de
componentes (e os de terceiros: `MoneyInput`/`DateField`/`Select`). A abordagem auto-instrumentada
cobre TODOS os campos de uma vez, incluindo os compostos, sem reescrevê-los — consistente com o
anel de hoje.

**Campos compostos** (`Select` Radix, `DateField`, `MoneyInput`, textarea): `disabled` via DOM
serve para input/textarea; para os que abrem popover, aplico um **escudo de clique** transparente
sobre o campo travado (um overlay por path), em vez de depender do `disabled` interno de cada um.
Um só escudo, aplicado por path, cobre os compostos.

## Seção 4 — Erro, desconexão e degradação

Princípio: **se o Realtime falhar, a tela volta a funcionar exatamente como hoje** (rascunho
local + Salvar com P0409 como rede de segurança final). Degradação graciosa, nunca tela quebrada.

1. **Canal cai / não conecta** (incidente MICRO, 53300): sem canal → sem lock, sem espelho.
   Todos os campos ficam *Livres* e editáveis (como antes da Onda 3). Se dois editarem o mesmo
   campo, o **Salvar com P0409/merge das Ondas 1-2 pega**. Nada se perde.
2. **Lock preso por bug:** o timeout de ~10s SEMPRE libera (incondicional).
3. **Eco do próprio valor:** `self:false` já garante; se vazar, o path é *Meu*, então ignoro
   `valorAoVivo` de path que eu travei.
4. **Mensagem corrompida/desconhecida:** ignorada em silêncio (`if (!p?.key || ...) return`,
   como o `campoFocado` já faz).
5. **Volta de background:** reusa o re-eco que o `useColabPresencaPagina` já faz — re-anuncia
   meu lock e peço eco dos outros.
6. **Nunca bloqueia o Salvar.** O lock é sinal de UI; o Salvar continua governado só pelo
   `rev`/P0409. A Onda 3 NÃO introduz novo caminho de perda de dado.

**Contrato:** a Onda 3 só adiciona conforto visual. Removê-la (ou a rede falhar) deixa a tela
idêntica às Ondas 1-2, com o P0409 como garantia final. Nenhuma regressão de dado é possível por
construção.

## Seção 5 — Testes e verificação

**1. Unit (Vitest) — a lógica pura, onde mora o risco:**
- **`throttleAoVivo`**: emite na borda de ataque, agrupa o resto, emite o último ao soltar.
  Casos: 1 tecla; rajada de 7 teclas em 50ms (sai 1-2 msgs); última tecla sempre entregue.
- **`resolverLock`** (desempate puro): dois locks concorrentes no mesmo path → dono por
  `presenceKey` menor; lock expirado (`ts` > 10s) ignorado; meu lock vence sobre espelho *Meu*.
- **`estadoDoCampo(path, locks, meuKey)`** → `'livre' | 'meu' | 'outro'` + dados do dono.
  Tabela-verdade completa.
- **`aplicarCoedicao`**: container fake (happy-dom) — path *outro* vira `disabled`/escudo +
  valor injetado; path *livre*/*meu* fica intocado.

**2. Integração — nada novo no banco.** Front puro, zero migration. Um teste garante que o
overlay NUNCA entra no payload do Salvar (`draftLiveRef` ignora `valorAoVivoPorPath`).

**3. QA manual (cópia local :5190), 2 abas do mesmo card:**
- A digita → B vê letras ao vivo + campo travado + "A está editando".
- B tenta o mesmo campo → bloqueado (escudo/disabled).
- A sai → B assume; A salva → valor oficial em B sem F5.
- Fecha a aba de A no meio da digitação → campo libera em B em ~10s.
- **Gate do incidente MICRO:** contar os canais Realtime (DevTools → WS) = continua **~4**
  (nenhum canal novo).
- Rede offline (DevTools) → tela volta a funcionar como hoje, sem travar.

**4. Gates da campanha:** `npm run build` + `npx tsc --noEmit | grep TS2304`; `code-reviewer`
automático; revisão Opus final focada em "o overlay nunca contamina o Salvar" e "nenhum caminho
deixa o campo travado pra sempre".

## Arquivos (previstos)

- **Criar** `src/hooks/useCoedicaoAoVivo.ts` — locks + valorAoVivo por path; eventos `campoLock`
  e `valorAoVivo`; heartbeat ~4s; expiração ~10s; desempate por `presenceKey`.
- **Criar** `src/lib/colab/coedicao.ts` — puros: `throttleAoVivo`, `resolverLock`,
  `estadoDoCampo`, `aplicarCoedicao`. (+ fixtures em `tests/` para o anti-regressão.)
- **Modificar** `src/components/planejamento/PlanejamentoDetail.tsx` — fiar o hook, emitir
  `valorAoVivo` no `onInputCapture`, aplicar `aplicarCoedicao` no `useEffect`, e o escudo por path.
- **Reusa sem modificar:** `useColabRegistro`, `useColabPresencaPagina`, `ColabPresenceOverlay`,
  `colab-field-path.ts`.

## Riscos

1. **Tráfego de broadcast (incidente MICRO).** Mitigado pelo throttle ~100ms (5-10× menos
   mensagens) e por NÃO abrir canal novo (gate: ~4 canais). Degradação graciosa se cair.
2. **Overlay vazar para o Salvar** (regressão de dado). Mitigado por construção (Abordagem A:
   overlay em mapa separado, nunca no draft) + teste que fixa que `draftLiveRef` ignora o overlay.
3. **Campo travado pra sempre.** Mitigado pela expiração incondicional de ~10s.
4. **Campos compostos** (Select/DateField/MoneyInput) não aceitam `disabled` via DOM. Mitigado
   pelo escudo de clique por path.
5. **Path divergente entre abas** (anel no campo errado). Já mitigado hoje — path semântico por
   rótulo, igual nos dois lados; a Onda 3 reusa o MESMO path, não cria novo.
