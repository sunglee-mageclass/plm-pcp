# L9: roteiro do kit (OC de aviamento, P-206 A, P-208 A e P-216 A)

Ordem no kit combinado: banco ANTES do site. A L9 entra depois da L8; a volta é LIFO.

Regras gerais:
- Toda consulta de prévia roda em `BEGIN READ ONLY; … ROLLBACK;`.
- Toda aplicação é `psql -v ON_ERROR_STOP=1 -f <arquivo>`, fora de transação.
- Horário calmo.

## Ida

1. **Passo 0** (só leitura). Confere o md5 das 5 funções provisórias:
   - `gerar_parcelas_oc_aviamento` `e9864019`;
   - `_dashboard_financeiro_core` `49b55c7b`;
   - `_salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)` `3c5a3d10`;
   - `recalc_parcelas_aviamento_on_item` `a9192183`;
   - `fn_colab_bump_oc_avi` `acab05e5`.

   Confere também `_recalcular_parcelas_core` = `3dcb59e6` (o "depois" da R16).

   Roda também (fix round 3, R1) `supabase/consultas/l9_passo0_pre_ida.sql` e `supabase/consultas/l9_preco_previa.sql`,
   as duas ANTES da ida (funcionam sem a coluna `preco`).
   - Motivo: com a P-216 A, a ida SOZINHA já muda o valor de itens antigos sem preço cuja cor tem preço próprio > 0
     diferente do geral. O "investido" do Dashboard Financeiro muda na hora, e as parcelas não pagas das OCs recebidas
     mudam no próximo recálculo.
   - **PARA ANTES da ida e pergunta ao dono** se qualquer um destes for > 0:
     - em `l9_passo0_pre_ida.sql`: `itens_receb_cor_dif` ou `ocs_parcelas_mudam` (mostrar também `dif_total_reais`);
     - em `l9_preco_previa.sql`: `avi_cor_dif_geral` ou `avi_ocs_parc_mudam`.
   - Na cópia 54422 (02/out) tudo dá 0: nenhum item de OC tem cor escolhida.
2. **Ida da L9:** `supabase/migrations/20261029100000_oc_aviamento_preco.sql`.
   - O ADD COLUMN pega uma AccessExclusive curta em `ocs_aviamento_itens`; o arquivo usa `lock_timeout` de 500 ms.
   - Em `55P03`, tentar até 3 vezes.
3. **Prévia:** `supabase/consultas/l9_preco_previa.sql`. Mostrar a linha inteira ao dono. **PARA e pergunta ao dono** se:
   - `avi_ocs_parc_mudam > 0`: OC de aviamento recebida cujas parcelas mudariam para o preço de hoje;
   - `tec_ocs_total_muda > 0` (fix round 1, M1): OC de tecido (não rolo) recebida cujo `valor_real_total` não bate com o
     total pelo preço congelado. Depois da correção, o próximo alerta/troca ou re-save refaria o cabeçalho e as parcelas
     não pagas;
   - `tec_modelos_custo_muda` / `tec_custo_dif_max` (L2) não são pequenos (na cópia: 1 modelo, R$ 0,01). O dono aprova
     esses números ANTES.
4. **Correção única**, só com a prévia aprovada:

   ```
   psql -v ON_ERROR_STOP=1 \
     -c "SET app.l9_esperado_avi='<avi_congelar>'" \
     -c "SET app.l9_esperado_tec='<tec_congelar>'" \
     -c "SET app.l9_esperado_tec_ocs_total_muda='<tec_ocs_total_muda>'" \
     -f supabase/migrations/20261029110000_oc_preco_congelar_correcao_unica.sql
   ```

   - O arquivo reconta com as linhas travadas e recusa se algo mudou.
   - Guardar o NOTICE.
5. **Prévia de novo:** tudo 0, menos `avi_sem_cor_2mais` (a FRANJA, que só gera aviso).
6. **Site.**

## Volta (LIFO)

1. **Site** primeiro.
2. **Retrato antes da volta da L9**, para o caso de reaplicar depois (L1):

   ```
   \copy (select id, aviamento_id, variante_aviamento_id from ocs_aviamento_itens where preco is not null) to 'l9-itens-pre-down.csv' csv header
   ```
3. **Volta da correção:** `supabase/rollback/20261029110000_oc_preco_congelar_correcao_unica_down.sql`.
   - Devolve NULL só onde o preço ainda é o congelado.
   - Rodar de novo não faz nada.
4. **Volta da L9:** `supabase/rollback/20261029100000_oc_aviamento_preco_down.sql`.
   - A coluna fica.
   - Rodar de novo recusa com P0001.
   - Roda ANTES da volta da R16 (`20261026100000_down`), da `20261002100000_down` e da release 9.
5. **Opcional, só com decisão do dono:** `20261029100000_oc_aviamento_preco_down_drop.sql`.
   - **Perde os preços da compra.**
   - Antes, fazer `\copy` dos preços.
   - Exige `SET app.confirmo_apagar_preco_oc_aviamento='sim'`.

## Reaplicar a ida depois de uma volta (L1)

Com o core antigo no ar, um save pode trocar o aviamento ou a cor de um item sem tocar o preço (R2). Antes de reaplicar a
`20261029100000`:

1. Carregar o retrato e listar os itens cujo aviamento ou cor mudou:

   ```
   CREATE TEMP TABLE _l9_pre_down (id uuid, aviamento_id uuid, variante_aviamento_id uuid);
   \copy _l9_pre_down from 'l9-itens-pre-down.csv' csv header
   ```

   Em seguida, rodar `supabase/consultas/l9_reaplicar_checagem.sql`.
2. Mostrar a lista ao dono e, com o OK dele:

   ```
   UPDATE public.ocs_aviamento_itens SET preco = NULL WHERE id IN (<ids>)
   ```

   Com NULL, o item vale o preço do cadastro da seleção atual: a cor com preço > 0, senão o geral do aviamento.
3. Sem o CSV: usar a consulta alternativa do cabeçalho do mesmo arquivo (preço ≠ cadastro atual pela regra cor > 0, senão geral) e conferir item a item.
4. Só então reaplicar a ida. Depois, prévia e correção, como nos passos 3 e 4 da ida.
