-- Urgentes R4b - Enviar a Explosao cria os blocos de Servicos a partir da M.O.; preco entra ao aprovar. GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 2 / R4b; Rulings 4-9, 12, 22 + B2 da revisao da Task 1).
-- O que muda:
--   1) coluna NOVA public.producao_terceirizados.mo_linha_id uuid NULL REFERENCES modelo_servico_mo(id) ON DELETE SET NULL
--      (sem default, sem reescrita) + indice parcial producao_terceirizados_mo_linha_idx. Sem GRANT: authenticated segue so
--      com SELECT na tabela; a tela so LE (salvar_terceirizados NAO cita a coluna: UPDATE preserva, INSERT do PCP nasce NULL).
--   2) funcao NOVA _servicos_da_mo_criar(modelo, cad) (DEFINER, REVOKE dos 3): no Enviar a Explosao, CAD sem NENHUM bloco
--      (ativo ou nao, Ruling 6) e loja com Producao (Ruling 7) -> 1 bloco por linha de M.O. com servico (legado fora,
--      Ruling 8): externo, ativo, 1 parcela (Ruling 9), fornecedor da linha SO se ainda for empresa de servico da mesma
--      loja (B2), preco = valor da M.O. APROVADA (> 0), senao NULL; rev nasce 0 (como o INSERT do PCP).
--   3) funcao NOVA _servico_mo_preencher_preco(linha) (DEFINER, REVOKE dos 3): linha aprovada com valor > 0 -> preco nos
--      blocos ATIVOS, externos, ligados a ela e com preco NULL ou 0 (Ruling 4); preco > 0 nunca muda (Ruling 5); rev + 1.
--   4) _enviar_modelo_para_cad_core: nos 2 caminhos (CAD ja existia / CAD novo) chama a (2) - ANTES de travar modelos
--      (fix round 2). _aprovar_servico_mo_core: aprovou -> chama a (3).
--      Fix round 1: no caminho 'CAD ja existia' o advisory do CAD (hashtext(cad_id), o MESMO do salvar_terceirizados) vem
--      ANTES do UPDATE do cad - mesma ordem de trava do Salvar do PCP (sem isto: 40P01 com os 2 no mesmo CAD).
--      Blocos criados juntos ganham created_at crescente na ordem da M.O. (o PCP lista por created_at, id).
--      Fix round 2: o envio chama a (2) ANTES de travar modelos (enviado_cad) nos 2 caminhos (ordem do Salvar da M.O.);
--      a (2) le as linhas de M.O. com FOR KEY SHARE (linha apagada no meio = pulada, sem 23503), so com servico da MESMA
--      loja e ATIVO, e nao cria nada se o CQ (Pre) do CAD ja esta confirmado. _aprovar_servico_mo_core pega a chave do card
--      (cad:modelo_id) e a do CAD ANTES de tocar a linha: aprovar, enviar e Salvar do PCP serializam (sem preco perdido).
--      Fix round 3: _salvar_modelo_servico_mo_core (ANTES = r4a) pega a chave do card antes das linhas (Salvar da M.O. x envio
--      x aprovar); excluir_cad (wrapper, ACL com authenticated) pega a chave do card e a do CAD antes do DELETE. Ordem unica:
--      chave do card -> chave do CAD -> cad -> linhas de M.O. -> blocos -> modelos.
--      Fix round 4: depois das chaves o excluir_cad rele o CAD com FOR UPDATE e decide (corte, existencia) pelo valor fresco.
-- ACL, SECURITY e search_path das 2 redefinidas ficam iguais (CREATE OR REPLACE preserva; pos-condicao confere).
-- Nenhum dado existente muda (blocos so nascem no proximo Enviar a Explosao de CAD sem blocos).
-- Trava: ADD COLUMN ... REFERENCES = AccessExclusiveLock em producao_terceirizados + ShareRowExclusiveLock em
-- modelo_servico_mo; CREATE INDEX (nao CONCURRENTLY) = ShareLock em producao_terceirizados durante o build - ate o COMMIT.
-- MEDIDO na copia local (supautils carregado, por diferenca de pg_locks, txn revertida): ALTER ~5 ms, INDEX+COMMENT ~3 ms;
-- travas novas = SO producao_terceirizados (AccessExclusive, ShareRowExclusive, Share, ShareUpdateExclusive, AccessShare),
-- o indice novo e modelo_servico_mo (ShareRowExclusive + AccessShare); NENHUMA em auth/storage/realtime (contagem 0).
-- Enquanto a txn dura: leitura e escrita de servicos (PCP) esperam; escrita de linhas de M.O. espera; leitura de M.O. segue.
-- HORARIO CALMO. lock_timeout 1500ms; 55P03 = nada mudou, rodar o arquivo de novo. Idempotente (IF NOT EXISTS).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._enviar_modelo_para_cad_core(uuid,text,text)
--     ANTES  bf28796bcd86538a3a5b516e9cf356c6
--     DEPOIS 6c5fc00819b4211eb08d20a1d271c9b2
--   public._aprovar_servico_mo_core(uuid,uuid,boolean,text)
--     ANTES  859dd63992e86cc75b7abeab41dee954
--     DEPOIS 2ff506f1a250d7f4f79e08fc07c640eb
--   public._salvar_modelo_servico_mo_core(uuid,jsonb)
--     ANTES  4d13d632ae2c5b931632e93536ae2ddd
--     DEPOIS 1a4c045651694a64c3a99de522b7be53
--   public.excluir_cad(uuid)
--     ANTES  ba41974bab8c81cd2729da7f440dcef3
--     DEPOIS a1e9336258c76ca1fc266c6313dcba4f
--   public._servicos_da_mo_criar(uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 9a54575d8595b31d3e89974e23689ecb
--   public._servico_mo_preencher_preco(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS f8c56394f5adb07c7a42378978d77aa0
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103181000_urg_r4_servicos_da_mo_down.sql - ANTES do 20261103180000_down (r4a), do S1 20261031120000_down
-- (exige _enviar_modelo_para_cad_core = bf28796b) e, atras dele, do L3 20261027100000_down; do S3c 20261101160000_down
-- (exige excluir_cad = ba41974b; fix round 3) - ver mig/md5-b.txt. A IDA exige a 180000 (_salvar_modelo_servico_mo_core = 4d13d632).
-- DROP das 2 funcoes novas, do indice e da coluna: supabase/rollback/20261103181000_urg_r4_servicos_da_mo_down_drop.sql (opcional, depois, horario calmo) - ANTES do _down_drop
-- da r4a (180000) e do 20261103100000_down_drop da Modularidade (ambos recusam enquanto _servicos_da_mo_criar existir).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._enviar_modelo_para_cad_core(uuid,text,text)', 'bf28796bcd86538a3a5b516e9cf356c6', '6c5fc00819b4211eb08d20a1d271c9b2'),
      ('public._aprovar_servico_mo_core(uuid,uuid,boolean,text)', '859dd63992e86cc75b7abeab41dee954', '2ff506f1a250d7f4f79e08fc07c640eb'),
      ('public._salvar_modelo_servico_mo_core(uuid,jsonb)', '4d13d632ae2c5b931632e93536ae2ddd', '1a4c045651694a64c3a99de522b7be53'),
      ('public.excluir_cad(uuid)', 'ba41974bab8c81cd2729da7f440dcef3', 'a1e9336258c76ca1fc266c6313dcba4f')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'urg_r4b: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'producao_terceirizados'
                AND column_name = 'mo_linha_id' AND data_type <> 'uuid') THEN
    RAISE EXCEPTION 'urg_r4b: producao_terceirizados.mo_linha_id existe com outro tipo' USING ERRCODE = 'P0001';
  END IF;
  -- dependencia fixada: a regra do modulo da LOJA (sem JWT, sem atalho de super admin)
  IF md5(pg_get_functiondef(to_regprocedure('public._tenant_modulo_ligado(uuid,text)'))) IS DISTINCT FROM '0c9655642d6b570f9adaf136bcaa09c7' THEN
    RAISE EXCEPTION 'urg_r4b: _tenant_modulo_ligado com texto inesperado - gere de novo' USING ERRCODE = 'P0001';
  END IF;
  -- funcoes NOVAS deste bloco: ausentes ou ja com o texto de DEPOIS
  FOR r IN SELECT * FROM (VALUES
      ('public._servicos_da_mo_criar(uuid,uuid)', '9a54575d8595b31d3e89974e23689ecb'),
      ('public._servico_mo_preencher_preco(uuid)', 'f8c56394f5adb07c7a42378978d77aa0')
    ) AS x(f, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.d THEN
      RAISE EXCEPTION 'urg_r4b: % (nova) com texto inesperado (md5 %) - gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- [urg r4] coluna nova: nullable, sem default (sem reescrita); FK ON DELETE SET NULL (apagar a linha de M.O. NAO apaga o
-- bloco: o vinculo vira NULL e o rev do bloco sobe). So o servidor grava (salvar_terceirizados NAO cita a coluna).
ALTER TABLE public.producao_terceirizados
  ADD COLUMN IF NOT EXISTS mo_linha_id uuid REFERENCES public.modelo_servico_mo(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS producao_terceirizados_mo_linha_idx ON public.producao_terceirizados (mo_linha_id)
  WHERE mo_linha_id IS NOT NULL;
COMMENT ON COLUMN public.producao_terceirizados.mo_linha_id IS
  'Linha de M.O. (modelo_servico_mo) que originou o bloco no Enviar a Explosao (R4). Gravada so pelo servidor; NULL = bloco do PCP.';

CREATE OR REPLACE FUNCTION public._servicos_da_mo_criar(_modelo_id uuid, _cad_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg r4] (P-291 B / P-292 A) Enviar a Explosao: se o CAD ainda NAO tem nenhum bloco de servico, cria 1 bloco por linha de M.O.
-- (tipo + fornecedor), preco = valor da M.O. APROVADA; nao aprovada = bloco SEM preco (o preco entra quando aprovar:
-- _servico_mo_preencher_preco). Ja ha blocos = nada criado nem apagado. Chamada SO pelo servidor (_enviar_modelo_para_cad_core).
-- Fornecedor so vai ao bloco se ainda for empresa de SERVICO da mesma loja; senao o bloco nasce sem fornecedor (B2).
DECLARE v_tenant uuid; v_n integer := 0;
BEGIN
  SELECT c.tenant_id INTO v_tenant FROM public.cad c WHERE c.id = _cad_id AND c.modelo_id = _modelo_id;
  IF v_tenant IS NULL THEN RETURN 0; END IF;
  IF NOT public._tenant_modulo_ligado(v_tenant, 'producao') THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_cad_id::text));   -- mesma chave do salvar_terceirizados (serializa com o PCP)
  IF EXISTS (SELECT 1 FROM public.producao_terceirizados WHERE cad_id = _cad_id) THEN RETURN 0; END IF;
  -- [fix round 2, B-1] CQ (Pre) ja confirmado (reenvio de CAD sem blocos depois do CQ): blocos novos mexeriam em gates ja passados.
  IF EXISTS (SELECT 1 FROM public.controle_qualidade q WHERE q.cad_id = _cad_id AND q.status = 'confirmado') THEN RETURN 0; END IF;
  -- created_at distinto e crescente na ORDEM das linhas de M.O. (a mesma do modelo_mo_resumo): a tela do PCP lista por
  -- created_at, id - os blocos aparecem na ordem da M.O. (senao todos teriam o mesmo now()).
  -- [fix round 2, M-1] linhas de M.O. lidas com FOR KEY SHARE (a mesma trava que a FK mo_linha_id pede): linha apagada e
  -- commitada no meio e PULADA (sem 23503); e o envio chama isto ANTES de travar modelos (ordem do Salvar da M.O.).
  WITH s AS MATERIALIZED (
    SELECT x.* FROM public.modelo_servico_mo x
     WHERE x.modelo_id = _modelo_id AND x.tenant_id = v_tenant AND x.categoria_terceirizado_id IS NOT NULL
     FOR KEY SHARE
  )
  INSERT INTO public.producao_terceirizados
    (cad_id, tenant_id, categoria_terceirizado_id, interno, empresa_id, ativo, preco_metro_unidade, numero_parcelas, mo_linha_id,
     created_at)
  SELECT _cad_id, v_tenant, s.categoria_terceirizado_id, false,
         (SELECT e.id FROM public.empresas e WHERE e.id = s.empresa_id AND e.tenant_id = v_tenant AND e.tipo = 'servico'),
         true, CASE WHEN s.aprovado IS TRUE AND COALESCE(s.valor, 0) > 0 THEN s.valor END, 1, s.id,
         now() + make_interval(secs => (row_number() OVER (ORDER BY ct.ordem, ct.nome, s.created_at, s.id) - 1) / 1000000.0)
    FROM s
    -- [fix round 2, B-2] so servico da MESMA loja e ATIVO; "Geral (legado)" (sem servico) nao vira bloco (Ruling 8)
    JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = v_tenant AND ct.ativo IS TRUE
   ORDER BY ct.ordem, ct.nome, s.created_at, s.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;
REVOKE EXECUTE ON FUNCTION public._servicos_da_mo_criar(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._servico_mo_preencher_preco(_linha_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg r4] (P-292 A) M.O. aprovada DEPOIS do envio: o preco entra nos blocos que nasceram dela e ainda estao SEM preco
-- (NULL ou 0). Preco > 0 (digitado no PCP ou ja preenchido) NUNCA e sobrescrito. O UPDATE sobe o rev do bloco
-- (trg_colab_rev): o PCP aberto recebe pelo merge (Realtime) ou P0409 no proximo Salvar.
DECLARE v_valor numeric; v_aprov boolean; v_tenant uuid; v_n integer := 0;
BEGIN
  SELECT s.valor, s.aprovado, s.tenant_id INTO v_valor, v_aprov, v_tenant FROM public.modelo_servico_mo s WHERE s.id = _linha_id;
  IF v_aprov IS NOT TRUE OR COALESCE(v_valor, 0) <= 0 THEN RETURN 0; END IF;
  UPDATE public.producao_terceirizados pt
     SET preco_metro_unidade = v_valor
   WHERE pt.mo_linha_id = _linha_id AND pt.tenant_id = v_tenant
     AND pt.ativo IS TRUE AND pt.interno IS NOT TRUE
     AND COALESCE(pt.preco_metro_unidade, 0) = 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;
REVOKE EXECUTE ON FUNCTION public._servico_mo_preencher_preco(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._enviar_modelo_para_cad_core(_modelo_id uuid, _observacoes_tecnicas text DEFAULT NULL::text, _ficha_medida_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_cad_id uuid;
  v_new_tid uuid;
  v_grade_total numeric;
  rt record;
  rg record;
  ra record;
  v_idx int := 0;
  v_gate_ok boolean;
  v_gate_label text;
  v_status text;
  v_status_plan text;
  v_status_gate text;
  v_explosao_antes text;  -- [seg s1 M2] GUC app.explosao_sistema (liga e RESTAURA)
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.modelos WHERE id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo';
  END IF;

  -- leves L3 kanban #11: serializa envios do MESMO card. Mesma chave do enforce_unique_fk de cad.modelo_id (o INSERT abaixo
  -- pede de novo a mesma trava - reentrante na mesma transacao): o 2o envio simultaneo espera o 1o e, depois do COMMIT dele,
  -- acha o CAD e segue o caminho idempotente (antes: unique_violation "Ja existe registro em cad...").
  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));

  -- Gate de etapa (configurável por loja, tenant_config.explosao_envio_status): o modelo
  -- só é enviado à Explosão A PARTIR da etapa configurada (ou de qualquer etapa POSTERIOR
  -- na ordem do board). Ausente ⇒ 'aprovado'. Órfã ⇒ fallback 'aprovado'.
  -- ERRCODE P0001 (NÃO 23514 — senão erro-mensagem.ts engole a mensagem PT).
  SELECT status_desenvolvimento, status_planejamento INTO v_status, v_status_plan FROM public.modelos WHERE id = _modelo_id;
  v_status_gate := public._kanban_status_gate(v_tenant, _modelo_id, v_status);
  -- leves L3 (R14 msg reprovado, P-190 A): com a chave ligada, card em 'reprovado' nao tem posicao (gate NULL) - o motivo e o
  -- reprovado, nao a etapa. ASCII com prefixo (a tela traduz: src/lib/erro-mensagem.ts).
  -- [fix round 1, A1 / P-213 A] reprovado = Dev OU Planejamento; reprovado no PLANEJAMENTO nunca vai a Explosao (qualquer
  -- chave - o _kanban_status_gate da 20261027140000 tambem o tira da regua; aqui fica independente dela).
  IF public._kanban_norm(v_status_plan) = 'reprovado'
     OR (v_status_gate IS NULL AND public._kanban_norm(v_status) = 'reprovado') THEN
    RAISE EXCEPTION 'reprovado_explosao: Card reprovado nao vai a Explosao' USING ERRCODE = 'P0001';
  END IF;
  SELECT g.ok, g.req_label INTO v_gate_ok, v_gate_label
    FROM public._explosao_envio_gate(v_tenant, v_status_gate) AS g;
  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;

  -- IDEMPOTENTE: se o CAD já existe (o save do card cria/sincroniza), NÃO recria.
  -- Só atualiza observações/ficha (se informadas) e marca o modelo como enviado à Explosão.
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id ORDER BY id LIMIT 1;
  IF v_cad_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_cad_id::text));  -- [urg r4] mesma chave/ordem do salvar_terceirizados
    UPDATE public.cad
       SET observacoes_tecnicas = COALESCE(_observacoes_tecnicas, observacoes_tecnicas),
           ficha_medida_url     = COALESCE(_ficha_medida_url, ficha_medida_url)
     WHERE id = v_cad_id;
    PERFORM public._servicos_da_mo_criar(_modelo_id, v_cad_id);  -- [urg r4] blocos de Servicos nascem da M.O. (antes de modelos)
    v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] a guarda de modelos so aceita enviado_cad com a GUC
    PERFORM set_config('app.explosao_sistema', 'on', true);
    UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
    PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);
    RETURN v_cad_id;
  END IF;

  INSERT INTO public.cad (modelo_id, observacoes_tecnicas, ficha_medida_url, status_corte)
  VALUES (_modelo_id, _observacoes_tecnicas, _ficha_medida_url, 'pendente')
  RETURNING id INTO v_cad_id;

  -- Copia tecidos + variantes (preserva ordem e multiplicador).
  FOR rt IN
    SELECT id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto
    FROM public.modelo_tecidos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    INSERT INTO public.cad_tecidos
      (cad_id, artigo_id, numero, tipo, consumo_cad, loss_percent_cad, custo_cad, tamanho_folha)
    VALUES
      (v_cad_id, rt.artigo_id, rt.numero, rt.tipo,
       COALESCE(rt.consumo, 0), COALESCE(rt.loss_percent, 0), COALESCE(rt.custo_previsto, 0), 0)
    RETURNING id INTO v_new_tid;

    INSERT INTO public.cad_tecido_variantes
      (cad_tecido_id, variante_tecido_id, ordem, multiplicador,
       quantidade_folhas, metragem_planejada, metragem_enviada, complementa_variante_ids)
    SELECT v_new_tid, mtv.variante_tecido_id, mtv.ordem,
           COALESCE(mtv.multiplicador, 1), 0, 0, 0, mtv.complementa_variante_ids
    FROM public.modelo_tecido_variantes mtv
    WHERE mtv.modelo_tecido_id = rt.id;
  END LOOP;

  -- Copia grade planejada -> cad_grades (planejada = real).
  v_grade_total := 0;
  FOR rg IN
    SELECT variante_numero, grades, grade_total
    FROM public.modelo_grades WHERE modelo_id = _modelo_id
  LOOP
    INSERT INTO public.cad_grades
      (cad_id, variante_numero, grades_planejadas, grades_reais,
       grade_total_planejada, grade_total_real)
    VALUES
      (v_cad_id, rg.variante_numero,
       COALESCE(rg.grades, '{}'::jsonb), COALESCE(rg.grades, '{}'::jsonb),
       COALESCE(rg.grade_total, 0), COALESCE(rg.grade_total, 0));
    v_grade_total := v_grade_total + COALESCE(rg.grade_total, 0);
  END LOOP;

  -- Copia aviamentos (qtd = consumo * grade total geral; numero sequencial).
  -- [NOVO] leva a variante_aviamento_id do BOM p/ o CAD → cad_aviamentos vira
  -- POR aviamento×variante (base da "a separar" editável por variante na Explosão).
  FOR ra IN
    SELECT aviamento_id, consumo, variante_aviamento_id
    FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.cad_aviamentos
      (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar, variante_aviamento_id)
    VALUES
      (v_cad_id, ra.aviamento_id, v_idx,
       COALESCE(ra.consumo, 0),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ra.variante_aviamento_id);
  END LOOP;

  PERFORM public._servicos_da_mo_criar(_modelo_id, v_cad_id);  -- [urg r4] (antes de modelos)
  v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] idem
  PERFORM set_config('app.explosao_sistema', 'on', true);
  UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
  PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);

  RETURN v_cad_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._aprovar_servico_mo_core(_modelo_id uuid, _linha_id uuid, _aprovado boolean, _motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  -- [urg r4] mesma ordem de trava do Enviar a Explosao: chave do card -> chave do CAD (a do salvar_terceirizados) -> linha de M.O. -> blocos
  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));
  PERFORM pg_advisory_xact_lock(hashtext(c.id::text)) FROM public.cad c WHERE c.modelo_id = _modelo_id ORDER BY c.id;
  IF _aprovado = false AND COALESCE(btrim(_motivo),'') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.modelo_servico_mo
     SET aprovado = _aprovado,
         motivo_reprovacao = CASE WHEN _aprovado THEN NULL ELSE _motivo END,
         updated_at = now()
   WHERE id = _linha_id
     AND modelo_id = _modelo_id
     AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de mão de obra não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  -- [urg r4] aprovou: o preco entra nos blocos de Servicos que nasceram desta linha e estao sem preco.
  IF _aprovado THEN PERFORM public._servico_mo_preencher_preco(_linha_id); END IF;
END $function$;

CREATE OR REPLACE FUNCTION public._salvar_modelo_servico_mo_core(_modelo_id uuid, _linhas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_keep uuid[] := '{}';   -- ids de linha presentes no payload (mantidos)
  r jsonb; v_id uuid; v_cat uuid; v_valor numeric; v_obs text;
  v_emp uuid; v_emp_tem boolean;  -- [urg r4] fornecedor de servico da linha
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  -- [urg r4b] chave do card ANTES de tocar linhas de M.O. / modelos: serializa com o Enviar a Explosao e o aprovar (mesma 1a chave)
  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));
  IF jsonb_typeof(_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido: as linhas de MO devem ser uma lista' USING ERRCODE = 'P0001';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(_linhas) LOOP
    v_id  := NULLIF(r->>'id','')::uuid;
    v_cat := NULLIF(r->>'categoria_terceirizado_id','')::uuid;
    v_valor := COALESCE((r->>'valor')::numeric, 0);
    v_obs := NULLIF(r->>'observacoes','');
    -- [urg r4] fornecedor de servico da linha (empresas tipo 'servico' da loja; P-289 C: TODOS, nao so PL; pode ficar vazio).
    -- Chave AUSENTE = mantem o gravado (cards de Produto Acabado/Importado e site antigo nao mandam a chave).
    v_emp_tem := r ? 'empresa_id';
    v_emp := NULLIF(r->>'empresa_id','')::uuid;
    IF v_emp IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.modelo_servico_mo x
                        WHERE x.id = v_id AND x.modelo_id = _modelo_id AND x.empresa_id = v_emp)
       AND NOT EXISTS (SELECT 1 FROM public.empresas e
                        WHERE e.id = v_emp AND e.tenant_id = v_tenant AND e.tipo = 'servico') THEN
      RAISE EXCEPTION 'Fornecedor de serviço inválido' USING ERRCODE = 'P0001';
    END IF;

    -- Categoria (quando informada) tem que ser do tenant.
    IF v_cat IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.categorias_terceirizado WHERE id = v_cat AND tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'Serviço inválido' USING ERRCODE = 'P0001';
    END IF;

    IF v_id IS NOT NULL THEN
      -- Linha EXISTENTE (por id): atualiza valor/obs/categoria; preserva `aprovado`. Só do próprio modelo.
      UPDATE public.modelo_servico_mo
         SET valor = v_valor, observacoes = v_obs, categoria_terceirizado_id = v_cat, updated_at = now(),
             empresa_id = CASE WHEN v_emp_tem THEN v_emp ELSE empresa_id END  -- [urg r4]
       WHERE id = v_id AND modelo_id = _modelo_id AND tenant_id = v_tenant;
      IF FOUND THEN
        v_keep := array_append(v_keep, v_id);
      ELSE
        -- id não é deste modelo/tenant (payload inconsistente) — ignora silenciosamente (não vaza).
        CONTINUE;
      END IF;
    ELSE
      -- Linha NOVA (sem id): categoria real precisa estar ATIVA (soft-hide barra novo serviço).
      -- "Geral (legado)" (v_cat NULL) segue permitido como linha nova.
      IF v_cat IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categorias_terceirizado WHERE id = v_cat AND tenant_id = v_tenant AND ativo = true
      ) THEN
        RAISE EXCEPTION 'Serviço desativado' USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, observacoes, empresa_id)
      VALUES (v_tenant, _modelo_id, v_cat, v_valor, v_obs, v_emp)  -- [urg r4]
      RETURNING id INTO v_id;
      v_keep := array_append(v_keep, v_id);
    END IF;
  END LOOP;

  -- Estado completo: apaga as linhas do modelo cujo id NÃO veio no payload.
  DELETE FROM public.modelo_servico_mo
   WHERE modelo_id = _modelo_id
     AND NOT (id = ANY(v_keep));
END $function$;

CREATE OR REPLACE FUNCTION public.excluir_cad(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_modelo uuid; v_enviado boolean;
  v_explosao_antes text;  -- [seg s1 M2]
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [seg s3c] permissao de PAGINA no servidor (Reforco de seguranca S3c, P-231 = D2 A): exige EDITAR criacao_desenvolvimento.
  PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  SELECT tenant_id, modelo_id, COALESCE(enviado_corte, false)
    INTO v_tenant, v_modelo, v_enviado FROM public.cad WHERE id = _cad_id;
  IF v_modelo IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  -- [urg r4b] mesma ordem de trava do envio/aprovar/Salvar do PCP: chave do card -> chave do CAD -> linhas
  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || v_modelo::text));
  PERFORM pg_advisory_xact_lock(hashtext(_cad_id::text));
  -- [urg r4b] rele o CAD DEPOIS das chaves (e trava a linha): quem chegou antes (envio ao corte, outra exclusao) ja commitou
  SELECT tenant_id, modelo_id, COALESCE(enviado_corte, false)
    INTO v_tenant, v_modelo, v_enviado FROM public.cad WHERE id = _cad_id FOR UPDATE;
  IF v_modelo IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_enviado THEN
    RAISE EXCEPTION 'Este CAD já foi enviado ao corte (baixou estoque). Reverta o corte antes de excluir.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lancamentos WHERE cad_id = _cad_id) THEN
    RAISE EXCEPTION 'Este CAD tem lançamentos e não pode ser excluído.';
  END IF;
  DELETE FROM public.cad WHERE id = _cad_id;  -- rascunho (sem corte): cascatas internas ok
  v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] excluir o CAD (rascunho) devolve o card
  PERFORM set_config('app.explosao_sistema', 'on', true);
  UPDATE public.modelos SET enviado_cad = false WHERE id = v_modelo;
  PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);
END;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._enviar_modelo_para_cad_core(uuid,text,text)', '6c5fc00819b4211eb08d20a1d271c9b2', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public._aprovar_servico_mo_core(uuid,uuid,boolean,text)', '2ff506f1a250d7f4f79e08fc07c640eb', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public._salvar_modelo_servico_mo_core(uuid,jsonb)', '1a4c045651694a64c3a99de522b7be53', '{postgres=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r4b: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r4b: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'producao_terceirizados'
                   AND column_name = 'mo_linha_id' AND data_type = 'uuid' AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'urg_r4b: pos-condicao falhou na coluna producao_terceirizados.mo_linha_id' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = 'public.producao_terceirizados'::regclass AND k.contype = 'f'
                    AND k.confrelid = 'public.modelo_servico_mo'::regclass AND k.confdeltype = 'n' AND k.confupdtype = 'a'
                    AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.producao_terceirizados'::regclass
                                           AND attname = 'mo_linha_id')]::smallint[]) THEN
    RAISE EXCEPTION 'urg_r4b: pos-condicao falhou na FK mo_linha_id -> modelo_servico_mo(id) ON DELETE SET NULL' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indexrelid = to_regclass('public.producao_terceirizados_mo_linha_idx') AND i.indisvalid
                    AND pg_get_indexdef(i.indexrelid) = 'CREATE INDEX producao_terceirizados_mo_linha_idx ON public.producao_terceirizados USING btree (mo_linha_id) WHERE (mo_linha_id IS NOT NULL)') THEN
    RAISE EXCEPTION 'urg_r4b: pos-condicao falhou no indice producao_terceirizados_mo_linha_idx' USING ERRCODE = 'P0001';
  END IF;
  IF has_column_privilege('authenticated', 'public.producao_terceirizados', 'mo_linha_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.producao_terceirizados', 'mo_linha_id', 'INSERT')
     OR has_column_privilege('anon', 'public.producao_terceirizados', 'mo_linha_id', 'SELECT') THEN
    RAISE EXCEPTION 'urg_r4b: pos-condicao falhou nos privilegios da coluna mo_linha_id' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._servicos_da_mo_criar(uuid,uuid)', '9a54575d8595b31d3e89974e23689ecb'),
      ('public._servico_mo_preencher_preco(uuid)', 'f8c56394f5adb07c7a42378978d77aa0')
    ) AS x(f, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'urg_r4b: pos-condicao falhou em % (nova; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.d USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r4b: pos-condicao falhou na ACL/secdef/search_path de % (nova)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.excluir_cad(uuid)', 'a1e9336258c76ca1fc266c6313dcba4f', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r4b: pos-condicao falhou em % (wrapper; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r4b: pos-condicao falhou na ACL/secdef/search_path de % (wrapper)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
