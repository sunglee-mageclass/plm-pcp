import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RPC_KANBAN } from "@/lib/kanban-auto-ui";

// Contrato F1 × F2 sem banco: as telas chamam EXATAMENTE as RPCs/colunas que as migrations da F1 criam.
// Pula enquanto a migration 4 (F1 Tasks 15–16) não existir; o G-commit da F2 exige que RODE e PASSE.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG1 = path.join(ROOT, "supabase/migrations/20260930120000_kanban_auto_1_schema.sql");
const MIG4 = path.join(ROOT, "supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql");
const TEM4 = fs.existsSync(MIG4);

describe("contrato F1 × F2 — coluna da chave", () => {
  it("migration 1 cria tenant_config.kanban_automatico (default false)", () => {
    expect(fs.readFileSync(MIG1, "utf8")).toContain("ADD COLUMN IF NOT EXISTS kanban_automatico boolean NOT NULL DEFAULT false");
  });
});

describe.skipIf(!TEM4)("contrato F1 × F2 — RPCs públicas que as telas chamam", () => {
  const sql = TEM4 ? fs.readFileSync(MIG4, "utf8") : "";
  for (const [nome, r] of Object.entries(RPC_KANBAN)) {
    it(`${nome}: assinatura, GRANT a authenticated e campos do retorno`, () => {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${r.assinatura}`);
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${r.nome}\\([^)]*\\) TO authenticated`));
      for (const campo of r.campos) expect(sql, `${r.nome} devolve '${campo}'`).toContain(`'${campo}'`);
    });
  }
});
