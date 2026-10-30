-- Inverso NEUTRO de supabase/migrations/20261103199400_urg_r11_salvar_mini.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 4 / R11e; Rulings aceitos + RESPOSTAS DO DONO P-349/P-365/P-366).
-- NEUTRO: os 2 cores voltam ao texto da R9 (sem a chave mini e sem o passo da mini); _peca_teste_mini_aplicar vira no-op e
-- perde o EXECUTE do authenticated (ela ja nasce sem); _peca_teste_trilha_mini fica inerte. Idempotente. Remover = _down_drop.
-- Trava (MEDIDA, mesma receita): devolve os 2 textos da R9 (CREATE OR REPLACE) e a _peca_teste_mini_aplicar vira NEUTRA +
--   REVOKE do authenticated (ela ja nasce sem; e no-op) - SO catalogo; 0 em auth/storage/realtime. Idempotente.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._salvar_peca_teste_core(uuid,jsonb,jsonb)
--     ANTES  eccde92e1c6687045f8f7c9ae61caf8f
--     DEPOIS 3e3b9db2d04dd176a4712898293f8545
--   public._peca_teste_trilhas_core(uuid,uuid)
--     ANTES  5ae0f7025744d63508d7617e6e3a7487
--     DEPOIS ef860a61e25750d2d12131062a23202d
--   public._peca_teste_trilha_mini(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 348c7e9978e7f6c0a48812baccc65a5e
--   public._peca_teste_mini_aplicar(uuid,uuid,jsonb) (NOVA)
--     ANTES  ausente
--     DEPOIS 86573744c113efe92fec638b0db89fe6
--     NEUTRO 2dbec37294d192919e72a0a9ae52ef7a (_down)
--   dependencias FIXADAS (nao redefinidas):
--     public._peca_teste_mini_baixar(uuid,jsonb) 444861eae9b28bc09ec3bfd80bc01033
--     public._peca_teste_mini_estornar(uuid) c8f160a73b3a30a6105c7a45aff9c89d
--     public._peca_teste_mini_linhas(uuid,text,uuid,jsonb) 3d73d0db8fc0902c5bd07edfbfa2fe70
--     public._peca_teste_mini_tem_historico(uuid) 10c05fae5041077c6dc23436d66f7d44
-- ====================================================================================
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
      ('public._salvar_peca_teste_core(uuid,jsonb,jsonb)', 'eccde92e1c6687045f8f7c9ae61caf8f', '3e3b9db2d04dd176a4712898293f8545'),
      ('public._peca_teste_trilhas_core(uuid,uuid)', '5ae0f7025744d63508d7617e6e3a7487', 'ef860a61e25750d2d12131062a23202d')
    ) AS x(f, a, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.d) THEN
      RAISE EXCEPTION 'urg_r11e_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- funcoes NOVAS deste bloco: presentes, com o texto de DEPOIS ou o NEUTRO (2a vez) - o _down nao as cria
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_trilha_mini(uuid)', '348c7e9978e7f6c0a48812baccc65a5e', '348c7e9978e7f6c0a48812baccc65a5e', false),
      ('public._peca_teste_mini_aplicar(uuid,uuid,jsonb)', '86573744c113efe92fec638b0db89fe6', '2dbec37294d192919e72a0a9ae52ef7a', false)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL THEN
      RAISE EXCEPTION 'urg_r11e_down: % ausente - a 20261103199400 nao foi aplicada aqui (ou o _down_drop ja rodou)', r.f USING ERRCODE = 'P0001';
    END IF;
    IF v NOT IN (r.d, r.n) THEN
      RAISE EXCEPTION 'urg_r11e_down: % (nova) com texto inesperado (md5 %) - outra frente mexeu', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) funcoes EXISTENTES de volta ao texto de ANTES
CREATE OR REPLACE FUNCTION public._salvar_peca_teste_core(_modelo_id uuid, _trilhas jsonb, _rev_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_uid uuid := auth.uid();
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_dia constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_revs jsonb;
  v_forns jsonb;
  v_ids uuid[];
  tr jsonb;
  tt jsonb;
  v_linha uuid;
  v_cat uuid;
  v_forn uuid;
  v_t public.modelo_peca_teste_tentativas%ROWTYPE;
  v_id uuid;
  v_num integer;
  v_saida date;
  v_entrada date;
  v_aprov text;
  v_max integer;
  v_ult text;
  v_novo uuid;
  v_base uuid;
  v_congela uuid;
BEGIN
  -- [urg r9b] Salvar da secao Peca Teste (grava SO no Salvar do card; payload = so as trilhas tocadas, delta). Ordem:
  -- (1) card da loja + formato; (2) chave do card PRIMEIRO (a mesma 1a chave do Enviar a Explosao, do aprovar M.O., do Salvar da M.O.
  -- e do excluir_cad; a Peca Teste nao toca CAD/blocos); (3) linhas de M.O. FOR UPDATE (ordem de id) - sumiu/tipo mudou/switch
  -- desligado = P0409; (4) tentativas FOR UPDATE (ordem de id), aplicadas (existentes primeiro, novas por numero); (5) fornecedor da
  -- linha por compare-and-set, na MESMA transacao (reabre a M.O. pelo gatilho; a trava morde se a atual, ja com o passo 4, estiver
  -- aprovada). Toda escrita grava updated_at = now() (revisao T1, achado 6). Decisao (aprovar/reprovar) congela em empresa_id o
  -- fornecedor da linha ANTES da troca deste mesmo Salvar (Ruling 8; revisao T1, achado 1) - CONFERIDO contra o que a pessoa viu
  -- (_rev_base.fornecedor da linha, obrigatorio em toda decisao; revisao T2, achados 1 e 2) e nunca vazio (achado 3). A trilha e
  -- conferida pelo TIPO ATUAL da linha (categoria_id obrigatorio; outro = P0409) e tentativa nova nunca nasce decidida (T6, achado 1).
  IF NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'peca_teste_modelo: nao encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_trilhas) IS DISTINCT FROM 'array' OR jsonb_typeof(_rev_base) IS DISTINCT FROM 'object'
     OR jsonb_typeof(coalesce(_rev_base->'tentativas', '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(coalesce(_rev_base->'fornecedor', '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'peca_teste_formato: _trilhas tem de ser lista e _rev_base objeto' USING ERRCODE = 'P0001';
  END IF;
  v_revs := coalesce(_rev_base->'tentativas', '{}'::jsonb);
  v_forns := coalesce(_rev_base->'fornecedor', '{}'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x
              WHERE jsonb_typeof(x) <> 'object'
                 OR coalesce(x->>'mo_linha_id', '') !~ v_uuid
                 OR coalesce(x->>'categoria_id', '') !~ v_uuid
                 OR jsonb_typeof(coalesce(x->'tentativas', '[]'::jsonb)) <> 'array'
                 OR (x ? 'empresa_id' AND jsonb_typeof(x->'empresa_id') NOT IN ('string', 'null'))
                 OR (x ? 'empresa_id' AND x->>'empresa_id' IS NOT NULL AND x->>'empresa_id' !~ v_uuid))
     OR (SELECT count(*) <> count(DISTINCT lower(x->>'mo_linha_id')) FROM jsonb_array_elements(_trilhas) x) THEN
    RAISE EXCEPTION 'peca_teste_formato: trilha invalida ou repetida' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t
              WHERE jsonb_typeof(t) <> 'object'
                 OR (t->>'id' IS NOT NULL AND t->>'id' !~ v_uuid)
                 OR (t->>'id' IS NULL AND coalesce(t->>'numero', '') !~ '^[1-9][0-9]{0,5}$')
                 OR coalesce(t->>'data_saida', '2000-01-01') !~ v_dia
                 OR coalesce(t->>'data_entrada', '2000-01-01') !~ v_dia
                 OR coalesce(t->>'aprovacao', 'aprovado') !~ '^(aprovado|reprovado)$')
     OR (SELECT count(t->>'id') <> count(DISTINCT lower(t->>'id'))
           FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t) THEN
    RAISE EXCEPTION 'peca_teste_formato: tentativa invalida ou repetida' USING ERRCODE = 'P0001';
  END IF;
  -- tentativa NOVA nunca nasce decidida (revisao T6, achado 1: um payload velho/mesclado de uma linha cujo TIPO mudou levava a
  -- aprovacao do tipo antigo para a trilha nova): decide-se so a tentativa ja GRAVADA (que tem id da trilha atual; com as 2 datas
  -- no Salvar da decisao - peca_teste_sem_datas abaixo)
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t
              WHERE t->>'id' IS NULL AND t->>'aprovacao' IS NOT NULL) THEN
    RAISE EXCEPTION 'peca_teste_sem_datas: tentativa nova nao nasce aprovada ou reprovada - salve as datas antes de decidir' USING ERRCODE = 'P0001';
  END IF;
  -- data no formato mas inexistente (ex.: 2026-02-30) = o mesmo P0001 com prefixo (nao o 22008 cru)
  BEGIN
    PERFORM count((t->>'data_saida')::date) + count((t->>'data_entrada')::date)
       FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'peca_teste_formato: data invalida' USING ERRCODE = 'P0001';
  END;

  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));

  SELECT coalesce(array_agg((x->>'mo_linha_id')::uuid), '{}'::uuid[]) INTO v_ids FROM jsonb_array_elements(_trilhas) x;
  PERFORM 1 FROM public.modelo_servico_mo s
    WHERE s.id = ANY(v_ids) AND s.modelo_id = _modelo_id AND s.tenant_id = v_tenant
    ORDER BY s.id FOR UPDATE;
  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    IF NOT EXISTS (SELECT 1 FROM public.modelo_servico_mo s
                     JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = v_tenant
                                                           AND ct.exige_peca_teste
                    WHERE s.id = (tr->>'mo_linha_id')::uuid AND s.modelo_id = _modelo_id AND s.tenant_id = v_tenant
                      AND s.categoria_terceirizado_id = (tr->>'categoria_id')::uuid) THEN
      RAISE EXCEPTION 'peca_teste_desatualizada: servico da mao de obra mudou' USING ERRCODE = 'P0409';
    END IF;
  END LOOP;
  PERFORM 1 FROM public.modelo_peca_teste_tentativas t WHERE t.mo_linha_id = ANY(v_ids) ORDER BY t.id FOR UPDATE;

  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    v_linha := (tr->>'mo_linha_id')::uuid;
    v_cat := (tr->>'categoria_id')::uuid;
    SELECT s.empresa_id INTO v_forn FROM public.modelo_servico_mo s WHERE s.id = v_linha;  -- ANTES da troca deste Salvar
    v_congela := v_forn;
    -- DECISAO (nova com aprovacao, ou existente cuja aprovacao muda para aprovado/reprovado): o fornecedor que a pessoa viu
    -- (_rev_base.fornecedor) tem de ser o da linha; a peca e decidida para ELE (revisao T2, achados 1-3)
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x
                LEFT JOIN public.modelo_peca_teste_tentativas t ON t.id = (x->>'id')::uuid
               WHERE x->>'aprovacao' IS NOT NULL AND (x->>'id' IS NULL OR t.aprovacao IS DISTINCT FROM x->>'aprovacao')) THEN
      IF NOT (v_forns ? v_linha::text) OR jsonb_typeof(v_forns->v_linha::text) NOT IN ('string', 'null')
         OR (v_forns->>v_linha::text IS NOT NULL AND v_forns->>v_linha::text !~ v_uuid) THEN
        RAISE EXCEPTION 'peca_teste_formato: aprovar ou reprovar exige _rev_base.fornecedor da linha' USING ERRCODE = 'P0001';
      END IF;
      v_base := (v_forns->>v_linha::text)::uuid;
      IF v_base IS DISTINCT FROM v_forn THEN
        IF tr ? 'empresa_id' AND (tr->>'empresa_id')::uuid IS NOT DISTINCT FROM v_forn THEN
          -- a troca DESTE Salvar ja foi gravada (o Salvar da M.O. rodou antes): decide sobre o fornecedor de ANTES (Ruling 8) -
          -- aprovar + trocar juntos = o mesmo P0001 da trava; reprovar congela o de antes (quem fez a peca)
          IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x
                      LEFT JOIN public.modelo_peca_teste_tentativas t ON t.id = (x->>'id')::uuid
                     WHERE x->>'aprovacao' = 'aprovado' AND (x->>'id' IS NULL OR t.aprovacao IS DISTINCT FROM 'aprovado')) THEN
            RAISE EXCEPTION 'peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor' USING ERRCODE = 'P0001';
          END IF;
          -- a base vem do cliente: so congela fornecedor de SERVICO desta loja (revisao T2, achado 8; o mesmo criterio da troca)
          IF v_base IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.empresas e
                                                 WHERE e.id = v_base AND e.tenant_id = v_tenant AND e.tipo = 'servico') THEN
            RAISE EXCEPTION 'peca_teste_fornecedor_invalido: fornecedor de servico invalido' USING ERRCODE = 'P0001';
          END IF;
          v_congela := v_base;
        ELSE
          RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
        END IF;
      END IF;
      IF v_congela IS NULL THEN
        RAISE EXCEPTION 'peca_teste_sem_fornecedor: defina o fornecedor da M.O. antes de aprovar ou reprovar a peca teste'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    -- tentativas EXISTENTES (id): rev = a base; reprovada = so leitura; aprovada mantida = datas travadas; tudo vazio = DELETE
    FOR tt IN SELECT x FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x->>'id' IS NOT NULL LOOP
      v_id := (tt->>'id')::uuid;
      SELECT * INTO v_t FROM public.modelo_peca_teste_tentativas t
       WHERE t.id = v_id AND t.mo_linha_id = v_linha AND t.categoria_terceirizado_id = v_cat AND t.tenant_id = v_tenant;
      IF NOT FOUND OR coalesce(v_revs->>v_id::text, '') !~ '^[0-9]{1,9}$' OR v_t.rev <> (v_revs->>v_id::text)::integer THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END IF;
      v_saida := (tt->>'data_saida')::date;
      v_entrada := (tt->>'data_entrada')::date;
      v_aprov := tt->>'aprovacao';
      -- reprovada (o CHECK da tabela so aceita aprovado/reprovado; sem o literal: o anti-drift da Mod T4 reserva o literal reprovado ao
      -- status do card)
      IF v_t.aprovacao IS NOT NULL AND v_t.aprovacao <> 'aprovado' THEN
        IF v_saida IS DISTINCT FROM v_t.data_saida OR v_entrada IS DISTINCT FROM v_t.data_entrada OR v_aprov IS DISTINCT FROM v_t.aprovacao THEN
          RAISE EXCEPTION 'peca_teste_historico: tentativa reprovada e so leitura' USING ERRCODE = 'P0001';
        END IF;
        CONTINUE;
      END IF;
      IF v_t.aprovacao = 'aprovado' AND v_aprov = 'aprovado'
         AND (v_saida IS DISTINCT FROM v_t.data_saida OR v_entrada IS DISTINCT FROM v_t.data_entrada) THEN
        RAISE EXCEPTION 'peca_teste_aprovada_travada: datas da peca aprovada nao mudam (desfaca a aprovacao antes)' USING ERRCODE = 'P0001';
      END IF;
      IF v_saida IS NULL AND v_entrada IS NULL AND v_aprov IS NULL THEN
        DELETE FROM public.modelo_peca_teste_tentativas WHERE id = v_id;  -- volta a VIRTUAL
        CONTINUE;
      END IF;
      IF v_aprov IS NOT NULL AND (v_saida IS NULL OR v_entrada IS NULL) THEN
        RAISE EXCEPTION 'peca_teste_sem_datas: aprovar ou reprovar exige data de saida e data de entrada' USING ERRCODE = 'P0001';
      END IF;
      IF v_saida IS NOT DISTINCT FROM v_t.data_saida AND v_entrada IS NOT DISTINCT FROM v_t.data_entrada
         AND v_aprov IS NOT DISTINCT FROM v_t.aprovacao THEN
        CONTINUE;  -- nada mudou: nao sobe o rev
      END IF;
      UPDATE public.modelo_peca_teste_tentativas t
         SET data_saida = v_saida,
             data_entrada = v_entrada,
             aprovacao = v_aprov,
             decidido_em = CASE WHEN v_aprov IS NULL THEN NULL WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN now() ELSE t.decidido_em END,
             decidido_por = CASE WHEN v_aprov IS NULL THEN NULL WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN v_uid ELSE t.decidido_por END,
             -- decidir congela o fornecedor; aprovado -> reprovado guarda o de quem fez a peca (o congelado); desfazer limpa
             empresa_id = CASE WHEN v_aprov IS NULL THEN NULL
                               WHEN v_t.aprovacao IS NULL THEN v_congela
                               WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN coalesce(t.empresa_id, v_congela)
                               ELSE t.empresa_id END,
             updated_at = now()
       WHERE t.id = v_id;
    END LOOP;
    -- tentativas NOVAS (id nulo), por numero: so a proxima depois de uma reprovada (ou a 1a); so nulos = ignora
    FOR tt IN SELECT x FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x->>'id' IS NULL
               ORDER BY (x->>'numero')::integer LOOP
      v_num := (tt->>'numero')::integer;
      v_saida := (tt->>'data_saida')::date;
      v_entrada := (tt->>'data_entrada')::date;
      v_aprov := tt->>'aprovacao';
      IF v_saida IS NULL AND v_entrada IS NULL AND v_aprov IS NULL THEN
        CONTINUE;
      END IF;
      SELECT t.numero, t.aprovacao INTO v_max, v_ult FROM public.modelo_peca_teste_tentativas t
       WHERE t.mo_linha_id = v_linha AND t.categoria_terceirizado_id = v_cat ORDER BY t.numero DESC LIMIT 1;
      IF NOT FOUND THEN
        v_max := 0;      -- nenhuma tentativa: a nova e a 1a
      ELSIF v_ult IS NULL OR v_ult = 'aprovado' THEN
        v_max := NULL;   -- a atual nao foi reprovada: nao ha "proxima" (outra pessoa ja lancou a tentativa)
      END IF;
      IF v_max IS NULL OR v_num <> v_max + 1 THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END IF;
      IF v_aprov IS NOT NULL AND (v_saida IS NULL OR v_entrada IS NULL) THEN
        RAISE EXCEPTION 'peca_teste_sem_datas: aprovar ou reprovar exige data de saida e data de entrada' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        INSERT INTO public.modelo_peca_teste_tentativas
          (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, empresa_id, data_saida, data_entrada, aprovacao,
           decidido_em, decidido_por, created_by, updated_at)
        VALUES (v_tenant, _modelo_id, v_linha, v_cat, v_num, CASE WHEN v_aprov IS NOT NULL THEN v_congela END, v_saida, v_entrada, v_aprov,
                CASE WHEN v_aprov IS NOT NULL THEN now() END, CASE WHEN v_aprov IS NOT NULL THEN v_uid END, v_uid, now());
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END;
    END LOOP;
  END LOOP;

  -- fornecedor da linha (so as trilhas com a chave empresa_id): compare-and-set idempotente (Ruling 9)
  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x WHERE x ? 'empresa_id' LOOP
    v_linha := (tr->>'mo_linha_id')::uuid;
    v_novo := (tr->>'empresa_id')::uuid;
    SELECT s.empresa_id INTO v_forn FROM public.modelo_servico_mo s WHERE s.id = v_linha;
    IF v_forn IS NOT DISTINCT FROM v_novo THEN
      CONTINUE;  -- o Salvar da M.O. ja gravou o mesmo (ou nada mudou)
    END IF;
    IF NOT (v_forns ? v_linha::text) OR jsonb_typeof(v_forns->v_linha::text) NOT IN ('string', 'null')
       OR (v_forns->>v_linha::text IS NOT NULL AND v_forns->>v_linha::text !~ v_uuid) THEN
      RAISE EXCEPTION 'peca_teste_formato: falta _rev_base.fornecedor da linha' USING ERRCODE = 'P0001';
    END IF;
    v_base := (v_forns->>v_linha::text)::uuid;
    IF v_forn IS DISTINCT FROM v_base THEN
      RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
    END IF;
    IF v_novo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = v_novo AND e.tenant_id = v_tenant AND e.tipo = 'servico') THEN
      RAISE EXCEPTION 'peca_teste_fornecedor_invalido: fornecedor de servico invalido' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.modelo_servico_mo SET empresa_id = v_novo, updated_at = now() WHERE id = v_linha;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public._peca_teste_trilhas_core(_tenant uuid, _modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] secao Peca Teste do card: trilhas = linhas de M.O. do card cujo tipo (da MESMA loja) exige peca teste, na ordem da
  -- M.O. (ct.ordem, ct.nome, created_at, id); tentativas = as da trilha (linha x tipo ATUAL), numero ASC; "aprovada" = o predicado
  -- unico (_peca_teste_aprovada, com o fornecedor da linha). "outros" = as demais linhas COM tipo (so servico + fornecedor; Ruling
  -- 33). NUNCA devolve valor da M.O. Card de outra loja / inexistente = NULL.
  IF _tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = _tenant) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'trilhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'mo_linha_id', s.id,
               'categoria_id', s.categoria_terceirizado_id,
               'categoria_nome', ct.nome,
               'empresa_id', s.empresa_id,
               'empresa_nome', e.nome_fantasia,
               'mo_aprovado', s.aprovado,
               'aprovada', public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id),
               'tentativas', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', t.id, 'numero', t.numero, 'empresa_id', t.empresa_id, 'empresa_nome', te.nome_fantasia,
                          'data_saida', t.data_saida, 'data_entrada', t.data_entrada, 'aprovacao', t.aprovacao,
                          'decidido_em', t.decidido_em, 'rev', t.rev) ORDER BY t.numero)
                   FROM public.modelo_peca_teste_tentativas t
                   LEFT JOIN public.empresas te ON te.id = t.empresa_id AND te.tenant_id = _tenant
                  WHERE t.mo_linha_id = s.id AND t.categoria_terceirizado_id = s.categoria_terceirizado_id AND t.tenant_id = _tenant
               ), '[]'::jsonb)
             ) ORDER BY ct.ordem, ct.nome, s.created_at, s.id)
        FROM public.modelo_servico_mo s
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
       WHERE s.modelo_id = _modelo_id
    ), '[]'::jsonb),
    'outros', coalesce((
      SELECT jsonb_agg(jsonb_build_object('categoria_nome', ct.nome, 'empresa_nome', e.nome_fantasia)
             ORDER BY ct.ordem, ct.nome, s.created_at, s.id)
        FROM public.modelo_servico_mo s
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND NOT ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
       WHERE s.modelo_id = _modelo_id
    ), '[]'::jsonb));
END $function$;

-- 2) wrappers NOVOS no texto NEUTRO (inertes; nao citam os portoes nem a tabela)
CREATE OR REPLACE FUNCTION public._peca_teste_mini_aplicar(_modelo_id uuid, _tenant uuid, _trilhas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r11e] NEUTRA (_down da 199400): nao faz nada (o core da R9 nao a chama; o site e a mini estao voltados). Nao cita a mini
  -- nem os helpers r11d, para nao travar os _down_drop da 199300/199000.
  RETURN;
END $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_peca_teste_core(uuid,jsonb,jsonb)', 'eccde92e1c6687045f8f7c9ae61caf8f', '{postgres=X/postgres,service_role=X/postgres}', false, true),
      ('public._peca_teste_trilhas_core(uuid,uuid)', '5ae0f7025744d63508d7617e6e3a7487', '{postgres=X/postgres,service_role=X/postgres}', false, true)
    ) AS x(f, m, acl, w, sd) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r11e_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.w
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r11e_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_trilha_mini(uuid)', '348c7e9978e7f6c0a48812baccc65a5e', '348c7e9978e7f6c0a48812baccc65a5e', false),
      ('public._peca_teste_mini_aplicar(uuid,uuid,jsonb)', '86573744c113efe92fec638b0db89fe6', '2dbec37294d192919e72a0a9ae52ef7a', false)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 'urg_r11e_down: pos-condicao falhou em % (nova; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.n USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public'
                     AND coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(p.proacl) x), '') = CASE WHEN r.w AND false THEN 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres' ELSE 'postgres=X/postgres,service_role=X/postgres' END)
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM (r.w AND false)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r11e_down: pos-condicao falhou na ACL/secdef/search_path de % (nova)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
