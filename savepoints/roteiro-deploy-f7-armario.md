# Roteiro do DEPLOY — F7 · Armário (vitrine de e-commerce, módulo opt-in)

Para o controlador publicar NO PAINEL (mensagem fixada). Quem RODA é o DONO, em PRODUÇÃO. **Banco ANTES do site.**
A frente está COMPLETA e revisada (revisão final de branch = SHIP). 6 migrations + 6 inversos. Branch `f7/armario` =
`feature/plan-tecido-a1` + 13 commits do Armário (fast-forward limpo; a principal NÃO avançou).

**O Armário é MÓDULO OPT-IN (default DESLIGADO):** depois do deploy, NINGUÉM vê a aba até o super admin LIGAR o
módulo "Armário" em Gerenciar Lojas, por loja. (Como OTB / Produto Acabado / Etapas PL.)

```text
DEPLOY F7 ARMARIO — 6 migrations (banco ANTES do site) — PRODUCAO

0) JUNTAR a branch (fast-forward; NAO muda o site no ar, so organiza o codigo). O controlador faz com o seu OK:
   git checkout feature/plan-tecido-a1 && git merge --ff-only f7/armario
   (A principal nao avancou desde que a f7 saiu: merge limpo, zero conflito. Push ao GitHub e opcional.)

1) PASSO 0 (SO LEITURA, nada grava). Rode e cole a saida no painel:
   psql "$(cat /tmp/dburl.txt)" -f supabase/consultas/armario_passo0.sql
   PARE e me chame se: (A) qualquer tabela/RPC do Armario JA existir (deploy repetido); (B) tenant_module_enabled/
   _tenant_modulo_ligado NAO existirem, ou JA tiverem 'armario' (posicao != 0); (C) alguma loja com armario ligado (deve ser 0).

2) IDA — uma por vez, FORA de transacao (psql -v ON_ERROR_STOP=1 -f, nunca -1, nunca \i), NESTA ordem.
   55P03 (ou 40P01) = nada mudou: rodar a MESMA de novo. Qualquer outro erro = PARE.
   ⚠️ A 1a (tabelas) tem CREATE POLICY -> dispara o hook supautils (AccessExclusive em ~23 tabelas auth/storage/realtime
      ate o COMMIT): o login pode esperar MILISSEGUNDOS durante o COMMIT. HORARIO CALMO recomendado (nao critico; tabelas
      novas e pequenas, migration curta). As demais sao leves.
   for f in 20261202100000_armario_tabelas 20261202110000_armario_trava_publicado \
            20261202120000_armario_variantes_disponiveis 20261202130000_armario_salvar \
            20261202140000_armario_crud 20261202150000_armario_modulo_optin; do
     psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/$f.sql || break; done

3) POS-CHECAGEM (so leitura). Cole a saida:
   psql "$(cat /tmp/dburl.txt)" -c "select to_regclass('public.armarios') t1, to_regclass('public.armario_itens') t2;
     select count(*) rpcs_armario from pg_proc where pronamespace='public'::regnamespace and proname ~ '^_?armario';
     select count(*) gatilhos from pg_trigger where tgname like 'trg_%armario%';
     select position('''armario''' in pg_get_functiondef('public.tenant_module_enabled(text)'::regprocedure)) tme_tem_armario_>0,
            position('''armario''' in pg_get_functiondef('public._tenant_modulo_ligado(uuid,text)'::regprocedure)) tml_tem_armario_>0;
     select public._tenant_modulo_ligado('00000000-0000-0000-0000-000000000000'::uuid,'armario') deve_ser_false;"
   Esperado: t1/t2 com os nomes; rpcs_armario >= 13; gatilhos >= 1; tme/tml com armario (posicao > 0); deve_ser_false = f (opt-in OFF).

4) SITE (worker do deploy) — SO depois do banco OK: me avise aqui que eu PUBLICO o worker (deploy Cloudflare da branch
   feature/plan-tecido-a1, ja com o Armario). Aba aberta antes: RECARREGAR.
   - Site velho + banco novo = inofensivo (tabelas/RPCs novas sem leitor; a aba Armario so existe no site novo).
   - Site NOVO + banco velho = a aba Armario quebra (RPC inexistente). Por isso BANCO ANTES DO SITE.

5) SMOKE no app (apos o site):
   - A aba "Armario" NAO aparece em nenhuma loja ainda (modulo OFF). Para testar: Admin > Gerenciar Lojas > escolha uma loja
     (ex. Loja Teste) > ligue o toggle "Armario (vitrine e-commerce)" > Salvar.
   - Na loja com o modulo ligado: Estilo & Engenharia > Armario > escolha Colecao > Subcolecao > "+ Novo armario" > de um nome.
   - Abra o armario > "Adicionar variantes" (dialog) > arraste um card para a grade (ou "+" no mobile) > reordene arrastando >
     mude o no de colunas (a ordem 1..N nao muda) > Salvar.
   - Produto sem cor cadastrada = "Em desenvolvimento" (nao arrasta). Variante ja usada = aviso "ja em outro armario".
   - Status: menu ... > "Marcar como pronto" > "Publicar" (confirma; trava a edicao) > "Despublicar" (volta a editar).

6) Depois do deploy: rm -f /tmp/dburl.txt

VOLTA DE EMERGENCIA — LIFO (um por vez), em supabase/rollback/:
   for f in 20261202150000_armario_modulo_optin_down 20261202140000_armario_crud_down \
            20261202130000_armario_salvar_down 20261202120000_armario_variantes_disponiveis_down \
            20261202110000_armario_trava_publicado_down 20261202100000_armario_tabelas_down; do
     psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/$f.sql || break; done
   - O 100000_down (tabelas) faz DROP TABLE armario_itens; DROP TABLE armarios; (apaga os armarios criados — mas no deploy
     ninguem criou ainda, modulo OFF). O 150000_down (modulo) reemite as 2 funcoes SEM armario -> ⚠️ ANTES de rodar o 150000_down,
     o SITE ja tem de ter voltado (o site novo le a flag armario; mas como o modulo nasce OFF, e inofensivo).
   - Site: eu faco o rollback do worker (npx wrangler rollback <worker-anterior> --name sistrama).

AVISOS AO DONO:
   (1) O Armario COMECA DESLIGADO em todas as lojas. Ligue onde quiser usar (Gerenciar Lojas), por loja.
   (2) A API do e-commerce (ordem de envio) e FASE FUTURA — agora e so montar/salvar a vitrine. O status "publicado" trava a
       edicao (so sai despublicando); por ora e organizacao interna (nao ha API consumindo ainda).
   (3) O arraste real so foi testado agora na sua mao (os testes automaticos nao simulam drag de ponteiro) — confira o SMOKE.
```
