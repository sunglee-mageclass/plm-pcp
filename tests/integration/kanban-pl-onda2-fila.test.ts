/**
 * Kanban PL configuravel - Onda 2, Tasks 2/3/4/5 (fila + enfileiradores + gatilhos-fonte; processador no COMMIT;
 * aplicador + historico; e2e fila->processador->aplicador).
 *
 * SO BANCO; `etapas_pl_automatico` default false. Tudo em BEGIN...ROLLBACK (`withTx`) e SO na copia local
 * (`ehBancoLocal`): a migration 20261127110000_etapas_pl_fila.sql e aplicada no banco ANTES da suite (gate
 * `psql -f`), e cada teste roda contra o estado vivo numa txn revertida. O gatilho adiado so dispara no COMMIT;
 * dentro da txn revertida usamos `SET CONSTRAINTS ALL IMMEDIATE` para forca-lo (senao nao dispara e o teste e inutil).
 * NUNCA `\i` migration em txn de teste (incidente 15/set); DDL so na copia local (incidente 23/set).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, comoUsuario, ehBancoLocal, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;

/** Acha um modelo da loja que tenha um bloco producao_terceirizados (via cad). Txn revertida. */
async function modeloComBlocoPt(c: Client): Promise<{ modeloId: string; ptId: string }> {
  const r = await c.query(
    `select m.id as modelo_id, pt.id as pt_id
       from modelos m
       join cad c on c.modelo_id = m.id
       join producao_terceirizados pt on pt.cad_id = c.id
      where m.tenant_id = $1
      order by m.id
      limit 1`,
    [T],
  );
  return { modeloId: r.rows[0].modelo_id as string, ptId: r.rows[0].pt_id as string };
}

async function poeNoPl(c: Client, modeloId: string, status = "peca_teste"): Promise<void> {
  await c.query(`update modelos set status_etapa_pl = $2 where id = $1`, [modeloId, status]);
}

async function naFila(c: Client, modeloId: string): Promise<number> {
  return Number(
    (await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_recalculo_fila where modelo_id=$1`, [modeloId])).n,
  );
}

// ───────────────────────── Task 2 — fila + enfileiradores + gatilhos-fonte ─────────────────────────
describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 2 - fila (Task 2)", () => {
  it("chave ligada + modelo no PL: editar producao_terceirizados enfileira", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=true where tenant_id=$1`, [T]);
      const { modeloId, ptId } = await modeloComBlocoPt(c);
      await poeNoPl(c, modeloId);
      // edita um bloco de servico do modelo -> gatilho statement-level por cad_id enfileira
      await c.query(`update producao_terceirizados set ativo = coalesce(ativo, true) where id=$1`, [ptId]);
      expect(await naFila(c, modeloId)).toBe(1);
    });
  });

  it("chave desligada: nada enfileira", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=false where tenant_id=$1`, [T]);
      const { modeloId, ptId } = await modeloComBlocoPt(c);
      await poeNoPl(c, modeloId);
      await c.query(`update producao_terceirizados set ativo = coalesce(ativo, true) where id=$1`, [ptId]);
      expect(await naFila(c, modeloId)).toBe(0); // chave off -> fila vazia
    });
  });

  it("modelo FORA do PL (status_etapa_pl NULL): nao enfileira mesmo com chave ligada", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=true where tenant_id=$1`, [T]);
      const { modeloId, ptId } = await modeloComBlocoPt(c);
      await c.query(`update modelos set status_etapa_pl = NULL where id=$1`, [modeloId]);
      await c.query(`update producao_terceirizados set ativo = coalesce(ativo, true) where id=$1`, [ptId]);
      expect(await naFila(c, modeloId)).toBe(0); // nao esta no PL -> fora
    });
  });

  it("editar modelos.status_etapa_pl (entrar no PL) enfileira com chave ligada", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=true where tenant_id=$1`, [T]);
      const { modeloId } = await modeloComBlocoPt(c);
      await c.query(`update modelos set status_etapa_pl = NULL where id=$1`, [modeloId]);
      // zera a fila que o update acima possa ter gerado
      await c.query(`delete from etapas_pl_recalculo_fila where modelo_id=$1`, [modeloId]);
      await c.query(`update modelos set status_etapa_pl = 'peca_teste' where id=$1`, [modeloId]);
      expect(await naFila(c, modeloId)).toBe(1);
    });
  });

  it("fila REVOKE ALL dos 3 (sem SELECT para authenticated)", async () => {
    await withTx(async (c) => {
      const r = await um<{ sel: boolean }>(
        c,
        `select has_table_privilege('authenticated','public.etapas_pl_recalculo_fila','SELECT') sel`,
      );
      expect(r.sel).toBe(false);
    });
  });
});

// ───────────────────────── Task 4 — aplicador + historico ─────────────────────────
describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 2 - aplicador + historico (Task 4)", () => {
  it("_etapas_pl_aplicar grava a derivada em status_etapa_pl e nao re-enfileira (recursao cortada)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(
        `update tenant_config set etapas_pl_automatico=true,
           etapas_pl_kanban='["Peça Teste","Separação de Materiais","Oficina"]'::jsonb,
           etapas_pl_requisitos='{}'::jsonb
         where tenant_id=$1`,
        [T],
      );
      const { modeloId } = await modeloComBlocoPt(c);
      // comeca numa coluna arbitraria (a derivada vai recalcular); limpa fila residual do setup
      await poeNoPl(c, modeloId, "oficina");
      await c.query(`delete from etapas_pl_recalculo_fila where modelo_id=$1`, [modeloId]);

      // alvo derivado esperado
      const der = await um<{ resultado: string; derivavel: boolean }>(
        c,
        `select resultado, derivavel from _etapas_pl_derivar_lote($1, ARRAY[$2]::uuid[]) limit 1`,
        [T, modeloId],
      );
      expect(der.derivavel).toBe(true);

      const n = (await um<{ n: number }>(c, `select _etapas_pl_aplicar($1, ARRAY[$2]::uuid[], 'auto', NULL) n`, [T, modeloId])).n;

      const st = (await um<{ s: string }>(c, `select status_etapa_pl s from modelos where id=$1`, [modeloId])).s;
      expect(st).toBe(der.resultado); // gravou a derivada
      expect(Number(n)).toBe(der.resultado === "oficina" ? 0 : 1); // count de mudancas coerente

      // recursao: o UPDATE do aplicador rodou com app.etapas_pl_sistema setado -> enfileiradoras saem cedo -> fila vazia
      expect(await naFila(c, modeloId)).toBe(0);

      // historico: se mudou, ha linha nova com a nova coluna e origem 'auto'
      if (der.resultado !== "oficina") {
        const h = (
          await um<{ n: string }>(
            c,
            `select count(*)::text n from modelo_etapa_pl_historico where modelo_id=$1 and status=$2 and origem='auto'`,
            [modeloId, der.resultado],
          )
        ).n;
        expect(Number(h)).toBeGreaterThanOrEqual(1);
      }
    });
  });

  it("_etapas_pl_aplicar restaura as GUCs ao valor anterior", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=true where tenant_id=$1`, [T]);
      const { modeloId } = await modeloComBlocoPt(c);
      await poeNoPl(c, modeloId, "peca_teste");
      await c.query(`select set_config('app.etapas_pl_sistema','', true), set_config('app.etapas_pl_lote','', true)`);
      await c.query(`select _etapas_pl_aplicar($1, ARRAY[$2]::uuid[], 'auto', NULL)`, [T, modeloId]);
      const g = await um<{ sis: string; lote: string }>(
        c,
        `select coalesce(current_setting('app.etapas_pl_sistema', true),'') sis,
                coalesce(current_setting('app.etapas_pl_lote', true),'') lote`,
      );
      expect(g.sis).toBe(""); // restaurada
      expect(g.lote).toBe("");
    });
  });

  it("_etapas_pl_aplicar rejeita origem invalida (ASCII)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=true where tenant_id=$1`, [T]);
      const { modeloId } = await modeloComBlocoPt(c);
      await poeNoPl(c, modeloId, "peca_teste");
      await c.query("SAVEPOINT t");
      let erro: any = null;
      try {
        await c.query(`select _etapas_pl_aplicar($1, ARRAY[$2]::uuid[], 'manual', NULL)`, [T, modeloId]);
      } catch (e) {
        erro = e;
      }
      await c.query("ROLLBACK TO SAVEPOINT t");
      expect(erro).not.toBeNull();
      expect(String(erro.message)).toMatch(/origem invalida/);
    });
  });

  it("_etapas_pl_aplicar e interna (sem EXECUTE para authenticated)", async () => {
    await withTx(async (c) => {
      const r = await um<{ ex: boolean }>(
        c,
        `select has_function_privilege('authenticated','public._etapas_pl_aplicar(uuid,uuid[],text,uuid)','EXECUTE') ex`,
      );
      expect(r.ex).toBe(false);
    });
  });

  it("enfileiradoras e funcoes de gatilho sem EXECUTE para authenticated (invariante #9)", async () => {
    await withTx(async (c) => {
      const sigs = [
        "public._etapas_pl_enfileirar(uuid[])",
        "public._etapas_pl_enfileirar_tenant(uuid)",
        "public.fn_etapas_pl_fila_modelo()",
        "public.fn_etapas_pl_fila_por_modelo()",
        "public.fn_etapas_pl_fila_por_cad()",
        "public.fn_etapas_pl_fila_cad()",
        "public.fn_etapas_pl_fila_categoria()",
        "public.fn_etapas_pl_historico()",
      ];
      for (const sig of sigs) {
        for (const role of ["authenticated", "anon"]) {
          const r = await um<{ ex: boolean }>(
            c,
            `select has_function_privilege($1, $2, 'EXECUTE') ex`,
            [role, sig],
          );
          expect(r.ex, `${role} nao deve executar ${sig}`).toBe(false);
        }
      }
    });
  });

  // Task 3 — CONSTRAINT TRIGGER adiado: processa a fila no COMMIT (forcado via SET CONSTRAINTS ALL
  // IMMEDIATE dentro da txn revertida, senao o DEFERRED nao dispara).
  it("fila processa no COMMIT e deriva status_etapa_pl (SET CONSTRAINTS ALL IMMEDIATE)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(
        `update tenant_config set etapas_pl_automatico=true,
           etapas_pl_kanban='["Peça Teste","Separação de Materiais","Oficina"]'::jsonb, etapas_pl_requisitos='{}'::jsonb
         where tenant_id=$1`,
        [T],
      );
      const { modeloId } = await modeloComBlocoPt(c);
      await poeNoPl(c, modeloId, "oficina");
      await c.query(`delete from etapas_pl_recalculo_fila where modelo_id=$1`, [modeloId]);
      const der = await um<{ resultado: string }>(c, `select resultado from _etapas_pl_derivar_lote($1, ARRAY[$2]::uuid[]) limit 1`, [T, modeloId]);

      // enfileira e forca o processamento adiado
      await c.query(`insert into etapas_pl_recalculo_fila (modelo_id, tenant_id) values ($1,$2) on conflict do nothing`, [modeloId, T]);
      await c.query(`set constraints all immediate`); // dispara o CONSTRAINT TRIGGER adiado AQUI

      const st = (await um<{ s: string }>(c, `select status_etapa_pl s from modelos where id=$1`, [modeloId])).s;
      expect(st).toBe(der.resultado); // o processador rodou _etapas_pl_aplicar
      expect(await naFila(c, modeloId)).toBe(0); // fila drenada
    });
  });

  it("fn_etapas_pl_processar_fila e interna (REVOKE dos 3)", async () => {
    await withTx(async (c) => {
      const r = await um<{ ex: boolean }>(
        c,
        `select has_function_privilege('authenticated','public.fn_etapas_pl_processar_fila()','EXECUTE') ex`,
      );
      expect(r.ex).toBe(false);
    });
  });

  it("os 2 CONSTRAINT TRIGGERs sao DEFERRABLE INITIALLY DEFERRED", async () => {
    await withTx(async (c) => {
      const r = await c.query(
        `select tgname, tgdeferrable, tginitdeferred from pg_trigger
          where tgname in ('trg_etapas_pl_processar_fila','trg_etapas_pl_processar_fila_upd') order by tgname`,
      );
      expect(r.rows.length).toBe(2);
      for (const t of r.rows) { expect(t.tgdeferrable).toBe(true); expect(t.tginitdeferred).toBe(true); }
    });
  });

  // Task 5 — e2e pelo GATILHO REAL: editar um bloco de servico (gatilho statement-level) enfileira,
  // e no "COMMIT" (SET CONSTRAINTS ALL IMMEDIATE) o processador deriva status_etapa_pl. Caminho
  // completo fila->processador->aplicador, com a recursao cortada (fila fica vazia no fim).
  it("e2e: editar bloco -> enfileira -> COMMIT processa -> deriva (fila drenada, sem recursao)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(
        `update tenant_config set etapas_pl_automatico=true,
           etapas_pl_kanban='["Peça Teste","Separação de Materiais","Oficina"]'::jsonb, etapas_pl_requisitos='{}'::jsonb
         where tenant_id=$1`,
        [T],
      );
      const { modeloId, ptId } = await modeloComBlocoPt(c);
      await poeNoPl(c, modeloId, "oficina");
      await c.query(`delete from etapas_pl_recalculo_fila where modelo_id=$1`, [modeloId]);
      const der = await um<{ resultado: string }>(c, `select resultado from _etapas_pl_derivar_lote($1, ARRAY[$2]::uuid[]) limit 1`, [T, modeloId]);

      // GATILHO REAL: editar o bloco enfileira (sem insert manual)
      await c.query(`update producao_terceirizados set ativo = coalesce(ativo, true) where id=$1`, [ptId]);
      expect(await naFila(c, modeloId)).toBe(1);
      await c.query(`set constraints all immediate`); // dispara o processamento adiado

      const st = (await um<{ s: string }>(c, `select status_etapa_pl s from modelos where id=$1`, [modeloId])).s;
      expect(st).toBe(der.resultado);
      expect(await naFila(c, modeloId)).toBe(0); // recursao cortada: o aplicador nao re-enfileirou
    });
  });
});
