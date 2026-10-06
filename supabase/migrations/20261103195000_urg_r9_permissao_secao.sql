-- Urgentes R9d - BACKFILL da permissao de SECAO 'criacao_planejamento:peca_teste' (Peca Teste no Sheet do Planejamento).
-- Escrita A MAO (padrao I3c/R8b: guarda, teto, idempotencia, pos-condicao). Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md
-- (Task 4 / R9d; Ruling 16; P-315 A) + spec-r9.md.
-- Regra (Ruling 16), sobre a permissao EFETIVA (_perm_efetiva = excecao do usuario SENAO papel SENAO nada):
--   Leitor/Editor da secao = o Leitor/Editor do Planejamento de Produto ('criacao_planejamento');
--   + EDITOR para quem EDITA PCP > Etapas ('producao_etapas') ou PCP > Servicos ('producao_terceirizados') - quem lancava a peca
--     teste no PCP - E ve o Planejamento ou o Desenvolvimento ('criacao_desenvolvimento': as 2 telas que abrem o Sheet).
--   Editar implica ver (linha nova nunca nasce com editar sem ver).
-- Como grava (mesmo modelo do set_user_permissions - "excecao = onde diverge do papel"):
--   1) papel_permissoes: cada PAPEL ganha a secao pela regra lida das linhas do PROPRIO papel (UNIQUE (papel_id, pagina);
--      ON CONFLICT DO NOTHING = papel que ja tem a secao fica como esta).
--   2) user_permissions: cada USUARIO (com loja) ganha uma linha SO quando o resultado da regra sobre a permissao EFETIVA dele difere
--      do que ele herda do papel (inclusive excecao NEGATIVA ver=false/editar=false quando o papel daria a secao e a regra nao).
--      Sem papel = 1 linha para quem ganha a secao (= comportamento antigo). Pula: quem ja tem a linha da secao (ON CONFLICT) e
--      quem esta num papel que JA tinha a secao antes desta execucao (configuracao do admin e respeitada).
--   Nenhum gatilho de user_permissions/papel_permissoes morde esta chave (trg_integracao_perm_* so tratam 'integracao*'; tenant_id
--   vai explicito, entao o set_tenant_id nao consulta JWT). Nao ha JWT: rodar como postgres (psql -f), nunca pelo painel do app.
-- Pos-condicao: (a) nenhuma linha CRIADA com editar sem ver; (b) contagem gravada = contagem calculada (nada sumiu num gatilho);
--   (c) para TODO usuario considerado, a secao EFETIVA depois = a regra (o que user_can_view/user_can_edit enxergam).
-- Teto: > 5000 linhas novas = PARE (a copia grava 14; producao: dezenas). Passo 0-F (mig/c-passo0.sql) mostra a previa por loja.
-- Idempotente: reaplicar logo depois = 0 linhas. ATENCAO: NAO reaplicar depois do site no ar - usuario SEM papel de quem o admin
--   TIROU a secao (sem linha = negado) voltaria a ganha-la (a regra so ve "nao tem a linha").
-- Trava: so linhas (RowExclusive em user_permissions/papel_permissoes + INSERT); ~ms; nada em auth/storage/realtime. Qualquer hora.
--   55P03 = nada mudou, rodar de novo.
-- Exige a 20261103193000 (urg R9b) VIVA: salvar_peca_teste com o portao da secao (_seg_exige_pagina('criacao_planejamento:peca_teste')).
-- Volta: supabase/rollback/20261103195000_urg_r9_permissao_secao_down.sql = NO-OP documentado (as linhas ficam; sem o site novo
--   ninguem le a chave). Apagar permissao concedida NAO e volta neutra - se o dono quiser, manual (roteiro):
--   DELETE FROM public.user_permissions WHERE pagina = 'criacao_planejamento:peca_teste';
--   DELETE FROM public.papel_permissoes WHERE pagina = 'criacao_planejamento:peca_teste';
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.salvar_peca_teste(uuid,jsonb,jsonb)') IS NULL
     OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_peca_teste(uuid,jsonb,jsonb)'))
        NOT LIKE '%criacao_planejamento:peca_teste%' THEN
    RAISE EXCEPTION 'urg_r9d: exige a 20261103193000 (urg R9b) aplicada - salvar_peca_teste sem o portao da secao' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._perm_efetiva(uuid)') IS NULL OR to_regclass('public.papeis') IS NULL
     OR to_regclass('public.papel_permissoes') IS NULL OR to_regclass('public.user_permissions') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_permissions'::regclass AND contype = 'u'
                     AND conname = 'user_permissions_user_id_pagina_key')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.papel_permissoes'::regclass AND contype = 'u'
                     AND conname = 'papel_permissoes_papel_id_pagina_key') THEN
    RAISE EXCEPTION 'urg_r9d: modelo de permissoes inesperado (_perm_efetiva/papeis/UNIQUE) - PARE' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DO $backfill$
DECLARE
  c_sec CONSTANT text := 'criacao_planejamento:peca_teste';
  v_users_pre uuid[];
  v_papeis_pre uuid[];
  v_calc_p integer;
  v_calc_u integer;
  v_np integer;
  v_np_ed integer;
  v_nu integer;
  v_nu_ed integer;
  v_nu_neg integer;
  v_torta integer;
  v_dif integer;
BEGIN
  SELECT coalesce(array_agg(up.user_id), '{}') INTO v_users_pre FROM public.user_permissions up WHERE up.pagina = c_sec;
  SELECT coalesce(array_agg(pp.papel_id), '{}') INTO v_papeis_pre FROM public.papel_permissoes pp WHERE pp.pagina = c_sec;

  -- 1) PAPEIS: a regra lida do proprio papel
  CREATE TEMP TABLE _r9d_papel ON COMMIT DROP AS
  SELECT r.papel_id, r.tenant_id,
         (r.plan_ver OR r.plan_ed OR (r.pcp_ed AND r.ve)) AS ver,
         (r.plan_ed OR (r.pcp_ed AND r.ve)) AS ed
    FROM (
      SELECT p.id AS papel_id, p.tenant_id,
             coalesce(bool_or(pp.pagina = 'criacao_planejamento' AND (pp.pode_ver OR pp.pode_editar)), false) AS plan_ver,
             coalesce(bool_or(pp.pagina = 'criacao_planejamento' AND pp.pode_editar), false) AS plan_ed,
             coalesce(bool_or(pp.pagina IN ('producao_etapas', 'producao_terceirizados') AND pp.pode_editar), false) AS pcp_ed,
             coalesce(bool_or(pp.pagina IN ('criacao_planejamento', 'criacao_desenvolvimento') AND (pp.pode_ver OR pp.pode_editar)), false) AS ve
        FROM public.papeis p LEFT JOIN public.papel_permissoes pp ON pp.papel_id = p.id
       GROUP BY p.id, p.tenant_id
    ) r
   WHERE NOT (r.papel_id = ANY (v_papeis_pre));
  SELECT count(*) FILTER (WHERE ver) INTO v_calc_p FROM _r9d_papel;

  -- 2) USUARIOS: a regra sobre a permissao EFETIVA de ANTES (lida antes de qualquer INSERT desta execucao) x o que herda do papel
  CREATE TEMP TABLE _r9d_user ON COMMIT DROP AS
  SELECT x.user_id, x.tenant_id, x.papel_id,
         (x.plan_ver OR x.plan_ed OR (x.pcp_ed AND x.ve)) AS ver,
         (x.plan_ed OR (x.pcp_ed AND x.ve)) AS ed
    FROM (
      SELECT u.id AS user_id, u.tenant_id, u.papel_id,
             coalesce(bool_or(e.pagina = 'criacao_planejamento' AND (e.pode_ver OR e.pode_editar)), false) AS plan_ver,
             coalesce(bool_or(e.pagina = 'criacao_planejamento' AND e.pode_editar), false) AS plan_ed,
             coalesce(bool_or(e.pagina IN ('producao_etapas', 'producao_terceirizados') AND e.pode_editar), false) AS pcp_ed,
             coalesce(bool_or(e.pagina IN ('criacao_planejamento', 'criacao_desenvolvimento') AND (e.pode_ver OR e.pode_editar)), false) AS ve
        FROM public.users u
        LEFT JOIN LATERAL public._perm_efetiva(u.id) e ON true
       WHERE u.tenant_id IS NOT NULL
         AND NOT (u.id = ANY (v_users_pre))
         AND (u.papel_id IS NULL OR NOT (u.papel_id = ANY (v_papeis_pre)))
       GROUP BY u.id, u.tenant_id, u.papel_id
    ) x;

  INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
  SELECT p.papel_id, p.tenant_id, c_sec, p.ver, p.ed FROM _r9d_papel p WHERE p.ver ORDER BY p.papel_id
  ON CONFLICT (papel_id, pagina) DO NOTHING;
  GET DIAGNOSTICS v_np = ROW_COUNT;

  -- heranca do papel DEPOIS do passo 1 (o que _perm_efetiva vai devolver sem excecao): linha crua do papel (ver/editar)
  SELECT count(*) INTO v_calc_u
    FROM _r9d_user d LEFT JOIN public.papel_permissoes pp ON pp.papel_id = d.papel_id AND pp.pagina = c_sec
   WHERE (d.ver, d.ed) IS DISTINCT FROM (coalesce(pp.pode_ver, false), coalesce(pp.pode_editar, false));
  IF v_np + v_calc_u > 5000 THEN
    RAISE EXCEPTION 'urg_r9d: % linhas novas (teto 5000) - PARE e confira o Passo 0-F', v_np + v_calc_u USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
  SELECT d.user_id, d.tenant_id, c_sec, d.ver, d.ed
    FROM _r9d_user d LEFT JOIN public.papel_permissoes pp ON pp.papel_id = d.papel_id AND pp.pagina = c_sec
   WHERE (d.ver, d.ed) IS DISTINCT FROM (coalesce(pp.pode_ver, false), coalesce(pp.pode_editar, false))
   ORDER BY d.user_id
  ON CONFLICT (user_id, pagina) DO NOTHING;
  GET DIAGNOSTICS v_nu = ROW_COUNT;

  -- pos-condicao (b): nada sumiu (gatilho silencioso) nem colidiu
  IF v_np <> v_calc_p OR v_nu <> v_calc_u THEN
    RAISE EXCEPTION 'urg_r9d: pos-condicao falhou (papeis %/% usuarios %/% gravados/calculados)', v_np, v_calc_p, v_nu, v_calc_u
      USING ERRCODE = 'P0001';
  END IF;
  -- (a) nenhuma linha CRIADA com editar sem ver
  SELECT count(*) INTO v_torta FROM public.papel_permissoes pp
   WHERE pp.pagina = c_sec AND pp.pode_editar AND NOT pp.pode_ver AND NOT (pp.papel_id = ANY (v_papeis_pre));
  v_torta := v_torta + (SELECT count(*) FROM public.user_permissions up
                         WHERE up.pagina = c_sec AND up.pode_editar AND NOT up.pode_ver AND NOT (up.user_id = ANY (v_users_pre)));
  IF v_torta > 0 THEN
    RAISE EXCEPTION 'urg_r9d: pos-condicao falhou (% linha(s) nova(s) com editar sem ver)', v_torta USING ERRCODE = 'P0001';
  END IF;
  -- (c) a secao EFETIVA de todo usuario considerado = a regra
  SELECT count(*) INTO v_dif
    FROM _r9d_user d
    LEFT JOIN LATERAL (SELECT e.pode_ver, e.pode_editar FROM public._perm_efetiva(d.user_id) e WHERE e.pagina = c_sec) f ON true
   WHERE (d.ver, d.ed) IS DISTINCT FROM (coalesce(f.pode_ver, false), coalesce(f.pode_editar, false));
  IF v_dif > 0 THEN
    RAISE EXCEPTION 'urg_r9d: pos-condicao falhou (% usuario(s) com a secao efetiva diferente da regra)', v_dif USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) FILTER (WHERE pp.pode_editar) INTO v_np_ed FROM public.papel_permissoes pp
   WHERE pp.pagina = c_sec AND NOT (pp.papel_id = ANY (v_papeis_pre));
  SELECT count(*) FILTER (WHERE up.pode_editar), count(*) FILTER (WHERE NOT up.pode_ver AND NOT up.pode_editar)
    INTO v_nu_ed, v_nu_neg FROM public.user_permissions up
   WHERE up.pagina = c_sec AND NOT (up.user_id = ANY (v_users_pre));
  RAISE NOTICE 'urg_r9d: papeis com a secao: % (editor %, leitor %); linhas de usuario: % (editor %, leitor %, negativas %); ja tinham: % papel(is), % usuario(s)',
    v_np, v_np_ed, v_np - v_np_ed, v_nu, v_nu_ed, v_nu - v_nu_ed - v_nu_neg, v_nu_neg,
    cardinality(v_papeis_pre), cardinality(v_users_pre);
  DROP TABLE _r9d_papel;
  DROP TABLE _r9d_user;
END
$backfill$;

COMMIT;
