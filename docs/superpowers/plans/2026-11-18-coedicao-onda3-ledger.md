# SDD ledger — plan: docs/superpowers/plans/2026-11-18-coedicao-onda3-lock-overlay.md

Spec: docs/superpowers/specs/2026-11-18-coedicao-onda3-lock-overlay-design.md
Branch: feature/plan-tecido-a1 (trabalho direto — fluxo da campanha; sem worktree isolado)
Execução: subagentes. Implementador Sonnet; revisão Opus. Haiku PROIBIDO (feedback dono 18/nov).

## Varredura de conflitos (pré-Task 1)

| Item | O que checei | Achado |
|---|---|---|
| T1 × T2 | T2 acrescenta a `coedicao.ts` o que T1 cria (`estadoDoCampo`, `LockInfo`) | OK — T2 importa de T1 no mesmo arquivo; ordem serial garante |
| T2 × T4 | T4 chama `aplicarCoedicao`/`ATTR_COEDICAO` de T2 | OK — assinaturas batem (`aplicarCoedicao(scope, locks, valorAoVivoPorPath, meuKey, agora)`) |
| T3 × T4 | T4 chama `useCoedicaoAoVivo` de T3 com `{chave, meuKey}` | OK — T4 passa `presenceKey` como `meuKey`; T4 expõe `presenceKey` no useColabRegistro |
| T1 auto-coerência | tests citam `resolverLock/estadoDoCampo/criarThrottle` = o que T1 exporta | OK |
| T2 auto-coerência | happy-dom + `pathDoElemento` derivado de `<label>` | OK — padrão real do projeto |
| T4 auto-coerência | teste-guarda por grep de fonte; fia hook no container existente | OK |

## Rulings (pré-Task 1)

Ruling R1: Task 3 — trocar `@testing-library/react` (`renderHook`/`act`) pelo padrão REAL do
projeto p/ testar hook. — `@testing-library/react` NÃO está no package.json (grep=0); o padrão
canônico (use-regerar-ref.test.ts, card-drafts.test.ts) é `act` de "react" + `createRoot` de
"react-dom/client" com um componente Probe que lê o hook, e `vi.mock("@/integrations/supabase/
client", …)` para stubar `getChannels`/canal. O brief do T3 manda usar o padrão do projeto, NÃO
testing-library. — Custo se errado: o teste do T3 não compila/roda; pego na revisão do T3.

Ruling R2: CSS global do escudo (T4, step 4g) = `src/styles.css` (confirmado: único com @tailwind).
— Custo se errado: a regra do escudo vai no arquivo errado; pego no build/QA do T4.

Ruling R3: o teste do T3 que depende de render de hook pode, se o padrão Probe ficar custoso,
cobrir as partes PURAS via as funções exportadas (já cobertas em T1) e deixar o comportamento do
canal (send/receive/heartbeat/expiração) para asserções via o stub de canal + Probe mínimo; se
ainda assim travar, o QA manual do T4 (2 abas) cobre o comportamento de rede e o relatório registra.
— Custo se errado: menos cobertura unit no hook; mitigado pelo teste-guarda do T4 + QA. 

## Progresso

(vazio — começando Task 1)

Task 1: implementado (commit b5bb267b, 13/13 testes, tsc limpo) — DONE_WITH_CONCERNS: implementador corrigiu 1 argumento de teste do brief (key no lugar do path); em revisão.
Task 1: revisão — Spec OK, qualidade Aprovada, 0 Crítico/Importante. Correção do teste confirmada legítima.
Task 1: minor (deferido): falta teste do desempate INVERSO (minha key maior → "outro"); falta teste do trailing do throttle via advanceTimersByTime e soltar() sem pendente; falta teste do limite EXATO 10_000ms (vivo). (coedicao.ts) — p/ a revisão final triar.
Task 1: complete (commits 82f6c1f..b5bb267b, review clean)
Task 2: BASE b5bb267b — implementador Sonnet despachado (aplicarCoedicao no DOM).
Task 2: implementado (commit 01b30aa4, 19/19 testes, tsc limpo) — DONE_WITH_CONCERNS: 2 correções SÓ de teste (env happy-dom por arquivo; fixture usava id=nome → path id:nome, trocado p/ data-t). Código de aplicarCoedicao idêntico ao brief.
Ruling R4: o path de campo pode ser id:/name:/lbl: (pathDoElemento prioriza id/name). NÃO é problema — emissor (lock/campoFocado) e aplicador (aplicarCoedicao/overlay) usam o MESMO pathDoElemento, então casa dos dois lados. — Carregar p/ Task 3/4: nunca assumir prefixo lbl:. — Custo se errado: lock e overlay apontariam campos diferentes; pego no QA de 2 abas do Task 4.
Task 2: revisão — Spec OK EXCETO 1 Importante (idempotência): campo já disabled por permissão + lock de outro → ao soltar, aplicarCoedicao faz disabled=false e REABILITA o que a permissão travava. Load-bearing p/ Task 4 (ReadOnlyScope no Sheet). Ruling R5: CORRIGIR agora (fix round 1) — só travar/marcar se !el.disabled ANTES; reverter só o que ESTE helper desabilitou. — Custo se errado: campo bloqueado por permissão viraria editável quando alguém larga o lock (fuga de permissão na UI). Menores deferidos: contenteditable marcado mas editável (cobrir via escudo CSS no T4); faltam testes travado→meu/expirado; scope não removido do body.
Task 2: fix round 1/5 (1 addressed, 0 open — idempotência c/ campo já disabled; commits 01b30aa4..d2295054); re-revisão escopada em curso.
Task 2: re-revisão fix round 1 — idempotência ADDRESSED, mas o fix introduziu 1 Importante LATENTE: perde o re-enforcement (campo marcado reabilitado por re-render do React não é re-travado, pois pula no jaMarcado). Vira REAL no Task 4 (effect que chama aplicarCoedicao). Ruling R6: corrigir agora (fix round 2) — condição de travar = (jaMarcado || !el.disabled); re-trava o marcado reabilitado, não toca o disabled-por-permissão. — Custo se errado: sob lock de outro, um re-render reabilita o campo e ele fica editável; pego no QA 2 abas do T4.
Task 2: fix round 2/5 (1 addressed, 0 open — re-enforcement jaMarcado||!disabled; commits d2295054..3d86da41).
Task 2: re-revisão fix round 2 — APROVADO (re-enforcement ADDRESSED, idempotência mantida, 8/8). Menor deferido: campo que vira disabled-por-permissão DURANTE o lock é reabilitado ao soltar (borda rara, fora do diff) — p/ revisão final.
Task 2: complete (commits b5bb267b..3d86da41, review clean após 2 fix rounds)
Task 3: BASE 3d86da41 — implementador Sonnet despachado (useCoedicaoAoVivo; rulings R1 teste-de-hook e R4 path carregados).
Task 3: implementado (commit ca4b3d64, 14/14 testes, tsc limpo) — DONE_WITH_CONCERNS: (1) handlers reanexados a cada tick (anexadoRef) pq canal abre tarde; (2) ⚠️ expiração usa `< EXPIRACAO` (expira EM 10s) vs resolverLock da lib usa `>` (10000ms ainda vivo) — DIVERGÊNCIA de limite a revisar; (3) rede real só no QA do T4.
Task 3: revisão — Spec OK, Aprovada com ressalvas. Fix round 1 (4 correções coesas):
  R7 (Importante): ts do lock vem do REMETENTE comparado c/ Date.now() do RECEPTOR → clock skew >~6s quebra expiração. FIX: carimbar ts=Date.now() no recebimento, ignorar p.ts. Load-bearing (produção multi-máquina).
  R8: handlers "zumbi" chamam setState pós-unmount (StrictMode/troca meuKey). FIX: flag `let ativo=true` por execução do effect + `if(!ativo) return` nos 2 handlers (resolve tb meuKey obsoleto na closure).
  R9: divergência de limite de expiração — hook usa `< EXPIRACAO` (expira EM 10s), lib resolverLock usa `>` (10000ms vivo). FIX: exportar `lockVivo(l, agora)` da lib (fonte única) e usar nos DOIS lugares; ajustar o teste de 10.5s p/ a latência real do varredor.
  R10: sem log de saída — fechar Sheet/trocar chave deixa o campo do outro travado até ~10s. FIX: no cleanup, se meuPathRef setado e há canal, enviar campoLock {path:null}. Load-bearing p/ QA do T4 (fechar Sheet com campo focado).
Task 3: minor (deferido): bail-out setValor se prev[path]===valor; limpar valorAoVivoPorPath ao trocar chave; faltam testes de contagem de on()/unsub no unmount. — p/ revisão final.
Task 3: fix round 1/5 (4 addressed, 0 open — clock skew/zombie handlers/lockVivo único/release no cleanup; commits ca4b3d64..644bec99; 31/31).
Task 3: re-revisão fix round 1 — 3/4 ADDRESSED+provados; #2 (handlers zumbi) ADDRESSED NO CÓDIGO (guards ativo confirmados por leitura) mas o TESTE não prova (React 19 não loga warning setState pós-unmount → not.toThrow vazio). Verificado por mutação pelo revisor. Ruling R11: fix round 2 SÓ de teste — fortalecer o teste do #2 p/ assertar efeito observável (capturar api antes do unmount) + fixar "10000ms vivo" na lib (menor apontado). Código do hook já correto.
Task 3: fix round 2/5 (1 addressed, 0 open — teste zombie sensível ao guard + limite exato 10000ms; só testes; commits 644bec99..2544ae9d; 34/34).
Task 3: fix round 2 = só testes (git diff --stat confirma: 2 arquivos de teste; nenhum em src/). Suíte colab inteira 42/42 (colab-coedicao + dom + use-coedicao). Re-revisão escopada DISPENSADA por ruling R12 (diff só-testes, já validado por mutação pelo implementador + re-revisão anterior cobriu a lógica; revisão final Opus cobre tudo).
Task 3: complete (commits 3d86da41..2544ae9d, review clean após 2 fix rounds; 1 ruling R12 de dispensa de re-revisão só-testes)
Task 4: BASE 2544ae9d — implementador Sonnet despachado (integração no PlanejamentoDetail + presenceKey + escudo CSS + teste-guarda; QA 2 abas = pendência p/ prévia).
Task 4: implementado (commit 32567de4, 4 arquivos; teste-guarda 2/2, tsc limpo, build OK, 115 colab verdes; Salvar/draft/P0409 intocados) — DONE. QA 2 abas pendente (prévia). Concern: .value em input controlado pode ser sobrescrito por re-render (já era ⚠️ do plano, verificar no QA).
Task 4: revisão — Spec OK, Aprovada com 2 Importantes p/ fix round 1:
  R13 (Importante, LOAD-BEARING): aplicarCoedicao não restaura o valor original ao destravar → o texto do OUTRO fica no DOM; se B edita depois sem re-render, pode entrar no draft/Salvar de B (vazamento indireto, fura o espírito do teste-guarda). FIX (em coedicao.ts/Task 2): ao travar guardar data-coedicao-orig; na reversão restaurar o .value original e descartar a marca. (Idempotência dos fixes anteriores mantida.)
  R14 (Importante): teste-guarda por regex é frouxo (passa alias valorAoVivoPorPath: e mutação multi-linha). FIX: allowlist exata — contar ocorrências de valorAoVivoPorPath e exigir que CADA uma esteja em linha com aplicarCoedicao(/useCoedicaoAoVivo(/array de deps [locks, valorAoVivoPorPath; proibir `valorAoVivoPorPath:` (alias).
Task 4: minor (deferido p/ revisão final + QA 2-3 abas): #3 gatilhos de composto (Select/popover data/checkbox/radio) fora de COLAB_FIELD_SELECTOR não recebem escudo; #4 perdedor de corrida de foco pode manter lock até próximo foco (auto-cura; olhar no "nunca travado pra sempre"); #5 re-render do componente inteiro por evento + flash de 1 frame (perf/visual). Input controlado = aceitável (disabled→sem onChange); vai pro QA.
Task 4: fix round 1/5 (2 addressed, 0 open — restaura valor orig ao destravar [ATTR_COEDICAO_ORIG] + teste-guarda allowlist exata; commits 32567de4..ba3a579d; 48/48). Nova concern p/ QA: se draft de B muda o campo DURANTE o lock, data-coedicao-orig pode defasar (raro, React sobrescreve no re-render).
Task 4: re-revisão fix round 1 — AMBOS os findings ADDRESSED (restauração do original provada X→Y→YZ→X; teste-guarda allowlist exata provado por mutação spread 3/4 falham; idempotência anterior intacta).
Task 4: parked — Ruling R15: item A (dessincronização DOM×React numa corrida de dupla condição: merge do servidor DURANTE o lock + novo valor == espelho + ordem inversa destrava-depois-do-merge) classificado MENOR, deferido. — Por quê: dupla condição muito improvável, auto-curável no próximo evento, e puxar outro fix no aplicarCoedicao (já com 3 rounds) arrisca regressão no código central por ganho marginal. — Custo se errado: num caso raríssimo B pode sobrescrever em silêncio a edição de A naquele campo até o próximo foco; CARREGAR p/ revisão final Opus + QA de 2 abas (o runtime real é onde isso se verifica).
Task 4: complete (commits 2544ae9d..ba3a579d, review clean após 1 fix round; 1 parked R15)

FINAL: revisão de branch inteira (82f6c1fc..ba3a579d, 9 commits) despachada em OPUS; suíte colab 48/48. Ledger apontado p/ triagem (minors T1/T3/T4 + parked R15).

FINAL: revisão de branch OPUS = APROVADA para merge. 0 Crítico / 0 Importante; 3 invariantes garantidos por construção. Todos minors + parked R15 = OK diferir. Suíte colab 48/48.
FRENTE COMPLETA — commits 82f6c1fc..ba3a579d (9 commits) na branch feature/plan-tecido-a1.
PENDENTE (portão do dono): QA de 2 abas na prévia local (7 verificações, R15 é prioridade 1) + merge/deploy (NÃO feito por mim).
