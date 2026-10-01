-- Achados MEDIOS, release R15b (Plan. Tecido) - P-198 A (dono 01/out): card com modelos.status_desenvolvimento = 'reprovado'
-- deixa de contar na NECESSIDADE da colecao e na Demanda/sobra das OCs; continua VISIVEL na vaga (selo "Reprovado" no
-- site); saindo de Reprovado volta a contar (calculado na hora - nada e gravado).
--   * _plan_tecido_nec_variante_core: a necessidade por (artigo, variante) ignora as vagas cujo card esta reprovado
--     (vaga SEM card continua contando). Alimenta TUDO que o servidor calcula de necessidade no Plan. Tecido:
--     _plan_tecido_previa_pedido_core (CTEs necessidade, nonsel e owner_nec -> "A comprar", Fazer pedido, Modo Plano,
--     cobertura viva do Resumo/Drawer). A previa nao muda de texto (so guarda).
--   * _plan_tecido_situacao_ocs_core: comprometida_m (uso planejado = vinculos de cards enviados a Explosao) ignora card
--     reprovado. pedida/entregue/usada (baixa REAL no ledger) e a LISTA de OCs (uniao das 4 fontes) nao mudam - a OC do
--     card reprovado continua listada.
--   Predicado = o do _estoque_tecido_core (reserva): lower(coalesce(status_desenvolvimento,'')) <> 'reprovado'.
--   Espelho no site (anti-drift): calc.ts ehReprovado/arvoreDaDemanda (necessidadePorTecido, detalheOc, necVivoPorVariante).
--   NAO muda: has_card da previa (vinculo de card reprovado segue ligando a OC a colecao - a sobra dela cobre os outros
--   cards, coerente com a Situacao que lista a OC); _plan_tecido_vinculos_detalhe_core (so lista; o site ignora as vagas
--   reprovadas na reparticao); corte/estoque (R15a).
-- Efeito na copia 54422: so a Ave Rara tem reprovado em vaga (7 cards na Resort 27 Novo; so VESTIDO AURELIA tem grade:
-- MALHA LUNE AMARELO-BUTTER e MARROM-CAFE, 176,96 m cada -> nec 370,72->193,76 e 535,92->358,96; deficit 0 nas duas,
-- "a comprar" nao muda). Nenhum card reprovado enviado a Explosao -> comprometida_m nao muda na copia.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._plan_tecido_nec_variante_core(uuid,uuid,uuid[])
--     ANTES  e59a9516fda1d0eed5184765d04dec6b  -- PROVISORIO: so da copia 54422 - confirmar no Passo 0/kit em producao
--     DEPOIS c6d028593865733f22200cfe77a0f6ed  (este arquivo; reaplicar = no-op)
--   public._plan_tecido_situacao_ocs_core(uuid,uuid)
--     ANTES  29d4953a5ea039b9d995db12c511c8ae  -- = DEPOIS da R11, no ar
--     DEPOIS 3637250a51077eb098a9359d9be347a4  (este arquivo; reaplicar = no-op)
--   Chamador SEM mudanca (so guarda): public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[]) deefee4cadec3e5434aea0de970acc5f
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (nada em tabela, nada em auth/storage). Sem DDL de tabela, sem DROP, sem funcao
-- nova. ACL: CREATE OR REPLACE mantem a de hoje (os 2 _core sem EXECUTE para PUBLIC/anon/authenticated - inv. #9) -
-- conferido no fim.
-- LIFO: o inverso (supabase/rollback/20261025400000_plan_tecido_reprovado_down.sql) roda ANTES do inverso da R11
-- (20261021100000_down guarda _plan_tecido_situacao_ocs_core 29d4953a e recusa enquanto esta release estiver no banco).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r15b_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r15b_md5_aceitos VALUES
  ('public._plan_tecido_nec_variante_core(uuid,uuid,uuid[])',   'e59a9516fda1d0eed5184765d04dec6b', 'antes'),     -- PROVISORIO: so da copia 54422 (01/out) - confirmar no Passo 0/kit em producao
  ('public._plan_tecido_nec_variante_core(uuid,uuid,uuid[])',   'c6d028593865733f22200cfe77a0f6ed', 'depois'),
  ('public._plan_tecido_situacao_ocs_core(uuid,uuid)',          '29d4953a5ea039b9d995db12c511c8ae', 'antes'),     -- = DEPOIS da R11 (20261021100000), no ar em producao
  ('public._plan_tecido_situacao_ocs_core(uuid,uuid)',          '3637250a51077eb098a9359d9be347a4', 'depois'),
  ('public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])',  'deefee4cadec3e5434aea0de970acc5f', 'chamador');  -- = DEPOIS da R11 (fix round 1), no ar em producao; texto INTOCADO (le a necessidade pela _nec_variante_core)

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _r15b_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'medios_r15b: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r15b_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r15b: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public._plan_tecido_nec_variante_core(_tenant uuid, _colecao_id uuid, _slot_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(artigo_id uuid, variante_tecido_id uuid, nec_m numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(vt.artigo_id, mt.artigo_id) as artigo_id, vv.variante_tecido_id,
         sum(coalesce(mt.consumo,0) * coalesce(vv.grade_total,0) * coalesce(vv.multiplicador,1))::numeric as nec_m
  from plan_tecido p
  join plan_tecido_subcolecoes s on s.plan_id = p.id
  join plan_tecido_linhas l on l.sub_id = s.id
  join plan_tecido_slots sl on sl.linha_ref_id = l.id  -- flag usar_estoque APOSENTADO (17/ago): TODO card entra na necessidade; cobertura por vínculo abate
  left join modelos mo on mo.id = sl.modelo_id  -- [medios R15b P-198 A] card REPROVADO fica na vaga mas nao conta na necessidade
  join plan_tecido_materiais mt on mt.slot_id = sl.id
  join plan_tecido_variantes vv on vv.material_id = mt.id
  left join variantes_tecido vt on vt.id = vv.variante_tecido_id  -- artigo REAL da variante (raiz do fix de 20260802140000)
  where p.colecao_id = _colecao_id and p.tenant_id = _tenant
    and (_slot_ids is null or sl.id = any(_slot_ids))  -- [G5] filtro por seleção de cards; NULL = coleção inteira (comportamento de hoje)
    and vv.variante_tecido_id is not null
    and lower(coalesce(mo.status_desenvolvimento,'')) <> 'reprovado'  -- [medios R15b P-198 A] mesmo predicado do _estoque_tecido_core; vaga sem card conta
    and coalesce(vt.artigo_id, mt.artigo_id) is not null
  group by coalesce(vt.artigo_id, mt.artigo_id), vv.variante_tecido_id;
$function$;

CREATE OR REPLACE FUNCTION public._plan_tecido_situacao_ocs_core(_tenant uuid, _colecao_id uuid)
 RETURNS TABLE(oc_tecido_id uuid, numero text, data_pedido date, status text, artigo_id uuid, artigo_nome text, variante_tecido_id uuid, variante_label text, pedida_m numeric, entregue_m numeric, usada_m numeric, comprometida_m numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;

  return query
  with ocs as (
    select o.oc_tecido_id from plan_tecido_ocs o where o.colecao_id = _colecao_id and o.tenant_id = _tenant
    union
    select a.oc_tecido_id from plan_tecido_oc_aplicada a where a.colecao_id = _colecao_id and a.tenant_id = _tenant
    union
    -- OCs vinculadas via DESENVOLVIMENTO (modelo_tecido_oc_links): reservam metros no plano
    -- mas ficavam INVISÍVEIS aqui (auditoria jul/2026 — Ave Rara: ANGELIM sumia do Resumo).
    select it2.oc_tecido_id
      from modelo_tecido_oc_links l
      join modelos m on m.id = l.modelo_id and m.colecao_id = _colecao_id and m.tenant_id = _tenant
      join ocs_tecido_itens it2 on it2.id = l.oc_tecido_item_id
    union
    -- OCs apontadas por HINT de slot do plano (plan_tecido_slot_oc)
    select so.oc_tecido_id from plan_tecido_slot_oc so
     where so.colecao_id = _colecao_id and so.tenant_id = _tenant
  )
  select oc.id as oc_tecido_id,
         oc.numero_pedido::text as numero,
         oc.data_pedido,
         oc.status::text as status,
         coalesce(vt.artigo_id, it.artigo_id) as artigo_id,   -- tecido = artigo REAL da variante
         coalesce(avt.nome, ar.nome)::text as artigo_nome,
         it.variante_tecido_id,
         concat_ws(' - ', vt.nome_variante, cor.nome, ap.nome) as variante_label,
         (case when ar.unidade_medida = 'kg' then coalesce(it.quantidade_pedida,0) * coalesce(ar.rendimento,0)
               else coalesce(it.quantidade_pedida,0) end)::numeric as pedida_m,
         -- [medios R11] entregue = a MESMA regra do saldo por item / CTE receb do core: so OC RECEBIDA conta;
         -- recebida, senao a pedida (0 se e reposicao de troca). OC nao recebida -> 0 (item cancelado ja fica fora no join).
         (case when oc.status is distinct from 'recebido' then 0
               when ar.unidade_medida = 'kg'
                 then coalesce(it.quantidade_recebida, case when it.substitui_item_id is not null then 0 else it.quantidade_pedida end, 0) * coalesce(ar.rendimento,0)
               else coalesce(it.quantidade_recebida, case when it.substitui_item_id is not null then 0 else it.quantidade_pedida end, 0) end)::numeric as entregue_m,
         coalesce(bx.usada,0)::numeric as usada_m,             -- pt2 baixa real (vermelho)
         coalesce(cm.comprometida,0)::numeric as comprometida_m  -- pt1 enviado à explosão (laranja)
  from ocs
  join ocs_tecido oc on oc.id = ocs.oc_tecido_id and oc.tenant_id = _tenant and not coalesce(oc.is_rolo,false)
  join ocs_tecido_itens it on it.oc_tecido_id = oc.id and coalesce(it.cancelado,false) = false and it.variante_tecido_id is not null
  join artigos ar on ar.id = it.artigo_id
  left join variantes_tecido vt on vt.id = it.variante_tecido_id
  left join artigos avt on avt.id = vt.artigo_id
  left join cores cor on cor.id = vt.cor_id
  left join cores_apelido ap on ap.id = vt.cor_apelido_id
  left join lateral (
    select coalesce(sum(b.quantidade),0) as usada
    from estoque_tecido_baixas b where b.oc_tecido_item_id = it.id
  ) bx on true
  left join lateral (
    -- uso PLANEJADO: vínculos desta OC-item de modelos ENVIADOS À EXPLOSÃO (enviado_cad)
    select coalesce(sum(l.quantidade_m),0) as comprometida
    from modelo_tecido_oc_links l
    join modelos m on m.id = l.modelo_id
    where l.oc_tecido_item_id = it.id and coalesce(m.enviado_cad,false) = true
      and lower(coalesce(m.status_desenvolvimento,'')) <> 'reprovado'  -- [medios R15b P-198 A] reprovado nao compromete a OC
  ) cm on true;
end $function$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _r15b_md5_aceitos WHERE papel IN ('depois','chamador') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'medios_r15b: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.assinatura, 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r15b: % ficou executavel por anon', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('authenticated', r.assinatura, 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r15b: % ficou executavel por authenticated (inv. #9)', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.assinatura) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r15b: % ficou executavel por PUBLIC (inv. #9)', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
