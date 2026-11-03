-- Urgentes R11e - Salvar da Peca Teste faz a baixa/estorno da mini explosao (maquina de estados) + a leitura devolve a mini. GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 4 / R11e; Rulings aceitos + RESPOSTAS DO DONO P-349/P-365/P-366).
-- O que muda (so catalogo: 2 CREATE OR REPLACE + 2 CREATE FUNCTION novas + REVOKE; nenhum dado - a baixa/estorno so rodam quando
-- a tela chama salvar_peca_teste com a chave 'mini'):
--   1) _salvar_peca_teste_core: aceita a chave 'mini' por tentativa; a regra do vazio passa a olhar mini/historico; chama
--      _peca_teste_mini_aplicar DEPOIS do laco das tentativas e ANTES do CAS do fornecedor.
--   2) _peca_teste_trilhas_core: cada tentativa ganha 'mini' (via _peca_teste_trilha_mini; NULL sem cabecalho; foto so com baixa).
--   3) _peca_teste_mini_aplicar (NOVA): valida a mini (formato/tamanho/variante/fonte/loja com E&S; chave fora do BOM = P0409) e
--      roda a maquina de estados (BAIXAR / ESTORNAR / ESTORNAR+BAIXAR / nada). Reprovar no mesmo Salvar da baixa faz a baixa.
--   4) _peca_teste_trilha_mini (NOVA): monta a mini da leitura (ajustes + foto). NUNCA devolve valor/custo.
-- Trava (MEDIDA na copia local, supautils carregado, diferenca de pg_locks numa txn REVERTIDA, DDL digitada): SO catalogo
--   (2 CREATE OR REPLACE + 2 CREATE FUNCTION novas + GRANT/REVOKE) + AccessShareLock (LEITURA) da validacao plpgsql. NENHUM
--   ShareRowExclusive/AccessExclusive de dado; 0 em auth/storage/realtime. Qualquer hora. lock_timeout 1500ms. Idempotente.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._salvar_peca_teste_core(uuid,jsonb,jsonb)
--     ANTES  eccde92e1c6687045f8f7c9ae61caf8f
--     DEPOIS 3e3b9db2d04dd176a4712898293f8545
--   public._peca_teste_trilhas_core(uuid,uuid)
--     ANTES  5ae0f7025744d63508d7617e6e3a7487
--     DEPOIS ef860a61e25750d2d12131062a23202d
--   public._peca_teste_trilha_mini(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 348c7e9978e7f6c0a48812baccc65a5e
--   public._peca_teste_mini_aplicar(uuid,uuid,jsonb) (NOVA)
--     ANTES  ausente
--     DEPOIS e6c43399f0a5c20c17c6255477947d2d
--     NEUTRO 2dbec37294d192919e72a0a9ae52ef7a (_down)
--   dependencias FIXADAS (nao redefinidas):
--     public._peca_teste_mini_baixar(uuid,jsonb) 444861eae9b28bc09ec3bfd80bc01033
--     public._peca_teste_mini_estornar(uuid) c8f160a73b3a30a6105c7a45aff9c89d
--     public._peca_teste_mini_linhas(uuid,text,uuid,jsonb) 3d73d0db8fc0902c5bd07edfbfa2fe70
--     public._peca_teste_mini_tem_historico(uuid) 10c05fae5041077c6dc23436d66f7d44
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103199400_urg_r11_salvar_mini_down.sql - PRIMEIRO da LIFO da R11 (devolve os 2 textos da R9; a _peca_teste_mini_aplicar
-- vira NEUTRA e o _peca_teste_trilha_mini fica inerte). Dados que NAO voltam: minis, fotos e baixas ativas FICAM (peca gasta).
-- Com o core da R9 de volta, a tentativa so-datas apagada pela tela velha some com a mini (os ledgers ficam com o rotulo). DROP
-- das 2 funcoes novas: supabase/rollback/20261103199400_urg_r11_salvar_mini_down_drop.sql (opcional, DEPOIS, LIFO - antes dos _down_drop da 199300).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_peca_teste_core(uuid,jsonb,jsonb)', 'eccde92e1c6687045f8f7c9ae61caf8f', '3e3b9db2d04dd176a4712898293f8545'),
      ('public._peca_teste_trilhas_core(uuid,uuid)', '5ae0f7025744d63508d7617e6e3a7487', 'ef860a61e25750d2d12131062a23202d')
    ) AS x(f, a, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.d) THEN
      RAISE EXCEPTION 'urg_r11e: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- dependencias FIXADAS (nao redefinidas aqui): o texto de hoje
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_mini_baixar(uuid,jsonb)', '444861eae9b28bc09ec3bfd80bc01033'),
      ('public._peca_teste_mini_estornar(uuid)', 'c8f160a73b3a30a6105c7a45aff9c89d'),
      ('public._peca_teste_mini_linhas(uuid,text,uuid,jsonb)', '3d73d0db8fc0902c5bd07edfbfa2fe70'),
      ('public._peca_teste_mini_tem_historico(uuid)', '10c05fae5041077c6dc23436d66f7d44')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r11e: dependencia % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regprocedure('public._peca_teste_mini_baixar(uuid,jsonb)') IS NULL
     OR to_regprocedure('public._peca_teste_mini_estornar(uuid)') IS NULL
     OR to_regprocedure('public._peca_teste_mini_tem_historico(uuid)') IS NULL THEN
    RAISE EXCEPTION 'urg_r11e: exige a 20261103199300 (urg R11d) aplicada' USING ERRCODE = 'P0001';
  END IF;
  -- funcoes NOVAS deste bloco: ausentes, ja com o texto de DEPOIS ou no NEUTRO do _down (ciclo ida -> _down -> ida)
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_trilha_mini(uuid)', '348c7e9978e7f6c0a48812baccc65a5e', '348c7e9978e7f6c0a48812baccc65a5e', false),
      ('public._peca_teste_mini_aplicar(uuid,uuid,jsonb)', 'e6c43399f0a5c20c17c6255477947d2d', '2dbec37294d192919e72a0a9ae52ef7a', false)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v NOT IN (r.d, r.n) THEN
      RAISE EXCEPTION 'urg_r11e: % (nova) com texto inesperado (md5 %) - gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) funcoes NOVAS (texto canonico; wrapper = authenticated executa, PUBLIC/anon nao; core = REVOKE dos 3)
CREATE OR REPLACE FUNCTION public._peca_teste_trilha_mini(_tentativa uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [urg r11e] a mini de uma tentativa para a leitura da secao (trilhas): NULL sem cabecalho. Devolve os ajustes (NULL = segue o
  -- calculado) e a FOTO (b_*) SO quando ha baixa ativa OU a tentativa e historica com baixa. NUNCA devolve valor/custo.
  SELECT CASE WHEN m.tentativa_id IS NULL THEN NULL ELSE jsonb_build_object(
    'tamanho', m.tamanho,
    'variante_tecido_id', m.variante_tecido_id,
    'mesma_oc', m.mesma_oc,
    'baixa_em', m.baixa_em,
    'baixa_por_nome', (SELECT u.nome FROM public.users u WHERE u.id = m.baixa_por),
    'tem_historico', public._peca_teste_mini_tem_historico(_tentativa),
    'linhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'chave', l.chave, 'familia', l.familia,
               'consumo', l.consumo, 'loss_percent', l.loss_percent, 'a_enviar', l.a_enviar,
               'variante_aviamento_id', l.variante_aviamento_id, 'oc_tecido_item_id', l.oc_tecido_item_id)
             || CASE WHEN l.b_rotulo IS NOT NULL OR l.b_baixado IS NOT NULL THEN jsonb_build_object('foto', jsonb_build_object(
                  'rotulo', l.b_rotulo, 'variante', l.b_variante, 'unidade', l.b_unidade, 'consumo', l.b_consumo,
                  'loss_percent', l.b_loss_percent, 'necessaria', l.b_necessaria, 'a_enviar', l.b_a_enviar,
                  'baixado', l.b_baixado, 'faltou', l.b_faltou, 'fontes', coalesce(l.b_fontes, '[]'::jsonb)))
                ELSE '{}'::jsonb END
             ORDER BY l.familia, l.chave)
        FROM public.modelo_peca_teste_mini_linhas l WHERE l.tentativa_id = _tentativa
    ), '[]'::jsonb))
  END
  FROM public.modelo_peca_teste_mini m WHERE m.tentativa_id = _tentativa
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_trilha_mini(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._peca_teste_mini_aplicar(_modelo_id uuid, _tenant uuid, _trilhas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- [urg r11e] passo da mini explosao, chamado pelo _salvar_peca_teste_core DEPOIS do laco das tentativas e ANTES do CAS do
  -- fornecedor. Para cada tentativa do payload com a chave 'mini' (objeto): resolve a tentativa (existente por id; nova por
  -- (mo_linha_id, categoria, numero) - ja inserida pelo core), trava o cabecalho FOR UPDATE, valida e aplica a chave mini (cabecalho +
  -- ajustes em estado COMPLETO) e roda a maquina de estados (baixar/estornar). Ordem de travas do _salvar_peca_teste_core (card -> M.O.
  -- -> tentativas -> AQUI: cabecalhos da mini FOR UPDATE, ordem de tentativa_id -> corte_tenant, SO na baixa/estorno, dentro dos
  -- helpers r11d). Mini numa loja sem Entrada e Saida = recusa. Chave de ajuste fora do BOM ATUAL = P0409.
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_tem_es boolean := public._tenant_modulo_ligado(_tenant, 'entrada_saida');
  tr jsonb; tt jsonb; mn jsonb; aj jsonb; cf jsonb;
  v_linha uuid; v_cat uuid; v_tent uuid; v_num integer;
  v_aprov_paga text;   -- aprovacao GRAVADA da tentativa (NULL = pendente)
  v_t public.modelo_peca_teste_tentativas%ROWTYPE;
  v_mini public.modelo_peca_teste_mini%ROWTYPE;
  v_tem_mini boolean;
  v_tam text; v_var uuid; v_mesma boolean;
  v_saida date;
  v_hist boolean;
  v_imutavel boolean;
  v_mudou boolean;
  v_chaves_bom text[];
  r record;
BEGIN
  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    v_linha := (tr->>'mo_linha_id')::uuid;
    v_cat := (tr->>'categoria_id')::uuid;
    FOR tt IN SELECT x FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x ? 'mini' LOOP
      mn := tt->'mini';
      IF jsonb_typeof(mn) = 'null' THEN
        CONTINUE;  -- 'mini': null (tentativa sem cabecalho) = nada a aplicar
      END IF;
      IF jsonb_typeof(mn) <> 'object' THEN
        RAISE EXCEPTION 'peca_teste_mini_formato: mini tem de ser objeto' USING ERRCODE = 'P0001';
      END IF;

      -- resolve a tentativa (existente por id; nova pela chave (linha, categoria, numero) - ja inserida pelo core)
      IF tt->>'id' IS NOT NULL THEN
        v_tent := (tt->>'id')::uuid;
      ELSE
        v_num := (tt->>'numero')::integer;
        SELECT t.id INTO v_tent FROM public.modelo_peca_teste_tentativas t
         WHERE t.mo_linha_id = v_linha AND t.categoria_terceirizado_id = v_cat AND t.numero = v_num AND t.tenant_id = _tenant;
        IF v_tent IS NULL THEN
          CONTINUE;  -- tentativa nova "so nulos" (sem datas/decisao) nao foi inserida: nao ha onde pendurar a mini
        END IF;
      END IF;

      -- trava o cabecalho da mini (ou a tentativa, se ainda nao tem mini) na ordem de tentativa_id
      PERFORM 1 FROM public.modelo_peca_teste_tentativas t
        WHERE t.id = v_tent AND t.modelo_id = _modelo_id AND t.tenant_id = _tenant FOR UPDATE;
      SELECT * INTO v_t FROM public.modelo_peca_teste_tentativas t WHERE t.id = v_tent;
      IF v_t.id IS NULL THEN CONTINUE; END IF;
      SELECT * INTO v_mini FROM public.modelo_peca_teste_mini m WHERE m.tentativa_id = v_tent FOR UPDATE;
      v_tem_mini := v_mini.tentativa_id IS NOT NULL;

      -- formato da chave mini
      IF (mn ? 'tamanho' AND jsonb_typeof(mn->'tamanho') NOT IN ('string','null'))
         OR (mn ? 'variante_tecido_id' AND jsonb_typeof(mn->'variante_tecido_id') NOT IN ('string','null'))
         OR (mn->>'variante_tecido_id' IS NOT NULL AND mn->>'variante_tecido_id' !~ v_uuid)
         OR (mn ? 'mesma_oc' AND jsonb_typeof(mn->'mesma_oc') <> 'boolean')
         OR (mn ? 'ajustes' AND jsonb_typeof(mn->'ajustes') <> 'array')
         OR (mn ? 'confere' AND jsonb_typeof(mn->'confere') NOT IN ('object','null')) THEN
        RAISE EXCEPTION 'peca_teste_mini_formato: chaves da mini invalidas' USING ERRCODE = 'P0001';
      END IF;
      v_tam := mn->>'tamanho';
      v_var := nullif(mn->>'variante_tecido_id', '')::uuid;
      v_mesma := coalesce((mn->>'mesma_oc')::boolean, true);
      aj := coalesce(mn->'ajustes', '[]'::jsonb);
      cf := CASE WHEN jsonb_typeof(mn->'confere') = 'object' THEN mn->'confere' END;

      -- formato de cada ajuste (faixas dos CHECKs; <= 4 casas em consumo/a_enviar)
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(aj) a
                  WHERE jsonb_typeof(a) <> 'object'
                     OR coalesce(a->>'chave', '') = ''
                     OR (a ? 'consumo' AND a->'consumo' <> 'null'::jsonb
                           AND (jsonb_typeof(a->'consumo') <> 'number' OR (a->>'consumo')::numeric NOT BETWEEN 0 AND 9999
                                OR scale((a->>'consumo')::numeric) > 4))
                     OR (a ? 'loss_percent' AND a->'loss_percent' <> 'null'::jsonb
                           AND (jsonb_typeof(a->'loss_percent') <> 'number' OR (a->>'loss_percent')::numeric NOT BETWEEN 0 AND 100))
                     OR (a ? 'a_enviar' AND a->'a_enviar' <> 'null'::jsonb
                           AND (jsonb_typeof(a->'a_enviar') <> 'number' OR (a->>'a_enviar')::numeric NOT BETWEEN 0 AND 99999
                                OR scale((a->>'a_enviar')::numeric) > 4))
                     OR (a ? 'variante_aviamento_id' AND a->'variante_aviamento_id' <> 'null'::jsonb
                           AND coalesce(a->>'variante_aviamento_id', '') !~ v_uuid)
                     OR (a ? 'oc_tecido_item_id' AND a->'oc_tecido_item_id' <> 'null'::jsonb
                           AND coalesce(a->>'oc_tecido_item_id', '') !~ v_uuid))
         OR (SELECT count(*) <> count(DISTINCT a->>'chave') FROM jsonb_array_elements(aj) a) THEN
        RAISE EXCEPTION 'peca_teste_mini_formato: ajuste invalido ou chave repetida' USING ERRCODE = 'P0001';
      END IF;

      -- estado DE ANTES deste Salvar: SO a aprovada (em Salvar ANTERIOR) congela a mini. A reprovada cai no caminho NORMAL
      -- (estorno_e_baixa), como a pendente: a decisao "reprovado" fica (o core trava datas/fornecedor/aprovacao), mas o material/baixa
      -- da mini abre. A decisao ja foi aplicada pelo core (este passo roda DEPOIS do laco das tentativas), entao "aprovada ANTES" =
      -- aprovacao gravada 'aprovado' E decidido_em de uma txn ANTERIOR (decidido_em <> now(), constante na txn). Aprovar no MESMO
      -- Salvar tem decidido_em = now() -> NAO e imutavel -> a baixa sai (peca gasta).
      v_aprov_paga := CASE WHEN v_t.decidido_em IS DISTINCT FROM now() THEN v_t.aprovacao END;
      v_hist := v_aprov_paga IS NOT NULL AND v_aprov_paga <> 'aprovado';
      v_imutavel := v_aprov_paga = 'aprovado';  -- SO aprovada em Salvar ANTERIOR congela a mini (reprovada e editavel)

      -- a mini "muda" quando o cabecalho ou os ajustes diferem do gravado
      v_mudou := (NOT v_tem_mini)
        OR v_mini.tamanho IS DISTINCT FROM v_tam
        OR v_mini.variante_tecido_id IS DISTINCT FROM v_var
        OR v_mini.mesma_oc IS DISTINCT FROM v_mesma
        OR EXISTS (
             -- ajustes do payload x ajustes gravados (linhas com algum ajuste nao nulo)
             SELECT 1 FROM (
               SELECT a->>'chave' AS chave,
                      nullif(a->'consumo','null'::jsonb)::text::numeric AS consumo,
                      nullif(a->'loss_percent','null'::jsonb)::text::numeric AS loss_percent,
                      nullif(a->'a_enviar','null'::jsonb)::text::numeric AS a_enviar,
                      nullif(a->>'variante_aviamento_id','')::uuid AS variante_aviamento_id,
                      nullif(a->>'oc_tecido_item_id','')::uuid AS oc_tecido_item_id
                 FROM jsonb_array_elements(aj) a
                WHERE a->'consumo' IS DISTINCT FROM 'null'::jsonb OR a->'loss_percent' IS DISTINCT FROM 'null'::jsonb
                   OR a->'a_enviar' IS DISTINCT FROM 'null'::jsonb OR nullif(a->>'variante_aviamento_id','') IS NOT NULL
                   OR nullif(a->>'oc_tecido_item_id','') IS NOT NULL
             ) p
             FULL JOIN (
               SELECT l.chave, l.consumo, l.loss_percent, l.a_enviar, l.variante_aviamento_id, l.oc_tecido_item_id
                 FROM public.modelo_peca_teste_mini_linhas l
                WHERE l.tentativa_id = v_tent
                  AND (l.consumo IS NOT NULL OR l.loss_percent IS NOT NULL OR l.a_enviar IS NOT NULL
                       OR l.variante_aviamento_id IS NOT NULL OR l.oc_tecido_item_id IS NOT NULL)
             ) g ON g.chave = p.chave
            WHERE p.chave IS NULL OR g.chave IS NULL
               OR p.consumo IS DISTINCT FROM g.consumo OR p.loss_percent IS DISTINCT FROM g.loss_percent
               OR p.a_enviar IS DISTINCT FROM g.a_enviar OR p.variante_aviamento_id IS DISTINCT FROM g.variante_aviamento_id
               OR p.oc_tecido_item_id IS DISTINCT FROM g.oc_tecido_item_id
           );

      IF v_imutavel THEN
        -- tentativa APROVADA (em Salvar ANTERIOR): a mini e IMUTAVEL. Qualquer diferenca do gravado = recusa. A reprovada NAO cai
        -- aqui (v_imutavel = false): a mini dela e editavel e segue o caminho normal (estorno_e_baixa). Aprovar no MESMO Salvar
        -- tambem nao cai aqui (v_aprov_paga NULL -> a baixa sai normal; a decisao vem do core DEPOIS deste passo).
        IF v_mudou THEN
          IF v_hist THEN
            RAISE EXCEPTION 'peca_teste_historico: tentativa reprovada e so leitura' USING ERRCODE = 'P0001';
          ELSE
            RAISE EXCEPTION 'peca_teste_mini_travada: peca teste aprovada trava a mini' USING ERRCODE = 'P0001';
          END IF;
        END IF;
        CONTINUE;
      END IF;

      -- loja sem Entrada e Saida: o payload nao pode trazer mini com dado
      IF NOT v_tem_es THEN
        RAISE EXCEPTION 'peca_teste_mini_sem_estoque: loja sem Entrada e Saida nao faz a baixa da peca teste' USING ERRCODE = 'P0001';
      END IF;

      -- tamanho fora da grade da loja
      IF v_tam IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.tenant_config tc, jsonb_array_elements_text(coalesce(tc.tamanhos_grade, '[]'::jsonb)) g
         WHERE tc.tenant_id = _tenant AND g = v_tam) THEN
        RAISE EXCEPTION 'peca_teste_mini_tamanho_invalido: tamanho fora da grade da loja' USING ERRCODE = 'P0001';
      END IF;
      -- V fora das variantes do Tecido 1 do BOM ATUAL
      IF v_var IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.modelo_tecidos mt
          JOIN public.modelo_tecido_variantes ctv ON ctv.modelo_tecido_id = mt.id
         WHERE mt.modelo_id = _modelo_id AND mt.tipo = 'tecido' AND mt.numero = 1 AND ctv.variante_tecido_id = v_var) THEN
        RAISE EXCEPTION 'peca_teste_mini_variante_invalida: variante nao e do Tecido 1 do BOM' USING ERRCODE = 'P0001';
      END IF;
      -- variante de aviamento de outro aviamento/loja; item de OC de outra loja/variante (por ajuste)
      FOR r IN SELECT a->>'chave' AS chave,
                      nullif(a->>'variante_aviamento_id','')::uuid AS va,
                      nullif(a->>'oc_tecido_item_id','')::uuid AS oci FROM jsonb_array_elements(aj) a LOOP
        IF r.va IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.variantes_aviamento va
            JOIN public.aviamentos av ON av.id = va.aviamento_id AND av.tenant_id = _tenant
            JOIN public.modelo_aviamentos ma ON ma.aviamento_id = av.id AND ma.modelo_id = _modelo_id
           WHERE va.id = r.va AND ('a:' || av.id::text || ':') = regexp_replace(r.chave, '([0-9]+)$', '')) THEN
          RAISE EXCEPTION 'peca_teste_mini_variante_invalida: variante de aviamento invalida' USING ERRCODE = 'P0001';
        END IF;
        IF r.oci IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.ocs_tecido_itens oi JOIN public.ocs_tecido o ON o.id = oi.oc_tecido_id
           WHERE oi.id = r.oci AND o.tenant_id = _tenant) THEN
          RAISE EXCEPTION 'peca_teste_mini_fonte_invalida: item de OC invalido' USING ERRCODE = 'P0001';
        END IF;
      END LOOP;

      -- chave de ajuste fora do BOM ATUAL (para o tamanho/variante dados) -> P0409 (nada grava; a tela recarrega)
      SELECT coalesce(array_agg(chave), '{}'::text[]) INTO v_chaves_bom
        FROM public._peca_teste_mini_linhas(_modelo_id, v_tam, v_var, '{}'::jsonb);
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(aj) a WHERE NOT (a->>'chave' = ANY(v_chaves_bom))) THEN
        RAISE EXCEPTION 'peca_teste_mini_desatualizada: a mini mudou; recarregue' USING ERRCODE = 'P0409';
      END IF;

      -- aplica o cabecalho (upsert). As linhas de ajuste sao gravadas abaixo, no momento certo da maquina de estados (sem baixa
      -- ativa, ou antes da (re)baixa), para nao destruir a FOTO quando a baixa permanece.
      INSERT INTO public.modelo_peca_teste_mini (tentativa_id, tenant_id, modelo_id, tamanho, variante_tecido_id, mesma_oc, updated_at)
      VALUES (v_tent, _tenant, _modelo_id, v_tam, v_var, v_mesma, now())
      ON CONFLICT (tentativa_id) DO UPDATE
        SET tamanho = excluded.tamanho, variante_tecido_id = excluded.variante_tecido_id, mesma_oc = excluded.mesma_oc,
            updated_at = now();

      -- maquina de estados. baixa ATIVA = v_mini.baixa_em NOT NULL (estado GRAVADO antes deste Salvar). Data de saida da tentativa
      -- (ja gravada pelo core). Pronto para baixar = data de saida + tamanho (+ cor, se houver Tecido 1 no BOM).
      v_saida := v_t.data_saida;
      DECLARE
        v_pronto boolean;
        v_grava boolean := false;  -- reescrever as linhas SO de ajuste (estado completo), sem destruir a FOTO quando a baixa fica
      BEGIN
        v_pronto := v_saida IS NOT NULL AND v_tam IS NOT NULL
          AND (v_var IS NOT NULL
               OR NOT EXISTS (SELECT 1 FROM public.modelo_tecidos mt WHERE mt.modelo_id = _modelo_id AND mt.tipo='tecido' AND mt.numero=1));
        IF v_mini.baixa_em IS NULL THEN
          v_grava := true;  -- sem baixa ativa: os ajustes sao reescritos agora (a baixa, se vier, regrava a FOTO por cima)
          IF v_pronto THEN
            -- grava os ajustes ANTES da baixa (ela le as linhas), depois baixa (tambem se a gravacao reprova: peca gasta)
            NULL;
          END IF;
        ELSE
          -- ja tinha baixa ativa
          IF v_saida IS NULL THEN
            PERFORM public._peca_teste_mini_estornar(v_tent);  -- data apagada -> estorna (limpa a foto; os ajustes ficam)
            v_grava := true;                                   -- reescreve os ajustes (estado completo)
            v_pronto := false;
          ELSIF v_mudou THEN
            PERFORM public._peca_teste_mini_estornar(v_tent);  -- Q2=A: estorna
            v_grava := true;                                   -- grava os ajustes NOVOS antes de rebaixar
          ELSE
            v_pronto := false;  -- data segue + mini igual = nada (a baixa e a foto ficam)
          END IF;
        END IF;

        IF v_grava THEN
          DELETE FROM public.modelo_peca_teste_mini_linhas l WHERE l.tentativa_id = v_tent;
          INSERT INTO public.modelo_peca_teste_mini_linhas (tenant_id, tentativa_id, chave, familia, consumo, loss_percent, a_enviar,
                 variante_aviamento_id, oc_tecido_item_id)
          SELECT _tenant, v_tent, a->>'chave', coalesce(a->>'familia', 'tecido'),
                 nullif(a->'consumo','null'::jsonb)::text::numeric, nullif(a->'loss_percent','null'::jsonb)::text::numeric,
                 nullif(a->'a_enviar','null'::jsonb)::text::numeric, nullif(a->>'variante_aviamento_id','')::uuid,
                 nullif(a->>'oc_tecido_item_id','')::uuid
            FROM jsonb_array_elements(aj) a
           WHERE a->'consumo' IS DISTINCT FROM 'null'::jsonb OR a->'loss_percent' IS DISTINCT FROM 'null'::jsonb
              OR a->'a_enviar' IS DISTINCT FROM 'null'::jsonb OR nullif(a->>'variante_aviamento_id','') IS NOT NULL
              OR nullif(a->>'oc_tecido_item_id','') IS NOT NULL;
        END IF;

        IF v_pronto THEN
          PERFORM public._peca_teste_mini_baixar(v_tent, cf);  -- BAIXAR / rebaixar
        END IF;
      END;

      -- toca a tentativa (rev+1) quando a mini/baixa mudou
      IF v_mudou OR v_mini.baixa_em IS DISTINCT FROM (SELECT baixa_em FROM public.modelo_peca_teste_mini WHERE tentativa_id = v_tent) THEN
        UPDATE public.modelo_peca_teste_tentativas SET updated_at = now() WHERE id = v_tent;
      END IF;
    END LOOP;
  END LOOP;
END $function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_mini_aplicar(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;

-- 2) funcoes EXISTENTES redefinidas (troca exata sobre o texto de ANTES)
CREATE OR REPLACE FUNCTION public._salvar_peca_teste_core(_modelo_id uuid, _trilhas jsonb, _rev_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_uid uuid := auth.uid();
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_dia constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_revs jsonb;
  v_forns jsonb;
  v_ids uuid[];
  tr jsonb;
  tt jsonb;
  v_linha uuid;
  v_cat uuid;
  v_forn uuid;
  v_t public.modelo_peca_teste_tentativas%ROWTYPE;
  v_id uuid;
  v_num integer;
  v_saida date;
  v_entrada date;
  v_aprov text;
  v_max integer;
  v_ult text;
  v_novo uuid;
  v_base uuid;
  v_congela uuid;
BEGIN
  -- [urg r9b] Salvar da secao Peca Teste (grava SO no Salvar do card; payload = so as trilhas tocadas, delta). Ordem:
  -- (1) card da loja + formato; (2) chave do card PRIMEIRO (a mesma 1a chave do Enviar a Explosao, do aprovar M.O., do Salvar da M.O.
  -- e do excluir_cad; a Peca Teste nao toca CAD/blocos); (3) linhas de M.O. FOR UPDATE (ordem de id) - sumiu/tipo mudou/switch
  -- [urg r11e] (6) passo da MINI explosao (_peca_teste_mini_aplicar), DEPOIS do laco e ANTES do CAS do fornecedor: por tentativa
  -- com a chave 'mini', aplica o cabecalho/ajustes e roda a maquina de estados (baixa/estorno). Trava: cabecalhos da mini FOR UPDATE
  -- (ordem de tentativa_id) -> corte_tenant (SO na baixa/estorno, dentro dos helpers r11d). A regra do vazio muda: tentativa so-nulos
  -- so some sem mini com dado e sem historico de baixa (senao fica como linha de datas nulas, com a mini pendurada).
  -- desligado = P0409; (4) tentativas FOR UPDATE (ordem de id), aplicadas (existentes primeiro, novas por numero); (5) fornecedor da
  -- linha por compare-and-set, na MESMA transacao (reabre a M.O. pelo gatilho; a trava morde se a atual, ja com o passo 4, estiver
  -- aprovada). Toda escrita grava updated_at = now() (revisao T1, achado 6). Decisao (aprovar/reprovar) congela em empresa_id o
  -- fornecedor da linha ANTES da troca deste mesmo Salvar (Ruling 8; revisao T1, achado 1) - CONFERIDO contra o que a pessoa viu
  -- (_rev_base.fornecedor da linha, obrigatorio em toda decisao; revisao T2, achados 1 e 2) e nunca vazio (achado 3). A trilha e
  -- conferida pelo TIPO ATUAL da linha (categoria_id obrigatorio; outro = P0409) e tentativa nova nunca nasce decidida (T6, achado 1).
  IF NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'peca_teste_modelo: nao encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_trilhas) IS DISTINCT FROM 'array' OR jsonb_typeof(_rev_base) IS DISTINCT FROM 'object'
     OR jsonb_typeof(coalesce(_rev_base->'tentativas', '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(coalesce(_rev_base->'fornecedor', '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'peca_teste_formato: _trilhas tem de ser lista e _rev_base objeto' USING ERRCODE = 'P0001';
  END IF;
  v_revs := coalesce(_rev_base->'tentativas', '{}'::jsonb);
  v_forns := coalesce(_rev_base->'fornecedor', '{}'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x
              WHERE jsonb_typeof(x) <> 'object'
                 OR coalesce(x->>'mo_linha_id', '') !~ v_uuid
                 OR coalesce(x->>'categoria_id', '') !~ v_uuid
                 OR jsonb_typeof(coalesce(x->'tentativas', '[]'::jsonb)) <> 'array'
                 OR (x ? 'empresa_id' AND jsonb_typeof(x->'empresa_id') NOT IN ('string', 'null'))
                 OR (x ? 'empresa_id' AND x->>'empresa_id' IS NOT NULL AND x->>'empresa_id' !~ v_uuid))
     OR (SELECT count(*) <> count(DISTINCT lower(x->>'mo_linha_id')) FROM jsonb_array_elements(_trilhas) x) THEN
    RAISE EXCEPTION 'peca_teste_formato: trilha invalida ou repetida' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t
              WHERE jsonb_typeof(t) <> 'object'
                 OR (t->>'id' IS NOT NULL AND t->>'id' !~ v_uuid)
                 OR (t->>'id' IS NULL AND coalesce(t->>'numero', '') !~ '^[1-9][0-9]{0,5}$')
                 OR coalesce(t->>'data_saida', '2000-01-01') !~ v_dia
                 OR coalesce(t->>'data_entrada', '2000-01-01') !~ v_dia
                 OR coalesce(t->>'aprovacao', 'aprovado') !~ '^(aprovado|reprovado)$')
     OR (SELECT count(t->>'id') <> count(DISTINCT lower(t->>'id'))
           FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t) THEN
    RAISE EXCEPTION 'peca_teste_formato: tentativa invalida ou repetida' USING ERRCODE = 'P0001';
  END IF;
  -- tentativa NOVA nunca nasce decidida (revisao T6, achado 1: um payload velho/mesclado de uma linha cujo TIPO mudou levava a
  -- aprovacao do tipo antigo para a trilha nova): decide-se so a tentativa ja GRAVADA (que tem id da trilha atual; com as 2 datas
  -- no Salvar da decisao - peca_teste_sem_datas abaixo)
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t
              WHERE t->>'id' IS NULL AND t->>'aprovacao' IS NOT NULL) THEN
    RAISE EXCEPTION 'peca_teste_sem_datas: tentativa nova nao nasce aprovada ou reprovada - salve as datas antes de decidir' USING ERRCODE = 'P0001';
  END IF;
  -- data no formato mas inexistente (ex.: 2026-02-30) = o mesmo P0001 com prefixo (nao o 22008 cru)
  BEGIN
    PERFORM count((t->>'data_saida')::date) + count((t->>'data_entrada')::date)
       FROM jsonb_array_elements(_trilhas) x, jsonb_array_elements(coalesce(x->'tentativas', '[]'::jsonb)) t;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'peca_teste_formato: data invalida' USING ERRCODE = 'P0001';
  END;

  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));

  SELECT coalesce(array_agg((x->>'mo_linha_id')::uuid), '{}'::uuid[]) INTO v_ids FROM jsonb_array_elements(_trilhas) x;
  PERFORM 1 FROM public.modelo_servico_mo s
    WHERE s.id = ANY(v_ids) AND s.modelo_id = _modelo_id AND s.tenant_id = v_tenant
    ORDER BY s.id FOR UPDATE;
  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    IF NOT EXISTS (SELECT 1 FROM public.modelo_servico_mo s
                     JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = v_tenant
                                                           AND ct.exige_peca_teste
                    WHERE s.id = (tr->>'mo_linha_id')::uuid AND s.modelo_id = _modelo_id AND s.tenant_id = v_tenant
                      AND s.categoria_terceirizado_id = (tr->>'categoria_id')::uuid) THEN
      RAISE EXCEPTION 'peca_teste_desatualizada: servico da mao de obra mudou' USING ERRCODE = 'P0409';
    END IF;
  END LOOP;
  PERFORM 1 FROM public.modelo_peca_teste_tentativas t WHERE t.mo_linha_id = ANY(v_ids) ORDER BY t.id FOR UPDATE;

  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x LOOP
    v_linha := (tr->>'mo_linha_id')::uuid;
    v_cat := (tr->>'categoria_id')::uuid;
    SELECT s.empresa_id INTO v_forn FROM public.modelo_servico_mo s WHERE s.id = v_linha;  -- ANTES da troca deste Salvar
    v_congela := v_forn;
    -- DECISAO (nova com aprovacao, ou existente cuja aprovacao muda para aprovado/reprovado): o fornecedor que a pessoa viu
    -- (_rev_base.fornecedor) tem de ser o da linha; a peca e decidida para ELE (revisao T2, achados 1-3)
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x
                LEFT JOIN public.modelo_peca_teste_tentativas t ON t.id = (x->>'id')::uuid
               WHERE x->>'aprovacao' IS NOT NULL AND (x->>'id' IS NULL OR t.aprovacao IS DISTINCT FROM x->>'aprovacao')) THEN
      IF NOT (v_forns ? v_linha::text) OR jsonb_typeof(v_forns->v_linha::text) NOT IN ('string', 'null')
         OR (v_forns->>v_linha::text IS NOT NULL AND v_forns->>v_linha::text !~ v_uuid) THEN
        RAISE EXCEPTION 'peca_teste_formato: aprovar ou reprovar exige _rev_base.fornecedor da linha' USING ERRCODE = 'P0001';
      END IF;
      v_base := (v_forns->>v_linha::text)::uuid;
      IF v_base IS DISTINCT FROM v_forn THEN
        IF tr ? 'empresa_id' AND (tr->>'empresa_id')::uuid IS NOT DISTINCT FROM v_forn THEN
          -- a troca DESTE Salvar ja foi gravada (o Salvar da M.O. rodou antes): decide sobre o fornecedor de ANTES (Ruling 8) -
          -- aprovar + trocar juntos = o mesmo P0001 da trava; reprovar congela o de antes (quem fez a peca)
          IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x
                      LEFT JOIN public.modelo_peca_teste_tentativas t ON t.id = (x->>'id')::uuid
                     WHERE x->>'aprovacao' = 'aprovado' AND (x->>'id' IS NULL OR t.aprovacao IS DISTINCT FROM 'aprovado')) THEN
            RAISE EXCEPTION 'peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor' USING ERRCODE = 'P0001';
          END IF;
          -- a base vem do cliente: so congela fornecedor de SERVICO desta loja (revisao T2, achado 8; o mesmo criterio da troca)
          IF v_base IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.empresas e
                                                 WHERE e.id = v_base AND e.tenant_id = v_tenant AND e.tipo = 'servico') THEN
            RAISE EXCEPTION 'peca_teste_fornecedor_invalido: fornecedor de servico invalido' USING ERRCODE = 'P0001';
          END IF;
          v_congela := v_base;
        ELSE
          RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
        END IF;
      END IF;
      IF v_congela IS NULL THEN
        RAISE EXCEPTION 'peca_teste_sem_fornecedor: defina o fornecedor da M.O. antes de aprovar ou reprovar a peca teste'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    -- tentativas EXISTENTES (id): rev = a base; reprovada = so leitura; aprovada mantida = datas travadas; tudo vazio = DELETE
    FOR tt IN SELECT x FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x->>'id' IS NOT NULL LOOP
      v_id := (tt->>'id')::uuid;
      SELECT * INTO v_t FROM public.modelo_peca_teste_tentativas t
       WHERE t.id = v_id AND t.mo_linha_id = v_linha AND t.categoria_terceirizado_id = v_cat AND t.tenant_id = v_tenant;
      IF NOT FOUND OR coalesce(v_revs->>v_id::text, '') !~ '^[0-9]{1,9}$' OR v_t.rev <> (v_revs->>v_id::text)::integer THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END IF;
      v_saida := (tt->>'data_saida')::date;
      v_entrada := (tt->>'data_entrada')::date;
      v_aprov := tt->>'aprovacao';
      -- reprovada (o CHECK da tabela so aceita aprovado/reprovado; sem o literal: o anti-drift da Mod T4 reserva o literal reprovado ao
      -- status do card)
      IF v_t.aprovacao IS NOT NULL AND v_t.aprovacao <> 'aprovado' THEN
        IF v_saida IS DISTINCT FROM v_t.data_saida OR v_entrada IS DISTINCT FROM v_t.data_entrada OR v_aprov IS DISTINCT FROM v_t.aprovacao THEN
          RAISE EXCEPTION 'peca_teste_historico: tentativa reprovada e so leitura' USING ERRCODE = 'P0001';
        END IF;
        CONTINUE;
      END IF;
      IF v_t.aprovacao = 'aprovado' AND v_aprov = 'aprovado'
         AND (v_saida IS DISTINCT FROM v_t.data_saida OR v_entrada IS DISTINCT FROM v_t.data_entrada) THEN
        RAISE EXCEPTION 'peca_teste_aprovada_travada: datas da peca aprovada nao mudam (desfaca a aprovacao antes)' USING ERRCODE = 'P0001';
      END IF;
      IF v_saida IS NULL AND v_entrada IS NULL AND v_aprov IS NULL THEN
        -- [urg r11e] so apaga (volta a VIRTUAL) sem mini com dado (no PAYLOAD desta chamada OU ja gravada) e sem historico de
        -- baixa; senao fica como linha de datas nulas (o passo da mini, apos o laco, aplica/estorna a mini pendurada).
        IF NOT (tt ? 'mini' AND jsonb_typeof(tt->'mini') = 'object')
           AND NOT public._peca_teste_mini_tem_historico(v_id)
           AND NOT EXISTS (SELECT 1 FROM public.modelo_peca_teste_mini m WHERE m.tentativa_id = v_id) THEN
          DELETE FROM public.modelo_peca_teste_tentativas WHERE id = v_id;  -- volta a VIRTUAL
          CONTINUE;
        END IF;
      END IF;
      IF v_aprov IS NOT NULL AND (v_saida IS NULL OR v_entrada IS NULL) THEN
        RAISE EXCEPTION 'peca_teste_sem_datas: aprovar ou reprovar exige data de saida e data de entrada' USING ERRCODE = 'P0001';
      END IF;
      IF v_saida IS NOT DISTINCT FROM v_t.data_saida AND v_entrada IS NOT DISTINCT FROM v_t.data_entrada
         AND v_aprov IS NOT DISTINCT FROM v_t.aprovacao THEN
        CONTINUE;  -- nada mudou: nao sobe o rev
      END IF;
      UPDATE public.modelo_peca_teste_tentativas t
         SET data_saida = v_saida,
             data_entrada = v_entrada,
             aprovacao = v_aprov,
             decidido_em = CASE WHEN v_aprov IS NULL THEN NULL WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN now() ELSE t.decidido_em END,
             decidido_por = CASE WHEN v_aprov IS NULL THEN NULL WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN v_uid ELSE t.decidido_por END,
             -- decidir congela o fornecedor; aprovado -> reprovado guarda o de quem fez a peca (o congelado); desfazer limpa
             empresa_id = CASE WHEN v_aprov IS NULL THEN NULL
                               WHEN v_t.aprovacao IS NULL THEN v_congela
                               WHEN v_aprov IS DISTINCT FROM v_t.aprovacao THEN coalesce(t.empresa_id, v_congela)
                               ELSE t.empresa_id END,
             updated_at = now()
       WHERE t.id = v_id;
    END LOOP;
    -- tentativas NOVAS (id nulo), por numero: so a proxima depois de uma reprovada (ou a 1a); so nulos = ignora
    FOR tt IN SELECT x FROM jsonb_array_elements(coalesce(tr->'tentativas', '[]'::jsonb)) x WHERE x->>'id' IS NULL
               ORDER BY (x->>'numero')::integer LOOP
      v_num := (tt->>'numero')::integer;
      v_saida := (tt->>'data_saida')::date;
      v_entrada := (tt->>'data_entrada')::date;
      v_aprov := tt->>'aprovacao';
      IF v_saida IS NULL AND v_entrada IS NULL AND v_aprov IS NULL
         AND NOT (tt ? 'mini' AND jsonb_typeof(tt->'mini') = 'object') THEN  -- [urg r11e] mini com dado faz a tentativa nascer
        CONTINUE;
      END IF;
      SELECT t.numero, t.aprovacao INTO v_max, v_ult FROM public.modelo_peca_teste_tentativas t
       WHERE t.mo_linha_id = v_linha AND t.categoria_terceirizado_id = v_cat ORDER BY t.numero DESC LIMIT 1;
      IF NOT FOUND THEN
        v_max := 0;      -- nenhuma tentativa: a nova e a 1a
      ELSIF v_ult IS NULL OR v_ult = 'aprovado' THEN
        v_max := NULL;   -- a atual nao foi reprovada: nao ha "proxima" (outra pessoa ja lancou a tentativa)
      END IF;
      IF v_max IS NULL OR v_num <> v_max + 1 THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END IF;
      IF v_aprov IS NOT NULL AND (v_saida IS NULL OR v_entrada IS NULL) THEN
        RAISE EXCEPTION 'peca_teste_sem_datas: aprovar ou reprovar exige data de saida e data de entrada' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        INSERT INTO public.modelo_peca_teste_tentativas
          (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, empresa_id, data_saida, data_entrada, aprovacao,
           decidido_em, decidido_por, created_by, updated_at)
        VALUES (v_tenant, _modelo_id, v_linha, v_cat, v_num, CASE WHEN v_aprov IS NOT NULL THEN v_congela END, v_saida, v_entrada, v_aprov,
                CASE WHEN v_aprov IS NOT NULL THEN now() END, CASE WHEN v_aprov IS NOT NULL THEN v_uid END, v_uid, now());
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
      END;
    END LOOP;
  END LOOP;

  -- [urg r11e] passo da MINI explosao: DEPOIS do laco das tentativas (ja inseridas/decididas) e ANTES do CAS do fornecedor.
  PERFORM public._peca_teste_mini_aplicar(_modelo_id, v_tenant, _trilhas);

  -- fornecedor da linha (so as trilhas com a chave empresa_id): compare-and-set idempotente (Ruling 9)
  FOR tr IN SELECT x FROM jsonb_array_elements(_trilhas) x WHERE x ? 'empresa_id' LOOP
    v_linha := (tr->>'mo_linha_id')::uuid;
    v_novo := (tr->>'empresa_id')::uuid;
    SELECT s.empresa_id INTO v_forn FROM public.modelo_servico_mo s WHERE s.id = v_linha;
    IF v_forn IS NOT DISTINCT FROM v_novo THEN
      CONTINUE;  -- o Salvar da M.O. ja gravou o mesmo (ou nada mudou)
    END IF;
    IF NOT (v_forns ? v_linha::text) OR jsonb_typeof(v_forns->v_linha::text) NOT IN ('string', 'null')
       OR (v_forns->>v_linha::text IS NOT NULL AND v_forns->>v_linha::text !~ v_uuid) THEN
      RAISE EXCEPTION 'peca_teste_formato: falta _rev_base.fornecedor da linha' USING ERRCODE = 'P0001';
    END IF;
    v_base := (v_forns->>v_linha::text)::uuid;
    IF v_forn IS DISTINCT FROM v_base THEN
      RAISE EXCEPTION 'peca_teste_conflito: outra pessoa salvou a peca teste' USING ERRCODE = 'P0409';
    END IF;
    IF v_novo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = v_novo AND e.tenant_id = v_tenant AND e.tipo = 'servico') THEN
      RAISE EXCEPTION 'peca_teste_fornecedor_invalido: fornecedor de servico invalido' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.modelo_servico_mo SET empresa_id = v_novo, updated_at = now() WHERE id = v_linha;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public._peca_teste_trilhas_core(_tenant uuid, _modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] secao Peca Teste do card: trilhas = linhas de M.O. do card cujo tipo (da MESMA loja) exige peca teste, na ordem da
  -- M.O. (ct.ordem, ct.nome, created_at, id); tentativas = as da trilha (linha x tipo ATUAL), numero ASC; "aprovada" = o predicado
  -- unico (_peca_teste_aprovada, com o fornecedor da linha). "outros" = as demais linhas COM tipo (so servico + fornecedor; Ruling
  -- 33). NUNCA devolve valor da M.O. Card de outra loja / inexistente = NULL.
  IF _tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = _tenant) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'trilhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'mo_linha_id', s.id,
               'categoria_id', s.categoria_terceirizado_id,
               'categoria_nome', ct.nome,
               'empresa_id', s.empresa_id,
               'empresa_nome', e.nome_fantasia,
               'mo_aprovado', s.aprovado,
               'aprovada', public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id),
               'tentativas', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', t.id, 'numero', t.numero, 'empresa_id', t.empresa_id, 'empresa_nome', te.nome_fantasia,
                          'data_saida', t.data_saida, 'data_entrada', t.data_entrada, 'aprovacao', t.aprovacao,
                          'decidido_em', t.decidido_em, 'rev', t.rev,
                          'mini', public._peca_teste_trilha_mini(t.id)) ORDER BY t.numero)
                   FROM public.modelo_peca_teste_tentativas t
                   LEFT JOIN public.empresas te ON te.id = t.empresa_id AND te.tenant_id = _tenant
                  WHERE t.mo_linha_id = s.id AND t.categoria_terceirizado_id = s.categoria_terceirizado_id AND t.tenant_id = _tenant
               ), '[]'::jsonb)
             ) ORDER BY ct.ordem, ct.nome, s.created_at, s.id)
        FROM public.modelo_servico_mo s
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
       WHERE s.modelo_id = _modelo_id
    ), '[]'::jsonb),
    'outros', coalesce((
      SELECT jsonb_agg(jsonb_build_object('categoria_nome', ct.nome, 'empresa_nome', e.nome_fantasia)
             ORDER BY ct.ordem, ct.nome, s.created_at, s.id)
        FROM public.modelo_servico_mo s
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND NOT ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
       WHERE s.modelo_id = _modelo_id
    ), '[]'::jsonb));
END $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_peca_teste_core(uuid,jsonb,jsonb)', '3e3b9db2d04dd176a4712898293f8545', '{postgres=X/postgres,service_role=X/postgres}', false, true),
      ('public._peca_teste_trilhas_core(uuid,uuid)', 'ef860a61e25750d2d12131062a23202d', '{postgres=X/postgres,service_role=X/postgres}', false, true)
    ) AS x(f, m, acl, w, sd) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r11e: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.w
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r11e: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_trilha_mini(uuid)', '348c7e9978e7f6c0a48812baccc65a5e', '348c7e9978e7f6c0a48812baccc65a5e', false),
      ('public._peca_teste_mini_aplicar(uuid,uuid,jsonb)', 'e6c43399f0a5c20c17c6255477947d2d', '2dbec37294d192919e72a0a9ae52ef7a', false)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'urg_r11e: pos-condicao falhou em % (nova; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.d USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public'
                     AND coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(p.proacl) x), '') = CASE WHEN r.w AND true THEN 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres' ELSE 'postgres=X/postgres,service_role=X/postgres' END)
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM (r.w AND true)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r11e: pos-condicao falhou na ACL/secdef/search_path de % (nova)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
