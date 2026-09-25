# Distribuição por produto — especificação

**Data:** 25/set/2026 · **Status:** desenho — mockup APROVADO pelo dono (v4, 25/set 15:2x; artifact
`WAQb4W8LBYgNh6cNJsEo4D`, fontes em `scratchpad/mock-distribuicao/project/{Main,Dialog,DialogNumero,Direcionamento,DialogMobile}.dc.html`)
· decisões TRAVADAS em `.superpowers/estudos/2026-09-25-distribuicao-por-produto-decisoes.md` · pedido verbatim em
`…-pedido.md` · estudo técnico em `…-estudo.md` (checkout principal).
**Worktree:** `.claude/worktrees/distribuicao-produto`, branch `distribuicao/por-produto`, base `13ec1dae`.
**Corre em paralelo** à "Reorganização do Sheet do Planejamento" (worktree `sheet-reorg`, migration `20261005100000`) —
P-26 = A. Esta frente usa `20261006100000` em diante e é aplicada em produção DEPOIS da reorganização.

Este documento é só o DESENHO (dados, regras, telas, produção). Sem código aplicado. O plano de implementação é
`docs/superpowers/plans/2026-09-25-distribuicao-por-produto.md`.

---

## 1. Contexto e objetivo

Hoje a Distribuição é uma **página** (`/distribuicao`, módulo opt-in `distribuicao`, commit `44a1a91`) com N tabelas por
**subcoleção** cuja unidade é "modelos por tamanho" × cores × peças/mês (+ markup, valor médio, poder de venda). O
Direcionamento mostra um "resumo da subcoleção" global (RPC `direcionamento_resumo_subcolecao`).

O dono pediu (item 5, 25/set):

1. No **Plan. Tecido**, ao lado do "pç" do Tecido 1, um botão que abre um **dialog por produto** com a tabela de
   distribuição: debaixo de cada loja, as **variantes** (cores do Tecido 1), formando uma tabela completa loja × cor ×
   tamanho. Saem da tabela: cores, peças/mês, markup, valor médio, poder de venda.
2. Abaixo da distribuição, uma tabela **"Total por cor × tamanho"** (soma das lojas) — **é isso que preenche o "pç"** de
   cada cor do Tecido 1 no card.
3. A página Distribuição **deixa de existir**.
4. Essa tabela loja × variante × tamanho **vira o resumo do Direcionamento, por modelo** (o global "não servirá mais").

As decisões do dono (§2) acrescentaram: Base por loja × cor com correção à mão por quadradinho, todos os tamanhos da
grade no formato do "Tamanho em" do produto, o "atende a" do forro/Tecido 2 no card, o semi-preenchimento do
Direcionamento e o apagamento da Distribuição antiga no mesmo roteiro.

## 2. Decisões do dono (25/set, TRAVADAS — resumo fiel do arquivo de decisões)

| # | Decisão |
|---|---|
| P-09 = D | Proporção do card + 1 **Base por LOJA × COR** (variante do Tecido 1) → tamanhos = `round(prop × base)`; QUALQUER quadradinho pode ser corrigido à mão (marcado com ponto; hover "calculado seria N · ↺ voltar ao calculado"). |
| P-23 = A | Mudar a Base NÃO mexe no quadradinho corrigido à mão; só os calculados acompanham. |
| P-24 = B / P-25 | O dialog mostra TODOS os tamanhos da grade da loja, só em LETRA ou só em NÚMERO conforme `modelos.tamanho_tipo` (nasce Letra); tamanhos com proporção 0 esmaecidos, mas digitáveis. |
| P-10 (revista) | Distribuído ⇒ o pç da cor do Tecido 1 no card fica SÓ LEITURA (muda pelo dialog). SEM aviso de divergência no Plan. Tecido (é PLANO, não o real) — P-19 sem efeito. |
| P-11 = A | Distribuição só do Tecido 1 (linhas = cores do Tecido 1). |
| P-17 = B, P-18 = A, P-20 = A | Forro/Tecido 2: cada cor ganha **"atende a: [cores do Tecido 1]" NO CARD** (padrão automático = mesma cor base; trocável); pç = SOMA das cores do T1 que atende (só leitura); metragem = pç × consumo próprio; cada cor do T1 é atendida por UMA cor de cada forro/T2 (já atendida aparece desabilitada). É o "casar variantes" do BOM (`complementas`) — a mesma amarração aparece no BOM do Sheet. |
| P-21 = B | Sem botão "Limpar distribuição". |
| P-22 = A | Depois do Envio à Explosão o dialog abre SÓ LEITURA (ver e imprimir). |
| Dialog | Botão IMPRIMIR (imprime exatamente o que o dialog mostra); FOTO do produto (capa: `fotos_modelo[0]` → `desenho_tecnico_url` → `croqui_url`) ao lado do nome; badges viram ícone + hover; tabela "Total por cor × tamanho". |
| P-12 (revista) | Direcionamento mostra o PLANO do modelo (loja × cor × tamanho, só leitura) e ABRE SEMI-PREENCHIDO quando o modelo ainda não tem direcionamento salvo: onde cor × tamanho da Grade Real = total do plano → células com o plano; onde difere → "–" em TODAS as lojas (âmbar, "distribua à mão N peças"). Σ Direcionado conta vazio como 0 ("faltam N"); Confirmar segue exigindo Σ = Grade Real (invariante #10 intocada). Botão "Preencher com o plano" reaplica a regra. "Grade Real" com "i" (hover). |
| P-15 = C | Comprados (revenda/importado) FORA desta entrega (Direcionamento mostra "sem plano"). |
| P-16 = C | Direcionamento fica só com "X modelos direcionados" (sai o /Y e o resumo global). |
| P-14 = B | A Distribuição ANTIGA (tabelas + RPCs + página) é APAGADA (não arquivada), com backup antes, NO MESMO roteiro de produção desta frente (não antes: a página atual usa as tabelas). |
| Mobile | Tabela com rolagem horizontal só dentro dela; coluna Loja/Cor fixa com nomes ABREVIADOS (Marr. · Can.), nome completo ao tocar; nada sobrepõe. |
| P-26 = A | Em paralelo à reorganização do Sheet; migration > `20261005100000`, aplicada DEPOIS dela. |
| P-31 = A (25/set) | O "atende a" automático vale para TODOS os cards que já existem; cor de forro/T2 sem amarração mantém o pç digitado + aviso âmbar. |
| **P-32 = B** (25/set) | O semi-preenchimento do Direcionamento NÃO conta como "alteração não salva" (sair sem editar não pergunta nada). |
| P-33 = A (25/set) | "Replicar card(s)" NÃO leva a distribuição nem o "atende a". |
| P-34 = A (25/set) | Distribuir herda a edição do Plan. Tecido (sem permissão nova). |
| **P-35 = A** (25/set) | O controlador escolhe o card e o modelo da QA na cópia, publica os ids no painel e espera o OK do dono. |
| **P-36 = B** (25/set) | Imprimir SÓ no desktop (o botão some no celular; a impressão em si fica igual). |

## 3. Rulings (lacunas/contradições — decididas pela leitura mais fiel; "custo se errado")

> **Emenda 25/set (G-plano do guardião — LIBERA COM RESSALVAS — + respostas do dono P-31…P-36):** os rulings do controlador
> PR10–PR19 estão no plano §2 (encoding/pós-condição/NOTIFY/trava nas migrations; "atende a" automático preservado; carga
> que recalcula fica "não salva" com aviso; casamento preservado só com cores atuais do T1; presença em `SelectTrigger`;
> `isFetched`; ponto da célula à mão com balão; N3 pelo painel; notas N2/N3/N4/N8). Abaixo, os R afetados já corrigidos.

| # | Ruling | Por quê | Custo se errado |
|---|---|---|---|
| R1 | A distribuição mora em **`plan_tecido_variantes.distribuicao jsonb NOT NULL DEFAULT '{}'`**, só nas variantes do **Tecido 1** (`tipo='tecido' AND numero=1`; o servidor força `'{}'` fora dele). Formato por cor: `{"<loja_id>": {"base": n, "grades": {"<tamanho>": q}, "manuais": ["<tamanho>", …]}}` — `grades` guarda as células RESOLVIDAS (manual + calculada > 0; a manual guarda até 0). | Opção 1 do estudo: viaja no MESMO funil do pç (árvore → `salvar_plan_tecido` → `plan_rev`/P0409 → merge por slot); sobrevive ao delete+reinserção; vale para card sem modelo (143 de 312 slots da Ave Rara). `base`+`manuais` são o que se digita; `grades` é o que o Direcionamento lê sem recalcular (sem risco de drift TS × SQL no arredondamento). | Nenhum: a coluna é aditiva e a volta a remove. |
| R2 | O "atende a" mora em **`plan_tecido_variantes.atende jsonb NULL`** (só fora do Tecido 1): `NULL` = automático (mesma cor base); array de **chaves de cor do Tecido 1** = escolhido à mão. A chave é a mesma do `varKey` do front (`variante_tecido_id`; cor planejada = `plan:<cor_id>\|<apelido_id>`). | O BOM (`modelo_tecido_variantes.complementa_variante_ids uuid[]`) só aceita variante REAL; no plano o Tecido 1 pode ter cor planejada e o card pode não ter modelo. | Uma coluna a mais; a volta a remove. |
| R3 | **Reaproveitar o "casar variantes"**: `_plan_tecido_gravar_bom_core` passa a gravar `complementa_variante_ids` a partir da chave `complementa_variante_ids` de cada variante do payload (só ids que são variante REAL do Tecido 1 no MESMO payload; o Tecido 1 grava sempre NULL). **Payload sem a chave ⇒ PRESERVA** o casamento que o BOM já tinha (mesmo tipo+número+variante), **só com as cores que continuam no Tecido 1 do payload** (PR13 — senão a reserva do forro zeraria em silêncio). | Conferido: o Plan. Tecido NÃO grava o casamento e o `_plan_tecido_gravar_bom_core` vivo faz DELETE + reinserção SEM a coluna — hoje todo "aplicar" do plano APAGA em silêncio o casamento feito no BOM do Sheet/Dev (4 de 651 linhas têm casamento na cópia). O reuso liga o "atende a" do card ao BOM (P-20: "a mesma amarração aparece no BOM do Sheet") e à reserva (#4 já usa `_grade_soma_pares`). | Preservar um casamento velho que ninguém quer — visível e desfazível no BOM do Sheet. |
| R4 | **Gate = módulo `distribuicao`** (opt-in, continua sendo o gate): com ele desligado o card fica EXATAMENTE como hoje (pç digitável, sem "atende a", sem botão) e o payload do aplicar NÃO leva a chave de casamento (⇒ preserva — R3). O Direcionamento mostra "sem plano" com o motivo. | O pedido é a evolução da Distribuição (módulo opt-in); ligar para todas mudaria as contas de forro de loja que não pediu. | Nenhum para quem não usa. |
| R5 | `tenant_module_enabled`: **`'distribuicao'` entra na lista default-OFF** (chave ausente = desligado, como no front). ACL da função INTOCADA (as policies a chamam como o usuário). `etapas_pl` tem a MESMA discrepância e fica FORA (anotado no §8). | Discrepância pedida no brief; hoje nenhum leitor do servidor usa `'distribuicao'`, então a mudança só afeta a RPC nova. | Nenhum (só `_module='distribuicao'` muda). |
| R6 | A distribuição e o forro são **DERIVADOS na árvore** por UMA função pura `normalizarSlotDistribuicao(slot, {ligado, tamanhos})`, chamada (a) no carregamento (`computeFreshArvore`, o pipeline único) e (b) em TODA edição (`patch`, o funil único): recalcula as células não-manuais (proporção × Base), o pç (`grade_total` + `grades` por tamanho) de cada cor distribuída e o pç do forro/T2 amarrado. Idempotente (devolve o MESMO objeto quando nada muda). O 1º merge espera `tamanhos` e os módulos carregarem (`isFetched`, e re-semeia se chegarem/mudarem depois — PR15). **Se a normalização na CARGA mudar o que veio do banco, o slot fica "não salvo" com o aviso "N cor(es) de forro/Tecido 2 recalculada(s) pela amarração — salve para gravar"** (PR12 — o Resumo/Pedido leem o salvo). | Todas as contas do Plan. Tecido (metros, a comprar, poder de venda, pedido, aplicar) já leem `grade_total` — nada muda de fórmula, só quem preenche o número; uma fonte só. | Um card aberto antes dos tamanhos carregarem — coberto pela espera. |
| R7 | Card de modelo real: o merge "Dev vence" ganha `comDistribuicaoDoPlano` (leva a distribuição salva para as cores vivas do Tecido 1 pela chave) e `comAtendeDoPlano` (o casamento do BOM vence; sem casamento no BOM, vale o do plano). Para cor distribuída o pç do card é SEMPRE a soma da distribuição, mesmo que o Dev/Sheet tenha mudado a grade — SEM aviso (P-10 revista). Casamento do BOM IGUAL ao automático (toda cor casada do T1 com a mesma cor base) volta como NULL (automático — PR11), para uma cor nova do T1 com a mesma cor base seguir atendida sozinha (P-17). | Sem isso a distribuição se perderia em silêncio no merge (risco R4 do estudo). | O card mostra o plano, não o real — é a decisão do dono. |
| R8 | **Cor distribuída** = tem ≥ 1 loja com Base > 0 ou com célula à mão. Linha de loja com Base 0 e sem célula à mão SAI na normalização. | O `NumberInput` transforma vazio em "0" (`NumberInput.tsx:69`): não dá para distinguir "apaguei" de "0". | Nenhum. |
| R9 | **Célula à mão** = valor digitado ≠ calculado naquele momento; digitar o próprio calculado apaga o ponto; "↺" volta ao calculado. Mudar a Base OU a proporção recalcula só as não-manuais (P-23). | Leitura direta de P-09/P-23 + mockup (ponto + hover). | Nenhum. |
| R10 | **Salvar do dialog** escreve nas cores do Tecido 1 que têm linha (pç = soma) e nas que TINHAM e perderam todas as linhas (pç 0, `grades {}`). Cor que nunca foi distribuída mantém o pç digitado e aparece na tabela de baixo como "sem distribuição · pç do card N". Se alguma cor com pç > 0 vai a 0, um AlertDialog pede confirmação. | O mockup diz "Salvar preenche o pç das N cores"; zerar pç digitado de cor não tocada seria perda silenciosa. | Uma linha informativa a mais. |
| R11 | **Tamanhos** = `tamanhosDoTipo(tenant_config.tamanhos_grade, tipo)`: par "34\|PPP" entra rotulado pelo lado do tipo (`ladoTamanho`); item solto só entra se tiver o lado do tipo (Ark Store: `["36",…,"PP",…]` → Letra mostra PP…GG; Número mostra 36…44); se nenhum tiver, mostra todos. Tipo = `modelos.tamanho_tipo`; card sem modelo (ou NULL legado) = **Letra** (P-25). Células de tamanho fora da grade da loja somem na normalização. | P-24 = B no caso comum (pares) + resposta sensata ao solto (sem esconder tudo). | Cosmético em loja de grade solta. |
| R12 | A linha **"Proporção por tamanho do card"** do dialog edita `slot.proporcoes` (a MESMA do bloco "Proporção por tamanho" do card, e a que o aplicar copia para `modelos.proporcoes`). Chave legada só-letra/só-número é lida (`proporcaoDoTamanho`). | Mockup: a linha tem inputs; uma fonte só de proporção (estudo §3.3). | Nenhum. |
| R13 | **Lojas do dialog** = `lojas_direcionamento` ativas + qualquer loja (inativa/excluída) que já tenha dado na distribuição da cor (esmaecida, rótulo "(inativa)"/"Loja excluída", editável — dá para zerar). Ordem: E-commerce (default) → `ordem` → nome. | "Lojas ativas de Cadastro › Lojas" (mockup) + não esconder número que conta no pç. | Nenhum. |
| R14 | **Regra do "atende a"** (por bloco de forro/T2): (1) listas escolhidas à mão, na ordem das cores do bloco, vencem; (2) cor sem lista (automático) atende as cores do T1 de MESMA `cor_id` ainda livres; cada cor do T1 é atendida por no máximo 1 cor do bloco. Cor do bloco que não atende nenhuma ⇒ **pç digitado como hoje** + ícone âmbar ("não atende nenhuma cor do Tecido 1"); cor do T1 sem cor do bloco ⇒ aviso âmbar no bloco ("Sem cor deste forro: Vinho · Bordô"). Popover ganha "↺ padrão (mesma cor base)" quando a cor está à mão. | Decisão P-17/18/20; o mockup mostra só casos amarrados. Zerar o forro legado sem amarração derrubaria o "a comprar" em silêncio (ver P-31). | Um caminho a mais no popover. |
| R15 | "Atende a" vale para **todo bloco que não é o Tecido 1** (Tecido 2, 3… e todos os forros). | "forro/Tecido 2" no decidido; Tecido 3+ é o mesmo papel. | Nenhum. |
| R16 | A cor planejada do T1 que vira real (auto-upgrade do `MaterialBlock`) é **re-casada** no "atende a" por `cor_id`+`cor_apelido_id` (a chave muda de `plan:…` para o id). | Sem isso a amarração sumiria no upgrade. | Nenhum. |
| R17 | As variantes do BOM do Dev passam a trazer `cor_id` e `complementa_variante_ids` na query do `PlanTecidoSheet` (e o `modelos.tamanho_tipo`). | O automático precisa da cor base; o casamento do BOM precisa chegar ao card. | Payload da query um pouco maior. |
| R18 | O dialog é um **Dialog por cima do Sheet** (pedido explícito; precedentes `EditarMixDialog`/`ReplicarCardsDialog`/`OcVinculadaDialog`). Edita um rascunho LOCAL; "Salvar" do dialog aplica no card (funil `onChange` → dirty/touched/colab) e grava de vez no Salvar do plano (texto do mockup). "Voltar" com rascunho sujo pede "Descartar alterações?". | Regra "editar = Sheet / novo = Dialog" tem exceção documentada para diálogo auxiliar (estudo R8). | Nenhum. |
| R19 | **Presença (estilo Google Sheets) no dialog**: o Dialog é portal — o `<ColabPresenceOverlay>` do Plan. Tecido tem `scopeRef` no `<main>` e NÃO alcança o conteúdo do dialog. Por isso o dialog monta o SEU `ColabPresenceOverlay` com `scopeRef` no corpo rolável do dialog. O foco chega ao `campoFocado` do canal `colab:plan:<colecao>` pelo `onFocusCapture` do `<main>` (evento React atravessa portal; `pathDoElemento` devolve o `data-colab-path` explícito sem exigir que o elemento esteja no scope). Paths: `dist:{slot}:prop:{tam}` (proporção), `dist:{slot}:{loja}:{varKey}:base`, `dist:{slot}:{loja}:{varKey}:{tam}`; com o dialog aberto e nenhum campo focado, o `campoFocado` vira `dist:{slot}:aberto` (presença de página: "Fulano está neste produto"). O dialog mostra o `ColabBanner` com quem tem foco `dist:{slot}:…`. | Pedido do coordenador (presença estilo Sheets nas telas novas). | Um overlay a mais montado só com o dialog aberto. |
| R20 | O "atende a" é BOTÃO (e as opções do popover são checkboxes) — hoje `pathDoElemento` só aceita input/textarea/select. Mudança mínima em `src/lib/colab/colab-field-path.ts`: **elemento com `data-colab-path` explícito participa** mesmo que não seja campo de texto (checado ANTES do filtro de campo). Path `pt-atende:{material}:{varKey}` no gatilho e nas opções; o anel dos outros aparece no gatilho (as opções são portal). | Presença no "atende a" (pedido). **Correção (G-plano R5):** há 10 `SelectTrigger` com `data-colab-path` em Produto Acabado/Importado (`ProdutoCard.tsx`, `ProdutoImportadoCard.tsx`) — com esta mudança a presença passa a disparar neles também; ACEITO (PR14, roadmap "ring em todas as telas editáveis"), conferido na QA a 2. Dev/Explosão não mudam. | Anel aparece nesses selects (desejável). |
| R21 | **Direcionamento lê o PLANO SALVO** por uma RPC nova `direcionamento_plano_modelo(_modelo_id)` (wrapper DEFINER + `_direcionamento_plano_modelo_core(uuid,uuid)` com EXECUTE revogado dos 3): auth + loja ativa + IDOR do modelo por tenant + módulo `producao`; o plano só com `tenant_module_enabled('distribuicao')`. Acha o slot do plano da **coleção atual** do modelo (preferindo o que tem distribuição), lê o Tecido 1 e traduz `variante_tecido_id → variante_numero` pelo Tecido 1 do BOM do modelo (`modelo_tecido_variantes.ordem`, o mesmo join de `_grade_soma_pares`). Também devolve "direcionados" (a conta da RPC antiga, que sai). Sem plano: `modulo_desligado` · `comprado` · `sem_plano_tecido` · `sem_distribuicao`. Cor do plano sem variante no BOM (planejada/removida) vai para `sem_correspondencia`. **Aceito (G-migration A, 25/set):** célula de loja EXCLUÍDA (a chave não é mais loja do tenant) some do plano sem aviso, porque a loja saiu; e chave que não é uuid é ignorada (PR18). | Invariante #10: o servidor do Direcionamento NÃO muda; o plano é referência, nunca gate. | Nenhum (só leitura). |
| R22 | **Semi-preenchimento** (P-12 revista), por variante × tamanho da Grade Real, contando só lojas EDITÁVEIS (ativa, ou inativa com par histórico): Σ plano = real ⇒ cada loja recebe o plano (0 onde o plano não tem); ≠ ⇒ a célula fica vazia ("–", âmbar, "Distribua à mão") em TODAS as lojas. Roda ao abrir SÓ quando não há linha salva em `direcionamento_lojas`, o status não é 'separado' e a tela é editável; **NÃO conta como alteração não salva** (P-32 = B, dono 25/set — o guarda nasce do estado preenchido; as células escritas seguem "minhas" no merge 3-vias). "Preencher com o plano" reaplica a mesma regra (AlertDialog se já há número digitado). Células vindas do plano ficam azul-claro até serem editadas. Nenhuma regra de rateio é inventada. | Leitura literal de P-12 + mockup; P-32 = B. O servidor (estado completo, Σ = real no Confirmar, loja ativa) é intocado. | Nenhum. |
| R23 | Direcionamento: **rótulos de tamanho pelo lado do "Tamanho em"** (`ladoTamanho`) no grid existente, na tabela do plano, no motivo do rodapé e nas notas (as CHAVES seguem as de hoje). Σ Direcionado mostra "faltam N" / "N a mais". "Grade Real" com `InfoHover` ("Grade Real = o que voltou da recepção dos serviços, já sem os defeitos do CQ."). | Mockup (P M G GG, "faltam 23"). Hoje o grid mostra a chave crua ("40\|M"). | Cosmético. |
| R24 | Comprados: fora (P-15 = C) — "sem plano" com o motivo. | Decisão. | Nenhum. |
| R25 | **Replicar card(s)** NÃO copia distribuição nem "atende a" do plano (o `_replicar_cards_plan_tecido_core` é redefinido pela reorganização — esta frente NÃO o toca; o INSERT dele lista colunas, então as novas nascem no default). O casamento do BOM continua sendo copiado (já era). | Paralelismo (arquivo/função da reorg) + outra coleção tende a ter outro plano de lojas (estudo). Ver P-33. | Redistribuir na coleção nova. |
| R26 | `_plan_tecido_snapshot` (blindagem de cada Salvar) passa a guardar `distribuicao` e `atende`. | Distribuição é digitação cara; a blindagem existe para isso. | Nenhum. |
| R27 | **Permissão**: sem seção nova — o dialog e o "atende a" herdam a edição do Plan. Tecido (`useReadOnly` da página + card travado). Ver P-34. | Menor escopo; ninguém tem linha da permissão antiga `distribuicao` (0 na cópia). | Quem edita tecido também distribui. |
| R28 | **Página antiga sai** (rota `distribuicao.index.tsx`, `DistribuicaoTabela`, `ResumoColecao`, `lib/distribuicao.ts` + teste, item de sidebar/`moveTop`, `nav.ts`, `ModuleDef` do `permissions-catalog`, `routeTree.gen.ts` regenerado). O **módulo `distribuicao` fica** (gate): `ModuleKey`/`DEFAULTS=false` no `useTenantModules`, `MODULE_BASE_PATH` → `/criacao/plan-tecido`, toggle à mão em Gerenciar Lojas (`admin/lojas.tsx`, rótulo "Distribuição por produto", descrição nova). Config da Loja (`configuracoes.tsx` — arquivo da reorg) NÃO é tocada (hoje nem lista o módulo). | P-14 + gate confirmado. | Nenhum. |
| R29 | A remoção no banco vai numa **migration SEPARADA** (`20261006110000_distribuicao_antiga_remover.sql`), no MESMO roteiro (`RODAR`), rodada pelo dono **DEPOIS do deploy no ar** e das abas recarregadas, com export CSV + backup antes e frase digitada ("APAGAR A DISTRIBUIÇÃO ANTIGA"). Ordem interna: 4 `DROP FUNCTION` e, por ÚLTIMO, `DROP TABLE public.distribuicao_tabelas`. | P-14 ("não antes: a página atual usa as tabelas") — o front PUBLICADO (e o `:5173` antes do merge) ainda chama `direcionamento_resumo_subcolecao`/a página antiga. O `DROP TABLE` remove os gatilhos de FK em `tenants`/`colecoes` — `tenants` é lida por `get_user_tenant_id()` em TODA policy: a trava tem de durar o mínimo (último comando antes do COMMIT, `lock_timeout 500ms`, nova tentativa do `aplica_v2`) e é MEDIDA na cópia antes (plano, Task 9). | Uma janela a mais no dia (o dono roda 2 passos). |
| R30 | Linhas órfãs da permissão `distribuicao` (`user_permissions`/`papel_permissoes`): nenhuma DML; o pré-voo só INFORMA a contagem. | 0 na cópia; DML em tabela de permissão fora de escopo. | Linha inerte. |
| R31 | Migration aditiva **GERADA do texto vivo** com guarda md5 EXATA das 5 funções redefinidas (`_salvar_plan_tecido_core`, `_plan_tecido_arvore_core`, `_plan_tecido_gravar_bom_core`, `_plan_tecido_snapshot`, `tenant_module_enabled`) + as 2 novas (ausentes ou já no texto novo). `_plan_tecido_arvore_core` é `LANGUAGE sql` (o PG valida as colunas no CREATE) ⇒ é criada DEPOIS do `ALTER TABLE plan_tecido_variantes`, que fica no fim (trava de ms). Travas `lock_timeout 500ms`/`transaction_timeout 3s` logo depois do `BEGIN;`. Nenhuma DDL de policy. Nenhuma DML/COMMENT em `tenant_config`. | Molde Nota/SKU/Sheet; incidentes 15/set, 23/set, 24/set. | Nenhum. |
| R32 | Botão Imprimir **só no desktop** (P-36 = B, dono 25/set): `max-sm:hidden` no botão do cabeçalho; a `PrintArea` fica igual. | Decisão do dono (regra antiga do sistema vence o ícone do mockup mobile). | Nenhum. |
| R33 | O texto de ajuda do dialog fica SEM o "Exemplo — E-commerce · Preto, Base 6…" dinâmico do mockup (ilustração); o resto do texto é o do mockup. | O exemplo depende de dados; o mockup o usa para explicar. | Cosmético. |
| R34 | Tabela do plano no Direcionamento: colunas = tamanhos da Grade Real ∪ tamanhos com plano > 0 (na ordem da grade da loja); linhas = loja (subtotal) → cores (`"N - Cor - Apelido"` do rótulo da tela); loja sem aquela cor no plano = "—"; rodapé "Total do plano". Mobile: rolagem horizontal só na tabela, 1ª coluna fixa. | Mockup + não esconder número do plano. | Nenhum. |
| R35 | QA com gravação SÓ na cópia (`:5188`, Loja Teste, card combinado com o dono); no `:5173` (PRODUÇÃO) a QA é só leitura (abre o dialog sem salvar, mede o mobile, abre o Direcionamento sem salvar). | O Salvar do Plan. Tecido grava a árvore da coleção inteira e auto-aplica em `modelo_grades` de produção. | Um passo manual do dono na cópia. |
| R36 | Ordem de produção: (1) reorganização `20261005100000` + a referência dela; (2) esta ADITIVA + referência nova da volta da F1; (3) merge + ida na cópia no mesmo comando; (4) QA; (5) deploy pelo portão; (6) REMOÇÃO (dono) + referência nova da volta da F1; (7) remoção na cópia. | Colunas antes do front (o `:5173` lê produção); remoção depois do front sem a página. | — |
| R37 | Voltas em **LIFO**: a volta da remoção vem ANTES da volta aditiva (o inverso aditivo EXIGE a tabela antiga de volta — o front revertido a usa); esta frente volta ANTES da reorganização. | Ordem das dependências. | Trocar a ordem quebraria o front revertido. |
| R38 | "4 modelos direcionados" (P-16 = C) vem da RPC nova (`direcionados`), a mesma conta da RPC antiga (modelos da mesma coleção+subcoleção de texto com `cad.direcionamento_status='separado'`), mostrado só quando o modelo tem subcoleção, com ou sem o módulo. **Aceito (G-migration A, 25/set):** sem subcoleção a RPC nova devolve `direcionados = 0` (a antiga contava); a tela não mostra o card nesse caso, então nada muda para o usuário. | A RPC antiga sai (P-14). | Nenhum. |
| R39 | `CLAUDE.md` é atualizado e commitado NA PRINCIPAL pelo CONTROLADOR depois do merge (fora da worktree e da lista permitida). | Molde (R35 da reorg). | Nenhum. |

## 4. Estado atual do código (fatos levantados em 25/set, worktree `13ec1dae` + cópia local SÓ LEITURA)

**Plan. Tecido**
- Tipos: `src/lib/plan-tecido/types.ts` — `PtVariante {variante_tecido_id|null, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total, …}`, `PtMaterial {tipo 'tecido'|'forro', numero, consumo, variantes}`, `PtSlot {proporcoes, materiais, thumb_path, …}`.
- pç: `MaterialBlock.tsx:366` (`NumberInput` com `data-colab-path=pt-grade:{material}:{varKey}`); `setGrade` (`:111-112`) muda só `grade_total`. Ações "adicionar cor"/"remover divergentes" só com `!readOnly` (`:405-414`). Linha de variante tem altura `h-[var(--h-var,auto)]` (alinhamento do Modo Plano).
- Card: `ModelCard.tsx` (badge "peças" = Σ pç do T1 `:227-228`; `GradeSection` "Proporção por tamanho" `:452-458`; blocos `MaterialBlock` `:571-584`; `travado` = enviado à Explosão).
- `PlanTecidoSheet.tsx`: query dos modelos reais `:446-465` (BOM com `modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, variante:variante_tecido_id(…cor:cor_id(nome)…))` — SEM `cor_id` e SEM `complementa_variante_ids`); `modelosReais` `:581-672`; `computeFreshArvore` `:87-90` (pipeline único do carregamento e dos merges colab); `patch` `:1031-1043` (funil único de escrita local; marca `touched` por diff JSON); auto-aplicar `autoAplicarDirty` `:887-930` (usa `buildMateriaisAplicar(slot)`); presença `useColabRegistro({canal: colab:plan:<colecao>, tabela: colecoes})` `:810-821`; `<main ref={colabScopeRef} onFocusCapture=… >` + `<ColabPresenceOverlay presentes scopeRef={colabScopeRef}>` `:1926-1935`; tamanhos `["plan-tecido-tamanhos"]` `:467-476`.
- Engine: `slotDeModeloReal` (`engine.ts:61-141`) agrupa por (tipo, numero), só o T1 puxa `modelo_grades`; `mergeArvore` (`:381-471`) com `comConsumoDoPlano → comVariantesDoPlano → comGradeDoPlano` ("Dev vence só se preenchido").
- `buildMateriaisAplicar` (`calc.ts:298-313`) monta o payload de `plan_tecido_aplicar_ao_modelo`/`plan_tecido_criar_card`.
- Banco (cópia = produção, conferido contra o retrato `fidelidade_prod_pos_sem_trava_detalhe.txt` de 25/set 13:08): `_salvar_plan_tecido_core` (DELETE + reinserção; DEDUP por variante; md5 `ddadff5e…`), `_plan_tecido_arvore_core` (`LANGUAGE sql`; md5 `d8685568…`), `_plan_tecido_gravar_bom_core` (apaga e reinsere `modelo_tecido_variantes` de tecido/forro SEM `complementa_variante_ids`; grava `modelo_grades` só do T1; md5 `3cc5d45c…`), `_plan_tecido_snapshot` (md5 `c9492de3…`), `tenant_module_enabled` (default-OFF só `otb`, `produto_acabado`, `produto_importado`; md5 `0b87d95b…`; EXECUTE para todos — é chamada pelas policies). `plan_tecido_variantes`: 590 linhas na cópia; gatilho `set_tenant_id_trg`; 4 policies.
- "Casar variantes": `modelo_tecido_variantes.complementa_variante_ids uuid[]` (e `cad_tecido_variantes`), gravado por `_salvar_modelo_bom_core` (BOM do Sheet/Dev), copiado por `_enviar_modelo_para_cad_core` e `_replicar_cards_plan_tecido_core`; reserva em `_estoque_tecido_core` via `_grade_soma_pares(modelo, ids)` (complementar casado reserva pela Σ das grades do T1 pareado). UI no BOM do Sheet: `planejamento-detail/ficha/TecidosBomSecao.tsx:322-347` (arquivo da reorg — NÃO muda; só passa a mostrar o que o plano gravar).

**Direcionamento** — `src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx` (892 linhas): tira "resumo da subcoleção" `:103-123` + `:654-715` (RPC `direcionamento_resumo_subcolecao`, `OrcamentoTag`); `tamanhos` = presentes na Grade Real `:236-245`; hidratação `:299-326`; merge 3-vias `:332-361`; `setQtd` marca `touched` (`pathDirCel`) `:363-372`; payload estado completo `buildRows` `:398-414`; inputs com `data-colab-path=dir:{variante}:{loja}:{tam}` desktop `:767` e mobile `:830`; presença `useColabRegistro(colab:dir:<cad>)` + `ColabPresenceOverlay` `:289-301`, `:600-609`; cabeçalho de tamanho = chave crua `{t}`.

**Distribuição antiga** — rota `distribuicao.index.tsx`; `components/distribuicao/{DistribuicaoTabela,ResumoColecao}.tsx`; `lib/distribuicao.ts` + `tests/unit/distribuicao.test.ts`; `nav.ts:17`; `permissions-catalog.ts:80-89` (ModuleDef próprio); `app-sidebar.tsx:143-145` (`moveTop`); `useTenantModules.ts:18,31,49`; `admin/lojas.tsx:72,84` (toggle derivado do catálogo); `routeTree.gen.ts` (versionado). Banco: `distribuicao_tabelas` (12 colunas, FKs para `tenants` e `colecoes`, gatilho `set_tenant_id_distribuicao`, policy `distribuicao_tabelas_tenant`, 2 índices; 4 linhas na cópia, 1 com números) + `distribuicao_resumo(uuid,text)`, `salvar_distribuicao_tabela(jsonb)`, `excluir_distribuicao_tabela(uuid)`, `direcionamento_resumo_subcolecao(uuid)` (md5 `dc8b90c4…`, `0227b0fa…`, `ee38685a…`, `d431e4ed…`; EXECUTE só `authenticated`/`service_role`). No retrato de fidelidade: 21 linhas (12 `colunas:`, 1 `gatilhos:`, 2 `policies:`, 2 `indices:`, 4 `funcoes:`) — NÃO existe categoria "tabelas".

**Outros** — `tenant_config.tamanhos_grade` formato `"34|PPP"` (Ark Store usa itens soltos); `modelos.tamanho_tipo` NULL em todas as 272 linhas da cópia (a reorg põe `DEFAULT 'letra'` + backfill); `lojas_direcionamento(id, nome, ativo, is_default, ordem)`; módulo `distribuicao` ligado em Ave Rara e Loja Teste (cópia); 0 linhas de permissão `distribuicao`. Contagem funções|gatilhos da cópia hoje: `483|277` (a reorg leva a `484|277`).

## 5. Desenho

### 5.1 Dados

**Colunas novas** (`plan_tecido_variantes`, no FIM da migration aditiva):
```sql
ALTER TABLE public.plan_tecido_variantes
  ADD COLUMN IF NOT EXISTS distribuicao jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS atende jsonb;
-- CHECKs nomeados (idempotentes via DO): plan_tecido_variantes_distribuicao_objeto (jsonb_typeof = 'object')
--                                         plan_tecido_variantes_atende_array (NULL ou 'array')
```

**Formato** — ver R1/R2. Exemplo (Marrom · Canela do mockup):
```json
{"<id E-commerce>": {"base": 5, "grades": {"38|P": 4, "40|M": 10, "42|G": 10, "44|GG": 5}, "manuais": ["38|P"]},
 "<id Loja Física>": {"base": 3, "grades": {"38|P": 3, "40|M": 6, "42|G": 6, "44|GG": 3}, "manuais": []},
 "<id Atacado>": {"base": 4, "grades": {"38|P": 4, "40|M": 8, "42|G": 8, "44|GG": 4}, "manuais": []}}
```
→ pç = 71; `grades` do T1 = `{"38|P": 11, "40|M": 24, "42|G": 24, "44|GG": 12}`.

**Funções redefinidas** (por âncoras exatas sobre o texto vivo; cada âncora 1×):
1. `_salvar_plan_tecido_core(uuid,jsonb,integer)` — o INSERT de `plan_tecido_variantes` ganha `distribuicao, atende`; o DEDUP leva as da linha vencedora; `distribuicao` só no T1 e só se for objeto (senão `'{}'`); `atende` só fora do T1 e só se for array (senão NULL).
2. `_plan_tecido_arvore_core(uuid)` — cada variante devolve `'distribuicao'` e `'atende'`.
3. `_plan_tecido_gravar_bom_core(uuid,jsonb)` — R3 (casamento do payload, filtrado às ids reais do T1 do payload; chave ausente preserva; T1 NULL).
4. `_plan_tecido_snapshot(uuid)` — R26.
5. `tenant_module_enabled(text)` — R5.

**Funções novas**: `direcionamento_plano_modelo(uuid) RETURNS jsonb` (wrapper, `STABLE SECURITY DEFINER`, EXECUTE só `authenticated`) e `_direcionamento_plano_modelo_core(uuid, uuid) RETURNS jsonb` (EXECUTE revogado de PUBLIC/anon/authenticated). Contrato:
```json
{"subcolecao": "Drop 1" | null, "direcionados": 4,
 "plano": null | {
   "tamanho_tipo": "letra" | "numero", "tamanhos": ["34|PPP", …],
   "lojas": [{"loja_id", "nome", "ativo", "is_default", "ordem"}],
   "variantes": [{"variante_numero": 1 | null, "variante_tecido_id", "cor_nome", "apelido_nome"}],
   "celulas": [{"loja_id", "variante_numero", "grades": {"38|P": 4, …}}],
   "sem_correspondencia": [{"cor_nome", "apelido_nome", "total"}]},
 "motivo_sem_plano": null | "modulo_desligado" | "comprado" | "sem_plano_tecido" | "sem_distribuicao"}
```

**Contagem**: aditiva **+2 funções, +0 gatilhos**; remoção **−4 funções, −1 gatilho** (`set_tenant_id_distribuicao`). Ninguém crava número absoluto: os scripts medem antes/depois (a reorg muda a base para 484).

**Nos 4 arquivos (PR10):** `SET client_encoding = 'UTF8';` antes do `BEGIN;`; `DO $pos$` (pós-condição dentro da txn — md5 "depois"/"antes" e objetos; RAISE desfaz tudo) e `NOTIFY pgrst, 'reload schema';` antes do `COMMIT`; cabeçalho "Aplicar SÓ via <script>"; trava explícita antes da guarda nos que apagam dado (inverso da aditiva; remoção). A RPC nova também resolve `colecao_id` pela coleção-texto quando falta e ignora chave de loja que não é uuid (PR18).

**Remoção** (`20261006110000`): trava explícita na tabela → guarda (confirmação `app.confirmo_apagar_distribuicao_antiga='sim'`; a aditiva aplicada; md5 das 4 funções = as vivas lidas na cópia) → `DROP FUNCTION` ×4 → `DROP TABLE public.distribuicao_tabelas` (por último) → `$pos$` → NOTIFY. Inverso recria a tabela (DDL de `20260922120000`), as 4 funções (texto vivo), ACL e, POR ÚLTIMO, a policy; os DADOS voltam do CSV exportado antes pelo script.

### 5.2 Regras puras (TS; fonte única)

- `src/lib/distribuicao-produto.ts`: `proporcaoDoTamanho`, `celulaCalculada = round(prop × base)`, `tamanhosDoTipo`, `rotuloTamanho`, `normalizarDistribuicao` (recalcula não-manuais, tira linha vazia, tira tamanho fora da grade), `definirBase`, `definirCelula`, `voltarAoCalculado`, `definirProporcao`, `totaisDaDistribuicao` (Σ lojas por tamanho + total = pç), `linhaResolvida`, `subtotalLoja`, `temDistribuicao`, `abreviarNome` (até antes da 2ª vogal: "Marrom"→"Marr.", "Canela"→"Can."), paths de presença (`pathDistProp/Base/Cel/Aberto`, `pathEhDoProduto`).
- `src/lib/plan-tecido/atendimento.ts`: `atendimentoDoBloco` (R14/R16), `pcAtendido`, `normalizarSlotDistribuicao` (R6: T1 primeiro, depois cada bloco), `complementaDoBloco` (ids reais p/ o payload), `alternarAtende`, `atendePadrao`.
- `src/lib/direcionamento-plano.ts`: `planoPorVariante`, `totalPlanoVariante`, `tamanhosDoPlano` (R34), `preencherComPlano` (R22), `textoPendencia`, `motivoSemPlanoTexto`.

Números do mockup que viram testes: Letra — Marrom 71 (E-com P à mão 4, calculado 5), Preto 90, Vinho 30, total 191; E-com 83, Loja Física 54, Atacado 54 (Atacado sem Vinho). Número — Bege 119 (36 à mão 13, calculado 14), Preto 92, total 211; E-com 95. Direcionamento — Marrom M pendente (real 23 × plano 24), Preto G pendente (28 × 30), Vinho inteiro; Atacado · Vinho = 0; Σ Marrom 47/70, Preto 60/88.

### 5.3 Telas

**Card do Plan. Tecido** (só com o módulo `distribuicao`; no topo do Sheet, quando a carga recalculou forro/T2: "N cor(es) de forro/Tecido 2 recalculada(s) pela amarração — salve para gravar" + selo "não salvo" — PR12):
- Tecido 1: botão **"Distribuir por loja"** (ícone + texto, `size="sm"`) na linha de ações, AO LADO de "adicionar cor" — aparece também com o card travado (abre só leitura, P-22). Não muda a altura das linhas de variante (Modo Plano).
- Cor do T1 distribuída: selo **"distribuído"** (StatusBadge `info`) + pç SÓ LEITURA (cadeado + número, `title="Só leitura — muda pelo Distribuir por loja"`); metragem segue ao lado. Cor sem distribuição: `NumberInput` como hoje.
- Forro/T2: por cor, gatilho **"atende a"** (swatches das cores atendidas + chevron; `data-colab-path=pt-atende:…`) abre o popover **"Atende a · cores do Tecido 1"**: cada cor do T1 com checkbox, swatch, nome ("Marrom · Canela"), sub-texto ("já atendida por: Marrom" desabilitada · "padrão — mesma cor base (automático)" · "escolhida à mão") e "N pç"; linha "pç deste forro — 90 + 30 = 120"; texto "Padrão: a mesma cor base. Mudar aqui só troca a amarração — a metragem segue o consumo do forro (1,2 m/pç)."; "↺ padrão (mesma cor base)" quando à mão. Cor amarrada: pç só leitura (cadeado, `title="Soma das cores do Tecido 1 que ele atende"`). Cor sem amarração: pç digitável + ícone âmbar. Cor do T1 sem cor do bloco: linha âmbar "Sem cor deste forro: …".

**Dialog "Distribuir por loja"** (`DialogContent fixedFooter mobileFull`, largo `max-w-5xl`):
- Cabeçalho: título "Distribuir por loja" · botão "Imprimir" (só desktop — P-36 = B) · foto (ModeloThumb, zoom) · "NOME · REF" · "Tecido 1: {artigo} · {N} cores · tamanhos em {Letra|Número}" + `InfoHover` ("O 'Tamanho em' vem do Planejamento de Produto (seção Códigos). Lojas ativas de Cadastro › Lojas; todos os tamanhos da grade da loja.") · `ColabBanner` de quem está neste produto.
- Ajuda (R33): "Digite a Base de cada loja × cor: os tamanhos saem sozinhos, proporção × Base. Qualquer quadradinho pode ser corrigido à mão: ele ganha um ponto, e o ↺ volta ao calculado. Mudar a Base não mexe no que foi corrigido à mão. Tamanho com proporção 0 fica esmaecido, mas dá para digitar."
- Tabela 1: cabeçalho "Loja / Cor" · "Base" (sub "você digita") · grupo "Tamanhos: proporção × Base · dá para corrigir à mão" · "Total" (sub "da cor na loja"); linha "Proporção por tamanho" (sub "do card") com inputs + Σ; por loja: faixa com o nome; por cor: swatch + cor/apelido · Base · células (calculada / à mão com ponto — o ponto abre um balão "Editado à mão · calculado seria N" com um botão ↺ "Voltar ao calculado" SEPARADO; tocar no ponto nunca volta sozinho — PR16) · total; subtotal "Total {loja}" (Σ base · Σ por tamanho · total). Legenda: "● editado à mão — passe o mouse ou toque no ponto para ver o calculado; o ↺ volta a ele. Os totais já contam o valor editado." (PR16)
- Tabela 2 "Total por cor × tamanho" + "Soma das lojas. É o que preenche o pç de cada cor do Tecido 1 no card.": "Cor" · "Base" (sub "soma das lojas") · tamanhos · "Total" (sub "= pç no card"); cor sem distribuição "sem distribuição · pç do card N"; rodapé "Total".
- Rodapé: "Voltar" · texto "Salvar preenche o pç das {N} cores no card. Grava de vez no Salvar do plano." · "Salvar". Só leitura (travado ou sem permissão): "Enviado à Explosão — só leitura (ver e imprimir)." e só "Voltar".
- Mobile (390): mesmo conteúdo, sem o Imprimir (P-36 = B); "Por loja · deslize para o lado"; tabela com rolagem horizontal própria; 1ª coluna `sticky` com nome ABREVIADO (toque abre o nome completo — Popover); ponto da célula à mão abre o balão com o calculado e o ↺ (PR16); rodapé fixo com Voltar/Salvar só-ícone.
- Impressão: `PrintArea` com cabeçalho (foto + nome/REF + tecido/tamanho) e as duas tabelas em texto, sem botões.

**Direcionamento** (`expedicao.direcionamento.$modeloId.tsx`):
- Sai a tira da subcoleção. Entra o card "Subcoleção {X} · **N modelos direcionados**" (só com subcoleção).
- Card **"Plano de distribuição do modelo"** + selo "só leitura" + "do Plan. Tecido › Distribuir por loja" + botão **"Preencher com o plano"** (`title="Reaplica a regra: preenche onde bate com a Grade Real"`); tabela (R34) + ajuda: "O plano é o que foi distribuído no Plan. Tecido (com as correções feitas à mão). “Preencher com o plano” reaplica a regra abaixo, para recomeçar." Sem plano: "Sem plano — {motivo}" (motivos: "o módulo Distribuição está desligado" · "produto comprado (revenda/importado) fica fora desta entrega" · "o modelo não está no Plan. Tecido desta coleção" · "o modelo não foi distribuído no Plan. Tecido").
- Callout âmbar depois do preenchimento (texto do mockup com os números do modelo).
- Por variante: "Grade Real Total: {70} · plano {71}"; "Grade Real" com `InfoHover`; célula da Grade Real com "plano N" pequeno onde difere; célula pendente "–" âmbar `title="Distribua à mão"`; células do plano azul-claro até editar; Σ Direcionado "0 faltam 23"; nota "M: plano 24 · real 23 → distribua à mão as 23 peças entre as lojas. Nenhuma loja veio preenchida porque não dá para saber de qual tirar."

### 5.4 Colaboração e presença

- Sem mecanismo novo: `salvar_plan_tecido(_rev_base = plan_rev)` → P0409 → `mergeArvorePorSlot` (a unidade de conflito é o slot; distribuir produtos diferentes da mesma coleção faz merge limpo).
- `data-colab-path` NOVOS: `dist:{slot}:prop:{tam}`, `dist:{slot}:{loja}:{varKey}:base`, `dist:{slot}:{loja}:{varKey}:{tam}` (dialog); `pt-atende:{material}:{varKey}` (gatilho e opções do "atende a"); `dist:{slot}:aberto` (marcador de presença de página, sem elemento). `{slot}` = `slot.id ?? slot.modelo_id ?? "x"` (mesma regra do `pt-prop` do `GradeSection`).
- R19 (overlay próprio no dialog) + R20 (`pathDoElemento` aceita `data-colab-path` explícito em qualquer elemento — liga também os 10 `SelectTrigger` de Produto Acabado/Importado, PR14).
- Direcionamento: as células pré-preenchidas E as vazias ("–") são os MESMOS `NumberInput` com `data-colab-path=dir:{variante}:{loja}:{tam}` (desktop e mobile); o preenchimento marca as células escritas como `touched` (são rascunho meu — o merge 3-vias as trata como minhas).

### 5.5 Produção (resumo — detalhe no plano, Tasks 10–11)

- Scripts no molde Nota/SKU/Sheet em `.superpowers/distribuicao/mig/` (bloco literal da F1 hash `c045cc571caf5d95`): guarda de URL ancorada; `umask 077`; `unset EXTRA_SQL`; backup `public`+`auth` com o `pg_dump` 17.6 do container da cópia (TABLE DATA > 0 e `pg_restore -l`); md5 dos SQL = os ensaiados; pré-voo SÓ LEITURA; `aplica_v2`; pós-condições; `NOTIFY pgrst`; volta por diferença.
- **Referência da volta de emergência da F1**: o script descobre a MAIS NOVA por mtime em `savepoints/pre-apply-f1-kanban-auto/` (nunca crava nome; esperada: a `…_pos_sheet_…` da reorg), prova que ela bate com a produção FORA das chaves da F1 e desta frente, e grava `fidelidade_ref_volta_f1_pos_distribuicao_detalhe.txt` (aditiva: base − 5 linhas de função redefinida + as 9 atuais = base + 4) e, depois da remoção, `…_pos_distribuicao_remocao_detalhe.txt` (base − 21). Chaves por categoria REAL do retrato (`colunas:`, `funcoes:`, `gatilhos:`, `indices:`, `policies:`) — não existe "tabelas".
- Pré-voo da aditiva exige a reorganização aplicada (`_titulo_pagina_calculado(text,text)` + `tenant_config.keywords`) e a F1.

## 6. Riscos

| Risco | Onde trata |
|---|---|
| Forro das lojas com o módulo ligado muda de pç digitado para soma ao abrir (a comprar do forro muda) | R14 (sem amarração ⇒ digitado), P-31, QA na cópia, INFO no pré-voo |
| Reserva do forro (#4) passa a usar a Σ do T1 pareado quando o aplicar grava o casamento | É a regra do "casar variantes" que já existe (`_grade_soma_pares`); só muda quem preenche. P-31 |
| Perda silenciosa do casamento do BOM a cada aplicar (bug HOJE) | R3 (chave ausente preserva) |
| Perda da distribuição no merge "Dev vence" | R7 + testes de engine |
| Payload maior (Ave Rara: ~406 variantes T1 × 6 lojas × 6 tamanhos) | Aceito (estudo R10); medido na QA |
| Kanban automático move card sozinho quando a grade muda (condições de grade) | Comportamento de hoje com o pç digitado; citado ao dono no OK final |
| Trava em `tenants`/`colecoes` no `DROP TABLE` | R29 (último comando, 500 ms, medido na cópia, horário calmo) |
| Trava em `plan_tecido_variantes` no `ALTER` | R31 (penúltimo bloco, ms) |
| Janela entre a aditiva e o deploy: front antigo salva a árvore sem as chaves novas | O front antigo passa adiante as chaves que a árvore devolve (spread); o risco é só "manter meu" num conflito de slot — regra: não distribuir em produção antes do deploy (R35) |
| Presença não alcança o dialog (portal) | R19 |
| Direcionamento: prefill perguntaria "Descartar alterações?" a quem só olha | P-32 = B (não conta) |
| Card mostra a soma e o Resumo/Pedido o valor salvo até alguém salvar (P-31 = A) | PR12 ("não salvo" + aviso na carga) + QA card = Resumo |
| "Atende a" automático vira "à mão" depois do 1º aplicar | PR11 |
| Texto corrompido por encoding descoberto só depois do COMMIT | PR10 |
| Conflito com a reorganização | Arquivos proibidos + sobreposição (Task 0/11) + ordem de produção R36 |

## 7. Testes

- Unit: `distribuicao-produto.test.ts` (números do mockup Letra e Número, manual × Base, ↺, normalização, tamanhos por tipo incl. Ark Store, abreviação, paths); `plan-tecido-atendimento.test.ts` (automático, manual vence, 1 por cor do T1, já atendida, pç soma, sem amarração ⇒ digitado, re-casamento planejada→real, T2, normalização idempotente); `plan-tecido-engine.test.ts` (+ `slotDeModeloReal` com casamento/cor, `comDistribuicaoDoPlano`, `comAtendeDoPlano`); `plan-tecido-calc.test.ts` (+ casamento no payload só com o módulo); `direcionamento-plano.test.ts` (regra do preenchimento com os números do mockup, loja inativa, pendências); `colab-field-path-explicito.test.ts`; testes de FONTE (paths no dialog/card/Direcionamento; remoção da página).
- Integração (SÓ cópia, `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres`, caminhos literais, `DIST_MIG_TXN=1` = migration dentro da txn revertida): estático dos 2 SQL (+ inversos) e banco (round-trip da árvore, gates T1/fora do T1, DEDUP, snapshot, casamento no BOM + preservação + filtro, `tenant_module_enabled`, RPC nova com IDOR/ACL/motivos/tradução/direcionados, guarda md5 "outra frente", idempotência, inversos; remoção com confirmação e inverso fiel).
- Scripts: provas com `psql`/`docker` FALSOS (URL sintética), nunca banco real; a prova confere `PGCLIENTENCODING=UTF8` em cada apply (PR10).
- QA: `:5188` (cópia) com gravação; `:5173` só leitura; mobile 360/390 sem estouro.

## 8. Fora de escopo

- Comprados (revenda/importado) no dialog (P-15 = C — fase seguinte; a variante seria a `ordem` do produto).
- `etapas_pl` default ON no servidor × OFF no front (mesma classe do R5 — frente própria).
- "Tamanho em" nos cards do Plan. Tecido/Produto Acabado/Importado (D2 da reorg — frente separada).
- Travar no servidor o pç distribuído contra edição por outra tela (Dev intocado até a F5; P-10 revista dispensa aviso).
- Resumo automático da coleção da página antiga (P-16 = C — sai junto).
- DML nas linhas órfãs de permissão `distribuicao` (R30).

## 9. Ordem de entrega

Tasks 0 (pré-voo) → 1–3 (regras puras) → 4 (banco aditivo, G-migration) → 5–6 (card + dialog) → 7 (Direcionamento) →
8 (remoção da página) → 9 (banco da remoção, G-migration) → 10 (ensaio + scripts + provas, G-scripts) → 11 (produção
aditiva → merge + cópia → QA → deploy → remoção → docs). Ver o plano.

## 10. Dúvidas que só o dono responde (numeradas a partir de P-31)

> **Respondidas pelo dono em 25/set:** P-31 = A · **P-32 = B** · P-33 = A · P-34 = A · **P-35 = A** · **P-36 = B** (ver §2). A tabela abaixo fica como
> registro do que foi perguntado. **Aberta:** P-37 (do controlador) — a autorização P-30 B (N3 na cópia só com AVISO no painel) vale para esta
> frente? Se não, cada rodada N3 passa a exigir o OK do dono (o `n3.sh` é o mesmo — PR17).

| # | Título | Contexto | Opções | Recomendação (implementada) |
|---|---|---|---|---|
| P-31 | Forro/Tecido 2 dos cards que JÁ existem | Com o módulo ligado (hoje Ave Rara e Loja Teste na cópia), ao abrir o Plan. Tecido cada cor de forro/T2 passa a atender automaticamente as cores do Tecido 1 de mesma cor base, e o pç dela vira a SOMA (só leitura) — o "a comprar" do forro muda para esses cards, e o aplicar grava o casamento no BOM (a reserva do forro passa a ser pela soma do par). Cor de forro que não casa com nenhuma cor do T1 ficaria com 0 pela regra pura. | A) aplica já em todos os cards, mas cor SEM amarração mantém o pç digitado (+ aviso âmbar) · B) só nos cards cujo Tecido 1 foi distribuído · C) regra pura: sem amarração = 0 pç | **A** — segue a decisão (P-17/18/20) sem derrubar em silêncio o forro legado que não casa. |
| P-32 | Direcionamento pré-preenchido conta como "alteração não salva"? | O mockup mostra o selo "alterações não salvas" com o rascunho do plano. Efeito: quem só abre para olhar e sai recebe "Descartar alterações?". | A) como o mockup (conta) · B) não conta: o rascunho é refeito a cada abertura enquanto nada for salvo | **A** implementado (fiel ao mockup); B é trocar 1 linha (`resetBaseline(obj preenchido)`). |
| P-33 | "Replicar card(s)" leva a distribuição e o "atende a"? | Hoje a réplica leva o BOM (com o casamento), não a distribuição. A função é redefinida pela reorganização (paralela). | A) não leva (redistribui na coleção nova) · B) leva, numa frente seguinte, depois da reorg em produção | **A** (R25). |
| P-34 | Permissão própria para distribuir? | O dialog herda a edição do Plan. Tecido; a permissão da página antiga (`distribuicao`) some (0 linhas). | A) herda o Plan. Tecido · B) seção nova `criacao_plan_tecido:distribuicao` (quem planeja tecido pode não distribuir) | **A** (R27). |
| P-35 | Card e modelo da QA | A QA com gravação roda na CÓPIA (`:5188`); precisa de um card da Loja Teste com Tecido 1 de 2+ cores e forro, e de um modelo com Grade Real (CQ liberado) SEM direcionamento salvo. Resíduo fica na cópia. | Dono indica os ids · controlador escolhe e avisa | Dono indica. |
| P-36 | Imprimir no celular | O mockup mobile tem o ícone de imprimir; a regra antiga do sistema é "Imprimir só no desktop". | A) mostrar no celular (mockup) · B) só desktop (regra antiga) | **A** (R32). |
