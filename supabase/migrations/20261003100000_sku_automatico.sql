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
