// R15b (achados MÉDIOS) — P-198 A: card com status `reprovado` sai da NECESSIDADE do Plan. Tecido e do COMPROMETIDO das OCs
// no servidor (migration 20261025400000: `_plan_tecido_nec_variante_core` + `comprometida_m` de
// `_plan_tecido_situacao_ocs_core`), e o espelho TS (`arvoreDaDemanda` + `necVivoPorVariante`) bate com o servidor.
// Fix round 1: M1 — vínculo/hint SÓ de card reprovado não liga a OC à coleção no `oc_link` da prévia (OC órfã 10109118);
// M2 — reprovado JÁ enviado ao corte (`cad.enviado_corte`) continua contando (TS: `reprovadoSaiDaDemanda`).
// Integração em BEGIN…ROLLBACK (withTx): os UPDATEs de status são desfeitos. Só na cópia local (54422).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, ehBancoLocal } from "./db";
import { arvoreDaDemanda, necVivoPorVariante, aComprarVivoPorArtigo, reprovadoSaiDaDemanda, type CoberturaVarRow } from "@/lib/plan-tecido/calc";
import type { PtArvore } from "@/lib/plan-tecido/types";

const RODA = hasDb && ehBancoLocal();
const NEC = "public._plan_tecido_nec_variante_core(uuid,uuid,uuid[])";
const SIT = "public._plan_tecido_situacao_ocs_core(uuid,uuid)";
const SIT_WRAP = "public.plan_tecido_situacao_ocs(uuid)";
const PREVIA = "public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])";
const MD5_DEPOIS: Record<string, string> = {
  [NEC]: "825a4b1b1cca8e3309f10b272fc8c76d",
  [SIT]: "368bc7530510b934a0ca33e8efa69116",
  [PREVIA]: "b62ef170570b2444ad3f5727760cd411", // fix1 M1: oc_link ignora card reprovado (não cortado)
};

/** Forma do jsonb da prévia (só o que o teste lê). */
type Previa = {
  cobertura: { artigo_id: string; variante_tecido_id: string; nec_m: number | string; deficit_m: number | string }[];
  fornecedores: unknown[];
};

type Alvo = { tenant: string; colecao: string; slot: string; modelo: string; status: string | null };

/** Vaga COM card e necessidade > 0 (prefere um card já reprovado — na cópia, VESTIDO AURELIA da Ave Rara). */
async function alvo(c: Client): Promise<Alvo> {
  const a = await um<Alvo | undefined>(
    c,
    `select p.tenant_id tenant, p.colecao_id colecao, sl.id slot, sl.modelo_id modelo, m.status_desenvolvimento status
       from plan_tecido p
       join plan_tecido_subcolecoes s on s.plan_id = p.id
       join plan_tecido_linhas l on l.sub_id = s.id
       join plan_tecido_slots sl on sl.linha_ref_id = l.id
       join modelos m on m.id = sl.modelo_id and m.tenant_id = p.tenant_id
      where exists (select 1 from plan_tecido_materiais mt join plan_tecido_variantes vv on vv.material_id = mt.id
                     where mt.slot_id = sl.id and vv.variante_tecido_id is not null
                       and coalesce(mt.consumo,0) * coalesce(vv.grade_total,0) > 0)
        and not exists (select 1 from cad cc where cc.modelo_id = m.id and cc.enviado_corte)  -- cortado segue contando (M2)
      order by ${REPROV("m")} desc, sl.id
      limit 1`,
  );
  if (!a) throw new Error("copia sem vaga com card e necessidade (fixture)");
  return a;
}

/** Necessidade esperada direto das tabelas (independente da função), por variante; exclui card reprovado. */
async function necEsperada(c: Client, tenant: string, colecao: string): Promise<Map<string, number>> {
  const { rows } = await c.query(
    `select vv.variante_tecido_id vid,
            sum(coalesce(mt.consumo,0) * coalesce(vv.grade_total,0) * coalesce(vv.multiplicador,1))::float8 nec
       from plan_tecido p
       join plan_tecido_subcolecoes s on s.plan_id = p.id
       join plan_tecido_linhas l on l.sub_id = s.id
       join plan_tecido_slots sl on sl.linha_ref_id = l.id
       join plan_tecido_materiais mt on mt.slot_id = sl.id
       join plan_tecido_variantes vv on vv.material_id = mt.id
       left join variantes_tecido vt on vt.id = vv.variante_tecido_id
      where p.colecao_id = $2 and p.tenant_id = $1 and vv.variante_tecido_id is not null
        and coalesce(vt.artigo_id, mt.artigo_id) is not null
        and not exists (select 1 from modelos mo where mo.id = sl.modelo_id
                          and (lower(coalesce(mo.status_desenvolvimento,'')) = 'reprovado' or lower(coalesce(mo.status_planejamento,'')) = 'reprovado')
                          and not exists (select 1 from cad cc where cc.modelo_id = mo.id and cc.enviado_corte))
      group by vv.variante_tecido_id`,
    [tenant, colecao],
  );
  return new Map(rows.map((r) => [r.vid as string, Number(r.nec)]));
}

async function necServidor(c: Client, tenant: string, colecao: string): Promise<Map<string, number>> {
  const { rows } = await c.query(
    `select variante_tecido_id vid, sum(nec_m)::float8 nec from public._plan_tecido_nec_variante_core($1, $2) group by 1`,
    [tenant, colecao],
  );
  return new Map(rows.map((r) => [r.vid as string, Number(r.nec)]));
}

const somaSlot = async (c: Client, slot: string) =>
  new Map(
    (
      await c.query(
        `select vv.variante_tecido_id vid, sum(coalesce(mt.consumo,0)*coalesce(vv.grade_total,0)*coalesce(vv.multiplicador,1))::float8 nec
           from plan_tecido_materiais mt join plan_tecido_variantes vv on vv.material_id = mt.id
          where mt.slot_id = $1 and vv.variante_tecido_id is not null group by 1`,
        [slot],
      )
    ).rows.map((r) => [r.vid as string, Number(r.nec)]),
  );

/** Muda o status do Dev; `plan` (opcional) muda o do Planejamento. Sem `plan`, sair de Reprovado no Dev também tira o
 *  Reprovado do Planejamento (→ 'planejado'), senão o card seguiria reprovado pela P-213 A. */
const setStatus = async (c: Client, modelo: string, st: string | null, plan?: string | null) => {
  await c.query(`update modelos set status_desenvolvimento = $2 where id = $1`, [modelo, st]);
  if (plan !== undefined) await c.query(`update modelos set status_planejamento = $2 where id = $1`, [modelo, plan]);
  else if ((st ?? "").toLowerCase() !== "reprovado")
    await c.query(`update modelos set status_planejamento = 'planejado' where id = $1 and lower(coalesce(status_planejamento,'')) = 'reprovado'`, [modelo]);
};
const REPROV = (a: string) =>
  `(lower(coalesce(${a}.status_desenvolvimento,'')) = 'reprovado' or lower(coalesce(${a}.status_planejamento,'')) = 'reprovado')`;

const mapaIgual = (a: Map<string, number>, b: Map<string, number>) => {
  const ks = new Set([...a.keys(), ...b.keys()]);
  for (const k of ks) expect(a.get(k) ?? 0, `variante ${k}`).toBeCloseTo(b.get(k) ?? 0, 4);
};

describe.skipIf(!RODA)("P-198 A no servidor — card reprovado fora da necessidade/comprometido (20261025400000)", () => {
  it("guarda: textos de depois + ACL inalterada (_core sem EXECUTE p/ PUBLIC/anon/authenticated; wrapper só authenticated)", async () => {
    await withTx(async (c) => {
      for (const [f, md5] of Object.entries(MD5_DEPOIS)) {
        const r = await um<{ md5: string; pub: boolean; anon: boolean; auth: boolean }>(
          c,
          `select md5(pg_get_functiondef($1::regprocedure)) md5,
                  exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                           where p.oid = $1::regprocedure and x.grantee = 0 and x.privilege_type = 'EXECUTE') pub,
                  has_function_privilege('anon', $1, 'EXECUTE') anon,
                  has_function_privilege('authenticated', $1, 'EXECUTE') auth`,
          [f],
        );
        expect(r, f).toEqual({ md5, pub: false, anon: false, auth: false });
      }
      const w = await um<{ anon: boolean; auth: boolean }>(
        c,
        `select has_function_privilege('anon', $1, 'EXECUTE') anon, has_function_privilege('authenticated', $1, 'EXECUTE') auth`,
        [SIT_WRAP],
      );
      expect(w).toEqual({ anon: false, auth: true });
    });
  });

  it("necessidade: card reprovado (qualquer caixa) sai; vaga sem card e os demais ficam; ao sair de Reprovado volta a contar", async () => {
    await withTx(async (c) => {
      const a = await alvo(c);
      const doSlot = await somaSlot(c, a.slot);
      // 1) reprovado (caixa diferente: o predicado é lower(...))
      await setStatus(c, a.modelo, "Reprovado");
      const comRep = await necServidor(c, a.tenant, a.colecao);
      mapaIgual(comRep, await necEsperada(c, a.tenant, a.colecao));
      // 2) sai de Reprovado → volta a contar exatamente a necessidade da vaga (status NULL = 1a coluna; sempre aceito)
      await setStatus(c, a.modelo, null);
      const semRep = await necServidor(c, a.tenant, a.colecao);
      mapaIgual(semRep, await necEsperada(c, a.tenant, a.colecao));
      for (const [vid, m] of doSlot) expect((semRep.get(vid) ?? 0) - (comRep.get(vid) ?? 0), vid).toBeCloseTo(m, 4);
      // e o predicado é o do servidor: lower('REPROVADO') também sai
      await setStatus(c, a.modelo, "REPROVADO");
      mapaIgual(await necServidor(c, a.tenant, a.colecao), comRep);
    });
  });

  it("prévia (A comprar / Fazer pedido) segue a necessidade nova; seleção só com o reprovado = necessidade 0", async () => {
    await withTx(async (c) => {
      const a = await alvo(c);
      await setStatus(c, a.modelo, "reprovado");
      const prev = (await um<{ p: Previa }>(c, `select public._plan_tecido_previa_pedido_core($1,$2) p`, [a.tenant, a.colecao])).p;
      const nec = await necServidor(c, a.tenant, a.colecao);
      for (const r of prev.cobertura)
        expect(Number(r.nec_m), r.variante_tecido_id).toBeCloseTo(nec.get(r.variante_tecido_id) ?? 0, 4);
      const sel = (await um<{ p: Previa }>(c, `select public._plan_tecido_previa_pedido_core($1,$2,$3) p`, [a.tenant, a.colecao, [a.slot]])).p;
      expect(sel.cobertura).toEqual([]);
      expect(sel.fornecedores).toEqual([]);
    });
  });

  it("Situação por OC: comprometida_m ignora card reprovado enviado à Explosão; a LISTA de OCs não muda", async () => {
    await withTx(async (c) => {
      const l = await um<{ tenant: string; colecao: string; modelo: string; item: string; q: number } | undefined>(
        c,
        `select m.tenant_id tenant, m.colecao_id colecao, m.id modelo, l.oc_tecido_item_id item, sum(l.quantidade_m)::float8 q
           from modelo_tecido_oc_links l join modelos m on m.id = l.modelo_id
           join ocs_tecido_itens it on it.id = l.oc_tecido_item_id and coalesce(it.cancelado,false) = false and it.variante_tecido_id is not null
           join ocs_tecido oc on oc.id = it.oc_tecido_id and not coalesce(oc.is_rolo,false)
          where m.enviado_cad and m.colecao_id is not null and coalesce(l.quantidade_m,0) > 0
            and not ${REPROV("m")}
            and not exists (select 1 from cad cc where cc.modelo_id = m.id and cc.enviado_corte)
          group by 1,2,3,4 order by 5 desc, 4 limit 1`,
      );
      if (!l) throw new Error("copia sem vinculo de card enviado a Explosao com quantidade_m (fixture)");
      // a Situação não devolve o id do item: soma as linhas da MESMA OC×variante do item (e o esperado idem)
      const sit = async () =>
        (
          await c.query(`select coalesce(sum(s.comprometida_m),0)::float8 comp from public._plan_tecido_situacao_ocs_core($1,$2) s
                          join ocs_tecido_itens it on it.oc_tecido_id = s.oc_tecido_id and it.variante_tecido_id = s.variante_tecido_id
                         where it.id = $3`, [l.tenant, l.colecao, l.item])
        ).rows[0] as { comp: number };
      const nLinhas = Number((await um<{ n: number }>(c, `select count(*)::int n from ocs_tecido_itens i2 join ocs_tecido_itens it
            on it.oc_tecido_id = i2.oc_tecido_id and it.variante_tecido_id = i2.variante_tecido_id and coalesce(i2.cancelado,false) = false
         where it.id = $1`, [l.item])).n);
      const qEsperado = Number((await um<{ q: number }>(c, `select coalesce(sum(lk.quantidade_m),0)::float8 q
           from modelo_tecido_oc_links lk join ocs_tecido_itens i2 on i2.id = lk.oc_tecido_item_id and coalesce(i2.cancelado,false) = false
           join ocs_tecido_itens it on it.oc_tecido_id = i2.oc_tecido_id and it.variante_tecido_id = i2.variante_tecido_id
          where it.id = $1 and lk.modelo_id = $2`, [l.item, l.modelo])).q);
      expect(qEsperado).toBeGreaterThanOrEqual(l.q);
      const lista = async () =>
        (await c.query(`select distinct oc_tecido_id from public._plan_tecido_situacao_ocs_core($1,$2) order by 1`, [l.tenant, l.colecao])).rows;
      const stOriginal = (await um<{ st: string | null }>(c, `select status_desenvolvimento st from modelos where id = $1`, [l.modelo])).st;
      const antes = await sit();
      const listaAntes = await lista();
      await setStatus(c, l.modelo, "reprovado");
      const rep = await sit();
      // cada linha da OC×variante soma o comprometido do SEU item; com 1 linha por item, o delta = vínculos do card
      expect(nLinhas).toBeGreaterThan(0);
      expect(antes.comp - rep.comp).toBeCloseTo(qEsperado, 4);
      expect(antes.comp - rep.comp).toBeGreaterThan(0);
      expect(await lista()).toEqual(listaAntes);
      await setStatus(c, l.modelo, stOriginal); // volta à coluna de antes (o guarda do kanban recusa coluna fora do fluxo)
      expect((await sit()).comp).toBeCloseTo(antes.comp, 4);
    });
  });

  it("anti-drift TS×SQL: necVivoPorVariante(arvoreDaDemanda(árvore, reprovados)) = nec_m da prévia; 'a comprar' vivo = déficit", async () => {
    await withTx(async (c) => {
      const a = await alvo(c);
      for (const st of ["reprovado", null]) {
        await setStatus(c, a.modelo, st);
        const arv = (await um<{ a: PtArvore }>(c, `select public._plan_tecido_arvore_core($1) a`, [a.colecao])).a;
        const { rows } = await c.query(
          `select m.id, m.status_desenvolvimento st, m.status_planejamento sp, exists (select 1 from cad cc where cc.modelo_id = m.id and cc.enviado_corte) cortado
             from modelos m where m.colecao_id = $1 and m.tenant_id = $2`, [a.colecao, a.tenant]);
        const reprovados = new Set(rows.filter((r) => reprovadoSaiDaDemanda(r.st, r.sp, r.cortado)).map((r) => r.id as string));
        expect(reprovados.has(a.modelo)).toBe(st === "reprovado");
        const vivo = necVivoPorVariante(arvoreDaDemanda(arv, reprovados));
        const prev = (await um<{ p: Previa }>(c, `select public._plan_tecido_previa_pedido_core($1,$2) p`, [a.tenant, a.colecao])).p;
        const cob: CoberturaVarRow[] = prev.cobertura.map((r) => ({
          artigo_id: r.artigo_id, variante_tecido_id: r.variante_tecido_id, nec_m: Number(r.nec_m), deficit_m: Number(r.deficit_m),
        }));
        for (const r of cob) expect(vivo.get(r.variante_tecido_id!) ?? 0, `${st} ${r.variante_tecido_id}`).toBeCloseTo(r.nec_m, 4);
        // toda variante com necessidade viva aparece na cobertura do servidor (nada some de um lado só)
        const noServidor = new Set(cob.map((r) => r.variante_tecido_id));
        for (const [vid, m] of vivo) if (m > 0) expect(noServidor.has(vid), `${st} ${vid}`).toBe(true);
        const defPorArtigo = new Map<string, number>();
        for (const r of cob) if (r.deficit_m > 0) defPorArtigo.set(r.artigo_id, (defPorArtigo.get(r.artigo_id) ?? 0) + r.deficit_m);
        const aComprar = aComprarVivoPorArtigo(cob, vivo);
        mapaIgual(aComprar, defPorArtigo);
      }
    });
  });
  it("M1 — OC órfã ligada SÓ pelo hint da vaga de um card reprovado não abate o 'a comprar' de outro card; ao sair de Reprovado volta a abater", async () => {
    await withTx(async (c) => {
      // OC (não rolo, órfã) cujos ÚNICOS vínculos/hints com a coleção são de cards reprovados não cortados
      // (na cópia: 10109118, 139,7 kg, Resort 27 Novo, pelo hint da vaga do VESTIDO AURELIA + aplicada pura).
      const o = await um<{ tenant: string; colecao: string; oc: string; numero: string; modelo: string; vid: string; pedida: number } | undefined>(
        c,
        `with lig as (
           select so.colecao_id, so.oc_tecido_id, hm.id modelo, hm.status_desenvolvimento st, hm.status_planejamento sp from plan_tecido_slot_oc so
             left join plan_tecido_slots hs on hs.id = so.slot_id left join modelos hm on hm.id = hs.modelo_id
           union all
           select m.colecao_id, it.oc_tecido_id, m.id, m.status_desenvolvimento, m.status_planejamento from modelo_tecido_oc_links l
             join modelos m on m.id = l.modelo_id join ocs_tecido_itens it on it.id = l.oc_tecido_item_id
         )
         select oc.tenant_id tenant, lig.colecao_id colecao, oc.id oc, oc.numero_pedido numero, min(lig.modelo::text)::uuid modelo,
                (select it.variante_tecido_id from ocs_tecido_itens it where it.oc_tecido_id = oc.id and coalesce(it.cancelado,false) = false
                    and it.variante_tecido_id is not null order by it.quantidade_pedida desc limit 1) vid,
                (select sum(case when a.unidade_medida = 'kg' then coalesce(it.quantidade_pedida,0) * coalesce(a.rendimento,0)
                                 else coalesce(it.quantidade_pedida,0) end)::float8 from ocs_tecido_itens it join artigos a on a.id = it.artigo_id
                  where it.oc_tecido_id = oc.id and coalesce(it.cancelado,false) = false
                    and it.variante_tecido_id = (select it2.variante_tecido_id from ocs_tecido_itens it2 where it2.oc_tecido_id = oc.id
                      and coalesce(it2.cancelado,false) = false and it2.variante_tecido_id is not null order by it2.quantidade_pedida desc limit 1)) pedida
           from lig join ocs_tecido oc on oc.id = lig.oc_tecido_id and not coalesce(oc.is_rolo,false)
          where lig.colecao_id is not null
            and not exists (select 1 from plan_tecido_ocs po where po.oc_tecido_id = oc.id)  -- órfã (sem dona): ligada cobre a pedida cheia
            -- (aplicada pura pode existir: é só acompanhamento, has_card=false — não cobre)
          group by oc.tenant_id, lig.colecao_id, oc.id, oc.numero_pedido
         having bool_and((lower(coalesce(lig.st,'')) = 'reprovado' or lower(coalesce(lig.sp,'')) = 'reprovado')
                         and not exists (select 1 from cad cc where cc.modelo_id = lig.modelo and cc.enviado_corte))
            and count(distinct lig.modelo) = 1
          order by (oc.numero_pedido = '10109118') desc, oc.id limit 1`,
      );
      if (!o?.vid || !(o.pedida > 0)) throw new Error("copia sem OC ligada so por card reprovado (fixture 10109118)");
      // um card ATIVO da mesma coleção passa a precisar da variante (10 pç × consumo do material)
      const mat = await um<{ id: string; consumo: number; ordem: number } | undefined>(
        c,
        `select mt.id, mt.consumo::float8 consumo, coalesce((select max(v.ordem) from plan_tecido_variantes v where v.material_id = mt.id), 0) ordem
           from plan_tecido p join plan_tecido_subcolecoes s on s.plan_id = p.id join plan_tecido_linhas l on l.sub_id = s.id
           join plan_tecido_slots sl on sl.linha_ref_id = l.id join plan_tecido_materiais mt on mt.slot_id = sl.id
           left join modelos m on m.id = sl.modelo_id
          where p.colecao_id = $1 and coalesce(mt.consumo,0) > 0 and not ${REPROV("m")}
          order by sl.id, mt.id limit 1`,
        [o.colecao],
      );
      if (!mat) throw new Error("colecao sem card ativo com material (fixture)");
      await c.query(
        `insert into plan_tecido_variantes (tenant_id, material_id, variante_tecido_id, ordem, multiplicador, grade_total) values ($1,$2,$3,$4,1,10)`,
        [o.tenant, mat.id, o.vid, mat.ordem + 1],
      );
      const linhaVid = async () => {
        const prev = (await um<{ p: Previa }>(c, `select public._plan_tecido_previa_pedido_core($1,$2) p`, [o.tenant, o.colecao])).p;
        return prev.cobertura.find((r) => r.variante_tecido_id === o.vid)!;
      };
      const comRep = await linhaVid();
      const nec = Number(comRep.nec_m);
      expect(nec).toBeGreaterThan(0);
      expect(nec).toBeLessThan(o.pedida); // a OC sozinha cobriria tudo se ligasse
      expect(Number(comRep.deficit_m)).toBeCloseTo(nec, 4); // M1: a OC órfã do reprovado não cobre o ativo
      await setStatus(c, o.modelo, null); // sai de Reprovado → o hint volta a ligar a OC (órfã: pedida cheia)
      const semRep = await linhaVid();
      expect(Number(semRep.deficit_m)).toBeCloseTo(0, 4);
    });
  });

  it("M2 — reprovado JÁ enviado ao corte continua na necessidade e no comprometido; voltar o corte o tira", async () => {
    await withTx(async (c) => {
      const a = await um<{ tenant: string; colecao: string; slot: string; modelo: string; item: string; q: number } | undefined>(
        c,
        `select p.tenant_id tenant, p.colecao_id colecao, sl.id slot, m.id modelo, l2.oc_tecido_item_id item, sum(l2.quantidade_m)::float8 q
           from plan_tecido p join plan_tecido_subcolecoes s on s.plan_id = p.id join plan_tecido_linhas l on l.sub_id = s.id
           join plan_tecido_slots sl on sl.linha_ref_id = l.id join modelos m on m.id = sl.modelo_id and m.enviado_cad
           join cad cc on cc.modelo_id = m.id and cc.enviado_corte
           join modelo_tecido_oc_links l2 on l2.modelo_id = m.id and coalesce(l2.quantidade_m,0) > 0
           join ocs_tecido_itens it on it.id = l2.oc_tecido_item_id and coalesce(it.cancelado,false) = false and it.variante_tecido_id is not null
           join ocs_tecido oc on oc.id = it.oc_tecido_id and not coalesce(oc.is_rolo,false)
          where p.colecao_id = m.colecao_id
            and exists (select 1 from plan_tecido_materiais mt join plan_tecido_variantes vv on vv.material_id = mt.id
                         where mt.slot_id = sl.id and vv.variante_tecido_id is not null and coalesce(mt.consumo,0) * coalesce(vv.grade_total,0) > 0)
          group by 1,2,3,4,5 order by 6 desc, 3 limit 1`,
      );
      if (!a) throw new Error("copia sem card cortado com vinculo e necessidade (fixture)");
      const comp = async () =>
        Number((await um<{ comp: number }>(c, `select coalesce(sum(s.comprometida_m),0)::float8 comp from public._plan_tecido_situacao_ocs_core($1,$2) s
            join ocs_tecido_itens it on it.oc_tecido_id = s.oc_tecido_id and it.variante_tecido_id = s.variante_tecido_id where it.id = $3`,
          [a.tenant, a.colecao, a.item])).comp);
      const nec0 = await necServidor(c, a.tenant, a.colecao);
      const comp0 = await comp();
      await setStatus(c, a.modelo, "reprovado");
      mapaIgual(await necServidor(c, a.tenant, a.colecao), nec0); // cortado: consumo real segue contando
      expect(await comp()).toBeCloseTo(comp0, 4);
      mapaIgual(await necServidor(c, a.tenant, a.colecao), await necEsperada(c, a.tenant, a.colecao));
      // corte desfeito (enviado_corte=false) → agora sai
      await c.query(`update cad set enviado_corte = false where modelo_id = $1`, [a.modelo]);
      const nec1 = await necServidor(c, a.tenant, a.colecao);
      mapaIgual(nec1, await necEsperada(c, a.tenant, a.colecao));
      const doSlot = await somaSlot(c, a.slot);
      for (const [vid, m] of doSlot) expect((nec0.get(vid) ?? 0) - (nec1.get(vid) ?? 0), vid).toBeCloseTo(m, 4);
      expect(comp0 - (await comp())).toBeGreaterThanOrEqual(a.q - 1e-6);
    });
  });
  it("P-213 A — card reprovado SÓ no Planejamento sai da necessidade (servidor = esperado); reprovado em nenhum conta", async () => {
    await withTx(async (c) => {
      const a = await alvo(c);
      const doSlot = await somaSlot(c, a.slot);
      await setStatus(c, a.modelo, null, "reprovado"); // Dev ativo, Planejamento reprovado
      const soPlan = await necServidor(c, a.tenant, a.colecao);
      mapaIgual(soPlan, await necEsperada(c, a.tenant, a.colecao));
      await setStatus(c, a.modelo, null, "planejado"); // reprovado em nenhum
      const nenhum = await necServidor(c, a.tenant, a.colecao);
      mapaIgual(nenhum, await necEsperada(c, a.tenant, a.colecao));
      for (const [vid, m] of doSlot) expect((nenhum.get(vid) ?? 0) - (soPlan.get(vid) ?? 0), vid).toBeCloseTo(m, 4);
    });
  });
});
