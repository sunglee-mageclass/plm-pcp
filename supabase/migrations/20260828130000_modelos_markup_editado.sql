-- Pacote E — Markup editável por modelo (Formação de Preço): modelos.markup_editado.
--
-- SEMÂNTICA "CONGELA" (decisão do dono): cada modelo guarda o PRÓPRIO markup ("Markup
-- aplicado", o que forma o Preço/Preço sugerido). Ele NASCE com o markup da linha do
-- Cadastro (`linhas.markup`) e NÃO acompanha mudanças futuras do Cadastro — modelo criado
-- com 2,0 mantém 2,0 mesmo que a linha vá pra 2,5; só modelos novos nascem com 2,5.
-- NULL ≠ "acompanha ao vivo": é só "sem valor" (modelo sem linha, ou linha sem markup) —
-- nesse caso o front (`preco.ts`) cai no markup da linha como fallback de exibição.
--
-- COMO (1 função, 1 trigger BEFORE INSERT OR UPDATE — `fn_modelo_markup_congela`):
--   INSERT  → carimba: coalesce(valor explícito, markup da linha). SEM gate — os caminhos
--             de criação (3 INSERTs de front + 2 RPCs) não mandam o campo, e o fluxo
--             "Duplicar card" (PlanejamentoDetail) COPIA o draft inteiro no INSERT: a
--             cópia deve herdar o markup congelado do original mesmo quando quem duplica
--             não tem a permissão de custos (gate em INSERT travaria a duplicação).
--   UPDATE  → duas fases, NESTA ordem:
--             (a) AUTO-PREENCHIMENTO DE SISTEMA: se `linha_id` mudou E o modelo nunca teve
--                 markup (OLD e NEW ambos NULL — ou seja, o cliente NÃO mexeu no campo),
--                 preenche com o markup da nova linha e RETORNA — esse valor foi setado
--                 pelo TRIGGER (sistema), não pelo usuário, então NÃO passa pelo gate.
--             (b) GATE DE PERMISSÃO (espelha `enforce_servico_mo_aprovacao`, invariante
--                 #12): qualquer OUTRA mudança de `markup_editado` (NEW IS DISTINCT FROM
--                 OLD) é edição MANUAL — exige `user_can_edit('criacao_planejamento:
--                 custos')` (admin/tenant_admin/super furam), senão RAISE 42501
--                 (erro-mensagem.ts já traduz). Cobre também "limpar" o valor (→NULL).
--             Distinção sistema×manual: na fase (a) o cliente mandou o campo INALTERADO
--             (NULL→NULL) — quem muda o valor é o próprio trigger, depois do RETURN o
--             gate nem roda. Toda mudança que CHEGA no gate veio do payload do cliente.
--
-- BACKFILL: os modelos existentes com linha congelam no markup ATUAL da linha (preserva o
-- preço de hoje). Roda ANTES do CREATE TRIGGER (e o DROP TRIGGER IF EXISTS vem antes do
-- backfill de propósito: numa RE-aplicação o gate já existiria e barraria o UPDATE rodado
-- como postgres sem JWT — dropar antes mantém a migration idempotente).
--
-- NOTAS DE SEGURANÇA (decisões registradas, não regressões):
--   • O gate é SÓ de escrita (UPDATE manual). Leitura da coluna segue a RLS tenant normal
--     de `modelos` (como `preco_venda`) — o mascaramento de custos por seção continua no
--     wrapper `custo_unitario_modelos` (invariante #12), fora do escopo daqui.
--   • INSERT direto com valor explícito não é gateado (superfície aceita no plano — o
--     duplicar precisa; criar modelo já é gateado pela permissão da página).
--   • Escrita de manutenção como postgres SEM JWT que mude `markup_editado` cai no gate
--     (user_can_edit=false sem uid) — mesma propriedade do precedente de MO; se um dia
--     precisar, desabilita-se o trigger na própria txn de manutenção.
--
-- Aditiva, idempotente (IF NOT EXISTS / DROP IF EXISTS / CREATE OR REPLACE), BEGIN/COMMIT.
BEGIN;

-- 1) Coluna
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS markup_editado numeric;

-- 2) CHECK: NULL ou >= 0
ALTER TABLE public.modelos DROP CONSTRAINT IF EXISTS modelos_markup_editado_nonneg;
ALTER TABLE public.modelos ADD CONSTRAINT modelos_markup_editado_nonneg
  CHECK (markup_editado IS NULL OR markup_editado >= 0);

-- 3) Backfill (ANTES do trigger de gate — ver comentário no topo).
--    3a) Numa re-aplicação, remove o gate antes do UPDATE de sistema (idempotência).
DROP TRIGGER IF EXISTS trg_modelo_markup_congela ON public.modelos;

--    3b) Congela os 144 modelos com linha que tem markup; a linha sem markup fica NULL.
UPDATE public.modelos m
   SET markup_editado = (SELECT l.markup FROM public.linhas l WHERE l.id = m.linha_id)
 WHERE m.linha_id IS NOT NULL
   AND m.markup_editado IS NULL;

-- 4+5+6) Função única: congela no INSERT, auto-preenche ao ganhar linha, gate na edição
--        manual (lógica detalhada no comentário do topo).
CREATE OR REPLACE FUNCTION public.fn_modelo_markup_congela()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- CONGELA no nascimento: sem valor explícito, carimba o markup da linha do Cadastro.
    -- (Duplicar card passa o valor do original — o coalesce o preserva.)
    NEW.markup_editado := coalesce(
      NEW.markup_editado,
      (SELECT l.markup FROM public.linhas l WHERE l.id = NEW.linha_id)
    );
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  -- (a) AUTO-PREENCHIMENTO DE SISTEMA: ganhou/trocou linha e nunca teve markup próprio
  --     (cliente mandou o campo inalterado: OLD e NEW ambos NULL). Valor vem do Cadastro
  --     via o PRÓPRIO trigger → não é edição manual → não passa pelo gate (b).
  IF NEW.linha_id IS DISTINCT FROM OLD.linha_id
     AND OLD.markup_editado IS NULL
     AND NEW.markup_editado IS NULL THEN
    NEW.markup_editado := (SELECT l.markup FROM public.linhas l WHERE l.id = NEW.linha_id);
    RETURN NEW;
  END IF;

  -- (b) GATE: mudança de markup_editado vinda do payload do cliente = edição MANUAL.
  --     Se o modelo JÁ tinha valor, trocar de linha NÃO mexe nele (cai aqui com
  --     NEW = OLD → gate silencioso, valor preservado — decisão do dono).
  IF NEW.markup_editado IS DISTINCT FROM OLD.markup_editado
     AND NOT public.user_can_edit('criacao_planejamento:custos') THEN
    RAISE EXCEPTION 'Sem permissão para editar o markup aplicado do modelo'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $function$;

CREATE TRIGGER trg_modelo_markup_congela
  BEFORE INSERT OR UPDATE ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_markup_congela();

-- 7) REVOKE dos TRÊS (invariante #9 — revogar só anon/authenticated é inócuo, PUBLIC herda).
REVOKE EXECUTE ON FUNCTION public.fn_modelo_markup_congela() FROM PUBLIC, anon, authenticated;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
