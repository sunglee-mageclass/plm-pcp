BEGIN;

-- Bug "lane congelada" (ago/2026): a lane (categoria de tecido) do card no canvas do Plan.
-- Tecido é PERSISTIDA em plan_tecido_slots.categoria_tecido_id, e o merge (engine.ts:357,
-- `saved.categoria_tecido_id ?? slot.categoria_tecido_id`) faz o SALVO vencer o vivo do
-- cadastro. Quando o cadastro do tecido é corrigido DEPOIS de salvar (ex.: Malha Begônia
-- FORRO→MALHA em ago), o card fica preso na categoria antiga pra sempre — o "manual salvo
-- vence" do merge não distingue "usuário arrastou de propósito" de "isso era só o auto do
-- seed quando salvou". Front (fix irmão desta migration, engine.ts `normalizarCategoriasAuto`
-- + PlanTecidoSheet.tsx) passa a normalizar pra NULL no PAYLOAD do save quando a categoria
-- bate com a auto do Tecido 1 — isso resolve os saves NOVOS. Esta migration é o one-shot pros
-- 32 slots JÁ SALVOS hoje com a categoria antiga congelada.
--
-- Critério (igual ao front): slot COM modelo cujo Tecido 1 (modelo_tecidos tipo='tecido'
-- numero=1 — único por modelo, confirmado sem duplicidade no schema vivo) resolve a um artigo
-- com categoria_tecido_id preenchida, E plan_tecido_slots.categoria_tecido_id (salva) DIVERGE
-- dessa categoria viva → UPDATE pra NULL (o merge/seed auto-preenche do cadastro no próximo
-- load, engine.ts:354-356). Slot sem modelo, ou com modelo sem Tecido 1 resolvível (artigo_id
-- nulo/sem linha de tecido), NÃO é tocado — o JOIN naturalmente os exclui (nem entram no SELECT).
--
-- Tenant-safe: o UPDATE não filtra tenant_id explicitamente, mas o JOIN passa por
-- modelos.id (FK de plan_tecido_slots.modelo_id) e modelo_tecidos.modelo_id → SÓ pareia slot e
-- modelo que já são o MESMO registro (não há como o JOIN cruzar tenants diferentes); e o teste
-- revertido confirmou 0 linhas onde plan_tecido_slots.tenant_id difere do tenant_id do seu
-- modelo. Idempotente: reaplicar é no-op (WHERE já exclui categoria_tecido_id IS NULL e exige
-- divergência real — depois do 1º UPDATE não sobra nenhuma linha que bata o predicado).
--
-- Teste revertido (BEGIN...ROLLBACK, psql "$(cat /tmp/dburl.txt)"): 32 slots afetados
-- (todos FORRO→MALHA ou TECIDO PLANO→MALHA), 0 slots não-divergentes tocados, 0 vazamento
-- cross-tenant. NÃO aplicada ainda — aguardando o dono/orquestrador rodar em produção.

update plan_tecido_slots pts
set categoria_tecido_id = null
from modelos m
join modelo_tecidos mt
  on mt.modelo_id = m.id
 and mt.tipo = 'tecido'
 and mt.numero = 1
join artigos art
  on art.id = mt.artigo_id
where pts.modelo_id = m.id
  and pts.categoria_tecido_id is not null
  and pts.categoria_tecido_id is distinct from art.categoria_tecido_id;

COMMIT;
