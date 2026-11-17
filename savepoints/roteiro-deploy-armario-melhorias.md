# Roteiro do DEPLOY — Armário · melhorias (F7.1)

Para o controlador publicar NO PAINEL. Quem RODA é o DONO, em PRODUÇÃO. **Banco ANTES do site.**
4 melhorias (feedback de uso): #1 filtro de período no seletor · #2 bloco do armário clicável · #3 "+"
da grade vazia abre o dialog · #4 filtros no dialog (categoria/sub+Acessórios, cor, linha, estado).
Revisão de branch = SHIP. É **1 migration** (a RPC `armario_variantes_disponiveis` passa a devolver
categoria/grupo/linha/status — ADITIVA) + front. Branch `f7/armario-melhorias` = feature/plan-tecido-a1
+ 6 commits (fast-forward limpo).

```text
DEPLOY ARMARIO MELHORIAS — 1 migration (banco ANTES do site) — PRODUCAO

0) JUNTAR a branch (ff limpo; NAO muda o site no ar). EU faco com o seu OK:
   git checkout feature/plan-tecido-a1 && git merge --ff-only f7/armario-melhorias

1) PASSO 0 (so leitura). Rode e cole a saida:
   psql "$(cat /tmp/dburl.txt)" -c "select md5(prosrc) from pg_proc where oid = to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)');"
   Esperado: bb4e9e646f555c6fc9c9fc18286ff060 (o corpo do deploy do Armario, 29o). Se for 85bdc5cabf90c87c951a12a7f8aae310,
   a migration JA foi aplicada (deploy repetido). Qualquer OUTRO md5 = PARE e me chame (a RPC divergiu; a migration abortaria sozinha).
   OBS: md5(prosrc) = SO o corpo (= o que a guarda da migration confere). NAO use pg_get_functiondef (inclui o cabecalho CREATE
   OR REPLACE e da outro hash, a1855192..., que NAO e divergencia — e so medida diferente da MESMA funcao).

2) IDA (1 migration, FORA de transacao, psql -v ON_ERROR_STOP=1 -f; 55P03/40P01 = rode de novo; outro erro = PARE):
   psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261203100000_armario_variantes_filtros.sql
   (So catalogo: CREATE OR REPLACE da RPC. Sem trava de tabela/auth/storage. A guarda md5 aborta se o corpo vivo divergir.)

3) POS-CHECAGEM (so leitura). Cole a saida:
   psql "$(cat /tmp/dburl.txt)" -c "select md5(prosrc) depois,
     has_function_privilege('anon','public.armario_variantes_disponiveis(uuid,text,uuid)','EXECUTE') anon_deve_f,
     has_function_privilege('authenticated','public.armario_variantes_disponiveis(uuid,text,uuid)','EXECUTE') auth_deve_t
     from pg_proc where oid = to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)');"
   Esperado: depois = 85bdc5cabf90c87c951a12a7f8aae310 (md5 do CORPO, igual a guarda; NAO pg_get_functiondef); anon = f; auth = t.

4) SITE — SO depois do banco OK: me avise aqui que eu PUBLICO o worker (branch feature/plan-tecido-a1). Aba aberta antes: RECARREGAR.
   - Site velho + banco novo = inofensivo (a RPC devolve campos novos que o site velho ignora; aditivo).
   - Site NOVO + banco velho = os filtros do dialog ficam vazios (a RPC sem os campos novos) mas nada quebra; mesmo assim: BANCO ANTES DO SITE.

5) SMOKE (na loja com o modulo Armario ligado):
   - Lista: filtro de Ano/Mes encurta as colecoes; clicar no BLOCO inteiro do armario (nao so o nome) abre.
   - Armario vazio: o "+" / "Adicionar variantes" da grade vazia abre o dialog.
   - Dialog: alem da lupa, botao "Filtros" com Grupo>Categoria>Subcategoria (Acessorios mostra bolsa/brinco/etc.), Cor, Linha, Estado. Combina com a busca.

6) Depois: rm -f /tmp/dburl.txt

VOLTA DE EMERGENCIA:
   psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261203100000_armario_variantes_filtros_down.sql
   (reemite a RPC SEM os campos novos = corpo do deploy do Armario; guarda md5; idempotente). Site: eu faco o rollback do worker.
```
