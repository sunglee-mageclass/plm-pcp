// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("MatrizGradeResponsiva — posDaCelula", () => {
  it("sem posDaCelula: renderCell recebe pos undefined (retrocompat)", () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    let posVista: unknown = "nao-chamado";
    act(() => createRoot(host).render(createElement(MatrizGradeResponsiva, {
      tamanhos: ["P"], variantes: [{ num: 1, label: "V1" }],
      total: () => 0,
      renderCell: (_n: number, _t: string, pos?: unknown) => { posVista = pos; return createElement("span"); },
    })));
    expect(posVista).toBeUndefined();
    host.remove();
  });
  it("com posDaCelula: a posição chega ao renderCell (desktop)", () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    const vistos: Array<{num:number;tam:string;pos:any}> = [];
    act(() => createRoot(host).render(createElement(MatrizGradeResponsiva, {
      tamanhos: ["P", "M"], variantes: [{ num: 7, label: "V7" }, { num: 9, label: "V9" }],
      total: () => 0,
      posDaCelula: (num: number, tam: string) => ({ linha: num === 7 ? 0 : 1, coluna: tam === "P" ? 0 : 1 }),
      renderCell: (num: number, tam: string, pos?: any) => { vistos.push({ num, tam, pos }); return createElement("span"); },
    })));
    // o desktop e o mobile ambos renderizam → a posição é a mesma nos dois; conferimos que existe e bate
    const v7P = vistos.find((v) => v.num === 7 && v.tam === "P");
    expect(v7P?.pos).toEqual({ linha: 0, coluna: 0 });
    const v9M = vistos.find((v) => v.num === 9 && v.tam === "M");
    expect(v9M?.pos).toEqual({ linha: 1, coluna: 1 });
    host.remove();
  });
});
