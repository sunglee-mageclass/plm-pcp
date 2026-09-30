-- P-137 A (30/set): Categoria/Subcategorias trocadas no CARD comprado (modelos.origem revenda/importado) passam para o
-- produto espelho (produtos_acabados / produtos_importados, vinculo modelo_id), como ja acontece com Nome e REF
-- (fn_modelo_espelho_nome_ref, 20261007140000). Hoje so existe o sentido produto -> card (P-136 A, so revenda).
-- Regras (plan.md + "Rulings do controlador" + "Respostas do dono", .superpowers/sdd/2026-09-30-p137/):
--   • COLUNA A COLUNA (R1): so vai ao produto a coluna que mudou NO CARD nesta escrita (categoria, sub1, sub2, cada uma
--     independente). O GRUPO do produto so acompanha quando a CATEGORIA e copiada (P-143 A) e vem da categoria nova
--     (categorias_produto.grupo_id). Nada "de carona": trocar so a sub1 nunca leva a categoria/grupo do card junto (D8b).
--   • NULL do card NUNCA e copiado (P-145 A, estendido as subs pelo ruling R3b): card sem categoria nao mexe no produto;
--     sub apagada no card nao apaga a do produto.
--   • Categoria sem grupo no cadastro (ou de outra loja) -> nao copia nada (R3a; o pre-voo conta esses casos).
--   • Produto COM pedido (OC) cuja categoria nova o levaria de Acessorios para outro grupo (ou o contrario) -> recusa
--     P0001 ASCII 'categoria_acessorio_com_pedido: ...' e o UPDATE do card inteiro e desfeito (P-142 B, PA e PI — R3d).
--     A tela traduz pelo prefixo (src/lib/erro-mensagem.ts) e o Sheet do Planejamento confere ANTES de gravar (R6).
--   • Vale depois do envio a Explosao e com o modulo desligado (R3c) — igual Nome/REF (SECURITY DEFINER ignora RLS).
--   • Isolamento: tenant_id = NEW.tenant_id na busca da categoria e no UPDATE (licao T5 #3).
--   • Sem ping-pong: nao existe gatilho produto -> card de categoria; o unico caminho produto -> card e o
--     _salvar_produto_acabado_core (P-136), que ja grava o produto ANTES do card — o UPDATE daqui casa 0 linhas
--     (WHERE "ainda diferente"). rev do produto so sobe quando a taxonomia dele muda de verdade.
--   • Categoria NAO e campo da Integracao (_integracao_layout sem taxonomia — conferido na guarda e por teste
--     anti-drift): a copia nunca recebe 42501 integracao_travado.
-- • Guarda: _salvar_produto_acabado_core = e5473bb29fa559408093d1a82c6ac11f (P-136 viva), travas da Integracao com o
--   texto conhecido, _integracao_layout sem taxonomia, trg_modelo_espelho_nome_ref presente, _grupo_eh_acessorio
--   presente; fn_modelo_espelho_categoria ausente OU ja com o texto desta migration (reaplicar = no-op).
-- • Zero DDL de tabela, zero backfill (o backfill e o arquivo 20261017110000, separado, com volta propria).
-- • Lock: CREATE TRIGGER pega SHARE ROW EXCLUSIVE em modelos (bloqueia GRAVACOES de cards por um instante, nao as
--   leituras) — lock_timeout 500ms + 3 tentativas so em 55P03.
-- • Inverso: supabase/rollback/20261017100000_categoria_card_para_produto_down.sql (LIFO: roda DEPOIS do inverso do
--   backfill 20261017110000 e ANTES dos inversos da release 5).
-- Aplicar fora de transacao (psql -v ON_ERROR_STOP=1 -f), com o client_encoding abaixo ANTES do BEGIN.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '10s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)') IS NULL
     OR md5(pg_get_functiondef('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'::regprocedure))
        IS DISTINCT FROM 'e5473bb29fa559408093d1a82c6ac11f' THEN
    RAISE EXCEPTION 'p137: _salvar_produto_acabado_core fora do texto da P-136 (20261016100000) - outra frente mexeu; refazer' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.fn_integracao_trava_espelho()') IS NULL
     OR md5(pg_get_functiondef('public.fn_integracao_trava_espelho()'::regprocedure)) IS DISTINCT FROM 'e239279ec27fe8257d31e262138b547e'
     OR to_regprocedure('public.fn_integracao_trava_modelos()') IS NULL
     OR md5(pg_get_functiondef('public.fn_integracao_trava_modelos()'::regprocedure)) IS DISTINCT FROM '6e98c10d13c469a910c778f66354aac3' THEN
    RAISE EXCEPTION 'p137: travas da Integracao mudaram desde o planejamento (fn_integracao_trava_espelho/_modelos) - refazer' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._integracao_layout()') IS NULL
     OR EXISTS (SELECT 1 FROM unnest(public._integracao_layout()) AS c(campo) WHERE c.campo ~* '(categoria|subcategoria|grupo)') THEN
    RAISE EXCEPTION 'p137: _integracao_layout ausente ou com taxonomia (categoria/grupo) - a trava do card teria de travar a categoria antes' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_modelo_espelho_nome_ref' AND tgrelid = 'public.modelos'::regclass) THEN
    RAISE EXCEPTION 'p137: trg_modelo_espelho_nome_ref ausente em modelos - espelho Nome/REF nao esta no ar' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._grupo_eh_acessorio(uuid)') IS NULL THEN
    RAISE EXCEPTION 'p137: _grupo_eh_acessorio(uuid) ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.fn_modelo_espelho_categoria()') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef('public.fn_modelo_espelho_categoria()'::regprocedure));
    IF v_md5 IS DISTINCT FROM '3ff558f37ef4ee75d36db77635a51268' THEN
      RAISE EXCEPTION 'p137: fn_modelo_espelho_categoria ja existe com outro texto (md5 %) - outra frente mexeu; refazer', v_md5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public.fn_modelo_espelho_categoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- P-137 A (R1): coluna a coluna — cada uma so vai ao produto quando ELA mudou no card nesta escrita.
  -- P-145 A (R3b): NULL do card nunca e copiado (categoria nem subs).
  v_cat boolean := OLD.categoria_principal_id IS DISTINCT FROM NEW.categoria_principal_id;
  v_s1 boolean := NEW.subcategoria1_id IS NOT NULL AND OLD.subcategoria1_id IS DISTINCT FROM NEW.subcategoria1_id;
  v_s2 boolean := NEW.subcategoria2_id IS NOT NULL AND OLD.subcategoria2_id IS DISTINCT FROM NEW.subcategoria2_id;
  v_grupo uuid;
  v_prod_id uuid;
  v_prod_grupo uuid;
BEGIN
  -- Card sem categoria (passo intermediario da troca de grupo no Sheet): o produto fica como esta.
  IF NEW.categoria_principal_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- P-143 A: o grupo vem da categoria nova. Categoria sem grupo (ou de outra loja) -> nao copia nada (R3a).
  SELECT c.grupo_id INTO v_grupo
    FROM public.categorias_produto c
   WHERE c.id = NEW.categoria_principal_id AND c.tenant_id = NEW.tenant_id;
  IF v_grupo IS NULL OR NOT (v_cat OR v_s1 OR v_s2) THEN
    RETURN NULL;
  END IF;

  IF NEW.origem = 'revenda' THEN
    -- P-142 B: produto com pedido nao troca entre Acessorios e outro grupo (grade UN x grade por tamanho).
    -- FOR UPDATE: serializa com um INSERT de OC concorrente (a FK dele pede KEY SHARE nesta linha).
    IF v_cat THEN
      SELECT pa.id, pa.grupo_id INTO v_prod_id, v_prod_grupo
        FROM public.produtos_acabados pa
       WHERE pa.modelo_id = NEW.id AND pa.tenant_id = NEW.tenant_id
       FOR UPDATE;
      IF FOUND AND v_prod_grupo IS DISTINCT FROM v_grupo
         AND public._grupo_eh_acessorio(v_prod_grupo) IS DISTINCT FROM public._grupo_eh_acessorio(v_grupo)
         AND EXISTS (SELECT 1 FROM public.ocs_p_acabado o WHERE o.produto_acabado_id = v_prod_id) THEN
        RAISE EXCEPTION 'categoria_acessorio_com_pedido: produto com pedido nao pode trocar entre Acessorios e outro grupo pela Categoria do card'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    UPDATE public.produtos_acabados pa
       SET grupo_id = CASE WHEN v_cat THEN v_grupo ELSE pa.grupo_id END,
           categoria_id = CASE WHEN v_cat THEN NEW.categoria_principal_id ELSE pa.categoria_id END,
           subcategoria1_id = CASE WHEN v_s1 THEN NEW.subcategoria1_id ELSE pa.subcategoria1_id END,
           subcategoria2_id = CASE WHEN v_s2 THEN NEW.subcategoria2_id ELSE pa.subcategoria2_id END,
           updated_at = now()
     WHERE pa.modelo_id = NEW.id
       AND pa.tenant_id = NEW.tenant_id
       AND ((v_cat AND (pa.grupo_id IS DISTINCT FROM v_grupo OR pa.categoria_id IS DISTINCT FROM NEW.categoria_principal_id))
         OR (v_s1 AND pa.subcategoria1_id IS DISTINCT FROM NEW.subcategoria1_id)
         OR (v_s2 AND pa.subcategoria2_id IS DISTINCT FROM NEW.subcategoria2_id));
  ELSIF NEW.origem = 'importado' THEN
    IF v_cat THEN
      SELECT pi.id, pi.grupo_id INTO v_prod_id, v_prod_grupo
        FROM public.produtos_importados pi
       WHERE pi.modelo_id = NEW.id AND pi.tenant_id = NEW.tenant_id
       FOR UPDATE;
      IF FOUND AND v_prod_grupo IS DISTINCT FROM v_grupo
         AND public._grupo_eh_acessorio(v_prod_grupo) IS DISTINCT FROM public._grupo_eh_acessorio(v_grupo)
         AND EXISTS (SELECT 1 FROM public.ocs_importado o WHERE o.produto_importado_id = v_prod_id) THEN
        RAISE EXCEPTION 'categoria_acessorio_com_pedido: produto com pedido nao pode trocar entre Acessorios e outro grupo pela Categoria do card'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    UPDATE public.produtos_importados pi
       SET grupo_id = CASE WHEN v_cat THEN v_grupo ELSE pi.grupo_id END,
           categoria_id = CASE WHEN v_cat THEN NEW.categoria_principal_id ELSE pi.categoria_id END,
           subcategoria1_id = CASE WHEN v_s1 THEN NEW.subcategoria1_id ELSE pi.subcategoria1_id END,
           subcategoria2_id = CASE WHEN v_s2 THEN NEW.subcategoria2_id ELSE pi.subcategoria2_id END,
           updated_at = now()
     WHERE pi.modelo_id = NEW.id
       AND pi.tenant_id = NEW.tenant_id
       AND ((v_cat AND (pi.grupo_id IS DISTINCT FROM v_grupo OR pi.categoria_id IS DISTINCT FROM NEW.categoria_principal_id))
         OR (v_s1 AND pi.subcategoria1_id IS DISTINCT FROM NEW.subcategoria1_id)
         OR (v_s2 AND pi.subcategoria2_id IS DISTINCT FROM NEW.subcategoria2_id));
  END IF;
  RETURN NULL;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_modelo_espelho_categoria() FROM PUBLIC, anon, authenticated;

-- CREATE OR REPLACE TRIGGER pega SHARE ROW EXCLUSIVE em modelos: ate 3 tentativas, SO em 55P03 (lock_not_available).
DO $gatilho$
DECLARE
  i int;
BEGIN
  FOR i IN 1..3 LOOP
    BEGIN
      EXECUTE $ddl$CREATE OR REPLACE TRIGGER trg_modelo_espelho_categoria
  AFTER UPDATE OF categoria_principal_id, subcategoria1_id, subcategoria2_id ON public.modelos
  FOR EACH ROW WHEN (NEW.origem IN ('revenda', 'importado') AND (
    OLD.categoria_principal_id IS DISTINCT FROM NEW.categoria_principal_id
    OR OLD.subcategoria1_id IS DISTINCT FROM NEW.subcategoria1_id
    OR OLD.subcategoria2_id IS DISTINCT FROM NEW.subcategoria2_id))
  EXECUTE FUNCTION public.fn_modelo_espelho_categoria()$ddl$;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF i = 3 THEN
        RAISE;
      END IF;
      RAISE NOTICE 'p137: modelos ocupada (tentativa % de 3) - tentando de novo em 1s', i;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END $gatilho$;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_espelho_categoria()')));
  IF v_md5 IS DISTINCT FROM '3ff558f37ef4ee75d36db77635a51268' THEN
    RAISE EXCEPTION 'p137: pos-condicao falhou - fn_modelo_espelho_categoria nao ficou com o texto esperado (md5 %); client_encoding? - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  SELECT md5(pg_get_triggerdef(t.oid)) INTO v_md5 FROM pg_trigger t
   WHERE t.tgname = 'trg_modelo_espelho_categoria' AND t.tgrelid = 'public.modelos'::regclass;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_modelo_espelho_categoria' AND NOT tgisinternal) <> 1
     OR v_md5 IS DISTINCT FROM '871039e642390c357188b6b2a1134d64' THEN
    RAISE EXCEPTION 'p137: pos-condicao falhou - trg_modelo_espelho_categoria ausente, duplicado ou com outra definicao (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', 'public.fn_modelo_espelho_categoria()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_modelo_espelho_categoria()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_modelo_espelho_categoria()', 'EXECUTE') THEN
    RAISE EXCEPTION 'p137: pos-condicao falhou - fn_modelo_espelho_categoria com EXECUTE para PUBLIC/anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'::regprocedure))
     IS DISTINCT FROM 'e5473bb29fa559408093d1a82c6ac11f' THEN
    RAISE EXCEPTION 'p137: pos-condicao falhou - _salvar_produto_acabado_core mudou' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
