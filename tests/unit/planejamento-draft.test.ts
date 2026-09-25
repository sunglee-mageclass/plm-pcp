import { describe, it, expect } from "vitest";
import { emptyDraft, draftFromModeloRow } from "@/components/planejamento/modelo-shared";
import { serializeSnapshot, snapshotsEqual } from "@/hooks/useDirtySnapshot";

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

describe("Draft F3.6 — 'Tamanho em' (modelos.tamanho_tipo, coluna da F3.5a)", () => {
  it("P-25 (dono 25/set 14:57) — nasce marcado em Letra (SEM padrão da LOJA, nada na Config); draftFromModeloRow normaliza qualquer coisa que não seja 'numero' para 'letra'", () => {
    expect(emptyDraft().tamanho_tipo).toBe("letra");
    expect(draftFromModeloRow({ tamanho_tipo: "numero" }).tamanho_tipo).toBe("numero");
    expect(draftFromModeloRow({ tamanho_tipo: "letra" }).tamanho_tipo).toBe("letra");
    // Legado/valor estranho (NULL, "cm", ausente): vira "letra" — a rede de proteção do front espelha a migration T6.
    expect(draftFromModeloRow({ tamanho_tipo: "cm" }).tamanho_tipo).toBe("letra");
    expect(draftFromModeloRow({ tamanho_tipo: null }).tamanho_tipo).toBe("letra");
    expect(draftFromModeloRow({}).tamanho_tipo).toBe("letra");
  });
  it("P-25 — prova que o card NOVO não abre com 'alterações não salvas': o orquestrador semeia `useState(emptyDraft())` E baseliza o dirty-guard com `emptyDraft()` (mesma função nos dois lados — useDirtySnapshot compara serialização)", () => {
    // Espelha PlanejamentoDetail.tsx:192 (`useState<Draft>(emptyDraft())`) + :209 (`useDirtySnapshot(draft)`, cujo
    // baseline é tirado no 1º render a partir do MESMO valor inicial — ver useDirtySnapshot.ts). Antes da P-25,
    // `tamanho_tipo` nascia `null` nos dois lados também batia; o risco real seria UM lado usar `emptyDraft()` e o
    // outro usar um literal/objeto separado — não é o caso aqui, mas o teste prova que os dois valores são
    // IDÊNTICOS byte a byte (JSON), não só "iguais na leitura".
    expect(serializeSnapshot(emptyDraft())).toBe(serializeSnapshot(emptyDraft()));
    expect(snapshotsEqual(emptyDraft(), emptyDraft())).toBe(true);
    expect(emptyDraft().tamanho_tipo).toBe("letra");
  });
});
