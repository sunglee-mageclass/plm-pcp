import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import type { Client } from "pg";

// Casar variantes — Fatia 2 (Task 3): prova a reserva pelo par casado.
//
// Migração 20260826120000_casar_variantes_fatia2_reserva.sql: um bloco de tecido
// complementar (ex.: Forro) casado com variantes do Tecido 1 via
// modelo_tecido_variantes.complementa_variante_ids passa a reservar pela SOMA das
// grades das cores do Tecido 1 casadas, em vez da grade da própria posição. Bloco
// complementar SEM casamento e o próprio Tecido 1 continuam reservando pela grade
// POSICIONAL (comportamento pré-mudança). A fórmula é duplicada em
// _estoque_tecido_core (SSOT) e no espelho detalhe_estoque_variante — este teste
// prova as duas.
//
// Cenário controlado (BEGIN…ROLLBACK), modelo isolado (nome único ITEST-CASAR):
//   Tecido 1 (numero=1,tipo='tecido'): ordem 1 = T1A (grade 50), ordem 2 = T1B (grade 30)
//   Forro   (numero=1,tipo='forro', consumo=2, loss_percent=10):
//     ordem 1 = F-casada  (complementa_variante_ids = {T1A,T1B}, multiplicador=2)
//       reserva esperada = 2 × 1.10 × (50+30) × 2 = 352
//     ordem 3 = F-solta   (complementa_variante_ids = NULL, multiplicador=1;
//                          usa o slot posicional 3, com grade_total=999 nesse slot)
//       reserva esperada = 2 × 1.10 × 999 × 1 = 2197.8  (grade PRÓPRIA da posição, não a soma)
//   Tecido 1 em si reserva pela própria grade (50 e 30), sem qualquer soma de par.

async function ligarCriacao(c: Client) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

// artigo do tenant com >=1 variante existente (reusa cadastro real; cria variantes
// extras isoladas via INSERT direto — não precisamos de cor/apelido específicos).
async function artigoBase(c: Client) {
  return await um<{ id: string } | undefined>(c, `select id from artigos where tenant_id=$1 limit 1`, [TENANT_TESTE]);
}

async function novaVariante(c: Client, artigoId: string) {
  return (
    await um<{ id: string }>(
      c,
      `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1,$2,'ITEST-CASAR-VAR') returning id`,
      [TENANT_TESTE, artigoId],
    )
  ).id;
}

async function reservadoCore(c: Client, varianteId: string): Promise<number> {
  return Number(
    (
      await um<{ m: string }>(
        c,
        `select coalesce(reservado,0) m from public._estoque_tecido_core($1) where variante_tecido_id=$2`,
        [TENANT_TESTE, varianteId],
      )
    )?.m ?? 0,
  );
}

describe.skipIf(!hasDb)("casar variantes (Fatia 2) — reserva pelo par casado", () => {
  it("bloco complementar CASADO reserva pela SOMA das grades do Tecido 1; SEM casar e o Tecido 1 mantêm a grade posicional", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);

      const art = await artigoBase(c);
      if (!art) return; // sem artigo cadastrado na Loja Teste → nada a provar

      const t1A = await novaVariante(c, art.id);
      const t1B = await novaVariante(c, art.id);
      const fCasada = await novaVariante(c, art.id);
      const fSolta = await novaVariante(c, art.id);

      const mod = await um<{ id: string }>(
        c,
        `insert into modelos (tenant_id, nome) values ($1,'ITEST-CASAR') returning id`,
        [TENANT_TESTE],
      );

      // Tecido 1: numero=1, tipo='tecido'. consumo=1/loss=0 p/ isolar a grade na conta
      // do próprio Tecido 1 (reserva = 1 × 1 × grade × mult = grade × mult).
      const mtTecido = await um<{ id: string }>(
        c,
        `insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) values ($1,$2,1,'tecido',1,0) returning id`,
        [mod.id, art.id],
      );
      await c.query(
        `insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador) values ($1,$2,1,1)`,
        [mtTecido.id, t1A],
      );
      await c.query(
        `insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador) values ($1,$2,2,1)`,
        [mtTecido.id, t1B],
      );

      // Grades por SLOT (variante_numero = ordem, compartilhado entre Tecido 1 e Forro):
      // slot 1 = 50 (grade da T1A), slot 2 = 30 (grade da T1B), slot 3 = 999 (grade
      // POSICIONAL do slot da forra solta — nenhuma variante do Tecido 1 ocupa o slot 3;
      // prova que a forra solta usa a grade da SUA posição, não a soma do par).
      await c.query(`insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1,1,'{"M":50}'::jsonb,50)`, [mod.id]);
      await c.query(`insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1,2,'{"M":30}'::jsonb,30)`, [mod.id]);
      await c.query(`insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1,3,'{"M":999}'::jsonb,999)`, [mod.id]);

      // Forro: numero=1, tipo='forro'. consumo=2, loss_percent=10 (fator 2×1.10=2.2).
      const mtForro = await um<{ id: string }>(
        c,
        `insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) values ($1,$2,1,'forro',2,10) returning id`,
        [mod.id, art.id],
      );
      // ordem 1 = CASADA com {T1A,T1B}, multiplicador=2.
      await c.query(
        `insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids)
         values ($1,$2,1,2,ARRAY[$3,$4]::uuid[])`,
        [mtForro.id, fCasada, t1A, t1B],
      );
      // ordem 3 = SEM casar (complementa_variante_ids NULL), multiplicador=1 → usa o slot 3 (999).
      await c.query(
        `insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador) values ($1,$2,3,1)`,
        [mtForro.id, fSolta],
      );

      // ── Asserção 1: Forro CASADO reserva pela SOMA (50+30=80) × consumo×(1+loss/100) × mult
      // = 2 × 1.10 × 80 × 2 = 352 — NÃO pela grade da própria posição (que nem existe: a ordem 1
      // do Forro não tem modelo_grades próprio nesse teste além do slot 1=50, que é da T1A).
      const reservaCasada = await reservadoCore(c, fCasada);
      expect(reservaCasada).toBeCloseTo(352, 4);

      // ── Asserção 2: Forro SEM casar reserva pela grade POSICIONAL do seu slot (3 → 999),
      // idêntico ao comportamento pré-mudança: 2 × 1.10 × 999 × 1 = 2197.8.
      const reservaSolta = await reservadoCore(c, fSolta);
      expect(reservaSolta).toBeCloseTo(2197.8, 4);

      // ── Asserção 3: o Tecido 1 em si reserva pela PRÓPRIA grade (sem soma de par):
      // T1A (slot 1) = 1 × 1 × 50 × 1 = 50; T1B (slot 2) = 1 × 1 × 30 × 1 = 30.
      const reservaT1A = await reservadoCore(c, t1A);
      const reservaT1B = await reservadoCore(c, t1B);
      expect(reservaT1A).toBeCloseTo(50, 4);
      expect(reservaT1B).toBeCloseTo(30, 4);

      // ── Asserção 4: detalhe_estoque_variante concorda com _estoque_tecido_core para a
      // forra CASADA, no caminho por OC-link (modelo_tecido_oc_links). Cria uma OC
      // 'encomendado' com 1 item da variante casada e liga via modelo_tecido_oc_links
      // (tipo/numero do bloco Forro, ordem=1 → mesma variante f Casada).
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp) return; // sem empresa cadastrada → pula só a asserção 4 (1-3 já provaram o núcleo)

      const oc = await um<{ id: string }>(
        c,
        `insert into ocs_tecido (tenant_id, numero_pedido, empresa_id, status) values ($1,'ITEST-CASAR-OC',$2,'encomendado') returning id`,
        [TENANT_TESTE, emp.id],
      );
      const item = await um<{ id: string }>(
        c,
        `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida)
         values ($1,$2,1,$3,10) returning id`,
        [oc.id, art.id, fCasada],
      );
      await c.query(
        `insert into modelo_tecido_oc_links (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m)
         values ($1,$2,'forro',1,1,$3,$4,10)`,
        [TENANT_TESTE, mod.id, fCasada, item.id],
      );

      const detalhe = await um<{ j: any }>(c, `select public.detalhe_estoque_variante($1) j`, [fCasada]);
      const linhas: any[] = detalhe.j as any[];
      const reservadoDetalhe = linhas.reduce((s, l) => s + Number(l.reservado_m ?? 0), 0);
      const reservadoCoreVal = await reservadoCore(c, fCasada);
      expect(reservadoDetalhe).toBeCloseTo(reservadoCoreVal, 4);
      expect(reservadoDetalhe).toBeCloseTo(352, 4);
    });
  });
});
