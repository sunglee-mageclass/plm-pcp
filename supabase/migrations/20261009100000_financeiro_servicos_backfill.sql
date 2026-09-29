-- F5c (P-112 A, 29/set) — BACKFILL SÓ DE DADOS da nova chave de permissão `financeiro_servicos` (aba Financeiro › Serviços).
-- Até a F5c a aba Serviços não tinha chave própria: quem abria o Financeiro (qualquer uma de calendario/parcelas/resumo com
-- VER) via Serviços, e quem editava Parcelas OU Calendário editava Serviços (o flag de escrita da página era
-- canEdit(parcelas) || canEdit(calendario) — editor SÓ de Resumo não escrevia nada). O front novo esconde a aba de quem não
-- tem `financeiro_servicos`. Este backfill reproduz EXATAMENTE o acesso de hoje (ninguém perde, ninguém ganha edição):
--   • ver(servicos)    = OR de pode_ver    em financeiro_calendario, financeiro_parcelas, financeiro_resumo
--   • editar(servicos) = OR de pode_editar em financeiro_parcelas, financeiro_calendario (Resumo NÃO conta — review I-3)
-- Passos (nesta ordem, statements separados — o 2º enxerga o que o 1º gravou):
--   1. papel_permissoes: por papel, calcula das linhas do PRÓPRIO papel; insere se o papel não tem a chave e ver OU editar.
--   2. user_permissions: por usuário com loja (users.tenant_id) que tem ao menos 1 linha própria das 3 chaves antigas e
--      ainda NÃO tem linha financeiro_servicos: calcula das permissões EFETIVAS (linha do usuário SENÃO do papel, coluna a
--      coluna — a mesma regra de _perm_efetiva) e grava a linha SÓ se o valor DIFERE do que o papel (já com o passo 1) dá
--      em financeiro_servicos (sem papel = (false,false)). Mantém a semântica "exceção = delta vs o papel" do
--      set_user_permissions: usuário com papel e sem exceção nas 3 chaves NÃO ganha linha (herda do papel); com exceção que
--      rebaixa ganha a linha do valor efetivo (pode ser (false,false) = exceção negativa explícita); sem papel = tudo.
-- Nunca sobrescreve uma linha financeiro_servicos que já existe (NOT EXISTS + ON CONFLICT DO NOTHING nas chaves únicas
-- reais: user_permissions(user_id,pagina) e papel_permissoes(papel_id,pagina)). Admins furam as permissões no front; as
-- linhas deles seguem a mesma regra (inofensivas; preservam o acesso se um dia virarem `user`).
-- Registro p/ o inverso: cada linha inserida vai (id da linha) p/ public._bkp_financeiro_servicos_backfill (RLS ligada SEM
-- policy + REVOKE ALL de PUBLIC/anon/authenticated/service_role — o default ACL do Supabase dá ALL ao service_role, que fura RLS). O inverso apaga SÓ as linhas cujo id está lá (se um admin salvou o
-- usuário/papel depois, set_user_permissions/salvar_papel apagam+reinserem com id NOVO — o inverso não mexe nelas).
-- Gatilhos: set_tenant_id (tenant_id vai preenchido), fn_audit (grava no audit_log, sem auth.uid), e o delta 7
-- (trg_integracao_perm_*) só olha páginas integracao/integracao:* — não interfere.
-- Idempotente: rodar de novo sem mudança nas permissões não insere nada (a chave já existe). ⚠️ NÃO rodar de novo depois que
-- admins começarem a editar permissões no front novo: "revogar" = linha AUSENTE (salvar_papel/set_user_permissions sem papel
-- não gravam linha false) e a 2ª rodada re-concederia. O script ida-financeiro-servicos.sh PARA se a tabela de registro já existe
-- ou se já há alguma linha financeiro_servicos. Depois de uma VOLTA (o inverso deixa o marcador
-- `financeiro_servicos_backfill_revertido` no audit_log), esta migration RECUSA rodar de novo, a menos que a sessão tenha
-- `SET app.financeiro_servicos_apos_volta = 'sim'` (o script só faz isso com `--apos-volta`, decisão do controlador).
-- Autocheck no fim (aborta a transação inteira se falhar): toda linha registrada bate com a regra e, p/ todo usuário sem linha
-- financeiro_servicos pré-existente (nele ou no papel), _perm_efetiva(servicos) = valor calculado das 3 chaves.
-- Inverso: supabase/rollback/20261009100000_financeiro_servicos_backfill_down.sql.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '20s';

DO $guarda$
BEGIN
  IF to_regclass('public.user_permissions') IS NULL OR to_regclass('public.papel_permissoes') IS NULL
     OR to_regclass('public.papeis') IS NULL OR to_regclass('public.users') IS NULL
     OR to_regprocedure('public._perm_efetiva(uuid)') IS NULL THEN
    RAISE EXCEPTION 'financeiro_servicos_backfill: user_permissions/papel_permissoes/papeis/users/_perm_efetiva ausente'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permissions_user_id_pagina_key' AND contype = 'u'
                   AND conrelid = 'public.user_permissions'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'papel_permissoes_papel_id_pagina_key' AND contype = 'u'
                   AND conrelid = 'public.papel_permissoes'::regclass) THEN
    RAISE EXCEPTION 'financeiro_servicos_backfill: chave unica (user_id,pagina)/(papel_id,pagina) ausente' USING ERRCODE = 'P0001';
  END IF;
  -- Ida depois de uma volta: só com override explícito (a volta apagou o registro, que era a trava contra 2ª rodada).
  IF to_regclass('public._bkp_financeiro_servicos_backfill') IS NULL
     AND EXISTS (SELECT 1 FROM public.audit_log
                  WHERE tabela = '_bkp_financeiro_servicos_backfill'
                    AND dados->>'marcador' = 'financeiro_servicos_backfill_revertido')
     AND coalesce(current_setting('app.financeiro_servicos_apos_volta', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'financeiro_servicos_backfill: a volta ja rodou - ida de novo so com SET app.financeiro_servicos_apos_volta = sim (controlador)'
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE TABLE IF NOT EXISTS public._bkp_financeiro_servicos_backfill (
  tabela      text        NOT NULL CHECK (tabela IN ('papel_permissoes', 'user_permissions')),
  row_id      uuid        NOT NULL,
  dono_id     uuid        NOT NULL,  -- papel_id ou user_id
  tenant_id   uuid        NOT NULL,
  pode_ver    boolean     NOT NULL,
  pode_editar boolean     NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tabela, row_id)
);
COMMENT ON TABLE public._bkp_financeiro_servicos_backfill IS
  'Linhas financeiro_servicos inseridas pelo backfill 20261009100000 (o inverso apaga so estas). RLS sem policy e sem grant: so o dono (postgres) le.';
ALTER TABLE public._bkp_financeiro_servicos_backfill ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_financeiro_servicos_backfill FROM PUBLIC, anon, authenticated, service_role;

DO $backfill$
DECLARE
  n_papeis   integer;
  n_usuarios integer;
  r          record;
BEGIN
  -- 1. PAPÉIS — das linhas do próprio papel.
  WITH calc AS (
    SELECT pp.papel_id, pa.tenant_id,
           coalesce(bool_or(pp.pode_ver), false) AS v,
           coalesce(bool_or(pp.pode_editar) FILTER (WHERE pp.pagina IN ('financeiro_parcelas', 'financeiro_calendario')), false) AS e
      FROM public.papel_permissoes pp
      JOIN public.papeis pa ON pa.id = pp.papel_id
     WHERE pp.pagina IN ('financeiro_calendario', 'financeiro_parcelas', 'financeiro_resumo')
     GROUP BY pp.papel_id, pa.tenant_id
  ), ins AS (
    INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
    SELECT c.papel_id, c.tenant_id, 'financeiro_servicos', c.v, c.e
      FROM calc c
     WHERE (c.v OR c.e)
       AND NOT EXISTS (SELECT 1 FROM public.papel_permissoes x
                        WHERE x.papel_id = c.papel_id AND x.pagina = 'financeiro_servicos')
    ON CONFLICT (papel_id, pagina) DO NOTHING
    RETURNING id, papel_id, tenant_id, pode_ver, pode_editar
  )
  INSERT INTO public._bkp_financeiro_servicos_backfill (tabela, row_id, dono_id, tenant_id, pode_ver, pode_editar)
  SELECT 'papel_permissoes', id, papel_id, tenant_id, pode_ver, pode_editar FROM ins;
  GET DIAGNOSTICS n_papeis = ROW_COUNT;

  -- 2. USUÁRIOS — do EFETIVO (usuário senão papel, coluna a coluna), só onde difere do papel (já com o passo 1).
  WITH alvo AS (
    SELECT u.id AS user_id, u.tenant_id, u.papel_id
      FROM public.users u
     WHERE u.tenant_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.user_permissions up
                    WHERE up.user_id = u.id
                      AND up.pagina IN ('financeiro_calendario', 'financeiro_parcelas', 'financeiro_resumo'))
       AND NOT EXISTS (SELECT 1 FROM public.user_permissions up
                        WHERE up.user_id = u.id AND up.pagina = 'financeiro_servicos')
  ), efetiva AS (
    SELECT a.user_id, k.pagina,
           coalesce(up.pode_ver, pp.pode_ver, false)       AS v,
           coalesce(up.pode_editar, pp.pode_editar, false) AS e
      FROM alvo a
     CROSS JOIN (VALUES ('financeiro_calendario'), ('financeiro_parcelas'), ('financeiro_resumo')) AS k(pagina)
      LEFT JOIN public.user_permissions up ON up.user_id = a.user_id AND up.pagina = k.pagina
      LEFT JOIN public.papel_permissoes pp ON pp.papel_id = a.papel_id AND pp.pagina = k.pagina
  ), calc AS (
    SELECT a.user_id, a.tenant_id,
           bool_or(ef.v) AS v,
           bool_or(ef.e) FILTER (WHERE ef.pagina IN ('financeiro_parcelas', 'financeiro_calendario')) AS e,
           coalesce(ps.pode_ver, false)    AS papel_v,
           coalesce(ps.pode_editar, false) AS papel_e
      FROM alvo a
      JOIN efetiva ef ON ef.user_id = a.user_id
      LEFT JOIN public.papel_permissoes ps ON ps.papel_id = a.papel_id AND ps.pagina = 'financeiro_servicos'
     GROUP BY a.user_id, a.tenant_id, ps.pode_ver, ps.pode_editar
  ), ins AS (
    INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
    SELECT c.user_id, c.tenant_id, 'financeiro_servicos', c.v, c.e
      FROM calc c
     WHERE (c.v IS DISTINCT FROM c.papel_v OR c.e IS DISTINCT FROM c.papel_e)
    ON CONFLICT (user_id, pagina) DO NOTHING
    RETURNING id, user_id, tenant_id, pode_ver, pode_editar
  )
  INSERT INTO public._bkp_financeiro_servicos_backfill (tabela, row_id, dono_id, tenant_id, pode_ver, pode_editar)
  SELECT 'user_permissions', id, user_id, tenant_id, pode_ver, pode_editar FROM ins;
  GET DIAGNOSTICS n_usuarios = ROW_COUNT;

  RAISE NOTICE 'financeiro_servicos_backfill: papeis inseridos = %, usuarios inseridos = %', n_papeis, n_usuarios;
  FOR r IN
    SELECT tenant_id,
           count(*) FILTER (WHERE tabela = 'papel_permissoes') AS np,
           count(*) FILTER (WHERE tabela = 'user_permissions') AS nu
      FROM public._bkp_financeiro_servicos_backfill
     GROUP BY tenant_id ORDER BY tenant_id
  LOOP
    RAISE NOTICE 'financeiro_servicos_backfill: loja % -> papeis %, usuarios % (acumulado no registro)', r.tenant_id, r.np, r.nu;
  END LOOP;
END
$backfill$;

-- Autocheck (aborta tudo se falhar).
DO $pos$
DECLARE
  n integer;
BEGIN
  -- a) toda linha de PAPEL registrada = regra calculada das linhas do papel.
  SELECT count(*) INTO n
    FROM public._bkp_financeiro_servicos_backfill b
    LEFT JOIN LATERAL (
      SELECT coalesce(bool_or(pp.pode_ver), false) AS v,
             coalesce(bool_or(pp.pode_editar) FILTER (WHERE pp.pagina IN ('financeiro_parcelas', 'financeiro_calendario')), false) AS e
        FROM public.papel_permissoes pp
       WHERE pp.papel_id = b.dono_id
         AND pp.pagina IN ('financeiro_calendario', 'financeiro_parcelas', 'financeiro_resumo')
    ) c ON true
   WHERE b.tabela = 'papel_permissoes'
     AND EXISTS (SELECT 1 FROM public.papel_permissoes x WHERE x.id = b.row_id)
     AND (b.pode_ver IS DISTINCT FROM c.v OR b.pode_editar IS DISTINCT FROM c.e);
  IF n > 0 THEN
    RAISE EXCEPTION 'financeiro_servicos_backfill: % linha(s) de papel fora da regra', n USING ERRCODE = 'P0001';
  END IF;

  -- b) usuários sem linha financeiro_servicos pré-existente (nele ou no papel): efetivo(servicos) = calculado das 3 chaves.
  WITH u AS (
    SELECT us.id
      FROM public.users us
     WHERE us.tenant_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.user_permissions up
                        WHERE up.user_id = us.id AND up.pagina = 'financeiro_servicos'
                          AND NOT EXISTS (SELECT 1 FROM public._bkp_financeiro_servicos_backfill b
                                           WHERE b.tabela = 'user_permissions' AND b.row_id = up.id))
       AND NOT EXISTS (SELECT 1 FROM public.papel_permissoes pp
                        WHERE pp.papel_id = us.papel_id AND pp.pagina = 'financeiro_servicos'
                          AND NOT EXISTS (SELECT 1 FROM public._bkp_financeiro_servicos_backfill b
                                           WHERE b.tabela = 'papel_permissoes' AND b.row_id = pp.id))
  ), cmp AS (
    SELECT u.id,
           coalesce(bool_or(pe.pode_ver) FILTER (WHERE pe.pagina IN ('financeiro_calendario', 'financeiro_parcelas', 'financeiro_resumo')), false) AS v_calc,
           coalesce(bool_or(pe.pode_editar) FILTER (WHERE pe.pagina IN ('financeiro_parcelas', 'financeiro_calendario')), false) AS e_calc,
           coalesce(bool_or(pe.pode_ver) FILTER (WHERE pe.pagina = 'financeiro_servicos'), false) AS v_serv,
           coalesce(bool_or(pe.pode_editar) FILTER (WHERE pe.pagina = 'financeiro_servicos'), false) AS e_serv
      FROM u
      LEFT JOIN LATERAL public._perm_efetiva(u.id) pe ON true
     GROUP BY u.id
  )
  SELECT count(*) INTO n FROM cmp WHERE v_calc IS DISTINCT FROM v_serv OR e_calc IS DISTINCT FROM e_serv;
  IF n > 0 THEN
    RAISE EXCEPTION 'financeiro_servicos_backfill: % usuario(s) com financeiro_servicos efetivo diferente do acesso de hoje', n
      USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
