-- Achados MEDIOS, release R16 (so banco, sem site): est #7, P-188 A (dono 01/out) + carona do importado (plano §5).
--   _estoque_etiqueta_core (estoque de INSUMO; chamado so por estoque_etiqueta(), aba Estoque do OC Insumo): o estoque
--   de insumo COM tamanho (ex.: etiqueta 34|PPP, 36|PP...) fica por tamanho, mas a baixa do corte caia toda em "sem
--   tamanho" (nenhuma tela preenche cad_etiquetas.enviar_por_tamanho), entao o estoque de cada tamanho nunca descia.
--   Agora, no CAD enviado ao corte, a linha do "a enviar" SEM enviar_por_tamanho de insumo COM tamanho (formato_tamanho
--   <> 'nenhum' e alguma variante com tamanho - a MESMA regra da Ficha de Corte) e repartida pela GRADE do CAD
--   (cad_grades.grades_planejadas somada das variantes, so tamanhos com peca > 0; a Ficha de Corte ja explode assim)
--   com _split_maior_resto (maior resto: a soma da baixa e preservada). So a parte INTEIRA e repartida; a fracao (< 1)
--   de quantidade_enviar com casas decimais fica em "sem tamanho". Sem grade (Sigma 0) ou quantidade < 1: como antes.
--   enviar_por_tamanho preenchido continua mandando (baixa_var intocada). Insumo sem tamanho: intocado.
--   Carona (plano §5 "insumo do importado nao baixa", BAIXA): a baixa de insumo pelas PECAS RECEBIDAS (baixa_revenda:
--   modelo_etiquetas.consumo x cad_grades.grade_total_real do cad-espelho, so antes do "Enviar para PCP") passa a valer
--   tambem para origem 'importado' - _receber_oc_importado_core grava o cad-espelho + cad_grades e NAO cria
--   cad_etiquetas, entao nao ha baixa em dobro. Limite (igual a revenda antes da Rota A): se um importado for enviado
--   ao corte, a baixa passa a ser a do "a enviar" da Explosao (que o importado nao materializa). Hoje: 0 linhas de
--   insumo em importado (plano §5); na copia nenhum importado (nem revenda) tem cad.
-- Efeito (so leitura; nada gravado muda): Passo 0 de producao (01/out 11:06): 1162 cad_etiquetas, 0 com
-- enviar_por_tamanho, 6 de insumo com tamanho, 4 delas em CAD cortado - todas Loja Teste (12 variantes com tamanho).
-- Na copia (Loja Teste, "Etiqueta Tamanho"): os 4 cortados (Blusa Master 128, Vestal 128, Blusa Teste 300 + 480) saem
-- de "sem tamanho" (Amarelo 256, Bege 780) para os 6 tamanhos (Amarelo PPP 32/PP 32/P 64/M 48/G 32/GG 48; Bege 130
-- cada); Sigma da baixa igual (1528). Amarelo 34|PPP (recebido 10) vai de fisico 10 a 0 (baixa 32, piso 0).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._estoque_etiqueta_core(uuid)
--     ANTES  82840be36eb6cd8bc0c18e8219841d5d  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS 28aa308d297cc18b653c6290a5b3b958  (este arquivo; reaplicar = no-op)
--   Sem mudanca (so guarda):
--     public._split_maior_resto(integer,jsonb)              29e39014e3c099a2235452c9b8051524  -- CONFIRMADO: Passo 0 (01/out 11:06)
--     public._receber_oc_importado_core(uuid,jsonb,jsonb)   4879213f321b69c08cbf129f62d5f5fe  -- PROVISORIO (copia 54422): conferir no kit combinado
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (trava de objeto da propria funcao; nada em tabela, nada em auth/storage).
-- Sem DDL de tabela, sem DROP, sem funcao nova. ACL: CREATE OR REPLACE mantem a de hoje (so postgres/service_role -
-- inv. #9); a pos-condicao confere ACL identica e sem EXECUTE para PUBLIC/anon/authenticated. estoque_etiqueta()
-- (wrapper com o modgate entrada_saida) nao muda.
-- Volta: supabase/rollback/20261026300000_insumo_baixa_por_tamanho_down.sql (devolve o texto de antes, com guarda do
-- de depois). LIFO: o inverso DESTA roda ANTES de 20261019100000_etiqueta_revenda_baixa_unica_down (confere
-- _estoque_etiqueta_core 82840be3, o texto que esta volta devolve).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r16c_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r16c_md5_aceitos VALUES
  ('public._estoque_etiqueta_core(uuid)', '82840be36eb6cd8bc0c18e8219841d5d', 'antes'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._estoque_etiqueta_core(uuid)', '28aa308d297cc18b653c6290a5b3b958', 'depois'),  -- este arquivo; reaplicar = no-op
  ('public._split_maior_resto(integer,jsonb)', '29e39014e3c099a2235452c9b8051524', 'dep'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._receber_oc_importado_core(uuid,jsonb,jsonb)', '4879213f321b69c08cbf129f62d5f5fe', 'dep');  -- PROVISORIO (copia 54422): conferir no kit combinado

-- ACL de antes (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _r16c_acl_antes ON COMMIT DROP AS
  SELECT DISTINCT a.assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(a.assinatura)) AS acl
    FROM _r16c_md5_aceitos a;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _r16c_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'medios_r16_est7: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r16c_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r16_est7: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

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
  ce_sem as (  -- [medios R16 est #7, P-188 A] linhas do "a enviar" SEM enviar_por_tamanho. Insumo COM tamanho (formato
               -- <> 'nenhum' e alguma variante com tamanho - a mesma regra da Ficha de Corte) ganha os pesos = grade do
               -- CAD por tamanho (soma das variantes de cad_grades.grades_planejadas, so tamanhos com peca > 0).
    select ce.etiqueta_id as etq, ce.cor_id as cor, coalesce(ce.quantidade_enviar, 0) as qe,
           case when coalesce(e.formato_tamanho, 'ambos') <> 'nenhum'
                 and exists (select 1 from variantes_etiqueta ve where ve.etiqueta_id = ce.etiqueta_id and ve.tamanho is not null)
                then (select jsonb_object_agg(w.k, w.s)
                        from (select kv.key as k, sum((kv.value)::numeric) as s
                                from cad_grades g
                                cross join lateral jsonb_each_text(coalesce(g.grades_planejadas, '{}'::jsonb)) kv
                               where g.cad_id = ce.cad_id and kv.value ~ '^[0-9]+(\.[0-9]+)?$'
                               group by kv.key
                              having sum((kv.value)::numeric) > 0) w)
           end as pesos
    from cad_etiquetas ce
    join cad c on c.id = ce.cad_id and c.tenant_id = _tenant and c.enviado_corte
    left join etiquetas e on e.id = ce.etiqueta_id
    where coalesce(ce.enviar_por_tamanho, '{}'::jsonb) = '{}'::jsonb
  ),
  baixa_grade as (  -- [est #7] parte INTEIRA do "a enviar" repartida pela grade (maior resto: Sigma preservada)
    select s.etq, kv.key as tam, s.cor, sum((kv.value)::numeric) as tot
    from ce_sem s
    cross join lateral jsonb_each_text(public._split_maior_resto(floor(s.qe)::int, s.pesos)) kv
    where s.pesos is not null and s.qe >= 1
    group by 1, 2, 3
  ),
  baixa_sem as (  -- consumo sem tamanho: chave (etiqueta, NULL, cor do CAD). Insumo sem tamanho (ou sem grade): tudo
                  -- aqui, como antes; repartido pela grade: so a fracao (< 1) que sobrou da parte inteira.
    select s.etq, null::text as tam, s.cor,
           sum(case when s.pesos is not null and s.qe >= 1 then s.qe - floor(s.qe) else s.qe end) as tot
    from ce_sem s
    where not (s.pesos is not null and s.qe >= 1) or s.qe - floor(s.qe) > 0
    group by 1, 3
  ),
  baixa_revenda as (  -- consumo de insumo em REVENDA: sem corte/CAD-tecido — o gatilho é a
                       -- OC P. Acabado recebida, refletida em cad_grades.grade_total_real do
                       -- cad-espelho (receber_oc_p_acabado, Task 3). Sem tamanho (BOM de
                       -- revenda = modelo_etiquetas, sem coluna tamanho).
    select me.etiqueta_id as etq, null::text as tam, me.cor_id as cor,
           sum(me.consumo * coalesce(cg.total_real, 0)) as tot
    from modelo_etiquetas me
    join modelos m on m.id = me.modelo_id and m.tenant_id = _tenant and m.origem in ('revenda', 'importado')
                                            -- [medios R16, carona] importado: o recebimento (_receber_oc_importado_core) grava
                                            -- o cad-espelho + cad_grades e NAO cria cad_etiquetas -> baixa pelas pecas recebidas
    join cad c on c.modelo_id = m.id and c.tenant_id = _tenant
     and not coalesce(c.enviado_corte, false)  -- [contas-certas 6] so ANTES do Enviar para PCP; depois vale o
                                               -- "a enviar" da Explosao (baixa_sem/baixa_var) -> sem baixa em dobro
    join (select cad_id, sum(grade_total_real) as total_real from cad_grades group by cad_id) cg
      on cg.cad_id = c.id
    group by 1, 3
  ),
  baixa as (
    select etq, tam, cor, sum(tot) as tot
    from (select * from baixa_var union all select * from baixa_grade union all select * from baixa_sem
          union all select * from baixa_revenda) x
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
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _r16c_md5_aceitos WHERE papel IN ('depois','dep') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'medios_r16_est7: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- ACL identica a de antes (CREATE OR REPLACE nao mexe; conferido).
  FOR r IN SELECT assinatura, acl FROM _r16c_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'medios_r16_est7: pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: os internos seguem sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._estoque_etiqueta_core(uuid)'),
                                 ('public._split_maior_resto(integer,jsonb)'),
                                 ('public._receber_oc_importado_core(uuid,jsonb,jsonb)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_est7: % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_est7: % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
