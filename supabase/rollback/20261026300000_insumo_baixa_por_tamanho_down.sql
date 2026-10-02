-- INVERSO de supabase/migrations/20261026300000_insumo_baixa_por_tamanho.sql (achados MEDIOS R16: est #7, P-188 A +
-- carona do importado). Devolve o texto de ANTES de _estoque_etiqueta_core (baixa do corte sem enviar_por_tamanho toda
-- em "sem tamanho"; baixa pelas pecas recebidas so na revenda). Guarda: so roda se a funcao esta EXATAMENTE com o
-- texto da ida (md5 de depois) e as dependencias seguem com o texto conferido; outro -> P0001 e nada muda. Nada
-- gravado muda (funcao de leitura). LIFO: este inverso roda ANTES de 20261019100000_etiqueta_revenda_baixa_unica_down
-- (que confere o texto que esta volta devolve, 82840be3). Sem site.
-- Travas: so CREATE OR REPLACE FUNCTION. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._estoque_etiqueta_core(uuid)', '28aa308d297cc18b653c6290a5b3b958'),
      ('public._split_maior_resto(integer,jsonb)', '29e39014e3c099a2235452c9b8051524'),
      ('public._receber_oc_importado_core(uuid,jsonb,jsonb)', '4879213f321b69c08cbf129f62d5f5fe')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r16_est7 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r16_est7 (volta): % nao esta com o texto esperado da ida (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- ACL de antes da volta (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _r16cv_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public._estoque_etiqueta_core(uuid)')) v(s);

CREATE OR REPLACE FUNCTION public._estoque_etiqueta_core(_tenant uuid)
 RETURNS TABLE(etiqueta_id uuid, etiqueta_nome text, variante_id uuid, tamanho text, cor_nome text, recebido numeric, prev_receb numeric, baixa numeric, fisico numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with
  rec as (  -- recebido: chave (etiqueta, tamanho, cor) da variante da OC recebida
    select i.etiqueta_id as etq, ve.tamanho as tam, ve.cor_id as cor,
           sum(coalesce(i.quantidade_recebida, i.quantidade_pedida, 0)) as tot
    from ocs_etiqueta_itens i
    join ocs_etiqueta o on o.id = i.oc_etiqueta_id and o.tenant_id = _tenant and o.status = 'recebido'
    left join variantes_etiqueta ve on ve.id = i.variante_etiqueta_id
    where coalesce(i.cancelado, false) = false
    group by 1, 2, 3
  ),
  prev as (  -- previsto: OC encomendada
    select i.etiqueta_id as etq, ve.tamanho as tam, ve.cor_id as cor,
           sum(coalesce(i.quantidade_pedida, 0)) as tot
    from ocs_etiqueta_itens i
    join ocs_etiqueta o on o.id = i.oc_etiqueta_id and o.tenant_id = _tenant and o.status = 'encomendado'
    left join variantes_etiqueta ve on ve.id = i.variante_etiqueta_id
    where coalesce(i.cancelado, false) = false
    group by 1, 2, 3
  ),
  baixa_var as (  -- consumo por tamanho: chave (etiqueta, tamanho=key, cor do CAD)
    select ce.etiqueta_id as etq, kv.key as tam, ce.cor_id as cor, sum((kv.value)::numeric) as tot
    from cad_etiquetas ce
    join cad c on c.id = ce.cad_id and c.tenant_id = _tenant and c.enviado_corte
    join lateral jsonb_each_text(coalesce(ce.enviar_por_tamanho, '{}'::jsonb)) kv on true
    group by 1, 2, 3
  ),
  baixa_sem as (  -- consumo sem tamanho: chave (etiqueta, NULL, cor do CAD)
    select ce.etiqueta_id as etq, null::text as tam, ce.cor_id as cor, sum(coalesce(ce.quantidade_enviar, 0)) as tot
    from cad_etiquetas ce
    join cad c on c.id = ce.cad_id and c.tenant_id = _tenant and c.enviado_corte
    where coalesce(ce.enviar_por_tamanho, '{}'::jsonb) = '{}'::jsonb
    group by 1, 3
  ),
  baixa_revenda as (  -- consumo de insumo em REVENDA: sem corte/CAD-tecido — o gatilho é a
                       -- OC P. Acabado recebida, refletida em cad_grades.grade_total_real do
                       -- cad-espelho (receber_oc_p_acabado, Task 3). Sem tamanho (BOM de
                       -- revenda = modelo_etiquetas, sem coluna tamanho).
    select me.etiqueta_id as etq, null::text as tam, me.cor_id as cor,
           sum(me.consumo * coalesce(cg.total_real, 0)) as tot
    from modelo_etiquetas me
    join modelos m on m.id = me.modelo_id and m.tenant_id = _tenant and m.origem = 'revenda'
    join cad c on c.modelo_id = m.id and c.tenant_id = _tenant
     and not coalesce(c.enviado_corte, false)  -- [contas-certas 6] so ANTES do Enviar para PCP; depois vale o
                                               -- "a enviar" da Explosao (baixa_sem/baixa_var) -> sem baixa em dobro
    join (select cad_id, sum(grade_total_real) as total_real from cad_grades group by cad_id) cg
      on cg.cad_id = c.id
    group by 1, 3
  ),
  baixa as (
    select etq, tam, cor, sum(tot) as tot
    from (select * from baixa_var union all select * from baixa_sem union all select * from baixa_revenda) x
    group by 1, 2, 3
  ),
  keys as (
    select etq, tam, cor from rec
    union select etq, tam, cor from prev
    union select etq, tam, cor from baixa
  )
  select k.etq, e.nome::text,
         ve.id,                                   -- variante_id (referência; NULL se a baixa não casa variante)
         k.tam, cor.nome::text,
         coalesce(rec.tot, 0), coalesce(prev.tot, 0), coalesce(baixa.tot, 0),
         greatest(0, coalesce(rec.tot, 0) - coalesce(baixa.tot, 0))   -- físico nunca negativo (igual tecido/aviamento)
  from keys k
  join etiquetas e on e.id = k.etq and e.tenant_id = _tenant
  left join variantes_etiqueta ve on ve.etiqueta_id = k.etq
       and ve.tamanho is not distinct from k.tam and ve.cor_id is not distinct from k.cor
  left join cores cor on cor.id = k.cor
  left join rec  on rec.etq  = k.etq and rec.tam  is not distinct from k.tam and rec.cor  is not distinct from k.cor
  left join prev on prev.etq = k.etq and prev.tam is not distinct from k.tam and prev.cor is not distinct from k.cor
  left join baixa on baixa.etq = k.etq and baixa.tam is not distinct from k.tam and baixa.cor is not distinct from k.cor
  order by e.nome, k.tam nulls first;
$function$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._estoque_etiqueta_core(uuid)', '82840be36eb6cd8bc0c18e8219841d5d')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r16_est7 (volta): pos-condicao falhou - % nao voltou ao texto de antes (md5 %)', r.s,
        md5(pg_get_functiondef(to_regprocedure(r.s))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT assinatura, acl FROM _r16cv_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'medios_r16_est7 (volta): pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: os internos seguem sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._estoque_etiqueta_core(uuid)'),
                                 ('public._split_maior_resto(integer,jsonb)'),
                                 ('public._receber_oc_importado_core(uuid,jsonb,jsonb)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_est7 (volta): % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_est7 (volta): % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
