// Etapas PL, Fase 1, Task 3 — salvar_terceirizados persiste os campos de Peça Teste
// (pt_data_saida, pt_data_entrada, pt_aprovacao) a partir do bloco jsonb. Segue o
// modelo de rpc-producao.test.ts / grade-cortada.test.ts (BEGIN…ROLLBACK; nada é
// gravado). Usa um CAD "limpo" do tenant teste (tecido principal, sem bloco de
// serviço) e cria a própria categoria "PL" — tudo desfeito no ROLLBACK.
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import type { Client } from "pg";

type Setup = { cadId: string; catId: string };

/** Acha um CAD do tenant teste sem bloco de serviço (para round-trip isolado) e cria
 *  uma categoria "PL" (casa em _categoria_eh_pl via token 'pl'). */
async function setupPL(c: Client): Promise<Setup | null> {
  const cad = await um<{ id: string } | undefined>(
    c,
    `select id from cad where tenant_id = $1
       and not exists (select 1 from producao_terceirizados pt where pt.cad_id = cad.id)
     limit 1`,
    [TENANT_TESTE],
  );
  if (!cad) return null;
  const cat = await um<{ id: string }>(
    c,
    `insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1,'PL Teste',true) returning id`,
    [TENANT_TESTE],
  );
  return { cadId: cad.id, catId: cat.id };
}

describe.skipIf(!hasDb)("salvar_terceirizados — campos de Peça Teste (pt_*)", () => {
  it("grava pt_data_saida/pt_data_entrada/pt_aprovacao do bloco PL (round-trip)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); // USER_TESTE = super_admin
      const s = await setupPL(c);
      if (!s) return; // sem CAD no tenant teste → não falha

      const bloco = {
        categoria_terceirizado_id: s.catId,
        interno: true,
        ativo: true,
        pt_data_saida: "2026-08-01",
        pt_data_entrada: "2026-08-10",
        pt_aprovacao: "aprovado",
      };
      await c.query(`select public.salvar_terceirizados($1,$2::jsonb,null,null)`, [
        s.cadId,
        JSON.stringify([bloco]),
      ]);

      const row = await um<{ saida: string; entrada: string; aprov: string }>(
        c,
        `select to_char(pt_data_saida,'YYYY-MM-DD') as saida,
                to_char(pt_data_entrada,'YYYY-MM-DD') as entrada,
                pt_aprovacao as aprov
           from producao_terceirizados where cad_id = $1`,
        [s.cadId],
      );
      expect(row.saida).toBe("2026-08-01");
      expect(row.entrada).toBe("2026-08-10");
      expect(row.aprov).toBe("aprovado");
    });
  });

  it("bloco sem os campos pt_* grava NULL (INSERT e UPDATE)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await setupPL(c);
      if (!s) return;

      // INSERT sem os campos pt_*.
      const blocoSemCampos = {
        categoria_terceirizado_id: s.catId,
        interno: true,
        ativo: true,
      };
      await c.query(`select public.salvar_terceirizados($1,$2::jsonb,null,null)`, [
        s.cadId,
        JSON.stringify([blocoSemCampos]),
      ]);

      let row = await um<{ id: string; saida: string | null; entrada: string | null; aprov: string | null }>(
        c,
        `select id, pt_data_saida as saida, pt_data_entrada as entrada, pt_aprovacao as aprov
           from producao_terceirizados where cad_id = $1`,
        [s.cadId],
      );
      expect(row.saida).toBeNull();
      expect(row.entrada).toBeNull();
      expect(row.aprov).toBeNull();

      // UPDATE do mesmo bloco (agora COM id) preenchendo os campos, depois removendo-os de novo
      // (string vazia via NULLIF) confirma que o UPDATE SET também trata ausência/'' como NULL.
      const blocoComCampos = {
        id: row.id,
        categoria_terceirizado_id: s.catId,
        interno: true,
        ativo: true,
        pt_data_saida: "2026-08-05",
        pt_data_entrada: "2026-08-15",
        pt_aprovacao: "reprovado",
      };
      await c.query(`select public.salvar_terceirizados($1,$2::jsonb,null,null)`, [
        s.cadId,
        JSON.stringify([blocoComCampos]),
      ]);
      row = await um(
        c,
        `select id, to_char(pt_data_saida,'YYYY-MM-DD') as saida, to_char(pt_data_entrada,'YYYY-MM-DD') as entrada, pt_aprovacao as aprov
           from producao_terceirizados where cad_id = $1`,
        [s.cadId],
      );
      expect(row.saida).toBe("2026-08-05");
      expect(row.entrada).toBe("2026-08-15");
      expect(row.aprov).toBe("reprovado");

      // Bloco vazio de novo (string '') volta a NULL via UPDATE.
      const blocoLimpo = {
        id: row.id,
        categoria_terceirizado_id: s.catId,
        interno: true,
        ativo: true,
        pt_data_saida: "",
        pt_data_entrada: "",
        pt_aprovacao: "",
      };
      await c.query(`select public.salvar_terceirizados($1,$2::jsonb,null,null)`, [
        s.cadId,
        JSON.stringify([blocoLimpo]),
      ]);
      row = await um(
        c,
        `select id, pt_data_saida as saida, pt_data_entrada as entrada, pt_aprovacao as aprov
           from producao_terceirizados where cad_id = $1`,
        [s.cadId],
      );
      expect(row.saida).toBeNull();
      expect(row.entrada).toBeNull();
      expect(row.aprov).toBeNull();
    });
  });
});
