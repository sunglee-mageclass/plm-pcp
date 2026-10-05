-- Frente Backend B4 (desenho item 19; A2 review M1): 1 linha 'produto' por card no espelho da Integracao. Escrito a mao (objeto
-- NOVO; nenhuma funcao existente e redefinida). Plano: .superpowers/sdd/2026-10-05-backend/plan.md (§0 K9, §4 B4, §13).
-- Cria o indice unico PARCIAL public.integracao_linhas_produto_unico ON integracao_linhas (modelo_id) WHERE tipo = 'produto'.
-- Por que: a API (_integracao_ler) falha fechado (500) se um produto nao tiver EXATAMENTE 1 linha 'produto' - hoje so a ordem das
-- escritas garante isso; com o indice, uma 2a linha 'produto' do mesmo card e recusada na hora (23505, traduzida na tela por
-- erro-mensagem.ts > mensagemBackend). Escritores conferidos (05/out): integracao_marcar (DELETE das linhas do card e DEPOIS
-- INSERT de 1 'produto' + as 'variante'), integracao_voltar/integracao_desfazer (DELETE), _integracao_confirmar/
-- integracao_gerar_json_confirmar (UPDATE integrado_em) - nenhum insere a 2a 'produto' antes de apagar a 1a.
-- ============================== GUARDA ==============================
--   indice ja existe com a MESMA definicao -> nada a fazer (NOTICE; reaplicar NAO pega trava nenhuma);
--   indice com outra definicao -> P0001 bk4_indice_diferente: <def>;
--   ha card com mais de 1 linha 'produto' -> P0001 bk4_integracao_duplicada: N cards com mais de 1 linha produto (nada muda).
--     PASSO 0 do kit (producao, so leitura) - tem de dar 0:
--       SELECT count(*) FROM (SELECT modelo_id FROM public.integracao_linhas WHERE tipo = 'produto'
--                              GROUP BY modelo_id HAVING count(*) > 1) d;
--     Se der > 0: NAO rodar; levar ao controlador (listar os cards; Voltar/Desfazer na tela refaz o espelho deles).
-- ====================================================================
-- Trava: LOCK TABLE ... IN SHARE MODE (a MESMA que o CREATE INDEX pega; tomada antes da contagem para a guarda e o indice verem
-- o mesmo dado - fecha a corrida com um integracao_marcar em voo) = ShareLock SO em public.integracao_linhas: bloqueia ESCRITA
-- nela (marcar/voltar/desfazer/confirmar da API e do Gerar JSON) por milissegundos (tabela pequena), ate o COMMIT; leitura segue.
-- PIOR CASO = ~1,5 s de FILA: enquanto a ida ESPERA o ShareLock (uma escrita em voo), as escritas NOVAS nessa tabela entram na
-- fila atras dela por ate 1500ms (lock_timeout); a leitura nunca espera. HORARIO CALMO.
-- Nada em auth/storage/realtime; nenhuma policy/gatilho/funcao. Em ate 1500ms (lock_timeout); 55P03/40P01 = nada mudou, rodar de novo.
-- Caso raro (B4 review m4): indice com este nome e a MESMA definicao mas INVALIDO (so um CREATE INDEX CONCURRENTLY interrompido
-- deixa assim; nenhum arquivo daqui usa) -> a ida da NOTICE "ja existe" e cai no bk4_pos ("indice ausente ou invalido"), e rodar
-- de novo da o mesmo. Saida: rodar o _down_drop (remove o invalido: mesma definicao) e reaplicar a ida.
-- Volta: supabase/rollback/20261103143000_bk_integracao_produto_unico_down.sql (no-op documentado: o indice fica, inerte);
-- remover = supabase/rollback/20261103143000_bk_integracao_produto_unico_down_drop.sql (opcional, depois, LIFO).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $ida$
DECLARE
  v_dup int;
  v_def text;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid) INTO v_def FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.integracao_linhas_produto_unico');
  IF v_def IS NOT NULL THEN
    IF v_def <> 'CREATE UNIQUE INDEX integracao_linhas_produto_unico ON public.integracao_linhas USING btree (modelo_id) WHERE (tipo = ''produto''::text)' THEN
      RAISE EXCEPTION 'bk4_indice_diferente: %', v_def USING ERRCODE = 'P0001';
    END IF;
    RAISE NOTICE 'bk4: indice integracao_linhas_produto_unico ja existe - nada a fazer';
    RETURN;
  END IF;
  -- mesma trava do CREATE INDEX (ShareLock), antes da contagem: guarda e indice veem o mesmo dado
  LOCK TABLE public.integracao_linhas IN SHARE MODE;
  SELECT count(*) INTO v_dup FROM (SELECT modelo_id FROM public.integracao_linhas WHERE tipo = 'produto'
                                    GROUP BY modelo_id HAVING count(*) > 1) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'bk4_integracao_duplicada: % cards com mais de 1 linha produto', v_dup USING ERRCODE = 'P0001';
  END IF;
  -- [backend B4] (A2 review M1) 1 linha 'produto' por card: a API falha fechado (500) se um produto nao tiver EXATAMENTE 1.
  CREATE UNIQUE INDEX integracao_linhas_produto_unico
    ON public.integracao_linhas (modelo_id) WHERE tipo = 'produto';
END
$ida$;

DO $pos$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.integracao_linhas_produto_unico')
                 AND indrelid = 'public.integracao_linhas'::regclass AND indisunique AND indisvalid AND indisready) THEN
    RAISE EXCEPTION 'bk4_pos: indice ausente ou invalido' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
