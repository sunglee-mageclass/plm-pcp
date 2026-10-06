-- Urgentes R3 T14 - Extrato ("Historico") de estoque POR ITEM: Tecido / Aviamento / Insumo (so leitura). GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a3.mjs
-- (nunca editar a mao). Plano: .superpowers/sdd/2026-10-05-urgentes/plan-a.md (Task 14; Rulings A15, A17, A18, A19, A20, A21, A23).
-- O que muda (objetos NOVOS; nenhuma funcao existente e redefinida; nenhum dado muda):
--   1) 3 _core so leitura (STABLE, SECURITY DEFINER, search_path=public, EXECUTE revogado de PUBLIC, anon, authenticated - inv. 9):
--        public._estoque_extrato_tecido_core(uuid,uuid)
--        public._estoque_extrato_aviamento_core(uuid,uuid)
--        public._estoque_extrato_insumo_core(uuid,uuid)
--      Cada um recebe (loja, item) e devolve 1 linha por MOVIMENTO, ASSINADA (+ entrada, - saida; tecido em metros), com bucket,
--      quando/quando_fonte ('registro' | 'data_oc' | 'data_envio' | 'data_os' | 'sem_data'), origem, quem (so o nome), OC/modelo de
--      referencia e core_recebido/core_baixa/core_fisico do _estoque_<fam>_core para o bucket (repetidos). Sigma por bucket = recebido -
--      baixa do core POR CONSTRUCAO (A17: no aviamento/insumo a linha-base do envio absorve o que o estoque_mov_log da 176000 nao explica).
--      Datas so-DIA (entrega da OC, envio, OS) = meia-noite NO FUSO DA LOJA (tenant_config.timezone; invalido/ausente = America/Sao_Paulo).
--   2) 3 wrappers (STABLE, SECURITY DEFINER; EXECUTE authenticated/service_role; sem PUBLIC/anon):
--        public.estoque_extrato_tecido(uuid)  - login -> modulo entrada_saida -> VER a pagina entrada_oc_tecido
--        public.estoque_extrato_aviamento(uuid)  - login -> modulo entrada_saida -> VER a pagina entrada_oc_aviamento
--        public.estoque_extrato_insumo(uuid)  - login -> modulo entrada_saida -> VER a pagina entrada_oc_insumo
--      42501 'nao_autenticado: estoque_extrato' / 'modulo_desligado: entrada_saida' / 'sem_permissao_ver: <pagina>' (ASCII). Loja = a do
--      usuario; item de outra loja/inexistente = conjunto vazio (sem oraculo).
-- A ida CONFERE o md5 dos 3 cores que o extrato espelha (recusa se mudaram - gere de novo e rode a varredura) e a existencia de
-- estoque_mov_log (rode a 20261103176000 antes) e dos auxiliares. Varredura de reconciliacao na geracao (copia2, toda loja, todo item):
-- tecido 411 buckets/253 linhas, aviamento 85/4, insumo 14/28 - 0 divergencias.
-- Trava: so catalogo (CREATE FUNCTION/GRANT/REVOKE; MEDIDO por diferenca de pg_locks). Qualquer hora. Idempotente (CREATE OR REPLACE).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._estoque_extrato_tecido_core(uuid,uuid)  DEPOIS bccc3cb6423a88d4942921f2e72c03fb
--   public._estoque_extrato_aviamento_core(uuid,uuid)  DEPOIS c86981af6abf8129f5142e3636083483
--   public._estoque_extrato_insumo_core(uuid,uuid)  DEPOIS 9f2013ad56ec77e0601d51b32b793708
--   public.estoque_extrato_tecido(uuid)  DEPOIS 2ce5cc0e1161a0a83479047063464007
--   public.estoque_extrato_aviamento(uuid)  DEPOIS e457e2fb99a6b9554bc03c07eee1838b
--   public.estoque_extrato_insumo(uuid)  DEPOIS 26909762250ea9bfec6a4c21e5e3eb51
--   public._estoque_tecido_core(uuid)  (espelhado; exigido) 9140c253a8b62fa143de052d84a1c329
--   public._estoque_aviamento_core(uuid)  (espelhado; exigido) f6eea9360a5fee924824a323de47c53f
--   public._estoque_etiqueta_core(uuid)  (espelhado; exigido) e7681ebd0e2a32144ca41795735182fc
-- ====================================================================================
-- Volta (LIFO): supabase/rollback/20261103177000_urg_r3_estoque_extrato_down.sql (no-op documentado: so leitura, o site velho nao chama) - ANTES do
-- 20261103176000_down. DROP de verdade: supabase/rollback/20261103177000_urg_r3_estoque_extrato_down_drop.sql (opcional, depois; so catalogo), ANTES do _down_drop da 176000
-- (o extrato le estoque_mov_log). Indice do audit (Ruling A22) = 20261103178000, arquivo SEPARADO fora de transacao.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public._estoque_tecido_core(uuid)')));
  IF v IS DISTINCT FROM '9140c253a8b62fa143de052d84a1c329' THEN
    RAISE EXCEPTION 'urg_r3_177000: public._estoque_tecido_core(uuid) mudou (md5 %) - o extrato espelha as regras do core; gere de novo e rode a varredura', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._estoque_aviamento_core(uuid)')));
  IF v IS DISTINCT FROM 'f6eea9360a5fee924824a323de47c53f' THEN
    RAISE EXCEPTION 'urg_r3_177000: public._estoque_aviamento_core(uuid) mudou (md5 %) - o extrato espelha as regras do core; gere de novo e rode a varredura', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._estoque_etiqueta_core(uuid)')));
  IF v IS DISTINCT FROM 'e7681ebd0e2a32144ca41795735182fc' THEN
    RAISE EXCEPTION 'urg_r3_177000: public._estoque_etiqueta_core(uuid) mudou (md5 %) - o extrato espelha as regras do core; gere de novo e rode a varredura', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._exige_modulos(text[])') IS NULL THEN
    RAISE EXCEPTION 'urg_r3_177000: public._exige_modulos(text[]) ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.user_can_view(text)') IS NULL THEN
    RAISE EXCEPTION 'urg_r3_177000: public.user_can_view(text) ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.get_user_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'urg_r3_177000: public.get_user_tenant_id() ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._split_maior_resto(integer,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'urg_r3_177000: public._split_maior_resto(integer,jsonb) ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._insumo_pecas(text,jsonb,numeric)') IS NULL THEN
    RAISE EXCEPTION 'urg_r3_177000: public._insumo_pecas(text,jsonb,numeric) ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._insumo_tamanho_de(uuid)') IS NULL THEN
    RAISE EXCEPTION 'urg_r3_177000: public._insumo_tamanho_de(uuid) ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._grade_mapa_cad(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'urg_r3_177000: public._grade_mapa_cad(uuid,boolean) ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.estoque_mov_log') IS NULL THEN
    RAISE EXCEPTION 'urg_r3_177000: public.estoque_mov_log ausente - rode a 20261103176000 antes' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
        AND ((table_name = 'tenant_config' AND column_name IN ('tenant_id', 'timezone'))
          OR (table_name = 'audit_log' AND column_name IN ('tenant_id', 'tabela', 'acao', 'registro_id', 'dados', 'user_nome', 'created_at')))) <> 9 THEN
    RAISE EXCEPTION 'urg_r3_177000: tenant_config/audit_log sem as colunas esperadas' USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._estoque_extrato_tecido_core(uuid,uuid)')));
  IF v IS NOT NULL AND v <> 'bccc3cb6423a88d4942921f2e72c03fb' THEN
    RAISE EXCEPTION 'urg_r3_177000: public._estoque_extrato_tecido_core(uuid,uuid) ja existe com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._estoque_extrato_aviamento_core(uuid,uuid)')));
  IF v IS NOT NULL AND v <> 'c86981af6abf8129f5142e3636083483' THEN
    RAISE EXCEPTION 'urg_r3_177000: public._estoque_extrato_aviamento_core(uuid,uuid) ja existe com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._estoque_extrato_insumo_core(uuid,uuid)')));
  IF v IS NOT NULL AND v <> '9f2013ad56ec77e0601d51b32b793708' THEN
    RAISE EXCEPTION 'urg_r3_177000: public._estoque_extrato_insumo_core(uuid,uuid) ja existe com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.estoque_extrato_tecido(uuid)')));
  IF v IS NOT NULL AND v <> '2ce5cc0e1161a0a83479047063464007' THEN
    RAISE EXCEPTION 'urg_r3_177000: public.estoque_extrato_tecido(uuid) ja existe com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.estoque_extrato_aviamento(uuid)')));
  IF v IS NOT NULL AND v <> 'e457e2fb99a6b9554bc03c07eee1838b' THEN
    RAISE EXCEPTION 'urg_r3_177000: public.estoque_extrato_aviamento(uuid) ja existe com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.estoque_extrato_insumo(uuid)')));
  IF v IS NOT NULL AND v <> '26909762250ea9bfec6a4c21e5e3eb51' THEN
    RAISE EXCEPTION 'urg_r3_177000: public.estoque_extrato_insumo(uuid) ja existe com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._estoque_extrato_tecido_core(_tenant uuid, _variante_tecido_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- [urg R3 T14] Extrato ("Historico") de UMA variante de tecido (1 bucket = a variante), so leitura. Mesmas fontes e condicoes do
-- _estoque_tecido_core (item nao cancelado de OC 'recebido'; recebido = quantidade_recebida, senao a pedida (0 se reposicao de troca);
-- kg -> m pelo rendimento do artigo do item; baixas do ledger estoque_tecido_baixas DO ITEM com origem nao nula; OS baixada): cada
-- linha e um movimento ASSINADO (+ entrada, - saida, em METROS) e Sigma por bucket = recebido_m - baixa do core POR CONSTRUCAO
-- (Ruling A17). core_* = a linha do core, repetida. Separacao de rolo = 2 linhas (saida na origem + entrada no rolo; A18).
-- Datas (A15): ledger = hora exata; OC = audit_log (ultima transicao status -> recebido; quem = user_nome) senao data de entrega
-- (so DIA = meia-noite no fuso da loja) com quem = recebimento_responsavel_nome; rolo nasce recebido = a hora em que foi criado; OS =
-- audit (baixado -> true) senao data de corte/solicitacao. Quem = so o NOME (A21). Loja errada/item inexistente = conjunto vazio.
DECLARE
  v_tz text;
BEGIN
  SELECT tc.timezone INTO v_tz FROM public.tenant_config tc WHERE tc.tenant_id = _tenant;
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := NULL;
  END;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');

  RETURN QUERY
  WITH
  cr AS (
    SELECT x.variante_tecido_id AS var, x.recebido_m AS rec, x.baixa AS bx, x.fisico AS fis
      FROM public._estoque_tecido_core(_tenant) x
     WHERE x.variante_tecido_id = _variante_tecido_id
  ),
  itens AS (
    SELECT it.id, it.variante_tecido_id AS var, it.quantidade_pedida AS qp, it.quantidade_recebida AS qr, it.substitui_item_id AS subst,
           oc.id AS oc_id, oc.is_rolo, oc.rolo_codigo, oc.numero_pedido, oc.data_entrega, oc.created_at AS oc_criada,
           oc.recebimento_responsavel_nome AS resp, oc.rolo_origem_item_id AS origem_item,
           a.unidade_medida AS un, COALESCE(a.rendimento, 0) AS rend
      FROM public.ocs_tecido_itens it
      JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = _tenant AND oc.status = 'recebido'
      LEFT JOIN public.artigos a ON a.id = it.artigo_id
     WHERE it.variante_tecido_id = _variante_tecido_id
       AND COALESCE(it.cancelado, false) = false
       AND EXISTS (SELECT 1 FROM cr)
  ),
  aud_oc AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT i.oc_id FROM itens i)
       AND al.tenant_id = _tenant AND al.tabela = 'ocs_tecido' AND al.acao = 'editar'
       AND al.dados -> 'status' ->> 'para' = 'recebido'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  aud_rolo AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT i.oc_id FROM itens i WHERE i.is_rolo)
       AND al.tenant_id = _tenant AND al.tabela = 'ocs_tecido' AND al.acao = 'criar'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  ent AS (
    SELECT i.var,
           CASE WHEN ao.registro_id IS NOT NULL THEN ao.created_at
                WHEN i.is_rolo THEN i.oc_criada
                WHEN i.data_entrega IS NOT NULL THEN (i.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ao.registro_id IS NOT NULL OR i.is_rolo THEN 'registro'
                WHEN i.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           CASE WHEN i.is_rolo THEN 'rolo_entrada' WHEN i.subst IS NOT NULL THEN 'reposicao_troca' ELSE 'oc' END AS org,
           CASE WHEN i.un = 'kg'
                THEN COALESCE(i.qr, CASE WHEN i.subst IS NOT NULL THEN 0 ELSE i.qp END, 0) * i.rend
                ELSE COALESCE(i.qr, CASE WHEN i.subst IS NOT NULL THEN 0 ELSE i.qp END, 0) END AS q,
           COALESCE(ao.user_nome, ar.user_nome, i.resp) AS por,
           (CASE WHEN i.is_rolo THEN COALESCE(i.rolo_codigo, i.numero_pedido) ELSE i.numero_pedido END)::text AS oc_ref,
           NULL::text AS mod_ref,
           i.oc_id AS rid,
           concat_ws(' - ',
             CASE WHEN i.un = 'kg'
                  THEN trim_scale(COALESCE(i.qr, CASE WHEN i.subst IS NOT NULL THEN 0 ELSE i.qp END, 0))::text || ' kg x '
                       || trim_scale(i.rend)::text || ' m/kg' END,
             CASE WHEN i.is_rolo AND oo.id IS NOT NULL THEN 'separado da OC ' || COALESCE(oo.rolo_codigo, oo.numero_pedido, '') END
           ) AS det
      FROM itens i
      LEFT JOIN aud_oc ao ON ao.registro_id = i.oc_id
      LEFT JOIN aud_rolo ar ON ar.registro_id = i.oc_id AND i.is_rolo
      LEFT JOIN public.ocs_tecido_itens oi ON oi.id = i.origem_item
      LEFT JOIN public.ocs_tecido oo ON oo.id = oi.oc_tecido_id AND oo.tenant_id = _tenant
  ),
  led0 AS (
    SELECT i.var, b.id AS bid, b.created_at, b.created_by, b.origem AS b_origem, COALESCE(b.quantidade, 0) AS bq, b.motivo,
           b.cad_id, b.rolo_id, i.is_rolo, i.rolo_codigo, i.numero_pedido
      FROM itens i
      JOIN public.estoque_tecido_baixas b ON b.oc_tecido_item_id = i.id AND b.origem IS NOT NULL
  ),
  aud_b AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT l.bid FROM led0 l WHERE l.created_by IS NULL)
       AND al.tenant_id = _tenant AND al.tabela = 'estoque_tecido_baixas' AND al.acao = 'criar'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  led AS (
    SELECT l.var, l.created_at AS qd, 'registro' AS fonte,
           CASE l.b_origem WHEN 'separacao_rolo' THEN 'separacao_rolo' WHEN 'ajuste' THEN 'ajuste'
                           WHEN 'fifo' THEN 'corte' WHEN 'vinculo' THEN 'corte' ELSE l.b_origem END AS org,
           -l.bq AS q,
           COALESCE(u.nome, ab.user_nome) AS por,
           (CASE WHEN l.is_rolo THEN COALESCE(l.rolo_codigo, l.numero_pedido) ELSE l.numero_pedido END)::text AS oc_ref,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref,
           l.bid AS rid,
           CASE WHEN l.b_origem = 'separacao_rolo' THEN 'rolo ' || COALESCE(r.rolo_codigo, r.numero_pedido, '')
                ELSE NULLIF(btrim(l.motivo), '') END AS det
      FROM led0 l
      LEFT JOIN public.users u ON u.id = l.created_by
      LEFT JOIN aud_b ab ON ab.registro_id = l.bid
      LEFT JOIN public.cad cd ON cd.id = l.cad_id AND cd.tenant_id = _tenant
      LEFT JOIN public.modelos m ON m.id = cd.modelo_id AND m.tenant_id = _tenant
      LEFT JOIN public.ocs_tecido r ON r.id = l.rolo_id AND r.tenant_id = _tenant
  ),
  os0 AS (
    SELECT oi.variante_tecido_id AS var, os.id AS os_id, os.numero, os.data_corte, os.data_solicitacao, os.responsavel,
           os.created_by, COALESCE(oi.baixa, 0) AS bq
      FROM public.ordens_saida_tecido_itens oi
      JOIN public.ordens_saida_tecido os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND os.baixado
     WHERE oi.variante_tecido_id = _variante_tecido_id
       AND EXISTS (SELECT 1 FROM cr)
  ),
  aud_os AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT o.os_id FROM os0 o)
       AND al.tenant_id = _tenant AND al.tabela = 'ordens_saida_tecido' AND al.acao = 'editar'
       AND al.dados -> 'baixado' ->> 'para' = 'true'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  sai_os AS (
    SELECT o.var,
           CASE WHEN ao.registro_id IS NOT NULL THEN ao.created_at
                WHEN COALESCE(o.data_corte, o.data_solicitacao) IS NOT NULL
                  THEN (COALESCE(o.data_corte, o.data_solicitacao)::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ao.registro_id IS NOT NULL THEN 'registro'
                WHEN COALESCE(o.data_corte, o.data_solicitacao) IS NOT NULL THEN 'data_os' ELSE 'sem_data' END AS fonte,
           'os' AS org, -o.bq AS q,
           COALESCE(ao.user_nome, NULLIF(btrim(o.responsavel), ''), u.nome)::text AS por,
           ('OS ' || COALESCE(o.numero::text, ''))::text AS oc_ref, NULL::text AS mod_ref, o.os_id AS rid, NULL::text AS det
      FROM os0 o
      LEFT JOIN aud_os ao ON ao.registro_id = o.os_id
      LEFT JOIN public.users u ON u.id = o.created_by
  ),
  mov AS (
    SELECT * FROM ent UNION ALL SELECT * FROM led UNION ALL SELECT * FROM sai_os
  )
  SELECT cr.var, NULL::text, v.cor_id, co.nome::text,
         mov.qd, mov.fonte, CASE WHEN mov.q > 0 THEN 'entrada' ELSE 'saida' END, mov.org, mov.q,
         mov.por, mov.oc_ref, mov.mod_ref, mov.rid, NULLIF(mov.det, ''),
         cr.rec, cr.bx, cr.fis
    FROM cr
    JOIN mov ON mov.var = cr.var
    LEFT JOIN public.variantes_tecido v ON v.id = cr.var
    LEFT JOIN public.cores co ON co.id = v.cor_id
   WHERE mov.q <> 0
   ORDER BY mov.qd NULLS FIRST, (mov.q < 0), mov.oc_ref, mov.rid;
END
$function$;
REVOKE EXECUTE ON FUNCTION public._estoque_extrato_tecido_core(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._estoque_extrato_aviamento_core(_tenant uuid, _aviamento_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- [urg R3 T14] Extrato ("Historico") de UM aviamento, por variante (bucket = COALESCE(variante, variante UNICA do aviamento), o
-- av_sole do _estoque_aviamento_core; "Sem variante" = bucket NULL), so leitura. Mesmas fontes e condicoes do core: item nao
-- cancelado de OC 'recebido' (quantidade_recebida, senao a pedida); CAD enviado ao PCP com a MESMA expressao do baixa_cad
-- (COALESCE(NULLIF(quantidade_separar, 0), quantidade_enviar, 0)); OS baixada. Saida por CAD: a contribuicao ATUAL C vira a linha-base
-- 'explosao' (C - Sigma ajustes, data/quem do envio) + uma linha 'explosao_ajuste' por transacao (txid) do estoque_mov_log gravada
-- DEPOIS do ultimo envio daquele CAD (hora/quem exatos; delta liquido <> 0). Sigma por bucket = recebido - baixa do core POR
-- CONSTRUCAO (Ruling A17); core_* repetidos. Envio = audit_log (ultima transicao enviado_corte -> true) senao data_enviado_corte (DIA =
-- meia-noite no fuso da loja) senao sem data; OC = audit (status -> recebido) senao data de entrega; OS = audit (baixado -> true)
-- senao data de corte/solicitacao. Quem = so o NOME (A21). Loja errada/item inexistente = conjunto vazio.
DECLARE
  v_tz text;
BEGIN
  SELECT tc.timezone INTO v_tz FROM public.tenant_config tc WHERE tc.tenant_id = _tenant;
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := NULL;
  END;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');

  RETURN QUERY
  WITH
  cr AS (
    SELECT x.variante_id AS var, x.recebido AS rec, x.baixa AS bx, x.fisico AS fis
      FROM public._estoque_aviamento_core(_tenant) x
     WHERE x.id = _aviamento_id
  ),
  av_sole AS (
    SELECT va.aviamento_id, (array_agg(va.id ORDER BY va.created_at, va.id))[1] AS var
      FROM public.variantes_aviamento va
     WHERE va.tenant_id = _tenant AND va.aviamento_id = _aviamento_id
     GROUP BY va.aviamento_id
    HAVING count(*) = 1
  ),
  oc0 AS (
    SELECT COALESCE(i.variante_aviamento_id, s.var) AS var, oc.id AS oc_id, oc.numero_pedido, oc.data_entrega,
           COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0) AS q
      FROM public.ocs_aviamento_itens i
      JOIN public.ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = _tenant AND oc.status = 'recebido'
      LEFT JOIN av_sole s ON s.aviamento_id = i.aviamento_id
     WHERE i.aviamento_id = _aviamento_id AND COALESCE(i.cancelado, false) = false
       AND EXISTS (SELECT 1 FROM cr)
  ),
  aud_oc AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT o.oc_id FROM oc0 o)
       AND al.tenant_id = _tenant AND al.tabela = 'ocs_aviamento' AND al.acao = 'editar'
       AND al.dados -> 'status' ->> 'para' = 'recebido'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  ent AS (
    SELECT o.var,
           CASE WHEN ao.registro_id IS NOT NULL THEN ao.created_at
                WHEN o.data_entrega IS NOT NULL THEN (o.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ao.registro_id IS NOT NULL THEN 'registro' WHEN o.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           'oc' AS org, o.q, ao.user_nome::text AS por, o.numero_pedido::text AS oc_ref, NULL::text AS mod_ref, o.oc_id AS rid,
           NULL::text AS det
      FROM oc0 o
      LEFT JOIN aud_oc ao ON ao.registro_id = o.oc_id
  ),
  contrib AS (
    SELECT ca.cad_id AS cad, COALESCE(ca.variante_aviamento_id, s.var) AS var,
           SUM(COALESCE(NULLIF(ca.quantidade_separar, 0), ca.quantidade_enviar, 0)) AS c
      FROM public.cad_aviamentos ca
      JOIN public.cad c ON c.id = ca.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
      LEFT JOIN av_sole s ON s.aviamento_id = ca.aviamento_id
     WHERE ca.aviamento_id = _aviamento_id
       AND EXISTS (SELECT 1 FROM cr)
     GROUP BY 1, 2
  ),
  lg0 AS (
    SELECT l.id, l.cad_id AS cad, COALESCE(l.variante_id, s.var) AS var, l.txid, l.created_at, l.created_by, l.depois - l.antes AS d
      FROM public.estoque_mov_log l
      JOIN public.cad c ON c.id = l.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
      LEFT JOIN av_sole s ON s.aviamento_id = l.item_id
     WHERE l.tenant_id = _tenant AND l.familia = 'aviamento' AND l.item_id = _aviamento_id
       AND EXISTS (SELECT 1 FROM cr)
  ),
  cads AS (
    SELECT DISTINCT x.cad FROM (SELECT cad FROM contrib UNION ALL SELECT cad FROM lg0) x
  ),
  aud_cad AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT k.cad FROM cads k)
       AND al.tenant_id = _tenant AND al.tabela = 'cad' AND al.acao = 'editar'
       AND al.dados -> 'enviado_corte' ->> 'para' = 'true'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  envio AS (
    SELECT k.cad, c.modelo_id,
           CASE WHEN ac.registro_id IS NOT NULL THEN ac.created_at
                WHEN c.data_enviado_corte IS NOT NULL THEN (c.data_enviado_corte::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ac.registro_id IS NOT NULL THEN 'registro' WHEN c.data_enviado_corte IS NOT NULL THEN 'data_envio'
                ELSE 'sem_data' END AS fonte,
           ac.user_nome AS por,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref
      FROM cads k
      JOIN public.cad c ON c.id = k.cad
      LEFT JOIN aud_cad ac ON ac.registro_id = k.cad
      LEFT JOIN public.modelos m ON m.id = c.modelo_id AND m.tenant_id = _tenant
  ),
  lg AS (
    SELECT l.cad, l.var, l.txid, SUM(l.d) AS d, max(l.created_at) AS qd,
           (array_agg(l.created_by ORDER BY l.created_at DESC, l.id DESC))[1] AS por_id
      FROM lg0 l
      JOIN envio e ON e.cad = l.cad
     WHERE e.qd IS NULL OR l.created_at > e.qd
     GROUP BY 1, 2, 3
    HAVING SUM(l.d) <> 0
  ),
  base AS (
    SELECT k.cad, k.var, COALESCE(ct.c, 0) - COALESCE((SELECT SUM(g.d) FROM lg g WHERE g.cad = k.cad AND g.var IS NOT DISTINCT FROM k.var), 0) AS b
      FROM (SELECT cad, var FROM contrib UNION SELECT cad, var FROM lg) k
      LEFT JOIN contrib ct ON ct.cad = k.cad AND ct.var IS NOT DISTINCT FROM k.var
  ),
  sai_cad AS (
    SELECT b.var, e.qd, e.fonte, 'explosao' AS org, -b.b AS q, e.por::text AS por, NULL::text AS oc_ref, e.mod_ref, b.cad AS rid,
           NULL::text AS det
      FROM base b JOIN envio e ON e.cad = b.cad
    UNION ALL
    SELECT g.var, g.qd, 'registro', 'explosao_ajuste', -g.d, u.nome::text, NULL::text, e.mod_ref, g.cad, NULL::text
      FROM lg g JOIN envio e ON e.cad = g.cad
      LEFT JOIN public.users u ON u.id = g.por_id
  ),
  os0 AS (
    SELECT COALESCE(oi.variante_aviamento_id, s.var) AS var, os.id AS os_id, os.numero, os.data_corte, os.data_solicitacao,
           os.responsavel, os.created_by, COALESCE(oi.baixa, 0) AS bq
      FROM public.ordens_saida_aviamento_itens oi
      JOIN public.ordens_saida_aviamento os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND os.baixado
      LEFT JOIN av_sole s ON s.aviamento_id = oi.aviamento_id
     WHERE oi.aviamento_id = _aviamento_id
       AND EXISTS (SELECT 1 FROM cr)
  ),
  aud_os AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT o.os_id FROM os0 o)
       AND al.tenant_id = _tenant AND al.tabela = 'ordens_saida_aviamento' AND al.acao = 'editar'
       AND al.dados -> 'baixado' ->> 'para' = 'true'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  sai_os AS (
    SELECT o.var,
           CASE WHEN ao.registro_id IS NOT NULL THEN ao.created_at
                WHEN COALESCE(o.data_corte, o.data_solicitacao) IS NOT NULL
                  THEN (COALESCE(o.data_corte, o.data_solicitacao)::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ao.registro_id IS NOT NULL THEN 'registro'
                WHEN COALESCE(o.data_corte, o.data_solicitacao) IS NOT NULL THEN 'data_os' ELSE 'sem_data' END AS fonte,
           'os' AS org, -o.bq AS q,
           COALESCE(ao.user_nome, NULLIF(btrim(o.responsavel), ''), u.nome)::text AS por,
           ('OS ' || COALESCE(o.numero::text, ''))::text AS oc_ref, NULL::text AS mod_ref, o.os_id AS rid, NULL::text AS det
      FROM os0 o
      LEFT JOIN aud_os ao ON ao.registro_id = o.os_id
      LEFT JOIN public.users u ON u.id = o.created_by
  ),
  mov AS (
    SELECT * FROM ent UNION ALL SELECT * FROM sai_cad UNION ALL SELECT * FROM sai_os
  )
  SELECT cr.var, NULL::text, va.cor_id, co.nome::text,
         mov.qd, mov.fonte, CASE WHEN mov.q > 0 THEN 'entrada' ELSE 'saida' END, mov.org, mov.q,
         mov.por, mov.oc_ref, mov.mod_ref, mov.rid, mov.det,
         cr.rec, cr.bx, cr.fis
    FROM cr
    JOIN mov ON mov.var IS NOT DISTINCT FROM cr.var
    LEFT JOIN public.variantes_aviamento va ON va.id = cr.var
    LEFT JOIN public.cores co ON co.id = va.cor_id
   WHERE mov.q <> 0
   ORDER BY cr.var NULLS FIRST, mov.qd NULLS FIRST, (mov.q < 0), mov.oc_ref, mov.rid;
END
$function$;
REVOKE EXECUTE ON FUNCTION public._estoque_extrato_aviamento_core(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._estoque_extrato_insumo_core(_tenant uuid, _etiqueta_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- [urg R3 T14] Extrato ("Historico") de UM insumo, por bucket (tamanho, cor) = a chave da linha do _estoque_etiqueta_core (o bucket
-- da tela e da lib TS e (tamanho, nome da cor); core_* = a soma das linhas DISTINTAS do core com a mesma chave), so leitura. Mesmas
-- fontes e regras do core: item nao cancelado de OC Insumo 'recebido' (bucket da variante; recebida senao a pedida); por CAD enviado ao
-- PCP, a contribuicao ATUAL pela MESMA regra (enviar_por_tamanho preenchido = por tamanho; senao o "a enviar" inteiro repartido pela
-- grade planejada do CAD com _split_maior_resto, a fracao no bucket sem tamanho, quando o insumo tem tamanho; senao tudo sem tamanho)
-- vira a linha-base 'explosao' (C - Sigma ajustes, data/quem do envio) + uma linha 'explosao_ajuste' por transacao (txid) do
-- estoque_mov_log gravada DEPOIS do ultimo envio (antes/depois mapeados pela mesma regra com os pesos de HOJE - Ruling A19; delta
-- liquido <> 0); revenda/importado ainda nao enviado = consumo x pecas recebidas (_insumo_pecas: vinculado = so o tamanho; R1).
-- Sigma por bucket = recebido - baixa do core POR CONSTRUCAO (A17). Datas: OC Insumo sem audit = so a data de entrega (DIA =
-- meia-noite no fuso da loja); envio = audit (enviado_corte -> true) senao data_enviado_corte; revenda = data de entrega da OC de
-- P. Acabado/Importado recebida. Quem = so o NOME (A21). Loja errada/item inexistente = conjunto vazio.
DECLARE
  v_tz text;
BEGIN
  SELECT tc.timezone INTO v_tz FROM public.tenant_config tc WHERE tc.tenant_id = _tenant;
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := NULL;
  END;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');

  RETURN QUERY
  WITH
  cr AS (
    SELECT d.tamanho AS tam, d.cor_nome AS cnome, SUM(d.recebido) AS rec, SUM(d.baixa) AS bx, SUM(d.fisico) AS fis
      FROM (SELECT DISTINCT x.tamanho, x.cor_nome, x.recebido, x.prev_receb, x.baixa, x.fisico
              FROM public._estoque_etiqueta_core(_tenant) x
             WHERE x.etiqueta_id = _etiqueta_id) d
     GROUP BY 1, 2
  ),
  etq AS (
    SELECT e.id, (COALESCE(e.formato_tamanho, 'ambos') <> 'nenhum'
                  AND EXISTS (SELECT 1 FROM public.variantes_etiqueta ve WHERE ve.etiqueta_id = e.id AND ve.tamanho IS NOT NULL)) AS com_tam
      FROM public.etiquetas e
     WHERE e.id = _etiqueta_id AND e.tenant_id = _tenant
       AND EXISTS (SELECT 1 FROM cr)
  ),
  oc0 AS (
    SELECT ve.tamanho AS tam, ve.cor_id AS cor, o.id AS oc_id, o.numero_pedido, o.data_entrega,
           COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0) AS q
      FROM public.ocs_etiqueta_itens i
      JOIN public.ocs_etiqueta o ON o.id = i.oc_etiqueta_id AND o.tenant_id = _tenant AND o.status = 'recebido'
      LEFT JOIN public.variantes_etiqueta ve ON ve.id = i.variante_etiqueta_id
     WHERE i.etiqueta_id = _etiqueta_id AND COALESCE(i.cancelado, false) = false
       AND EXISTS (SELECT 1 FROM etq)
  ),
  ent AS (
    SELECT o.tam, o.cor,
           CASE WHEN o.data_entrega IS NOT NULL THEN (o.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN o.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           'oc' AS org, o.q, NULL::text AS por, o.numero_pedido::text AS oc_ref, NULL::text AS mod_ref, o.oc_id AS rid, NULL::text AS det
      FROM oc0 o
  ),
  ce AS (
    SELECT ce.cad_id AS cad, ce.cor_id AS cor, COALESCE(ce.quantidade_enviar, 0) AS v, ce.enviar_por_tamanho AS ept
      FROM public.cad_etiquetas ce
      JOIN public.cad c ON c.id = ce.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
     WHERE ce.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  lg0 AS (
    SELECT l.id, l.cad_id AS cad, l.cor_id AS cor, l.txid, l.created_at, l.created_by, l.antes, l.depois, l.ept_antes, l.ept_depois
      FROM public.estoque_mov_log l
      JOIN public.cad c ON c.id = l.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
     WHERE l.tenant_id = _tenant AND l.familia = 'insumo' AND l.item_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  cads AS (
    SELECT DISTINCT x.cad FROM (SELECT cad FROM ce UNION ALL SELECT cad FROM lg0) x
  ),
  pesos AS (  -- pesos de HOJE = grade planejada do CAD por tamanho (so com peca > 0), so se o insumo tem tamanho (regra do ce_sem)
    SELECT k.cad,
           CASE WHEN (SELECT e.com_tam FROM etq e)
                THEN (SELECT jsonb_object_agg(w.k, w.s)
                        FROM (SELECT kv.key AS k, sum((kv.value)::numeric) AS s
                                FROM public.cad_grades g
                                CROSS JOIN LATERAL jsonb_each_text(coalesce(g.grades_planejadas, '{}'::jsonb)) kv
                               WHERE g.cad_id = k.cad AND kv.value ~ '^[0-9]+(\.[0-9]+)?$'
                               GROUP BY kv.key
                              HAVING sum((kv.value)::numeric) > 0) w)
           END AS p
      FROM cads k
  ),
  contrib AS (
    SELECT r.cad, m.tam, r.cor, SUM(m.q) AS c
      FROM ce r
      LEFT JOIN pesos pe ON pe.cad = r.cad
      CROSS JOIN LATERAL (
        SELECT kv.key AS tam, (kv.value)::numeric AS q
          FROM jsonb_each_text(CASE WHEN coalesce(r.ept, '{}'::jsonb) <> '{}'::jsonb THEN r.ept ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT kv.key, (kv.value)::numeric
          FROM jsonb_each_text(CASE WHEN coalesce(r.ept, '{}'::jsonb) = '{}'::jsonb AND pe.p IS NOT NULL AND r.v >= 1
                                    THEN public._split_maior_resto(floor(r.v)::int, pe.p) ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT NULL::text, CASE WHEN pe.p IS NOT NULL AND r.v >= 1 THEN r.v - floor(r.v) ELSE r.v END
         WHERE coalesce(r.ept, '{}'::jsonb) = '{}'::jsonb
      ) m
     GROUP BY 1, 2, 3
  ),
  aud_cad AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT k.cad FROM cads k)
       AND al.tenant_id = _tenant AND al.tabela = 'cad' AND al.acao = 'editar'
       AND al.dados -> 'enviado_corte' ->> 'para' = 'true'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  envio AS (
    SELECT k.cad,
           CASE WHEN ac.registro_id IS NOT NULL THEN ac.created_at
                WHEN c.data_enviado_corte IS NOT NULL THEN (c.data_enviado_corte::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ac.registro_id IS NOT NULL THEN 'registro' WHEN c.data_enviado_corte IS NOT NULL THEN 'data_envio'
                ELSE 'sem_data' END AS fonte,
           ac.user_nome AS por,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref
      FROM cads k
      JOIN public.cad c ON c.id = k.cad
      LEFT JOIN aud_cad ac ON ac.registro_id = k.cad
      LEFT JOIN public.modelos m ON m.id = c.modelo_id AND m.tenant_id = _tenant
  ),
  lgm AS (  -- cada lado do log mapeado para (tamanho) pela regra do core com os pesos de HOJE; depois - antes
    SELECT x.id, x.cad, m.tam, x.cor, x.txid, x.created_at, x.created_by, m.q * x.sinal AS d
      FROM (SELECT l.id, l.cad, l.cor, l.txid, l.created_at, l.created_by, l.depois AS v, l.ept_depois AS ept, 1 AS sinal
              FROM lg0 l JOIN envio e ON e.cad = l.cad WHERE e.qd IS NULL OR l.created_at > e.qd
            UNION ALL
            SELECT l.id, l.cad, l.cor, l.txid, l.created_at, l.created_by, l.antes, l.ept_antes, -1
              FROM lg0 l JOIN envio e ON e.cad = l.cad WHERE e.qd IS NULL OR l.created_at > e.qd) x
      LEFT JOIN pesos pe ON pe.cad = x.cad
      CROSS JOIN LATERAL (
        SELECT kv.key AS tam, (kv.value)::numeric AS q
          FROM jsonb_each_text(CASE WHEN coalesce(x.ept, '{}'::jsonb) <> '{}'::jsonb THEN x.ept ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT kv.key, (kv.value)::numeric
          FROM jsonb_each_text(CASE WHEN coalesce(x.ept, '{}'::jsonb) = '{}'::jsonb AND pe.p IS NOT NULL AND x.v >= 1
                                    THEN public._split_maior_resto(floor(x.v)::int, pe.p) ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT NULL::text, CASE WHEN pe.p IS NOT NULL AND x.v >= 1 THEN x.v - floor(x.v) ELSE x.v END
         WHERE coalesce(x.ept, '{}'::jsonb) = '{}'::jsonb
      ) m
  ),
  lg AS (
    SELECT l.cad, l.tam, l.cor, l.txid, SUM(l.d) AS d, max(l.created_at) AS qd,
           (array_agg(l.created_by ORDER BY l.created_at DESC, l.id DESC))[1] AS por_id
      FROM lgm l
     GROUP BY 1, 2, 3, 4
    HAVING SUM(l.d) <> 0
  ),
  base AS (
    SELECT k.cad, k.tam, k.cor,
           COALESCE(ct.c, 0) - COALESCE((SELECT SUM(g.d) FROM lg g
                                          WHERE g.cad = k.cad AND g.tam IS NOT DISTINCT FROM k.tam AND g.cor IS NOT DISTINCT FROM k.cor), 0) AS b
      FROM (SELECT cad, tam, cor FROM contrib UNION SELECT cad, tam, cor FROM lg) k
      LEFT JOIN contrib ct ON ct.cad = k.cad AND ct.tam IS NOT DISTINCT FROM k.tam AND ct.cor IS NOT DISTINCT FROM k.cor
  ),
  sai_cad AS (
    SELECT b.tam, b.cor, e.qd, e.fonte, 'explosao' AS org, -b.b AS q, e.por::text AS por, NULL::text AS oc_ref, e.mod_ref, b.cad AS rid,
           NULL::text AS det
      FROM base b JOIN envio e ON e.cad = b.cad
    UNION ALL
    SELECT g.tam, g.cor, g.qd, 'registro', 'explosao_ajuste', -g.d, u.nome::text, NULL::text, e.mod_ref, g.cad, NULL::text
      FROM lg g JOIN envio e ON e.cad = g.cad
      LEFT JOIN public.users u ON u.id = g.por_id
  ),
  rev0 AS (  -- a MESMA baixa_revenda do core (revenda/importado ainda nao enviado ao PCP, pecas recebidas do cad-espelho)
    SELECT m.id AS modelo, m.origem AS m_origem, COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref, c.id AS cad, me.cor_id AS cor,
           sum(me.consumo * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(c.id, true),
                                                 coalesce(cg.total_real, 0))) AS q
      FROM public.modelo_etiquetas me
      JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = _tenant AND m.origem IN ('revenda', 'importado')
      JOIN public.cad c ON c.modelo_id = m.id AND c.tenant_id = _tenant AND NOT coalesce(c.enviado_corte, false)
      JOIN LATERAL (SELECT g.cad_id, sum(g.grade_total_real) AS total_real FROM public.cad_grades g WHERE g.cad_id = c.id GROUP BY g.cad_id) cg
        ON true
     WHERE me.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
     GROUP BY 1, 2, 3, 4, 5
  ),
  rev_oc AS (
    SELECT DISTINCT ON (r.modelo) r.modelo, x.numero, x.data_entrega
      FROM rev0 r
      JOIN LATERAL (
        SELECT o.numero::text AS numero, o.data_entrega, o.created_at
          FROM public.ocs_p_acabado o JOIN public.produtos_acabados pa ON pa.id = o.produto_acabado_id
         WHERE r.m_origem = 'revenda' AND pa.modelo_id = r.modelo AND o.tenant_id = _tenant AND o.status = 'recebido'
        UNION ALL
        SELECT o.numero::text, o.data_entrega, o.created_at
          FROM public.ocs_importado o JOIN public.produtos_importados pi ON pi.id = o.produto_importado_id
         WHERE r.m_origem = 'importado' AND pi.modelo_id = r.modelo AND o.tenant_id = _tenant AND o.status = 'recebido'
      ) x ON true
     ORDER BY r.modelo, x.data_entrega DESC NULLS LAST, x.created_at DESC
  ),
  sai_rev AS (
    SELECT NULL::text AS tam, r.cor,
           CASE WHEN ro.data_entrega IS NOT NULL THEN (ro.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ro.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           'revenda' AS org, -r.q AS q, NULL::text AS por, ro.numero AS oc_ref, r.mod_ref, r.cad AS rid, NULL::text AS det
      FROM rev0 r
      LEFT JOIN rev_oc ro ON ro.modelo = r.modelo
  ),
  mov AS (
    SELECT * FROM ent UNION ALL SELECT * FROM sai_cad UNION ALL SELECT * FROM sai_rev
  )
  SELECT NULL::uuid, cr.tam, mov.cor, cr.cnome::text,
         mov.qd, mov.fonte, CASE WHEN mov.q > 0 THEN 'entrada' ELSE 'saida' END, mov.org, mov.q,
         mov.por, mov.oc_ref, mov.mod_ref, mov.rid, mov.det,
         cr.rec, cr.bx, cr.fis
    FROM mov
    LEFT JOIN public.cores co ON co.id = mov.cor
    JOIN cr ON cr.tam IS NOT DISTINCT FROM mov.tam AND cr.cnome IS NOT DISTINCT FROM co.nome
   WHERE mov.q <> 0
   ORDER BY cr.tam NULLS FIRST, cr.cnome NULLS FIRST, mov.qd NULLS FIRST, (mov.q < 0), mov.oc_ref, mov.rid;
END
$function$;
REVOKE EXECUTE ON FUNCTION public._estoque_extrato_insumo_core(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.estoque_extrato_tecido(_variante_tecido_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R3 T14] Extrato ("Historico") do estoque de tecido POR ITEM (botao Historico da aba Estoque de OC Tecido), so leitura.
-- Portoes: login -> modulo entrada_saida (_exige_modulos, o mesmo modulo dos estoque_*) -> VER a pagina da aba de estoque
-- (entrada_oc_tecido; so ver, leitura). Depois so a loja do usuario (get_user_tenant_id): item de outra loja ou inexistente = conjunto vazio
-- (sem oraculo). Linhas, sinais, datas e reconciliacao com o estoque: public._estoque_extrato_tecido_core.
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: estoque_extrato' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('entrada_saida');
  IF NOT public.user_can_view('entrada_oc_tecido') THEN
    RAISE EXCEPTION 'sem_permissao_ver: entrada_oc_tecido' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._estoque_extrato_tecido_core(public.get_user_tenant_id(), _variante_tecido_id);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.estoque_extrato_tecido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estoque_extrato_tecido(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.estoque_extrato_aviamento(_aviamento_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R3 T14] Extrato ("Historico") do estoque de aviamento POR ITEM (botao Historico da aba Estoque de OC Aviamento), so leitura.
-- Portoes: login -> modulo entrada_saida (_exige_modulos, o mesmo modulo dos estoque_*) -> VER a pagina da aba de estoque
-- (entrada_oc_aviamento; so ver, leitura). Depois so a loja do usuario (get_user_tenant_id): item de outra loja ou inexistente = conjunto vazio
-- (sem oraculo). Linhas, sinais, datas e reconciliacao com o estoque: public._estoque_extrato_aviamento_core.
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: estoque_extrato' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('entrada_saida');
  IF NOT public.user_can_view('entrada_oc_aviamento') THEN
    RAISE EXCEPTION 'sem_permissao_ver: entrada_oc_aviamento' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._estoque_extrato_aviamento_core(public.get_user_tenant_id(), _aviamento_id);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.estoque_extrato_aviamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estoque_extrato_aviamento(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.estoque_extrato_insumo(_etiqueta_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R3 T14] Extrato ("Historico") do estoque de insumo POR ITEM (botao Historico da aba Estoque de OC Insumo), so leitura.
-- Portoes: login -> modulo entrada_saida (_exige_modulos, o mesmo modulo dos estoque_*) -> VER a pagina da aba de estoque
-- (entrada_oc_insumo; so ver, leitura). Depois so a loja do usuario (get_user_tenant_id): item de outra loja ou inexistente = conjunto vazio
-- (sem oraculo). Linhas, sinais, datas e reconciliacao com o estoque: public._estoque_extrato_insumo_core.
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: estoque_extrato' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('entrada_saida');
  IF NOT public.user_can_view('entrada_oc_insumo') THEN
    RAISE EXCEPTION 'sem_permissao_ver: entrada_oc_insumo' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._estoque_extrato_insumo_core(public.get_user_tenant_id(), _etiqueta_id);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.estoque_extrato_insumo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estoque_extrato_insumo(uuid) TO authenticated, service_role;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._estoque_extrato_tecido_core(uuid,uuid)'))) IS DISTINCT FROM 'bccc3cb6423a88d4942921f2e72c03fb' THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou no texto de public._estoque_extrato_tecido_core(uuid,uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public._estoque_extrato_aviamento_core(uuid,uuid)'))) IS DISTINCT FROM 'c86981af6abf8129f5142e3636083483' THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou no texto de public._estoque_extrato_aviamento_core(uuid,uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public._estoque_extrato_insumo_core(uuid,uuid)'))) IS DISTINCT FROM '9f2013ad56ec77e0601d51b32b793708' THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou no texto de public._estoque_extrato_insumo_core(uuid,uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.estoque_extrato_tecido(uuid)'))) IS DISTINCT FROM '2ce5cc0e1161a0a83479047063464007' THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou no texto de public.estoque_extrato_tecido(uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.estoque_extrato_aviamento(uuid)'))) IS DISTINCT FROM 'e457e2fb99a6b9554bc03c07eee1838b' THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou no texto de public.estoque_extrato_aviamento(uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.estoque_extrato_insumo(uuid)'))) IS DISTINCT FROM '26909762250ea9bfec6a4c21e5e3eb51' THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou no texto de public.estoque_extrato_insumo(uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._estoque_extrato_tecido_core(uuid,uuid)') AND p.prosecdef AND p.provolatile = 's'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                   AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public._estoque_extrato_tecido_core(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._estoque_extrato_tecido_core(uuid,uuid)', 'EXECUTE') IS DISTINCT FROM false
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public._estoque_extrato_tecido_core(uuid,uuid)') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de public._estoque_extrato_tecido_core(uuid,uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._estoque_extrato_aviamento_core(uuid,uuid)') AND p.prosecdef AND p.provolatile = 's'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                   AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public._estoque_extrato_aviamento_core(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._estoque_extrato_aviamento_core(uuid,uuid)', 'EXECUTE') IS DISTINCT FROM false
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public._estoque_extrato_aviamento_core(uuid,uuid)') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de public._estoque_extrato_aviamento_core(uuid,uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public._estoque_extrato_insumo_core(uuid,uuid)') AND p.prosecdef AND p.provolatile = 's'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                   AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public._estoque_extrato_insumo_core(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._estoque_extrato_insumo_core(uuid,uuid)', 'EXECUTE') IS DISTINCT FROM false
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public._estoque_extrato_insumo_core(uuid,uuid)') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de public._estoque_extrato_insumo_core(uuid,uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.estoque_extrato_tecido(uuid)') AND p.prosecdef AND p.provolatile = 's'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
                   AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.estoque_extrato_tecido(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.estoque_extrato_tecido(uuid)', 'EXECUTE') IS DISTINCT FROM true
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.estoque_extrato_tecido(uuid)') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de public.estoque_extrato_tecido(uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.estoque_extrato_aviamento(uuid)') AND p.prosecdef AND p.provolatile = 's'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
                   AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.estoque_extrato_aviamento(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.estoque_extrato_aviamento(uuid)', 'EXECUTE') IS DISTINCT FROM true
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.estoque_extrato_aviamento(uuid)') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de public.estoque_extrato_aviamento(uuid)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.estoque_extrato_insumo(uuid)') AND p.prosecdef AND p.provolatile = 's'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
                   AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.estoque_extrato_insumo(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.estoque_extrato_insumo(uuid)', 'EXECUTE') IS DISTINCT FROM true
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.estoque_extrato_insumo(uuid)') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'urg_r3_177000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de public.estoque_extrato_insumo(uuid)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
