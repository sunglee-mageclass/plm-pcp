import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import type { Client } from "pg";
import {
  removerVarianteDoBloco,
  remapGradesAposRemocao,
  makeEmptyBlocks,
  type TecidoBlock,
  type GradeRow,
} from "@/components/desenvolvimento/modelo-detail/types";

// Item 13 (end-to-end, txn revertida): remover a variante do MEIO no Desenvolvimento
// remove SÓ a alvo, renumera as posteriores e a grade SEGUE a variante. Exercita a saída
// dos helpers puros do front (removerVarianteDoBloco + remapGradesAposRemocao) ATRAVÉS da
// RPC de persistência `salvar_modelo_bom` (posição → modelo_tecido_variantes.ordem;
// grade → modelo_grades.variante_numero).

const T = TENANT_TESTE;

// Monta o payload de tecidos igual ao front (ModeloDetailPanel): variantes = array de 10,
// multiplicadores todos 1 no Tecido 1, sem oc_links.
function tecidosPayload(artigoId: string, b: TecidoBlock) {
  return [{
    artigo_id: artigoId,
    numero: 1,
    tipo: "tecido",
    consumo: 1,
    loss_percent: 0,
    custo_previsto: 0,
    variantes: b.variantes,
    multiplicadores: b.variantes.map(() => 1),
    oc_links: [],
  }];
}
function gradesPayload(grades: GradeRow[]) {
  return grades.map((g) => ({ variante_numero: g.variante_numero, grades: g.grades, grade_total: g.grade_total }));
}
async function salvarBom(c: Client, modeloId: string, artigoId: string, b: TecidoBlock, grades: GradeRow[]) {
  await c.query(`SELECT public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, $3::jsonb, NULL)`, [
    modeloId,
    JSON.stringify(tecidosPayload(artigoId, b)),
    JSON.stringify(gradesPayload(grades)),
  ]);
}
async function lerVariantes(c: Client, modeloId: string) {
  const { rows } = await c.query(
    `SELECT mtv.ordem, mtv.variante_tecido_id
       FROM public.modelo_tecido_variantes mtv
       JOIN public.modelo_tecidos mt ON mt.id = mtv.modelo_tecido_id
      WHERE mt.modelo_id = $1 AND mt.tipo = 'tecido' AND mt.numero = 1
      ORDER BY mtv.ordem`,
    [modeloId],
  );
  return rows as { ordem: number; variante_tecido_id: string }[];
}
async function lerGrades(c: Client, modeloId: string) {
  const { rows } = await c.query(
    `SELECT variante_numero, grade_total FROM public.modelo_grades WHERE modelo_id = $1 ORDER BY variante_numero`,
    [modeloId],
  );
  return rows as { variante_numero: number; grade_total: number }[];
}

function bloco3(ids: string[]): TecidoBlock {
  const b = makeEmptyBlocks().find((x) => x.tipo === "tecido" && x.numero === 1)!;
  const variantes = [...b.variantes];
  ids.forEach((id, i) => (variantes[i] = id));
  return { ...b, variantes };
}
const grades3: GradeRow[] = [
  { variante_numero: 1, grades: { P: 10 }, grade_total: 10 },
  { variante_numero: 2, grades: { P: 20 }, grade_total: 20 },
  { variante_numero: 3, grades: { P: 30 }, grade_total: 30 },
];

async function fixtures(c: Client) {
  const art = await um<{ artigo_id: string }>(
    c,
    `SELECT artigo_id FROM public.variantes_tecido WHERE tenant_id = $1
      GROUP BY artigo_id HAVING count(*) >= 3 LIMIT 1`,
    [T],
  );
  if (!art) return null;
  const { rows: vs } = await c.query(
    `SELECT id FROM public.variantes_tecido WHERE artigo_id = $1 ORDER BY id LIMIT 3`,
    [art.artigo_id],
  );
  const m = await um<{ id: string }>(c, `SELECT id FROM public.modelos WHERE tenant_id = $1 LIMIT 1`, [T]);
  if (!m || vs.length < 3) return null;
  return { artigoId: art.artigo_id as string, ids: vs.map((r: any) => r.id as string), modeloId: m.id };
}

describe.skipIf(!hasDb)("Item 13 — remover variante do meio (splice + remap de grade) via salvar_modelo_bom", () => {
  it("remover v1: sobram v2/v3 renumeradas p/ 1/2 com SUAS grades (20/30)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixtures(c);
      if (!f) return; // sem dados → auto-skip
      const [A, B, C] = f.ids;

      await salvarBom(c, f.modeloId, f.artigoId, bloco3([A, B, C]), grades3);
      let vars = await lerVariantes(c, f.modeloId);
      expect(vars.map((v) => [v.ordem, v.variante_tecido_id])).toEqual([[1, A], [2, B], [3, C]]);
      expect(await lerGrades(c, f.modeloId)).toEqual([
        { variante_numero: 1, grade_total: 10 }, { variante_numero: 2, grade_total: 20 }, { variante_numero: 3, grade_total: 30 },
      ]);

      // Saída dos helpers do front ao remover a v1 (índice 0).
      const b2 = removerVarianteDoBloco(bloco3([A, B, C]), 0);
      const g2 = remapGradesAposRemocao(grades3, 1);
      await salvarBom(c, f.modeloId, f.artigoId, b2, g2);

      vars = await lerVariantes(c, f.modeloId);
      expect(vars.map((v) => [v.ordem, v.variante_tecido_id])).toEqual([[1, B], [2, C]]); // A saiu; B/C renumeradas
      expect(await lerGrades(c, f.modeloId)).toEqual([
        { variante_numero: 1, grade_total: 20 }, // era da B
        { variante_numero: 2, grade_total: 30 }, // era da C
      ]);
    });
  });

  it("remover a última (v3): sobram v1/v2 intactas (10/20), sem sobra de ordem/grade 3", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixtures(c);
      if (!f) return;
      const [A, B, C] = f.ids;

      await salvarBom(c, f.modeloId, f.artigoId, bloco3([A, B, C]), grades3);
      const b2 = removerVarianteDoBloco(bloco3([A, B, C]), 2);
      const g2 = remapGradesAposRemocao(grades3, 3);
      await salvarBom(c, f.modeloId, f.artigoId, b2, g2);

      const vars = await lerVariantes(c, f.modeloId);
      expect(vars.map((v) => [v.ordem, v.variante_tecido_id])).toEqual([[1, A], [2, B]]);
      expect(await lerGrades(c, f.modeloId)).toEqual([
        { variante_numero: 1, grade_total: 10 }, { variante_numero: 2, grade_total: 20 },
      ]);
    });
  });
});
