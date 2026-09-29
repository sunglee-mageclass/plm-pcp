// Integração — Estado em 4 níveis (owner set/2026): "os que não faltam itens, o badge não integrável deve ficar
// amarelo, assim, em filtro teria dois níveis de não integrável, os vermelhos que faltam dados e os amarelos que
// estão completos mas falta acionar o toggle". Cobre: cor/rótulo do badge nos 2 casos (função pura + RENDER de
// verdade do `EstadoCelula`), narrowing do filtro por nível, compatibilidade do valor salvo/legado
// "nao_integravel" (mostra os dois), e a ordem de sort dos 4 níveis.
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ROTULO_ESTADO_NIVEL, OPCOES_ESTADO_NIVEL, acessorEstado, filtrosParaRpc, lerLista, nivelDoProduto,
  produtoPassaFiltroEstado, rotuloEstado, tomEstado,
  type EstadoIntegracao, type EstadoNivel, type ProdutoLista,
} from "@/lib/integracao/produtos";
import { EstadoCelula } from "@/components/integracao/EstadoLinha";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const gate = (ok: boolean, motivo: string | null = null) => ({ ok, motivo });
const G = {
  modulo_bloqueado: false,
  compartilhado: gate(true), planejamento: gate(true), preco: gate(true), ref: gate(true), sku: gate(true), keywords: gate(true),
};
/** Fixture mínima — `completo` é o único campo que este arquivo varia de propósito (a fonte real do servidor,
 *  igual `motivoIntegrar` já usa pra travar o botão Integrar — nunca o rascunho staging). */
const cru = (o: Record<string, unknown> = {}) => ({
  modelo_id: "m1", origem: "interno", colecao: null, etapa: null, estado: "nao_integravel",
  marcado_em: null, integrado_em: null, rev: 1,
  raw: { nome: "Produto X", ref: null, tamanho_tipo: "letra" },
  vivo: { v: 1, campos: ["nome"], linhas: [{ tipo: "produto", ordem: 0, valores: { nome: "Produto X" }, fotos: [] }] },
  faltas: [], completo: true, sublinhas: [], retrato: null, retrato_difere: [], gates: G,
  ...o,
});
const lista = (produtos: unknown[]) =>
  lerLista({
    pagina: 1, por_pagina: 50, total: produtos.length,
    contagens: { nao_integrados: produtos.length, integrados: 0, todos: produtos.length },
    campos: ["nome"], opcoes: { colecoes: [], etapas: [] },
    pode: { editar: true, ver_custos: true, super: false, keywords: true },
    keywords: null, produtos,
  });
const produtoDe = (o: Record<string, unknown> = {}): ProdutoLista => lista([cru(o)]).produtos[0];

describe("Badge — cor e rótulo dos 2 níveis de 'não integrável' (owner set/2026)", () => {
  it("VERMELHO (danger) quando falta dado (completo=false)", () => {
    const p = produtoDe({ completo: false, faltas: [{ campo: "ncm", texto: "NCM" }] });
    expect(tomEstado(p)).toBe("danger");
    expect(rotuloEstado(p, "America/Sao_Paulo")).toBe("Não integrável — faltam dados");
    expect(nivelDoProduto(p)).toBe("nao_integravel_faltam");
  });
  it("ÂMBAR (warning) quando completo (nada falta, só falta acionar o toggle)", () => {
    const p = produtoDe({ completo: true, faltas: [] });
    expect(tomEstado(p)).toBe("warning");
    expect(rotuloEstado(p, "America/Sao_Paulo")).toBe("Não integrável — completo");
    expect(nivelDoProduto(p)).toBe("nao_integravel_completo");
  });
  it("integrável continua âmbar e integrado continua verde (sem regressão dos 2 estados de sempre)", () => {
    const integravel = produtoDe({ estado: "integravel", marcado_em: "2026-09-01T00:00:00Z" });
    expect(tomEstado(integravel)).toBe("warning");
    expect(nivelDoProduto(integravel)).toBe("integravel");
    const integrado = produtoDe({ estado: "integrado", integrado_em: "2026-09-01T00:00:00Z" });
    expect(tomEstado(integrado)).toBe("success");
    expect(nivelDoProduto(integrado)).toBe("integrado");
  });
  it("o rótulo do amarelo NUNCA aparece pra um produto que ainda falta dado (não é um falso 'pronto')", () => {
    const p = produtoDe({ completo: false });
    expect(rotuloEstado(p, "America/Sao_Paulo")).not.toBe("Não integrável — completo");
  });
  // MEDIUM-1 (review 685544fa): "amarelo" tem que significar "o servidor aceitaria integrar isto agora" — a
  // ordem espelha `integracao_marcar` (estado, módulo, reprovado, assinatura, completo). Um produto COMPLETO mas
  // com módulo desligado OU reprovado NÃO pode ser "pronto pra integrar" — cai no vermelho, com o motivo real.
  it("completo=true + módulo desligado (moduloBloqueado) cai no VERMELHO, não no âmbar", () => {
    const p = produtoDe({
      completo: true, faltas: [],
      gates: { ...G, modulo_bloqueado: true, compartilhado: gate(false, "Módulo Produto Acabado desligado nesta loja.") },
    });
    expect(nivelDoProduto(p)).toBe("nao_integravel_faltam");
    expect(tomEstado(p)).toBe("danger");
    expect(rotuloEstado(p, "America/Sao_Paulo")).toBe("Não integrável — faltam dados");
  });
  it("completo=true + reprovado cai no VERMELHO, não no âmbar", () => {
    const p = produtoDe({ completo: true, faltas: [], reprovado: true });
    expect(nivelDoProduto(p)).toBe("nao_integravel_faltam");
    expect(tomEstado(p)).toBe("danger");
  });
  it("completo=true, módulo aberto, não-reprovado: âmbar de verdade (o caso normal continua funcionando)", () => {
    const p = produtoDe({ completo: true, faltas: [], reprovado: false });
    expect(nivelDoProduto(p)).toBe("nao_integravel_completo");
    expect(tomEstado(p)).toBe("warning");
  });
});

describe("Filtro 'Estado' — narrowing pelos 4 níveis", () => {
  const produtos = [
    cru({ modelo_id: "m-falta1", completo: false }),
    cru({ modelo_id: "m-falta2", completo: false }),
    cru({ modelo_id: "m-ok1", completo: true }),
    cru({ modelo_id: "m-integravel", estado: "integravel" }),
    cru({ modelo_id: "m-integrado", estado: "integrado" }),
  ];
  const l = lista(produtos);

  it("'faltam dados' mostra SÓ os não-integráveis incompletos", () => {
    const filtrados = l.produtos.filter((p) => produtoPassaFiltroEstado(p, "nao_integravel_faltam"));
    expect(filtrados.map((p) => p.modeloId).sort()).toEqual(["m-falta1", "m-falta2"]);
  });
  it("'completo' mostra SÓ os não-integráveis completos", () => {
    const filtrados = l.produtos.filter((p) => produtoPassaFiltroEstado(p, "nao_integravel_completo"));
    expect(filtrados.map((p) => p.modeloId)).toEqual(["m-ok1"]);
  });
  it("'integravel'/'integrado' continuam passando por igual (o filtro de nível não estreita esses 2)", () => {
    expect(l.produtos.filter((p) => produtoPassaFiltroEstado(p, "integravel")).map((p) => p.modeloId))
      .toEqual(["m-falta1", "m-falta2", "m-ok1", "m-integravel", "m-integrado"]);
  });
  it("null (Todos) não filtra nada", () => {
    expect(l.produtos.filter((p) => produtoPassaFiltroEstado(p, null)).length).toBe(5);
  });
  it("as 2 opções novas mandam 'nao_integravel' pra RPC (o servidor só entende 3 valores)", () => {
    expect(filtrosParaRpc({ colecao: null, etapa: null, origem: null, busca: "", estado: "nao_integravel_faltam" }))
      .toEqual({ estado: "nao_integravel" });
    expect(filtrosParaRpc({ colecao: null, etapa: null, origem: null, busca: "", estado: "nao_integravel_completo" }))
      .toEqual({ estado: "nao_integravel" });
  });
});

describe("Compatibilidade do valor salvo/legado 'nao_integravel' (mapeia pros 2 níveis novos — mostra os dois)", () => {
  const produtos = [
    cru({ modelo_id: "m-falta", completo: false }),
    cru({ modelo_id: "m-ok", completo: true }),
    cru({ modelo_id: "m-integravel", estado: "integravel" }),
  ];
  const l = lista(produtos);

  it("um filtro salvo com o valor ANTIGO 'nao_integravel' continua indo pra RPC sem tradução", () => {
    expect(filtrosParaRpc({ colecao: null, etapa: null, origem: null, busca: "", estado: "nao_integravel" }))
      .toEqual({ estado: "nao_integravel" });
  });
  it("e o post-filtro client-side NÃO estreita nada com o valor legado — mostra os 2 níveis, como sempre mostrou", () => {
    // O SERVIDOR já filtra por `filtrosParaRpc` (que manda `estado=nao_integravel` pra RPC, igual antes) — aqui
    // simulamos exatamente a página que a RPC devolveria pra esse filtro (só os "nao_integravel") e confirmamos
    // que o predicado client-side não estreita mais ainda: os 2 sobrevivem, ao contrário dos níveis "faltam"/
    // "completo" (que cortariam um dos dois).
    const paginaDoServidor = l.produtos.filter((p) => p.estado === "nao_integravel");
    const filtrados = paginaDoServidor.filter((p) => produtoPassaFiltroEstado(p, "nao_integravel" as EstadoNivel));
    expect(filtrados.map((p) => p.modeloId).sort()).toEqual(["m-falta", "m-ok"]);
  });
  it("o valor legado NÃO aparece nas opções do dropdown (só existe pra compat de valor salvo/serializado)", () => {
    expect(OPCOES_ESTADO_NIVEL).not.toContain("nao_integravel");
    expect(OPCOES_ESTADO_NIVEL).toEqual([
      "nao_integravel_faltam", "nao_integravel_completo", "integravel", "integrado",
    ]);
  });
  it("mas o rótulo legado continua definido (não quebra se algo antigo ainda ler ROTULO_ESTADO_NIVEL.nao_integravel)", () => {
    expect(ROTULO_ESTADO_NIVEL.nao_integravel).toBe("Não integrável");
  });
});

// LOW (review 685544fa): os fixtures abaixo passam o objeto COMPLETO (`completo`+`moduloBloqueado`+`reprovado`),
// nunca só `{estado, completo}` — `acessorEstado`/`nivelDoProduto` agora dependem de `podeIntegrarAgora` (MEDIUM-1),
// que só devolve `true` com os 3 explicitamente `false`; testar com os 2 novos campos AUSENTES passaria por
// coincidência (`undefined` é falsy, mesmo efeito de `false`) sem provar a leitura de verdade.
const nivel = (estado: EstadoIntegracao, completo: boolean, moduloBloqueado = false, reprovado = false) =>
  ({ estado, completo, moduloBloqueado, reprovado });
describe("Ordem de sort dos 4 níveis (acessorEstado): faltam dados < completo < integrável < integrado", () => {
  it("a ordem numérica cresce exatamente nessa sequência", () => {
    const faltam = acessorEstado(nivel("nao_integravel", false));
    const completo = acessorEstado(nivel("nao_integravel", true));
    const integravel = acessorEstado(nivel("integravel", false));
    const integrado = acessorEstado(nivel("integrado", false));
    expect(faltam).toBeLessThan(completo);
    expect(completo).toBeLessThan(integravel);
    expect(integravel).toBeLessThan(integrado);
  });
  it("ordenar uma lista mista cai na ordem certa (asc)", () => {
    const rows = [
      nivel("integrado", false),
      nivel("nao_integravel", false), // faltam dados
      nivel("integravel", false),
      nivel("nao_integravel", true), // completo
    ];
    const ordenado = [...rows].sort((a, b) => acessorEstado(a) - acessorEstado(b));
    expect(ordenado.map((r) => (r.estado === "nao_integravel" ? (r.completo ? "completo" : "faltam") : r.estado)))
      .toEqual(["faltam", "completo", "integravel", "integrado"]);
  });
  it("completo NÃO afeta a ordem de integrável/integrado (só importa pra nao_integravel)", () => {
    expect(acessorEstado(nivel("integravel", true))).toBe(acessorEstado(nivel("integravel", false)));
    expect(acessorEstado(nivel("integrado", true))).toBe(acessorEstado(nivel("integrado", false)));
  });
  // MEDIUM-1 (review 685544fa): completo=true MAS módulo bloqueado/reprovado ainda cai no nível "faltam dados"
  // (vermelho) na ordenação — o produto NÃO está pronto pra integrar de verdade, mesmo com todo campo preenchido.
  it("completo=true + moduloBloqueado ainda ordena como 'faltam dados' (não é 'completo')", () => {
    expect(acessorEstado(nivel("nao_integravel", true, true, false))).toBe(acessorEstado(nivel("nao_integravel", false)));
  });
  it("completo=true + reprovado ainda ordena como 'faltam dados' (não é 'completo')", () => {
    expect(acessorEstado(nivel("nao_integravel", true, false, true))).toBe(acessorEstado(nivel("nao_integravel", false)));
  });
});

describe("EstadoCelula — RENDER de verdade: classe de tom (vermelho/âmbar) + texto do badge", () => {
  function montar(p: ProdutoLista) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    return {
      container,
      montar: () =>
        act(() => {
          root.render(createElement(EstadoCelula, { p, tz: "America/Sao_Paulo", superAdmin: false, onDesfazer: () => {} }));
        }),
      desmontar: () => act(() => { root.unmount(); container.remove(); }),
    };
  }
  const badge = (container: HTMLElement) => container.querySelector('[class*="tone-"]') as HTMLElement;

  it("falta dado: badge usa o token de PERIGO/vermelho (--tone-danger-*) e o texto 'faltam dados'", async () => {
    const p = produtoDe({ completo: false, faltas: [{ campo: "ncm", texto: "NCM" }] });
    const view = montar(p);
    await view.montar();
    const el = badge(view.container);
    expect(el.textContent).toBe("Não integrável — faltam dados");
    expect(el.className).toContain("tone-danger-bg");
    expect(el.className).toContain("tone-danger-fg");
    expect(el.className).not.toContain("tone-warning");
    // o "i" com a lista de faltas SÓ aparece no caso vermelho (existente antes desta task — continua valendo).
    expect(view.container.querySelector('[aria-label="O que falta"]')).not.toBeNull();
    await view.desmontar();
  });

  it("completo: badge usa o token de ATENÇÃO/âmbar (--tone-warning-*) e o texto 'completo' — SEM hex/oklch literal", async () => {
    const p = produtoDe({ completo: true, faltas: [] });
    const view = montar(p);
    await view.montar();
    const el = badge(view.container);
    expect(el.textContent).toBe("Não integrável — completo");
    expect(el.className).toContain("tone-warning-bg");
    expect(el.className).toContain("tone-warning-fg");
    expect(el.className).not.toContain("tone-danger");
    // nunca um valor solto (hex/oklch/hsl) na classe — só os tokens do StatusBadge (`--tone-*`, ver styles.css).
    expect(el.className).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(el.className).not.toMatch(/oklch\(/);
    // sem falta pra mostrar — o "i" de faltas não aparece no caso âmbar.
    expect(view.container.querySelector('[aria-label="O que falta"]')).toBeNull();
    await view.desmontar();
  });

  it("integrável continua âmbar e integrado continua verde/success (nenhuma regressão nos 2 estados de sempre)", async () => {
    const integravel = produtoDe({ estado: "integravel" });
    const v1 = montar(integravel);
    await v1.montar();
    expect(badge(v1.container).className).toContain("tone-warning-bg");
    await v1.desmontar();
    const integrado = produtoDe({ estado: "integrado", integrado_em: "2026-09-01T12:00:00Z" });
    const v2 = montar(integrado);
    await v2.montar();
    expect(badge(v2.container).className).toContain("tone-success-bg");
    await v2.desmontar();
  });

  // MEDIUM-1 (review 685544fa): o "i" precisa mostrar o motivo CERTO quando o vermelho é por módulo/reprovado
  // (não faltas) — nunca some só porque `completo` já é `true` (o antigo gate `!p.completo` escondia o "i" nesse
  // caso, deixando o vermelho sem explicação nenhuma).
  it("completo + moduloBloqueado: vermelho e o 'i' mostra o motivo do módulo (não a lista de faltas vazia)", async () => {
    const p = produtoDe({
      completo: true, faltas: [],
      gates: { ...G, modulo_bloqueado: true, compartilhado: gate(false, "Módulo Produto Acabado desligado nesta loja.") },
    });
    const view = montar(p);
    await view.montar();
    expect(badge(view.container).className).toContain("tone-danger-bg");
    const info = view.container.querySelector('[aria-label="O que falta"]');
    expect(info, "o 'i' tem que existir mesmo com completo=true").not.toBeNull();
    await view.desmontar();
  });
  it("completo + reprovado: vermelho e o 'i' existe (motivo do reprovado, não a lista de faltas vazia)", async () => {
    const p = produtoDe({ completo: true, faltas: [], reprovado: true });
    const view = montar(p);
    await view.montar();
    expect(badge(view.container).className).toContain("tone-danger-bg");
    expect(view.container.querySelector('[aria-label="O que falta"]')).not.toBeNull();
    await view.desmontar();
  });
});
