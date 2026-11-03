// R12 (front, parte 2): a aprovacao automatica de custo (versao nao ficou mais cara) aparece no SHEET do Planejamento.
//  - `moLiberadaPorCustoAuto` (puro): flag do servidor true + linha PENDENTE + rascunho de M.O. limpo + nenhuma reprovada;
//  - o gate do Lancar (`maoObraPendente` -> `moAprovada`) aceita a liberacao da R12 sem perder o caso de edicao nao salva;
//  - o selo "Custo liberado automaticamente" so aparece com a prop (R12); render real do MaoObraEditor.
import { describe, it, expect, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { MaoObraEditor } from "@/components/planejamento/MaoObraEditor";
import { estadoMO, moLinhaVaiReabrir, moLiberadaPorCustoAuto, TEXTO_CUSTO_LIBERADO_AUTO, type MoLinha } from "@/lib/mao-obra";
import { bloqueiosLancar, TEXTO_LANCAR_MO } from "@/lib/lancar";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const L = (aprovado: boolean | null, valor = 10, id = "l1"): MoLinha => ({ id, categoria_terceirizado_id: "c1", valor, aprovado });

// Mesma composicao do PlanejamentoDetail (maoObraPendente -> moAprovada do bloqueiosLancar).
function gate(flag: boolean | null, linhas: MoLinha[], base: MoLinha[]) {
  const moReabreAoSalvar = linhas.some((l) => l.id != null && moLinhaVaiReabrir(l, base.find((b) => b.id === l.id)));
  const est = estadoMO(linhas);
  const custoLiberadoAuto = moLiberadaPorCustoAuto({ flagServidor: flag, linhas, linhasBase: base, reabreAoSalvar: moReabreAoSalvar });
  const maoObraPendente = (!(est === "sem_servico" || est === "aprovada") || moReabreAoSalvar) && !custoLiberadoAuto;
  return { custoLiberadoAuto, faltas: bloqueiosLancar({ cqExigido: false, cqLiberado: true, moAprovada: !maoObraPendente, temData: true, moReabreAoSalvar }) };
}

describe("moLiberadaPorCustoAuto", () => {
  it("flag true + linha pendente + rascunho limpo = R12", () => {
    expect(moLiberadaPorCustoAuto({ flagServidor: true, linhas: [L(null)], linhasBase: [L(null)] })).toBe(true);
    expect(moLiberadaPorCustoAuto({ flagServidor: true, linhas: [L(true, 10, "a"), L(null, 5, "b")], linhasBase: [L(true, 10, "a"), L(null, 5, "b")] })).toBe(true);
  });
  it("linha REPROVADA nao libera nem mostra selo", () => {
    expect(moLiberadaPorCustoAuto({ flagServidor: true, linhas: [L(false)], linhasBase: [L(false)] })).toBe(false);
    expect(moLiberadaPorCustoAuto({ flagServidor: true, linhas: [L(false, 10, "a"), L(null, 5, "b")], linhasBase: [L(false, 10, "a"), L(null, 5, "b")] })).toBe(false);
  });
  it("sem nenhuma linha: sem selo (nao ha M.O.)", () => {
    expect(moLiberadaPorCustoAuto({ flagServidor: true, linhas: [], linhasBase: [] })).toBe(false);
  });
  it("todas aprovadas: e a aprovacao normal, nao a R12 (sem selo)", () => {
    expect(moLiberadaPorCustoAuto({ flagServidor: true, linhas: [L(true)], linhasBase: [L(true)] })).toBe(false);
  });
  it("flag false/null/undefined nunca libera", () => {
    for (const f of [false, null, undefined]) expect(moLiberadaPorCustoAuto({ flagServidor: f, linhas: [L(null)], linhasBase: [L(null)] })).toBe(false);
  });
  it("edicao de M.O. nao salva (flag velho): NAO libera", () => {
    expect(moLiberadaPorCustoAuto({ flagServidor: true, linhas: [L(null, 99)], linhasBase: [L(null, 10)] })).toBe(false); // valor mudou
    expect(moLiberadaPorCustoAuto({ flagServidor: true, linhas: [L(null), { ...L(null, 5, "n"), id: null }], linhasBase: [L(null)] })).toBe(false); // linha nova
    expect(moLiberadaPorCustoAuto({ flagServidor: true, linhas: [L(null)], linhasBase: [L(null), L(null, 1, "z")] })).toBe(false); // linha removida
    expect(moLiberadaPorCustoAuto({ flagServidor: true, linhas: [L(null)], linhasBase: [L(null)], reabreAoSalvar: true })).toBe(false);
  });
});

describe("gate do Lancar no Sheet", () => {
  it("R12: flag true + linha pendente => Lancar nao pede mais a M.O.", () => {
    const r = gate(true, [L(null)], [L(null)]);
    expect(r.custoLiberadoAuto).toBe(true);
    expect(r.faltas).toEqual([]);
  });
  it("sem a R12 (flag false) a linha pendente continua pedindo a M.O.", () => {
    expect(gate(false, [L(null)], [L(null)]).faltas).toEqual([TEXTO_LANCAR_MO]);
  });
  it("linha reprovada continua bloqueando mesmo com flag velho true", () => {
    expect(gate(true, [L(false)], [L(false)]).faltas).toEqual([TEXTO_LANCAR_MO]);
  });
  it("reprovou agora (aprovacao imediata, flag ainda velho): bloqueia", () => {
    expect(gate(true, [L(false)], [L(false)]).custoLiberadoAuto).toBe(false);
  });
  it("editando a M.O. sem salvar: o rascunho manda, nao libera sobre flag velho", () => {
    expect(gate(true, [L(null, 99)], [L(null, 10)]).faltas).toEqual([TEXTO_LANCAR_MO]);
  });
  it("linha aprovada alterada e nao salva: segue o 'salve antes' (nunca libera)", () => {
    const r = gate(true, [L(true, 99)], [L(true, 10)]);
    expect(r.custoLiberadoAuto).toBe(false);
    expect(r.faltas.length).toBe(1);
  });
  it("sem servico e todas aprovadas seguem liberadas como hoje", () => {
    expect(gate(false, [], []).faltas).toEqual([]);
    expect(gate(true, [L(true)], [L(true)]).faltas).toEqual([]);
  });
});

describe("fonte do Sheet", () => {
  const src = readFileSync(ROOT + "src/components/planejamento/PlanejamentoDetail.tsx", "utf8");
  it("le o flag do SERVIDOR (modeloData) e o gate usa maoObraPendente com a R12", () => {
    expect(src).toContain("flagServidor: (modeloData as any)?.custo_terceirizados_aprovado");
    expect(src).toContain("&& !custoLiberadoAuto;");
    expect(src.match(/moAprovada: !maoObraPendente/g)?.length).toBe(2);
  });
  it("repassa a R12 ao editor de M.O. e tira o aviso 'MO pendente' do selo da secao", () => {
    expect(src).toContain("custoLiberadoAuto={custoLiberadoAuto}");
    expect(src).toContain("moBlocoVisivel && !custoLiberadoAuto &&");
  });
});

describe("selo no MaoObraEditor", () => {
  const LINHAS = [L(null)];
  const base = { linhas: LINHAS, categorias: [{ id: "c1", nome: "Costura", ativo: true, valor_padrao: null }], podeVerCustos: true, podeAprovar: true,
    onChangeLinhas: () => {}, onAprovar: () => {}, onReprovar: () => {}, linhasPersistidas: new Set(["l1"]), linhasBase: LINHAS, podeEditarValor: true } as any;
  it("aparece com custoLiberadoAuto", () => {
    const html = renderToStaticMarkup(h(MaoObraEditor, { ...base, custoLiberadoAuto: true }));
    expect(html).toContain('data-testid="mo-custo-liberado-auto"');
    expect(html).toContain(TEXTO_CUSTO_LIBERADO_AUTO);
  });
  it("nao aparece sem a prop (aprovacao manual, reprovada, sem linha)", () => {
    expect(renderToStaticMarkup(h(MaoObraEditor, base))).not.toContain("mo-custo-liberado-auto");
    expect(renderToStaticMarkup(h(MaoObraEditor, { ...base, custoLiberadoAuto: false }))).not.toContain(TEXTO_CUSTO_LIBERADO_AUTO);
  });
});
