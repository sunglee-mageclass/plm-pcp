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
--   4) _enviar_modelo_para_cad_core: nos 2 caminhos (CAD ja existia / CAD novo), depois de restaurar a GUC
--      app.explosao_sistema, chama a (2). _aprovar_servico_mo_core: aprovou -> chama a (3).
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
--     DEPOIS ada02368e68996e2d52337d68b42c2c4
--   public._aprovar_servico_mo_core(uuid,uuid,boolean,text)
--     ANTES  859dd63992e86cc75b7abeab41dee954
--     DEPOIS 5ce4cc9e8696b1495e8248eccce3f8d3
--   public._servicos_da_mo_criar(uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 8b008cdb9e69383c5fb6488f4e012c21
--   public._servico_mo_preencher_preco(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS f8c56394f5adb07c7a42378978d77aa0
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103181000_urg_r4_servicos_da_mo_down.sql - ANTES do 20261103180000_down (r4a), do S1 20261031120000_down
-- (exige _enviar_modelo_para_cad_core = bf28796b) e, atras dele, do L3 20261027100000_down (ver mig/md5-b.txt).
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
      ('public._enviar_modelo_para_cad_core(uuid,text,text)', 'bf28796bcd86538a3a5b516e9cf356c6', 'ada02368e68996e2d52337d68b42c2c4'),
      ('public._aprovar_servico_mo_core(uuid,uuid,boolean,text)', '859dd63992e86cc75b7abeab41dee954', '5ce4cc9e8696b1495e8248eccce3f8d3')
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
      ('public._servicos_da_mo_criar(uuid,uuid)', '8b008cdb9e69383c5fb6488f4e012c21'),
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
  INSERT INTO public.producao_terceirizados
    (cad_id, tenant_id, categoria_terceirizado_id, interno, empresa_id, ativo, preco_metro_unidade, numero_parcelas, mo_linha_id)
  SELECT _cad_id, v_tenant, s.categoria_terceirizado_id, false,
         (SELECT e.id FROM public.empresas e WHERE e.id = s.empresa_id AND e.tenant_id = v_tenant AND e.tipo = 'servico'),
         true, CASE WHEN s.aprovado IS TRUE AND COALESCE(s.valor, 0) > 0 THEN s.valor END, 1, s.id
    FROM public.modelo_servico_mo s
    LEFT JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
   WHERE s.modelo_id = _modelo_id AND s.tenant_id = v_tenant
     AND s.categoria_terceirizado_id IS NOT NULL                -- "Geral (legado)" nao vira bloco (Ruling 8)
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
    UPDATE public.cad
       SET observacoes_tecnicas = COALESCE(_observacoes_tecnicas, observacoes_tecnicas),
           ficha_medida_url     = COALESCE(_ficha_medida_url, ficha_medida_url)
     WHERE id = v_cad_id;
    v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] a guarda de modelos so aceita enviado_cad com a GUC
    PERFORM set_config('app.explosao_sistema', 'on', true);
    UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
    PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);
    PERFORM public._servicos_da_mo_criar(_modelo_id, v_cad_id);  -- [urg r4] blocos de Servicos nascem da M.O.
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

  v_explosao_antes := current_setting('app.explosao_sistema', true);  -- [seg s1 M2] idem
  PERFORM set_config('app.explosao_sistema', 'on', true);
  UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
  PERFORM set_config('app.explosao_sistema', coalesce(v_explosao_antes, ''), true);
  PERFORM public._servicos_da_mo_criar(_modelo_id, v_cad_id);  -- [urg r4]

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

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._enviar_modelo_para_cad_core(uuid,text,text)', 'ada02368e68996e2d52337d68b42c2c4', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public._aprovar_servico_mo_core(uuid,uuid,boolean,text)', '5ce4cc9e8696b1495e8248eccce3f8d3', '{postgres=X/postgres,service_role=X/postgres}')
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
      ('public._servicos_da_mo_criar(uuid,uuid)', '8b008cdb9e69383c5fb6488f4e012c21'),
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
END
$pos$;

COMMIT;
