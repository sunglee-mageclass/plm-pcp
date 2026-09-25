import { describe, it, expect } from "vitest";
import { emptyDraft, draftFromModeloRow, tamanhoTipoNormalizado } from "@/components/planejamento/modelo-shared";
import { serializeSnapshot, snapshotsEqual } from "@/hooks/useDirtySnapshot";
import { aplicarRegrasCamposDev } from "@/components/planejamento/planejamento-detail/helpers";

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
  it("Minor (5)/rodada 2 — tamanhoTipoNormalizado (helper exportado, reusado por PlanejamentoDetail.tsx p/ 'Tamanho em' SALVO) casa exatamente com o que draftFromModeloRow grava no Draft", () => {
    expect(tamanhoTipoNormalizado("numero")).toBe("numero");
    expect(tamanhoTipoNormalizado("letra")).toBe("letra");
    expect(tamanhoTipoNormalizado(null)).toBe("letra");
    expect(tamanhoTipoNormalizado(undefined)).toBe("letra");
    expect(tamanhoTipoNormalizado("cm")).toBe("letra");
    // Mesma função por dentro: normalizar a MESMA linha do servidor pelas duas rotas dá o MESMO valor.
    const linha = { tamanho_tipo: null };
    expect(draftFromModeloRow(linha).tamanho_tipo).toBe(tamanhoTipoNormalizado(linha.tamanho_tipo));
  });
  it("P-25 — card EXISTENTE vindo com tamanho_tipo NULL do servidor (legado, antes da migration T6): o baseline do dirty-guard normaliza igual ao draft semeado (não abre sujo à toa) E o payload do Salvar grava 'letra'", () => {
    // Espelha o fluxo real: PlanejamentoDetail.tsx semeia `freshDraft = draftFromModeloRow(modeloData)` (linha
    // ~737) E baseliza o dirty-guard com ESSE MESMO `freshDraft` (`resetDraftBaseline(freshDraft)`, linha ~745) —
    // não com `modeloData` cru. Card legado: a LINHA do servidor tem `tamanho_tipo: null`, mas o DRAFT semeado a
    // partir dela já normaliza para "letra" (rede de proteção do front) — então draft === baseline, sem "sujo".
    const linhaServidorLegado = { id: "m1", nome: "Vestido X", ref: "REF1", tamanho_tipo: null };
    const freshDraft = draftFromModeloRow(linhaServidorLegado);
    const baseline = draftFromModeloRow(linhaServidorLegado); // mesma função = mesmo baseline do orquestrador
    expect(freshDraft.tamanho_tipo).toBe("letra");
    expect(snapshotsEqual(freshDraft, baseline)).toBe(true);
    expect(serializeSnapshot(freshDraft)).toBe(serializeSnapshot(baseline));

    // O payload do Salvar nasce de `aplicarRegrasCamposDev({...d, ...}, d, {...})` (usePlanejamentoSave.ts) — o
    // spread `{...d}` carrega `tamanho_tipo` para o payload SEM `aplicarRegrasCamposDev` tocá-lo (não está em
    // CAMPOS_DEV_DRAFT nem é normalizado ali) — então o payload grava exatamente o que o Draft já normalizou.
    const payload = aplicarRegrasCamposDev({ ...freshDraft }, freshDraft, { podeEditarDev: true, refEditavel: true });
    expect(payload.tamanho_tipo).toBe("letra");
  });
});

describe("Draft F3.6 (Parte B) — Título, Peso/medidas, NCM e Preço anterior", () => {
  const NOVOS = ["titulo_pagina", "peso_kg", "comprimento_cm", "largura_cm", "altura_cm", "ncm", "preco_anterior"] as const;
  it("emptyDraft: os 7 nascem null (NULL = automático / vazio)", () => {
    const d = emptyDraft();
    for (const k of NOVOS) expect(d[k]).toBeNull();
  });
  it("draftFromModeloRow lê as colunas (?? null)", () => {
    const d = draftFromModeloRow({
      titulo_pagina: "Título à mão", peso_kg: 0.35, comprimento_cm: 60, largura_cm: 40, altura_cm: 2.5, ncm: "6204.43.00", preco_anterior: 199.9,
    });
    expect(d).toMatchObject({
      titulo_pagina: "Título à mão", peso_kg: 0.35, comprimento_cm: 60, largura_cm: 40, altura_cm: 2.5, ncm: "6204.43.00", preco_anterior: 199.9,
    });
  });
  it("linha vazia ≡ emptyDraft nos 7 (senão o card abriria 'não salvo' à toa)", () => {
    const a = draftFromModeloRow({});
    const b = emptyDraft();
    for (const k of NOVOS) expect(a[k]).toEqual(b[k]);
  });
});
