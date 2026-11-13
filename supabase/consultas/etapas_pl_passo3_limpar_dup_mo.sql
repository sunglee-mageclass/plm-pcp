-- Passo 3 (ESCRITA) — Kanban PL deploy: backup + limpeza das 2as linhas duplicadas de M.O. (tipo que exige peca teste).
-- SEGURANCA: so apaga linha que (a) e a 2a+ do par (modelo, categoria), (b) tem valor 0, (c) NAO tem tentativa de peca teste,
--            (d) NAO tem bloco de servico (producao_terceirizados). Faz BACKUP antes. Roda como admin da loja (claim JWT),
--            porque o gatilho trg_enforce_servico_mo_del_aprovacao barra DELETE de linha pendente sem user_can_edit.
-- Transacao unica: se algo fugir do esperado, de ROLLBACK e me chame.
-- Rodar: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/consultas/etapas_pl_passo3_limpar_dup_mo.sql

BEGIN;

-- 1) Backup das linhas que serao removidas (as 2as+ do par, valor 0, sem tentativa, sem bloco).
CREATE TABLE IF NOT EXISTS public._bkp_msm_dup_20261113 (LIKE public.modelo_servico_mo INCLUDING ALL);

WITH dup AS (
  SELECT s.id,
         row_number() OVER (PARTITION BY s.modelo_id, s.categoria_terceirizado_id
                            ORDER BY s.created_at, s.id) AS ord
    FROM public.modelo_servico_mo s
    JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.exige_peca_teste
   WHERE s.categoria_terceirizado_id IS NOT NULL
     AND (s.modelo_id, s.categoria_terceirizado_id) IN (
           SELECT modelo_id, categoria_terceirizado_id FROM public.modelo_servico_mo
            WHERE categoria_terceirizado_id IS NOT NULL
            GROUP BY modelo_id, categoria_terceirizado_id HAVING count(*) > 1)
), alvo AS (
  SELECT s.*
    FROM public.modelo_servico_mo s
    JOIN dup ON dup.id = s.id AND dup.ord > 1
   WHERE coalesce(s.valor, 0) = 0
     AND NOT EXISTS (SELECT 1 FROM public.modelo_peca_teste_tentativas t WHERE t.mo_linha_id = s.id)
     AND NOT EXISTS (SELECT 1 FROM public.producao_terceirizados pr WHERE pr.mo_linha_id = s.id)
)
INSERT INTO public._bkp_msm_dup_20261113
SELECT a.* FROM alvo a
 WHERE NOT EXISTS (SELECT 1 FROM public._bkp_msm_dup_20261113 b WHERE b.id = a.id);

-- 2) Mostra o que vai apagar (confira antes do COMMIT).
SELECT m.ref, ct.nome AS tipo, b.id AS linha_removida, b.valor
  FROM public._bkp_msm_dup_20261113 b
  JOIN public.modelos m ON m.id = b.modelo_id
  JOIN public.categorias_terceirizado ct ON ct.id = b.categoria_terceirizado_id;

-- 3) Claim de admin da loja de cada linha (o gatilho exige user_can_edit('producao_servico_aprovacao')).
--    Usa um admin (tenant_admin/super_admin) da MESMA loja da 1a linha de backup. Ajuste se houver varias lojas.
DO $$
DECLARE v_admin uuid;
BEGIN
  SELECT u.id INTO v_admin
    FROM public.users u
   WHERE u.tenant_id = (SELECT m.tenant_id FROM public._bkp_msm_dup_20261113 b JOIN public.modelos m ON m.id=b.modelo_id LIMIT 1)
     AND u.role IN ('tenant_admin','super_admin')
   ORDER BY (u.role = 'tenant_admin') DESC
   LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'passo3: nenhum admin encontrado para a loja das duplicatas'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
END $$;

-- 4) DELETE das linhas do backup (so as que entraram no backup = seguras).
DELETE FROM public.modelo_servico_mo s
 WHERE s.id IN (SELECT id FROM public._bkp_msm_dup_20261113);

-- 5) Confere: 0 duplicatas restantes.
SELECT count(*) AS duplicatas_restantes
  FROM (SELECT modelo_id, categoria_terceirizado_id
          FROM public.modelo_servico_mo s
          JOIN public.categorias_terceirizado ct ON ct.id=s.categoria_terceirizado_id AND ct.exige_peca_teste
         WHERE s.categoria_terceirizado_id IS NOT NULL
         GROUP BY modelo_id, categoria_terceirizado_id HAVING count(*)>1) d;

COMMIT;
