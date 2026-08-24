# Nº de Pedido automático T/A/I (composto) nas 3 OCs — Design

**Data:** 2026-08-24 · **Feature B** do tracker · **Telas:** OC Tecido, OC Aviamento, OC Insumo

## Objetivo

Toda OC (Tecido/Aviamento/Insumo) ganha um **Número de Pedido automático composto**, com prefixo de tipo **T/A/I**, sigla(s) do fornecedor+material, e uma **sequência própria por prefixo**, por tenant. No dialog de criação o número **aparece ao vivo** (editável) conforme o usuário escolhe fornecedor e material — para não parecer campo obrigatório em branco. Edição manual trava o auto-recálculo.

## Formato (decisão do dono: composto em todas)

- **OC Tecido:** `T-<sigForn><sigTecido>-NNNNN` (mantém a lógica atual do Plan. Tecido, + prefixo `T-`)
- **OC Aviamento:** `A-<sigForn><sigAviam>-NNNNN`
- **OC Insumo:** `I-<sigForn><sigInsumo>-NNNNN`
- `<sigX>` = 3 primeiras letras (sem acento, só A-Z) do nome — via `_aviamento_sigla` (já existe, IMMUTABLE, trata acento). ⚠️ Hoje o Plan. Tecido usa uma sigla inline levemente diferente (`[^A-Za-z0-9]`, mantém dígitos); PADRONIZAR tudo em `_aviamento_sigla` p/ front e banco baterem.
- `NNNNN` = sequência (max+1) **por prefixo completo** (`T-TEXTEC-`), por tenant, zero-pad 5. Cada prefixo conta do 1 (padrão `fn_aviamento_codigo`).
- Sem fornecedor/material escolhido → não há sigla → o número não fecha (placeholder no dialog).

## Decisões (confirmadas com o dono)

1. **Composto em todas** (T/A/I + siglas + sequência).
2. **Sequência própria por prefixo** (não compartilhada entre T/A/I).
3. **Automático + editável, e o número APARECE no dialog** (preview do código que será usado). Ao vivo conforme escolhe fornecedor+material.
4. **Edição manual trava o auto:** se o usuário digitou/alterou, para de recalcular ao trocar fornecedor/material; volta a auto só se limpar o campo.

## Estado atual (investigação)

- `numero_pedido varchar` existe nas 3 tabelas: `ocs_tecido`, `ocs_aviamento`, `ocs_etiqueta` (a tabela do Insumo). **Passthrough puro** nos 3 save-cores (`_salvar_oc_tecido_core`/`_salvar_oc_aviamento_core`/`salvar_oc_etiqueta`) — o banco grava o que o front manda, zero geração.
- **Só o Tecido tem geração automática hoje**, e SÓ pelo Plan. Tecido: `_plan_tecido_fazer_pedido_core` monta `<sigEmp><sigArt>-NNNNN` (ex. `TEXTEC-00001`), com `pg_advisory_xact_lock` + loop de colisão. É RPC, não trigger. Aviamento/Insumo: nenhuma geração, criados só manualmente.
- **UNIQUE index** `(tenant_id, numero_pedido)` existe em `ocs_tecido` e `ocs_aviamento`, **NÃO em `ocs_etiqueta`** (gap — fechar).
- Dialogs: os 3 já têm campo "Número do Pedido" (`<Input>` livre): `OcTecidoForm.tsx:112` (Tecido, com colab), `oc-aviamento.tsx:789`, `oc-insumo.tsx:472` (usa `useState` flat, não Draft).
- Precedente a espelhar: `fn_aviamento_codigo` (`20260718150000`) — trigger BEFORE INSERT, fill-if-empty, `SIGLA-NNNN` por tenant. `_aviamento_sigla` = a função de sigla.

## Arquitetura

### DB

1. **Migration — UNIQUE index no Insumo** (`ocs_etiqueta`): partial unique `(tenant_id, numero_pedido) WHERE numero_pedido IS NOT NULL AND <> ''`, espelhando os outros dois. Fecha o gap.

2. **RPC `proximo_numero_oc(_tipo, _fornecedor_id, _material_id) → text`** (a peça do "aparece ao vivo"; **a RPC calcula TUDO — decisão do dono**): recebe os IDs; calcula as siglas via `_aviamento_sigla` (empresa + material), monta o prefixo `<letra>-<sigForn><sigMat>-`, calcula a sequência max+1 por (tenant, prefixo) sobre a tabela certa, devolve o número completo. Fonte ÚNICA no banco — o front só EXIBE, nunca recalcula sigla (elimina o risco de drift preview≠salvo). `SECURITY DEFINER`, filtra por `get_user_tenant_id()`, REVOKE PUBLIC/anon, grant authenticated. **Só LÊ** (peek) — a gravação é via o save-core normal com o número que o front recebeu e mandou de volta.
   - Assinatura: `proximo_numero_oc(_tipo text, _fornecedor_id uuid, _material_id uuid) returns text`. `_tipo` ∈ 'tecido'|'aviamento'|'insumo' escolhe: a letra (T/A/I), a tabela (`ocs_tecido`/`ocs_aviamento`/`ocs_etiqueta`), e a tabela do material (`artigos`/`aviamentos`/`insumos`... — confirmar a tabela real do material de cada OC no plano).
   - Corpo: `v_letra` por `_tipo`; `v_sigF := _aviamento_sigla((select nome_fantasia from empresas where id=_fornecedor_id))`; `v_sigM := _aviamento_sigla((select nome from <tabela_material> where id=_material_id))`; `v_prefixo := v_letra||'-'||v_sigF||v_sigM||'-'`; `select coalesce(max(nullif(regexp_replace(numero_pedido,'^.*\D','',''),'')::int),0)+1 ... where tenant_id=get_user_tenant_id() and numero_pedido like v_prefixo||'%' and numero_pedido ~ (v_prefixo||'\d+$')`; return `v_prefixo||lpad(seq,5,'0')`. Se faltar fornecedor ou material (IDs null) → retorna NULL (front mostra placeholder).

3. **Colisão no salvar (belt):** como o peek do front pode ficar velho (2 usuários criando ao mesmo tempo), o save-core de cada OC ganha um guard: se `numero_pedido` bater com um existente do tenant, faz o loop max+1 até um livre (igual ao Plan. Tecido já faz). OU confiar no UNIQUE index + retry no front. **Decisão de plano:** adicionar o loop de colisão nos 3 save-cores é o mais robusto (o UNIQUE index é o backstop final). Isso é uma edição de função (diff-validar).

4. **Plan. Tecido:** `_plan_tecido_fazer_pedido_core` passa a prefixar `T-` (hoje gera `TEXTEC-`, vira `T-TEXTEC-`) e a usar `_aviamento_sigla` (consistência). Diff-validar.

### Front (3 dialogs)

Padrão comum (o "aparece ao vivo + editável + trava na edição"):
- Estado: além de `numero_pedido`, um flag `numeroEditadoManual: boolean` (vira true no onChange do input pelo usuário; false ao limpar).
- `useEffect` que observa (fornecedor_id, material_id) e, se `!numeroEditadoManual` E modo CRIAÇÃO: chama `proximo_numero_oc(tipo, fornecedorId, materialId)` (debounced) e seta `numero_pedido` com o resultado. Se a RPC retornar NULL (falta fornecedor/material) → `numero_pedido` vazio + placeholder `T-… (escolha fornecedor e tecido)`.
- **Sem sigla no front** — a RPC calcula tudo; o front só manda IDs e exibe. (Elimina o drift.)
- O `<Input>` fica editável; onChange do usuário → `numeroEditadoManual = true`. Campo vazio manual → `numeroEditadoManual = false` (volta a auto).
- Qual é o "material" de cada OC p/ a sigla: Tecido → o artigo do 1º item (`artigo_id`); Aviamento → o aviamento do 1º item; Insumo → o insumo/etiqueta do 1º item. O front pega o 1º item selecionado. (O Plan. Tecido já usa o artigo do 1º item ordenado — manter coerência.)
- Tecido: o form usa `Draft` + tem colab (cuidado com o snapshot dirty — o número auto-preenchido não deve marcar "não salvo" sozinho? — na verdade deve, é um campo do form; mas o auto-preenchimento no abrir não pode disparar o guard de unsaved falsamente. Tratar: só auto-preenche em modo CRIAÇÃO, não edição).
- Insumo: usa `useState` flat (`numero`, `setNumero`) — adaptar o padrão a esse estilo.

## Fora de escopo
- Renumeração retroativa das OCs antigas (ficam com o número que têm).
- Sequência global compartilhada (é por prefixo).
- Criar "Plan. Aviamento"/"Plan. Insumo" (não existem; Aviamento/Insumo só manual).

## Riscos
- (a) ~~sigla front vs banco~~ RESOLVIDO pela decisão "RPC calcula tudo": não há sigla no front; o preview É o retorno da RPC, que é a mesma lógica que roda no salvar. Zero drift.
- (b) peek velho em concorrência → 2 OCs com mesmo número. Mitigar: loop de colisão no save-core + UNIQUE index (backstop). O front pode re-tentar no erro de unique.
- (c) auto-preenchimento disparar o guard de "não salvo" no Tecido (colab). Mitigar: auto só em criação; e/ou não contar o número no snapshot inicial.
- (d) editar função (save-cores + plan) = diff-validar obrigatório.
- (e) Insumo sem UNIQUE index hoje — criar antes de ligar o auto (senão duplica).
