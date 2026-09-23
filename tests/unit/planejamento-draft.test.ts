import { describe, it, expect } from "vitest";
import { emptyDraft, draftFromModeloRow } from "@/components/planejamento/modelo-shared";

// F3.1 — o Draft do Planejamento ganha os campos simples vindos do Desenvolvimento + a Descrição do produto.
// A etapa (`status_desenvolvimento`) continua FORA do Draft (muda só pelo "Mover para…" do selo).
const UUIDS = ["modelista_id", "piloteiro1_id", "piloteiro2_id", "piloteiro3_id"] as const;
const TEXTOS = [
  "data_piloto1", "data_piloto2", "data_piloto3", "data_desenho_tecnico", "data_aprovacao",
  "observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url", "descricao_produto",
] as const;

describe("Draft F3.1", () => {
  it("emptyDraft: uuids null, datas/textos vazios e SEM status_desenvolvimento", () => {
    const d = emptyDraft();
    for (const k of UUIDS) expect(d[k]).toBeNull();
    for (const k of TEXTOS) expect(d[k]).toBe("");
    expect(d).not.toHaveProperty("status_desenvolvimento");
  });
  it("draftFromModeloRow lê as colunas e normaliza null → '' (datas/textos) e ausente → null (uuids)", () => {
    const d = draftFromModeloRow({
      nome: "X", modelista_id: "m1", piloteiro2_id: null, data_piloto1: "2026-09-12", data_piloto2: null,
      observacoes_tecnicas: null, motivo_cancelamento: "Tecido esgotado", ficha_medida_url: "t/fichas/a.pdf",
      descricao_produto: "Vestido midi", status_desenvolvimento: "reprovado",
    });
    expect(d.modelista_id).toBe("m1");
    expect(d.piloteiro2_id).toBeNull();
    expect(d.piloteiro3_id).toBeNull();
    expect(d.data_piloto1).toBe("2026-09-12");
    expect(d.data_piloto2).toBe("");
    expect(d.observacoes_tecnicas).toBe("");
    expect(d.motivo_cancelamento).toBe("Tecido esgotado");
    expect(d.ficha_medida_url).toBe("t/fichas/a.pdf");
    expect(d.descricao_produto).toBe("Vestido midi");
    expect(d).not.toHaveProperty("status_desenvolvimento");
  });
  it("linha vazia ≡ emptyDraft nos campos novos (senão o card abriria 'não salvo' à toa)", () => {
    const a = draftFromModeloRow({});
    const b = emptyDraft();
    for (const k of [...UUIDS, ...TEXTOS]) expect(a[k]).toEqual(b[k]);
  });
});
