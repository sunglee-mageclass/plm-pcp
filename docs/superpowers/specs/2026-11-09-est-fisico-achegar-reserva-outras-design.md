# EST = físico + a-chegar − reserva de OUTRAS coleções + resumo AO VIVO (Plan. Tecido)

> Desenho para aprovação do dono ANTES de qualquer código. Frente de RISCO ALTO: mexe na
> conta de COMPRA da RPC viva `_plan_tecido_previa_pedido_core`, com tecido compartilhado
> entre coleções. NÃO toca o `_estoque_tecido_core` (SSOT, invariante #4).
>
> **Duas mudanças na mesma RPC (dono 09/nov):** (1) o EST passa a ser físico + a-chegar − reserva
> de outras coleções; (2) o resumo lateral recalcula AO VIVO sobre o rascunho não-salvo (hoje só
> atualiza depois do Salvar). As duas compartilham a prévia, por isso vão juntas.

## Problema (relatado pelo dono, 09/nov)

No Modo Plano do Plan. Tecido, a coluna **EST não bate com a intuição**. Caso concreto: forro
KOLONA SPANDEX mostrava **EST = 528,4** enquanto o hover dizia "Disponível (real): 0 m / A chegar
(pedido): 1.170 m". O dono: *"se tenho pra chegar 1.170 mas meu EST está 528,4, algo está errado"*.

**Causa raiz (confirmada no código):** a coluna EST = `estoque_m` da prévia = `previsto` do
`_estoque_tecido_core`, cuja fórmula é:

```
fisico   = GREATEST(0, recebido − baixa)
previsto = fisico + prev_receb − reservado
```

Para o forro: `previsto = 0 + 1.170 − 641,6 = 528,4`. Ou seja, há **641,6 m reservados** por cards
que consomem esse forro. O `previsto` desconta **TODA** a reserva — **inclusive a da própria
coleção** que o usuário está planejando. Com o tecido compartilhado entre coleções, isso tem dois
defeitos: (1) desconta a própria coleção, que o PLAN já vai cobrar de novo (conta dobrada contra o
usuário); (2) não deixa claro por que `físico + a-chegar` não bate com o EST.

## Objetivo

A coluna **EST passa a mostrar o que está LIVRE para ESTA coleção**:

```
EST_livre = físico + a-chegar − reserva de OUTRAS coleções
SOB       = max(0, EST_livre − PLAN)
COMPR     = max(0, PLAN − EST_livre)
```

onde `reserva de OUTRAS coleções = reservado_total (do core) − reserva desta coleção`.

Isso resolve os dois defeitos: o EST deixa de descontar a própria coleção (acaba a conta dobrada)
mas **continua respeitando o que outras coleções já reservaram** (não deixa duas coleções
comprarem a menos do mesmo tecido compartilhado).

## Decisões travadas (do dono, 09/nov)

1. **Tecido/forro É compartilhado** entre várias coleções → `EST = físico + a-chegar` PURO está
   descartado (duas coleções veriam o mesmo total e comprariam a menos). Tem de descontar a reserva
   das OUTRAS.
2. **EST = físico + a-chegar − reserva de OUTRAS coleções** (não desconta a própria).
3. **Cards SEM coleção contam como "outra coleção"** (descontam do EST) — o mais conservador.
   Operacionalmente: "reserva desta coleção" = só cards com `colecao_id = _colecao_id`; tudo que
   não é desta coleção (outras + avulsos) cai em "outras" por subtração.
4. **Calcular na própria prévia, SEM tocar o `_estoque_tecido_core`** (Opção A). Risco de drift
   coberto por anti-drift.
5. **Hover do EST = 3 linhas:** "Disponível (real): X / A chegar (pedido): Y / Reservado por
   outras coleções: Z". O EST = X + Y − Z fica explícito.
6. **Resumo lateral AO VIVO:** o resumo recalcula sobre o rascunho não-salvo (linha nova + EST, SOB,
   COMPR corretos) ANTES do Salvar — hoje só atualiza depois de salvar (ver Parte 5).

## Contexto do código (mapeado, read-only)

- **Core (SSOT, NÃO tocar):** `_estoque_tecido_core(_tenant)` devolve por variante `prev_receb_m`,
  `recebido_m`, `baixa`, `reservado`, `fisico`, `previsto`. Corpo vivo em
  `supabase/migrations/20261025100000_estoque_rolo_parcial_e_painel.sql` (md5 pinado `9140c253`,
  re-exigido pelo r11 `20261103199200`). A CTE `reserva_mod` calcula `reservado` por variante
  juntando `modelo_tecido_variantes mv` → `modelo_tecidos mt` → `modelos m` (filtra reprovado no
  Dev/Planejamento e card já enviado ao corte), **agrupando SÓ por `variante_tecido_id`** — a
  coleção (`modelos.colecao_id`) existe no JOIN mas some no agregado.
- **Prévia (a mudar):** `_plan_tecido_previa_pedido_core(_colecao_id uuid, _tenant uuid, _slot_ids
  uuid[])`. Já conhece `_colecao_id`. Monta por variante: `nec_m` (necessidade), `estoque_m`
  (= `GREATEST(0, previsto − rolo_m)`), `deficit_m` (cobertura própria/não-própria), e desde a F3
  também expõe `recebido_m`, `prev_receb_m`, `fisico_m`. Corpo vivo em
  `supabase/migrations/20261115100000_f3_resumo_transparencia.sql` + F3.1
  `20261116100000`. É **aditiva via CREATE OR REPLACE com guarda md5** (anti-drift prova deficit/
  estoque/qtd idênticos). md5 chain atual termina em `dd563e57` (F3.1 papel).
- **Espelho TS:** `src/lib/plan-tecido/calc.ts` (tipo `PreviaCoberturaRpc`), consumido por 7
  componentes: `ResumoPanel`, `SlotOcHint`, `PlanTecidoDrawer`, `PlanTecidoSheet`, `ModoPlanoView`,
  `FazerPedidoWizard`, e `calc.ts` próprio.
- **⚠️ `FazerPedidoWizard` usa `deficit_m` e `qtd` (= `ceil(deficit_m/…)`) como a QUANTIDADE
  pré-preenchida da OC** (linhas 61/64/90). Mudar `deficit_m` muda a quantidade sugerida de
  compra — é o ponto de maior risco: a conta tem de estar certa, não só a exibição.

## Arquitetura

### Onde a mudança mora

Uma só migration (CREATE OR REPLACE da prévia, aditiva, guarda md5), mais o espelho TS e o
ModoPlanoView. O core NÃO muda.

### Parte 1 — reserva desta coleção, na prévia (SQL)

Adicionar à `_plan_tecido_previa_pedido_core` uma CTE `reserva_desta_colecao` que aplica **a MESMA
fórmula da `reserva_mod` do core** (consumo × (1+perda) × grade[regra tecido1/complementar] ×
multiplicador; pula reprovado no Dev/Planejamento e card com `cad.enviado_corte`), mas com o filtro
extra `m.colecao_id = _colecao_id`, agrupando por `variante_tecido_id`.

Então, por variante:
```
reserva_total   = _estoque_tecido_core.reservado        (já disponível na CTE `est`)
reserva_desta   = COALESCE(reserva_desta_colecao.m, 0)
reserva_outras  = GREATEST(0, reserva_total − reserva_desta)
livre_m         = GREATEST(0, fisico_m + prev_receb_m − reserva_outras)
```

### Parte 2 — o que a prévia EXPÕE (contrato novo)

A prévia ganha 3 chaves novas por linha de `cobertura`, SEM remover nenhuma existente (aditivo):
- `reserva_outras_m` numeric — a reserva de outras coleções (para o hover).
- `livre_m` numeric — `físico + a-chegar − reserva_outras` (o novo EST).
- (`reserva_desta_m` numeric — opcional, só se útil ao anti-drift; não exibido.)

**As chaves EXISTENTES `estoque_m`, `deficit_m`, `qtd` continuam com a conta de HOJE** — ver Parte 4
(decisão de migração do comportamento).

### Parte 3 — exibição (ModoPlanoView + hover)

- A coluna **EST passa a mostrar `livre_m`** (era `estoque_m`).
- **SOB** = `max(0, livre_m − nec_m)`.
- **COMPR** = `max(0, nec_m − livre_m)`.
- **Hover do EST (3 linhas):** "Disponível (real): `fisico_m` / A chegar (pedido): `prev_receb_m` /
  Reservado por outras coleções: `reserva_outras_m`".

### Parte 4 — o FazerPedidoWizard (a conta de compra) — DECIDIDO (4b, dono 09/nov)

A mudança NÃO é só visual: **a compra sugerida também passa a usar a conta nova**. Decisão do dono
(09/nov): "mudar os dois — EST exibido E a compra sugerida".

**⚠️ Descoberta técnica (09/nov) — a correção é MAIS cirúrgica do que "deficit = nec − livre":**
o `deficit_m` de HOJE **não parte do `estoque_m`/`previsto`**. Ele parte da necessidade e desconta
**OC própria/não-própria + rolo próprio/não-próprio** (menos a necessidade dos slots não
selecionados):
```
deficit_m = max(0, nec
  − crédito_próprio (OC própria + rolo próprio − nec dos slots não selecionados)
  − OC não-própria
  − rolo não-próprio)
```
Ou seja: a conta de compra já está, em parte, protegida — ela desconta OC/rolo, não o `previsto`
contaminado pela reserva. O defeito do dono está em `estoque_m` (que usa `previsto` e desconta a
reserva da própria coleção), NÃO necessariamente em `deficit_m`.

**Por isso, a reconciliação do `deficit_m` exige INVESTIGAÇÃO na cópia local ANTES do plano fechar:**
é preciso rastrear se, e onde, a reserva da própria coleção contamina o déficit (via `estoque_m`
usado em algum ponto do fluxo de compra, ou via a cobertura não-própria). Duas sub-opções a
confirmar com o dado real:
- **(4b-i)** o `estoque_m` (livre) ENTRA no desconto do déficit: `deficit = max(0, nec − livre_m −
  créditos de OC/rolo que já não estão no físico)`. Exige cuidado anti-dupla-contagem: OC já
  recebida está no físico; OC encomendada está no `prev_receb` (a-chegar, dentro do `livre_m`); o
  crédito explícito de OC/rolo da conta atual não pode somar de novo o que o `livre_m` já conta.
- **(4b-ii)** manter a estrutura do déficit atual e só trocar a parcela de estoque que ela usa,
  garantindo que a reserva da própria coleção pare de descontar.

A decisão entre (4b-i) e (4b-ii) sai da investigação na cópia (qual caminho não dupla-conta OC/rolo
nem compra a menos). A `qtd` (quantidade pré-preenchida da OC) deriva do `deficit_m` final pela
mesma regra de arredondamento de hoje. A coluna COMPR do Modo Plano = `deficit_m` final = o que o
`FazerPedidoWizard` pré-preenche (exibição e compra COERENTES).

Como muda a QUANTIDADE comprada, é o item de maior risco da prova: mostrar, tecido a tecido, onde a
quantidade muda, provar que não compra a menos em loja com tecido não compartilhado, e que rolo
vinculado (`rolo_supply`) e OC já vinculada (já no `previsto`/`prev_receb`) seguem abatendo UMA vez
só — nunca 2×.

### Parte 5 — resumo lateral AO VIVO sobre o rascunho (dono 09/nov)

**Problema:** hoje o resumo lateral (Modo Plano) lê de `plan_tecido_previa_pedido(_colecao_id)`, que
calcula tudo do estado SALVO no banco. Por isso cor/item novo só aparece no resumo DEPOIS do Salvar.
O dono quer ver a linha nova E os números (EST, SOB, COMPR) corretos ANTES de salvar.

**Arquitetura escolhida (opção B — combinação cliente+servidor; a mais barata e segura):** separar o
que muda com o rascunho do que não muda.

- **A NECESSIDADE (PLAN) é calculada no CLIENTE, ao vivo, do rascunho.** O `calc.ts` já tem
  `necessidadeVariante(consumo, grade_total, multiplicador)` — a MESMA fórmula do `nec_m` do servidor.
  Então, ao adicionar/editar cor/consumo/grade, o PLAN por variante recalcula na hora, sem ida ao
  servidor.
- **O ESTOQUE e a RESERVA DE OUTRAS coleções vêm do SERVIDOR, por variante, e NÃO dependem do
  rascunho** (são estado do banco). A prévia passa a expor por variante: `fisico_m`, `prev_receb_m`,
  `reserva_outras_m` (já na Parte 2). Esses ficam em cache (React Query) e só reconsultam quando o
  estoque/OC muda de verdade — não a cada tecla.
- **O FRONT COMBINA ao vivo:** `EST_livre = fisico_m + prev_receb_m − reserva_outras_m` (servidor);
  `PLAN = Σ necessidadeVariante do rascunho` (cliente); `SOB = max(0, EST_livre − PLAN)`;
  `COMPR = max(0, PLAN − EST_livre)`. Tudo recalcula ao editar, sem Salvar.

**Por que B e não "mandar o rascunho inteiro pra RPC a cada tecla" (opção A):** a parte que muda ao
editar (necessidade) já é calculável no cliente; só o estoque/reserva precisa do servidor e NÃO
muda com o rascunho. B evita mandar a árvore inteira a cada edição e evita debounce de rede.

**Fonte única preservada:** a necessidade do cliente (`necessidadeVariante`) e a do servidor (`nec_m`)
são a MESMA fórmula — anti-drift já exigido no Plan. Tecido garante isso. A reserva de outras e o
estoque seguem só no servidor. O resumo ao vivo NÃO reimplementa estoque/reserva no cliente.

**Limite consciente:** enquanto o rascunho não é salvo, a reserva de OUTRAS coleções não "enxerga"
as mudanças deste rascunho (elas ainda não existem no banco) — o que é correto: o rascunho não-salvo
não reserva nada ainda. Ao salvar, a reserva se materializa e o servidor reconsulta.

## O que NÃO entra

- Não tocar o `_estoque_tecido_core` nem nenhum outro consumidor dele (estoque, dashboard, detalhe).
- Não mudar a reserva da própria coleção na reserva de estoque real (o core segue descontando tudo;
  é só a EXIBIÇÃO/compra da prévia que passa a separar própria × outras).
- Não mexer no cálculo de rolos vinculados (`rolo_m`/`rolo_supply`), que seguem como hoje.

## Riscos / cuidados

- **MAIOR RISCO — comprar a menos:** se a "reserva desta coleção" for superestimada, a
  `reserva_outras` fica pequena, o EST fica alto e COMPR fica baixo → compra a menos. A prova tem de
  cobrir: tecido usado por 2+ coleções, card desta coleção reprovado (não reserva), card desta
  coleção já cortado (não reserva mas consumiu), e variante sem reserva nenhuma.
- **Drift (Opção A):** a fórmula da reserva fica em 2 lugares (core `reserva_mod` + prévia
  `reserva_desta_colecao`). Anti-drift obrigatório: provar que, somando todas as coleções,
  `Σ reserva_desta_colecao (por coleção) = reserva_mod do core` por variante (tolerância 0,0001 m).
  Se a regra da reserva mudar no core, este teste falha e obriga a atualizar a prévia junto.
- **Conta de compra (Parte 4):** se (4b), a prova tem de mostrar que a OC gerada não muda para menos
  em nenhuma loja onde o tecido NÃO é compartilhado (lá, reserva_outras = reserva fora desta coleção,
  que pode ser legítima) — e documentar os casos onde muda de propósito.
- **md5 anti-drift da prévia:** a mudança quebra o md5 pinado (`dd563e57`); a ida aceita o novo e os
  2 testes que pinam (`plan-tecido-*`, `saldo-item-regra-core`) precisam do novo md5.
- **Reprovado/cortado:** a `reserva_desta_colecao` tem de usar EXATAMENTE os mesmos filtros da
  `reserva_mod` (reprovado no Dev OU Planejamento não reserva; card `enviado_corte` não reserva) —
  senão `reserva_desta` diverge de `reservado_total` e a subtração fica errada.

## Verificação

- **Unit (TS):** o ModoPlanoView monta EST=`livre_m`, SOB e COMPR das 3 chaves; o hover mostra as 3
  linhas.
- **Integração (cópia local, txn revertida):**
  - Caso base: variante usada por 1 coleção só → `reserva_outras = 0` → `livre_m = físico + a-chegar`.
  - Compartilhado: variante em 2 coleções → `livre_m` da coleção A desconta a reserva da B e
    vice-versa; a soma não conta o mesmo metro 2×.
  - Reprovado desta coleção não entra em `reserva_desta` (nem no core) → `reserva_outras` correta.
  - Cortado desta coleção não reserva (core e prévia batem).
  - **Anti-drift:** `Σ_colecoes reserva_desta = reservado_total` por variante (tol. 0,0001).
  - Se (4b): `deficit_m`/`qtd` novos = `max(0, nec − livre_m)` provados contra casos de compra.
- **Resumo ao vivo (Parte 5):**
  - Unit: ao adicionar cor/consumo/grade no rascunho, o PLAN por variante recalcula no cliente e o
    EST/SOB/COMPR combinam com `fisico_m`/`prev_receb_m`/`reserva_outras_m` do servidor, SEM salvar.
  - Anti-drift: a `necessidadeVariante` do cliente = `nec_m` do servidor para o mesmo rascunho salvo.
  - A linha nova aparece no resumo antes do Salvar; ao salvar, o servidor confirma os mesmos números.
- **QA na prévia (localhost:5190):** o caso do forro KOLONA SPANDEX passa a mostrar EST coerente com
  o hover (3 linhas); adicionar uma cor nova mostra a linha e os números no resumo ANTES de salvar;
  o dono confere antes do deploy.
- `npm run build` + `tsc --noEmit`; code-reviewer; guardião (migration em RPC viva de compra).
- Banco ANTES do site (a prévia nova expõe chaves que o front novo lê).
