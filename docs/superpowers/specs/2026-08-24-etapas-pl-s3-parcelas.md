# Etapas PL — S3 (Parcelas de Serviço pelo Prazo do Fornecedor) — Design

**Data:** 2026-08-24 · **Sub-projeto:** Etapas PL / S3 · **Depende de:** S2 (`empresas.prazo_pagamento`, `121bc35`)

## Objetivo

Gerar as parcelas a pagar de serviço externo (`parcelas_servico`) **seguindo o prazo de pagamento do fornecedor** (ex: `"30/60/90"` → 3 parcelas com vencimento **Data Entregue + 30 / + 60 / + 90 dias**), em vez da data única de hoje. Exibir o offset (`+30`, `+60`, `+90`) por parcela na aba Serviços **e** na aba OCs do Financeiro.

## Estado atual (o que já existe)

- `parcelas_servico` (colunas): `id, tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento, status ('a_pagar'|'pago'), data_pagamento, comprovante_url, created_at`. UNIQUE `(producao_terceirizado_id, numero_parcela)`.
- **Geração = sync-then-read** dentro da RPC `servicos_financeiro()` (`SECURITY DEFINER`, chamada ao abrir a aba). Hoje: para cada bloco elegível, `INSERT ... ON CONFLICT DO NOTHING` das parcelas `1..N` (N = `producao_terceirizados.numero_parcelas`) todas com **a mesma** `data_vencimento = COALESCE(data_entregue, data_enviado)`; depois deleta parcelas acima de N que não estejam pagas.
- **Gate de elegibilidade** (não muda): não-oficina → `data_enviado` E `data_entregue` preenchidas; oficina → CQ `confirmado`; **ou** já tem parcela paga (nunca some).
- **Front (`financeiro.tsx` › ServicosView)**: tabela Serviço · Empresa · Parcela `i/N` · Valor · Vencimento (editável) · Pagamento · Status · ações. `PagarDialog` + `AnexarComprovanteDialog` (genéricos, `table="parcelas_servico"`) **já funcionam** — marcar pago com data + comprovante, coluna data de pagamento. **Nada a mudar no marcar-pago.**
- **OC Tecido/Aviamento/P.Acabado**: parcelas (tabela `parcelas`) já usam prazo → `_recalcular_parcelas_core` faz o split `v_dias := regexp_split_to_table(prazo, '[^0-9]+')`, `vencimento = base + v_dias[i]`, rateio com a última absorvendo o resto, netting contra pagas. **É o padrão que S3 espelha** (mas escrevendo em `parcelas_servico`, dentro do `servicos_financeiro`).

## Decisões (confirmadas com o dono)

1. **Onde gerar:** dentro de `servicos_financeiro()` — substituir o seed de data única pelo split do prazo. Sem função nova; mesma mecânica sync-then-read.
2. **Escopo:** **todo serviço externo cujo fornecedor tenha `prazo_pagamento` cadastrado** segue o prazo (oficina, PL, qualquer externo). Serviço **sem** prazo → comportamento atual (N parcelas na data única = Data Entregue). Não é gated por "PL".
3. **Rótulo `+Ndias`:** aba Serviços **e** retrofit na aba OCs.
4. **Prazo mudou depois:** recalcular preservando as pagas — parcelas pagas intactas; recomputa só as não-pagas pelo novo prazo, abatendo o valor pago do total; guarda de no-op se `total<=0` (espelha `_recalcular_parcelas_core`).

## Arquitetura

### DB — `servicos_financeiro()` (CREATE OR REPLACE, diff-validado)

A fonte do prazo é `empresas.prazo_pagamento` via `producao_terceirizados.empresa_id`. A **data-base** é `data_entregue` (fallback `data_enviado`, como hoje).

O bloco de sync (hoje linhas ~28-42 da migration `20260717120000`) muda de "flat single-date" para o algoritmo abaixo, aplicado por bloco elegível `r`:

```
v_prazo  := (SELECT prazo_pagamento FROM empresas WHERE id = r.empresa_id);
v_base   := COALESCE(r.data_entregue, r.data_enviado);   -- já garantido não-nulo pelo gate
v_dias   := ARRAY(SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo,''),'[^0-9]+') t WHERE t ~ '^[0-9]+$');
IF array_length(v_dias,1) >= 1 THEN
    v_n := LEAST(array_length(v_dias,1), 24);            -- prazo manda no nº de parcelas
ELSE
    v_n := GREATEST(COALESCE(r.numero_parcelas,1), 1);   -- sem prazo → comportamento atual
END IF;

-- netting: conta/soma parcelas JÁ PAGAS deste bloco; deleta só as NÃO pagas de numero_parcela > v_n
--          (parcela paga acima de v_n permanece — nunca apaga histórico pago)
-- para i em 1..v_n:
--   se já existe parcela i (paga ou com vencimento manual != base) → CONTINUE (preserva)
--   vencimento_i := CASE WHEN v_dias tem i-ésimo THEN v_base + v_dias[i] ELSE v_base + (i*30) END
--   INSERT (i, vencimento_i) ON CONFLICT DO NOTHING
--   se a parcela i existe mas está a_pagar e nunca foi editada manualmente → UPDATE vencimento_i
```

Regras de preservação (invariante de segurança de dados):
- **Nunca** alterar/deletar parcela `status='pago'` ou `data_pagamento IS NOT NULL`.
- Uma parcela `a_pagar` cujo `data_vencimento` foi editado à mão (difere do que o prazo calcularia) **é preservada** — para não sobrescrever ajuste manual. Detecção: comparar `data_vencimento` atual com o vencimento que o prazo geraria; se difere e não é nulo → não toca. (Espelha o `WHERE data_vencimento IS NULL` de hoje, generalizado.)
- `numero_parcelas` do bloco continua existindo (legado + fallback sem prazo); **não** é dropado.

**Contrato de retorno** de `servicos_financeiro()` ganha 1 campo: `dias_offset int` por parcela (o `v_dias[i]` usado, ou NULL quando caiu no fallback sem prazo) — para o front rotular `+Ndias`. Todo o resto do SELECT permanece.

Diff-validação obrigatória: dump do `pg_get_functiondef` vivo antes; editar só o delta (bloco de sync + a coluna `dias_offset` no SELECT); diff antes/depois mostra só essas mudanças. `CREATE OR REPLACE` (preserva ACL — `servicos_financeiro` tem REVOKE de PUBLIC/anon). `BEGIN;…COMMIT;`.

### DB — parcelas de OC (`parcelas`) ganham `dias_offset` na leitura

Para o rótulo `+Ndias` na aba OCs, a fonte de leitura das parcelas de OC no Financeiro precisa expor o offset por parcela. Duas opções, decidir no plano conforme o código real:
- Se a aba OCs lê de uma RPC → adicionar `dias_offset` ao retorno (mesmo tratamento).
- Se lê direto da tabela `parcelas` → derivar o offset no front por `data_vencimento - data_base` **não é confiável** (base não está na linha). Preferir expor `dias_offset` já persistido/derivado no servidor. O plano confirma a fonte real e escolhe.

`_recalcular_parcelas_core` já **conhece** `v_dias[i]` na hora de inserir — se `parcelas` não tiver coluna de offset, o caminho limpo é **persistir `dias_offset int` em `parcelas`** (ADD COLUMN, gravado no INSERT do core; retro-preenchido = NULL para as antigas, front mostra "—"). Decisão final no plano após ler a estrutura de leitura da aba OCs.

### Front — `financeiro.tsx`

- **ServicosView**: nova coluna/badge "Vencimento" passa a mostrar `data · +Ndias` (ou só a data quando `dias_offset` NULL). Sem novo dialog. `PagarDialog`/`AnexarComprovanteDialog` intactos.
- **Aba OCs**: mesma exibição `+Ndias` por parcela onde hoje mostra só a data.
- Coluna nova de dado fora do `types.ts` → `as any` no ponto de leitura (padrão S2), depois `tsc --noEmit | grep TS2304` + build + anti-drift.

## Fora de escopo (S3)

- Marcar pago / comprovante / data de pagamento — **já existem e funcionam**, sem mudança.
- S4 (anexos de NF), S5 (peça de foto) — sub-projetos próprios.
- Mudar o gate de elegibilidade "após CQ / após Data Entregue" — permanece.

## Riscos

- (a) `servicos_financeiro` é `SECURITY DEFINER` e roda a cada leitura — o novo sync não pode ficar caro nem tocar parcela paga. Guardas de preservação são o ponto crítico do review.
- (b) diff-validação do `pg_get_functiondef` é obrigatória (invariante #2 do CLAUDE.md) — a função é grande.
- (c) detectar "vencimento editado à mão" por comparação de datas pode ter falso-positivo se o prazo mudou; aceitável — na dúvida, **preserva** (não sobrescreve). O dono edita o vencimento manualmente quando quiser.
- (d) `empresa_id` em `producao_terceirizados` precisa estar preenchido para achar o prazo; blocos legados sem `empresa_id` caem no fallback (data única) — sem regressão.
