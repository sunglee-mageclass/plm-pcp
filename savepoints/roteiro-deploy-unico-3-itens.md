# Roteiro do DEPLOY ÚNICO — Peça Teste por TIPO + Botões Regerar REF/SKU + Exportar dados na sidebar

Para o controlador publicar NO PAINEL (mensagem fixada, atualizada no lugar) — nunca no chat. Quem RODA é o DONO, em PRODUÇÃO.
Este roteiro publica as TRÊS frentes juntas, num deploy só:
  1. Reforma da Peça Teste por tipo — migrations `20261129100000..140000` (5).
  2. Botões Regerar REF/SKU — migrations `20261201100000..120000` (3).
  3. Exportar dados na sidebar (permissão própria) — migration `20261201130000` (1).
As três são independentes entre si (nenhuma lê objeto da outra), mas a ORDEM de aplicação é fixa — Peça Teste → Regerar → Exportar —
e a volta é o inverso (LIFO: Exportar sai primeiro, Peça Teste por último). **Banco ANTES do site.** O horário só é perguntado ao dono
quando ensaio, revisão e QA das três frentes estiverem fechados. A `20261122100000_exportar_dados` (a tela/RPC de Exportar, SEM
permissão própria) é PRÉ-CONDIÇÃO: já em produção desde 11/nov; o Passo 0 (G) confere; se faltar, entra ANTES da Peça Teste (ver 2-pré).

```text
DEPLOY ÚNICO — PEÇA TESTE (20261129*) + REGERAR (20261201100000..120000) + EXPORTAR (20261201130000) — banco ANTES do site; PRODUÇÃO

0) PASSO 0 (SÓ LEITURA, ANTES de tudo; nada grava; rodar os dois e colar a saída no painel):
   psql "$(cat /tmp/dburl.txt)" -f supabase/consultas/peca_teste_tipo_passo0.sql
   psql "$(cat /tmp/dburl.txt)" -f supabase/consultas/regerar_passo0.sql
   0a) LINHA DE BASE de produção — por OBJETO (produção é aplicada por psql -f e NÃO tem supabase_migrations.schema_migrations; max(version) não serve). Já estão no regerar_passo0.sql (só SELECT):
       (G) "Exportar dados" (base, 20261122100000) — select to_regprocedure('public.exportar_produtos(text,text,text[],text[],integer)'), to_regprocedure('public.exportar_subcolecoes(text)');
           Esperado: os 2 nomes. Se vier NULL: aplicar 20261122100000_exportar_dados ANTES da Peça Teste (ver 2-pré); o _down dela é 20261122100000_exportar_dados_down.sql e NÃO está na volta LIFO deste kit (frente anterior; desfazer só se o dono mandar, DEPOIS dos downs abaixo).
       (G2) EXPORTAR-PERMISSÃO (20261201130000, a desta frente) — AINDA NÃO em produção (entra agora): select to_regprocedure('public._exportar_exige()') as deve_ser_null;
           Esperado: NULL (a função nova ainda não existe). Se já existir, PARE e chame o controlador (deploy repetido / estado inesperado).
       (H) Pré-condições 20261124..20261128 (14 linhas, todas "sim") + os 8 textos que a Peça Teste troca (coluna "estado" = "ANTES ok"; "DEPOIS (já aplicada)" só na cópia local). Lista no regerar_passo0.sql.
       Qualquer "NAO"/"DIVERGE - PARAR" = base de produção difere: PARE e chame o controlador. As migrations da Peça Teste e a do Exportar também recusam sozinhas (guardas md5 do ANTES), então o pior caso é abortar sem mudar nada.
   PEÇA TESTE — PARAR e chamar o controlador se (B) ou (C) trouxerem qualquer linha, ou (D) trouxer muitos cards (> ~10) ou card em etapa avançada mudando de resultado
     (os cards da (D) podem MOVER no kanban no 1º recálculo; antes: por linha+fornecedor, depois: por tipo).
   REGERAR — PARAR e chamar o controlador se: (A) trouxer qualquer objeto já existente; (B) "confere" = DIVERGE (o motor de SKU / fn_modelo_ref_auto de produção ≠ o da cópia);
     (D) integráveis/integrados/rastros onde o dono disse zero (aviso ao dono: esses produtos são PULADOS, não é erro); (C) destoar dos números do dono (Ave Rara: 132 REF=ref_auto, 253 REF manuais, 19 réplicas).

1) Conferir os arquivos: ls supabase/migrations | tail -9
   Presentes e nada estranho > 20261128110000 além das 9 deste kit: 20261129100000..140000 (5), 20261201100000..120000 (3), 20261201130000 (1).
   Linha de base do 0a: (G) com os 2 nomes (senão aplicar 20261122100000 ANTES), (G2) _exportar_exige() = NULL, (H) toda "sim"/"ANTES ok".

2) IDA — UMA por vez, FORA de transação (psql -v ON_ERROR_STOP=1 -f, nunca -1, nunca \i), NESTA ordem: Peça Teste → Regerar → Exportar.
   55P03 (ou 40P01) = nada mudou: rodar a MESMA de novo (horário calmo). Qualquer outro erro = PARAR.
   2-pré) SÓ se (G) veio NULL: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261122100000_exportar_dados.sql  (antes de 2a).
   2a) PEÇA TESTE (5; a 20261129100000 toma lock_timeout 1500 ms e mexe na tabela modelo_peca_teste_tentativas; as demais só catálogo):
       for f in 20261129100000_peca_teste_tipo_dados 20261129110000_peca_teste_tipo_predicado 20261129120000_peca_teste_tipo_salvar \
                20261129130000_peca_teste_tipo_leitura 20261129140000_etapas_pl_cond_mo_grade; do
         psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/$f.sql || break; done
   2b) REGERAR (3; só criam FUNÇÕES: sem trava de tabela, ~1 s cada; sem DDL de tabela/gatilho/dado):
       for f in 20261201100000_regerar_pulo_integracao 20261201110000_regerar_ref_card 20261201120000_regerar_skus_loja; do
         psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/$f.sql || break; done
   2c) EXPORTAR (1; BEGIN…COMMIT atômica, lock_timeout 1500 ms; cria 4 funções + 2 gatilhos em user_permissions/papel_permissoes [tabelas de app, NÃO auth/storage — sem a trava supautils; AccessExclusive breve só nessas 2 tabelas] + troca a linha de portão dos 2 wrappers de exportação; nenhum dado):
       psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261201130000_exportar_dados_permissao.sql

3) PÓS-CHECAGEM (só leitura):
   3a) Peça Teste:
       select conname from pg_constraint where conname='mpt_trilha_tipo_numero_uq';                      -- 1 linha
       select (select count(*) from modelo_peca_teste_tentativas) as agora, (select count(*) from _bkp_mpt_reforma_20261129) as backup;  -- iguais (se ninguém salvou no meio)
       select p.oid::regprocedure, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace
         and p.proname in ('_peca_teste_aprovada','_salvar_peca_teste_core','_peca_teste_mini_aplicar','fn_peca_teste_trava_fornecedor','_peca_teste_trilhas_core','_peca_teste_quadro_core','_peca_teste_status_lote_core','_avaliar_condicoes_etapas_pl_core') order by 1;
       -- md5 DEPOIS esperados (ensaio 13/nov; só valem se o ANTES de produção era o mesmo): _avaliar_condicoes_etapas_pl_core 04a8d5cd…, _peca_teste_aprovada 04c14fd4…,
       --   _peca_teste_mini_aplicar d6bcaf59…, _peca_teste_quadro_core 70042cda…, _peca_teste_status_lote_core b0f16878…, _peca_teste_trilhas_core 19888461…, _salvar_peca_teste_core c80bdd3b…, fn_peca_teste_trava_fornecedor 7ddd1abd…
   3b) Regerar:
       select p.oid::regprocedure as funcao, md5(pg_get_functiondef(p.oid)) as md5, has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
         from pg_proc p where p.pronamespace='public'::regnamespace and p.proname ~ '^_?(regerar_|ref_regerar)' order by p.proname;
       -- 10 linhas; anon=f em TODAS; auth=t SÓ em ref_regerar_previa, regerar_ref_card, regerar_skus_loja_previa, regerar_skus_loja_aplicar.
       -- md5 (ensaio 16/nov): _regerar_guarda_admin f8431bd9…, _regerar_pulo_integracao 9449a83d…, _regerar_ref_calcular 382e5595…, _regerar_ref_card_core c1f0262a…,
       --   _regerar_skus_aplicar_item 87cc663f…, _regerar_skus_item_core 8309ee03…, ref_regerar_previa a7924883…, regerar_ref_card 81f788a2…, regerar_skus_loja_aplicar 90bed8b6…, regerar_skus_loja_previa 4299c09d…
   3c) Exportar:
       -- funções do portão existem e sem EXECUTE p/ anon/authenticated; wrappers mantêm auth:
       select p.oid::regprocedure as funcao, has_function_privilege('anon',p.oid,'EXECUTE') as anon, has_function_privilege('authenticated',p.oid,'EXECUTE') as auth
         from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('_exportar_pode','_exportar_exige','fn_exportar_dados_perm_user','fn_exportar_dados_perm_papel','exportar_produtos','exportar_subcolecoes') order by 1;
       -- _exportar_pode/_exportar_exige/fn_exportar_dados_perm_* : anon=f, auth=f.  exportar_produtos/exportar_subcolecoes : anon=f, auth=t.
       select md5(pg_get_functiondef('public._exportar_produtos_core(uuid,text,text,text[],text[],integer)'::regprocedure));  -- 36501a76… (INTOCADO)
       select md5(pg_get_functiondef('public.exportar_produtos(text,text,text[],text[],integer)'::regprocedure)) as prod, md5(pg_get_functiondef('public.exportar_subcolecoes(text)'::regprocedure)) as sub;  -- c3bbc111… / d45677cb…
       select count(*) from pg_trigger where tgname in ('trg_exportar_dados_perm_user','trg_exportar_dados_perm_papel');  -- 2
       select count(*) from papel_permissoes where pagina='exportar_dados';  -- 0 (começa vazia; sem backfill)

4) SITE (worker do deploy único) — SÓ depois do banco. Aba aberta antes do deploy: RECARREGAR.
   - Site velho + banco novo = inofensivo no Regerar (funções novas ficam sem uso); Exportar: a aba velha da Integração chama a RPC já com o portão novo → quem não tem `exportar_dados` recebe 42501 na aba velha (some no site novo); Peça Teste: minutos sem a seção/decisão funcionando (leitura nova ≠ payload antigo).
   - Site NOVO + banco velho = os 2 botões Regerar dão erro de função inexistente, a Peça Teste quebra, e a página/rota Exportar dá erro de função (_exportar_exige inexistente). Por isso BANCO ANTES DO SITE.

5) SMOKE no app:
   - Peça Teste: card com M.O. do tipo PL → "PL — Tentativa 1"; fornecedor só dos vinculados; aprovar/reprovar (nasce a Tentativa 2 sem fornecedor); histórico Editar/Reabrir/Excluir (com confirmação); "Adicionar peça teste"; Config da Loja › Etapas PL: requisitos de uma coluna mostram "M.O. aprovada" e "Grade preenchida".
   - Regerar: card interno → "4. Códigos" → "Regerar REF" → prévia → Salvar (REF e SKUs novos); Config da Loja › "Regerar todos os SKUs da loja" → "Gerar prévia" (só ver; NÃO gravar sem o dono olhar a prévia da Ave Rara — ~434 produtos, 18 páginas de 25).
   - Exportar: a sidebar mostra "Exportar dados" (item próprio, abaixo de Integração) SÓ para o super admin (a permissão começa vazia) → abre /exportar-dados → escolhe Coleção/colunas/níveis → Prévia → Baixar (CSV/Excel). A aba "Exportar dados" NÃO existe mais dentro da Integração. Conceder a permissão: Gerenciar Usuários → o super admin marca "Exportar dados" (os demais usuários nem veem a key no editor).

6) LIMPEZA (≥ 1 dia depois, horário calmo):
   - Peça Teste: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/consultas/peca_teste_tipo_limpeza_gatilho_mo.sql (DROP do gatilho inerte + função neutra).
   - Regerar e Exportar: não têm limpeza (só funções + gatilhos leves em tabelas de app).

VOLTA — LIFO pela ordem de APLICAÇÃO: SITE primeiro, banco depois; Exportar (último aplicado) sai ANTES do Regerar, que sai ANTES da Peça Teste. Um arquivo por vez, psql -v ON_ERROR_STOP=1 -f, em supabase/rollback/:
   Exportar:  20261201130000_exportar_dados_permissao_down  (devolve _integracao_exige(false) nos 2 wrappers; DROP das 2 funções portão + 2 gatilhos/funções de concessão; RECUSA se os wrappers não voltarem ao texto de antes [md5] ou se sobrar função do portão).
   Regerar:   20261201120000_regerar_skus_loja_down → 20261201110000_regerar_ref_card_down → 20261201100000_regerar_pulo_integracao_down
      - o 100000_down RECUSA enquanto as outras o chamarem ("regerar_pulo_down: ainda usado por …"); qualquer _down RECUSA se o texto não for o da ida (md5).
   Peça Teste: 20261129140000_etapas_pl_cond_mo_grade_down → 20261129130000_peca_teste_tipo_leitura_down → 20261129120000_peca_teste_tipo_salvar_down →
               20261129110000_peca_teste_tipo_predicado_down → 20261129100000_peca_teste_tipo_dados_down; e, em horário calmo, 20261129120000_peca_teste_tipo_down_drop.sql.
   Avisos da volta:
     - Exportar: com o _down, a exportação volta a ser gated por `integracao` (como antes da frente); linhas `exportar_dados` em user_permissions ficam inertes (sem efeito, pois a key some do portão) — não precisam ser apagadas.
     - Peça Teste: tentativa criada com fornecedor próprio ≠ fornecedor da M.O. deixa de contar como aprovada; o _down de dados restaura a numeração só nos grupos cobertos pelo backup; se alguma loja já usa "M.O. aprovada"/"Grade preenchida" em etapas_pl_requisitos, tirar antes de voltar a 140000.

AVISOS AO DONO:
   (1) Regerar REF muda a REF E os SKUs do card (os travados/exportados pela Integração são pulados);
   (2) o lote muda os SKUs de TODOS os produtos aptos da loja para o Formato atual — a prévia mostra antes→depois, a gravação é em lotes e NÃO há desfazer em lote (trilha no audit_log: "Regerou SKUs" por produto; REF: "Editou Modelo" ref de/para);
   (3) os SKUs editados à mão nunca mudam;
   (4) Peça Teste: os cards da seção (D) do Passo 0 podem mudar de coluna no kanban no 1º recálculo;
   (5) Exportar: a permissão COMEÇA VAZIA — logo após o deploy só o super admin vê/usa "Exportar dados"; conceda a quem precisar em Gerenciar Usuários (só o super admin consegue conceder).
```
