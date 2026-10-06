-- Urgentes R8b - CORRECAO UNICA: titulo das sublinhas dos INTEGRAVEIS refeito com a regra da 20261103190000 (titulo do pai +
-- cor antes do ultimo ' | '). GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 5 / R8b; Ruling 18; P-303 A). Molde: I3c 20261030120000
-- (correcao unica dos integraveis) + release 4 20261013100000 (P-127 B / P-129 A: reprocesso so do nome das sublinhas).
-- O que faz (P-303 A, Ruling 18): para CADA integravel com retrato v<>4 (ordem modelo_id, FOR UPDATE):
--   - titulo marcado: titulo-base = valores.titulo da linha 'produto' do RETRATO gravado (NUNCA o cadastro vivo); cor de cada
--     sublinha pela P-129 A (a do RETRATO quando Cor base/Apelido esta marcado; senao o nome VIVO da variante pela variante_key
--     nas 3 origens - o MESMO SELECT da release 4); modo = escolha ATUAL da loja (_integracao_cor_no_nome(sku_config), como a
--     release 4); titulo = _integracao_titulo_sublinha(base, cor, apelido, modo); grava no retrato E em integracao_linhas.titulo
--     (ROW_COUNT = 1 por sublinha). Variante nao achada no cadastro = RAISE (nada muda).
--   - TODO integravel (inclusive sem 'titulo' marcado): retrato v=4; assinatura = _integracao_assinar(retrato); rev + 1;
--     1 registro 'editar' no Log ("Sistema (título das sublinhas)"; detalhe {reprocesso:'titulo_sublinhas_cor', cor_no_nome,
--     sublinhas:<n mudadas>, exemplo:{antes,depois}|null, assinatura_antes, assinatura_depois}).
--   - O resto do retrato fica byte a byte igual. INTEGRADOS INTOCADOS (foto md5 antes/depois de tudo o que nao e reprocessado -
--     integracao_produtos e integracao_linhas).
-- Backup: public._bkp_r8_titulo_sublinha (modelo_id, tenant_id, retrato_antes, assinatura_antes, rev_antes, titulos_antes [{ordem,titulo}] das
-- sublinhas em integracao_linhas, assinatura_depois) - RLS sem policy + REVOKE ALL (so o dono le). Nao apagar.
-- Pos: 0 integraveis com v<>4; toda assinatura (integravel/integrado) = HMAC(retrato); integracao_linhas.titulo = retrato por
-- ordem em todo integravel; backup ilegivel por anon/authenticated. Reaplicar = 0 reprocessados, 0 Log (idempotente).
-- Teto: > 1000 integraveis a reprocessar = PARA (o kit divide) - conferido na guarda E reconferido sob o LOCK.
-- Trava (HORARIO CALMO): LOCK EXCLUSIVE em integracao_produtos/integracao_linhas (= release 4/I3c, sem a config): LEITURAS
-- seguem (API/tela); escritas (marcar/voltar/desfazer/confirmar, Gerar JSON, integracao_salvar) esperam o COMMIT. lock_timeout
-- 500ms -> 55P03 = nada mudou, rodar de novo. Uma leitura da API em andamento nao confirma o produto reprocessado (assinatura
-- nova) - ele sai na proxima consulta (= I3c).
-- Exige a 20261103190000 (r8a) aplicada: md5 DEPOIS de _integracao_retrato_core e integracao_listar + o helper novo.
-- Volta (LIFO, a PRIMEIRA da frente R8): supabase/rollback/20261103191000_urg_r8_titulo_sublinha_reprocesso_down.sql - ANTES do 20261103190000_down (r8a) e dos inversos da
-- Integracao (I3c 20261030120000_down so devolve quem tem a assinatura da I3c). A volta de EMERGENCIA da Integracao
-- (.superpowers/integracao/mig/volta-producao.sh) tem de comecar por 20261103191000_down e 20261103190000_down (nesta ordem).
-- DROP do backup: supabase/rollback/20261103191000_urg_r8_titulo_sublinha_reprocesso_down_drop.sql (opcional, depois do _down).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
  v_n integer;
BEGIN
  IF to_regclass('public.integracao_produtos') IS NULL OR to_regclass('public.integracao_linhas') IS NULL
     OR to_regclass('public.integracao_log') IS NULL OR to_regclass('public.tenant_config') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'titulo' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'r8b: tabelas da Integracao ausentes' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_retrato_core(uuid,text[],jsonb)', '2635e1833654111858a301f7ef06ccf1'),
      ('public.integracao_listar(text,jsonb,integer,integer)', '5fd15e4b95fc5555e055935a67af62e8'),
      ('public._integracao_titulo_sublinha(text,text,text,text)', 'a847a61f50f4b72608aa10edaa7ac0c9')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'r8b: % com texto inesperado (md5 %) - exige a 20261103190000 (r8a) aplicada', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_assinar(jsonb)', 'bbe03c7d24dc3a470387c0164073146b'),
      ('public._integracao_logar(uuid,text,uuid,jsonb,text)', '52b347ee02742906c19765c46e8cfec4'),
      ('public._integracao_cor_no_nome(jsonb)', '5180d729efa5e6d4b019f4d426ccdc04'),
      ('public._sku_variante_key(uuid,uuid)', 'c82de176f859ac0d9c2651c3ae741d3c'),
      ('public.integracao_marcar(jsonb)', 'b4400251395251b80a458eb11524d172')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'r8b: dependencia % com texto inesperado (md5 %) - gere de novo', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado = 'integravel' AND p.retrato ->> 'v' IS DISTINCT FROM '4';
  IF v_n > 1000 THEN
    RAISE EXCEPTION 'r8b: % integraveis a reprocessar (teto 1000) - dividir a janela', v_n USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

LOCK TABLE public.integracao_produtos, public.integracao_linhas IN EXCLUSIVE MODE;

-- o teto e reconferido DEPOIS do LOCK (a contagem da guarda e so pre-checagem; = I3c G-MIGRATION L2)
DO $teto$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado = 'integravel' AND p.retrato ->> 'v' IS DISTINCT FROM '4';
  IF v_n > 1000 THEN
    RAISE EXCEPTION 'r8b: % integraveis a reprocessar sob o LOCK (teto 1000) - dividir a janela', v_n USING ERRCODE = 'P0001';
  END IF;
END
$teto$;

CREATE TABLE IF NOT EXISTS public._bkp_r8_titulo_sublinha (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  retrato_antes jsonb NOT NULL,
  assinatura_antes text,
  rev_antes integer NOT NULL,
  titulos_antes jsonb NOT NULL DEFAULT '[]'::jsonb,
  assinatura_depois text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public._bkp_r8_titulo_sublinha IS
  'Backup da correcao unica urg R8b (20261103191000): integraveis com o titulo das sublinhas reprocessado (antes/depois). So o inverso le. Nao apagar.';
ALTER TABLE public._bkp_r8_titulo_sublinha ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_r8_titulo_sublinha FROM PUBLIC, anon, authenticated, service_role;

DO $reprocessa$
DECLARE
  ip record;
  l jsonb;
  v_ids uuid[];
  v_mids uuid[];
  v_ret jsonb;
  v_campos text[];
  v_modo text;
  v_origem text;
  v_tit text;
  v_linhas jsonb;
  v_titulos_antes jsonb;
  v_antigo text;
  v_novo text;
  v_cor text;
  v_ap text;
  v_cor_viva text;
  v_ap_viva text;
  v_achou boolean;
  v_vk uuid;
  v_sem_cor uuid := public._sku_variante_key(NULL::uuid, NULL::uuid);
  v_mudou integer;
  v_ex jsonb;
  v_ass text;
  v_upd integer;
  v_n_prod integer := 0;
  v_n_com integer := 0;
  v_n_sub integer := 0;
  v_intocados_antes text;
  v_intocados_depois text;
BEGIN
  v_ids := ARRAY(SELECT p.id FROM public.integracao_produtos p
                  WHERE p.estado = 'integravel' AND p.retrato ->> 'v' IS DISTINCT FROM '4' ORDER BY p.modelo_id);
  v_mids := ARRAY(SELECT p.modelo_id FROM public.integracao_produtos p WHERE p.id = ANY(v_ids));
  -- tudo o que NAO e reprocessado (integrados inclusive) - foto antes; conferida no fim deste bloco
  SELECT md5(coalesce((SELECT string_agg(p::text, '|' ORDER BY p.id) FROM public.integracao_produtos p WHERE p.id <> ALL(v_ids)), '')
          || '#' || coalesce((SELECT string_agg(il::text, '|' ORDER BY il.id) FROM public.integracao_linhas il
                               WHERE il.modelo_id <> ALL(v_mids)), ''))
    INTO v_intocados_antes;
  FOR ip IN
    SELECT p.id, p.tenant_id, p.modelo_id, p.retrato, p.assinatura, p.rev
      FROM public.integracao_produtos p
     WHERE p.id = ANY(v_ids)
     ORDER BY p.modelo_id
       FOR UPDATE
  LOOP
    IF ip.retrato IS NULL OR jsonb_typeof(ip.retrato -> 'linhas') IS DISTINCT FROM 'array'
       OR jsonb_typeof(ip.retrato -> 'campos') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'r8b: integravel sem retrato valido (modelo %)', ip.modelo_id USING ERRCODE = 'P0001';
    END IF;
    -- v=1 (nome sem cor) nunca deveria existir depois da release 4: nao "promove" um retrato que ela nao reprocessou
    IF (ip.retrato ->> 'v') IS NULL OR (ip.retrato ->> 'v') NOT IN ('2', '3') THEN
      RAISE EXCEPTION 'r8b: integravel com retrato v=% inesperado (modelo %)', coalesce(ip.retrato ->> 'v', 'null'), ip.modelo_id
        USING ERRCODE = 'P0001';
    END IF;
    v_ret := ip.retrato;
    v_campos := ARRAY(SELECT jsonb_array_elements_text(v_ret -> 'campos'));
    v_modo := public._integracao_cor_no_nome((SELECT tc.sku_config FROM public.tenant_config tc WHERE tc.tenant_id = ip.tenant_id));
    v_linhas := v_ret -> 'linhas';
    v_mudou := 0;
    v_ex := NULL;
    v_titulos_antes := '[]'::jsonb;
    IF 'titulo' = ANY(v_campos) THEN
      SELECT coalesce(m.origem, 'interno') INTO v_origem FROM public.modelos m WHERE m.id = ip.modelo_id;
      -- titulo-base = o do RETRATO (linha 'produto'), nunca o cadastro vivo
      v_tit := (SELECT e.x -> 'valores' ->> 'titulo' FROM jsonb_array_elements(v_ret -> 'linhas') AS e(x)
                 WHERE e.x ->> 'tipo' = 'produto' LIMIT 1);
      v_titulos_antes := coalesce((SELECT jsonb_agg(jsonb_build_object('ordem', il.ordem, 'titulo', il.titulo) ORDER BY il.ordem)
                                     FROM public.integracao_linhas il
                                    WHERE il.modelo_id = ip.modelo_id AND il.tipo = 'variante'), '[]'::jsonb);
      v_linhas := '[]'::jsonb;
      FOR l IN SELECT e.x FROM jsonb_array_elements(v_ret -> 'linhas') WITH ORDINALITY AS e(x, n) ORDER BY e.n LOOP
        IF l ->> 'tipo' = 'variante' THEN
          v_antigo := l -> 'valores' ->> 'titulo';
          -- P-129 A (= release 4 20261013100000): a cor do RETRATO quando o campo esta marcado; o nome VIVO da variante (3
          -- origens, sem filtro de grade) so e lido quando a cor que entra no titulo NAO esta no retrato: modo Cor base sem
          -- cor_base marcado; modo Apelido sem cor_apelido marcado, ou com ele marcado mas VAZIO (variante sem apelido = a cor
          -- base) e cor_base nao marcado.
          v_vk := (l ->> 'variante_key')::uuid;
          v_cor_viva := NULL;
          v_ap_viva := NULL;
          IF v_vk IS DISTINCT FROM v_sem_cor
             AND (CASE WHEN v_modo = 'cor_apelido'
                       THEN NOT ('cor_apelido' = ANY(v_campos))
                            OR (nullif(btrim(l -> 'valores' ->> 'cor_apelido'), '') IS NULL AND NOT ('cor_base' = ANY(v_campos)))
                       ELSE NOT ('cor_base' = ANY(v_campos)) END) THEN
            v_achou := false;
            SELECT c.nome::text, a.nome::text, true INTO v_cor_viva, v_ap_viva, v_achou
              FROM (SELECT vt.cor_id AS vcor, vt.cor_apelido_id AS vapelido, mtv.ordem AS vordem
                      FROM public.modelo_tecidos mt
                      JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id
                      JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
                     WHERE v_origem = 'interno' AND mt.modelo_id = ip.modelo_id AND mt.tipo = 'tecido' AND mt.numero = 1
                    UNION ALL
                    SELECT pv.cor_id, pv.cor_apelido_id, pv.ordem
                      FROM public.produtos_acabados pa
                      JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
                     WHERE v_origem = 'revenda' AND pa.modelo_id = ip.modelo_id
                    UNION ALL
                    SELECT iv.cor_id, iv.cor_apelido_id, iv.ordem
                      FROM public.produtos_importados pi
                      JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
                     WHERE v_origem = 'importado' AND pi.modelo_id = ip.modelo_id) AS va
              LEFT JOIN public.cores c ON c.id = va.vcor
              LEFT JOIN public.cores_apelido a ON a.id = va.vapelido
             WHERE public._sku_variante_key(va.vcor, va.vapelido) = v_vk
             ORDER BY va.vordem NULLS LAST
             LIMIT 1;
            IF NOT coalesce(v_achou, false) THEN
              RAISE EXCEPTION 'r8b: variante da sublinha nao encontrada no cadastro (modelo %, ordem %)', ip.modelo_id,
                l ->> 'ordem' USING ERRCODE = 'P0001';
            END IF;
          END IF;
          v_cor := CASE WHEN 'cor_base' = ANY(v_campos) THEN l -> 'valores' ->> 'cor_base' ELSE v_cor_viva END;
          v_ap := CASE WHEN 'cor_apelido' = ANY(v_campos) THEN l -> 'valores' ->> 'cor_apelido' ELSE v_ap_viva END;
          v_novo := public._integracao_titulo_sublinha(v_tit, v_cor, v_ap, v_modo);
          IF v_novo IS DISTINCT FROM v_antigo THEN
            v_mudou := v_mudou + 1;
            IF v_ex IS NULL THEN
              v_ex := jsonb_build_object('antes', v_antigo, 'depois', v_novo);
            END IF;
          END IF;
          l := jsonb_set(l, '{valores,titulo}', coalesce(to_jsonb(v_novo), 'null'::jsonb));
          UPDATE public.integracao_linhas il
             SET titulo = v_novo
           WHERE il.modelo_id = ip.modelo_id AND il.ordem = (l ->> 'ordem')::integer AND il.tipo = 'variante';
          GET DIAGNOSTICS v_upd = ROW_COUNT;
          IF v_upd <> 1 THEN
            RAISE EXCEPTION 'r8b: linha da API ausente (modelo %, ordem %)', ip.modelo_id, l ->> 'ordem' USING ERRCODE = 'P0001';
          END IF;
        END IF;
        v_linhas := v_linhas || jsonb_build_array(l);
      END LOOP;
    END IF;
    v_ret := jsonb_set(jsonb_set(v_ret, '{linhas}', v_linhas), '{v}', '4'::jsonb);
    v_ass := public._integracao_assinar(v_ret);
    INSERT INTO public._bkp_r8_titulo_sublinha (modelo_id, tenant_id, retrato_antes, assinatura_antes, rev_antes, titulos_antes, assinatura_depois)
    VALUES (ip.modelo_id, ip.tenant_id, ip.retrato, ip.assinatura, ip.rev, v_titulos_antes, v_ass);
    UPDATE public.integracao_produtos
       SET retrato = v_ret, assinatura = v_ass, rev = rev + 1, atualizado_em = now()
     WHERE id = ip.id;
    -- TODO integravel reprocessado ganha o registro (tambem sem titulo marcado/mudado: sublinhas 0, exemplo null; Ruling 18)
    PERFORM public._integracao_logar(ip.tenant_id, 'editar', ip.modelo_id,
      jsonb_build_object('reprocesso', 'titulo_sublinhas_cor', 'cor_no_nome', v_modo, 'sublinhas', v_mudou, 'exemplo', v_ex,
                         'assinatura_antes', ip.assinatura, 'assinatura_depois', v_ass),
      'Sistema (título das sublinhas)');
    v_n_prod := v_n_prod + 1;
    IF v_mudou > 0 THEN
      v_n_com := v_n_com + 1;
      v_n_sub := v_n_sub + v_mudou;
    END IF;
  END LOOP;
  SELECT md5(coalesce((SELECT string_agg(p::text, '|' ORDER BY p.id) FROM public.integracao_produtos p WHERE p.id <> ALL(v_ids)), '')
          || '#' || coalesce((SELECT string_agg(il::text, '|' ORDER BY il.id) FROM public.integracao_linhas il
                               WHERE il.modelo_id <> ALL(v_mids)), ''))
    INTO v_intocados_depois;
  IF v_intocados_depois IS DISTINCT FROM v_intocados_antes THEN
    RAISE EXCEPTION 'r8b: integrados/outros produtos mudaram no reprocesso' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'r8b: % integravel(is) reprocessado(s) (% registro(s) no Log); % com titulo de sublinha mudado (% sublinhas)',
    v_n_prod, v_n_prod, v_n_com, v_n_sub;
END
$reprocessa$;

DO $pos$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado = 'integravel' AND p.retrato ->> 'v' IS DISTINCT FROM '4';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'r8b: % integravel(is) ainda com retrato v<>4', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado IN ('integravel', 'integrado') AND p.retrato IS NOT NULL
     AND p.assinatura IS DISTINCT FROM public._integracao_assinar(p.retrato);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'r8b: % assinatura(s) nao conferem com o retrato', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado = 'integravel' AND p.retrato IS NOT NULL
     AND ((SELECT count(*) FROM public.integracao_linhas il WHERE il.modelo_id = p.modelo_id) <> jsonb_array_length(p.retrato -> 'linhas')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.retrato -> 'linhas') AS e(x)
                       LEFT JOIN public.integracao_linhas il ON il.modelo_id = p.modelo_id AND il.ordem = (e.x ->> 'ordem')::integer
                      WHERE il.id IS NULL OR il.titulo IS DISTINCT FROM e.x -> 'valores' ->> 'titulo'));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'r8b: % integravel(is) com titulo da API diferente do retrato', v_n USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('anon', 'public._bkp_r8_titulo_sublinha', 'SELECT')
     OR has_table_privilege('authenticated', 'public._bkp_r8_titulo_sublinha', 'SELECT') THEN
    RAISE EXCEPTION 'r8b: backup legivel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
