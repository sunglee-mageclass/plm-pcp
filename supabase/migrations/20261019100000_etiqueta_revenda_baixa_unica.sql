-- Contas certas, bloco B, item 6 (est #6): insumo de REVENDA baixado em DOBRO depois do "Enviar para PCP".
-- Causa (conferida na copia): _estoque_etiqueta_core soma, para a mesma chave (etiqueta, sem tamanho, cor), a CTE
-- baixa_sem (cad_etiquetas.quantidade_enviar dos CADs com enviado_corte) E a CTE baixa_revenda (BOM x pecas recebidas),
-- que nao olhava enviado_corte. Desde a Rota A a revenda passa por "Enviar para PCP" (baixar_estoque_tecido_corte seta
-- cad.enviado_corte=true) e _receber_oc_p_acabado_core materializa cad_etiquetas com o MESMO consumo x pecas -> 2x.
-- Correcao: baixa_revenda conta so os CADs AINDA NAO enviados (`and not coalesce(c.enviado_corte,false)`):
--   antes do envio  -> vale BOM x pecas recebidas (como hoje);
--   depois do envio -> vale o "a enviar" da Explosao (baixa_sem/baixa_var), que respeita a edicao da pessoa.
-- Uma troca so, marcada [contas-certas 6]; o resto da funcao e byte a byte o texto vivo.
-- Dados: nada gravado muda (o estoque e calculado na leitura) -> sem backfill. O Passo 0.2 diz se hoje ha numero errado
-- em producao (se sim, ele se corrige sozinho com este arquivo).
-- Fora do escopo (MEDIA): o importado nao baixa insumo nenhum (_receber_oc_importado_core nao cria cad_etiquetas).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._estoque_etiqueta_core(uuid)
--     ANTES  b71c9cf41342cbb835fb9d78303e862a  (copia local 54422 E producao (Passo 0 30/set 11:22) = texto da 20260909130000)
--     PRODUCAO = b71c9cf41342cbb835fb9d78303e862a (igual a copia)  (Passo 0 somente leitura, 30/set 11:22 - passo0-funcoes-2026-09-30-112215.csv)
--     DEPOIS 82840be36eb6cd8bc0c18e8219841d5d  (este arquivo; reaplicar = no-op)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Volta: supabase/rollback/20261019100000_etiqueta_revenda_baixa_unica_down.sql - recoloca o texto EXATO que estava vivo (guardado por esta
-- migration em public._bkp_funcoes_contas_certas; vale mesmo se producao != copia). Ordem de volta = LIFO da APLICACAO.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

-- ACCEPTED-MD5 (a lista unica usada pela guarda e pela pos-condicao)
CREATE TEMP TABLE _cc_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _cc_md5_aceitos VALUES
  ('public._estoque_etiqueta_core(uuid)', 'b71c9cf41342cbb835fb9d78303e862a', 'antes'),   -- copia local 54422 E producao (Passo 0 30/set 11:22) = texto da 20260909130000
  ('public._estoque_etiqueta_core(uuid)', '82840be36eb6cd8bc0c18e8219841d5d', 'depois');

-- Copia do texto vivo de cada funcao trocada (para a volta; vale mesmo se producao != copia).
-- RLS ligada SEM policy + REVOKE ALL: so o dono (postgres) le.
CREATE TABLE IF NOT EXISTS public._bkp_funcoes_contas_certas (
  migracao    text        NOT NULL,
  assinatura  text        NOT NULL,
  md5         text        NOT NULL,
  definicao   text        NOT NULL,
  guardado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (migracao, assinatura)
);
ALTER TABLE public._bkp_funcoes_contas_certas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_funcoes_contas_certas FROM PUBLIC, anon, authenticated;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_papel text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _cc_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'contas_certas_6: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    SELECT a.papel INTO v_papel FROM _cc_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5 LIMIT 1;
    IF v_papel IS NULL THEN
      RAISE EXCEPTION 'contas_certas_6: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
    IF v_papel = 'antes' THEN
      INSERT INTO public._bkp_funcoes_contas_certas (migracao, assinatura, md5, definicao)
      VALUES ('20261019100000', r.assinatura, v_md5, pg_get_functiondef(to_regprocedure(r.assinatura)))
      ON CONFLICT (migracao, assinatura) DO NOTHING;
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

-- Invariante #9: _core com EXECUTE revogado dos TRES (reafirmado; CREATE OR REPLACE nao muda a ACL).
REVOKE EXECUTE ON FUNCTION public._estoque_etiqueta_core(uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT assinatura, md5 FROM _cc_md5_aceitos WHERE papel = 'depois' LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.assinatura))) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'contas_certas_6: pos-condicao falhou - % nao ficou com o texto deste arquivo', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public._bkp_funcoes_contas_certas b WHERE b.migracao = '20261019100000' AND b.assinatura = r.assinatura) THEN
      RAISE EXCEPTION 'contas_certas_6: copia do texto de antes de % nao foi guardada (a volta nao teria o que restaurar)', r.assinatura
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public._estoque_etiqueta_core(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._estoque_etiqueta_core(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'contas_certas_6: _estoque_etiqueta_core ficou executavel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
