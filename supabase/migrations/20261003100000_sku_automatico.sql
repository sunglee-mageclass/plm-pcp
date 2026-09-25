-- SKU automático — F3.5a (banco): siglas SKU, Formato do SKU, "Tamanho em", modelo_skus e RPCs de geração.
-- ============================================================================================================
-- Spec: docs/superpowers/specs/2026-09-24-sku-automatico-design.md (§4.1, §4.2, §4.4) · Plano:
-- docs/superpowers/plans/2026-09-24-sku-automatico-f35a.md (Tasks 3–5; ressalvas R1–R10 do G-plano). Inverso pareado
-- (DESTRUTIVO, pede confirmação): supabase/rollback/20261003100000_sku_automatico_down.sql.
--
-- ADITIVA e IDEMPOTENTE (CREATE OR REPLACE / IF NOT EXISTS / DROP … IF EXISTS antes de CREATE TRIGGER|POLICY).
-- NÃO redefine NENHUMA função existente (tudo aqui é novo: 23 funções, 6 gatilhos, 1 tabela, 7 colunas em tabelas
-- existentes). MAS TRAVA TABELAS EXISTENTES até o COMMIT:
--   • AccessExclusive nos ALTER de cores, cores_apelido, produtos_acabados, produtos_importados, modelos e
--     tenant_config (lida pelas policies de TODAS as lojas) e SHARE ROW EXCLUSIVE em modelos/tenants (FKs novas);
--   • cada CREATE/DROP POLICY feito como `postgres` dispara o hook `supautils.policy_grants`, que pega AccessExclusive
--     em ~24 tabelas de auth/storage/realtime (auth.users, auth.sessions, auth.refresh_tokens, storage.objects…) —
--     login e refresh de token esperam enquanto a transação estiver aberta.
-- Por isso: toda DDL que trava fica no FIM do arquivo (policies por último) e as travas abaixo valem mesmo por
-- `psql -f` (o caminho padrão do CLAUDE.md), não só pelo aplica_v2; aplicar em horário calmo.
-- Partes: [A] helpers puros (espelhos de src/lib/tamanho.ts + src/lib/sku-montar.ts) · [C] cálculo, RPCs e ACL ·
-- [B] tabela modelo_skus, colunas, gatilhos e policies.

BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

-- ─────────────────────────── [A] Helpers PUROS (IMMUTABLE) — espelho TS, anti-drift ───────────────────────────

-- Tira acento por uma lista FIXA (maiúsculas e minúsculas) — não depende do locale do banco. Espelho: semAcento
-- (src/lib/sku-montar.ts, ACENTOS_DE/ACENTOS_PARA).
CREATE OR REPLACE FUNCTION public._sku_sem_acento(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT translate(coalesce(_s, ''),
    'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy')
$function$;

-- Sigla (cor base, cor apelido, lado do tamanho): sem acento, só A–Z/0–9, MAIÚSCULAS; vazia ⇒ NULL (D6/R4).
-- O upper() só recebe ASCII (o filtro vem antes). Espelho: normalizarSigla.
CREATE OR REPLACE FUNCTION public._sku_norm_sigla(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT nullif(upper(regexp_replace(public._sku_sem_acento(_s), '[^A-Za-z0-9]', '', 'g')), '')
$function$;

-- A REF dentro do SKU: sem acento, só A–Z/0–9 e - . _ /, MAIÚSCULAS (o resto sai; vazia = ''). Espelho: normalizarRefSku.
CREATE OR REPLACE FUNCTION public._sku_norm_ref(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT upper(regexp_replace(public._sku_sem_acento(_s), '[^A-Za-z0-9._/-]', '', 'g'))
$function$;

-- SKU digitado à mão: sem espaço, sem acento, MAIÚSCULAS; só A–Z, 0–9 e - . _ / (senão RAISE P0001, mesma
-- mensagem do TS). Espelho: normalizarSkuManual.
CREATE OR REPLACE FUNCTION public._sku_norm_manual(_s text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v text;
BEGIN
  v := regexp_replace(coalesce(_s, ''), '[ \t\r\n]', '', 'g');
  IF v = '' THEN
    RAISE EXCEPTION 'Informe o SKU.' USING ERRCODE = 'P0001';
  END IF;
  v := public._sku_sem_acento(v);
  IF v ~ '[^A-Za-z0-9._/-]' THEN
    RAISE EXCEPTION 'SKU inválido: use só letras, números e - . _ /.' USING ERRCODE = 'P0001';
  END IF;
  RETURN upper(v);
END
$function$;

-- Chave da VARIANTE no SKU = a COR (base + apelido), não o id da linha de variante (R1 do G-plano): o Salvar do
-- Produto Acabado/Importado APAGA e regrava as variantes (id novo a cada save) e a troca do tecido do Tecido 1
-- mantendo as cores muda o id de variantes_tecido — a cor é o que identifica a variante comercial.
CREATE OR REPLACE FUNCTION public._sku_variante_key(_cor uuid, _apelido uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT md5('sku-variante|' || coalesce(_cor::text, '-') || '|' || coalesce(_apelido::text, '-'))::uuid
$function$;

-- "34|PPP" → (34, PPP); "PPP|34" → (34, PPP); solto: só dígitos → número, o resto → letra. Só o 1º "|" separa.
-- Espelho: parseTamanho (src/lib/tamanho.ts).
CREATE OR REPLACE FUNCTION public._sku_tamanho_lados(_t text, OUT numero text, OUT letra text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_s text;
  v_i integer;
  v_a text;
  v_b text;
BEGIN
  numero := NULL;
  letra := NULL;
  v_s := btrim(coalesce(_t, ''), E' \t\r\n');
  IF v_s = '' THEN
    RETURN;
  END IF;
  v_i := strpos(v_s, '|');
  IF v_i = 0 THEN
    IF v_s ~ '^[0-9]+$' THEN numero := v_s; ELSE letra := v_s; END IF;
    RETURN;
  END IF;
  v_a := nullif(btrim(substr(v_s, 1, v_i - 1), E' \t\r\n'), '');
  v_b := nullif(btrim(substr(v_s, v_i + 1), E' \t\r\n'), '');
  IF v_a IS NOT NULL AND v_b IS NOT NULL THEN
    IF v_a !~ '^[0-9]+$' AND v_b ~ '^[0-9]+$' THEN
      numero := v_b; letra := v_a;
    ELSE
      numero := v_a; letra := v_b;
    END IF;
  ELSIF v_a IS NOT NULL THEN
    IF v_a ~ '^[0-9]+$' THEN numero := v_a; ELSE letra := v_a; END IF;
  ELSIF v_b IS NOT NULL THEN
    IF v_b ~ '^[0-9]+$' THEN numero := v_b; ELSE letra := v_b; END IF;
  END IF;
END
$function$;

-- Lado que vale no SKU: o do tipo pedido; sem esse lado (solto ou "UN"), o outro. Espelho: ladoTamanho.
CREATE OR REPLACE FUNCTION public._sku_tamanho_lado(_t text, _tipo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN _tipo = 'numero' THEN coalesce(l.numero, l.letra) ELSE coalesce(l.letra, l.numero) END
    FROM public._sku_tamanho_lados(_t) AS l
$function$;

-- Formato do SKU canônico {partes, separadores, tamanho_padrao} ou NULL (sem partes = a loja não gera SKU).
-- RAISE P0001 com as MESMAS mensagens de normalizarSkuConfig (src/lib/sku-montar.ts).
CREATE OR REPLACE FUNCTION public._sku_config_normaliza(_c jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_partes jsonb;
  v_seps jsonb;
  v_out_partes jsonb := '[]'::jsonb;
  v_out_seps jsonb := '{}'::jsonb;
  v_p jsonb;
  v_t text;
  v_prev text := NULL;
  v_sep jsonb;
  v_s text;
  v_tipo text;
BEGIN
  IF _c IS NULL OR jsonb_typeof(_c) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_c) <> 'object' THEN
    RAISE EXCEPTION 'Formato do SKU inválido.' USING ERRCODE = 'P0001';
  END IF;
  v_partes := _c -> 'partes';
  IF v_partes IS NULL OR jsonb_typeof(v_partes) = 'null' THEN
    v_partes := '[]'::jsonb;
  ELSIF jsonb_typeof(v_partes) <> 'array' THEN
    RAISE EXCEPTION 'Formato do SKU inválido: partes.' USING ERRCODE = 'P0001';
  END IF;
  FOR v_p IN SELECT e.value FROM jsonb_array_elements(v_partes) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF jsonb_typeof(v_p) <> 'string' OR (v_p #>> '{}') NOT IN ('ref', 'cor_base', 'cor_apelido', 'tamanho') THEN
      RAISE EXCEPTION 'Parte do SKU desconhecida: %.', v_p::text USING ERRCODE = 'P0001';
    END IF;
    IF v_out_partes @> jsonb_build_array(v_p) THEN
      RAISE EXCEPTION 'Parte do SKU repetida: %.', v_p #>> '{}' USING ERRCODE = 'P0001';
    END IF;
    v_out_partes := v_out_partes || jsonb_build_array(v_p);
  END LOOP;
  IF jsonb_array_length(v_out_partes) = 0 THEN
    RETURN NULL;
  END IF;
  v_seps := _c -> 'separadores';
  IF v_seps IS NULL OR jsonb_typeof(v_seps) = 'null' THEN
    v_seps := '{}'::jsonb;
  ELSIF jsonb_typeof(v_seps) <> 'object' THEN
    RAISE EXCEPTION 'Formato do SKU inválido: separadores.' USING ERRCODE = 'P0001';
  END IF;
  FOR v_t IN SELECT e.value FROM jsonb_array_elements_text(v_out_partes) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF v_prev IS NOT NULL THEN
      v_sep := v_seps -> (v_prev || '|' || v_t);
      IF v_sep IS NOT NULL AND jsonb_typeof(v_sep) <> 'null' THEN
        IF jsonb_typeof(v_sep) <> 'string' THEN
          RAISE EXCEPTION 'Separador do SKU inválido.' USING ERRCODE = 'P0001';
        END IF;
        v_s := v_sep #>> '{}';
        IF v_s !~ '^[-._/]*$' THEN
          RAISE EXCEPTION 'Separador do SKU: use só - . _ /.' USING ERRCODE = 'P0001';
        END IF;
        IF char_length(v_s) > 3 THEN
          RAISE EXCEPTION 'Separador do SKU: no máximo 3 caracteres.' USING ERRCODE = 'P0001';
        END IF;
        IF v_s <> '' THEN
          v_out_seps := v_out_seps || jsonb_build_object(v_prev || '|' || v_t, v_s);
        END IF;
      END IF;
    END IF;
    v_prev := v_t;
  END LOOP;
  v_tipo := coalesce(nullif(_c ->> 'tamanho_padrao', ''), 'letra');
  IF v_tipo NOT IN ('letra', 'numero') THEN
    RAISE EXCEPTION 'Tamanho padrão do SKU inválido (use letra ou número).' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('partes', v_out_partes, 'separadores', v_out_seps, 'tamanho_padrao', v_tipo);
END
$function$;

-- Mapa lado-do-tamanho → sigla canônico (chave aparada, sigla normalizada, vazias fora) ou NULL. As checagens NÃO
-- dependem da ordem das chaves: 1º tipo inválido, 2º chave repetida depois de aparar (ambas pela menor chave em
-- COLLATE "C"), 3º o mapa. RAISE P0001 com as MESMAS mensagens de normalizarTamanhosSku.
CREATE OR REPLACE FUNCTION public._sku_tamanhos_normaliza(_m jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_k text;
  v_out jsonb;
BEGIN
  IF _m IS NULL OR jsonb_typeof(_m) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_m) <> 'object' THEN
    RAISE EXCEPTION 'Siglas de tamanho inválidas.' USING ERRCODE = 'P0001';
  END IF;
  SELECT x.k INTO v_k
    FROM (SELECT btrim(e.key, E' \t\r\n') AS k, e.value AS v FROM jsonb_each(_m) AS e) x
   WHERE x.k <> '' AND jsonb_typeof(x.v) NOT IN ('null', 'string')
   ORDER BY x.k COLLATE "C"
   LIMIT 1;
  IF v_k IS NOT NULL THEN
    RAISE EXCEPTION 'Sigla de tamanho inválida: %.', v_k USING ERRCODE = 'P0001';
  END IF;
  SELECT x.k INTO v_k
    FROM (SELECT btrim(e.key, E' \t\r\n') AS k, e.value AS v FROM jsonb_each(_m) AS e) x
   WHERE x.k <> '' AND jsonb_typeof(x.v) <> 'null'
   GROUP BY x.k
  HAVING count(*) > 1
   ORDER BY x.k COLLATE "C"
   LIMIT 1;
  IF v_k IS NOT NULL THEN
    RAISE EXCEPTION 'Sigla de tamanho repetida: %.', v_k USING ERRCODE = 'P0001';
  END IF;
  SELECT jsonb_object_agg(y.k, y.sig) INTO v_out
    FROM (SELECT btrim(e.key, E' \t\r\n') AS k, public._sku_norm_sigla(e.value #>> '{}') AS sig
            FROM jsonb_each(_m) AS e
           WHERE btrim(e.key, E' \t\r\n') <> '' AND jsonb_typeof(e.value) = 'string') y
   WHERE y.sig IS NOT NULL;
  RETURN v_out;
END
$function$;

-- Junta as partes na ordem do formato: o separador anda com a parte que vem DEPOIS; parte vazia some com ele.
-- Espelho: montarSku.
CREATE OR REPLACE FUNCTION public._sku_montar(_cfg jsonb, _valores jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_p text;
  v_v text;
  v_anterior text := NULL;
  v_emitiu boolean := false;
  v_out text := '';
BEGIN
  IF _cfg IS NULL THEN
    RETURN '';
  END IF;
  FOR v_p IN SELECT e.value FROM jsonb_array_elements_text(coalesce(_cfg -> 'partes', '[]'::jsonb)) WITH ORDINALITY AS e(value, n)
             ORDER BY e.n LOOP
    v_v := coalesce(_valores ->> v_p, '');
    IF v_v <> '' THEN
      IF v_emitiu AND v_anterior IS NOT NULL THEN
        v_out := v_out || coalesce(_cfg -> 'separadores' ->> (v_anterior || '|' || v_p), '');
      END IF;
      v_out := v_out || v_v;
      v_emitiu := true;
    END IF;
    v_anterior := v_p;
  END LOOP;
  RETURN v_out;
END
$function$;

-- O SKU de UMA linha (variante × tamanho), as `faltas` de sigla que o impedem (Q4 — bloqueiam; ordem cor_base →
-- tamanho) e os `avisos` (não bloqueiam). _cor/_apelido = {"id","nome","sigla"} ou NULL. Tamanho "UN" (grade única)
-- sem sigla: a parte some (D1). Cor apelido (D4 — decidido pelo dono 24/set): apelido COM sigla entra; variante SEM
-- apelido, ou apelido SEM sigla, usa a COR BASE — com a parte cor_base no Formato a parte cor_apelido some (não repete
-- a cor); com SÓ cor_apelido, a sigla da cor base vai nessa posição. Apelido que existe sem sigla (e o Formato usa
-- cor_apelido) ⇒ aviso "Falta sigla na cor apelido" (o SKU sai com a cor base; cadastrada a sigla, o Regerar atualiza).
-- Espelho: resolverSku.
CREATE OR REPLACE FUNCTION public._sku_resolver(_cfg jsonb, _ref text, _cor jsonb, _apelido jsonb,
                                                _tamanho_key text, _tipo text, _tsku jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_usa jsonb;
  v_val jsonb := '{}'::jsonb;
  v_faltas jsonb := '[]'::jsonb;
  v_avisos jsonb := '[]'::jsonb;
  v_sig_apelido text;
  v_sig_base text;
  v_lado text;
  v_sig text;
  v_sku text;
BEGIN
  IF _cfg IS NULL THEN
    RETURN jsonb_build_object('sku', NULL::text, 'faltas', '[]'::jsonb, 'avisos', '[]'::jsonb);
  END IF;
  v_usa := coalesce(_cfg -> 'partes', '[]'::jsonb);
  IF v_usa ? 'ref' THEN
    v_val := v_val || jsonb_build_object('ref', public._sku_norm_ref(_ref));
  END IF;
  IF _apelido IS NOT NULL AND jsonb_typeof(_apelido) <> 'null' THEN
    v_sig_apelido := nullif(_apelido ->> 'sigla', '');
    IF v_usa ? 'cor_apelido' AND v_sig_apelido IS NULL THEN
      v_avisos := v_avisos || jsonb_build_array(jsonb_build_object('atributo', 'cor_apelido', 'id', _apelido -> 'id', 'nome', _apelido -> 'nome'));
    END IF;
  END IF;
  -- A cor base é exigida se o Formato tem cor_base — ou se tem cor_apelido e o apelido não entra (D4).
  IF v_usa ? 'cor_base' OR (v_usa ? 'cor_apelido' AND v_sig_apelido IS NULL) THEN
    IF _cor IS NULL OR jsonb_typeof(_cor) = 'null' THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('atributo', 'cor_base', 'id', NULL::text, 'nome', NULL::text));
    ELSIF coalesce(_cor ->> 'sigla', '') = '' THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('atributo', 'cor_base', 'id', _cor -> 'id', 'nome', _cor -> 'nome'));
    ELSE
      v_sig_base := _cor ->> 'sigla';
    END IF;
  END IF;
  IF v_usa ? 'cor_base' AND v_sig_base IS NOT NULL THEN
    v_val := v_val || jsonb_build_object('cor_base', v_sig_base);
  END IF;
  IF v_usa ? 'cor_apelido' THEN
    IF v_sig_apelido IS NOT NULL THEN
      v_val := v_val || jsonb_build_object('cor_apelido', v_sig_apelido);
    ELSIF NOT (v_usa ? 'cor_base') AND v_sig_base IS NOT NULL THEN
      v_val := v_val || jsonb_build_object('cor_apelido', v_sig_base);  -- só cor_apelido no Formato: a cor base no lugar
    END IF;
  END IF;
  IF v_usa ? 'tamanho' THEN
    v_lado := public._sku_tamanho_lado(_tamanho_key, _tipo);
    v_sig := CASE
               WHEN v_lado IS NULL OR _tsku IS NULL OR jsonb_typeof(_tsku) <> 'object' THEN NULL
               ELSE nullif(_tsku ->> v_lado, '')
             END;
    IF v_sig IS NOT NULL THEN
      v_val := v_val || jsonb_build_object('tamanho', v_sig);
    ELSIF v_lado IS NOT NULL AND v_lado <> 'UN' THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('atributo', 'tamanho', 'id', NULL::text, 'nome', v_lado));
    END IF;
  END IF;
  IF jsonb_array_length(v_faltas) > 0 THEN
    RETURN jsonb_build_object('sku', NULL::text, 'faltas', v_faltas, 'avisos', v_avisos);
  END IF;
  v_sku := public._sku_montar(_cfg, v_val);
  RETURN jsonb_build_object('sku', nullif(v_sku, ''), 'faltas', v_faltas, 'avisos', v_avisos);
END
$function$;

-- Invariante #9: helpers internos SEM EXECUTE para PUBLIC/anon/authenticated (só as funções DEFINER os chamam).
REVOKE EXECUTE ON FUNCTION
  public._sku_sem_acento(text),
  public._sku_norm_sigla(text),
  public._sku_norm_ref(text),
  public._sku_norm_manual(text),
  public._sku_variante_key(uuid, uuid),
  public._sku_tamanho_lados(text),
  public._sku_tamanho_lado(text, text),
  public._sku_config_normaliza(jsonb),
  public._sku_tamanhos_normaliza(jsonb),
  public._sku_montar(jsonb, jsonb),
  public._sku_resolver(jsonb, text, jsonb, jsonb, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────── [C] Cálculo, leitura, geração, edição manual e ACL ───────────────────────────
-- Modelo de segurança (invariante #9 + spec §4.4): o WRAPPER checa login → módulo `criacao` → loja do modelo →
-- permissão (`criacao_planejamento`: ver p/ ler, editar p/ gerar/regerar/editar) via _sku_guarda; os `_core`
-- e o cálculo têm EXECUTE revogado dos TRÊS (PUBLIC, anon, authenticated).
-- Unicidade do SKU (D5/R2 — PENDENTE DO DONO; implementada a recomendação): SKU igual só é aceito entre cards com a
-- MESMA REF VIVA (modelos.ref agora, normalizada, não vazia — R2-a) e a MESMA linha (cor + tamanho) — a réplica/versão
-- do produto reusa o SKU do original; qualquer outro SKU igual na loja é conflito. Quem garante é o gatilho
-- fn_modelo_skus_unico (parte B); a leitura abaixo espelha a MESMA regra para marcar "conflito" — inclusive no SKU já
-- GRAVADO, quando a REF de um dos cards mudou depois (sem isso o conflito ficaria calado).
-- Ordem de travas em TODA escrita de SKU (geração e edição à mão — sem deadlock entre elas): sku_modelo:<modelo> →
-- a linha (FOR UPDATE / INSERT / UPDATE) → sku_unico:<loja> (no gatilho).

-- Guarda comum dos 3 wrappers. _tenant = loja do modelo/SKU (NULL = não existe ⇒ "Sem permissão", sem vazar).
CREATE OR REPLACE FUNCTION public._sku_guarda(_tenant uuid, _editar boolean)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Estilo & Engenharia não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS DISTINCT FROM public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo.' USING ERRCODE = '42501';
  END IF;
  IF _editar AND NOT public.user_can_edit('criacao_planejamento') THEN
    RAISE EXCEPTION 'Sem permissão para editar SKUs (Planejamento de Produto).' USING ERRCODE = '42501';
  END IF;
  IF NOT _editar AND NOT public.user_can_view('criacao_planejamento') THEN
    RAISE EXCEPTION 'Sem permissão para ver SKUs (Planejamento de Produto).' USING ERRCODE = '42501';
  END IF;
END
$function$;

-- As linhas (variante × tamanho com quantidade > 0) do modelo e o SKU PREVISTO de cada uma (ou as faltas), com os
-- avisos (D4: apelido sem sigla — o SKU sai com a cor base).
-- Variantes: interno = variantes do Tecido 1; revenda = produto_acabado_variantes; importado =
-- produto_importado_variantes. A CHAVE da variante é a COR (_sku_variante_key(cor, apelido) — R1): o id da linha de
-- variante muda a cada Salvar do produto. Duas variantes com a MESMA cor + apelido no mesmo card (ex.: Bege em 2
-- tecidos) viram UMA linha e UM SKU (D7 — PENDENTE DO DONO: para o cliente é o mesmo produto): vale a menor ordem e
-- as quantidades por tamanho somam. Grade: modelo_grades.variante_numero = ordem da variante; tamanho_key = a chave INTEIRA da grade
-- ("34|PPP"). Sem sku_config: linhas com sku NULL (o chamador decide o status). Não lê modelo_skus.
CREATE OR REPLACE FUNCTION public._skus_modelo_calc(_modelo_id uuid)
RETURNS TABLE (variante_key uuid, variante_ordem integer, cor_nome text, apelido_nome text,
               tamanho_key text, tamanho_ordem integer, sku text, faltas jsonb, avisos jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH m AS (
    SELECT mo.id AS mid,
           mo.ref AS mref,
           coalesce(mo.origem, 'interno') AS morigem,
           coalesce(mo.tamanho_tipo, tc.sku_config ->> 'tamanho_padrao', 'letra') AS mtipo,
           tc.sku_config AS mcfg,
           tc.tamanhos_sku AS mtsku,
           CASE WHEN jsonb_typeof(tc.tamanhos_grade) = 'array' THEN tc.tamanhos_grade ELSE '[]'::jsonb END AS mgrade
      FROM public.modelos mo
      LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
     WHERE mo.id = _modelo_id
  ),
  va AS (
    SELECT public._sku_variante_key(vt.cor_id, vt.cor_apelido_id) AS vkey, mtv.ordem AS vordem,
           vt.cor_id AS vcor, vt.cor_apelido_id AS vapelido
      FROM m
      JOIN public.modelo_tecidos mt ON mt.modelo_id = m.mid AND mt.tipo = 'tecido' AND mt.numero = 1
      JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id
      JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
     WHERE m.morigem = 'interno'
    UNION ALL
    SELECT public._sku_variante_key(pv.cor_id, pv.cor_apelido_id), pv.ordem, pv.cor_id, pv.cor_apelido_id
      FROM m
      JOIN public.produtos_acabados pa ON pa.modelo_id = m.mid
      JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
     WHERE m.morigem = 'revenda'
    UNION ALL
    SELECT public._sku_variante_key(iv.cor_id, iv.cor_apelido_id), iv.ordem, iv.cor_id, iv.cor_apelido_id
      FROM m
      JOIN public.produtos_importados pi ON pi.modelo_id = m.mid
      JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
     WHERE m.morigem = 'importado'
  ),
  vs AS (
    SELECT DISTINCT ON (va.vkey) va.vkey, va.vordem, va.vcor, va.vapelido
      FROM va
     ORDER BY va.vkey, va.vordem
  ),
  tam AS (
    SELECT va.vkey AS tvkey, e.key AS tkey
      FROM va
      JOIN public.modelo_grades g ON g.modelo_id = _modelo_id AND g.variante_numero = va.vordem
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(g.grades) = 'object' THEN g.grades ELSE '{}'::jsonb END) AS e
     GROUP BY va.vkey, e.key
    HAVING sum(CASE
                 WHEN jsonb_typeof(e.value) = 'number' THEN (e.value #>> '{}')::numeric
                 WHEN jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
                   THEN btrim(e.value #>> '{}')::numeric
                 ELSE 0
               END) > 0
  )
  SELECT vs.vkey,
         vs.vordem,
         c.nome::text,
         a.nome::text,
         tam.tkey,
         coalesce((SELECT o.n::integer
                     FROM jsonb_array_elements_text(m.mgrade) WITH ORDINALITY AS o(t, n)
                    WHERE o.t = tam.tkey
                    ORDER BY o.n
                    LIMIT 1), 9999),
         r.res ->> 'sku',
         r.res -> 'faltas',
         r.res -> 'avisos'
    FROM m
    JOIN vs ON true
    JOIN tam ON tam.tvkey = vs.vkey
    LEFT JOIN public.cores c ON c.id = vs.vcor
    LEFT JOIN public.cores_apelido a ON a.id = vs.vapelido
    CROSS JOIN LATERAL (
      SELECT public._sku_resolver(
               m.mcfg,
               m.mref,
               CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'nome', c.nome, 'sigla', c.sigla_sku) END,
               CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', a.id, 'nome', a.nome, 'sigla', a.sigla_sku) END,
               tam.tkey,
               m.mtipo,
               m.mtsku) AS res
    ) AS r;
END
$function$;

-- A MATRIZ do card (Variante × Tamanho) — leitura pura (a F3.5b mostra; nada é gravado aqui).
-- status: 'sem_formato' (loja sem sku_config) | 'aguardando_ref' (card sem REF) | 'ok'. `faltas` (bloqueiam a linha —
-- Q4) × `avisos` (não bloqueiam — D4), por linha e somados no topo (a F3.5b usa no selo: "falta sigla" × "aviso").
-- estado por linha: ok · manual · falta · pendente (ainda não gerado) · divergente (Regerar mudaria) ·
-- conflito (o SKU GRAVADO ou o PREVISTO já é de outra linha da loja — `conflito_com`; réplica com a mesma REF VIVA e a
-- mesma linha NÃO é conflito — D5; a REF de um card trocada depois de gravar aparece aqui nos DOIS cards — R2-a) ·
-- vazio · orfa (gravado, fora da grade).
CREATE OR REPLACE FUNCTION public._skus_modelo_core(_modelo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  v_tipo_card text;
  v_tipo text;
  v_status text;
  v_linhas jsonb;
  v_faltas jsonb;
  v_avisos jsonb;
BEGIN
  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config, mo.tamanho_tipo
    INTO v_tenant, v_refn, v_cfg, v_tipo_card
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  v_tipo := coalesce(v_tipo_card, v_cfg ->> 'tamanho_padrao', 'letra');
  v_status := CASE WHEN v_cfg IS NULL THEN 'sem_formato' WHEN v_refn = '' THEN 'aguardando_ref' ELSE 'ok' END;

  IF v_status <> 'ok' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key, 'sku', s.sku,
             'manual', s.manual, 'rev', s.rev, 'estado', CASE WHEN s.manual THEN 'manual' ELSE 'salvo' END)
             ORDER BY s.variante_key, s.tamanho_key), '[]'::jsonb)
      INTO v_linhas
      FROM public.modelo_skus s
     WHERE s.modelo_id = _modelo_id;
    RETURN jsonb_build_object('status', v_status, 'tamanho_tipo', v_tipo, 'tamanho_tipo_card', v_tipo_card,
                              'linhas', v_linhas, 'faltas', '[]'::jsonb, 'avisos', '[]'::jsonb);
  END IF;

  WITH c AS (
    SELECT * FROM public._skus_modelo_calc(_modelo_id)
  ), s AS (
    SELECT sk.id, sk.variante_key, sk.tamanho_key, sk.sku, sk.manual, sk.rev
      FROM public.modelo_skus sk
     WHERE sk.modelo_id = _modelo_id
  ), j AS (
    SELECT c.variante_key AS c_vkey, s.variante_key AS s_vkey, c.variante_ordem AS vordem, c.cor_nome, c.apelido_nome,
           coalesce(c.tamanho_key, s.tamanho_key) AS tkey, c.tamanho_ordem AS tordem, c.sku AS previsto,
           coalesce(c.faltas, '[]'::jsonb) AS faltas, coalesce(c.avisos, '[]'::jsonb) AS avisos, s.id AS sid, s.sku AS salvo, s.manual, s.rev
      FROM c
      FULL JOIN s ON s.variante_key = c.variante_key AND s.tamanho_key = c.tamanho_key
  ), k AS (
    SELECT j.*,
           -- o SKU GRAVADO divide com outra linha que não é réplica (REF viva) — ex.: a REF de um card mudou (R2-a)
           (SELECT jsonb_build_object('modelo_id', o.modelo_id, 'nome', mo.nome, 'ref', mo.ref)
              FROM public.modelo_skus o
              JOIN public.modelos mo ON mo.id = o.modelo_id
             WHERE o.tenant_id = v_tenant AND o.sku = j.salvo AND o.id <> j.sid
               AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                        AND o.variante_key = coalesce(j.c_vkey, j.s_vkey) AND o.tamanho_key = j.tkey)
             ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
             LIMIT 1) AS conflito_salvo,
           -- o SKU PREVISTO (o que a geração gravaria) já é de outra linha que não é réplica
           (SELECT jsonb_build_object('modelo_id', o.modelo_id, 'nome', mo.nome, 'ref', mo.ref)
              FROM public.modelo_skus o
              JOIN public.modelos mo ON mo.id = o.modelo_id
             WHERE o.tenant_id = v_tenant AND o.sku = j.previsto AND o.id IS DISTINCT FROM j.sid
               AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                        AND o.variante_key = j.c_vkey AND o.tamanho_key = j.tkey)
             ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
             LIMIT 1) AS conflito_prev
      FROM j
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'variante_key', coalesce(k.c_vkey, k.s_vkey), 'variante_ordem', k.vordem,
           'cor_nome', k.cor_nome, 'apelido_nome', k.apelido_nome,
           'tamanho_key', k.tkey, 'tamanho_ordem', k.tordem,
           'id', k.sid, 'sku', k.salvo, 'manual', coalesce(k.manual, false), 'rev', k.rev,
           'sku_previsto', k.previsto, 'faltas', k.faltas, 'avisos', k.avisos,
           'conflito_com', coalesce(k.conflito_salvo, k.conflito_prev),
           'estado', CASE
             WHEN k.c_vkey IS NULL THEN 'orfa'
             WHEN k.conflito_salvo IS NOT NULL THEN 'conflito'
             WHEN k.manual IS TRUE THEN 'manual'
             WHEN jsonb_array_length(k.faltas) > 0 THEN 'falta'
             WHEN k.previsto IS NULL THEN 'vazio'
             WHEN k.salvo = k.previsto THEN 'ok'
             WHEN k.conflito_prev IS NOT NULL THEN 'conflito'
             WHEN k.salvo IS NULL THEN 'pendente'
             ELSE 'divergente'
           END)
           ORDER BY k.vordem NULLS LAST, k.tordem NULLS LAST, k.tkey), '[]'::jsonb)
    INTO v_linhas
    FROM k;

  SELECT coalesce(jsonb_agg(DISTINCT f.value ORDER BY f.value), '[]'::jsonb)
    INTO v_faltas
    FROM jsonb_array_elements(v_linhas) AS l(value)
    CROSS JOIN LATERAL jsonb_array_elements(l.value -> 'faltas') AS f(value)
   WHERE l.value ->> 'estado' = 'falta';

  SELECT coalesce(jsonb_agg(DISTINCT a.value ORDER BY a.value), '[]'::jsonb)
    INTO v_avisos
    FROM jsonb_array_elements(v_linhas) AS l(value)
    CROSS JOIN LATERAL jsonb_array_elements(l.value -> 'avisos') AS a(value);

  RETURN jsonb_build_object('status', v_status, 'tamanho_tipo', v_tipo, 'tamanho_tipo_card', v_tipo_card,
                            'linhas', v_linhas, 'faltas', v_faltas, 'avisos', v_avisos);
END
$function$;

-- Gera (1ª vez: _regerar=false só cria o que falta) ou regera (_regerar=true: recalcula as AUTOMÁTICAS e remove
-- as automáticas que saíram da grade — D2). Linha manual: NUNCA tocada (Q2). Falta sigla: não gera a linha (Q4).
-- SKU já usado por OUTRA linha da loja (gatilho de unicidade, D5): não grava a linha e devolve em `conflitos`.
-- Devolve a MATRIZ (_skus_modelo_core) + criados/atualizados/removidos/conflitos.
CREATE OR REPLACE FUNCTION public._gerar_skus_modelo_core(_modelo_id uuid, _regerar boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  l record;
  v_id uuid;
  v_sku text;
  v_manual boolean;
  v_criados integer := 0;
  v_atualizados integer := 0;
  v_removidos integer := 0;
  v_conflitos jsonb := '[]'::jsonb;
  v_com_modelo uuid;
  v_com_nome text;
  v_com_ref text;
  v_com_vkey uuid;
  v_com_tkey text;
  v_com_sku_atual text;
  v_com_sku_novo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.modelos mo WHERE mo.id = _modelo_id) THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Uma geração/edição por modelo de cada vez (duas abas/pessoas no mesmo card esperam em fila). 1ª trava da ordem
  -- única (sku_modelo → linha → sku_unico): a edição à mão pega a MESMA antes de travar a linha — sem deadlock.
  -- Trava com o MÍNIMO (só _modelo_id, igual _salvar_sku_manual_core); REF e Formato só são lidos DEPOIS da trava,
  -- já sob a garantia de que ninguém mais gera/edita este modelo ao mesmo tempo.
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0));

  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config
    INTO v_tenant, v_refn, v_cfg
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;

  IF v_cfg IS NOT NULL AND v_refn <> '' THEN
    IF _regerar THEN
      -- Automáticas que saíram da grade (variante/cor removida, tamanho zerado) saem ANTES de gerar. Manual: nunca.
      DELETE FROM public.modelo_skus s
       WHERE s.modelo_id = _modelo_id
         AND NOT s.manual
         AND (s.variante_key, s.tamanho_key) NOT IN (
               SELECT c.variante_key, c.tamanho_key FROM public._skus_modelo_calc(_modelo_id) AS c);
      GET DIAGNOSTICS v_removidos = ROW_COUNT;
    END IF;

    FOR l IN SELECT c.variante_key, c.tamanho_key, c.sku
               FROM public._skus_modelo_calc(_modelo_id) AS c
              ORDER BY c.variante_ordem, c.tamanho_ordem, c.tamanho_key LOOP
      v_id := NULL;
      v_sku := NULL;
      v_manual := NULL;
      SELECT s.id, s.sku, s.manual INTO v_id, v_sku, v_manual
        FROM public.modelo_skus s
       WHERE s.modelo_id = _modelo_id AND s.variante_key = l.variante_key AND s.tamanho_key = l.tamanho_key;
      CONTINUE WHEN v_manual IS TRUE;                                          -- editado à mão: nunca (Q2)
      CONTINUE WHEN l.sku IS NULL;                                             -- falta sigla (Q4) / vazio
      CONTINUE WHEN v_id IS NOT NULL AND (NOT _regerar OR v_sku = l.sku);      -- fixo (Q2) ou já igual
      BEGIN
        IF v_id IS NULL THEN
          INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
          VALUES (v_tenant, _modelo_id, l.variante_key, l.tamanho_key, l.sku, false, now());
          v_criados := v_criados + 1;
        ELSE
          UPDATE public.modelo_skus SET sku = l.sku, gerado_em = now(), rev = rev + 1 WHERE id = v_id;
          v_atualizados := v_atualizados + 1;
        END IF;
      EXCEPTION WHEN unique_violation THEN
        v_com_modelo := NULL;
        v_com_nome := NULL;
        v_com_ref := NULL;
        v_com_vkey := NULL;
        v_com_tkey := NULL;
        v_com_sku_atual := NULL;
        v_com_sku_novo := NULL;
        SELECT o.modelo_id, mo.nome, mo.ref, o.variante_key, o.tamanho_key, o.sku
          INTO v_com_modelo, v_com_nome, v_com_ref, v_com_vkey, v_com_tkey, v_com_sku_atual
          FROM public.modelo_skus o
          JOIN public.modelos mo ON mo.id = o.modelo_id
         WHERE o.tenant_id = v_tenant AND o.sku = l.sku
           AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                    AND o.variante_key = l.variante_key AND o.tamanho_key = l.tamanho_key)
         ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
         LIMIT 1;
        -- Caso especial (troca de siglas A↔B no mesmo produto): a linha conflitante é OUTRA linha deste
        -- MESMO card que também vai mudar de SKU neste Regerar (ela ainda não passou pelo loop, ou o SKU
        -- novo dela é diferente do que está gravado hoje). Não são "duas linhas com o mesmo SKU" — é a
        -- ORDEM do Regerar que ainda não trocou a outra; a regra de unicidade continua barrando a troca
        -- (fica para a F3.5b), mas o texto não deve afirmar uma colisão de configuração que não existe.
        IF v_com_modelo = _modelo_id THEN
          SELECT c.sku INTO v_com_sku_novo
            FROM public._skus_modelo_calc(_modelo_id) AS c
           WHERE c.variante_key = v_com_vkey AND c.tamanho_key = v_com_tkey;
        END IF;
        v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
          'variante_key', l.variante_key, 'tamanho_key', l.tamanho_key, 'sku', l.sku,
          'com_modelo_id', v_com_modelo, 'com_nome', v_com_nome, 'com_ref', v_com_ref,
          'mensagem', CASE
            WHEN v_com_modelo IS NULL THEN
              format('SKU %s não gravado: outra pessoa gravou esta linha agora. Gere de novo.', l.sku)
            WHEN v_com_modelo = _modelo_id AND v_com_sku_novo IS NOT NULL AND v_com_sku_novo IS DISTINCT FROM v_com_sku_atual THEN
              format('SKU %s não gravado: esta linha colide com outra deste produto que também muda de SKU neste Regerar. Ajuste um SKU à mão e rode o Regerar de novo.', l.sku)
            WHEN v_com_modelo = _modelo_id THEN
              format('SKU %s repetido neste produto: duas linhas dão o mesmo SKU. Mude uma sigla ou edite um deles à mão.', l.sku)
            ELSE
              format('SKU %s já existe em %s (REF %s). Edite este SKU à mão ou mude a sigla.', l.sku,
                     coalesce(v_com_nome, 'outro produto'), coalesce(nullif(btrim(v_com_ref), ''), '—'))
          END));
      END;
    END LOOP;
  END IF;

  RETURN public._skus_modelo_core(_modelo_id)
      || jsonb_build_object('criados', v_criados, 'atualizados', v_atualizados, 'removidos', v_removidos,
                            'conflitos', v_conflitos);
END
$function$;

-- SKU à mão (R3): grava manual=true e normalizado (D6). Duas formas:
--   • `_id` = linha JÁ gravada (automática ou manual) → troca o SKU;
--   • `_id` NULL + (`_modelo_id`, `_variante_key`, `_tamanho_key`) = linha AINDA SEM SKU (em conflito, com falta de
--     sigla ou só pendente) → cria a linha manual, validada contra a grade atual (_skus_modelo_calc); se a tripla já
--     tem linha gravada, troca o SKU dela.
-- Mesma unicidade da geração (D5, REF viva). `_rev_base` (opcional, linha existente) = trava otimista (P0409).
-- Travas na MESMA ordem da geração (sku_modelo:<modelo> → a linha → sku_unico:<loja>): um Regerar e uma edição à mão
-- no mesmo card fazem fila, sem deadlock (NOTA do guardião), e duas criações da mesma linha não disputam a UNIQUE.
-- NÃO trava depois do envio à Explosão (spec §4.2: o SKU é identidade comercial do Planejamento).
CREATE OR REPLACE FUNCTION public._salvar_sku_manual_core(_id uuid, _sku text, _rev_base integer,
                                                          _modelo_id uuid, _variante_key uuid, _tamanho_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sku text;
  v_id uuid := _id;
  v_tenant uuid;
  v_modelo uuid;
  v_vkey uuid;
  v_tkey text;
  v_refn text;
  v_rev integer;
  v_com_modelo uuid;
  v_com_nome text;
  v_com_ref text;
BEGIN
  v_sku := public._sku_norm_manual(_sku);
  IF v_id IS NULL THEN
    IF _modelo_id IS NULL OR _variante_key IS NULL OR coalesce(btrim(_tamanho_key), '') = '' THEN
      RAISE EXCEPTION 'Informe a linha do SKU (modelo, variante e tamanho).' USING ERRCODE = 'P0001';
    END IF;
    v_modelo := _modelo_id;
  ELSE
    SELECT s.modelo_id INTO v_modelo FROM public.modelo_skus s WHERE s.id = v_id;
    IF v_modelo IS NULL THEN
      RAISE EXCEPTION 'SKU não encontrado.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || v_modelo::text, 0));
  IF v_id IS NULL THEN
    SELECT s.id INTO v_id
      FROM public.modelo_skus s
     WHERE s.modelo_id = _modelo_id AND s.variante_key = _variante_key AND s.tamanho_key = _tamanho_key;
    IF v_id IS NULL AND NOT EXISTS (
         SELECT 1 FROM public._skus_modelo_calc(_modelo_id) AS c
          WHERE c.variante_key = _variante_key AND c.tamanho_key = _tamanho_key) THEN
      RAISE EXCEPTION 'Esta variante/tamanho não está na grade do produto.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF v_id IS NOT NULL THEN
    SELECT s.tenant_id, s.rev, s.variante_key, s.tamanho_key INTO v_tenant, v_rev, v_vkey, v_tkey
      FROM public.modelo_skus s
     WHERE s.id = v_id
       FOR UPDATE;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'SKU não encontrado.' USING ERRCODE = 'P0001';
    END IF;
    IF _rev_base IS NOT NULL AND v_rev IS DISTINCT FROM _rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o SKU foi alterado por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
  ELSE
    SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = v_modelo;
    v_vkey := _variante_key;
    v_tkey := _tamanho_key;
  END IF;
  SELECT public._sku_norm_ref(mo.ref) INTO v_refn FROM public.modelos mo WHERE mo.id = v_modelo;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
      VALUES (v_tenant, v_modelo, v_vkey, v_tkey, v_sku, true, now())
      RETURNING id, rev INTO v_id, v_rev;
    ELSE
      UPDATE public.modelo_skus s
         SET sku = v_sku, manual = true, gerado_em = now(), rev = s.rev + 1
       WHERE s.id = v_id
      RETURNING s.rev INTO v_rev;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    SELECT o.modelo_id, mo.nome, mo.ref INTO v_com_modelo, v_com_nome, v_com_ref
      FROM public.modelo_skus o
      JOIN public.modelos mo ON mo.id = o.modelo_id
     WHERE o.tenant_id = v_tenant AND o.sku = v_sku AND o.id IS DISTINCT FROM v_id
       AND NOT (coalesce(v_refn, '') <> '' AND o.modelo_id <> v_modelo AND public._sku_norm_ref(mo.ref) = v_refn
                AND o.variante_key = v_vkey AND o.tamanho_key = v_tkey)
     ORDER BY (o.modelo_id = v_modelo) DESC, o.modelo_id
     LIMIT 1;
    IF v_com_modelo IS NULL THEN
      RAISE EXCEPTION 'conflito_versao: a linha do SKU foi gravada por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
    IF v_com_modelo = v_modelo THEN
      RAISE EXCEPTION 'O SKU % já está em outra linha deste produto.', v_sku USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'O SKU % já existe em % (REF %). Escolha outro.', v_sku, coalesce(v_com_nome, 'outro produto'),
      coalesce(nullif(btrim(v_com_ref), ''), '—') USING ERRCODE = 'P0001';
  END;
  RETURN jsonb_build_object('id', v_id, 'sku', v_sku, 'manual', true, 'rev', v_rev);
END
$function$;

-- ── Wrappers públicos (PostgREST) ──
CREATE OR REPLACE FUNCTION public.skus_modelo(_modelo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  PERFORM public._sku_guarda(v_tenant, false);
  RETURN public._skus_modelo_core(_modelo_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.gerar_skus_modelo(_modelo_id uuid, _regerar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  PERFORM public._sku_guarda(v_tenant, true);
  RETURN public._gerar_skus_modelo_core(_modelo_id, coalesce(_regerar, false));
END
$function$;

CREATE OR REPLACE FUNCTION public.salvar_sku_manual(_id uuid, _sku text, _rev_base integer DEFAULT NULL,
                                                    _modelo_id uuid DEFAULT NULL, _variante_key uuid DEFAULT NULL,
                                                    _tamanho_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF _id IS NOT NULL THEN
    SELECT s.tenant_id INTO v_tenant FROM public.modelo_skus s WHERE s.id = _id;
  ELSE
    SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = _modelo_id;
  END IF;
  PERFORM public._sku_guarda(v_tenant, true);
  RETURN public._salvar_sku_manual_core(_id, _sku, _rev_base, _modelo_id, _variante_key, _tamanho_key);
END
$function$;

-- Invariante #9 — revogar dos TRÊS; conferido por has_function_privilege (testes + G-migration).
REVOKE EXECUTE ON FUNCTION
  public._sku_guarda(uuid, boolean),
  public._skus_modelo_calc(uuid),
  public._skus_modelo_core(uuid),
  public._gerar_skus_modelo_core(uuid, boolean),
  public._salvar_sku_manual_core(uuid, text, integer, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION
  public.skus_modelo(uuid),
  public.gerar_skus_modelo(uuid, boolean),
  public.salvar_sku_manual(uuid, text, integer, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.skus_modelo(uuid),
  public.gerar_skus_modelo(uuid, boolean),
  public.salvar_sku_manual(uuid, text, integer, uuid, uuid, text)
  TO authenticated;

-- ==== [PARTE C] cálculo, RPCs e ACL entram ACIMA desta linha (Task 5) ====

-- ─────────────────────────── [B] Gatilhos, tabela modelo_skus, colunas e policies (POR ÚLTIMO) ───────────────────────────

-- Normalização da sigla NO SALVAR, no servidor (spec §4.1 + D6/R4). GATILHO (e não RPC) porque Cadastro > Atributos
-- grava cores/cores_apelido DIRETO pela API (AttributeTab: insert/update na tabela) — o gatilho cobre esse caminho E
-- qualquer outro (importação, SQL). DEFINER: chama o helper revogado (#9) sem depender do EXECUTE do usuário.
CREATE OR REPLACE FUNCTION public.fn_sigla_sku_normaliza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.sigla_sku := public._sku_norm_sigla(NEW.sigla_sku);
  RETURN NEW;
END
$function$;

-- tenant_config: valida/canoniza o Formato do SKU e as siglas de tamanho (mensagens PT, RAISE P0001). Só dispara
-- quando essas colunas estão no UPDATE — o upsert genérico da Config da Loja não as envia (não pesa nele).
CREATE OR REPLACE FUNCTION public.fn_tenant_config_sku_normaliza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.sku_config := public._sku_config_normaliza(NEW.sku_config);
  NEW.tamanhos_sku := public._sku_tamanhos_normaliza(NEW.tamanhos_sku);
  RETURN NEW;
END
$function$;

-- "Tamanho em" do produto comprado ANTES do card existir (spec §4.1): quando o produto ganha o modelo espelho
-- (modelo_id), o valor PASSA ao modelo (só se o modelo ainda não tem um) e sai do produto — com espelho, a fonte
-- ÚNICA é modelos.tamanho_tipo. Mesma loja obrigatória (produtos_importados não tem gatilho de loja do espelho).
CREATE OR REPLACE FUNCTION public.fn_produto_tamanho_tipo_handover()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.modelo_id IS NOT NULL AND NEW.tamanho_tipo IS NOT NULL THEN
    UPDATE public.modelos m
       SET tamanho_tipo = NEW.tamanho_tipo
     WHERE m.id = NEW.modelo_id
       AND m.tenant_id = NEW.tenant_id
       AND m.tamanho_tipo IS NULL;
    NEW.tamanho_tipo := NULL;
  END IF;
  RETURN NEW;
END
$function$;

-- Unicidade do SKU na loja (D5/R2 — PENDENTE DO DONO; implementada a recomendação do guardião): um SKU só pode
-- repetir entre cards DIFERENTES com a MESMA REF e a MESMA linha (cor + tamanho) — é a réplica/versão do mesmo
-- produto, que o ERP/e-commerce vê como o mesmo SKU. "Mesma REF" = a REF VIVA dos dois cards (modelos.ref AGORA,
-- normalizada por _sku_norm_ref) e não vazia — nunca uma cópia guardada no SKU (R2-a: cópia fica velha quando a REF
-- do card muda). Qualquer outro SKU igual (outra REF, outra linha, duas linhas do mesmo card, card sem REF) = RAISE
-- 23505 (unique_violation), que a geração captura como `conflitos[]` e a edição manual traduz em PT.
-- Travas (ordem única em toda escrita de SKU — sem deadlock): sku_modelo:<modelo> (geração/edição) → a linha →
-- sku_unico:<loja> (AQUI, lock consultivo por loja: sem ele duas transações passariam juntas pela checagem).
-- Trocar a REF de um card NÃO revalida os SKUs já gravados (sem gatilho em modelos — tabela quente; travaria o Salvar
-- do card): a leitura (_skus_modelo_core) compara com a REF viva e marca `conflito` nos DOIS cards na hora, e a próxima
-- gravação da linha passa por aqui de novo.
-- Variante B da D5 ("SKU próprio da versão"): tirar a exceção `AND NOT (…)` abaixo = unicidade estrita por loja.
CREATE OR REPLACE FUNCTION public.fn_modelo_skus_unico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ref text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_unico:' || NEW.tenant_id::text, 0));
  SELECT public._sku_norm_ref(m.ref) INTO v_ref FROM public.modelos m WHERE m.id = NEW.modelo_id;
  PERFORM 1
     FROM public.modelo_skus o
     JOIN public.modelos mo ON mo.id = o.modelo_id
    WHERE o.tenant_id = NEW.tenant_id
      AND o.sku = NEW.sku
      AND o.id <> NEW.id
      AND NOT (coalesce(v_ref, '') <> '' AND o.modelo_id <> NEW.modelo_id
               AND public._sku_norm_ref(mo.ref) = v_ref
               AND o.variante_key = NEW.variante_key AND o.tamanho_key = NEW.tamanho_key);
  IF FOUND THEN
    RAISE EXCEPTION 'O SKU % já está em uso na loja.', NEW.sku USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE EXECUTE ON FUNCTION
  public.fn_sigla_sku_normaliza(),
  public.fn_tenant_config_sku_normaliza(),
  public.fn_produto_tamanho_tipo_handover(),
  public.fn_modelo_skus_unico()
  FROM PUBLIC, anon, authenticated;

-- SKUs gravados (1 linha por modelo × variante(cor) × tamanho). UNIQUE COMPOSTA (segura p/ o PostgREST — regra "O que
-- NÃO fazer") em (modelo_id, variante_key, tamanho_key) = 1 SKU por linha (e índice por modelo_id). O SKU igual na
-- loja é barrado pelo gatilho acima (D5, REF viva), com o índice (tenant_id, sku) para a busca. SEM cópia da REF aqui
-- (R2-a). Escrita SÓ pelas RPCs DEFINER: `authenticated` só tem SELECT (RLS por loja).
CREATE TABLE IF NOT EXISTS public.modelo_skus (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id),
  modelo_id    uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  variante_key uuid NOT NULL,
  tamanho_key  text NOT NULL,
  sku          text NOT NULL CONSTRAINT modelo_skus_sku_chk CHECK (btrim(sku) <> ''),
  manual       boolean NOT NULL DEFAULT false,
  gerado_em    timestamptz NOT NULL DEFAULT now(),
  rev          integer NOT NULL DEFAULT 0,
  CONSTRAINT modelo_skus_modelo_variante_tamanho_key UNIQUE (modelo_id, variante_key, tamanho_key)
);
CREATE INDEX IF NOT EXISTS idx_modelo_skus_tenant_sku ON public.modelo_skus (tenant_id, sku);
COMMENT ON TABLE public.modelo_skus IS
  'SKU por modelo × variante × tamanho (F3.5a). Escrita só por gerar_skus_modelo/salvar_sku_manual. variante_key = _sku_variante_key(cor base, cor apelido) (R1: estável entre saves; mesma cor no card = 1 linha, D7); tamanho_key = chave inteira da grade ("34|PPP"). manual=true nunca é sobrescrito. SKU repetido só entre réplicas (REF viva igual e mesma linha) — gatilho fn_modelo_skus_unico (D5).';
DROP TRIGGER IF EXISTS trg_modelo_skus_unico ON public.modelo_skus;
CREATE TRIGGER trg_modelo_skus_unico BEFORE INSERT OR UPDATE OF tenant_id, modelo_id, variante_key, tamanho_key, sku
  ON public.modelo_skus FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_skus_unico();
REVOKE ALL ON public.modelo_skus FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.modelo_skus TO authenticated;
ALTER TABLE public.modelo_skus ENABLE ROW LEVEL SECURITY;

-- Colunas (AccessExclusive curto em cada tabela — por isso no FIM do arquivo).
ALTER TABLE public.cores ADD COLUMN IF NOT EXISTS sigla_sku text;
COMMENT ON COLUMN public.cores.sigla_sku IS 'Sigla da cor base no SKU (F3.5a). Normalizada no salvar (sem acento, só A–Z/0–9, maiúsculas; vazia = NULL).';
DROP TRIGGER IF EXISTS trg_cores_sigla_sku ON public.cores;
CREATE TRIGGER trg_cores_sigla_sku BEFORE INSERT OR UPDATE OF sigla_sku ON public.cores
  FOR EACH ROW EXECUTE FUNCTION public.fn_sigla_sku_normaliza();

ALTER TABLE public.cores_apelido ADD COLUMN IF NOT EXISTS sigla_sku text;
COMMENT ON COLUMN public.cores_apelido.sigla_sku IS 'Sigla da cor apelido no SKU (F3.5a). Normalizada no salvar (sem acento, só A–Z/0–9, maiúsculas; vazia = NULL).';
DROP TRIGGER IF EXISTS trg_cores_apelido_sigla_sku ON public.cores_apelido;
CREATE TRIGGER trg_cores_apelido_sigla_sku BEFORE INSERT OR UPDATE OF sigla_sku ON public.cores_apelido
  FOR EACH ROW EXECUTE FUNCTION public.fn_sigla_sku_normaliza();

ALTER TABLE public.produtos_acabados ADD COLUMN IF NOT EXISTS tamanho_tipo text;
ALTER TABLE public.produtos_importados ADD COLUMN IF NOT EXISTS tamanho_tipo text;
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS tamanho_tipo text;
-- CHECK letra|numero como NOT VALID: vale para toda escrita nova e evita varrer a tabela sob AccessExclusive (todas as
-- linhas existentes são NULL — nada a validar).
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produtos_acabados_tamanho_tipo_chk'
                  AND conrelid = 'public.produtos_acabados'::regclass) THEN
    ALTER TABLE public.produtos_acabados
      ADD CONSTRAINT produtos_acabados_tamanho_tipo_chk CHECK (tamanho_tipo IN ('letra', 'numero')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produtos_importados_tamanho_tipo_chk'
                  AND conrelid = 'public.produtos_importados'::regclass) THEN
    ALTER TABLE public.produtos_importados
      ADD CONSTRAINT produtos_importados_tamanho_tipo_chk CHECK (tamanho_tipo IN ('letra', 'numero')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'modelos_tamanho_tipo_chk'
                  AND conrelid = 'public.modelos'::regclass) THEN
    ALTER TABLE public.modelos
      ADD CONSTRAINT modelos_tamanho_tipo_chk CHECK (tamanho_tipo IN ('letra', 'numero')) NOT VALID;
  END IF;
END
$do$;
COMMENT ON COLUMN public.modelos.tamanho_tipo IS '"Tamanho em" do card (F3.5): letra | numero; NULL = padrão da loja (tenant_config.sku_config.tamanho_padrao).';
DROP TRIGGER IF EXISTS trg_pa_tamanho_tipo ON public.produtos_acabados;
CREATE TRIGGER trg_pa_tamanho_tipo BEFORE INSERT OR UPDATE OF modelo_id, tamanho_tipo ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public.fn_produto_tamanho_tipo_handover();
DROP TRIGGER IF EXISTS trg_pi_tamanho_tipo ON public.produtos_importados;
CREATE TRIGGER trg_pi_tamanho_tipo BEFORE INSERT OR UPDATE OF modelo_id, tamanho_tipo ON public.produtos_importados
  FOR EACH ROW EXECUTE FUNCTION public.fn_produto_tamanho_tipo_handover();

-- tenant_config (as policies RLS de todas as lojas leem esta tabela): UM só ALTER.
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS tamanhos_sku jsonb,
  ADD COLUMN IF NOT EXISTS sku_config jsonb;
COMMENT ON COLUMN public.tenant_config.tamanhos_sku IS 'Sigla SKU de CADA LADO dos pares da grade ({"34":"34","PPP":"PPP"}) — F3.5a. tamanhos_grade não muda.';
COMMENT ON COLUMN public.tenant_config.sku_config IS 'Formato do SKU {partes, separadores {"a|b": sep}, tamanho_padrao} — F3.5a. NULL = a loja não gera SKU.';
DROP TRIGGER IF EXISTS trg_tenant_config_sku ON public.tenant_config;
CREATE TRIGGER trg_tenant_config_sku BEFORE INSERT OR UPDATE OF sku_config, tamanhos_sku ON public.tenant_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_tenant_config_sku_normaliza();

-- Policies de modelo_skus POR ÚLTIMO: todo CREATE/DROP POLICY como `postgres` dispara o hook
-- supautils.policy_grants, que trava ~24 tabelas de auth/storage/realtime até o COMMIT (login/refresh esperam).
-- RLS por loja no SELECT + modgate RESTRICTIVE do `criacao` em escrita (padrão de modelo_grades; defesa em profundidade).
DROP POLICY IF EXISTS tenant_select ON public.modelo_skus;
CREATE POLICY tenant_select ON public.modelo_skus FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS modgate_ins ON public.modelo_skus;
CREATE POLICY modgate_ins ON public.modelo_skus AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.tenant_module_enabled('criacao'));
DROP POLICY IF EXISTS modgate_upd ON public.modelo_skus;
CREATE POLICY modgate_upd ON public.modelo_skus AS RESTRICTIVE FOR UPDATE
  USING (public.tenant_module_enabled('criacao'));
DROP POLICY IF EXISTS modgate_del ON public.modelo_skus;
CREATE POLICY modgate_del ON public.modelo_skus AS RESTRICTIVE FOR DELETE
  USING (public.tenant_module_enabled('criacao'));

-- ==== [PARTE B] tabela, colunas, gatilhos e policies entram ACIMA desta linha (Task 4) ====

NOTIFY pgrst, 'reload schema';

COMMIT;
