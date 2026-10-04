// Reforço de segurança S6 — front (plan.md §S6): S4 (status da OC segue o servidor no merge/P0409 + mensagem PT da recusa
// `oc_recebida_so_desmarcar`), B4 (Tabela de Preço sem "editar custos" não edita a estimativa; sem "ver custos" não vê R$/m nem o
// tecido estimado) e MO-0 (Plan. Tecido mostra "—", nunca "R$ 0,00", quando a M.O. vem mascarada). Testes de FONTE: falham se a
// guarda for apagada.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mensagemErro } from "@/lib/erro-mensagem";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (p: string) => readFileSync(ROOT + p, "utf8");

const TELAS = [
  { arq: "src/routes/_authenticated/entrada-saida.oc-aviamento.tsx", chave: '["oc-avi", ocId]', merge: "ocQueryData.oc.status", p0409: 'setStatus((oc.status as OCStatus) ?? "encomendado"); // [seg s6]' },
  { arq: "src/routes/_authenticated/entrada-saida.oc-insumo.tsx", chave: '["oc-insumo", ocId]', merge: "oc.status", p0409: 'setStatus((oc.status as OCStatus) ?? "encomendado"); // [seg s6]' },
  // OC Tecido: o retry automático usa o merge puro (fix round B1) — ver oc-tecido-retry-p0409.test.ts
  { arq: "src/routes/_authenticated/entrada-saida.oc-tecido.tsx", chave: '["oc-tecido", ocId]', merge: "ocQueryData.oc.status", p0409: "setStatus(r.estado.status); // [seg s6]" },
];

describe("S6 / S4 — o status da OC segue o servidor (P-236 = D7 A)", () => {
  for (const t of TELAS) {
    const src = ler(t.arq);
    it(`${t.arq.split("/").pop()}: re-semeia o status no merge do refetch, no P0409 e relê na recusa`, () => {
      // no merge (refetch alheio), ANTES do mergeDraft
      const iMerge = src.indexOf("// Refetch: MERGE");
      expect(iMerge).toBeGreaterThan(0);
      const antesMerge = src.slice(Math.max(0, iMerge - 600), iMerge);
      expect(antesMerge).toContain(`setStatus((${t.merge} as OCStatus) ?? "encomendado");`);
      // no onError P0409 (merge com o servidor)
      expect(src).toContain(t.p0409);
      // na recusa do servidor, relê a OC
      expect(src).toContain(`startsWith("oc_recebida_so_desmarcar:")) qc.invalidateQueries({ queryKey: ${t.chave} })`);
    });
  }

  it("mensagem PT da recusa (P0001 ASCII do servidor)", () => {
    const m = mensagemErro({ code: "P0001", message: "oc_recebida_so_desmarcar: OC recebida so volta a encomendada pelo Desmarcar recebimento" }, "x");
    expect(m).toBe('Esta OC já foi recebida (talvez por outra pessoa agora). Para voltá-la a encomendada, use "Desmarcar recebimento". A tela foi atualizada.');
  });
});

describe("S6 / B4 — Tabela de Preço respeita editar/ver custos", () => {
  const src = ler("src/components/planejamento/planejamento-detail/PrecoTabela.tsx");
  it("os 2 inputs de custo_simulado exigem podeEditarCustos", () => {
    expect((src.match(/disabled=\{planBloqueado \|\| !podeEditarCustos\}/g) ?? []).length).toBe(2);
    expect(src).not.toMatch(/disabled=\{planBloqueado\}/);
  });
  it("sem ver custos: nem R$/m nem o tecido estimado", () => {
    expect(src).toContain('podeVerCustos ? `× ${brl(precoTecidoM)}/m` : "× preço/m"');
    expect(src).toContain("podeVerCustos && tecidoEstimado > 0 ? brl(tecidoEstimado)");
  });
});

describe("S6 / MO-0 — Plan. Tecido não mostra R$ 0,00 de M.O. mascarada", () => {
  const src = ler("src/components/plan-tecido/CustoSection.tsx");
  it('as 2 linhas "Mão de obra (por serviço)" mostram "—" quando o servidor mascara', () => {
    expect((src.match(/label="Mão de obra \(por serviço\)" value=\{maoObraServico == null \? "—" : brl\(maoObra\)\}/g) ?? []).length).toBe(2);
    expect(src).not.toContain('label="Mão de obra (por serviço)" value={brl(maoObra)}');
  });
});
