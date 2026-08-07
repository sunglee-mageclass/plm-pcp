# Colaboração multi-usuário no PCP Serviços + CQ (rev + merge 3-vias) — Design (aprovado)

**Objetivo:** proteger contra lost-update no PCP Serviços e no CQ, que hoje são last-write-wins sem rev. O desafio novo (vs as 4 telas colab existentes): as DUAS telas compartilham o `grade_detalhe` do bloco-fonte (feature Grade Cortada) — o recebido/defeito é o mesmo dado. Estender o padrão colab existente (`useColabRegistro`/`mergeDraft`/`mergeLinhas`/`ColabBanner` + `rev`/`_rev_base`/P0409) com grão fino por-tabela e um merge novo por-célula da grade.

## Contexto atual (verificado)

- `rev` existe só em `modelos` e `ocs_tecido` (raízes do colab das telas quentes — ver [[project_colab_concorrencia]]). `producao_terceirizados`, `controle_qualidade`, `cad`, `cad_grades` NÃO têm `rev`.
- `salvar_terceirizados(_cad_id, _blocos jsonb, _observacoes_molde)` e `salvar_cq(_cad_id, _cq, _variantes, _reais, _confirmar)` são chaveados por `_cad_id`, sem `_rev_base`.
- Bloco-fonte (Grade Cortada): 1 `producao_terceirizados` por modelo; `_salvar_cq_core` grava recebida/defeito no `grade_detalhe` DELE e deriva a Grade Real (fonte única). Logo o `grade_detalhe` compartilhado É uma linha de `producao_terceirizados` — seu `rev` de bloco coordena as duas telas.
- Infra colab reusável: `useColabRegistro` (`@/hooks`), `mergeDraft`/`mergeLinhas`/`igual` (`@/lib/colab/merge`), `ColabBanner`, `POR_CODIGO.P0409` (`erro-mensagem.ts`), padrão trava tenant-uniforme com bypass `is_super_admin()`.

## 1. Onde ficam os `rev`

- **`producao_terceirizados.rev int not null default 0`** (por bloco) — cobre edições de bloco do PCP E o `grade_detalhe` compartilhado (inclusive o do bloco-fonte que o CQ grava). Trigger `fn_colab_touch_rev` (padrão existente) a cada UPDATE.
- **`controle_qualidade.rev int not null default 0`** (por cad) — cobre o que é só do CQ (status, datas, `cq_variantes`). Bump no UPDATE de `controle_qualidade`; bump também quando `cq_variantes` do cad muda (trigger de filho, como o padrão `fn_colab_bump_*`).
- Migração aditiva (colunas default 0); realtime publication das duas tabelas (para o `postgres_changes`).

## 2. Saves com `_rev_base` (trava otimista)

- **`salvar_terceirizados`** ganha `_rev_base jsonb` = `{ bloco_id: rev }` por bloco existente. Para cada bloco no payload que já existe: se `rev` atual ≠ `_rev_base[bloco_id]` → **RAISE P0409** (mensagem PT com o bloco). Bloco novo (sem id) não trava. Bumpa `rev` dos blocos tocados. `_rev_base: null`/ausente = bypass (compat + super_admin).
- **`salvar_cq`** ganha `_rev_base jsonb` = `{ cq: rev_controle_qualidade, fonte: rev_bloco_fonte | null }`. Checa OS DOIS: se `controle_qualidade.rev` ≠ `_rev_base.cq` OU (há bloco-fonte E `producao_terceirizados.rev` do fonte ≠ `_rev_base.fonte`) → **P0409**. Bumpa `controle_qualidade.rev` sempre e o `producao_terceirizados.rev` do fonte quando grava o `grade_detalhe`. Modelo sem bloco-fonte: só checa/bumpa o `cq`.
- Trava tenant-uniforme com bypass `is_super_admin()`; ERRCODE P0409; a atomicidade e as guardas atuais (#6, [C1], gate de módulo) preservadas byte-a-byte fora do trecho do rev-check. `_core` REVOKE dos três mantido.

## 3. Front — merge 3-vias nas duas telas

- **PCP Serviços** (`pcp.servicos.$modeloId.tsx`) e **CQ** (`expedicao.cq.$modeloId.tsx`): cada um adota `useColabRegistro` (canais `colab:pcp-servico:{cad_id}` e `colab:cq:{cad_id}`; presença de quem está na tela + campo focado, sem conteúdo do rascunho; `postgres_changes` UPDATE nas linhas relevantes → refetch) + `<ColabBanner>` (lista genérica de conflitos com "manter meu · usar o novo").
- Estado colab por campo tocado (`touchedRef`), refs-espelho (`draftLiveRef`) e retry P0409 síncrono no `onError` — o padrão já provado (retry lê `qc.getQueryData` + refs DENTRO do onError, nunca via useEffect; guard de no-op no effect). `setDraftTracked`/`setItemsTracked` como únicos caminhos de escrita.
- **Merge do `grade_detalhe` (peça NOVA)** — helper puro `mergeGrade(base, meu, fresh, tocadas)` em `src/lib/colab/merge-grade.ts`: itera por (variante_tecido_id × tamanho × campo ∈ {enviada,cortada,recebida,defeito}); célula/campo NÃO tocado por mim + mudou no servidor → adota o fresh; tocado por mim + mudou no servidor + valores divergem → conflito `{path: "grade:{vid}:{tam}:{campo}", meu, dele}`. Usa `igual()` do merge existente. Unit-testado (adoção automática, conflito, null≈ausente=0, campo tocado-sem-mudança-alheia).
- Rótulos de conflito PT (`ROTULO_CONFLITO`) cobrindo os campos escalares de cada tela + `grade:*` (ex.: "Recebida · PRETO · M").

## 4. Comportamento do overlap (a razão de existir)

- PCP edita preço/data enquanto CQ conta grade → sem conflito (revs e áreas diferentes).
- Os dois tocam a MESMA célula de recebido/defeito (um no PCP, outro no CQ) → conflito real avisado no banner.
- CQ grava recebido → o bloco-fonte bumpa `rev` → o PCP aberto refaz o merge e vê o número fresco (campo não-tocado atualiza sozinho).

## 5. Escopo, retrocompat, segurança

- Cobre 2 usuários na MESMA tela E cross-tela (PCP↔CQ).
- Modelo sem grade destrinchada: colab ainda protege blocos/CQ; sem overlap de grade (o `_rev_base.fonte` é null, só o `cq` trava).
- Nada muda a jusante (grade real/Direcionamento/#10). O canal de presença não passa por RLS (payload inofensivo). Bumps FOR EACH ROW em saves grandes (muitos blocos) — observar (nota das adoções anteriores).

## Testes

- Integração transacional: save com `_rev_base` velho → P0409 (PCP por bloco; CQ por cada um dos dois lados); save concorrente de áreas distintas → ambos passam; CQ grava recebido → bloco-fonte bumpa; super_admin bypassa; `_rev_base:null` bypassa.
- Unit: `mergeGrade` (adoção/conflito/igualdade), rótulos de conflito.
- QA 2-contexts (mesmo usuário, 2 abas) nas duas telas + cross-tela.

## Fora de escopo (YAGNI)

Presença com avatares ricos; lock pessimista; merge de campos que nenhuma das telas edita; estender colab a outras telas de produção (CAD, Direcionamento já tem sua trava, Oficina) — só PCP Serviços + CQ nesta rodada.
