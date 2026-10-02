// @vitest-environment happy-dom
// Release I3 — CategoriaTecidoField: rótulo por grupo, "— nenhuma —" = null, troca de grupo preserva a outra chave.
// O Select do Radix é trocado por um stub simples (jsdom não abre o popper).
import { describe, it, expect, vi } from "vitest";
import { createElement, useState, act, createContext, useContext } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const Ctx = createContext<(v: string) => void>(() => {});
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => createElement(Ctx.Provider, { value: onValueChange }, createElement("div", { "data-value": value }, children)),
  SelectTrigger: ({ children }: any) => createElement("div", null, children),
  SelectValue: () => null,
  SelectContent: ({ children }: any) => createElement("div", null, children),
  SelectItem: ({ value, children }: any) => { const cb = useContext(Ctx); return createElement("button", { "data-item": value, onClick: () => cb(value) }, children); },
}));
import { CategoriaTecidoField } from "@/components/produto-acabado/CategoriaTecidoField";
import { montarDadosProduto } from "@/components/produto-acabado/shared";

const cats = [{ id: "ct1", nome: "Malha" }];
const mats = [{ id: "ma1", nome: "Metal" }];

function Harness({ acessorio, init, onDraft }: { acessorio: boolean; init: { categoria_tecido_id: string | null; material_aviamento_id: string | null }; onDraft: (d: any) => void }) {
  const [d, setD] = useState(init);
  return createElement(CategoriaTecidoField, {
    acessorio, categoriaTecidoId: d.categoria_tecido_id, materialAviamentoId: d.material_aviamento_id,
    categoriasTecido: cats, materiaisAviamento: mats, labelClass: "w-1", colabPath: "card:p1",
    onChange: (patch: any) => { const n = { ...d, ...patch }; setD(n); onDraft(n); },
  });
}
async function montar(el: any) {
  const c = document.createElement("div"); document.body.appendChild(c);
  const root = createRoot(c);
  await act(async () => { root.render(el); });
  return { c, fim: async () => { await act(async () => root.unmount()); c.remove(); } };
}

describe("CategoriaTecidoField", () => {
  it("rótulo: Acessórios = Material do aviamento; outro grupo = Categoria do tecido", async () => {
    const a = await montar(createElement(Harness, { acessorio: true, init: { categoria_tecido_id: null, material_aviamento_id: null }, onDraft: () => {} }));
    expect(a.c.textContent).toContain("Material do aviamento");
    expect(a.c.textContent).toContain("Metal");
    expect(a.c.textContent).not.toContain("Malha");
    await a.fim();
    const b = await montar(createElement(Harness, { acessorio: false, init: { categoria_tecido_id: null, material_aviamento_id: null }, onDraft: () => {} }));
    expect(b.c.textContent).toContain("Categoria do tecido");
    expect(b.c.textContent).toContain("Malha");
    await b.fim();
  });
  it("escolher e voltar para '— nenhuma —' manda null; só a chave do grupo muda", async () => {
    const drafts: any[] = [];
    const v = await montar(createElement(Harness, { acessorio: false, init: { categoria_tecido_id: "ct1", material_aviamento_id: "ma1" }, onDraft: (d) => drafts.push(d) }));
    await act(async () => { (v.c.querySelector('[data-item="__nenhuma__"]') as HTMLButtonElement).click(); });
    expect(drafts.at(-1)).toEqual({ categoria_tecido_id: null, material_aviamento_id: "ma1" }); // a outra preservada
    await v.fim();
  });
  it("trocar de grupo preserva a outra chave no rascunho e no payload", async () => {
    const drafts: any[] = [];
    const v = await montar(createElement(Harness, { acessorio: true, init: { categoria_tecido_id: "ct1", material_aviamento_id: null }, onDraft: (d) => drafts.push(d) }));
    await act(async () => { (v.c.querySelector('[data-item="ma1"]') as HTMLButtonElement).click(); });
    const rascunho = drafts.at(-1);
    expect(rascunho).toEqual({ categoria_tecido_id: "ct1", material_aviamento_id: "ma1" });
    const dados = montarDadosProduto({ ...rascunho, tamanho_tipo: null, tamanho_tipo_base: null, variantes: [], oc: null } as any);
    expect(dados.categoria_tecido_id).toBe("ct1");
    expect(dados.material_aviamento_id).toBe("ma1");
    await v.fim();
  });
});
