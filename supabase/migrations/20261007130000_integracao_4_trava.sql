-- Integração + API — 4/6: TRAVA NO BANCO (spec §8; P-62 A, P-73 A, B1, B2, R8, R9, V2, nota 14).
-- Com o produto integrável/integrado, gatilhos BEFORE `trg_zz_integracao_trava` (ÚLTIMOS na ordem alfabética, depois de
-- ref_auto/markup/mo_flag/preco_venda_gate/kanban_status_guard; SECURITY DEFINER; nunca ENABLE ALWAYS — o reset_loja roda
-- em replica) recusam MUDANÇA REAL (IS DISTINCT FROM, o Sheet do Dev manda nome/ref/fotos em todo save e passa — R9):
--   modelos: tamanho_tipo SEMPRE + as colunas dos campos marcados no retrato; DELETE sempre (R8);
--   modelo_skus: INSERT/DELETE e UPDATE com mudança, SEMPRE (B2);
--   produtos_acabados/importados: DELETE e desvincular sempre; nome/ref/foto_url conforme marcado; preco_varejo_fixo
--   DEFINIDO com valor novo quando "Preço de venda" marcado (D12 — limpar via markup passa);
--   variantes do espelho: CONSTRAINT TRIGGER ADIADO p/ o COMMIT compara o CONJUNTO de cores (D11 — o save do PA/PI
--   apaga e recria as variantes: o mesmo conjunto regravado passa; qtd/peso livres).
-- Mensagem: 42501 'integracao_travado: <campo>' (ASCII). Destravar = só integracao_voltar/desfazer (mudam o ESTADO; sem GUC).
-- V2: a sincronização da foto do PA/PI p/ o card ganha WHEN (só quando foto_url ou o vínculo MUDA).
-- B1: _pa_recomputar_precos_modelo e _imp_recomputar_precos_modelo NÃO gravam preco_venda do travado com "Preço de venda"
-- marcado (receber OC / salvar OC / markup / preço fixo / MO seguem funcionando). Diff mínimo (TRECHO_B1) na suíte.
--
-- Ruling do controlador (carry T3→T4, revisão da Task 3 #Important-1): integracao_marcar serializa com a edição do card
-- via `modelos FOR NO KEY UPDATE` e com os gravadores de SKU via `pg_advisory_xact_lock('sku_modelo:'||id)` — mas
-- `salvar_produto_acabado`/`salvar_produto_importado` (que apagam/recriam produto_acabado_variantes/
-- produto_importado_variantes e regravam nome/ref/foto_url/preco_varejo_fixo) NÃO tomam nenhuma das duas travas: uma
-- troca de variante/campo do espelho concorrente com um marcar em andamento não é bloqueada por ele, e a leitura de
-- integracao_produtos por EXISTS puro dentro das funções de trava também não veria a linha 'integravel' que marcar
-- ainda não commitou (read committed). Fix MÍNIMO: fn_integracao_trava_espelho (trigger comum em produtos_acabados/
-- produtos_importados) e fn_integracao_trava_variantes (constraint trigger adiado nas variantes do espelho) tomam
-- `SELECT 1 FROM public.modelos WHERE id = <modelo_id> FOR SHARE` ANTES de ler integracao_produtos — FOR SHARE
-- CONFLITA com o FOR NO KEY UPDATE que marcar toma sobre a MESMA linha de modelos (fila serializada; SHARE x SHARE não
-- conflita entre concorrentes, então 2 saves do espelho não se travam mutuamente), sem mudar nenhum resultado das
-- travas em si (mesmas condições IS DISTINCT FROM de sempre). fn_integracao_trava_modelos/fn_integracao_trava_modelos_del
-- e fn_integracao_trava_skus não precisam do FOR SHARE extra: a 1ª já roda sobre a PRÓPRIA linha de modelos (o UPDATE
-- que a disparou já pediu a trava de linha nela); a 2ª está coberta pela MESMA advisory lock 'sku_modelo:<id>' que TODO
-- gravador de modelo_skus (geração/edição manual) e agora também marcar tomam, na mesma ordem — sem gap.
-- Contagens: +6 funções (2 redefinidas não contam) | +9 gatilhos (7 novos + foto: -2 +4).
-- Inverso: supabase/rollback/20261007130000_integracao_4_trava_down.sql (SÓ depois do inverso 5).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_pa text := pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure);
  v_imp text := pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure);
BEGIN
  IF to_regprocedure('public.integracao_marcar(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'integracao_4: aplique a migration 3 antes' USING ERRCODE = 'P0001';
  END IF;
  IF md5(v_pa) <> '72c96c624de8f4530c862d8abb6a1283' AND position('[integracao v1]' IN v_pa) = 0 THEN
    RAISE EXCEPTION 'integracao_4: _pa_recomputar_precos_modelo com texto inesperado (md5 %)', md5(v_pa) USING ERRCODE = 'P0001';
  END IF;
  IF md5(v_imp) <> '5baca24d0de45b8c5f291fef39472238' AND position('[integracao v1]' IN v_imp) = 0 THEN
    RAISE EXCEPTION 'integracao_4: _imp_recomputar_precos_modelo com texto inesperado (md5 %)', md5(v_imp) USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._sync_foto_modelo_do_produto()') IS NULL THEN
    RAISE EXCEPTION 'integracao_4: _sync_foto_modelo_do_produto ausente' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_campo_travado(_modelo_id uuid, _campo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.integracao_produtos ip
                  WHERE ip.modelo_id = _modelo_id AND ip.estado IN ('integravel', 'integrado') AND _campo = ANY(ip.campos))
$function$;
REVOKE EXECUTE ON FUNCTION public._integracao_campo_travado(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_integracao_trava_modelos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campos text[];
BEGIN
  SELECT ip.campos INTO v_campos FROM public.integracao_produtos ip
   WHERE ip.modelo_id = OLD.id AND ip.estado IN ('integravel', 'integrado');
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  -- B2 / m085: o "Tamanho em" forma as sublinhas — trava SEMPRE
  IF NEW.tamanho_tipo IS DISTINCT FROM OLD.tamanho_tipo THEN
    RAISE EXCEPTION 'integracao_travado: tamanho_tipo' USING ERRCODE = '42501';
  END IF;
  IF 'nome' = ANY(v_campos) AND NEW.nome IS DISTINCT FROM OLD.nome THEN
    RAISE EXCEPTION 'integracao_travado: nome' USING ERRCODE = '42501';
  END IF;
  IF 'ref_sku' = ANY(v_campos) AND NEW.ref IS DISTINCT FROM OLD.ref THEN
    RAISE EXCEPTION 'integracao_travado: ref_sku' USING ERRCODE = '42501';
  END IF;
  IF 'preco_anterior' = ANY(v_campos) AND NEW.preco_anterior IS DISTINCT FROM OLD.preco_anterior THEN
    RAISE EXCEPTION 'integracao_travado: preco_anterior' USING ERRCODE = '42501';
  END IF;
  IF 'preco_venda' = ANY(v_campos) AND NEW.preco_venda IS DISTINCT FROM OLD.preco_venda THEN
    RAISE EXCEPTION 'integracao_travado: preco_venda' USING ERRCODE = '42501';
  END IF;
  IF 'peso' = ANY(v_campos) AND NEW.peso_kg IS DISTINCT FROM OLD.peso_kg THEN
    RAISE EXCEPTION 'integracao_travado: peso' USING ERRCODE = '42501';
  END IF;
  IF 'ncm' = ANY(v_campos) AND NEW.ncm IS DISTINCT FROM OLD.ncm THEN
    RAISE EXCEPTION 'integracao_travado: ncm' USING ERRCODE = '42501';
  END IF;
  IF 'titulo' = ANY(v_campos) AND NEW.titulo_pagina IS DISTINCT FROM OLD.titulo_pagina THEN
    RAISE EXCEPTION 'integracao_travado: titulo' USING ERRCODE = '42501';
  END IF;
  IF ('descricao' = ANY(v_campos) OR 'metatag' = ANY(v_campos)) AND NEW.descricao_produto IS DISTINCT FROM OLD.descricao_produto THEN
    RAISE EXCEPTION 'integracao_travado: descricao' USING ERRCODE = '42501';
  END IF;
  IF 'comprimento' = ANY(v_campos) AND NEW.comprimento_cm IS DISTINCT FROM OLD.comprimento_cm THEN
    RAISE EXCEPTION 'integracao_travado: comprimento' USING ERRCODE = '42501';
  END IF;
  IF 'largura' = ANY(v_campos) AND NEW.largura_cm IS DISTINCT FROM OLD.largura_cm THEN
    RAISE EXCEPTION 'integracao_travado: largura' USING ERRCODE = '42501';
  END IF;
  IF 'altura' = ANY(v_campos) AND NEW.altura_cm IS DISTINCT FROM OLD.altura_cm THEN
    RAISE EXCEPTION 'integracao_travado: altura' USING ERRCODE = '42501';
  END IF;
  IF 'foto' = ANY(v_campos) AND NEW.fotos_modelo IS DISTINCT FROM OLD.fotos_modelo THEN
    RAISE EXCEPTION 'integracao_travado: foto' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_integracao_trava_modelos_del()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- R8: excluir produto integrável/integrado é recusado até voltar/desfazer (o CASCADE de modelo_skus nunca chega a rodar)
  IF EXISTS (SELECT 1 FROM public.integracao_produtos ip
              WHERE ip.modelo_id = OLD.id AND ip.estado IN ('integravel', 'integrado')) THEN
    RAISE EXCEPTION 'integracao_travado: excluir' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_integracao_trava_skus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.modelo_id IS NOT DISTINCT FROM OLD.modelo_id AND NEW.variante_key IS NOT DISTINCT FROM OLD.variante_key
       AND NEW.tamanho_key IS NOT DISTINCT FROM OLD.tamanho_key AND NEW.sku IS NOT DISTINCT FROM OLD.sku
       AND NEW.manual IS NOT DISTINCT FROM OLD.manual THEN
      RETURN NEW;  -- R9: regravar igual passa
    END IF;
    v_ids := ARRAY[OLD.modelo_id, NEW.modelo_id];
  ELSIF TG_OP = 'INSERT' THEN
    v_ids := ARRAY[NEW.modelo_id];
  ELSE
    v_ids := ARRAY[OLD.modelo_id];
  END IF;
  -- B2: as linhas de SKU travam SEMPRE (marcado ou não). Serialização com os gravadores de SKU: TODOS eles
  -- (_gerar_skus_modelo_core/_aplicar_skus_modelo_core/_salvar_sku_manual_core) e o integracao_marcar tomam a MESMA
  -- pg_advisory_xact_lock('sku_modelo:'||modelo_id) antes de tocar modelo_skus — este trigger roda DENTRO da escrita
  -- de um gravador que já segura essa trava (ou dentro do marcar, que também a segura antes de checar o estado), então
  -- a leitura de integracao_produtos abaixo já enxerga qualquer marcar cuja trava concorrente já tenha sido liberada
  -- (serializados pela MESMA chave) — sem gap adicional a fechar aqui.
  IF EXISTS (SELECT 1 FROM public.integracao_produtos ip
              WHERE ip.modelo_id = ANY(v_ids) AND ip.estado IN ('integravel', 'integrado')) THEN
    RAISE EXCEPTION 'integracao_travado: sku' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_integracao_trava_espelho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campos text[];
BEGIN
  IF OLD.modelo_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  -- Carry T3->T4 (ruling do controlador): FOR SHARE em modelos ANTES de ler integracao_produtos — conflita com o
  -- FOR NO KEY UPDATE que integracao_marcar toma sobre a MESMA linha, serializando este save do espelho com um
  -- marcar concorrente (salvar_produto_acabado/salvar_produto_importado nunca travavam `modelos`).
  PERFORM 1 FROM public.modelos WHERE id = OLD.modelo_id FOR SHARE;
  SELECT ip.campos INTO v_campos FROM public.integracao_produtos ip
   WHERE ip.modelo_id = OLD.modelo_id AND ip.estado IN ('integravel', 'integrado');
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- delta item 3: _excluir_produto_*_core apagaria foto e cores travadas (FK SET NULL)
    RAISE EXCEPTION 'integracao_travado: excluir' USING ERRCODE = '42501';
  END IF;
  IF NEW.modelo_id IS DISTINCT FROM OLD.modelo_id THEN
    RAISE EXCEPTION 'integracao_travado: vinculo' USING ERRCODE = '42501';
  END IF;
  IF 'nome' = ANY(v_campos) AND NEW.nome IS DISTINCT FROM OLD.nome THEN
    RAISE EXCEPTION 'integracao_travado: nome' USING ERRCODE = '42501';
  END IF;
  IF 'ref_sku' = ANY(v_campos) AND NEW.ref IS DISTINCT FROM OLD.ref THEN
    RAISE EXCEPTION 'integracao_travado: ref_sku' USING ERRCODE = '42501';
  END IF;
  IF 'foto' = ANY(v_campos) AND NEW.foto_url IS DISTINCT FROM OLD.foto_url THEN
    RAISE EXCEPTION 'integracao_travado: foto' USING ERRCODE = '42501';
  END IF;
  -- delta item 4 / D12: DEFINIR preço fixo novo = edição explícita do preço → recusa; limpar (markup) passa
  IF 'preco_venda' = ANY(v_campos) AND NEW.preco_varejo_fixo IS NOT NULL
     AND NEW.preco_varejo_fixo IS DISTINCT FROM OLD.preco_varejo_fixo THEN
    RAISE EXCEPTION 'integracao_travado: preco_venda' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_integracao_trava_variantes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- TG_ARGV: [0] tabela do produto, [1] coluna FK nas variantes, [2] tabela das variantes
  v_prod uuid;
  v_modelo uuid;
  v_esperado uuid[];
  v_atual uuid[];
BEGIN
  v_prod := (to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END) ->> TG_ARGV[1])::uuid;
  EXECUTE format('SELECT p.modelo_id FROM public.%I p WHERE p.id = $1', TG_ARGV[0]) INTO v_modelo USING v_prod;
  IF v_modelo IS NULL THEN
    RETURN NULL;
  END IF;
  -- Carry T3->T4 (ruling do controlador, mesmo fix de fn_integracao_trava_espelho): FOR SHARE em modelos ANTES de
  -- ler integracao_produtos — este é um CONSTRAINT TRIGGER ADIADO (roda no COMMIT da txn que apagou/recriou as
  -- variantes), então o FOR SHARE aqui serializa contra um integracao_marcar que ainda esteja segurando o
  -- FOR NO KEY UPDATE da MESMA linha de modelos (fila; sem mudar o resultado da comparação de conjunto abaixo).
  PERFORM 1 FROM public.modelos WHERE id = v_modelo FOR SHARE;
  SELECT ip.variantes_chaves INTO v_esperado FROM public.integracao_produtos ip
   WHERE ip.modelo_id = v_modelo AND ip.estado IN ('integravel', 'integrado');
  IF NOT FOUND OR v_esperado IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT ARRAY(SELECT DISTINCT public._sku_variante_key(v.cor_id, v.cor_apelido_id) FROM public.%I v WHERE v.%I = $1 ORDER BY 1)',
                 TG_ARGV[2], TG_ARGV[1]) INTO v_atual USING v_prod;
  IF v_atual IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'integracao_travado: variantes' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE TRIGGER trg_zz_integracao_trava BEFORE UPDATE ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_trava_modelos();
CREATE OR REPLACE TRIGGER trg_zz_integracao_trava_del BEFORE DELETE ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_trava_modelos_del();
CREATE OR REPLACE TRIGGER trg_zz_integracao_trava BEFORE INSERT OR UPDATE OR DELETE ON public.modelo_skus
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_trava_skus();
CREATE OR REPLACE TRIGGER trg_zz_integracao_trava BEFORE UPDATE OR DELETE ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_trava_espelho();
CREATE OR REPLACE TRIGGER trg_zz_integracao_trava BEFORE UPDATE OR DELETE ON public.produtos_importados
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_trava_espelho();
DROP TRIGGER IF EXISTS trg_zz_integracao_trava_var ON public.produto_acabado_variantes;
CREATE CONSTRAINT TRIGGER trg_zz_integracao_trava_var AFTER INSERT OR UPDATE OR DELETE ON public.produto_acabado_variantes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.fn_integracao_trava_variantes('produtos_acabados', 'produto_acabado_id', 'produto_acabado_variantes');
DROP TRIGGER IF EXISTS trg_zz_integracao_trava_var ON public.produto_importado_variantes;
CREATE CONSTRAINT TRIGGER trg_zz_integracao_trava_var AFTER INSERT OR UPDATE OR DELETE ON public.produto_importado_variantes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.fn_integracao_trava_variantes('produtos_importados', 'produto_importado_id', 'produto_importado_variantes');

-- V2: a foto do PA/PI só vira capa do card quando MUDA (ou quando o card é vinculado) — o save que regrava a mesma
-- foto_url não desfaz mais a remoção/reordenação feita no card ou na Integração.
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_acabado AFTER INSERT ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public._sync_foto_modelo_do_produto();
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_acabado_upd AFTER UPDATE OF foto_url, modelo_id ON public.produtos_acabados
  FOR EACH ROW WHEN (OLD.foto_url IS DISTINCT FROM NEW.foto_url OR OLD.modelo_id IS DISTINCT FROM NEW.modelo_id)
  EXECUTE FUNCTION public._sync_foto_modelo_do_produto();
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_importado AFTER INSERT ON public.produtos_importados
  FOR EACH ROW EXECUTE FUNCTION public._sync_foto_modelo_do_produto();
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_importado_upd AFTER UPDATE OF foto_url, modelo_id ON public.produtos_importados
  FOR EACH ROW WHEN (OLD.foto_url IS DISTINCT FROM NEW.foto_url OR OLD.modelo_id IS DISTINCT FROM NEW.modelo_id)
  EXECUTE FUNCTION public._sync_foto_modelo_do_produto();

-- B1 — revenda (antes = md5 72c96c62…; depois = antes + TRECHO_B1)
CREATE OR REPLACE FUNCTION public._pa_recomputar_precos_modelo(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modelo_id uuid;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_preco_atacado_fixo numeric;
  v_preco_varejo_fixo numeric;
  v_insumos numeric := 0;
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.valor_unitario, p.desconto_pct, p.markup_atacado, p.markup_varejo,
         p.preco_atacado_fixo, p.preco_varejo_fixo
    into v_modelo_id, v_valor_unitario, v_desconto_pct, v_markup_atacado, v_markup_varejo,
         v_preco_atacado_fixo, v_preco_varejo_fixo
    from public.produtos_acabados p where p.id = _produto_id;

  if v_modelo_id is null then
    return; -- sem espelho no Planejamento ainda — nada a recomputar
  end if;

  select coalesce(sum(me.consumo * me.custo_previsto), 0) into v_insumos
    from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;

  -- MO na base (mesma fonte modelo_servico_mo do card do Planejamento; BRL por peça).
  select coalesce(sum(s.valor), 0) into v_mao_obra
    from public.modelo_servico_mo s where s.modelo_id = v_modelo_id;

  v_custo := coalesce(v_valor_unitario, 0) * (1 - coalesce(v_desconto_pct, 0) / 100.0) + v_insumos + v_mao_obra;

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  -- Preço FIXO manda; senão deriva do markup (base × markup); senão NULL (sem markup nem fixo = não há
  -- preço — NÃO manter o valor antigo, que vira lixo exibido como "fixado" que o usuário nunca digitou).
  v_preco_atacado := case
    when v_preco_atacado_fixo is not null then v_preco_atacado_fixo
    when v_markup_atacado is not null then round(v_custo * v_markup_atacado, 2)
    else null end;
  -- VAREJO INDEPENDENTE: base(custo) × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case
    when v_preco_varejo_fixo is not null then v_preco_varejo_fixo
    when v_markup_varejo is not null then round(v_custo * v_markup_varejo, 2)
    else null end;

  -- [integracao v1] B1: produto travado pela Integração com "Preço de venda" marcado — o recálculo automático (OC, MO,
  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.
  if public._integracao_campo_travado(v_modelo_id, 'preco_venda') then
    v_preco_venda := v_venda_atual;
  end if;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end;
$function$;

-- B1 — importado (antes = md5 5baca24d…; depois = antes + TRECHO_B1)
CREATE OR REPLACE FUNCTION public._imp_recomputar_precos_modelo(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modelo_id uuid;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_preco_atacado_fixo numeric;
  v_preco_varejo_fixo numeric;
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.markup_atacado, p.markup_varejo, p.preco_atacado_fixo, p.preco_varejo_fixo
    into v_modelo_id, v_markup_atacado, v_markup_varejo, v_preco_atacado_fixo, v_preco_varejo_fixo
    from public.produtos_importados p where p.id = _produto_id;
  if v_modelo_id is null then
    return; -- sem espelho ainda
  end if;

  -- MO na base (mesma fonte modelo_servico_mo; BRL por peça — soma limpa ao landed, já em BRL).
  select coalesce(sum(s.valor), 0) into v_mao_obra
    from public.modelo_servico_mo s where s.modelo_id = v_modelo_id;

  v_custo := public._imp_custo_landed(_produto_id) + v_mao_obra;

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  v_preco_atacado := case
    when v_preco_atacado_fixo is not null then v_preco_atacado_fixo
    when v_markup_atacado is not null and v_markup_atacado > 0 then round(v_custo * v_markup_atacado, 2)
    else null end;
  -- VAREJO INDEPENDENTE: custo landed × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case
    when v_preco_varejo_fixo is not null then v_preco_varejo_fixo
    when v_markup_varejo is not null and v_markup_varejo > 0 then round(v_custo * v_markup_varejo, 2)
    else null end;

  -- [integracao v1] B1: produto travado pela Integração com "Preço de venda" marcado — o recálculo automático (OC, MO,
  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.
  if public._integracao_campo_travado(v_modelo_id, 'preco_venda') then
    v_preco_venda := v_venda_atual;
  end if;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end $function$;

DO $pos$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_zz_integracao_trava', 'trg_zz_integracao_trava_del',
        'trg_zz_integracao_trava_var', 'trg_sync_foto_modelo_acabado_upd', 'trg_sync_foto_modelo_importado_upd')) <> 9 THEN
    RAISE EXCEPTION 'integracao_4: gatilhos da trava incompletos' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%' AND tgenabled <> 'O') THEN
    RAISE EXCEPTION 'integracao_4: gatilho de trava fora do modo padrao (nunca ENABLE ALWAYS)' USING ERRCODE = 'P0001';
  END IF;
  IF position('[integracao v1]' IN pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure)) = 0
     OR position('[integracao v1]' IN pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'integracao_4: recalculos sem o trecho B1' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('authenticated', 'public._integracao_campo_travado(uuid,text)', 'EXECUTE')
     OR has_function_privilege('public', 'public._integracao_campo_travado(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'integracao_4: _integracao_campo_travado executavel (inv. 9)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
