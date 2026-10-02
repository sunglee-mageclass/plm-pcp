// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CAMPO_BY_KEY } from "@/lib/integracao/campos";
import { avisoSublinhas, lerLista, type ProdutoLista } from "@/lib/integracao/produtos";
import { TEXTO_TRAVADO_INTEGRADO, TEXTO_TRAVADO_INTEGRAVEL, infoEdicao, modoCelula } from "@/lib/integracao/celula";
import { novoRascunho, type Rascunho } from "@/lib/integracao/rascunho";
import { chaveEntradaPrevia } from "@/components/planejamento/planejamento-detail/codigos/sku-previa";

// n6 (task-12a-review.md "Re-review round 2"; carry.md T12b): sem isto, todo `act()` sob React 19 dev loga "The
// current testing environment is not configured to support act(...)" — dezenas de linhas de stderr por rodada,
// escondendo qualquer falha real no meio do ruído. Mesmo padrão de `tests/unit/_fix_hidratacao/dom-helpers.ts`.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// `AbrirCard` (dentro de CelulaCampo.tsx) chama useAuth() (precisa de AuthProvider real, que dispara sessão do
// Supabase). R14/P-199 A: "abrir card" não é mais <Link> — é um botão que chama o `abrirCard` do contexto da página
// (`AbrirCardContext`); sem Provider nada aparece. `canView` fica em `auth.ver` para os testes de permissão.
const auth = vi.hoisted(() => ({ ver: true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => auth.ver }) }));
// P-155 B (Título herdado): a célula do Título lê o nome da loja de `useTenantBranding` (query do Supabase) — aqui fixo.
vi.mock("@/hooks/useTenantBranding", () => ({ useTenantBranding: () => ({ nome: "Loja Teste" }) }));
const { CelulaCampo } = await import("@/components/integracao/CelulaCampo");
const { AbrirCardContext } = await import("@/components/integracao/abrir-card");

const g = (ok: boolean, motivo: string | null = null) => ({ ok, motivo });
const p = (o: Record<string, unknown> = {}) => lerLista({ campos: [], produtos: [{ modelo_id: "m1", origem: "interno",
  estado: "nao_integravel", rev: 1, raw: { nome: "X", tamanho_tipo: "letra" },
  gates: { compartilhado: g(true), planejamento: g(true), preco: g(false, "Precisa da permissão de preço de venda."),
    ref: g(false, "REF travada pelo envio à Explosão — não pode mudar depois desse ponto."), sku: g(true), keywords: g(true) }, ...o }] }).produtos[0];
const c = (k: string) => CAMPO_BY_KEY.get(k as never)!;

describe("modoCelula — quem decide editar × ler", () => {
  it("gate do servidor aberto = edita; fechado = lê com o motivo do card", () => {
    expect(modoCelula(c("peso"), p(), false)).toEqual({ tipo: "editar" });
    expect(modoCelula(c("preco_venda"), p(), false)).toEqual({ tipo: "leitura", motivo: "Precisa da permissão de preço de venda.", travado: false });
    expect(modoCelula(c("ref_sku"), p(), false)).toMatchObject({ tipo: "leitura", motivo: "REF travada pelo envio à Explosão — não pode mudar depois desse ponto." });
  });
  it("custo/cor/tamanho, metatag e keywords nunca editam na célula (P-80 A; Keywords = diálogo)", () => {
    for (const k of ["preco_custo", "cor_base", "cor_apelido", "tamanho", "metatag", "keywords"]) {
      expect(modoCelula(c(k), p(), false).tipo, k).toBe("leitura");
    }
  });
  it("integrável/integrado = travado (cadeado), qualquer campo", () => {
    expect(modoCelula(c("nome"), p({ estado: "integravel" }), false)).toEqual({ tipo: "leitura", motivo: TEXTO_TRAVADO_INTEGRAVEL, travado: true });
    expect(modoCelula(c("nome"), p({ estado: "integrado" }), false)).toEqual({ tipo: "leitura", motivo: TEXTO_TRAVADO_INTEGRADO, travado: true });
  });
  it("salvando = nada edita", () => {
    expect(modoCelula(c("peso"), p(), true)).toEqual({ tipo: "leitura", motivo: "Salvando…", travado: false });
  });
  it("informação de quem edita (textos do mockup)", () => {
    expect(infoEdicao(c("ref_sku"), p({ origem: "revenda" }))).toBe("REF da revenda: nasce no cadastro do Produto Acabado; editar aqui muda nos dois lugares (mão dupla).");
    expect(infoEdicao(c("preco_venda"), p({ origem: "revenda" }))).toBe('Grava como preço FIXO de revenda (mesma regra do card — "última edição manda").');
    expect(infoEdicao(c("ref_sku"), p())).toBe("REF manual liberada (etapa já revela a REF neste card) — editar aqui edita o card também.");
    expect(infoEdicao(c("peso"), p())).toBeNull();
  });
  // Fix round 1 — Minor 5/M10 (task-12a-review.md + task-12a-code-review.md): casos que faltavam na suíte.
  it("Minor 5/M10: gate ilegível (formato inesperado) vira leitura com o motivo fail-closed", () => {
    const prod = p({ gates: { compartilhado: g(true), planejamento: g(true), preco: "formato-errado", ref: g(true), sku: g(true), keywords: g(true) } });
    const modo = modoCelula(c("preco_venda"), prod, false);
    expect(modo.tipo).toBe("leitura");
    expect((modo as { motivo: string }).motivo).toMatch(/não foi possível ler a permissão/i);
  });
  it("Minor 5/M10: gate FECHADO vence 'salvando' (o motivo real aparece, não 'Salvando…')", () => {
    expect(modoCelula(c("preco_venda"), p(), true)).toEqual({ tipo: "leitura", motivo: "Precisa da permissão de preço de venda.", travado: false });
  });
  it("Minor 5/M10: 'titulo' segue a mesma regra de campo com gate (planejamento)", () => {
    expect(modoCelula(c("titulo"), p(), false)).toEqual({ tipo: "editar" });
    expect(modoCelula(c("titulo"), p({ estado: "integravel" }), false)).toEqual({ tipo: "leitura", motivo: TEXTO_TRAVADO_INTEGRAVEL, travado: true });
  });
  it("Minor 5/M10: 'foto' tem gate compartilhado e infoEdicao própria", () => {
    expect(modoCelula(c("foto"), p(), false)).toEqual({ tipo: "editar" });
    expect(infoEdicao(c("foto"), p())).toBe("As fotos novas só sobem no Salvar da página.");
  });
  it("Minor 5/M10: infoEdicao cobre 'importado' (REF e preço de venda)", () => {
    expect(infoEdicao(c("ref_sku"), p({ origem: "importado" }))).toBe("REF do importado: nasce no cadastro do Produto Importado; editar aqui muda nos dois lugares (mão dupla).");
    expect(infoEdicao(c("preco_venda"), p({ origem: "importado" }))).toBe('Grava como preço FIXO do importado (mesma regra do card — "última edição manda").');
  });
});

describe("ruling P-99 A — Reprovado só afirma 'não vai para a API' quando integrável (Important 1/I2)", () => {
  it("lerLista preserva reprovado E estado juntos, para a UI decidir o texto do selo por estado", () => {
    const integravel = p({ estado: "integravel", reprovado: true });
    const integrado = p({ estado: "integrado", reprovado: true });
    expect(integravel.reprovado).toBe(true);
    expect(integravel.estado).toBe("integravel");
    expect(integrado.reprovado).toBe(true);
    expect(integrado.estado).toBe("integrado");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 2 (task-12a-report.md "Fix round 2"; reviews: task-12a-review.md "Re-review round 1" + task-12a-
// code-review.md "Re-check round 1") — RENDER de verdade com react-dom/client + happy-dom (Critical C1/R1: "a
// regex-on-source test does NOT count"). O `@vitest-environment happy-dom` no topo do arquivo troca o ambiente
// SÓ deste arquivo (o resto da suíte continua em "node", mais rápido).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ROOT = process.cwd() + "/";

/** Fixture com 1 sublinha (variante × tamanho) — necessária pra montar `SkuCelula` de verdade. `vivo.linhas`
 *  precisa de uma linha `tipo:"variante"` casando por `variante_key`/`tamanho_key` com `sublinhas` (é assim que
 *  `sublinhaDe`/`linhasVariante` resolvem a sublinha real, espelhando o jsonb de `integracao_listar`). */
function produtoComSublinha(o: Record<string, unknown> = {}): ProdutoLista {
  return lerLista({
    campos: [],
    produtos: [{
      modelo_id: "m1", origem: "interno", estado: "nao_integravel", rev: 1,
      raw: { nome: "Blusa Teste", ref: "BLTS0001", tamanho_tipo: "letra" },
      gates: {
        compartilhado: g(true), planejamento: g(true), preco: g(true), ref: g(true),
        sku: g(true), keywords: g(true),
      },
      vivo: {
        campos: ["ref_sku"],
        linhas: [{ tipo: "variante", ordem: 1, variante_key: "v1", tamanho_key: "P", valores: {} }],
      },
      sublinhas: [{
        variante_key: "v1", tamanho_key: "P", variante_ordem: 1, tamanho_ordem: 1,
        cor_nome: "Azul", apelido_nome: null, tamanho: "P", sku_id: "sku-1", sku: "BLTS0001-AZ-P",
        sku_rev: 3, manual: false,
      }],
      ...o,
    }],
  }).produtos[0];
}

/** Monta uma raiz react-dom/client num `<div>` anexado ao body (happy-dom). `unmount()` limpa. */
function montar(el: ReturnType<typeof createElement>): { container: HTMLElement; root: Root; rerender: (el2: ReturnType<typeof createElement>) => void; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(el); });
  return {
    container, root,
    rerender: (el2) => { act(() => { root.render(el2); }); },
    unmount: () => { act(() => { root.unmount(); }); container.remove(); },
  };
}

const campoSku = () => c("ref_sku");
const campoNome = () => c("nome");

describe("CRÍTICO (C1/R1) — SkuCelula não pode quebrar hooks ao alternar editável↔leitura", () => {
  it("abre editável, dispara salvando=true (o que acontece em TODO Salvar) e volta a false, sem lançar", () => {
    const produto = produtoComSublinha();
    const rascunho = novoRascunho(produto);
    const props = (salvando: boolean) => createElement(CelulaCampo, {
      campo: campoSku(), produto, indice: 0, rascunho, previa: undefined, salvando,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    });
    const view = montar(props(false));
    // A célula deve estar editável (um <input> real, não só texto).
    expect(view.container.querySelector("input")).not.toBeNull();
    // O crash do round 1 acontecia EXATAMENTE nesta transição: editável → leitura (salvando=true).
    expect(() => view.rerender(props(true))).not.toThrow();
    // E o caminho de volta (fim do Salvar) também não pode quebrar.
    expect(() => view.rerender(props(false))).not.toThrow();
    expect(view.container.querySelector("input")).not.toBeNull();
    view.unmount();
  });
  it("mesmo teste com o gate SKU fechando no meio (relista) — outra causa real do flip", () => {
    const produto = produtoComSublinha();
    const rascunho = novoRascunho(produto);
    const props = (skuOk: boolean) => createElement(CelulaCampo, {
      campo: campoSku(), produto: produtoComSublinha({ gates: {
        compartilhado: g(true), planejamento: g(true), preco: g(true), ref: g(true),
        sku: g(skuOk, skuOk ? null : "Precisa da permissão de editar o Planejamento."), keywords: g(true),
      } }), indice: 0, rascunho, previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    });
    const view = montar(props(true));
    expect(() => view.rerender(props(false))).not.toThrow();
    expect(() => view.rerender(props(true))).not.toThrow();
    view.unmount();
  });
});

describe("Fix round 2 (R2) — 'salvando' NUNCA vira a UI de 'não pode ser salva'", () => {
  it("célula genérica com edição pendente + gate FECHADO mostra LeituraComPendencia; com o MESMO gate mas só salvando, mostra o controle desabilitado", () => {
    const produtoTravado = p({ gates: { compartilhado: g(true), planejamento: g(true), preco: g(false, "Precisa da permissão de preço de venda."),
      ref: g(true), sku: g(true), keywords: g(true) } });
    const rascunho: Rascunho = { ...novoRascunho(produtoTravado), valores: { ...novoRascunho(produtoTravado).valores, preco_venda: 199.9 },
      tocados: new Set(["preco_venda"]) };
    const viewTravado = montar(createElement(CelulaCampo, {
      campo: c("preco_venda"), produto: produtoTravado, indice: null, rascunho, previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    }));
    // O texto do InfoHover só entra no DOM quando o tooltip abre (portal do Radix) — a evidência estável no DOM
    // é o botão "i" com o aria-label fixo ("Sua alteração não pode ser salva") mais o botão de descartar.
    expect(viewTravado.container.querySelector('[aria-label="Sua alteração não pode ser salva"]')).not.toBeNull();
    expect(viewTravado.container.textContent).toMatch(/descartar alteração/);
    viewTravado.unmount();

    // MESMA edição pendente, mas o gate está ABERTO (diferente da fixture anterior) e só `salvando=true` — não
    // pode aparecer o "i" de erro nem o botão de descartar (R2): o controle normal, desabilitado, com o valor do
    // rascunho, é o que deve aparecer.
    const produtoAberto = p({ gates: { compartilhado: g(true), planejamento: g(true), preco: g(true), ref: g(true), sku: g(true), keywords: g(true) } });
    const rascunhoAberto: Rascunho = { ...novoRascunho(produtoAberto), valores: { ...novoRascunho(produtoAberto).valores, preco_venda: 199.9 },
      tocados: new Set(["preco_venda"]) };
    const viewSalvando = montar(createElement(CelulaCampo, {
      campo: c("preco_venda"), produto: produtoAberto, indice: null, rascunho: rascunhoAberto, previa: undefined, salvando: true,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    }));
    expect(viewSalvando.container.querySelector('[aria-label="Sua alteração não pode ser salva"]')).toBeNull();
    expect(viewSalvando.container.textContent).not.toMatch(/descartar alteração/);
    const input = viewSalvando.container.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.disabled).toBe(true);
    viewSalvando.unmount();
  });
});

describe("Fix round 2 (R3) — SKU 'manter o meu' usa a linha da PRÉVIA, não a da lista", () => {
  it("com sit.conflitoVersao, o clique em 'manter o meu' chama manterMeuSku com o id/rev da PRÉVIA (novos), não da lista (velhos)", () => {
    const produto = produtoComSublinha(); // sublinha tem sku_id="sku-1", sku_rev=3 (o valor "velho" da lista)
    let rascunho = novoRascunho(produto);
    // Simula um SKU manual digitado (entra em r.skus.manuais) e uma prévia com conflito de versão para essa linha,
    // com id/rev NOVOS (o que a prévia do servidor traria — sku-1-NOVO/rev 9).
    rascunho = { ...rascunho, skus: { regerar: false, manuais: { "v1|P": { varianteKey: "v1", tamanhoKey: "P", sku: "MEU-SKU", id: "sku-1", rev: 3 } } } };
    // A entrada TEM que ser calculada pela MESMA função que o componente usa (chaveEntradaPrevia) — senão
    // `previaAtual` (SkuCelulaEditavel) nunca bate e a prévia inteira cai em "calculando…" (foi o 1º bug real que
    // este teste pegou, tentando uma string à mão).
    const entrada = chaveEntradaPrevia({ ref: "BLTS0001", tamanhoTipo: "letra", aGravar: rascunho.skus, virgem: false });
    const previa = {
      matriz: {
        status: "ok" as const, tamanho_tipo: "letra" as const, tamanho_tipo_card: "letra" as const, faltas: [], avisos: [],
        linhas: [{
          variante_key: "v1", variante_ordem: 1, cor_nome: "Azul", apelido_nome: null, tamanho_key: "P", tamanho_ordem: 1,
          id: "sku-1-NOVO", sku: "OUTRO-SKU", manual: true, rev: 9, sku_previsto: null, faltas: [], avisos: [], conflito_com: null,
          estado: "manual" as const,
          previa: { acao: "erro" as const, sku_de: "OUTRO-SKU", sku_para: "MEU-SKU", mensagem: null, code: "P0409" },
        }],
      },
      assinatura: "a".repeat(32), erros: [], nConflitos: 1,
      entrada,
      desconhecida: false,
    };
    const chamadas: Array<(r: Rascunho) => Rascunho> = [];
    const onAtualizar = (f: (r: Rascunho) => Rascunho) => { chamadas.push(f); rascunho = f(rascunho); };
    const view = montar(createElement(CelulaCampo, {
      campo: campoSku(), produto, indice: 0, rascunho, previa: previa as never, salvando: false,
      onAtualizar, onKeywords: () => {}, onFotos: () => {},
    }));
    const botaoManterOMeu = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "manter o meu");
    expect(botaoManterOMeu, "botão 'manter o meu' deveria aparecer em conflito de versão").toBeDefined();
    act(() => { botaoManterOMeu!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const manual = rascunho.skus.manuais["v1|P"];
    // Se tivesse usado a linha da LISTA (round 1), id/rev continuariam "sku-1"/3 (os velhos). Usando a PRÉVIA
    // (fix round 2), o id/rev viram os NOVOS da prévia — o que de fato limpa o P0409 no próximo Salvar.
    expect(manual.id).toBe("sku-1-NOVO");
    expect(manual.rev).toBe(9);
    view.unmount();
  });
});

// Fix round 1 T12b — revisão A-I3: "usar o novo" precisa mostrar o SKU novo mesmo quando NÃO sobra nenhum outro SKU
// digitado no produto (o caso TÍPICO: 1 SKU digitado em conflito, era o ÚNICO manual). Sem o snapshot, assim que o
// manual é removido `usePreviasSkus` para de consultar a prévia deste produto, `previa` vira `undefined` no
// PRÓXIMO render, e a célula caía de volta no `sub.sku` da LISTA (o valor STALE que causou o conflito).
describe("Fix round 1 T12b (A-I3) — 'usar o novo' do SKU mostra o valor novo mesmo sem sobrar outro SKU manual", () => {
  it("clicar em 'usar o novo' (único SKU digitado) mostra o SKU FRESCO da prévia, mesmo depois que a prévia some (re-render sem previa)", () => {
    const produto = produtoComSublinha(); // sublinha tem sku="BLTS0001-AZ-P" (o valor "velho" da lista)
    let rascunho = novoRascunho(produto);
    rascunho = { ...rascunho, skus: { regerar: false, manuais: { "v1|P": { varianteKey: "v1", tamanhoKey: "P", sku: "MEU-SKU", id: "sku-1", rev: 3 } } } };
    const entrada = chaveEntradaPrevia({ ref: "BLTS0001", tamanhoTipo: "letra", aGravar: rascunho.skus, virgem: false });
    const previaComConflito = {
      matriz: {
        status: "ok" as const, tamanho_tipo: "letra" as const, tamanho_tipo_card: "letra" as const, faltas: [], avisos: [],
        linhas: [{
          variante_key: "v1", variante_ordem: 1, cor_nome: "Azul", apelido_nome: null, tamanho_key: "P", tamanho_ordem: 1,
          id: "sku-1-NOVO", sku: "SKU-FRESCO-DO-SERVIDOR", manual: true, rev: 9, sku_previsto: null, faltas: [], avisos: [], conflito_com: null,
          estado: "manual" as const,
          previa: { acao: "erro" as const, sku_de: "SKU-FRESCO-DO-SERVIDOR", sku_para: "MEU-SKU", mensagem: null, code: "P0409" },
        }],
      },
      assinatura: "a".repeat(32), erros: [], nConflitos: 1,
      entrada,
      desconhecida: false,
    };
    let onAtualizarChamadas = 0;
    const onAtualizar = (f: (r: Rascunho) => Rascunho) => { onAtualizarChamadas += 1; rascunho = f(rascunho); };
    const props = (previa: unknown) => createElement(CelulaCampo, {
      campo: campoSku(), produto, indice: 0, rascunho, previa: previa as never, salvando: false,
      onAtualizar, onKeywords: () => {}, onFotos: () => {},
    });
    const view = montar(props(previaComConflito));
    const botaoUsarNovo = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "usar o novo");
    expect(botaoUsarNovo, "botão 'usar o novo' deveria aparecer em conflito de versão").toBeDefined();
    act(() => { botaoUsarNovo!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onAtualizarChamadas).toBe(1);
    // O manual foi removido — este era o ÚNICO SKU digitado do produto, então na vida real `temSkuAGravar` vira
    // `false` e `usePreviasSkus` para de pedir a prévia deste produto: o PRÓXIMO render chega com `previa=undefined`.
    expect(rascunho.skus.manuais["v1|P"]).toBeUndefined();
    view.rerender(props(undefined));
    const input = view.container.querySelector("input") as HTMLInputElement;
    // Sem o snapshot (bug original), o input voltaria pro `sub.sku` da LISTA ("BLTS0001-AZ-P", o valor STALE que
    // causou o conflito). Com o snapshot (fix), mostra o SKU FRESCO capturado no clique.
    expect(input.value).toBe("SKU-FRESCO-DO-SERVIDOR");
    expect(input.value).not.toBe("BLTS0001-AZ-P");
    view.unmount();
  });

  // Fix round 2 T12b (minor m-R6): a v1 só limpava o snapshot quando `sub.sku` chegava a ser EXATAMENTE o valor
  // snapshotado ("SKU-FRESCO-DO-SERVIDOR") — se a relista seguinte trouxesse um TERCEIRO valor (nem o antigo, nem
  // o snapshotado; ex.: alguém regerou o SKU de novo antes do Realtime confirmar o primeiro), a célula ficava
  // presa mostrando o snapshot pra sempre, mesmo com um dado mais novo (o terceiro valor) já disponível na lista.
  it("regressão m-R6: relista com um TERCEIRO valor de SKU (nem o antigo nem o snapshotado) solta o snapshot e mostra o valor novo da lista", () => {
    const produto = produtoComSublinha(); // sublinha tem sku="BLTS0001-AZ-P" (o valor "velho")
    let rascunho = novoRascunho(produto);
    rascunho = { ...rascunho, skus: { regerar: false, manuais: { "v1|P": { varianteKey: "v1", tamanhoKey: "P", sku: "MEU-SKU", id: "sku-1", rev: 3 } } } };
    const entrada = chaveEntradaPrevia({ ref: "BLTS0001", tamanhoTipo: "letra", aGravar: rascunho.skus, virgem: false });
    const previaComConflito = {
      matriz: {
        status: "ok" as const, tamanho_tipo: "letra" as const, tamanho_tipo_card: "letra" as const, faltas: [], avisos: [],
        linhas: [{
          variante_key: "v1", variante_ordem: 1, cor_nome: "Azul", apelido_nome: null, tamanho_key: "P", tamanho_ordem: 1,
          id: "sku-1-NOVO", sku: "SKU-FRESCO-DO-SERVIDOR", manual: true, rev: 9, sku_previsto: null, faltas: [], avisos: [], conflito_com: null,
          estado: "manual" as const,
          previa: { acao: "erro" as const, sku_de: "SKU-FRESCO-DO-SERVIDOR", sku_para: "MEU-SKU", mensagem: null, code: "P0409" },
        }],
      },
      assinatura: "a".repeat(32), erros: [], nConflitos: 1,
      entrada,
      desconhecida: false,
    };
    const onAtualizar = (f: (r: Rascunho) => Rascunho) => { rascunho = f(rascunho); };
    const props = (produtoAgora: ProdutoLista, previa: unknown) => createElement(CelulaCampo, {
      campo: campoSku(), produto: produtoAgora, indice: 0, rascunho, previa: previa as never, salvando: false,
      onAtualizar, onKeywords: () => {}, onFotos: () => {},
    });
    const view = montar(props(produto, previaComConflito));
    const botaoUsarNovo = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "usar o novo");
    act(() => { botaoUsarNovo!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(rascunho.skus.manuais["v1|P"]).toBeUndefined();
    // Sem manual restando, a prévia some no próximo render (mesma mecânica do teste anterior) — o snapshot
    // ("SKU-FRESCO-DO-SERVIDOR") é o que sustenta a célula.
    view.rerender(props(produto, undefined));
    let input = view.container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("SKU-FRESCO-DO-SERVIDOR");
    // A relista seguinte chega com um TERCEIRO valor — nem "BLTS0001-AZ-P" (o original) nem "SKU-FRESCO-DO-SERVIDOR"
    // (o snapshotado). Isso É uma atualização de verdade da lista (outra pessoa regerou de novo); o snapshot precisa
    // soltar e mostrar esse valor novo, nunca ficar preso no snapshotado.
    const produtoTerceiroValor = produtoComSublinha({
      sublinhas: [{
        variante_key: "v1", tamanho_key: "P", variante_ordem: 1, tamanho_ordem: 1,
        cor_nome: "Azul", apelido_nome: null, tamanho: "P", sku_id: "sku-1", sku: "SKU-TERCEIRO-VALOR",
        sku_rev: 10, manual: false,
      }],
    });
    view.rerender(props(produtoTerceiroValor, undefined));
    input = view.container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("SKU-TERCEIRO-VALOR");
    expect(input.value).not.toBe("SKU-FRESCO-DO-SERVIDOR");
    view.unmount();
  });
});

describe("Fix round 2 (R1-2) — selo 'automático' do Preço anterior editável VOLTOU", () => {
  it("mostra o placeholder automático E o selo 'automático' ao mesmo tempo (não troca um pelo outro)", () => {
    // `p()` padrão tem o gate `preco` FECHADO (usado pelos testes de modoCelula) — aqui precisa ABERTO pra
    // exercitar o ramo editável de verdade. M4 (P-158/P-159): com preço de venda no rascunho (v1) o selo é "automático";
    // sem ele vira "aguardando preço de venda" (teste abaixo, P-146/P-158).
    const produto = p({ raw: { nome: "X", tamanho_tipo: "letra", preco_venda: 159.9 },
      gates: { compartilhado: g(true), planejamento: g(true), preco: g(true), ref: g(true), sku: g(true), keywords: g(true) } });
    const rascunho = novoRascunho(produto); // preco_anterior é null por padrão no raw da fixture `p()`
    const view = montar(createElement(CelulaCampo, {
      campo: c("preco_anterior"), produto, indice: null, rascunho, previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    }));
    expect(view.container.textContent).toMatch(/automático/);
    expect(view.container.querySelector("input")).not.toBeNull();
    view.unmount();
  });
});

describe("Fix round 2 — Minors (RotateCcw, valor formatado na pendência, aria-label)", () => {
  it("usa o ícone lucide RotateCcw (svg), não o glifo de texto '↺'", () => {
    const produto = produtoComSublinha();
    let rascunho = novoRascunho(produto);
    rascunho = { ...rascunho, skus: { regerar: false, manuais: { "v1|P": { varianteKey: "v1", tamanhoKey: "P", sku: "DIGITADO", id: "sku-1", rev: 3 } } } };
    const view = montar(createElement(CelulaCampo, {
      campo: campoSku(), produto, indice: 0, rascunho, previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    }));
    expect(view.container.textContent).not.toContain("↺");
    const botaoDesfazer = [...view.container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Desfazer o SKU digitado");
    expect(botaoDesfazer?.querySelector("svg")).not.toBeNull();
    view.unmount();
  });
  it("edição pendente de Peso mostra o valor FORMATADO (BR, com 'kg'), não o número cru", () => {
    const produtoTravado = p({ gates: { compartilhado: g(true), planejamento: g(false, "Precisa da permissão de editar o Planejamento."),
      preco: g(true), ref: g(true), sku: g(true), keywords: g(true) } });
    let rascunho = novoRascunho(produtoTravado);
    rascunho = { ...rascunho, valores: { ...rascunho.valores, peso_kg: 0.31 }, tocados: new Set(["peso_kg"]) };
    const view = montar(createElement(CelulaCampo, {
      campo: c("peso"), produto: produtoTravado, indice: null, rascunho, previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    }));
    expect(view.container.textContent).toContain("0,310 kg");
    expect(view.container.textContent).not.toContain("0.31");
    view.unmount();
  });
  it("aria-label do campo genérico leva o rótulo e o nome do produto", () => {
    const produto = p();
    const rascunho = novoRascunho(produto);
    const view = montar(createElement(CelulaCampo, {
      campo: campoNome(), produto, indice: null, rascunho, previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    }));
    const input = view.container.querySelector("input");
    expect(input?.getAttribute("aria-label")).toBe(`Nome — ${produto.raw.nome}`);
    view.unmount();
  });
  // n5 (task-12a-review.md "Re-review round 2"; carry.md T12b): os 2 testes m7/R7 abaixo passavam ANTES da correção
  // real (ambas as células já tinham um "i" com esse aria-label por outro motivo — `infoCusto`/"= Descrição…" — então
  // só checar que o "i" existe não prova que o TEXTO DA TRAVA está lá). Agora o teste ABRE o tooltip (clique sem
  // `pointerdown` prévio cai no ramo de teclado de `InfoHover`, que ALTERNA `open`) e confere o texto
  // `TEXTO_TRAVADO_*` de verdade no DOM (o `TooltipContent` do Radix monta num Portal em `document.body`, fora do
  // `view.container` — por isso a asserção lê `document.body`, não o container).
  it("m7/R7 (reviews): célula só-leitura por natureza (preco_custo) numa linha TRAVADA mostra o texto da trava, não fica muda", () => {
    const produto = p({ estado: "integravel" });
    const rascunho = novoRascunho(produto);
    const view = montar(createElement(CelulaCampo, {
      campo: c("preco_custo"), produto, indice: null, rascunho, previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    }));
    expect(view.container.querySelector('[aria-label="Travado"]')).not.toBeNull();
    const botaoInfo = view.container.querySelector('[aria-label="Informação do campo"]');
    expect(botaoInfo).not.toBeNull();
    act(() => { botaoInfo!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.body.textContent).toContain(TEXTO_TRAVADO_INTEGRAVEL);
    view.unmount();
  });
  it("m7/R7: metatag numa linha travada também mostra o texto da trava (não só o cadeado mudo)", () => {
    const produto = p({ estado: "integrado" });
    const rascunho = novoRascunho(produto);
    const view = montar(createElement(CelulaCampo, {
      campo: c("metatag"), produto, indice: null, rascunho, previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    }));
    expect(view.container.querySelector('[aria-label="Travado"]')).not.toBeNull();
    const botaoInfo = view.container.querySelector('[aria-label="Informação do campo"]');
    expect(botaoInfo).not.toBeNull();
    act(() => { botaoInfo!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.body.textContent).toContain(TEXTO_TRAVADO_INTEGRADO);
    view.unmount();
  });
});

// Testes de inspeção de fonte remanescentes — só onde um teste de RENDER seria desproporcional (a checagem é
// sobre outro arquivo/consumidor, não sobre o comportamento de `CelulaCampo` em si).
const CELULA_TSX = readFileSync(ROOT + "src/components/integracao/CelulaCampo.tsx", "utf8");
const TABELA_TSX = readFileSync(ROOT + "src/components/integracao/ProdutosTabela.tsx", "utf8");
const INFO_HOVER_TSX = readFileSync(ROOT + "src/components/shared/InfoHover.tsx", "utf8");

describe("Fix round 1 — InfoHover usa cn() (Important 2/I7: o 'i' âmbar não pode perder pra text-muted-foreground)", () => {
  it("importa cn de @/lib/utils e usa no className do botão (nunca concatenação de string crua)", () => {
    expect(INFO_HOVER_TSX).toMatch(/import \{ cn \} from "@\/lib\/utils";/);
    expect(INFO_HOVER_TSX).not.toMatch(/\$\{className \?\? ""\}/);
    expect(INFO_HOVER_TSX).toMatch(/className=\{cn\(/);
  });
  it("nenhum OUTRO consumidor de InfoHover passa className (a mudança não muda a saída deles)", () => {
    // grep amplo por todo o src: só CelulaCampo.tsx deve casar `InfoHover ... className=`.
    const consumidores = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx", "utf8");
    expect(consumidores).not.toMatch(/<InfoHover[^>]*className=/);
    const direcionamento = readFileSync(ROOT + "src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx", "utf8");
    expect(direcionamento).not.toMatch(/<InfoHover[^>]*className=/);
  });
});

describe("Fix round 1 — Peso/medidas usam MoneyInput com casas fixas (Important I1)", () => {
  it("NÃO usa mais NumberInput para peso/medida", () => {
    expect(CELULA_TSX).not.toMatch(/import \{ NumberInput \}/);
  });
});

describe("Fix round 1 — sublinhas por chave estável variante|tamanho (Important I6)", () => {
  it("ProdutosTabela chaveia <tr> por varianteKey|tamanhoKey, nunca por índice", () => {
    expect(TABELA_TSX).toMatch(/key=\{`\$\{p\.modeloId\}:\$\{l\.varianteKey\}\|\$\{l\.tamanhoKey\}`\}/);
  });
});

describe("Fix round 1 — Acessibilidade: a seta de sublinhas leva aria-expanded (Minor 8)", () => {
  it("aria-expanded na seta de abrir/fechar sublinhas", () => {
    expect(TABELA_TSX).toMatch(/aria-expanded=\{aberto\}/);
  });
});

describe("Fix round 1 — desempenho: linha memoizada (Minor 7/M7)", () => {
  it("ProdutosTabela usa React.memo na linha do produto", () => {
    expect(TABELA_TSX).toMatch(/const LinhaProduto = memo\(function LinhaProduto/);
  });
});

// ─────────────────────────── P-146/P-155 B/P-158 — Preço anterior e Título pela VERSÃO ANTERIOR ───────────────────────────
describe("P-146/P-158 — Preço anterior automático na célula (versão anterior)", () => {
  const aberto = { compartilhado: g(true), planejamento: g(true), preco: g(true), ref: g(true), sku: g(true), keywords: g(true) };
  const monta = (raw: Record<string, unknown>, versaoAnterior?: unknown) => {
    const produto = p({ raw: { nome: "X", tamanho_tipo: "letra", ...raw }, gates: aberto });
    return montar(createElement(CelulaCampo, {
      campo: c("preco_anterior"), produto, indice: null, rascunho: novoRascunho(produto), previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {}, versaoAnterior: versaoAnterior as never,
    }));
  };
  const info = (preco: number | null) => ({ info: { anterior_versao: 1, anterior_preco: preco, titulo_herdado: "T", titulo_origem_versao: 1 }, carregando: false });
  it("anterior com preço: placeholder = o preço da vN + selo 'acompanha o preço da versão anterior (v1)'", () => {
    const view = monta({ preco_venda: 250 }, info(200));
    expect((view.container.querySelector("input") as HTMLInputElement).placeholder).toBe("200,00");
    expect(view.container.textContent).toContain("acompanha o preço da versão anterior (v1)");
    view.unmount();
  });
  it("anterior SEM preço (P-158): placeholder '—' + selo 'aguardando preço da v1' (nunca o próprio preço)", () => {
    const view = monta({ preco_venda: 250 }, info(null));
    expect((view.container.querySelector("input") as HTMLInputElement).placeholder).toBe("—");
    expect(view.container.textContent).toContain("aguardando preço da v1");
    expect(view.container.textContent).not.toContain("250");
    view.unmount();
  });
  it("sem anterior (v1): o preço de venda do RASCUNHO (n2); sem ele, 'aguardando preço de venda' (M4)", () => {
    const v1 = monta({ preco_venda: 159.9 }, { info: null, carregando: false });
    expect((v1.container.querySelector("input") as HTMLInputElement).placeholder).toBe("159,90");
    expect(v1.container.textContent).toContain("automático");
    v1.unmount();
    const v2 = monta({}, { info: null, carregando: false });
    expect(v2.container.textContent).toContain("aguardando preço de venda");
    expect((v2.container.querySelector("input") as HTMLInputElement).placeholder).toBe("—"); // Minor 1: nunca "0,00"
    v2.unmount();
  });
  it("I1: falha sem dado — Preço anterior com '—' e sem selo (nunca '…' eterno)", () => {
    const view = monta({ preco_venda: 250 }, { info: null, carregando: false, erro: true });
    expect((view.container.querySelector("input") as HTMLInputElement).placeholder).toBe("—");
    expect(view.container.textContent).not.toMatch(/automático|aguardando/);
    view.unmount();
  });
  it("versão anterior carregando: placeholder '…' e nenhum selo (não chuta o automático)", () => {
    const view = monta({ preco_venda: 250 }, { info: null, carregando: true });
    expect((view.container.querySelector("input") as HTMLInputElement).placeholder).toBe("…");
    expect(view.container.textContent).not.toMatch(/automático|aguardando/);
    view.unmount();
  });
  it("leitura (gate de preço fechado) mostrando o VIVO: o selo ganha a versão", () => {
    const produto = p({ raw: { nome: "X", tamanho_tipo: "letra", preco_venda: 250 } }); // gate preco FECHADO
    const view = montar(createElement(CelulaCampo, {
      campo: c("preco_anterior"), produto, indice: null, rascunho: novoRascunho(produto), previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {}, versaoAnterior: info(null) as never,
    }));
    expect(view.container.textContent).toContain("aguardando preço da v1");
    view.unmount();
  });
});

describe("P-155 B + R4 — Título herdado na célula", () => {
  const produto = () => p({ raw: { nome: "Vestido Andreia", tamanho_tipo: "letra" } });
  const herdado = { info: { anterior_versao: 1, anterior_preco: 598, titulo_herdado: "Vestido Gardenia | Loja Teste", titulo_origem_versao: 1 }, carregando: false };
  it("v2+ automático mostra o HERDADO + selo 'herdado da v1'", () => {
    const pr = produto();
    const view = montar(createElement(CelulaCampo, {
      campo: c("titulo"), produto: pr, indice: null, rascunho: novoRascunho(pr), previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {}, versaoAnterior: herdado as never,
    }));
    expect((view.container.querySelector("input") as HTMLInputElement).value).toBe("Vestido Gardenia | Loja Teste");
    expect(view.container.textContent).toContain("herdado da v1");
    view.unmount();
  });
  it("R4: digitar o título PRÓPRIO (do Nome da v2) fica DIGITADO; digitar o herdado volta a automático", () => {
    const pr = produto();
    let r = novoRascunho(pr);
    const onAtualizar = (f: (x: Rascunho) => Rascunho) => { r = f(r); };
    const el = () => createElement(CelulaCampo, {
      campo: c("titulo"), produto: pr, indice: null, rascunho: r, previa: undefined, salvando: false,
      onAtualizar, onKeywords: () => {}, onFotos: () => {}, versaoAnterior: herdado as never,
    });
    const view = montar(el());
    const digita = (v: string) => {
      const input = view.container.querySelector("input") as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      act(() => { set.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
      view.rerender(el());
    };
    digita("Vestido Andreia | Loja Teste"); // o calculado PRÓPRIO — na v2 é um título digitado de verdade
    expect(r.valores.titulo_pagina).toBe("Vestido Andreia | Loja Teste");
    digita("Vestido Gardenia | Loja Teste"); // = o herdado ⇒ automático
    expect(r.valores.titulo_pagina).toBeNull();
    view.unmount();
  });
  it("I1: falha SEM dado em cache — Título bloqueado com o aviso de falha (nunca 'Carregando' eterno)", () => {
    const pr = produto();
    const view = montar(createElement(CelulaCampo, {
      campo: c("titulo"), produto: pr, indice: null, rascunho: novoRascunho(pr), previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {}, versaoAnterior: { info: null, carregando: false, erro: true } as never,
    }));
    const input = view.container.querySelector("input") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe("");
    expect(view.container.querySelector('[aria-label="Não foi possível carregar a versão anterior"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Aguardando a versão anterior"]')).toBeNull();
    view.unmount();
  });
  it("I1: com o dado (mesmo depois de um refetch falho — o hook não marca erro com cache) o Título segue EDITÁVEL", () => {
    const pr = produto();
    const view = montar(createElement(CelulaCampo, {
      campo: c("titulo"), produto: pr, indice: null, rascunho: novoRascunho(pr), previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {}, versaoAnterior: herdado as never,
    }));
    expect((view.container.querySelector("input") as HTMLInputElement).disabled).toBe(false);
    view.unmount();
  });
  it("versão anterior carregando: o Título fica DESABILITADO (sem o herdado o colapso compararia errado)", () => {
    const pr = produto();
    const view = montar(createElement(CelulaCampo, {
      campo: c("titulo"), produto: pr, indice: null, rascunho: novoRascunho(pr), previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {}, versaoAnterior: { info: null, carregando: true } as never,
    }));
    expect((view.container.querySelector("input") as HTMLInputElement).disabled).toBe(true);
    view.unmount();
  });
});

// R14 / P-199 A (L9) — "abrir card" renderizado: botão que chama o `abrirCard` do contexto, gated por canView.
describe("AbrirCard (R14, P-199 A)", () => {
  const celulaLeitura = (abrir: ((id: string) => void) | null) => {
    const pr = p();
    const filho = createElement(CelulaCampo, {
      campo: c("preco_custo"), produto: pr, indice: null, rascunho: novoRascunho(pr), previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    });
    return abrir ? createElement(AbrirCardContext.Provider, { value: abrir }, filho) : filho;
  };
  it("com Provider e permissão: botão com aria-label do produto; o clique chama abrirCard(id)", () => {
    auth.ver = true;
    const abrir = vi.fn();
    const view = montar(celulaLeitura(abrir));
    const btn = view.container.querySelector("button[aria-label='Abrir card de X']") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.className).toContain("cursor-pointer");
    act(() => { btn.click(); });
    expect(abrir).toHaveBeenCalledWith("m1");
    view.unmount();
  });
  it("sem permissão (canView false): nenhum botão", () => {
    auth.ver = false;
    const view = montar(celulaLeitura(vi.fn()));
    expect(view.container.querySelector("button[aria-label^='Abrir card']")).toBeNull();
    view.unmount();
    auth.ver = true;
  });
  it("sem Provider: nenhum botão", () => {
    auth.ver = true;
    const view = montar(celulaLeitura(null));
    expect(view.container.querySelector("button[aria-label^='Abrir card']")).toBeNull();
    view.unmount();
  });
});

// medios R14 sku #10 — aviso "as sublinhas mudaram depois do retrato" na coluna SKU.
describe("aviso das sublinhas (sku #10)", () => {
  const retrato = { campos: ["ref_sku"], linhas: [{ tipo: "variante", ordem: 1, variante_key: "v1", tamanho_key: "P", valores: { ref_sku: "BLTS0001-AZ-P" } }] };
  const celula = (difere: string[]) => {
    const pr = produtoComSublinha({ estado: "integrado", retrato, retrato_difere: difere });
    return createElement(CelulaCampo, {
      campo: c("ref_sku"), produto: pr, indice: 0, rascunho: novoRascunho(pr), previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
    });
  };
  it("retrato_difere com 'sublinhas': mostra o 'i' com o texto em PT-BR", () => {
    const view = montar(celula(["sublinhas"]));
    const i = view.container.querySelector("[aria-label='Sublinhas mudaram depois do retrato']");
    expect(i).not.toBeNull();
    expect(avisoSublinhas(produtoComSublinha({ estado: "integrado", retrato, retrato_difere: ["sublinhas"] }))).toContain("sublinhas");
    view.unmount();
  });
  it("sem 'sublinhas' em retrato_difere: nenhum aviso", () => {
    const view = montar(celula([]));
    expect(view.container.querySelector("[aria-label='Sublinhas mudaram depois do retrato']")).toBeNull();
    view.unmount();
  });
});
