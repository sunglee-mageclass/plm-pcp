-- Inverso NEUTRO de supabase/migrations/20261103191000_urg_r8_titulo_sublinha_reprocesso.sql (correcao unica urg R8b) - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 5 / R8b; Ruling 18; P-303 A). Molde: I3c 20261030120000
-- (correcao unica dos integraveis) + release 4 20261013100000 (P-127 B / P-129 A: reprocesso so do nome das sublinhas).
-- Ordem:
--   1. guarda: tabelas + backup existem; _integracao_assinar/_integracao_logar com o md5 esperado (NAO exige a 190000 viva: devolve
--      o retrato de antes mesmo depois do 20261103190000_down).
--   2. LOCK (o mesmo da ida). Para cada modelo do backup (a linha MAIS NOVA cuja assinatura_depois = a assinatura atual), SO quem
--      segue 'integravel' com essa assinatura volta ao retrato/assinatura de antes (a assinatura de antes e reconferida =
--      HMAC(retrato de antes), senao RAISE), rev + 1, os titulos das sublinhas de antes em integracao_linhas (ROW_COUNT = 1 cada),
--      1 'editar' no Log ("Sistema (volta título das sublinhas)"; reprocesso 'titulo_sublinhas_cor_volta'). Integrado DEPOIS da
--      ida, voltado ou re-marcado FICA e e RELATADO (NOTICE por modelo + contagem).
-- O backup public._bkp_r8_titulo_sublinha FICA (historico; o DROP e o _down_drop). LIFO: rode este ANTES do 20261103190000_down (r8a) e de
-- qualquer inverso da Integracao (a volta de emergencia volta-producao.sh comeca por este). Sem DROP.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  IF to_regclass('public._bkp_r8_titulo_sublinha') IS NULL OR to_regclass('public.integracao_produtos') IS NULL
     OR to_regclass('public.integracao_linhas') IS NULL OR to_regclass('public.integracao_log') IS NULL THEN
    RAISE EXCEPTION 'r8b_volta: backup ou tabelas ausentes - a 20261103191000 nunca rodou aqui' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_assinar(jsonb)', 'bbe03c7d24dc3a470387c0164073146b'),
      ('public._integracao_logar(uuid,text,uuid,jsonb,text)', '52b347ee02742906c19765c46e8cfec4')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'r8b_volta: % com texto inesperado (md5 %)', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

LOCK TABLE public.integracao_produtos, public.integracao_linhas IN EXCLUSIVE MODE;

DO $restaura$
DECLARE
  b record;
  p record;
  t jsonb;
  v_upd integer;
  v_n integer := 0;
  v_relatados integer := 0;
BEGIN
  FOR b IN
    SELECT DISTINCT ON (k.modelo_id) k.*
      FROM public._bkp_r8_titulo_sublinha k
      JOIN public.integracao_produtos x ON x.modelo_id = k.modelo_id AND x.tenant_id = k.tenant_id AND x.assinatura = k.assinatura_depois
     ORDER BY k.modelo_id, k.criado_em DESC, k.id
  LOOP
    SELECT ip.id, ip.estado, ip.assinatura INTO p FROM public.integracao_produtos ip
     WHERE ip.modelo_id = b.modelo_id AND ip.tenant_id = b.tenant_id FOR UPDATE;
    IF p.estado IS DISTINCT FROM 'integravel' OR p.assinatura IS DISTINCT FROM b.assinatura_depois THEN
      v_relatados := v_relatados + 1;
      RAISE NOTICE 'r8b_volta: modelo % ficou como esta (estado %) - integrado/mudado depois da ida', b.modelo_id, p.estado;
      CONTINUE;
    END IF;
    IF b.retrato_antes IS NULL OR public._integracao_assinar(b.retrato_antes) IS DISTINCT FROM b.assinatura_antes THEN
      RAISE EXCEPTION 'r8b_volta: assinatura de antes nao confere com o retrato do backup (modelo %)', b.modelo_id USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.integracao_produtos
       SET retrato = b.retrato_antes, assinatura = b.assinatura_antes, rev = rev + 1, atualizado_em = now()
     WHERE id = p.id;
    FOR t IN SELECT e.x FROM jsonb_array_elements(b.titulos_antes) AS e(x) LOOP
      UPDATE public.integracao_linhas il
         SET titulo = t ->> 'titulo'
       WHERE il.modelo_id = b.modelo_id AND il.ordem = (t ->> 'ordem')::integer AND il.tipo = 'variante';
      GET DIAGNOSTICS v_upd = ROW_COUNT;
      IF v_upd <> 1 THEN
        RAISE EXCEPTION 'r8b_volta: linha da API ausente (modelo %, ordem %)', b.modelo_id, t ->> 'ordem' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    PERFORM public._integracao_logar(b.tenant_id, 'editar', b.modelo_id,
      jsonb_build_object('reprocesso', 'titulo_sublinhas_cor_volta', 'assinatura_antes', b.assinatura_depois,
                         'assinatura_depois', b.assinatura_antes),
      'Sistema (volta título das sublinhas)');
    v_n := v_n + 1;
  END LOOP;
  -- reprocessados que ja nao batem com o backup (voltados/re-marcados/desfeitos depois da ida): relatados, um a um
  FOR b IN
    SELECT DISTINCT k.modelo_id FROM public._bkp_r8_titulo_sublinha k
     WHERE NOT EXISTS (SELECT 1 FROM public._bkp_r8_titulo_sublinha k2
                         JOIN public.integracao_produtos x2 ON x2.modelo_id = k2.modelo_id AND x2.tenant_id = k2.tenant_id
                                                         AND x2.assinatura IN (k2.assinatura_depois, k2.assinatura_antes)
                        WHERE k2.modelo_id = k.modelo_id)
     ORDER BY k.modelo_id
  LOOP
    v_relatados := v_relatados + 1;
    RAISE NOTICE 'r8b_volta: modelo % ficou como esta - voltado/re-marcado depois da ida', b.modelo_id;
  END LOOP;
  RAISE NOTICE 'r8b_volta: % integravel(is) devolvido(s); % relatado(s) (ficam)', v_n, v_relatados;
END
$restaura$;

DO $pos$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public._bkp_r8_titulo_sublinha k
    JOIN public.integracao_produtos p ON p.modelo_id = k.modelo_id AND p.tenant_id = k.tenant_id
   WHERE p.estado = 'integravel' AND p.assinatura = k.assinatura_depois;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'r8b_volta: % integravel(is) ainda reprocessado(s)', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado IN ('integravel', 'integrado') AND p.retrato IS NOT NULL
     AND p.assinatura IS DISTINCT FROM public._integracao_assinar(p.retrato);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'r8b_volta: % assinatura(s) nao conferem com o retrato', v_n USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
