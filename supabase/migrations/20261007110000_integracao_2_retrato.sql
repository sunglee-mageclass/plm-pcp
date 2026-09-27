-- Integração + API — 2/6: RETRATO e LEITURAS (spec §3, §5, §6). Só funções (nenhuma tabela/policy/gatilho).
-- _integracao_retrato_core calcula o RETRATO no BANCO (fonte única; tela e API nunca recalculam): campos na ordem fixa
-- (P-60 B), linha do produto + sublinhas variante × tamanho (a MESMA matriz do SKU, com o SKU GRAVADO — D7), faltas
-- (marcado = obrigatório; apelido vazio NÃO é falta — P-74 A), custo = confirmado ? real : previsto (D8), fotos só na
-- linha do produto e fora de <tenant>/ = falta (nota 7). _integracao_assinar = HMAC-SHA256 com o segredo da migration 1
-- (nota 6). _integracao_gates = gates do CARD campo a campo (R2/V1/n5 — D24). RPCs: integracao_previa (resumo do
-- "Tenho certeza"; custo mascarado p/ quem não vê, assinatura do retrato COMPLETO), integracao_listar (aba Produtos),
-- integracao_estado_modelos (selos das outras telas), integracao_config_ler (config da API só p/ super admin).
-- ACL (#9): internas REVOKE dos 3; RPCs REVOKE PUBLIC/anon + GRANT authenticated. Contagens: +15 funções | +0 gatilhos.
-- Inverso: supabase/rollback/20261007110000_integracao_2_retrato_down.sql (SÓ depois do inverso 3).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regclass('public.integracao_produtos') IS NULL THEN
    RAISE EXCEPTION 'integracao_2: aplique a migration 1 antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_calc_ref_tipo(uuid,text,text)') IS NULL
     OR to_regprocedure('public._sku_tamanho_lado(text,text)') IS NULL
     OR to_regprocedure('public._sku_variante_key(uuid,uuid)') IS NULL
     OR to_regprocedure('public._custo_unitario_modelos_core(uuid[])') IS NULL
     OR to_regprocedure('public._pode_ver_custos()') IS NULL
     OR to_regprocedure('public._kanban_status_gate(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public._ref_exibir_gate(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'integracao_2: dependencia ausente (SKU previa / custo / kanban)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_rotulos()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'nome', 'Nome', 'ref_sku', 'REF / SKU', 'preco_anterior', 'Preço anterior', 'preco_venda', 'Preço de venda',
    'peso', 'Peso', 'ncm', 'NCM', 'preco_custo', 'Preço de custo', 'cor_base', 'Cor base', 'cor_apelido', 'Cor apelido',
    'tamanho', 'Tamanho', 'titulo', 'Título para a página', 'descricao', 'Descrição', 'keywords', 'Keywords',
    'metatag', 'Metatag Description', 'comprimento', 'Comprimento', 'largura', 'Largura', 'altura', 'Altura',
    'foto', 'Foto')
$function$;

CREATE OR REPLACE FUNCTION public._integracao_cfg(_tenant uuid)
 RETURNS public.integracao_config
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.integracao_config;
BEGIN
  SELECT * INTO c FROM public.integracao_config WHERE tenant_id = _tenant;
  IF NOT FOUND THEN
    -- linha ausente = padrão (D25): layout 1-17 marcado, Foto desmarcada, 60/50/7/10 (P-89 A); rev 0 = "nunca salva"
    c.tenant_id := _tenant;
    c.campos := (public._integracao_layout())[1:17];
    c.limite_por_minuto := 60;
    c.max_por_pagina := 50;
    c.validade_foto_dias := 7;
    c.bloqueio_tentativas := 10;
    c.rev := 0;
    c.atualizado_em := now();
  END IF;
  RETURN c;
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_num(_v numeric, _casas integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- D4: texto com ponto; ≤ 0 ou NULL = NULL (0 nunca conta como preenchido); _casas NULL = sem zeros à direita.
  -- Revisão T2 Minor #3: o teste <= 0 usa o valor ARREDONDADO (não o bruto) — senão 0 < v < 0.005 (ex.: 0.001 com
  -- 2 casas) arredondaria para "0.00"/"0.000" e passaria como preenchido, violando "0 nunca conta".
  SELECT CASE WHEN _v IS NULL THEN NULL
              WHEN _casas IS NULL THEN CASE WHEN trim_scale(_v) <= 0 THEN NULL ELSE trim_scale(_v)::text END
              ELSE CASE WHEN round(_v, _casas) <= 0 THEN NULL ELSE round(_v, _casas)::text END END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_mascarar(_retrato jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- inv. #12: preco_custo := null em TODAS as linhas (a assinatura continua sendo a do retrato completo).
  SELECT CASE WHEN _retrato IS NULL OR jsonb_typeof(_retrato -> 'linhas') <> 'array' THEN _retrato
    ELSE jsonb_set(_retrato, '{linhas}', coalesce((
      SELECT jsonb_agg(CASE WHEN (x.l -> 'valores') ? 'preco_custo'
                            THEN jsonb_set(x.l, '{valores,preco_custo}', 'null'::jsonb) ELSE x.l END ORDER BY x.n)
        FROM jsonb_array_elements(_retrato -> 'linhas') WITH ORDINALITY AS x(l, n)), '[]'::jsonb)) END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_retrato_core(_modelo_id uuid, _campos text[], _custo jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m public.modelos%ROWTYPE;
  v_campos text[];
  v_rot jsonb := public._integracao_rotulos();
  v_kw text;
  v_tipo text;
  v_custo numeric;
  c text;
  v_val jsonb;
  v_prod jsonb := '{}'::jsonb;
  v_fotos text[] := '{}'::text[];
  v_linhas jsonb := '[]'::jsonb;
  v_meta jsonb := '[]'::jsonb;
  v_faltas jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_sem_sku integer := 0;
  v_ex_sku text;
  v_sem_cor integer := 0;
  v_sem_tam integer := 0;
  v_tam text;
  v_linha jsonb;
  v_chaves uuid[];
  s record;
BEGIN
  SELECT * INTO m FROM public.modelos WHERE id = _modelo_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- só chaves conhecidas, na ORDEM FIXA do layout (P-60 B)
  v_campos := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                     WHERE u.x = ANY(coalesce(_campos, '{}'::text[])) ORDER BY u.n);
  SELECT tc.keywords INTO v_kw FROM public.tenant_config tc WHERE tc.tenant_id = m.tenant_id;
  v_tipo := coalesce(m.tamanho_tipo, 'letra');
  v_custo := CASE WHEN coalesce((_custo ->> 'confirmado')::boolean, false) THEN (_custo ->> 'real')::numeric
                  ELSE (_custo ->> 'previsto')::numeric END;

  -- linha do PRODUTO
  FOREACH c IN ARRAY v_campos LOOP
    CONTINUE WHEN c = 'foto';
    IF c IN ('cor_base', 'cor_apelido', 'tamanho') THEN
      v_prod := v_prod || jsonb_build_object(c, NULL::text);  -- "só variante": vazia na linha do produto
      CONTINUE;
    END IF;
    v_val := CASE c
      WHEN 'nome' THEN to_jsonb(nullif(btrim(m.nome), ''))
      WHEN 'ref_sku' THEN to_jsonb(nullif(btrim(coalesce(m.ref, '')), ''))
      WHEN 'preco_anterior' THEN to_jsonb(public._integracao_num(m.preco_anterior, 2))
      WHEN 'preco_venda' THEN to_jsonb(public._integracao_num(m.preco_venda, 2))
      WHEN 'peso' THEN to_jsonb(public._integracao_num(m.peso_kg, 3))
      WHEN 'ncm' THEN to_jsonb(nullif(btrim(coalesce(m.ncm, '')), ''))
      WHEN 'preco_custo' THEN to_jsonb(public._integracao_num(v_custo, 2))
      WHEN 'titulo' THEN to_jsonb(nullif(btrim(coalesce(m.titulo_pagina, '')), ''))
      WHEN 'descricao' THEN to_jsonb(nullif(btrim(coalesce(m.descricao_produto, '')), ''))
      WHEN 'keywords' THEN to_jsonb(nullif(btrim(coalesce(v_kw, '')), ''))
      WHEN 'metatag' THEN to_jsonb(nullif(btrim(coalesce(m.descricao_produto, '')), ''))
      WHEN 'comprimento' THEN to_jsonb(public._integracao_num(m.comprimento_cm, NULL))
      WHEN 'largura' THEN to_jsonb(public._integracao_num(m.largura_cm, NULL))
      WHEN 'altura' THEN to_jsonb(public._integracao_num(m.altura_cm, NULL))
    END;
    v_prod := v_prod || jsonb_build_object(c, coalesce(v_val, 'null'::jsonb));
    IF v_val IS NULL THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', c, 'texto',
        CASE c WHEN 'ref_sku' THEN 'REF' WHEN 'preco_custo' THEN 'Preço de custo (o estimado não conta)'
               ELSE v_rot ->> c END));
    END IF;
  END LOOP;

  -- SUBLINHAS: variante × tamanho com grade > 0 (mesma matriz do SKU) + o SKU GRAVADO (D7)
  FOR s IN
    SELECT k.variante_key, k.variante_ordem, k.cor_nome, k.apelido_nome, k.tamanho_key, k.tamanho_ordem,
           sk.id AS sku_id, sk.sku AS sku, sk.rev AS sku_rev, sk.manual AS manual
      FROM public._skus_calc_ref_tipo(m.id, m.ref, v_tipo) k
      LEFT JOIN public.modelo_skus sk
        ON sk.modelo_id = m.id AND sk.variante_key = k.variante_key AND sk.tamanho_key = k.tamanho_key
     ORDER BY k.variante_ordem NULLS LAST, k.tamanho_ordem NULLS LAST, k.tamanho_key, k.variante_key
  LOOP
    v_n := v_n + 1;
    v_tam := nullif(coalesce(public._sku_tamanho_lado(s.tamanho_key, v_tipo), s.tamanho_key), '');
    v_linha := '{}'::jsonb;
    FOREACH c IN ARRAY v_campos LOOP
      CONTINUE WHEN c = 'foto';
      v_linha := v_linha || jsonb_build_object(c, CASE c
        WHEN 'nome' THEN coalesce(to_jsonb(nullif(concat_ws(' ', nullif(btrim(m.nome), ''), v_tam), '')), 'null'::jsonb)
        WHEN 'ref_sku' THEN coalesce(to_jsonb(nullif(btrim(coalesce(s.sku, '')), '')), 'null'::jsonb)
        WHEN 'cor_base' THEN coalesce(to_jsonb(s.cor_nome), 'null'::jsonb)
        WHEN 'cor_apelido' THEN coalesce(to_jsonb(s.apelido_nome), 'null'::jsonb)
        WHEN 'tamanho' THEN coalesce(to_jsonb(v_tam), 'null'::jsonb)
        ELSE coalesce(v_prod -> c, 'null'::jsonb)
      END);
    END LOOP;
    IF 'ref_sku' = ANY(v_campos) AND nullif(btrim(coalesce(s.sku, '')), '') IS NULL THEN
      v_sem_sku := v_sem_sku + 1;
      IF v_ex_sku IS NULL THEN
        v_ex_sku := coalesce(s.cor_nome, 'sem cor') || ', tam. ' || coalesce(v_tam, s.tamanho_key);
      END IF;
    END IF;
    IF 'cor_base' = ANY(v_campos) AND s.cor_nome IS NULL THEN
      v_sem_cor := v_sem_cor + 1;
    END IF;
    IF 'tamanho' = ANY(v_campos) AND v_tam IS NULL THEN
      v_sem_tam := v_sem_tam + 1;
    END IF;
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object(
      'tipo', 'variante', 'ordem', v_n, 'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key,
      'valores', v_linha, 'fotos', '[]'::jsonb));
    v_meta := v_meta || jsonb_build_array(jsonb_build_object(
      'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key, 'variante_ordem', s.variante_ordem,
      'tamanho_ordem', s.tamanho_ordem, 'cor_nome', s.cor_nome, 'apelido_nome', s.apelido_nome, 'tamanho', v_tam,
      'sku_id', s.sku_id, 'sku', s.sku, 'sku_rev', s.sku_rev, 'manual', coalesce(s.manual, false)));
  END LOOP;

  IF v_n = 0 AND v_campos && ARRAY['ref_sku', 'cor_base', 'cor_apelido', 'tamanho']::text[] THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'variantes', 'texto', 'variantes cor × tamanho'));
  END IF;
  IF v_sem_sku = 1 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku', 'texto', '1 variante sem SKU (' || v_ex_sku || ')'));
  ELSIF v_sem_sku > 1 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku', 'texto',
      v_sem_sku || ' variantes sem SKU (ex.: ' || v_ex_sku || ')'));
  END IF;
  IF v_sem_cor > 0 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'cor_base', 'texto', v_sem_cor || ' variante(s) sem cor base'));
  END IF;
  IF v_sem_tam > 0 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tamanho', 'texto', v_sem_tam || ' variante(s) sem tamanho'));
  END IF;
  -- ruling do controlador, revisão T2 Minor #5: "Tamanho em" NULL nunca é assumido como letra em silêncio — vira
  -- falta sempre que tamanho/ref_sku estiver marcado (mesmo v_tipo continuando 'letra' só para montar a matriz acima).
  IF m.tamanho_tipo IS NULL AND v_campos && ARRAY['tamanho', 'ref_sku']::text[] THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tamanho_tipo', 'texto', 'Tamanho em'));
  END IF;

  -- FOTOS (só se "Foto do Modelo" marcado): modelos.fotos_modelo nas 3 origens (B1b)
  IF 'foto' = ANY(v_campos) THEN
    v_fotos := coalesce(m.fotos_modelo, '{}'::text[]);
    IF cardinality(v_fotos) = 0 THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'foto', 'texto', 'Foto do Modelo'));
    -- Minor #6: além do prefixo <tenant>/, falha fechado em qualquer segmento '..'/'.'/vazio (rejeita '//','/./','/../')
    ELSIF EXISTS (SELECT 1 FROM unnest(v_fotos) AS p(x)
                   WHERE p.x IS NULL OR NOT starts_with(p.x, m.tenant_id::text || '/')
                      OR EXISTS (SELECT 1 FROM unnest(string_to_array(p.x, '/')) AS seg(s) WHERE seg.s IN ('', '.', '..'))) THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'foto', 'texto', 'foto de outra loja'));
    END IF;
  END IF;

  -- conjunto de cores do ESPELHO do comprado (trava das variantes — D11)
  IF m.origem = 'revenda' THEN
    v_chaves := ARRAY(SELECT DISTINCT public._sku_variante_key(pv.cor_id, pv.cor_apelido_id)
                        FROM public.produtos_acabados pa
                        JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
                       WHERE pa.modelo_id = m.id ORDER BY 1);
  ELSIF m.origem = 'importado' THEN
    v_chaves := ARRAY(SELECT DISTINCT public._sku_variante_key(iv.cor_id, iv.cor_apelido_id)
                        FROM public.produtos_importados pi
                        JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
                       WHERE pi.modelo_id = m.id ORDER BY 1);
  END IF;

  -- ruling do controlador, revisão T4 #1 (Important #1, opção b) + re-review A (Important, residual do #1):
  -- 'nome' marcado em produto revenda/importado vira falta quando o nome do card (modelos.nome) diverge do
  -- nome do PRODUTO ESPELHO. O card do Produto Acabado (_salvar_produto_acabado_core) sempre copia
  -- produtos_acabados.nome -> modelos.nome a cada save — se o usuário renomeou só o card no Sheet do
  -- Planejamento, todo save do PA volta a travar com integracao_travado: nome mesmo sem editar nada de fato.
  -- A falta avisa ANTES do marcar (o retrato fica incompleto e marcar recusa) em vez de deixar o produto
  -- travado destravável só por voltar/desfazer. _salvar_produto_importado_core NÃO grava nome/ref em modelos
  -- (confirmado lendo 20260904180000_produto_importado_fixes_review.sql) — mas a checagem entra igual para o
  -- importado por SIMETRIA/robustez a uma mudança futura desse core (o teste cobre só o caso revenda, que é
  -- o alcançável hoje). Re-review A: a comparação tem que ser EXATA como o save do espelho grava e como a
  -- trava (fn_integracao_trava_modelos, NEW.nome IS DISTINCT FROM OLD.nome) compara — SEM btrim. O
  -- _salvar_produto_acabado_core grava `v_nome := nullif(_dados->>'nome','')` (raw, sem trim) direto em
  -- modelos.nome; comparar com btrim aqui deixava passar uma diferença SÓ de espaço ('Blusa ' × 'Blusa'),
  -- que a trava recusaria do mesmo jeito (ela também não faz trim) — o mesmo beco sem saída que a falta foi
  -- criada pra evitar. Fix: `nullif(x,'') IS DISTINCT FROM nullif(y,'')` dos dois lados (raw, não btrim) —
  -- '' e NULL contam como iguais (o mesmo `nullif` que o _core usa), mas qualquer outra diferença, inclusive
  -- só de espaço, vira falta.
  IF 'nome' = ANY(v_campos) THEN
    IF m.origem = 'revenda' THEN
      IF EXISTS (SELECT 1 FROM public.produtos_acabados pa
                  WHERE pa.modelo_id = m.id
                    AND nullif(pa.nome::text, '') IS DISTINCT FROM nullif(m.nome::text, '')) THEN
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'nome',
          'texto', 'Nome diferente do Produto Acabado'));
      END IF;
    ELSIF m.origem = 'importado' THEN
      IF EXISTS (SELECT 1 FROM public.produtos_importados pi
                  WHERE pi.modelo_id = m.id
                    AND nullif(pi.nome::text, '') IS DISTINCT FROM nullif(m.nome::text, '')) THEN
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'nome',
          'texto', 'Nome diferente do Produto Importado'));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'retrato', jsonb_build_object('v', 1, 'campos', to_jsonb(v_campos),
      'linhas', jsonb_build_array(jsonb_build_object('tipo', 'produto', 'ordem', 0, 'valores', v_prod,
                                                      'fotos', to_jsonb(v_fotos))) || v_linhas),
    'faltas', v_faltas,
    'completo', jsonb_array_length(v_faltas) = 0,
    'variantes_chaves', to_jsonb(v_chaves),
    'meta', v_meta);
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_assinar(_retrato jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_segredo bytea;
BEGIN
  -- Minor #2: falha FECHADO se o segredo sumir (nunca retorna NULL) — um assinatura NULL/ausente do cliente passaria
  -- pelo check `IS DISTINCT FROM` de staleness da T3 como se fosse igual.
  SELECT s.segredo INTO v_segredo FROM public.integracao_segredo s WHERE s.id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'integracao_2: segredo ausente' USING ERRCODE = 'P0001';
  END IF;
  RETURN encode(extensions.hmac(convert_to(_retrato::text, 'UTF8'), v_segredo, 'sha256'), 'hex');
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_gate(_base_ok boolean, _base_motivo text, _ok boolean, _motivo text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'ok', coalesce(_base_ok, false) AND coalesce(_ok, false),
    'motivo', CASE WHEN NOT coalesce(_base_ok, false) THEN _base_motivo WHEN NOT coalesce(_ok, false) THEN _motivo END)
$function$;

CREATE OR REPLACE FUNCTION public._integracao_gates(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m public.modelos%ROWTYPE;
  v_int boolean := public.user_can_edit('integracao');
  v_plan boolean := public.user_can_edit('criacao_planejamento');
  v_dev boolean := public.user_can_edit('criacao_desenvolvimento');
  v_preco boolean;
  v_criacao boolean := public.tenant_module_enabled('criacao');
  v_mod_origem boolean;
  v_kw boolean := public.is_tenant_admin() OR public.is_super_admin();
  v_estado text;
  v_base_motivo text;
  v_base_ok boolean;
  v_enviado boolean;
  v_revelada boolean;
  v_etapa text;
BEGIN
  SELECT * INTO m FROM public.modelos WHERE id = _modelo_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_preco := v_plan AND public.user_can_edit('criacao_planejamento:preco_venda');
  v_mod_origem := CASE coalesce(m.origem, 'interno')
                    WHEN 'revenda' THEN public.tenant_module_enabled('produto_acabado')
                    WHEN 'importado' THEN public.tenant_module_enabled('produto_importado')
                    ELSE true END;
  SELECT ip.estado INTO v_estado FROM public.integracao_produtos ip WHERE ip.modelo_id = m.id;
  v_estado := coalesce(v_estado, 'nao_integravel');
  v_base_motivo := CASE
    WHEN v_estado <> 'nao_integravel' THEN 'Travado pela integração.'
    WHEN NOT v_int THEN 'Precisa da permissão de editar a Integração.'
    WHEN NOT v_criacao THEN 'O módulo Estilo & Engenharia está desligado nesta loja.'
    WHEN NOT v_mod_origem THEN 'O módulo da origem deste produto (Produto Acabado/Importado) está desligado nesta loja.'
  END;
  v_base_ok := v_base_motivo IS NULL;
  v_enviado := coalesce(m.enviado_cad, false);
  v_revelada := coalesce(m.ordem_criacao_enviada, false)
    AND coalesce(public._ref_exibir_gate(m.tenant_id, public._kanban_status_gate(m.tenant_id, m.id, m.status_desenvolvimento)), false);
  SELECT r.lbl INTO v_etapa
    FROM public._kanban_status_rows(m.tenant_id) r
   WHERE r.key = coalesce(nullif(btrim((SELECT tc.ref_exibir_status FROM public.tenant_config tc WHERE tc.tenant_id = m.tenant_id)), ''), 'aprovado')
   ORDER BY r.ord
   LIMIT 1;
  RETURN jsonb_build_object(
    'estado', v_estado,
    'origem', coalesce(m.origem, 'interno'),
    'compartilhado', public._integracao_gate(v_base_ok, v_base_motivo, v_plan OR (v_dev AND NOT v_enviado),
      'Precisa da permissão de editar o Planejamento (ou o Desenvolvimento antes do envio à Explosão).'),
    'planejamento', public._integracao_gate(v_base_ok, v_base_motivo, v_plan, 'Precisa da permissão de editar o Planejamento.'),
    'preco', public._integracao_gate(v_base_ok, v_base_motivo, v_preco, 'Precisa da permissão de preço de venda.'),
    'ref', public._integracao_gate(v_base_ok, v_base_motivo, v_dev AND v_revelada AND NOT v_enviado,
      CASE WHEN NOT v_dev THEN 'Precisa da permissão de editar o Desenvolvimento.'
           WHEN NOT v_revelada THEN format('A REF aparece a partir da etapa "%s" do kanban.', coalesce(v_etapa, 'Aprovado'))
           ELSE 'REF travada pelo envio à Explosão — não pode mudar depois desse ponto.' END),
    'sku', public._integracao_gate(v_base_ok, v_base_motivo, v_plan, 'Precisa da permissão de editar o Planejamento.'),
    'keywords', public._integracao_gate(v_int, 'Precisa da permissão de editar a Integração.', v_kw,
      'Só o admin da loja muda as Keywords.'));
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_base(_tenant uuid)
 RETURNS TABLE(id uuid, nome text, ref text, origem text, colecao text, etapa text, estado text,
               marcado_em timestamptz, integrado_em timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- P-61 A: 3 origens, qualquer etapa, SEM reprovados (D9) — exceto integrado (P-74 A: segue visível).
  WITH b AS (SELECT r.key, r.ord FROM public._kanban_status_rows(_tenant) r),
       primeira AS (SELECT b.key FROM b ORDER BY b.ord LIMIT 1)
  SELECT m.id, m.nome::text, m.ref::text, coalesce(m.origem, 'interno'),
         coalesce(co.nome::text, nullif(btrim(coalesce(m.colecao::text, '')), '')),
         CASE WHEN m.lancado THEN 'lancado'
              WHEN NOT coalesce(m.ordem_criacao_enviada, false) THEN 'planejamento'
              WHEN EXISTS (SELECT 1 FROM b WHERE b.key = lower(btrim(coalesce(m.status_desenvolvimento, ''))))
                THEN lower(btrim(m.status_desenvolvimento))
              ELSE (SELECT primeira.key FROM primeira) END,
         coalesce(ip.estado, 'nao_integravel'), ip.marcado_em, ip.integrado_em
    FROM public.modelos m
    LEFT JOIN public.colecoes co ON co.id = m.colecao_id
    LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id
   WHERE m.tenant_id = _tenant
     AND (coalesce(ip.estado, 'nao_integravel') = 'integrado'
          OR NOT (coalesce(m.status_planejamento, '') = 'reprovado'
                  OR lower(btrim(coalesce(m.status_desenvolvimento, ''))) = 'reprovado'))
$function$;

CREATE OR REPLACE FUNCTION public._integracao_exige(_editar boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF _editar AND NOT public.user_can_edit('integracao') THEN
    RAISE EXCEPTION 'Sem permissão para editar a Integração.' USING ERRCODE = '42501';
  END IF;
  IF NOT _editar AND NOT public.user_can_view('integracao') THEN
    RAISE EXCEPTION 'Sem permissão para ver a Integração.' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_exige_super()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Só o super admin pode fazer isto.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_previa(_modelo_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_cfg public.integracao_config;
  v_ver boolean := public._pode_ver_custos();
  v_custos jsonb;
  v_ret jsonb;
  v_out jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF coalesce(cardinality(_modelo_ids), 0) = 0 OR cardinality(_modelo_ids) > 200 THEN
    RAISE EXCEPTION 'Selecione de 1 a 200 produtos.' USING ERRCODE = 'P0001';
  END IF;
  v_cfg := public._integracao_cfg(v_tenant);
  v_custos := coalesce(public._custo_unitario_modelos_core(_modelo_ids), '{}'::jsonb);
  FOR r IN
    SELECT m.id, m.nome, m.ref, coalesce(m.origem, 'interno') AS origem, coalesce(ip.estado, 'nao_integravel') AS estado,
           (coalesce(m.status_planejamento, '') = 'reprovado'
            OR lower(btrim(coalesce(m.status_desenvolvimento, ''))) = 'reprovado') AS reprovado
      FROM public.modelos m
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id
     WHERE m.id = ANY(_modelo_ids) AND m.tenant_id = v_tenant
     ORDER BY m.nome, m.id
  LOOP
    v_ret := public._integracao_retrato_core(r.id, v_cfg.campos, v_custos -> r.id::text);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'modelo_id', r.id, 'nome', r.nome, 'ref', r.ref, 'origem', r.origem, 'estado', r.estado, 'reprovado', r.reprovado,
      'completo', (v_ret ->> 'completo')::boolean, 'faltas', v_ret -> 'faltas',
      'retrato', CASE WHEN v_ver THEN v_ret -> 'retrato' ELSE public._integracao_mascarar(v_ret -> 'retrato') END,
      'assinatura', public._integracao_assinar(v_ret -> 'retrato')));
  END LOOP;
  RETURN jsonb_build_object('campos', to_jsonb(v_cfg.campos), 'rotulos', public._integracao_rotulos(),
    'precisa_ver_custos', 'preco_custo' = ANY(v_cfg.campos), 'pode_ver_custos', v_ver, 'produtos', v_out);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_listar(_situacao text, _filtros jsonb, _pagina integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_cfg public.integracao_config;
  v_ver boolean := public._pode_ver_custos();
  v_sit text := coalesce(nullif(btrim(coalesce(_situacao, '')), ''), 'nao_integrados');
  v_f jsonb := coalesce(_filtros, '{}'::jsonb);
  v_busca text := nullif(btrim(coalesce(_filtros ->> 'busca', '')), '');
  v_pag integer := greatest(coalesce(_pagina, 1), 1);
  v_total integer;
  v_cont jsonb;
  v_pagina jsonb;
  v_colecoes jsonb;
  v_ids uuid[];
  v_custos jsonb := '{}'::jsonb;
  v_prod jsonb := '[]'::jsonb;
  v_ret jsonb;
  v_gravado jsonb;
  v_difere jsonb;
  v_kw text;
  v_etapas jsonb;
  r record;
BEGIN
  IF v_sit NOT IN ('nao_integrados', 'integrados', 'todos') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'P0001';
  END IF;
  v_cfg := public._integracao_cfg(v_tenant);

  WITH b AS (SELECT * FROM public._integracao_base(v_tenant)),
       f AS (
         SELECT b.* FROM b
          WHERE (v_sit = 'todos' OR (v_sit = 'integrados' AND b.estado = 'integrado')
                 OR (v_sit = 'nao_integrados' AND b.estado <> 'integrado'))
            AND (v_f ->> 'colecao' IS NULL OR b.colecao = v_f ->> 'colecao')
            AND (v_f ->> 'etapa' IS NULL OR b.etapa = v_f ->> 'etapa')
            AND (v_f ->> 'origem' IS NULL OR b.origem = v_f ->> 'origem')
            AND (v_f ->> 'estado' IS NULL OR b.estado = v_f ->> 'estado')
            AND (v_busca IS NULL OR b.nome ILIKE '%' || v_busca || '%' OR coalesce(b.ref, '') ILIKE '%' || v_busca || '%'))
  SELECT jsonb_build_object(
           'nao_integrados', (SELECT count(*) FROM b WHERE b.estado <> 'integrado'),
           'integrados', (SELECT count(*) FROM b WHERE b.estado = 'integrado'),
           'todos', (SELECT count(*) FROM b)),
         (SELECT count(*) FROM f),
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'colecao', p.colecao, 'etapa', p.etapa, 'estado', p.estado,
                                                        'marcado_em', p.marcado_em, 'integrado_em', p.integrado_em)
                                    ORDER BY p.nome, p.id)
                     FROM (SELECT f.* FROM f ORDER BY f.nome, f.id OFFSET (v_pag - 1) * 50 LIMIT 50) p), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(DISTINCT b.colecao ORDER BY b.colecao) FROM b WHERE b.colecao IS NOT NULL), '[]'::jsonb)
    INTO v_cont, v_total, v_pagina, v_colecoes;

  v_ids := ARRAY(SELECT (x.p ->> 'id')::uuid FROM jsonb_array_elements(v_pagina) AS x(p));
  IF cardinality(v_ids) > 0 THEN
    v_custos := coalesce(public._custo_unitario_modelos_core(v_ids), '{}'::jsonb);
  END IF;
  FOR r IN
    SELECT m.*, e.p ->> 'colecao' AS b_colecao, e.p ->> 'etapa' AS b_etapa, e.p ->> 'estado' AS b_estado,
           e.p -> 'marcado_em' AS b_marcado, e.p -> 'integrado_em' AS b_integrado, ip.retrato AS ip_retrato, e.n AS b_n
      FROM jsonb_array_elements(v_pagina) WITH ORDINALITY AS e(p, n)
      JOIN public.modelos m ON m.id = (e.p ->> 'id')::uuid
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id
     ORDER BY e.n
  LOOP
    v_ret := public._integracao_retrato_core(r.id, v_cfg.campos, v_custos -> r.id::text);
    v_gravado := CASE WHEN r.ip_retrato IS NULL THEN NULL WHEN v_ver THEN r.ip_retrato
                      ELSE public._integracao_mascarar(r.ip_retrato) END;
    -- N10: linha integrável/integrada mostra o RETRATO; o "i" avisa quais campos do produto mudaram depois dele
    v_difere := CASE WHEN r.ip_retrato IS NULL THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(k.k ORDER BY k.k)
        FROM jsonb_object_keys(r.ip_retrato -> 'linhas' -> 0 -> 'valores') AS k(k)
       WHERE (v_ver OR k.k <> 'preco_custo')
         AND (r.ip_retrato -> 'linhas' -> 0 -> 'valores' -> k.k)
             IS DISTINCT FROM (v_ret -> 'retrato' -> 'linhas' -> 0 -> 'valores' -> k.k)), '[]'::jsonb) END;
    v_prod := v_prod || jsonb_build_array(jsonb_build_object(
      'modelo_id', r.id, 'origem', coalesce(r.origem, 'interno'), 'colecao', r.b_colecao, 'etapa', r.b_etapa,
      'estado', r.b_estado, 'marcado_em', r.b_marcado, 'integrado_em', r.b_integrado, 'rev', r.rev,
      'raw', jsonb_build_object(
        'nome', r.nome, 'ref', r.ref, 'preco_anterior', r.preco_anterior, 'preco_venda', r.preco_venda,
        'peso_kg', r.peso_kg, 'ncm', r.ncm, 'titulo_pagina', r.titulo_pagina, 'descricao_produto', r.descricao_produto,
        'comprimento_cm', r.comprimento_cm, 'largura_cm', r.largura_cm, 'altura_cm', r.altura_cm,
        'fotos_modelo', to_jsonb(coalesce(r.fotos_modelo, '{}'::text[])), 'tamanho_tipo', r.tamanho_tipo),
      'vivo', CASE WHEN v_ver THEN v_ret -> 'retrato' ELSE public._integracao_mascarar(v_ret -> 'retrato') END,
      'faltas', v_ret -> 'faltas', 'completo', (v_ret ->> 'completo')::boolean, 'sublinhas', v_ret -> 'meta',
      'retrato', v_gravado, 'retrato_difere', v_difere, 'gates', public._integracao_gates(r.id)));
  END LOOP;

  SELECT tc.keywords INTO v_kw FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant;
  v_etapas := jsonb_build_array(jsonb_build_object('key', 'planejamento', 'label', 'Planejamento'))
    || coalesce((SELECT jsonb_agg(jsonb_build_object('key', s.key, 'label', s.lbl) ORDER BY s.ord)
                   FROM public._kanban_status_rows(v_tenant) s), '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('key', 'lancado', 'label', 'Lançado'));
  RETURN jsonb_build_object(
    'pagina', v_pag, 'por_pagina', 50, 'total', v_total, 'contagens', v_cont,
    'campos', to_jsonb(v_cfg.campos), 'rotulos', public._integracao_rotulos(),
    'opcoes', jsonb_build_object('colecoes', v_colecoes, 'etapas', v_etapas),
    'pode', jsonb_build_object('editar', public.user_can_edit('integracao'), 'ver_custos', v_ver,
                               'super', public.is_super_admin(), 'keywords', public.is_tenant_admin() OR public.is_super_admin()),
    'keywords', v_kw,
    'produtos', v_prod);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_estado_modelos(_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  -- Selos das outras telas (F4): qualquer usuário da loja lê SÓ estado/campos/datas (nada de retrato ou custo).
  -- _ids NULL = TODOS os integráveis/integrados da loja (1 consulta por loja, compartilhada pelas telas — Task 21).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(_ids), 0) > 2000 THEN
    RAISE EXCEPTION 'No máximo 2000 produtos por consulta.' USING ERRCODE = 'P0001';
  END IF;
  -- N5 (G-plano do plano): teto de 5000 linhas (as marcadas mais recentemente) — a consulta dos selos é por loja inteira
  RETURN coalesce((
    SELECT jsonb_object_agg(x.modelo_id::text, jsonb_build_object('estado', x.estado, 'campos', to_jsonb(x.campos),
                                                                   'marcado_em', x.marcado_em, 'integrado_em', x.integrado_em))
      FROM (SELECT ip.modelo_id, ip.estado, ip.campos, ip.marcado_em, ip.integrado_em
              FROM public.integracao_produtos ip
             WHERE (_ids IS NULL OR ip.modelo_id = ANY(_ids)) AND ip.tenant_id = v_tenant
               AND ip.estado IN ('integravel', 'integrado')
             ORDER BY ip.marcado_em DESC NULLS LAST, ip.modelo_id
             LIMIT 5000) x), '{}'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_config_ler()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_cfg public.integracao_config;
BEGIN
  v_cfg := public._integracao_cfg(v_tenant);
  -- LER os campos = quem vê a tela (a aba Produtos monta as colunas); config da API = SÓ super admin (v4)
  RETURN jsonb_build_object('campos', to_jsonb(v_cfg.campos), 'layout', to_jsonb(public._integracao_layout()),
    'rotulos', public._integracao_rotulos(), 'rev', v_cfg.rev,
    'api', CASE WHEN public.is_super_admin() THEN jsonb_build_object(
      'limite_por_minuto', v_cfg.limite_por_minuto, 'max_por_pagina', v_cfg.max_por_pagina,
      'validade_foto_dias', v_cfg.validade_foto_dias, 'bloqueio_tentativas', v_cfg.bloqueio_tentativas) END);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._integracao_rotulos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_cfg(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_num(numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_mascarar(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_retrato_core(uuid, text[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_assinar(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_gate(boolean, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_gates(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_base(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_exige(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_exige_super() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integracao_previa(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_listar(text, jsonb, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_estado_modelos(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_config_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_previa(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_listar(text, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_estado_modelos(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_config_ler() TO authenticated;

DO $pos$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public._integracao_rotulos()', 'public._integracao_cfg(uuid)', 'public._integracao_num(numeric,integer)',
    'public._integracao_mascarar(jsonb)', 'public._integracao_retrato_core(uuid,text[],jsonb)', 'public._integracao_assinar(jsonb)',
    'public._integracao_gate(boolean,text,boolean,text)', 'public._integracao_gates(uuid)', 'public._integracao_base(uuid)',
    'public._integracao_exige(boolean)', 'public._integracao_exige_super()'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_2: % executavel por PUBLIC/anon/authenticated (inv. 9)', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.integracao_previa(uuid[])', 'public.integracao_listar(text,jsonb,integer)',
    'public.integracao_estado_modelos(uuid[])', 'public.integracao_config_ler()'] LOOP
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_2: ACL errada em %', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
