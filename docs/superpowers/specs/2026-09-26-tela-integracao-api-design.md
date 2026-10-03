# Tela de Integração + API por loja — desenho (spec) · v4.4

**Data:** 26/set/2026 · **Branch:** `integracao/desenho` (a partir da linha principal `e6bdfdde`) até a v4.3; desde a T0 (27/set) o
spec e o plano vivem na worktree `integracao-impl` (branch `integracao/impl`, a partir de `338d5433`) — a `integracao/desenho` fica congelada
**Pedido verbatim:** `.superpowers/estudos/2026-09-25-tela-integracao-pedido.md` (item 7 + 3 complementos).
**Decisões do dono (painel):** P-60 B · P-61 A · P-62 A · P-63 A · P-64 A · P-65 A · P-66 A · P-67 A · P-68 B · P-69 A ·
desenho aprovado por partes: P-70 A (dados/estados) · P-71 A (tela + mockup antes do código) · P-72 A (API) · P-73 A (trava).
**v2:** incorpora o G-plano do guardião (`.superpowers/g-plano-integracao-guardiao.md`: B1, B2, R3–R11, N12–N20).
**v3:** incorpora o delta v2 do guardião (itens 1–4 e notas 6–12; o item 5 — coluna "Cor apelido" — foi ao dono na P-74).
**P-74 A** (dono 26/set 16:33): reprovado depois de integrado segue visível como integrado; item próprio "Integração" no
menu da loja + Admin Mestre p/ super admin; guia do dev na aba Chaves e acessos; cor sem apelido = VAZIO e não bloqueia.
**P-75 A** (16:33): com "Preço de custo" marcado, só integra quem também pode VER custos (`_pode_ver_custos()`); para os
outros o integrar fica travado com o motivo. Sem pendências do dono no desenho.
**v4.1 (G-plano delta v4 do guardião, `.superpowers/g-plano-integracao-guardiao-v4.md`):** B1 (mão dupla por origem:
nome espelho, preço fixo do importado nos 3 lugares, fotos = `fotos_modelo`), R2 (gates do card campo a campo), R3 (modo
teste → P-82), R4 (orquestração do Salvar), R5 (Keywords só a coluna c/ conferência), R6 (contradições), R7 (limites:
lock/índices/retenção/teto), N8 (Foto padrão → **P-83 A: desmarcada, opcional**), N9–N12. **P-82 A:** modo teste = dados de
EXEMPLO fictícios no formato real.
**v4.3 (27/set, G-plano do PLANO + dono):** P-87 — celular NÃO tem a tela; P-88 A — nome/REF de revenda/importado nos
dois sentidos valem já a partir do passo no banco (a REF só acompanha enquanto o card deixa mudar a REF — antes da
Explosão); preço do Importado grava no SALVAR da tela (não no blur — `_salvar_produto_importado_core` aceita o preço fixo
no `_dados`); "atacado" não trava (só campos marcados); o diálogo do Reset avisa que apaga a integração da loja.
**v4.4 (27/set, P-89 A do dono — plano gratuito do Cloudflare):** página da API com **padrão/recomendado 50** produtos (a
faixa do banco continua 1–500); acima de 100 a tela avisa que pode passar do limite de processamento do plano gratuito
(10 ms por consulta — só com Workers Paid). Aumentar depois = mudar a configuração da loja na aba API, sem migration nem
deploy. A resposta passa a dizer o tamanho usado e o máximo atual (`pagina: {limite, maximo}`) e o Manual ensina o programa
do dev a nunca contar com um tamanho fixo de página. Pedido do dono (verbatim): "isso pode mudar depois, pode ser que eu
tenha que aumentar, tem como já preparar isso? e como fazer no manual/guia?".
**v4.2 (re-conferência v4.1 do guardião, APROVA COM RESSALVAS):** V1–V5 e n1–n6 incorporados (gravador da revenda não
muda — checagem só na `integracao_salvar`; gatilho de foto com WHEN; importado grava `modelos.nome`; reserva de acesso;
4º editor do preço do importado; links de exemplo públicos; escopo da limpeza; módulo reconferido).
**v4 — ajustes do dono no mockup (P-79, chat 26/set 20h40, verbatim):** "os campos são todos editáveis desde que o toggle
esteja não integrado. nessa mesma aba, tem que ter um filtro de integrados, não integrados, com o não integrados ativo por
default. nos campos API, tem os itens que eu falei que são obrigatórios, estes por default já vem flagados inicialmente, e
se alguém desativar sem querer, solta um alerta. não está entendível como se usa a API, quais os comandos, quais as
possibilidades, como utilizar, etc. o guia da API deixe mais fácil de entender, com tudo que precisa, até um manual de como
integrar, se possível ter edições pela mesma tela para facilitar o manejamento por exemplo "número limite de requisições"
o super admin pode modificar, porém, com alerta de recomendado." (o pedido original já dizia "na tela vista, todos os
campos seriam editáveis"). **P-80 A** (dono 26/set 20h4x): custo, cor base, cor apelido e tamanho ficam SÓ LEITURA com "i"
(de onde vem) + "abrir card". **Esclarecimento do dono (mesma hora, verbatim):** "editar aqui, edita nos campos que
pertencem ou só editam na tela do API? o certo é se editar no API, edita nos campos anteriores também, vice-versa (desde
que não esteja integrado ainda)" ⇒ a tela de Integração NÃO tem cópia própria dos dados: edita os MESMOS campos do produto
(`modelos`/espelhos/`modelo_skus`/`tenant_config.keywords`) — o que muda aqui aparece no card e vice-versa; o retrato
(espelho) só nasce ao marcar "integrável" e, a partir daí, os campos travam dos DOIS lados (§8). O que mudou: §3 (padrão marcado + alerta), §5 (config da API + `integracao_salvar` amplo), §6 (filtro
Situação, tudo editável, abas API/Manual), §7 (limites configuráveis, modo teste, manual).
**Entrega:** 2º deploy (P-68 B) — o 1º deploy leva o que já está pronto (fix "salvar rápido" + P-58/P-59).

## 1. Objetivo

Uma tela onde quem tem permissão organiza os produtos da loja para serem LIDOS por um programa externo (e-commerce/ERP)
através de uma API do próprio sistema. O programa externo leva um retrato fixo e conferido de cada produto; o que foi
levado fica travado no banco; tudo é auditado. Um erro depois de enviado é de responsabilidade de quem confirmou (texto
do alerta do dono) — não existe "corrigir depois pelo sistema"; só o super admin desfaz a integração, com motivo.

## 2. Glossário

- **Campos da API** — o conjunto de campos marcados (checkboxes) POR LOJA. Marcado = entra na API **e** é obrigatório
  para integrar (P-60 B). Os marcados seguem SEMPRE a ordem fixa do layout do pedido; não marcado sai.
- **Linha do produto** — 1 por produto. **Sublinhas** — 1 por variante × tamanho (as linhas de SKU do produto).
- **Estados** — `nao_integravel` → `integravel` → `integrado` (seção 4).
- **Retrato** — o conteúdo exato (colunas + linhas + caminhos das fotos) calculado pelo BANCO no momento em que alguém
  confirma o alerta. É o que a API entrega; nunca o dado ao vivo.
- **Tabela espelho** — o retrato gravado em linhas numa tabela só para a API.
- **Loja** (nesta frente) = a EMPRESA/tenant (`tenants`), NÃO as "Lojas" do Direcionamento (`lojas_direcionamento`).

## 3. Campos, ordem e fontes (P-60 B, Parte 1)

Ordem fixa (layout do pedido). A coluna "só variante" é vazia na linha do produto.

| # | Coluna | Linha do produto | Sublinha (variante × tamanho) | Fonte |
|---|---|---|---|---|
| 1 | Nome | nome do produto | nome do produto + " " + tamanho (sem a cor — o SKU diferencia) | `modelos.nome` (as 3 origens — o mesmo campo que o Sheet grava) |
| 2 | REF / SKU | REF | SKU | `modelos.ref` / `modelo_skus.sku` |
| 3 | Preço anterior | ✓ | ✓ (mesmo do produto) | `modelos.preco_anterior` |
| 4 | Preço de venda | ✓ (varejo) | ✓ | `modelos.preco_venda` |
| 5 | Peso | ✓ | ✓ | `modelos.peso_kg` |
| 6 | NCM | ✓ | ✓ | `modelos.ncm` |
| 7 | Preço de custo | ✓ | ✓ | o MESMO número do Sheet: real quando existe, senão previsto — lido com `_custo_unitario_modelos_core` DENTRO da RPC (DEFINER). "Estimado" NÃO conta como preenchido |
| 8 | Cor base | — | ✓ | nome da cor base da variante |
| 9 | Cor apelido | — | ✓ | nome do apelido; variante SEM apelido ⇒ VAZIO e não bloqueia (P-74 A item 4 — a obrigatoriedade vale só para cores que têm apelido) |
| 10 | Tamanho | — | ✓ | lado do tamanho conforme `modelos.tamanho_tipo` (Letra/Número) |
| 11 | Título para a página | ✓ | ✓ | `modelos.titulo_pagina` |
| 12 | Descrição | ✓ | ✓ | `modelos.descricao_produto` |
| 13 | Keywords | ✓ | ✓ | `tenant_config.keywords` (texto da loja) |
| 14 | Metatag Description | ✓ | ✓ | = Descrição |
| 15 | Comprimento | ✓ | ✓ | `modelos.comprimento_cm` |
| 16 | Largura | ✓ | ✓ | `modelos.largura_cm` |
| 17 | Altura | ✓ | ✓ | `modelos.altura_cm` |
| 18+ | Foto 1..N (só se "Foto do Modelo" marcado) | ✓ | — | `modelos.fotos_modelo[]` nas 3 origens (v4.1, B1b: é o campo que o card edita; a foto da tela Produto Acabado/Importado — `foto_url` — já entra nele pelo gatilho `trg_sync_foto_modelo_*`) |

- Obrigatório = todo campo marcado precisa estar preenchido no produto E em todas as sublinhas que o usam (ex.: SKU
  marcado ⇒ toda variante × tamanho com SKU). Sem sublinhas quando SKU/cor/tamanho estão marcados ⇒ não integrável.
- Mudar a seleção de campos (com confirmação) vale para as PRÓXIMAS integrações; retratos já gravados não mudam.
- **Padrão (v4, P-79):** os campos do LAYOUT do pedido (#1–#17) vêm MARCADOS na loja nova (`integracao_config` nasce com
  eles); "Foto do Modelo" nasce DESMARCADA (opcional). Desmarcar um campo do layout abre um ALERTA ("Este campo faz parte
  do layout obrigatório da API… o programa do dev pode quebrar; tem certeza?") antes da confirmação normal de salvar.

## 4. Estados e transições (Partes 1 e 4; P-63 A, P-64 A)

| Estado | Como entra | Trava? | Como sai |
|---|---|---|---|
| `nao_integravel` | padrão; toggle de volta; super admin desfez | não | marcar integrável (se completo) |
| `integravel` | alguém com EDITAR confirma o alerta | SIM (seção 8) | toggle de volta (EDITAR; individual ou em massa), SÓ se a API ainda não levou |
| `integrado` | a API confirmou a entrega do produto (seção 7) | SIM | SÓ super admin "Desfazer integração" com motivo → `nao_integravel` |

- **Vermelho** = não integrável e falta campo marcado (hover "i" lista quais); neutro = completo, ainda não marcado.
- Reprovados não aparecem (P-61 A), exceto integrados (P-74 A: integrado segue visível). Três origens;
  qualquer etapa.

## 5. Dados (banco)

Tabelas novas, todas com `tenant_id`, RLS LIGADA e **NENHUMA policy** (nem SELECT, nem escrita) + `REVOKE ALL` de
PUBLIC/anon/authenticated — o mesmo padrão de `kanban_snapshot`. TODA leitura e escrita é por RPC `SECURITY DEFINER`
que confere a permissão (`user_can_view/edit('integracao')`; ALTERAR campos e ver/alterar chaves, acessos e configurações da API = SÓ super admin — v4, dono 20h4x; LER a lista de campos marcados é de quem vê a tela, a aba Produtos precisa dela) e MASCARA o
custo (colunas de custo do espelho, do retrato e do log) quando `NOT _pode_ver_custos()` (inv. #12, delta item 1). A tela
NÃO usa Realtime nessas tabelas (sem policy o canal não assina): recarrega após cada ação e em intervalo curto.

1. `integracao_config` — 1 linha por loja: `campos text[]` (ordem fixa da seção 3; padrão = layout #1–#17, §3),
   `atualizado_por/em`, `rev` + **configurações da API (v4)**: `limite_por_minuto int` (padrão/recomendado 60; faixa
   1–600), `max_por_pagina int` (padrão/recomendado **50** — P-89 A; faixa 1–500; acima de 100 a tela avisa: "Acima de 100 pode
   passar do limite de processamento do plano gratuito do Cloudflare (10 ms por consulta). Só use com o plano pago (Workers
   Paid)."), `validade_foto_dias int` (7; 1–30), `bloqueio_tentativas int` (10; 3–100 —
   tentativas com chave errada por IP em 10 min). A linha nasce com o padrão quando falta — vale para as 6 lojas atuais
   (criada na 1ª leitura/migration) e para o `reset_loja` (semeia o padrão) — N9. SÓ o super admin muda (`integracao_salvar_config_api(_valores, _rev)`);
   fora da faixa = recusa; fora do RECOMENDADO = a tela alerta antes (o servidor aceita dentro da faixa). Log `config_api`
   com antes/depois.
2. `integracao_produtos` — `modelo_id` (1:1 por TRIGGER `enforce_unique_fk` + ÍNDICE PLANO — nunca UNIQUE), `estado`,
   `campos` (os marcados no momento), `retrato jsonb`, `assinatura`, `marcado_por/em`, `integrado_em`,
   `integrado_chave_id`, `desfeito_por/em/motivo`, `rev`. FK `modelo_id` → `modelos` ON DELETE CASCADE (a exclusão de
   produto travado é recusada antes — seção 8; a prova fica no `integracao_log`, sem FK).
3. `integracao_linhas` — a TABELA ESPELHO: 1 linha do produto + N sublinhas; colunas fixas da seção 3, `fotos text[]`
   (caminhos no storage), `tipo`, `ordem`, `modelo_id`, `loja_id`, `loja_nome`, `integrado_em`. Gerada no "integrável";
   apagada ao voltar (antes de levar) e no "desfazer" (o retrato antigo vai para o log); mantida depois de integrado.
4. `integracao_chaves` — `id`, `nome`, `hash` (SHA-256; a chave nunca é guardada), `final` (últimos 4), `criada_por/em`,
   `revogada_por/em`, `ultimo_uso_em`.
5. `integracao_acessos` — todo acesso com chave VÁLIDA (1 linha por consulta: chave, quando, status, produtos entregues,
   nº linhas); tentativas com chave INVÁLIDA agregadas (1 linha por IP por minuto, com a contagem) — R11.
6. `integracao_log` — o log da tela: ação (`campos`, `editar`, `integrar`, `voltar`, `desfazer`, `chave_criar`,
   `chave_revogar`, `config_api` — v4; `integrado` — v4.2: gravada por `_integracao_confirmar` quando a API leva o
   produto, "quem" = a chave (nome + final), é a prova visível na tela da P-64 A; ação de PRODUTO no Log por papel), quem, quando, `modelo_id` SEM FK (a prova não some se o modelo for apagado), detalhe `jsonb`
   (antes/depois; no `desfazer`, o retrato antigo inteiro). Tentativa de exclusão recusada NÃO é logada (o RAISE desfaz o
   INSERT) — a recusa aparece ao usuário e no log do Postgres.

RPCs (wrapper checa permissão; `_core` com EXECUTE revogado de PUBLIC/anon/authenticated — inv. #9; conferir
`has_function_privilege` dos 3 = f e `service_role` = t onde a rota usa):
- `integracao_previa(_modelo_ids)` — SÓ LEITURA: retrato + faltas + `assinatura` (custo mascarado p/ quem não vê). A
  `assinatura` é um **HMAC** do retrato completo com um segredo guardado numa tabela sem policy (um hash simples permitiria
  descobrir por força bruta o custo mascarado — delta nota 6). Foto com caminho fora de `<tenant_id>/` = falta ("foto de
  outra loja") já no resumo e no marcar (nota 7).
- `integracao_marcar(_itens)` — `[{modelo_id, assinatura, rev}]`: recalcula com `FOR UPDATE`; assinatura diferente ⇒
  P0409 `integracao_mudou` (ASCII); senão estado + retrato + espelho + log, atômico.
- `integracao_voltar(_modelo_ids)` — individual ou em massa; `FOR UPDATE`; só `integravel`; EDITAR.
- `integracao_desfazer(_modelo_id, _motivo)` — SÓ `is_super_admin()`; motivo obrigatório; log com o retrato.
- `integracao_salvar(_itens)` — as edições da tela (R5, delta item 2; **ampliado na v4 — "todos editáveis enquanto não
  integrado"**, P-79). Só em produto `nao_integravel` (integrável/integrado = travado, §8). Cada campo é gravado onde os
  cards o leem, com os gates do card (nenhum atalho) — a "Regra da mão dupla por origem" abaixo PREVALECE sobre esta lista.
  Como é `SECURITY DEFINER`, reconfere no servidor a permissão `integracao` (editar) e que o módulo da loja está ligado (n5):
  - campos de `modelos` (Nome, REF manual — inv. #11, Preço anterior, Peso, NCM, Título, Descrição, medidas; Preço de
    venda do FABRICADO) — UPDATE com `rev`, como o Sheet do Planejamento (`fn_modelo_preco_venda_gate` vale);
  - **Preço de venda de REVENDA** — pelo preço fixo já existente (`_salvar_precos_fixo_produto_acabado_core`, "última
    edição manda"); **de IMPORTADO** — gravador de preço fixo NOVO (ver a regra por origem abaixo);
  - **SKU** — pelo caminho da SKU prévia (`aplicar_skus_modelo` com a prévia/assinatura; P0409 `previa_desatualizada`);
  - **Fotos** — upload por `tenantPrefix()` + `sanitizeStorageName()` e gravação em `modelos.fotos_modelo[]` (as 3
    origens), só no Salvar (staging);
  - **Metatag** = Descrição (editar uma edita a outra — é o mesmo texto);
  - **Keywords** — é o texto da LOJA (`tenant_config.keywords`): a célula abre o editor da loja com o aviso "muda para
    TODOS os produtos"; grava SÓ a coluna com conferência do valor carregado (R5, abaixo — não o caminho da Config);
  - **Preço de custo, Cor base, Cor apelido, Tamanho** — **P-80 A**: só leitura com "i" dizendo de onde vem + "abrir
    card" (custo = soma da ficha; cor = cor do tecido/variante, compartilhada com outros produtos; tamanho = grade).
  - **Mão dupla (dono):** não existe cópia da tela — é o mesmo campo do produto; editar no card aparece aqui e vice-versa,
    enquanto o produto está "não integrável". A tela recarrega o valor do servidor (rev/P0409 + merge, como o Sheet).
  - **Regra da mão dupla por origem (v4.1, B1 do G-plano v4):** cada campo é gravado EXATAMENTE onde os cards daquela
    origem o leem, na MESMA transação:
    - **Nome de revenda/importado:** `modelos.nome` E `produtos_acabados.nome`/`produtos_importados.nome` juntos (o save
      da tela Produto Acabado copia o nome do produto por cima de `modelos.nome` — `_salvar_produto_acabado_core` :175-185;
      gravar só um dos lados faria a edição voltar no próximo save da outra tela). O Sheet do Planejamento passa a gravar
      os dois também (mesma função de apoio), e `_salvar_produto_importado_core` — que HOJE nunca grava em `modelos`
      (V3: o nome editado na tela Importado não chega ao card nem à API) — passa a gravar `modelos.nome` como o da revenda.
    - **REF de revenda/importado (G-mockup v4.1c nota 2):** a REF nasce no produto espelho (`produtos_acabados.ref` /
      importado) e é copiada para `modelos.ref` (inv. #13) — editar na Integração (ou no card) grava os DOIS, na mesma
      transação, com o mesmo gate `refEditavel`; o plano confere unicidade/formato da REF do espelho.
    - **Preço de venda do importado:** gravador de preço fixo NOVO (espelha `_salvar_precos_fixo_produto_acabado_core`),
      usado por TODOS os editores do preço do importado — Sheet do Planejamento (hoje manda `preco_venda` no UPDATE pelo
      ramo `isRevenda`; trocar por `isComprado` — n1), card do Plan. Produto (`criacao.planejamento.tsx:719-731`, que hoje
      já falha no importado — n2), tela Produto Importado e Integração; o save do importado LIMPA o
      fixo quando o usuário edita o markup ("última edição manda", como a revenda — fix 2efa2ba); a recusa do §8 vale para
      ele. Corrige de quebra o problema que JÁ existe (o recálculo sobrescreve o preço do importado digitado no Sheet — N13).
      Não precisa de coluna nova nem de mexer no recálculo (`_imp_recomputar_precos_modelo` já lê o fixo).
    - **Preço de venda da revenda:** o gravador de preço fixo existente, SEM mudar o gravador compartilhado (V1: pôr a
      checagem nele mudaria o Sheet e a tela Produto Acabado, que hoje não exigem essa permissão — as travas de servidor
      ficam para o Reforço de segurança, decisão D1 do dono); a checagem `criacao_planejamento:preco_venda` fica DENTRO de
      `integracao_salvar`.
    - **Fotos:** `modelos.fotos_modelo[]` nas 3 origens (é o que o card mostra/edita); a API lê daí (§3). O gatilho
      `trg_sync_foto_modelo_*` ganha `WHEN (OLD.foto_url IS DISTINCT FROM NEW.foto_url)` (V2: hoje o save do Produto
      Acabado regrava `foto_url` sempre e o gatilho recoloca a foto do produto como capa — desfaria em silêncio uma
      remoção/reordenação feita na Integração ou no Sheet, e num produto travado com Foto marcada recusaria o save inteiro).
  - **Gates do card valem campo a campo (v4.1, R2):** a célula só é editável se o card deixaria editar AQUELE campo para
    AQUELE usuário; senão fica só leitura com o motivo no "i". REF: `refEditavel` (revelada pela etapa + não travada pelo
    envio — decisão 10 da campanha); Preço de venda e Preço anterior: permissão `criacao_planejamento:preco_venda`; SKU:
    `_sku_guarda`; Keywords: só admin da loja/super admin (RLS de `tenant_config`). O servidor confere de novo cada gate.
  - **Orquestração do Salvar (v4.1, R4):** como o Sheet, em ordem fixa: (1) sobe as fotos novas ao storage; (2) RPC
    `integracao_salvar` — ATÔMICA: colunas de `modelos` com `rev` por produto + nome/preço espelho + Keywords; (3) SKUs por
    `aplicar_skus_modelo` (prévia/assinatura). Falha em (2) = nada gravado (as fotos já subidas ficam órfãs e são
    apagadas pela tela); falha em (3) = (2) fica gravado e a tela avisa "SKUs não salvos — confira e salve de novo",
    mantendo o rascunho dos SKUs. `rev` cobre `modelos`; Keywords e SKU têm conferência própria (abaixo).
  - **Keywords (v4.1, R5):** UPDATE SÓ da coluna `tenant_config.keywords` com conferência do valor carregado (mudou no
    meio = P0409 `keywords_mudou`, ASCII) — nunca o upsert da linha inteira da Config.
- `integracao_salvar_config(_campos, _rev)`, `integracao_chave_criar(_nome)` (devolve a chave UMA vez),
  `integracao_chave_revogar(_id)` — **SÓ super admin** (v4, dono: "campos API e chaves e acessos, somente super admin");
  idem as leituras de chaves/acessos/configurações e `integracao_salvar_config_api`.
- `_integracao_ler(_chave_hash, _incluir_integrados, _cursor, _limite)` e `_integracao_confirmar(_chave_id,
  _entrega jsonb)` — SÓ para a rota da API (service role) — ver seção 7.

**Regra de mensagens (lição da P-58/P-59):** toda recusa desta frente com errcode que o PostgREST devolve como 5xx
(P0409, P0002…) tem mensagem SÓ ASCII; a tela traduz pelo `code` em `src/lib/erro-mensagem.ts` (arquivo compartilhado —
vale também para o Sheet do Dev, sem tocar `src/components/desenvolvimento/**`).

## 6. Tela (Parte 2; P-65 A; P-71 A)

- **Acesso:** permissão NOVA `integracao` (ver/editar), em Gerenciar Usuários e nos papéis — `ModuleDef` próprio no
  padrão do `importar` (página única, link direto no menu da loja) e EXCLUÍDO dos interruptores de contratação em
  `admin/lojas.tsx` (como o `importar`, :59-61) — não é módulo contratável. Super admin: item também no **Admin Mestre**.
  Integrar/voltar/editar exigem EDITAR (servidor confere).
- **Quem vê cada aba (v4, dono 26/set 20h4x, verbatim):** "abas: Produtos e Log poderão ser acessados por Admin, e usuários
  que tenham permissão em Gerenciar Usuários · abas: campos API e chaves e acessos, somente super admin" ⇒ **Produtos** e
  **Log**: admin da loja + quem tem a permissão `integracao` (ver; editar/integrar exige EDITAR); super admin também.
  **Campos da API**, **API** (chaves, acessos, configurações) e **Manual da API** (junto das abas da API — é o guia de uso
  da chave; **P-81 A**, dono 26/set): **SÓ super admin** — as abas nem aparecem para os outros e o
  servidor recusa as RPCs delas.
- **Abas (v4):** Produtos · Campos da API (mudar pede confirmação; desmarcar campo do layout = alerta) · API (chaves,
  acessos e **Configurações da API**) · **Manual da API** · Log.
- **Produtos:** filtro **Situação** (v4): **Não integrados** (PADRÃO, ativo ao abrir = não integrável + integrável) ·
  Integrados · Todos; + filtros coleção/etapa/origem/estado + busca nome/REF; páginas de 50; seleção em massa (integrar E voltar);
  toggle Integrável por linha; estado (vermelho com "i"; "Integrado em dd/mm hh:mm"); colunas = campos marcados (custo
  mascarado para quem não vê custos); seta abre as sublinhas. **Editáveis (v4): TODOS os campos enquanto o produto está
  "não integrável"** (staging, só o Salvar grava; `rev`/P0409 + merge) — ver `integracao_salvar` (§5); custo, cor base, cor
  apelido e tamanho só leitura com "i" + "abrir card" (P-80 A). Mesmo campo do produto nos dois lados (mão dupla).
  Linhas integráveis/integradas mostram o RETRATO (o que vai/foi para a API), não o valor vivo — custo, cor, Keywords e
  tamanho não travam na origem e podem ter mudado depois (N10); um "i" avisa quando o vivo difere do retrato.
- **Log por papel (v4.1, N11):** admin da loja e usuários com a permissão veem só as ações de PRODUTO (editar, integrar,
  voltar, desfazer, integrado); as ações de campos, chaves e configurações da API (`campos`, `chave_*`, `config_api`) só o super admin
  vê.
- Integrável/integrado = campos travados (cinza, cadeado).
- **Integrar:** individual ou em massa; só completos e sem alterações pendentes; com "Preço de custo" marcado, só quem
  pode VER custos (P-75 A — o servidor confere `_pode_ver_custos()` em `integracao_marcar`; na tela, o botão fica travado
  com o motivo). Dialog
  com o texto do dono **"Você tem certeza? Se estiver errado, você poderá ser demitido"** + o resumo de
  `integracao_previa`; "Tenho certeza — integrar" → `integracao_marcar` com as assinaturas do resumo.
- **Voltar:** toggle (ou em massa) com confirmação, só `integravel`. **Desfazer:** só super admin, com motivo.
- **Outras telas:** Sheet do Planejamento, Plan. Tecido, Produto Acabado, Importado — campos travados desabilitados com
  selo "Integrável/Integrado em dd/mm — travado". O Sheet do Dev (intocado, decisão 8) não muda: o banco garante, e o
  erro chega traduzido pelo `erro-mensagem.ts` compartilhado.
- **Mobile — NÃO TEM esta tela (P-87, dono 27/set 00h3x: "celular não vai ter essa tela"):** em tela estreita o item
  "Integração" some do menu e a rota mostra só um aviso "A Integração é usada no computador" (sem dados, sem ações). Os
  selos/trava nas OUTRAS telas (§6 "Outras telas") continuam valendo no celular.
- **Mockup** (tema claro, `reference_mockup_padroes`) ANTES do código (P-71 A).
- O card "Integração com ERP" da Config (oculto) e o doc local `docs/api-integracao-erp.md` ficam como estão (aposentar =
  ocultar primeiro; nada é apagado).

## 7. API (Parte 3; P-66 A; P-67 A; P-69 A)

> **Atualização Release A2 (03/out/2026 — P-222 B, P-223 A, P-224 B+, P-225 A; plano
> `.superpowers/sdd/2026-10-03-api-objetos/plan.md`; migration `20261030130000`). PREVALECE sobre o texto abaixo onde diverge:**
> (1) **`loja=<uuid>` OBRIGATÓRIO** em toda chamada (normal e teste): ausente/vazio/malformado/repetido ⇒ 400
> `parametro_invalido` (sem tocar no banco); uuid de outra loja (≠ loja da chave) ⇒ **403 `loja_nao_autorizada`** — nada
> entregue nem confirmado, registrado em `integracao_acessos` (agregado por chave×minuto, não conta no bloqueio de IP nem no
> limite por minuto). A fase 1 é `_integracao_ler_loja` (DEFINER, só `service_role`), que delega a `_integracao_ler` (intocada).
> (2) **Resposta em objetos chave-valor**, mesmo endereço, `versao` segue 1: `{ versao, modo, loja:{id,nome}, gerado_em,
> pagina:{limite,maximo}, produtos:[{ produto_id, loja_id, loja_nome, integrado_em, <chave>: valor…, variantes:[{ produto_id,
> loja_id, loja_nome, integrado_em, <chave>: valor… }] }], proximo_cursor }` — saem `colunas` e `linhas`; chaves = as chaves
> fixas do layout (nome, ref_sku, preco_anterior, preco_venda, peso, ncm, preco_custo, cor_base, cor_apelido, tamanho, titulo,
> descricao, keywords, metatag, comprimento, largura, altura, foto, colecao, categoria_tecido, linha); presentes = união da
> página (fora do retrato daquele produto = `null`); produto sem variantes ⇒ `variantes: []`. A rota agora chama 3 funções
> `_integracao_*` (`_ler_loja`, `_confirmar`, `_limpar`).

- **Onde:** rota de servidor do PRÓPRIO site (TanStack Start no Cloudflare Workers), no molde já existente
  `src/routes/sitemap[.]xml.ts` (`server.handlers.GET`); publicada no `npm run deploy`; usa
  `src/integrations/supabase/client.server.ts` (service role).
- **Endereço:** `GET /api/integracao/v1/produtos` · `Authorization: Bearer <chave>`. Parâmetros: `incluir_integrados`
  (padrão falso), `limite` = nº de PRODUTOS por página (≤ `integracao_config.max_por_pagina`; sem `limite` = o máximo da loja,
  padrão 50 — P-89 A; um produto nunca é partido entre páginas), `cursor`, `modo` (v4).
- **Fluxo de uma consulta (R7 — "entregue com sucesso"):**
  1. `_integracao_ler` (transação 1): valida a chave (não revogada, loja ativa), lê do espelho da loja da chave até
     `limite` produtos `integravel` (e `integrado`, se pedido), devolve linhas + um "lote" `{modelo_id, assinatura}`.
  2. O Worker valida o prefixo de cada caminho de foto (`<tenant_id>/…`, inv. #2 — caminho de outra loja é descartado e
     registrado) e gera os links temporários (`validade_foto_dias`, padrão 7); arquivo inexistente ⇒ link nulo + registro.
  3. `_integracao_confirmar` (transação 2): `FOR UPDATE` nos produtos do lote; marca `integrado` SÓ os que ainda estão
     `integravel` com a MESMA assinatura; registra o acesso; devolve o conjunto confirmado.
  4. O Worker responde só com os produtos confirmados (+ os já integrados, se pedidos). Se a resposta se perder, o
     programa relê com `incluir_integrados=1`.
  - "Confirmar" é a 2ª fase INTERNA da rota (não um retorno do programa do dev). `_integracao_confirmar` reconfere a chave
    e a loja de cada produto. Chave inválida/revogada NÃO dá RAISE: `_integracao_ler` devolve um status e registra a
    tentativa (agregada por IP), senão o registro seria desfeito junto com o erro (nota 9).
- **Resposta:** `{ versao, modo, loja:{id,nome}, colunas:[...], gerado_em, pagina:{limite, maximo}, linhas:[{tipo,
  produto_id, loja_id, loja_nome, integrado_em, valores:[...na ordem de colunas]}], proximo_cursor }`. **v4.4 (P-89 A):**
  `pagina.limite` = quantos produtos por página ESTA resposta usou (o `limite` pedido, cortado no máximo; sem `limite` = o
  máximo; no modo teste = 2, o tamanho das páginas de exemplo) e `pagina.maximo` = o "Máximo de produtos por página" da loja
  HOJE — o programa do dev se ajusta sozinho se a loja mudar a configuração.
- **Segurança:** só a impressão digital da chave é comparada; revogada/errada/loja inativa ⇒ 401/403 com corpo JSON
  mínimo e ASCII (nunca texto interno, inclusive em 500); limite por minuto POR CHAVE e POR IP (binding de rate limit do
  Workers no `wrangler.jsonc`); a rota só chama as 2 funções `_integracao_*` — nada mais do banco é exposto; nunca logar
  a chave.
- **Limites configuráveis (v4):** `limite` ≤ `integracao_config.max_por_pagina`; o limite por minuto POR CHAVE é conferido
  em `_integracao_ler` contando `integracao_acessos` da chave nos últimos 60 s (≥ `limite_por_minuto` ⇒ status
  `limite_excedido`, HTTP 429 + `Retry-After`); chave errada: ≥ `bloqueio_tentativas` do mesmo IP em 10 min ⇒ 429 para
  esse IP; validade dos links de foto = `validade_foto_dias`. O binding de rate limit do Workers fica como TETO fixo por IP
  (proteção do Worker, não configurável na tela) — configurar no `wrangler.jsonc` com teto ≥ 600/min (hoje não há binding).
  **(v4.1, R7):** a contagem por chave roda sob `pg_advisory_xact_lock` da chave (rajada paralela não fura o limite); a
  resposta 429 NÃO conta no limite (é registrada agregada, como a chave errada); índices em `integracao_acessos`
  (`chave_id, criado_em DESC`) e (`ip, criado_em DESC`); retenção: acessos que ENTREGARAM produtos são permanentes (prova
  da P-64 A); os demais (0 produtos, 429, chave errada) são apagados após 90 dias por limpeza oportunista dentro de
  `_integracao_ler` (no máx. 500 linhas por chamada, SÓ da loja da chave — n4). Para a contagem valer em rajada paralela,
  `_integracao_ler` grava uma RESERVA do acesso sob o lock (V4) — o `_integracao_confirmar` completa essa linha. As faixas máximas (500 por página; 30 dias de link) passam do que foi
  aprovado na m084/P-67 A (200; 7 dias). **v4.4 (P-89 A):** RECOMENDADO/padrão = 50 produtos por página (o plano gratuito do
  Cloudflare dá 10 ms de CPU por consulta; a medição do guardião deu p95 ≈ 4,5 ms com 50 e ≈ 13,8 ms com 200) e 7 dias de
  link; acima de 100 a tela avisa que só vale com o plano pago (Workers Paid). Aumentar depois = mudar o "Máximo de produtos
  por página" da loja na aba API (dentro de 1–500), sem migration nem deploy.
- **Modo teste (v4; P-82 A, dono 26/set 21h0x):** `modo=teste` devolve DADOS DE EXEMPLO — produtos FICTÍCIOS, no formato
  real (mesmas `colunas` marcadas da loja, linha do produto + sublinhas variante × tamanho, `proximo_cursor` numa 2ª
  página de exemplo, fotos com links de exemplo) — e NUNCA dados reais: nenhum dado verdadeiro sai sem virar "integrado"
  (P-64 A intacta). Não chama `_integracao_confirmar`; a resposta traz `"modo":"teste"`; o acesso é registrado como teste
  (`integracao_acessos.modo`) e conta para o limite; `_integracao_ler` ganha `_modo` e `_ip`. Os exemplos são gerados por
  função pura (sem ler produto nenhum) — testável; os links de foto do exemplo são endereços PÚBLICOS fixos de exemplo,
  nunca links assinados do storage (n3).
- **Manual da API** (aba própria, v4 — sem segredos; SÓ super admin, P-81 A): (1) o que é e como funciona (integrável →
  a API leva → integrado); (2) passo a passo de como integrar (criar chave → entregar ao dev → testar em modo teste →
  ligar de verdade → conferir no Log); (3) endereço e comandos com exemplos prontos para copiar (Terminal/curl,
  JavaScript, Python); (4) parâmetros (`modo`, `incluir_integrados`, `limite`, `cursor`) com o efeito de cada um;
  (5) a resposta explicada campo a campo (`colunas`, `linhas`, `tipo`, `valores`, `pagina`, `proximo_cursor`,
  `integrado_em`, fotos que expiram); (6) códigos de resposta e o que fazer (200, 401 chave errada/revogada, 403 loja inativa,
  429 limite, 500); (7) boas práticas (paginar até `proximo_cursor` nulo; guardar o `produto_id`; reler com
  `incluir_integrados` se a resposta se perder; não expor a chave); (8) perguntas frequentes; (9) checklist antes de ligar.
  **v4.4 (P-89 A)** — em Parâmetros, Boas práticas e Perguntas frequentes: "O número de produtos por página pode mudar (é
  uma configuração da loja). Seu programa nunca deve contar com um tamanho fixo de página: siga o `proximo_cursor` até ele
  vir vazio e, se quiser, leia `pagina.maximo` para pedir páginas maiores."
  Inclui "Ver resposta de exemplo" (RPC só leitura, SÓ super admin, da loja atual; fotos sem link; NÃO registra acesso
  e NÃO conta no limite — N12). "loja" = a empresa, não
  as lojas do Direcionamento.

## 8. Trava no banco (Parte 4; P-62 A; P-73 A)

- **O que trava:** as colunas de `modelos` dos campos que estavam MARCADOS no retrato (`integracao_produtos.campos`),
  mais — SEMPRE, sem condição (B2; m085 aprovada) — `modelos.tamanho_tipo` e as linhas de `modelo_skus` do produto; e as
  fotos se "Foto do Modelo" marcado (`fotos_modelo`, `produtos_acabados/importados.foto_url`).
- **Gatilhos:** BEFORE UPDATE em `modelos` (e nas tabelas das fotos de revenda/importado) e BEFORE INSERT/UPDATE/DELETE em
  `modelo_skus`: se o produto está `integravel`/`integrado`, recusa MUDANÇA real (`OLD IS DISTINCT FROM NEW` por coluna —
  o Sheet do Dev manda nome/ref/fotos em todo save e passa se não mudou; R9). Mensagem ASCII `integracao_travado: …`,
  errcode 42501. `SECURITY DEFINER` (lê `integracao_produtos`); nome que dispara POR ÚLTIMO na ordem alfabética dos
  BEFORE (`trg_zz_integracao_trava`, depois de ref_auto/markup/mo_flag/preco_venda_gate/kanban_status_guard); NUNCA
  `ENABLE ALWAYS` (o `reset_loja` usa `session_replication_role=replica`).
- **Espelho de revenda/importado (delta item 3):** BEFORE DELETE em `produtos_acabados`/`produtos_importados` e BEFORE
  INSERT/UPDATE/DELETE nas variantes deles (`produto_acabado_variantes`/importado) recusam MUDANÇA REAL quando o card
  ligado está travado (v4, nota 14 do G-mockup: `_salvar_produto_acabado_core`/`_salvar_produto_importado_core` apagam e
  recriam variantes/etapas em TODO save — o mesmo conjunto regravado tem de passar, senão nenhum campo livre, como
  fornecedor ou pagamento, salva mais; o plano escolhe entre comparar o conjunto no gatilho ou o save pular as variantes
  quando não mudaram) — senão `_excluir_produto_*_core` (FK SET NULL) ou o save do produto (apaga/recria variantes) sumiriam com a foto
  e as cores travadas.
- **Preço fixo explícito (delta item 4):** `_salvar_precos_fixo_produto_acabado_core` RECUSA (42501, mensagem ASCII) quando
  o card está travado com "Preço de venda" marcado — só o recálculo AUTOMÁTICO pula em silêncio; editar o preço à mão num
  produto travado nunca é aceito sem aviso.
- **SKU automático (nota 11):** `gerarSeFaltar`/Regerar não rodam em produto travado (a tela mostra uma vez "SKUs
  travados pela integração"), para não gerar erro a cada Salvar.
- **Recálculo automático de preço (B1):** `_pa_recomputar_precos_modelo` e `_imp_recomputar_precos_modelo` (chamadas ao
  receber a OC P.Acabado, salvar/vincular OC, salvar markup/preço fixo e pelo gatilho de MO) passam a NÃO gravar
  `preco_venda` quando o produto está travado com "Preço de venda" marcado — o preço fica congelado (o retrato já tem o
  valor enviado). Redefinição das 2 funções com diff `pg_get_functiondef` (G-migration). Sem isso, receber a OC ou salvar
  a MO de um produto integrado daria erro e desfaria a transação inteira, ferindo a P-62 A (mesma classe de
  `20260911130000_preco_venda_gate_fix_derivado.sql`).
- **NÃO travam:** BOM, CAD, grade de produção, custos, PCP, CQ, Direcionamento, estoque. Mudar cores no BOM de um produto
  travado não cria SKU novo (o gatilho de `modelo_skus` recusa; o Regerar mostra o motivo; o save do BOM não cai — a
  geração de SKU é chamada separada e `variante_key` não tem FK).
- **Exclusão (R8 + delta item 3):** BEFORE DELETE em `modelos` recusa produto `integravel`/`integrado`; idem o produto
  espelho de revenda/importado (acima). Para excluir, o super admin desfaz antes.
- **Destravar:** só `integracao_voltar` e `integracao_desfazer`, que mudam o ESTADO (nunca gravam colunas travadas) —
  sem GUC. Teste: UPDATE direto via REST, até de super admin, é recusado em produto integrado.
- **Storage:** apagar o ARQUIVO de uma foto enviada não é bloqueado na v1 (a API devolve link nulo e registra; a tela
  avisa "foto do retrato não encontrada"). Política de storage para isso = pendência.

## 9. Erros e casos-limite

- Duas pessoas integrando o mesmo produto: `FOR UPDATE` + assinatura; a 2ª recebe P0409 e vê o resumo novo.
- Produto editado entre o resumo e o "Tenho certeza": assinatura diferente ⇒ recusa com o resumo novo.
- Voltar × entregar ao mesmo tempo: os dois usam `FOR UPDATE`; se o voltar vencer, o `_confirmar` não marca e o Worker
  tira o produto da resposta.
- Chave revogada no meio de uma paginação: próxima página recusada; o que já saiu fica integrado.
- Loja inativa: API recusa; a tela segue as regras de loja inativa.
- Reprovado depois de integrado: continua `integrado` e visível (P-74 A).

## 10. Testes

- **Unit:** retrato (ordem, obrigatórios, nome da sublinha, custo real>previsto e "estimado" = falta, apelido → cor base),
  mapeamento de erros por `code`, estados da tela (staging, vermelho, integrar desabilitado com pendência, custo mascarado).
- **Integração (cópia, transação desfeita, janela N3):** cada campo marcado travado e não marcado livre; SKUs e "Tamanho
  em" sempre travados; save do Sheet do Dev SEM mudança passa; BOM/CAD/produção seguem; **receber OC P.Acabado e salvar MO
  de revenda integrada passam e o `preco_venda` fica igual (B1)**; exclusão recusada; resumo×retrato idênticos; P0409 com
  assinatura velha; voltar só antes de levar (individual e massa); desfazer só super admin; UPDATE REST direto recusado;
  `_integracao_ler`/`_confirmar` (paginação por produto sem partir, `incluir_integrados`, chave revogada, loja inativa,
  corrida voltar×entregar); as 6 tabelas SEM leitura direta via REST (só RPC) e custo mascarado nas RPCs; excluir produto
  espelho travado recusado; editar variante de revenda/importado travada recusado; preço fixo explícito recusado em revenda
  travada; `gerarSeFaltar` não roda em travado; HMAC da assinatura; `reset_loja` com produto integrado; ACL (#9)
  de todos os `_core` (`service_role` = t onde a rota usa, os 3 = f); mensagens ASCII por COMANDO (regex `\y`, lição P-58);
  medir `integracao_previa` numa página de 50. **v4:** `integracao_salvar` por campo nas 3 origens (REF manual, SKU pela
  prévia + P0409, preço fixo revenda E importado — paridade do gravador novo com o da revenda —, fotos, Keywords da loja,
  Metatag = Descrição) e recusa em produto integrável/integrado; `integracao_salvar_config_api` só super admin + faixas;
  config padrão da loja nova = layout marcado e Foto desmarcada; limite por chave em `_integracao_ler` (61ª consulta em
  60 s = `limite_excedido`), bloqueio por IP após N chaves erradas, `max_por_pagina` e `validade_foto_dias` respeitados
  (v4.4: padrão 50 e a resposta com `pagina.limite`/`pagina.maximo` certos);
  `modo=teste` NÃO marca integrado, é registrado como teste e devolve SÓ exemplos (nenhum `modelo_id` real). **v4.2:**
  mão dupla por origem (nome nos 2 lados nas 3 telas, inclusive o save do importado — V3; preço fixo do importado nos 4
  editores + save limpando o fixo ao editar markup; fotos em `fotos_modelo`); gatilho de foto com `WHEN` (V2 — save do
  Produto Acabado sem mudar a foto não reordena nem é recusado em travado); checagem de preço só na `integracao_salvar`
  (V1 — Sheet e Produto Acabado seguem iguais); rajada paralela respeita o limite (V4); o padrão semeado pelo
  `reset_loja` (n6 — passa pelo G-migration).
- **API (cópia):** rota local com chave de teste — resposta, paginação, links de foto, prefixo de outra loja descartado,
  limite por chave/IP, registro de acessos (inclusive chave inválida agregada).
- **E2E (:5188, cópia):** integrar com o alerta, tentar editar travado (tela e Sheet), voltar, desfazer (super admin);
  v4: filtro "Não integrados" ativo ao abrir; desmarcar campo do layout abre o alerta; mudar configuração para fora do
  recomendado abre o alerta (super admin); para admin da loja/usuário com permissão só aparecem as abas Produtos e Log
  (e o Log sem as ações de campos/chaves/config); manual abre e "Ver resposta de exemplo" (super admin).
- **Mobile** 360/390.
- **Produção:** migration com inverso em `supabase/rollback/` e `pg_dump` completo antes (sem PITR).

## 11. Fora do escopo

- Envio ativo (push) para o ERP; confirmação (ack) do programa externo (P-64 A = leitura).
- Chave mestra multi-loja (P-66 A).
- Os 11 `P0002` com acento de outras funções (pendência anotada).
- O conserto do hook `useActiveTenantId` (frente Camada intermediária).
- Política de storage que impeça apagar arquivo de foto enviada (pendência).

## 12. Ordem de construção (esboço para o plano)

F0 mockup (aprovação do dono) → F1 banco (tabelas, RLS, RPCs, gatilhos de trava, redefinição dos 2 recálculos de preço;
G-migration; ensaio; RODAR do dono com pg_dump antes) → F2 tela (abas, staging, alerta, massa) → F3 API (rota de servidor,
chave, fotos, limites, log) → F4 selos de trava nas outras telas → QA na cópia → G-deploy → 2º deploy.
