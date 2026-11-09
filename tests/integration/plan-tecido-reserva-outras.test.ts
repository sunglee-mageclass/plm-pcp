// EST visual (Plan. Tecido), Task 1 — migration 20261117100000_est_reserva_outras:
// `_plan_tecido_previa_pedido_core` passa a expor, SÓ para exibição, `reserva_outras_m` em cada linha de `cobertura`
// = GREATEST(0, reservado do `_estoque_tecido_core` − reserva DESTA coleção) por variante. ADITIVO: nada de compra muda
// (necessidade_m/estoque_m/deficit_m/qtd/fornecedores/sem_fornecedor/bloqueios/outras_colecoes ficam IDÊNTICOS ao F3.1).
// Integração em BEGIN…ROLLBACK (withTx), SÓ na cópia local (54422) — o anti-drift cria uma função temporária (pg_temp,
// desfeita no ROLLBACK) com o corpo EXATO do F3.1 (guardado no _down) para comparar saída antiga × nova.
// Dado real da cópia: Ave Rara + RESORT 27 / FALL 27 (variante d0172d77 compartilhada: 1870,58 + 1932,34 = 3802,91).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { hasDb, withTx, ehBancoLocal, comoUsuario } from "./db";

const RODA = hasDb && ehBancoLocal();
const PREVIA = "public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])";
const MD5_F31 = "dd563e5789b0dbd1cffc02299d154bf5"; // F3.1 (texto de partida)
// Ave Rara (dado real da cópia local)
const TENANT = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const USER = "174518a5-569f-4954-9010-24204b345508";
const RESORT = "890e16dc-0926-4cf4-adf4-cdb82d28205a";
const FALL = "1ca99bd1-c5d9-4c63-8bdf-b4225392d0b7";
const VAR_COMPARTILHADA = "d0172d77-e3e9-4c33-8ead-330a526193a2";

type Cob = {
  artigo_id: string; variante_tecido_id: string; label: string; nec_m: number; estoque_m: number; deficit_m: number;
  recebido_m: number; prev_receb_m: number; fisico_m: number; reserva_outras_m?: number;
};
type Previa = {
  fornecedores: unknown[]; sem_fornecedor: unknown[]; cobertura: Cob[]; bloqueios: unknown[]; outras_colecoes: unknown[];
};

async function previa(c: Client, colecao: string, slots: string[] | null = null): Promise<Previa> {
  const { rows } = await c.query(`select ${PREVIA.replace("(uuid,uuid,uuid[])", "")}($1,$2,$3::uuid[]) as p`, [TENANT, colecao, slots]);
  return rows[0].p as Previa;
}

/** Corpo EXATO do F3.1 (guardado no _down da EST), criado como função TEMPORÁRIA (pg_temp) para comparar saídas. */
async function criaPreviaF31(c: Client): Promise<void> {
  const down = readFileSync(resolve(__dirname, "../../supabase/rollback/20261117100000_est_reserva_outras_down.sql"), "utf8");
  const m = down.match(/CREATE OR REPLACE FUNCTION public\._plan_tecido_previa_pedido_core[\s\S]*?end \$function\$;/);
  if (!m) throw new Error("corpo do F3.1 nao encontrado no _down da EST");
  await c.query(m[0].replace("public._plan_tecido_previa_pedido_core", "pg_temp._est_previa_f31"));
}

/** Remove a chave ADICIONADA (reserva_outras_m) para comparar com o F3.1. */
function semChaveEst(p: Previa): unknown {
  return { ...p, cobertura: p.cobertura.map(({ reserva_outras_m: _r, ...l }) => (void _r, l)) };
}

/** Espelho INDEPENDENTE da `reserva_mod` do `_estoque_tecido_core`, agrupado por (variante, coleção) — coleção null = cards avulsos. */
const SQL_RESERVA_POR_COLECAO = `
  select mv.variante_tecido_id v, m.colecao_id col,
         sum(coalesce(mt.consumo,0) * (1 + coalesce(mt.loss_percent,0)/100.0)
             * case when mt.tipo = 'tecido' and mt.numero = 1 then coalesce(g.gt,0)
                    when mv.complementa_variante_ids is not null and cardinality(mv.complementa_variante_ids) > 0
                      then public._grade_soma_pares(mt.modelo_id, mv.complementa_variante_ids)
                    else coalesce(g.gt,0) end
             * coalesce(mv.multiplicador,1))::float8 m
    from modelo_tecido_variantes mv
    join modelo_tecidos mt on mt.id = mv.modelo_tecido_id
    join modelos m on m.id = mt.modelo_id and m.tenant_id = $1
     and lower(coalesce(m.status_desenvolvimento,'')) <> 'reprovado'
     and lower(coalesce(m.status_planejamento,'')) <> 'reprovado'
     and not exists (select 1 from cad c where c.modelo_id = m.id and c.enviado_corte)
    left join (select modelo_id, variante_numero, sum(coalesce(grade_total,0)) gt from modelo_grades
                where variante_numero is not null group by 1,2) g
      on g.modelo_id = mt.modelo_id and g.variante_numero = mv.ordem
   where mv.variante_tecido_id is not null
   group by mv.variante_tecido_id, m.colecao_id`;

describe.skipIf(!RODA)("EST — prévia expõe reserva_outras_m (aditivo, compra intocada)", () => {
  it("a função viva é a nova (md5 != F3.1) e continua sem EXECUTE para anon/authenticated (inv. #9)", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select md5(pg_get_functiondef($1::regprocedure)) md5,
                has_function_privilege('anon', $1::regprocedure, 'EXECUTE') anon,
                has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') auth`, [PREVIA]);
      expect(rows[0].md5, "migration EST aplicada na cópia").not.toBe(MD5_F31);
      expect(rows[0].anon).toBe(false);
      expect(rows[0].auth).toBe(false);
    });
  });

  it("(a) expõe reserva_outras_m (número >= 0) em cada linha da cobertura — pelo wrapper, como usuário da Ave Rara", async () => {
    await withTx(async (c) => {
      await comoUsuario(c, USER);
      const { rows } = await c.query(`select public.plan_tecido_previa_pedido($1, null) as p`, [RESORT]);
      const cobertura = (rows[0].p as Previa).cobertura;
      expect(cobertura.length).toBeGreaterThan(0);
      for (const l of cobertura) {
        expect(l, `reserva_outras_m presente (${l.label})`).toHaveProperty("reserva_outras_m");
        expect(typeof l.reserva_outras_m).toBe("number");
        expect(Number(l.reserva_outras_m)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it("(b) COMPRA INTOCADA: tudo exceto reserva_outras_m é IDÊNTICO ao F3.1 (todas as coleções, com e sem seleção de vagas)", async () => {
    await withTx(async (c) => {
      await criaPreviaF31(c);
      let comparadas = 0;
      const { rows: cols } = await c.query(`select p.colecao_id id from plan_tecido p where p.tenant_id = $1 order by p.colecao_id`, [TENANT]);
      expect(cols.length, "fixture: Ave Rara precisa ter planos de tecido").toBeGreaterThan(0);
      for (const col of cols) {
        const { rows: sl } = await c.query(
          `select sl.id from plan_tecido p join plan_tecido_subcolecoes s on s.plan_id = p.id
             join plan_tecido_linhas l on l.sub_id = s.id join plan_tecido_slots sl on sl.linha_ref_id = l.id
            where p.colecao_id = $1 and p.tenant_id = $2 order by sl.id limit 3`, [col.id, TENANT]);
        for (const slots of [null, sl.map((r) => r.id as string)]) {
          const novo = await previa(c, col.id, slots);
          const { rows } = await c.query(`select pg_temp._est_previa_f31($1,$2,$3::uuid[]) as p`, [TENANT, col.id, slots]);
          expect(semChaveEst(novo), `${col.id} slots=${slots ? "sel" : "todos"}`).toEqual(rows[0].p);
          comparadas++;
        }
      }
      expect(comparadas).toBeGreaterThan(0);
    });
  });

  it("(c) caso real RESORT 27: AZUL - INDIGO segue nec 2742,48 / estoque 0 / déficit 0", async () => {
    await withTx(async (c) => {
      const p = await previa(c, RESORT);
      const l = p.cobertura.find((x) => /AZUL\s*-\s*INDIGO/i.test(x.label));
      expect(l, "AZUL - INDIGO na cobertura").toBeTruthy();
      expect(Number(l!.nec_m)).toBeCloseTo(2742.48, 1);
      expect(Number(l!.estoque_m)).toBeCloseTo(0, 1);
      expect(Number(l!.deficit_m)).toBeCloseTo(0, 1);
    });
  });

  it("(d) variante compartilhada d0172d77: reserva_outras = a da OUTRA coleção; Σ das duas = reservado total do core (3802,91)", async () => {
    await withTx(async (c) => {
      const { rows: est } = await c.query(`select reservado::float8 r from public._estoque_tecido_core($1) where variante_tecido_id = $2`, [TENANT, VAR_COMPARTILHADA]);
      expect(est[0].r).toBeCloseTo(3802.91, 1);
      const outrasResort = (await previa(c, RESORT)).cobertura.find((l) => l.variante_tecido_id === VAR_COMPARTILHADA);
      expect(outrasResort, "variante compartilhada na cobertura do RESORT 27").toBeTruthy();
      // RESORT reserva 1870,58 → "outras" = 3802,91 − 1870,58 = 1932,33 (= o que o FALL 27 reserva)
      expect(Number(outrasResort!.reserva_outras_m)).toBeCloseTo(1932.34, 1);
      expect(Number(outrasResort!.reserva_outras_m) + 1870.58).toBeCloseTo(est[0].r, 1);
      const outrasFall = (await previa(c, FALL)).cobertura.find((l) => l.variante_tecido_id === VAR_COMPARTILHADA);
      if (outrasFall) {
        expect(Number(outrasFall.reserva_outras_m)).toBeCloseTo(1870.58, 1);
        expect(Number(outrasFall.reserva_outras_m) + 1932.34).toBeCloseTo(est[0].r, 1);
      }
    });
  });

  it("(e) anti-drift da fórmula: Σ por coleção (espelho da reserva_mod) = reservado do core − reserva de OS, e reserva_outras = reservado − desta, em TODA linha", async () => {
    await withTx(async (c) => {
      const { rows: res } = await c.query(SQL_RESERVA_POR_COLECAO, [TENANT]);
      const soma = new Map<string, number>();
      const desta = new Map<string, number>(); // `${colecao}|${variante}`
      for (const r of res) {
        soma.set(r.v, (soma.get(r.v) ?? 0) + Number(r.m));
        if (r.col) desta.set(`${r.col}|${r.v}`, Number(r.m));
      }
      const { rows: core } = await c.query(
        `select e.variante_tecido_id v, e.reservado::float8 r,
                coalesce((select sum(coalesce(oi.reserva,0))::float8
                            from ordens_saida_tecido_itens oi
                            join ordens_saida_tecido os on os.id = oi.ordem_saida_id and os.tenant_id = $1 and not os.baixado
                           where oi.variante_tecido_id = e.variante_tecido_id), 0) os
           from public._estoque_tecido_core($1) e`, [TENANT]);
      let variantesComReserva = 0;
      for (const r of core) {
        const esperado = soma.get(r.v) ?? 0;
        expect(esperado + r.os, `Σ colecoes + OS = reservado (${r.v})`).toBeCloseTo(r.r, 4);
        if (esperado > 0) variantesComReserva++;
      }
      expect(variantesComReserva, "fixture: ha variantes reservadas").toBeGreaterThan(0);

      const reservadoCore = new Map<string, number>(core.map((r) => [r.v as string, r.r as number]));
      let linhas = 0, comOutras = 0;
      for (const colecao of [RESORT, FALL]) {
        for (const l of (await previa(c, colecao)).cobertura) {
          const total = reservadoCore.get(l.variante_tecido_id) ?? 0;
          const esperado = Math.max(0, total - (desta.get(`${colecao}|${l.variante_tecido_id}`) ?? 0));
          expect(Number(l.reserva_outras_m), `reserva_outras_m ${colecao}/${l.label}`).toBeCloseTo(esperado, 4);
          linhas++;
          if (esperado > 0) comOutras++;
        }
      }
      expect(linhas).toBeGreaterThan(0);
      expect(comOutras, "fixture: ha linha com reserva de outras coleções").toBeGreaterThan(0);
    });
  });
});
