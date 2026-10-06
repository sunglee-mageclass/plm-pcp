-- Urgentes R9e - CORRECAO UNICA: os pt_* LEGADOS (producao_terceirizados.pt_data_saida/pt_data_entrada/pt_aprovacao, painel
-- "Etapas PL" do PCP > Servicos) viram a 1a TENTATIVA da trilha correspondente no card (secao Peca Teste) + switch "Exige peca
-- teste" ligado na categoria PL das lojas com Etapas PL. Escrita A MAO (padrao I3c/R8b: guarda, teto, backup, idempotencia,
-- pos-condicao). Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 4 / R9e; Rulings 18/19; P-331 A) + spec-r9.md.
-- 1) Candidato = bloco de producao_terceirizados com algum pt_* preenchido e AINDA SEM linha em _bkp_r9_pt_legado (idempotencia).
--    Decisao gravada no backup para CADA candidato (nada se perde em silencio), na ordem:
--      'interno'            bloco interno (sem fornecedor/trilha) - nao migra;
--      'legado_ja_tem'      ja existe tentativa com legado_bloco_id = o bloco, ou a trilha ja tem tentativa 'legado' - nao migra;
--      'sem_linha'          sem card/modelo da loja do bloco/tipo, ou o modelo nao tem linha de M.O. DESSE tipo - nao migra;
--      'ambigua'            2+ linhas de M.O. do tipo (sem mo_linha_id valido) OU 2+ blocos legados para a MESMA linha - nao migra;
--      'card_ja_tem'        a trilha (linha x tipo) ja tem tentativa lancada pelo card - nao migra (o card manda);
--      'sem_datas'          so a aprovacao, sem nenhuma das 2 datas - nao migra (tentativa vazia nao existe);
--      'migrado_sem_decisao' aprovacao sem as 2 datas -> tentativa 1 com as datas que houver, SEM decisao;
--      'migrado_sem_fornecedor' aprovacao com as 2 datas mas a linha de M.O. SEM fornecedor de servico valido da loja -> tentativa 1
--                           com as 2 datas, SEM decisao (revisao T2: decisao exige fornecedor; NULL x NULL nao pode virar "aprovada",
--                           senao travaria a linha sem fornecedor - a pessoa define o fornecedor e aprova no card, datas ja la);
--      'migrado'            o resto -> tentativa 1 com as datas e a decisao.
--    Linha de M.O. = pt.mo_linha_id se existe com o MESMO modelo/tipo/loja; senao a UNICA linha (modelo, tipo).
-- 2) Tentativa 1: origem 'legado', legado_bloco_id = bloco, numero 1, datas do bloco; decidida -> empresa_id = fornecedor ATUAL da
--    linha (revisao T2/T3: a aprovada so conta com o congelado = o da linha; o fornecedor do BLOCO fica so no backup), decidido_em e
--    decidido_por NULL (data desconhecida); sem decisao -> empresa_id NULL (como o card grava). ON CONFLICT (legado_bloco_id) DO NOTHING.
-- 3) Switch (Ruling 19 / P-331 A): categoria de nome 'pl' (lower(btrim)) das lojas com _tenant_modulo_ligado(loja,'etapas_pl') com
--    exige_peca_teste = false e AINDA fora de _bkp_r9_exige_pl -> grava o antes e liga (so 1 vez: quem a pessoa desligar depois NAO e
--    religado na reexecucao; o _down tira do backup o que devolveu, entao ida -> _down -> ida volta ao estado da ida).
-- Fila do kanban automatico: SET LOCAL app.kanban_sistema (nada enfileira - nenhuma loja exige 'peca_teste_aprovada' na ida, Passo
--   0-C). Loja que JA exigir a chave (reexecucao tardia) e foi tocada: enfileirada explicitamente (recalculo no COMMIT).
-- Backups: public._bkp_r9_pt_legado (1 linha por bloco candidato, com a decisao) e public._bkp_r9_exige_pl (categoria ligada + antes);
--   RLS sem policy + REVOKE ALL de PUBLIC/anon/authenticated/service_role (so o dono le). Nao apagar (o _down_drop e separado).
-- Pos-condicao: backup desta execucao = candidatos; tentativas inseridas = backup 'migrado%' desta execucao (todas com tentativa_id);
--   pt_* de producao_terceirizados byte a byte iguais (foto md5 antes/depois); fila do kanban igual (salvo a loja enfileirada acima);
--   nenhuma categoria PL de loja com Etapas PL desligada fora do backup; backups ilegiveis por anon/authenticated.
-- Teto: > 200 blocos candidatos = PARE (Passo 0-D mostra o numero; producao esperada <= 2; copia3: 3, todos 'sem_linha').
-- Trava: chave do CARD (pg_advisory_xact_lock(hashtext('cad:modelo_id:'||modelo)) - a 1a da ordem R4) de cada modelo candidato,
--   em ordem; depois FOR SHARE nos blocos candidatos (so linhas: um Salvar do PCP no mesmo bloco espera ms) e FOR UPDATE nas categorias
--   PL; INSERT em modelo_peca_teste_tentativas; CREATE TABLE so na 1a vez (tabelas novas). Nada em auth/storage/realtime. Qualquer hora;
--   55P03/40P01 = nada mudou, rodar de novo.
-- ATENCAO (janela do kit): entre esta migration e o SITE novo, o site VELHO ainda grava pt_* - bloco ja no backup NAO e migrado de
--   novo (e a regra da idempotencia); reexecutar depois do site so pega blocos NOVOS.
-- Exige 20261103192000 (tabela modelo_peca_teste_tentativas/coluna exige_peca_teste) e 20261103193000 VIVA (salvar_peca_teste com o
--   portao da secao; helper _peca_teste_aprovada).
-- Volta: supabase/rollback/20261103196000_urg_r9_pt_legado_down.sql (NEUTRO: desliga so o que a ida ligou e ainda esta ligado; as
--   tentativas 'legado' FICAM - saem no 192000_down_drop; pt_* nunca foram mexidos). DROP dos backups:
--   supabase/rollback/20261103196000_urg_r9_pt_legado_down_drop.sql (opcional, depois do _down; SET app.confirmo_apagar_backup_r9='sim').
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '60s';
SET LOCAL app.kanban_sistema = 'urg_r9_legado';

DO $guarda$
DECLARE
  v text;
  v_n integer;
BEGIN
  -- 192000 (urg R9a)
  IF to_regclass('public.modelo_peca_teste_tentativas') IS NULL
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modelo_peca_teste_tentativas'
           AND column_name IN ('origem', 'legado_bloco_id', 'numero', 'aprovacao', 'empresa_id')) <> 5
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'modelo_peca_teste_tentativas'
                     AND indexname = 'mpt_legado_ux')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categorias_terceirizado'
                     AND column_name = 'exige_peca_teste') THEN
    RAISE EXCEPTION 'urg_r9e: exige a 20261103192000 (urg R9a) aplicada' USING ERRCODE = 'P0001';
  END IF;
  -- 193000 (urg R9b) VIVA
  IF to_regprocedure('public.salvar_peca_teste(uuid,jsonb,jsonb)') IS NULL
     OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_peca_teste(uuid,jsonb,jsonb)'))
        NOT LIKE '%criacao_planejamento:peca_teste%'
     OR to_regprocedure('public._peca_teste_aprovada(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'urg_r9e: exige a 20261103193000 (urg R9b) aplicada' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'producao_terceirizados'
        AND column_name IN ('pt_data_saida', 'pt_data_entrada', 'pt_aprovacao', 'mo_linha_id')) <> 4
     OR to_regprocedure('public._tenant_modulo_ligado(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'urg_r9e: producao_terceirizados sem as colunas pt_*/mo_linha_id ou sem _tenant_modulo_ligado - PARE'
      USING ERRCODE = 'P0001';
  END IF;
  -- backups: ausentes OU com a forma esperada
  IF to_regclass('public._bkp_r9_pt_legado') IS NOT NULL THEN
    SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) INTO v
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '_bkp_r9_pt_legado';
    IF v IS DISTINCT FROM 'bloco_id:uuid,tenant_id:uuid,cad_id:uuid,modelo_id:uuid,categoria_terceirizado_id:uuid,empresa_id:uuid,mo_linha_id:uuid,empresa_linha_id:uuid,interno:boolean,ativo:boolean,pt_data_saida:date,pt_data_entrada:date,pt_aprovacao:text,decisao:text,tentativa_id:uuid,gravado_em:timestamp with time zone' THEN
      RAISE EXCEPTION 'urg_r9e: public._bkp_r9_pt_legado existe com OUTRA forma (%) - PARE', v USING ERRCODE = 'P0001';
    END IF;
    EXECUTE 'SELECT count(*) FROM public.producao_terceirizados pt'
         || ' WHERE (pt.pt_data_saida IS NOT NULL OR pt.pt_data_entrada IS NOT NULL OR pt.pt_aprovacao IS NOT NULL)'
         || ' AND NOT EXISTS (SELECT 1 FROM public._bkp_r9_pt_legado b WHERE b.bloco_id = pt.id)' INTO v_n;
  ELSE
    SELECT count(*) INTO v_n FROM public.producao_terceirizados pt
     WHERE pt.pt_data_saida IS NOT NULL OR pt.pt_data_entrada IS NOT NULL OR pt.pt_aprovacao IS NOT NULL;
  END IF;
  IF to_regclass('public._bkp_r9_exige_pl') IS NOT NULL THEN
    SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) INTO v
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '_bkp_r9_exige_pl';
    IF v IS DISTINCT FROM 'categoria_id:uuid,tenant_id:uuid,antes:boolean,gravado_em:timestamp with time zone' THEN
      RAISE EXCEPTION 'urg_r9e: public._bkp_r9_exige_pl existe com OUTRA forma (%) - PARE', v USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF v_n > 200 THEN
    RAISE EXCEPTION 'urg_r9e: % blocos legados a migrar (teto 200) - PARE e confira o Passo 0-D', v_n USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE TABLE IF NOT EXISTS public._bkp_r9_pt_legado (
  bloco_id uuid PRIMARY KEY,
  tenant_id uuid,
  cad_id uuid,
  modelo_id uuid,
  categoria_terceirizado_id uuid,
  empresa_id uuid,
  mo_linha_id uuid,
  empresa_linha_id uuid,
  interno boolean,
  ativo boolean,
  pt_data_saida date,
  pt_data_entrada date,
  pt_aprovacao text,
  decisao text NOT NULL CHECK (decisao IN ('migrado', 'migrado_sem_decisao', 'migrado_sem_fornecedor', 'sem_linha', 'ambigua',
                                           'card_ja_tem', 'legado_ja_tem', 'sem_datas', 'interno')),
  tentativa_id uuid,
  gravado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public._bkp_r9_pt_legado IS
  'Backup da correcao unica urg R9e (20261103196000): cada bloco legado com pt_* e a decisao (migrado/nao migrado e por que). So o dono le. Nao apagar.';
CREATE TABLE IF NOT EXISTS public._bkp_r9_exige_pl (
  categoria_id uuid PRIMARY KEY,
  tenant_id uuid,
  antes boolean NOT NULL,
  gravado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public._bkp_r9_exige_pl IS
  'Backup da correcao unica urg R9e (20261103196000): categorias PL em que a ida ligou exige_peca_teste (antes). O _down devolve e tira daqui.';
ALTER TABLE public._bkp_r9_pt_legado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_r9_exige_pl ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_r9_pt_legado, public._bkp_r9_exige_pl FROM PUBLIC, anon, authenticated, service_role;

DO $migra$
DECLARE
  v_ini timestamptz := clock_timestamp();
  v_pt_antes text;
  v_pt_depois text;
  v_fila_antes bigint;
  v_fila_depois bigint;
  v_cand integer;
  v_bkp integer;
  v_ins integer;
  v_mig integer;
  v_sem integer;
  v_sw integer;
  v_n integer;
  v_lojas uuid[];
  v_resumo text;
  r record;
BEGIN
  SELECT md5(coalesce(string_agg(pt.id::text || '|' || coalesce(pt.pt_data_saida::text, '') || '|' || coalesce(pt.pt_data_entrada::text, '')
                                 || '|' || coalesce(pt.pt_aprovacao, ''), ',' ORDER BY pt.id), ''))
    INTO v_pt_antes FROM public.producao_terceirizados pt
   WHERE pt.pt_data_saida IS NOT NULL OR pt.pt_data_entrada IS NOT NULL OR pt.pt_aprovacao IS NOT NULL;
  SELECT count(*) INTO v_fila_antes FROM public.kanban_recalculo_fila;

  -- trava: chave do card de cada modelo candidato (ordem de modelo_id), depois os blocos candidatos (ordem de id)
  FOR r IN SELECT DISTINCT c.modelo_id
             FROM public.producao_terceirizados pt JOIN public.cad c ON c.id = pt.cad_id
            WHERE (pt.pt_data_saida IS NOT NULL OR pt.pt_data_entrada IS NOT NULL OR pt.pt_aprovacao IS NOT NULL)
              AND c.modelo_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public._bkp_r9_pt_legado b WHERE b.bloco_id = pt.id)
            ORDER BY c.modelo_id LOOP
    PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || r.modelo_id::text));
  END LOOP;
  PERFORM 1 FROM public.producao_terceirizados pt
   WHERE (pt.pt_data_saida IS NOT NULL OR pt.pt_data_entrada IS NOT NULL OR pt.pt_aprovacao IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM public._bkp_r9_pt_legado b WHERE b.bloco_id = pt.id)
   ORDER BY pt.id FOR SHARE OF pt;
  SELECT count(*) INTO v_cand FROM public.producao_terceirizados pt
   WHERE (pt.pt_data_saida IS NOT NULL OR pt.pt_data_entrada IS NOT NULL OR pt.pt_aprovacao IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM public._bkp_r9_pt_legado b WHERE b.bloco_id = pt.id);
  IF v_cand > 200 THEN
    RAISE EXCEPTION 'urg_r9e: % blocos legados a migrar sob a trava (teto 200) - PARE', v_cand USING ERRCODE = 'P0001';
  END IF;

  -- 1) classificacao de CADA candidato -> backup (mesma regra da consulta 0-D do Passo 0)
  INSERT INTO public._bkp_r9_pt_legado (bloco_id, tenant_id, cad_id, modelo_id, categoria_terceirizado_id, empresa_id, mo_linha_id,
                                        empresa_linha_id, interno, ativo, pt_data_saida, pt_data_entrada, pt_aprovacao, decisao)
  WITH cand AS (
    SELECT pt.id AS bloco_id, pt.tenant_id, pt.cad_id, c.modelo_id, m.tenant_id AS m_tenant, pt.categoria_terceirizado_id AS cat,
           pt.empresa_id, pt.mo_linha_id, pt.interno, pt.ativo, pt.pt_data_saida, pt.pt_data_entrada, pt.pt_aprovacao
      FROM public.producao_terceirizados pt
      LEFT JOIN public.cad c ON c.id = pt.cad_id
      LEFT JOIN public.modelos m ON m.id = c.modelo_id
     WHERE (pt.pt_data_saida IS NOT NULL OR pt.pt_data_entrada IS NOT NULL OR pt.pt_aprovacao IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public._bkp_r9_pt_legado b WHERE b.bloco_id = pt.id)
  ), res AS (
    SELECT k.*,
           (SELECT s.id FROM public.modelo_servico_mo s WHERE s.id = k.mo_linha_id AND s.modelo_id = k.modelo_id
               AND s.tenant_id = k.m_tenant AND s.categoria_terceirizado_id = k.cat) AS l_direta,
           (SELECT count(*) FROM public.modelo_servico_mo s WHERE s.modelo_id = k.modelo_id AND s.tenant_id = k.m_tenant
               AND s.categoria_terceirizado_id = k.cat) AS n_tipo,
           (SELECT min(s.id::text)::uuid FROM public.modelo_servico_mo s WHERE s.modelo_id = k.modelo_id AND s.tenant_id = k.m_tenant
               AND s.categoria_terceirizado_id = k.cat) AS l_min
      FROM cand k
  ), lin AS (
    SELECT r2.*, CASE WHEN r2.l_direta IS NOT NULL THEN r2.l_direta WHEN r2.n_tipo = 1 THEN r2.l_min END AS linha
      FROM res r2
  ), tent AS (
    SELECT l.*,
           count(*) FILTER (WHERE l.linha IS NOT NULL AND NOT coalesce(l.interno, false)) OVER (PARTITION BY l.linha) AS n_blocos_linha,
           EXISTS (SELECT 1 FROM public.modelo_peca_teste_tentativas t WHERE t.legado_bloco_id = l.bloco_id) AS ja_bloco,
           EXISTS (SELECT 1 FROM public.modelo_peca_teste_tentativas t WHERE t.mo_linha_id = l.linha
                     AND t.categoria_terceirizado_id = l.cat AND t.origem = 'card') AS tem_card,
           EXISTS (SELECT 1 FROM public.modelo_peca_teste_tentativas t WHERE t.mo_linha_id = l.linha
                     AND t.categoria_terceirizado_id = l.cat) AS tem_trilha,
           (SELECT s.empresa_id FROM public.modelo_servico_mo s WHERE s.id = l.linha) AS forn_bruto,
           (SELECT e.id FROM public.modelo_servico_mo s JOIN public.empresas e ON e.id = s.empresa_id
             WHERE s.id = l.linha AND e.tenant_id = l.m_tenant AND e.tipo = 'servico') AS forn_linha
      FROM lin l
  )
  SELECT t.bloco_id, t.tenant_id, t.cad_id, t.modelo_id, t.cat, t.empresa_id, t.linha, t.forn_bruto, t.interno, t.ativo,
         t.pt_data_saida, t.pt_data_entrada, t.pt_aprovacao,
         CASE
           WHEN coalesce(t.interno, false) THEN 'interno'
           WHEN t.ja_bloco THEN 'legado_ja_tem'
           WHEN t.modelo_id IS NULL OR t.cat IS NULL OR t.m_tenant IS DISTINCT FROM t.tenant_id THEN 'sem_linha'
           WHEN t.linha IS NULL AND t.n_tipo = 0 THEN 'sem_linha'
           WHEN t.linha IS NULL THEN 'ambigua'
           WHEN t.n_blocos_linha > 1 THEN 'ambigua'
           WHEN t.tem_card THEN 'card_ja_tem'
           WHEN t.tem_trilha THEN 'legado_ja_tem'
           WHEN t.pt_data_saida IS NULL AND t.pt_data_entrada IS NULL THEN 'sem_datas'
           WHEN t.pt_aprovacao IS NOT NULL AND (t.pt_data_saida IS NULL OR t.pt_data_entrada IS NULL) THEN 'migrado_sem_decisao'
           WHEN t.pt_aprovacao IS NOT NULL AND t.forn_linha IS NULL THEN 'migrado_sem_fornecedor'
           ELSE 'migrado'
         END
    FROM tent t
   ORDER BY t.bloco_id
  ON CONFLICT (bloco_id) DO NOTHING;
  GET DIAGNOSTICS v_bkp = ROW_COUNT;
  IF v_bkp <> v_cand THEN
    RAISE EXCEPTION 'urg_r9e: pos-condicao falhou (backup % <> candidatos %)', v_bkp, v_cand USING ERRCODE = 'P0001';
  END IF;

  -- 2) tentativa 1 de cada migrado* desta execucao
  INSERT INTO public.modelo_peca_teste_tentativas
    (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, empresa_id, data_saida, data_entrada, aprovacao,
     decidido_em, decidido_por, origem, legado_bloco_id, created_by, updated_at)
  SELECT b.tenant_id, b.modelo_id, b.mo_linha_id, b.categoria_terceirizado_id, 1,
         CASE WHEN b.decisao = 'migrado' AND b.pt_aprovacao IS NOT NULL THEN b.empresa_linha_id END,
         b.pt_data_saida, b.pt_data_entrada,
         CASE WHEN b.decisao = 'migrado' THEN b.pt_aprovacao END,
         NULL, NULL, 'legado', b.bloco_id, NULL, now()
    FROM public._bkp_r9_pt_legado b
   WHERE b.gravado_em >= v_ini AND b.decisao LIKE 'migrado%'
   ORDER BY b.bloco_id
  ON CONFLICT (legado_bloco_id) WHERE legado_bloco_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  SELECT count(*) INTO v_mig FROM public._bkp_r9_pt_legado b WHERE b.gravado_em >= v_ini AND b.decisao LIKE 'migrado%';
  IF v_ins <> v_mig THEN
    RAISE EXCEPTION 'urg_r9e: pos-condicao falhou (tentativas % <> migrados %)', v_ins, v_mig USING ERRCODE = 'P0001';
  END IF;
  UPDATE public._bkp_r9_pt_legado b SET tentativa_id = t.id
    FROM public.modelo_peca_teste_tentativas t
   WHERE t.legado_bloco_id = b.bloco_id AND t.origem = 'legado' AND b.gravado_em >= v_ini AND b.decisao LIKE 'migrado%';
  SELECT count(*) INTO v_sem FROM public._bkp_r9_pt_legado b
   WHERE b.gravado_em >= v_ini AND b.decisao LIKE 'migrado%' AND b.tentativa_id IS NULL;
  IF v_sem > 0 THEN
    RAISE EXCEPTION 'urg_r9e: pos-condicao falhou (% migrado(s) sem tentativa)', v_sem USING ERRCODE = 'P0001';
  END IF;

  -- 3) switch "Exige peca teste" na categoria PL das lojas com Etapas PL (so 1 vez por categoria)
  PERFORM 1 FROM public.categorias_terceirizado c
   WHERE lower(btrim(c.nome)) = 'pl' AND NOT c.exige_peca_teste AND public._tenant_modulo_ligado(c.tenant_id, 'etapas_pl')
     AND NOT EXISTS (SELECT 1 FROM public._bkp_r9_exige_pl b WHERE b.categoria_id = c.id)
   ORDER BY c.id FOR UPDATE OF c;
  INSERT INTO public._bkp_r9_exige_pl (categoria_id, tenant_id, antes)
  SELECT c.id, c.tenant_id, c.exige_peca_teste FROM public.categorias_terceirizado c
   WHERE lower(btrim(c.nome)) = 'pl' AND NOT c.exige_peca_teste AND public._tenant_modulo_ligado(c.tenant_id, 'etapas_pl')
     AND NOT EXISTS (SELECT 1 FROM public._bkp_r9_exige_pl b WHERE b.categoria_id = c.id)
   ORDER BY c.id
  ON CONFLICT (categoria_id) DO NOTHING;
  UPDATE public.categorias_terceirizado c SET exige_peca_teste = true
    FROM public._bkp_r9_exige_pl b
   WHERE b.categoria_id = c.id AND b.gravado_em >= v_ini AND NOT c.exige_peca_teste;
  GET DIAGNOSTICS v_sw = ROW_COUNT;

  -- 4) loja tocada que JA exige 'peca_teste_aprovada' (so numa reexecucao tardia): recalcula o kanban dela no COMMIT
  SELECT array_agg(DISTINCT tc.tenant_id ORDER BY tc.tenant_id) INTO v_lojas
    FROM public.tenant_config tc
   WHERE tc.tenant_id IN (SELECT b.tenant_id FROM public._bkp_r9_pt_legado b WHERE b.gravado_em >= v_ini AND b.decisao LIKE 'migrado%'
                          UNION SELECT e.tenant_id FROM public._bkp_r9_exige_pl e WHERE e.gravado_em >= v_ini)
     AND (coalesce(tc.kanban_requisitos::text, '') || coalesce(tc.revenda_kanban_requisitos::text, '')
          || coalesce(tc.kanban_requisitos_excecoes::text, '')) LIKE '%"peca_teste_aprovada"%';
  IF v_lojas IS NOT NULL THEN
    PERFORM set_config('app.kanban_sistema', '', true);
    FOR r IN SELECT unnest(v_lojas) AS t LOOP
      PERFORM public._kanban_enfileirar_tenant(r.t);
    END LOOP;
    PERFORM set_config('app.kanban_sistema', 'urg_r9_legado', true);
  END IF;

  -- 5) pos-condicao
  SELECT md5(coalesce(string_agg(pt.id::text || '|' || coalesce(pt.pt_data_saida::text, '') || '|' || coalesce(pt.pt_data_entrada::text, '')
                                 || '|' || coalesce(pt.pt_aprovacao, ''), ',' ORDER BY pt.id), ''))
    INTO v_pt_depois FROM public.producao_terceirizados pt
   WHERE pt.pt_data_saida IS NOT NULL OR pt.pt_data_entrada IS NOT NULL OR pt.pt_aprovacao IS NOT NULL;
  IF v_pt_depois IS DISTINCT FROM v_pt_antes THEN
    RAISE EXCEPTION 'urg_r9e: pos-condicao falhou (pt_* mudaram)' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_fila_depois FROM public.kanban_recalculo_fila;
  IF v_lojas IS NULL AND v_fila_depois <> v_fila_antes THEN
    RAISE EXCEPTION 'urg_r9e: pos-condicao falhou (fila do kanban % -> %)', v_fila_antes, v_fila_depois USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.categorias_terceirizado c
   WHERE lower(btrim(c.nome)) = 'pl' AND NOT c.exige_peca_teste AND public._tenant_modulo_ligado(c.tenant_id, 'etapas_pl')
     AND NOT EXISTS (SELECT 1 FROM public._bkp_r9_exige_pl b WHERE b.categoria_id = c.id);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'urg_r9e: pos-condicao falhou (% categoria(s) PL desligada(s) fora do backup)', v_n USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('anon', 'public._bkp_r9_pt_legado', 'SELECT') OR has_table_privilege('authenticated', 'public._bkp_r9_pt_legado', 'SELECT')
     OR has_table_privilege('anon', 'public._bkp_r9_exige_pl', 'SELECT') OR has_table_privilege('authenticated', 'public._bkp_r9_exige_pl', 'SELECT') THEN
    RAISE EXCEPTION 'urg_r9e: pos-condicao falhou (backup legivel por anon/authenticated)' USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg(x.decisao || '=' || x.n, ', ' ORDER BY x.decisao) INTO v_resumo
    FROM (SELECT b.decisao, count(*) AS n FROM public._bkp_r9_pt_legado b WHERE b.gravado_em >= v_ini GROUP BY b.decisao) x;
  RAISE NOTICE 'urg_r9e: % bloco(s) legado(s) classificado(s) (%); % tentativa(s) criada(s); % categoria(s) PL ligada(s); % loja(s) enfileirada(s)',
    v_bkp, coalesce(v_resumo, '-'), v_ins, v_sw, coalesce(cardinality(v_lojas), 0);
END
$migra$;

SELECT set_config('app.kanban_sistema', '', true) AS kanban_sistema_restaurado;

COMMIT;
