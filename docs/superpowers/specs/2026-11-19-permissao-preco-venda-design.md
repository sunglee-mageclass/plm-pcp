# Permissão própria para preço de venda (varejo) e atacado — Design

**Data:** 2026-11-19
**Frente:** Permissão própria para o preço de venda (varejo) e o preço de atacado, desacoplada de custos (demanda do dono, brainstorm 19/nov)
**Tipo:** permissão por seção + guarda de escrita no banco — **TEM BANCO** (novas chaves no catálogo + backfill + estender 1 gatilho existente). Deploy PRÓPRIO (banco antes do site), **não é destrutivo**.
**Decisões travadas:** `.superpowers/sdd/2026-11-19-permissao-preco-venda/decisoes-dono.md` (leitura obrigatória; o spec RESPEITA, não reabre).

---

## Entendimento (intenção do dono, confirmada no brainstorm 19/nov)

Hoje a EXIBIÇÃO do preço de venda (varejo) e do preço de atacado segue a permissão de **custos** (`_pode_ver_custos`): quem vê custo vê preço, quem não vê custo não vê nenhum dos dois. O dono quer **desacoplar** isso: o preço de venda e o preço de atacado passam a ter **permissão PRÓPRIA**, independente de custos, e **separada entre varejo e atacado**.

São **4 permissões novas, todas ortogonais a `_pode_ver_custos`:**
1. **VER** preço de **varejo** (`modelos.preco_venda`)
2. **EDITAR** preço de **varejo**
3. **VER** preço de **atacado** (`modelos.preco_atacado`)
4. **EDITAR** preço de **atacado**

Vocabulário travado: **"preço de venda" = "preço de varejo" = `modelos.preco_venda`** (mesma coluna; o rótulo varia por tela — "preço de venda" numa, "varejo" noutra — mas a permissão de VAREJO cobre tudo que o sistema chama de preço de venda). **Atacado = `modelos.preco_atacado`**, campo separado, só em produtos comprados (revenda/importado). Quando o dono diz "varejo", NÃO engloba o atacado.

**Independência ortogonal (confirmada):** ver custo e ver preço são independentes nos 4 cruzamentos. Um usuário com "ver custos" mas SEM "ver preço de varejo" vê o custo e o varejo fica escondido; o inverso também (vê o preço, custo mascarado). Desacoplamento total.

**Sucesso:** o dono consegue, por usuário/papel, dar ou tirar a visão e a edição do varejo e do atacado separadamente, sem mexer na permissão de custos; e ninguém perde acesso no deploy (backfill).

## Decisões travadas (do dono — não reabrir)

- **"preço de venda" = "preço de varejo" = `modelos.preco_venda`.** Atacado = `modelos.preco_atacado` (só comprados).
- **4 permissões, TODAS independentes de `_pode_ver_custos`:** VER varejo, EDITAR varejo, VER atacado, EDITAR atacado.
- **VER (varejo e atacado) = esconder SÓ NA TELA, NÃO trancar a leitura no banco.** Mesmo tratamento que o custo tem hoje (D1 A). Motivo: a leitura de `preco_venda`/`preco_atacado` vem de ~8 selects CRUS de `modelos` (nenhuma RPC mascara); trancar exigiria RLS por coluna em `modelos` — tabela central, no Realtime, com co-edição — alto risco, **DESCARTADO pelo dono**.
- **EDITAR varejo: a chave `criacao_planejamento:preco_venda` JÁ EXISTE e JÁ tranca a escrita no banco** (gatilho `fn_modelo_preco_venda_gate`, hoje em `20261031120000_seg_s1_modelos_guarda.sql`). **MANTER, não duplicar.**
- **EDITAR atacado: NÃO tem gate de escrita no banco hoje.** O `preco_atacado` só muda por recompute derivado (via GUC `app.preco_comprado_sistema`). O spec propõe **estender `fn_modelo_preco_venda_gate`** para travar `preco_atacado` com a nova chave de editar atacado (simetria com o varejo), **sem morder o recompute derivado** (mesmo padrão B1b/GUC que o varejo comprado já usa).
- **BACKFILL:** as 4 chaves novas são concedidas a quem HOJE vê/edita preço, `ON CONFLICT DO NOTHING`, espelhando `20260908280000` (`user_permissions` + `papel_permissoes`) — **ninguém perde acesso no deploy**. O dono ajusta depois quem não deve ter.

---

## Fatos técnicos apurados (mapa do código; arquivo:linha)

### A leitura do preço vem de selects CRUS de `modelos` (não trancável sem RLS por coluna)

`modelos.preco_venda`/`preco_atacado` são LIDOS por ~8 selects crus da tabela e por embeds:
`criacao.planejamento.tsx:430` (+ UPDATE `:294`), `dashboard.tsx:550`, `expedicao.lancamentos.tsx:124`, `otb.index.tsx:107`, `ColecaoSheet.tsx:556`, `usePlanejamentoSave.ts:901`; embeds `modelo:modelo_id(preco_venda…)` em `ProdutoAcabadoSheet.tsx:182`, `ProdutoImportadoSheet.tsx:81`, `PlanTecidoSheet.tsx:504`. `modelos` ESTÁ no `supabase_realtime` (`20260803180000:89-90`); a RLS de `modelos` = `tenant_select` **PERMISSIVE**, **sem** policy RESTRICTIVE de SELECT. Portanto a leitura NÃO é mascarada por RPC nem gated por coluna — **trancar a leitura seria RLS por coluna em `modelos`, descartado**.

### A EXIBIÇÃO hoje segue a permissão de CUSTOS

- `_pode_ver_custos()` (SQL, `20260737100000_permissao_secoes_custo.sql:27-36`) = OR de **5 chaves**: `criacao_planejamento:custos`, `criacao_desenvolvimento:custos`, `producao_terceirizados:precos`, `dashboard_custos`, `dashboard_comercial`. Espelho TS `CHAVES_VER_CUSTOS` em `src/lib/mao-obra.ts:130-136` (anti-drift). `custo_unitario_modelos` mascara o **custo** (não o preço) quando `NOT _pode_ver_custos()`.
- `PlanejamentoDetail.tsx`: `podeVerCustos = canView("criacao_planejamento:custos")` (`:202`); `veCustos = podeVerCustos || ficha.podeVerCustos` (`:535`, união das 2 permissões de custos). **A exibição do preço (varejo) e a Tabela de Preço seguem `veCustos`/`podeVerCustos`** (`:535`, `:587`, `:2092-2107`).
- `PrecoTabela.tsx`: exibe varejo/sugerido/markup/estimativa gated por `podeVerCustos`/`podeEditarPreco` (`:89-91`, `:277`, `:314`, `:372`).
- Produto Acabado/Importado: `ProdutoCard.tsx` usa `podeVerCustosServidor(canView)` (`:164`) para o título com **Varejo + Atacado** (`:885`) e os inputs de markup/preço fixo de **atacado e varejo** (`:911-963`); `ProdutoAcabadoSheet.tsx`/`ProdutoImportadoSheet.tsx` lêem o espelho `modelo.preco_venda`/`preco_atacado`. **Varejo e atacado hoje aparecem/escondem JUNTOS, sob a mesma permissão de custos.**
- Demais pontos de exibição do preço que seguem custos hoje: Plan. Tecido `ModelCard`, Integração `CelulaCampo` (placeholder do preço), Dashboards Comercial/Coleção.

### A ESCRITA do varejo JÁ é trancada no banco

Chave existente `criacao_planejamento:preco_venda` (`permissions-catalog.ts:171`, label "Editar preço de venda", seção de `criacao_planejamento`, **SÓ editar**). O gatilho `fn_modelo_preco_venda_gate` (`20261031120000_seg_s1_modelos_guarda.sql`) já cobre `preco_venda`:
- **Interno:** `preco_venda` mudou E origem ∉ {revenda,importado} E `NOT user_can_edit('criacao_planejamento:preco_venda')` → `42501`.
- **Comprado (B1b):** `preco_venda` mudou E origem ∈ {revenda,importado} E GUC `app.preco_comprado_sistema <> 'on'` E não-sistema → `42501 preco_comprado_derivado` (o recompute derivado liga a GUC; PATCH direto é barrado).
- **S5:** `preco_anterior` usa a MESMA chave `criacao_planejamento:preco_venda`.
- O gatilho **não menciona `preco_atacado`** — hoje não há gate de escrita de atacado.

### O `preco_atacado` só muda por recompute derivado

`preco_atacado` é o preço de atacado dos comprados; é recalculado por `_pa_recomputar_precos_modelo`/`_imp_recomputar_precos_modelo` (ligam a GUC `app.preco_comprado_sistema`). A UI de atacado (markup/preço fixo no `ProdutoCard`) grava via as RPCs de preço do produto, não escreve `preco_atacado` cru pela tela. Edição de atacado na tela hoje depende de `podeEditarPrecoComprado` (`PlanejamentoDetail.tsx:226` = `canEdit('criacao_planejamento:preco_venda') || canEdit('criacao_produto_acabado')`) — ou seja, **o atacado é editável por quem edita o varejo OU a página do produto**; não tem permissão própria.

### Guarda de escrita atual (para o payload do Salvar)

`usePlanejamentoSave.ts:504-515` apaga `preco_venda`/`preco_atacado`/`preco_anterior` do payload quando não há permissão (`aplicarRegrasCamposPlanejamento`). A Integração trava `preco_venda` de produto integrável (`trg_zz_integracao_trava`, `20261007130000:321` — **o varejo trava, o atacado fica livre**).

---

## Modelagem

### As 4 chaves

Reaproveitar a chave existente para editar varejo e criar 3 novas, todas na seção da página `criacao_planejamento` (onde a de preço já mora):

| Permissão | Chave | Novidade | Tranca no banco? |
|---|---|---|---|
| EDITAR varejo | `criacao_planejamento:preco_venda` | **já existe** (label "Editar preço de venda") | **SIM** — `fn_modelo_preco_venda_gate` (manter) |
| VER varejo | `criacao_planejamento:ver_preco_venda` | **nova** | NÃO — só tela |
| EDITAR atacado | `criacao_planejamento:preco_atacado` | **nova** | **SIM** — estender `fn_modelo_preco_venda_gate` (recomendado) |
| VER atacado | `criacao_planejamento:ver_preco_atacado` | **nova** | NÃO — só tela |

**Justificativa dos nomes:** mantêm o prefixo `criacao_planejamento:` das demais seções de preço/custo (`:custos`, `:preco_venda`, `:peca_teste`), o que faz as 4 aparecerem agrupadas sob "Planejamento de Produto" no `PermissoesModal`. `ver_preco_venda`/`ver_preco_atacado` deixam explícito o "ver só na tela"; `preco_atacado` (editar) espelha o `preco_venda` (editar) já existente, mantendo a simetria varejo/atacado nos rótulos do editor. (Alternativa considerada e descartada: `preco_venda:ver`/`preco_atacado:ver` com dois-pontos duplo — o catálogo não usa aninhamento de 2 níveis nas sections; manter 1 nível.)

> **Decisão de arquiteto a validar (1):** se o dono preferir rótulos de tela dizendo "varejo" em vez de "venda" nos LABELS do editor de permissões (as chaves técnicas ficam), é só trocar o `label` — sem efeito funcional. Mantive "preço de venda" nos labels por consistência com a chave já existente.

### Onde entram no `permissions-catalog.ts`

Na seção `criacao_planejamento.sections` (hoje `:custos`, `:preco_venda`, `:peca_teste` — `permissions-catalog.ts:168-174`), acrescentar as 3 novas, mantendo a de editar varejo:

```
sections: [
  { key: "criacao_planejamento:custos",           label: "Custos / Preço" },
  { key: "criacao_planejamento:ver_preco_venda",   label: "Ver preço de venda (varejo)" },
  { key: "criacao_planejamento:preco_venda",       label: "Editar preço de venda (varejo)" },  // já existe
  { key: "criacao_planejamento:ver_preco_atacado", label: "Ver preço de atacado" },
  { key: "criacao_planejamento:preco_atacado",     label: "Editar preço de atacado" },
  { key: "criacao_planejamento:peca_teste",        label: "Peça Teste", hint: "…" },
]
```

As novas keys entram automaticamente em `ALL_PAGE_KEYS` (invariante 12) e no `PermissoesModal`.

### Helpers TS (fonte única, espelhando o padrão de `_pode_ver_custos`)

Criar helpers puros (ex. em `src/lib/preco-permissao.ts`) para que os ~8 pontos de exibição não repliquem lógica:
- `podeVerPrecoVarejo(canView): boolean` = `canView("criacao_planejamento:ver_preco_venda")` (admins furam, como as demais).
- `podeVerPrecoAtacado(canView): boolean` = `canView("criacao_planejamento:ver_preco_atacado")`.
- `podeEditarPrecoVarejo(canEdit): boolean` = `canEdit("criacao_planejamento:preco_venda")`.
- `podeEditarPrecoAtacado(canEdit): boolean` = `canEdit("criacao_planejamento:preco_atacado")`.

> **Nota ortogonalidade:** esses helpers **NÃO** referenciam `_pode_ver_custos`/`CHAVES_VER_CUSTOS`. Exibir o preço passa a depender SÓ das chaves de preço; exibir custo continua dependendo SÓ das chaves de custo. Nenhum ponto pode condicionar preço a `veCustos` nem custo a ver-preço (ver Review Focus).

### Backfill (ninguém perde acesso)

Migration de backfill espelhando `20260908280000` (concede em `user_permissions` + `papel_permissoes`, `ON CONFLICT DO NOTHING`):
- **VER varejo + VER atacado** → a quem HOJE vê preço, isto é, a quem tem qualquer uma das 5 chaves de `_pode_ver_custos` com `ver=true` (o critério atual de exibição do preço). Conceder as duas chaves de VER.
- **EDITAR varejo** já existe (`criacao_planejamento:preco_venda`) — não re-conceder (quem edita varejo hoje continua com a chave).
- **EDITAR atacado** → a quem HOJE edita atacado, isto é, quem tem `criacao_planejamento:preco_venda` OU `criacao_produto_acabado` com `edit=true` (o `podeEditarPrecoComprado` de hoje). Conceder `criacao_planejamento:preco_atacado`.

Conceder tanto em `user_permissions` (exceção do usuário) quanto em `papel_permissoes` (presets por loja), para que papéis que já davam custo/preço passem a dar as novas chaves — senão quem herda do papel perderia preço no deploy. Mesma estratégia de `20260908280000`.

> **Decisão de arquiteto a validar (2):** o backfill de VER usa o critério "vê custos hoje" (as 5 chaves) porque é EXATAMENTE o que hoje decide a exibição do preço na tela. Assim o deploy é transparente (quem via preço continua vendo). Confirmar com o dono que esse é o conjunto certo de quem "ganha ver preço" — ele ajusta depois quem não deve ter.

### Estender o gatilho para o atacado (abordagem recomendada)

Adicionar um ramo em `fn_modelo_preco_venda_gate` para `preco_atacado`, **simétrico ao do `preco_venda`**, cuidando de NÃO morder o recompute derivado do comprado (mesmo padrão B1b/GUC que o varejo comprado já usa):

```
-- [nova] EDITAR atacado: só quem tem a chave nova; o recompute derivado (via GUC) passa.
IF NEW.preco_atacado IS DISTINCT FROM OLD.preco_atacado
   AND coalesce(current_setting('app.preco_comprado_sistema', true), '') <> 'on'  -- recompute derivado passa
   AND NOT v_sistema                                                              -- migration/psql/service_role passa
   AND NOT public.user_can_edit('criacao_planejamento:preco_atacado') THEN
  RAISE EXCEPTION 'Sem permissao para editar o preco de atacado'                  -- ASCII; tela traduz
    USING ERRCODE = '42501';
END IF;
```

Pontos de cuidado:
- O `preco_atacado` só existe em comprados e é SEMPRE derivado pela via `app.preco_comprado_sistema='on'`. Por isso o guard do GUC vem PRIMEIRO (como no B1b do varejo): o recompute legítimo nunca é barrado. A cláusula de permissão só morde um **PATCH direto** do cliente em `preco_atacado` (que hoje não deveria acontecer pela tela — a tela grava via RPC — mas o gate fecha a porta por API, simetria com o varejo).
- `v_sistema` (sem JWT / service_role) continua passando (migration/psql).
- A migration que altera a função **diff-valida** `pg_get_functiondef` antes/depois (invariante "ao alterar função existente, diff-validar") e a guarda md5 do `20261031120000` (o bloco `s1_m2` que confere o md5 da função) deve ser **atualizada/regenerada** junto — senão a pós-condição de outra frente acusa "texto inesperado". **Esta frente muda o corpo de `fn_modelo_preco_venda_gate`, logo tem de regerar o md5 `depois` guardado.**

> **Decisão de arquiteto a validar (3):** trancar o atacado no banco é a opção RECOMENDADA (simetria com o varejo, pedido do dono de "editar atacado" como permissão real). A alternativa — atacado só na tela, sem gate — seria mais barata mas assimétrica e deixaria a edição de atacado destravada por API. Recomendo trancar; confirmar que o dono aceita mexer no corpo do gatilho `fn_modelo_preco_venda_gate` (envolve regenerar o md5 da guarda S1 e rodar em horário calmo — a função é de gatilho em `modelos`, mas `CREATE OR REPLACE FUNCTION` não pega AccessExclusive na tabela, só no catálogo da função; sem DROP TRIGGER, sem trava de auth/storage).

---

## UI — pontos de exibição que trocam de permissão

Regra geral: todo ponto que hoje decide **mostrar o preço** por `podeVerCustos`/`veCustos`/`podeVerCustosServidor` passa a decidir por **`podeVerPrecoVarejo`** (campo de varejo) ou **`podeVerPrecoAtacado`** (campo de atacado), conforme o campo. Custo continua gated por custos. **Distinguir varejo vs atacado em cada ponto.**

### Varejo (`preco_venda`)

- **`PrecoTabela.tsx`** — linha "Preço de venda", sugerido, markup, "fixar à mão": EXIBIR por `podeVerPrecoVarejo` (hoje `podeVerCustos`, `:277`, `:314`); EDITAR por `podeEditarPrecoVarejo` (hoje `podeEditarPreco`, que já é `criacao_planejamento:preco_venda` — mantém). **A estimativa de custo/tecido (`:314`, `:372`) e as faixas de markup (`:324`) continuam gated por custo** (`podeVerCustos`), não por ver-preço — são custo, não preço.
- **`PlanejamentoDetail.tsx`** — onde hoje `veCustos`/`podeVerCustos` decide mostrar o campo de preço de venda e passa a prop à `PrecoTabela` (`:587`, `:2092-2107`): a parte do **preço** passa a `podeVerPrecoVarejo`; as partes de **custo derivado/previsto/estimativa** (`:580`, `:584`, `:2118`) continuam em `veCustos`. `podeEditarPreco` (`:223`) continua `criacao_planejamento:preco_venda` (edição de varejo — mantém).
- **Plan. Tecido `ModelCard`** — o preço do card (varejo) exibido hoje por custos: `podeVerPrecoVarejo`.
- **Integração `CelulaCampo`** — placeholder/exibição do preço de venda: `podeVerPrecoVarejo` (quando for o campo `preco_venda`).
- **Dashboards Comercial/Coleção** — onde mostram preço de venda (Poder de Venda usa `preco_venda`): a EXIBIÇÃO do preço por `podeVerPrecoVarejo`. (Os dados do dashboard vêm de RPCs gated por `user_can_view` de dashboard — ver Review Focus; aqui é só a coluna de preço na tela.)

### Atacado (`preco_atacado`)

- **`ProdutoCard.tsx` (PA/PI)** — hoje o título "Varejo … · Atacado …" (`:885`) e os inputs (`:911-963`) seguem `podeVerCustosServidor`. Separar: a parte **Varejo** por `podeVerPrecoVarejo`, a parte **Atacado** por `podeVerPrecoAtacado`; os inputs de EDITAR atacado por `podeEditarPrecoAtacado` (hoje coberto por `podeEditarPrecoComprado`), os de EDITAR varejo por `podeEditarPrecoVarejo`. Quando faltar uma das duas, mostrar "—" só naquela parte (não esconder o bloco inteiro).
- **`ProdutoAcabadoSheet.tsx` / `ProdutoImportadoSheet.tsx`** — exibição do espelho `modelo.preco_venda` (varejo) e do `preco_atacado`: cada um sob sua chave de VER.
- **`PlanejamentoDetail.tsx` — bloco de preço do comprado** (`PrecoRevendaBloco`, `:686-724`, `:2141-2142`): `podeEditarPrecoComprado` (`:226`) é hoje usado tanto para varejo-comprado quanto para atacado. **Separar a edição do atacado:** EDITAR atacado passa a `podeEditarPrecoAtacado`; EDITAR varejo do comprado continua por `podeEditarPrecoVarejo` (a seção de preço de varejo). A trava da Integração continua só no varejo.
- **ResumoRevendaPanel / Poder de Venda do PA** — exibição de preço de atacado por `podeVerPrecoAtacado`.

### Payload do Salvar (não vaza por API nem perde dado)

`usePlanejamentoSave.ts:504-515` (`aplicarRegrasCamposPlanejamento`) apaga `preco_venda`/`preco_atacado` do payload sem permissão: trocar para apagar **`preco_venda`** quando `!podeEditarPrecoVarejo` e **`preco_atacado`** quando `!podeEditarPrecoAtacado` (independentes). O gate do banco é a rede de segurança; o front omite o campo que a pessoa não pode editar para não gerar `42501` à toa. `preco_anterior` continua colado ao varejo (mesma chave `criacao_planejamento:preco_venda`, invariante S5).

---

## Restrições globais

- **Banco ANTES do site.** Site novo lê as 4 chaves e espera que o backfill já tenha concedido; banco novo com site velho é inofensivo (as chaves novas são ignoradas pelo front antigo, e o gate de atacado só morde PATCH direto — a tela grava por RPC). Deploy PRÓPRIO, separado do lote front corrente.
- **Não é destrutivo:** só ADD de chaves no catálogo, backfill `ON CONFLICT DO NOTHING` e `CREATE OR REPLACE` do gatilho. Nenhum DROP, nenhuma coluna removida.
- **RAISE 5xx só ASCII** não se aplica (o novo `RAISE` é `42501` = 403, que a tela traduz por código/mensagem; ainda assim escrever a mensagem em ASCII, por consistência com o resto do gatilho).
- **Diff-validar** `fn_modelo_preco_venda_gate` antes/depois e **regenerar o md5 `depois`** da guarda S1 (`20261031120000`) que confere essa função — senão a pós-condição acusa "texto inesperado".
- **Leitura continua destravada** (D1 A): os selects crus de `preco_venda`/`preco_atacado` FICAM; só a EXIBIÇÃO na tela passa a respeitar as novas chaves. Gap de leitura por API é DOCUMENTADO, não regressão (igual ao custo hoje, P-230).
- **Volta:** `_down` do catálogo (remover as 3 chaves novas é opcional/inócuo), `_down` do backfill (não precisa reverter — conceder acesso não quebra), e `_down` do gatilho = devolver o corpo ANTERIOR de `fn_modelo_preco_venda_gate` (guardado por md5). LIFO: site → gatilho `_down` → backfill (no-op) → catálogo.
- Invariante 12 (permissão por seção) e invariante 14 (trava da Integração: varejo trava, atacado livre) preservadas.

---

## Review Focus (5 riscos mais prováveis)

1. **Ponto de exibição esquecido que continua mostrando o preço por `veCustos`.** Há ~8 pontos; se um ficar em `podeVerCustos`, um usuário sem ver-preço mas com ver-custo continuaria vendo o preço (fura a ortogonalidade). Mitigar com um helper único (`src/lib/preco-permissao.ts`) e um teste anti-drift que varre os componentes de preço por literal (como o `ui-padroes-antidrift`), além de confirmar os pontos do mapa um a um.
2. **Recompute derivado do comprado quebrando se o gate do atacado morder a GUC.** Se a ordem das cláusulas no gatilho deixar a checagem de permissão ANTES do guard `app.preco_comprado_sistema='on'`, `_pa_/_imp_recomputar_precos_modelo` passaria a falhar `42501`. Mitigar: GUC primeiro (como no B1b do varejo) + teste de integração que roda o recompute como cliente sem a chave de atacado e confirma que passa.
3. **Backfill que não cobre papéis.** Conceder só em `user_permissions` e esquecer `papel_permissoes` faria quem herda do papel perder preço no deploy. Mitigar: espelhar os DOIS alvos de `20260908280000`; Passo 0 (só leitura) conta por loja quem via/edita preço hoje vs. quem fica com as chaves depois — PARE se divergir.
4. **Independência ortogonal mal aplicada.** Condicionar preço a custo (preço some quando custo some) OU custo a preço (custo some quando preço some) — qualquer um viola a decisão. Mitigar: os helpers de preço NÃO tocam `_pode_ver_custos`/`CHAVES_VER_CUSTOS`; teste dos 4 cruzamentos (vê custo/não-vê preço, vê preço/não-vê custo, etc.).
5. **Varejo e atacado colados.** Se o `ProdutoCard`/Sheet esconder o bloco inteiro quando falta UMA das duas permissões (em vez de "—" só na parte faltante), o usuário perde a parte que podia ver. Mitigar: gate por campo (varejo vs atacado separados) e teste de render com cada combinação; e confirmar que a trava da Integração continua só no varejo (atacado livre, invariante 14).

---

## Riscos + mitigações

| Risco | Mitigação |
|---|---|
| md5 da guarda S1 (`20261031120000`) acusa "texto inesperado" após alterar o gatilho | Regenerar o md5 `depois` na mesma migration; diff-validar `pg_get_functiondef`. |
| Front antigo (site velho + banco novo) grava `preco_atacado` cru e toma `42501` | O gate só morde cliente com JWT sem a chave; o front antigo grava atacado por RPC (GUC on) — passa. Banco antes do site minimiza a janela. |
| Usuário que hoje vê preço perde no deploy | Backfill `ON CONFLICT DO NOTHING` das 2 chaves de VER a quem tem qualquer das 5 de custo; Passo 0 confere. |
| Leitura por API continua expondo o preço | Documentado (D1 A, igual ao custo); não é objetivo desta frente trancar leitura. |
| Dois pontos de preço (varejo/atacado) com gate errado cruzado | Helper único + distinção explícita por campo no mapa de UI + testes de cruzamento. |

---

## Arquivos previstos

- **Catálogo:** `src/lib/permissions-catalog.ts` (3 chaves novas na seção `criacao_planejamento`).
- **Helper novo:** `src/lib/preco-permissao.ts` (`podeVerPrecoVarejo`/`podeVerPrecoAtacado`/`podeEditarPrecoVarejo`/`podeEditarPrecoAtacado`, fonte única; espelho das chaves, anti-drift).
- **Banco:** 1 migration que (a) estende `fn_modelo_preco_venda_gate` com o ramo de `preco_atacado` (regenerando o md5 da guarda S1) e (b) o backfill das 4 chaves (`user_permissions` + `papel_permissoes`, `ON CONFLICT DO NOTHING`, espelho de `20260908280000`); inverso em `supabase/rollback/` (devolve o corpo anterior do gatilho; backfill sem reversão). Opcional: Passo 0 só-leitura em `supabase/consultas/`.
- **UI (troca de gate de exibição):** `PrecoTabela.tsx`, `PlanejamentoDetail.tsx` (varejo + bloco comprado), `produto-acabado/ProdutoCard.tsx`, `ProdutoAcabadoSheet.tsx`, `ProdutoImportadoSheet.tsx`, Plan. Tecido `ModelCard`, Integração `CelulaCampo`, Dashboards Comercial/Coleção.
- **Payload:** `usePlanejamentoSave.ts` (`aplicarRegrasCamposPlanejamento`: omitir `preco_venda`/`preco_atacado` por chave independente).
- **Testes:** unit dos 4 helpers + cruzamentos ortogonais (custo × preço); integração (txn revertida) do gate de atacado (recompute derivado passa; PATCH direto sem chave falha; com chave passa); anti-drift que varre os pontos de exibição de preço.
