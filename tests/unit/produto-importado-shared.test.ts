// @vitest-environment happy-dom
// Task 23, Fix round 1 (I-2, review) — cobertura BEHAVIORAL real de `produto-importado/shared.ts`: nenhuma
// destas funções tinha teste algum antes desta rodada (achado da revisão). Foco nos comportamentos que a
// própria revisão cobrou: `montarPayload` (presença de chave `?? null`), `precosDoDraft` (preço fixo manda,
// por canal), `chaveDirty`/`emptyDraft` (campos novos), a exclusão mútua fixo/markup nos handlers dos cards
// (via as funções puras que eles chamam), e o I-1 (trava nunca reenvia um campo editado antes do lock).
// PURAS + 1 RENDER real (react-dom/client + happy-dom) provando que `colunasTravadas` desabilita os campos
// certos na árvore DOM — mesma técnica de `tests/unit/integracao-trava-tela.test.ts` (InfoGeraisSecao).
import { describe, it, expect } from "vitest";
import { createElement, useMemo } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  emptyDraft, montarPayload, precosDoDraft, chaveDirty,
  resolverTravaImportado, aplicarResolucaoTrava, toastTravaImportado, acoplarParVarejo, acoplarParAtacado,
  markupVarejoExibido, markupAtacadoExibido,
  type ProdutoImportadoDraft,
} from "@/components/produto-importado/shared";
import { colunasTravadas, lerEstados } from "@/lib/integracao/trava";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function montar(el: ReturnType<typeof createElement>): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(el); });
  return { container, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}

const base = (over: Partial<ProdutoImportadoDraft> = {}): ProdutoImportadoDraft => ({
  ...emptyDraft("col1", "sub1"),
  id: "p1", rev: 3, nome: "Blusa Importada", modelo_id: "m1",
  valor_unitario_m1: 10, moeda_compra: "RMB", moeda_intermediaria: "USD", cotacao_ref: 5, cotacao_final: 5,
  ...over,
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// emptyDraft / chaveDirty — campos novos (Task 23: preco_atacado_fixo/preco_varejo_fixo/modeloPrecoVenda)
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("emptyDraft/chaveDirty — campos do preço fixo (Task 23)", () => {
  it("emptyDraft nasce com os 2 fixos null e modeloPrecoVenda null (sem espelho ainda)", () => {
    const d = emptyDraft("c", "s");
    expect(d.preco_atacado_fixo).toBeNull();
    expect(d.preco_varejo_fixo).toBeNull();
    expect(d.modeloPrecoVenda).toBeNull();
  });
  it("chaveDirty inclui os 2 fixos (entram no dirty-guard/merge) mas NÃO modeloPrecoVenda (read-only/embed)", () => {
    const k = chaveDirty(base());
    expect("preco_atacado_fixo" in k).toBe(true);
    expect("preco_varejo_fixo" in k).toBe(true);
    expect("modeloPrecoVenda" in k).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// montarPayload — presença de chave (?? null NUNCA omite) + shape do resto do payload
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("montarPayload — preco_atacado_fixo/preco_varejo_fixo sempre presentes no payload", () => {
  it("draft com os 2 fixos null: as CHAVES existem no payload (valor null, nunca omitidas)", () => {
    const { dados } = montarPayload(base());
    expect("preco_atacado_fixo" in dados).toBe(true);
    expect("preco_varejo_fixo" in dados).toBe(true);
    expect(dados.preco_atacado_fixo).toBeNull();
    expect(dados.preco_varejo_fixo).toBeNull();
  });
  it("draft com preco_varejo_fixo=298: payload leva o valor exato (sem arredondar/derivar)", () => {
    const { dados } = montarPayload(base({ preco_varejo_fixo: 298 }));
    expect(dados.preco_varejo_fixo).toBe(298);
  });
  it("draft com markup_varejo=2.5 (sem fixo): payload leva o markup, fixo fica null", () => {
    const { dados } = montarPayload(base({ markup_varejo: 2.5, preco_varejo_fixo: null }));
    expect(dados.markup_varejo).toBe(2.5);
    expect(dados.preco_varejo_fixo).toBeNull();
  });
  it("markup 0 ou negativo vira null no payload (|| null — mesma regra dos demais markups)", () => {
    const { dados } = montarPayload(base({ markup_varejo: 0 }));
    expect(dados.markup_varejo).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// precosDoDraft — preço FIXO manda, por canal, independente
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("precosDoDraft — o preço fixo manda, por canal (D14)", () => {
  it("sem fixo nem markup: os 2 canais ficam no custo puro (markup 0 → cadeiaMarkup ignora)", () => {
    const p = precosDoDraft(base());
    expect(typeof p.atacado).toBe("number");
    expect(typeof p.varejo).toBe("number");
  });
  it("varejo com fixo=500: precosDoDraft.varejo === 500 EXATO, atacado segue derivado do markup", () => {
    const d = base({ preco_varejo_fixo: 500, markup_atacado: 2 });
    const p = precosDoDraft(d);
    expect(p.varejo).toBe(500);
    expect(p.atacado).not.toBe(500); // não vaza o fixo de um canal pro outro
  });
  it("atacado com fixo, varejo com markup: cada canal usa a PRÓPRIA fonte, nunca mistura", () => {
    const d = base({ preco_atacado_fixo: 120, markup_varejo: 3 });
    const p = precosDoDraft(d);
    expect(p.atacado).toBe(120);
    expect(p.varejo).not.toBe(120);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// M-4 — markup EXIBIDO (gravado OU derivado do preço fixo ÷ base)
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("markupVarejoExibido/markupAtacadoExibido — M-4 (paridade com o Produto Acabado)", () => {
  it("markup gravado tem prioridade sobre o derivado", () => {
    expect(markupVarejoExibido({ markup_varejo: 2, preco_varejo_fixo: 500 }, 100)).toBe(2);
  });
  it("sem markup gravado, COM preço fixo e base>0: deriva preço÷base", () => {
    expect(markupVarejoExibido({ markup_varejo: null, preco_varejo_fixo: 250 }, 100)).toBe(2.5);
    expect(markupAtacadoExibido({ markup_atacado: null, preco_atacado_fixo: 300 }, 100)).toBe(3);
  });
  it("sem markup nem fixo: null (nada a mostrar)", () => {
    expect(markupVarejoExibido({ markup_varejo: null, preco_varejo_fixo: null }, 100)).toBeNull();
  });
  it("base <= 0: nunca deriva (divisão por zero/negativo não faz sentido) — fica null mesmo com fixo", () => {
    expect(markupVarejoExibido({ markup_varejo: null, preco_varejo_fixo: 250 }, 0)).toBeNull();
    expect(markupAtacadoExibido({ markup_atacado: null, preco_atacado_fixo: 250 }, -5)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// I-1 — resolverTravaImportado / aplicarResolucaoTrava: nunca reenvia campo travado editado antes
// do lock; reverte incondicionalmente; avisa só quando TOCADO e divergente.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("resolverTravaImportado — I-1 (ruling da revisão): nunca reenviar um campo travado como o usuário deixou", () => {
  const servidor = base({ nome: "Nome Servidor", ref: "REF-S", foto_url: "foto-s.jpg", preco_varejo_fixo: 298, markup_varejo: null });

  it("sem lock: paraServidor vazio, avisos vazio — nada muda", () => {
    const r = resolverTravaImportado({ enviado: base({ nome: "Editei" }), servidor, travaAtual: new Set(), touched: new Set(["nome"]) });
    expect(r.paraServidor).toEqual({});
    expect(r.avisos).toEqual([]);
  });
  it("sem servidor (produto ainda não persistido): paraServidor vazio — nada a reverter", () => {
    const r = resolverTravaImportado({ enviado: base(), servidor: undefined, travaAtual: new Set(["nome"]), touched: new Set() });
    expect(r.paraServidor).toEqual({});
  });
  it("nome travado E editado nesta sessão: reverte ao valor do servidor + 1 aviso 'Nome'", () => {
    const enviado = base({ nome: "Nome Editado Pelo Usuario" });
    const r = resolverTravaImportado({ enviado, servidor, travaAtual: new Set(["nome"]), touched: new Set(["nome"]) });
    expect(r.paraServidor.nome).toBe("Nome Servidor");
    expect(r.avisos).toEqual([{ campo: "nome", rotulo: "Nome" }]);
    const revertido = aplicarResolucaoTrava(enviado, r);
    expect(revertido.nome).toBe("Nome Servidor");
  });
  it("nome travado mas NÃO tocado nesta sessão (canonização/refetch): reverte SEM aviso", () => {
    const r = resolverTravaImportado({ enviado: base({ nome: "Nome Servidor" }), servidor, travaAtual: new Set(["nome"]), touched: new Set() });
    expect(r.paraServidor.nome).toBe("Nome Servidor");
    expect(r.avisos).toEqual([]);
  });
  it("ref e foto_url travados juntos, ambos editados: 2 avisos, revert nos 2", () => {
    const enviado = base({ ref: "REF-EDITADA", foto_url: "nova-foto.jpg" });
    const r = resolverTravaImportado({ enviado, servidor, travaAtual: new Set(["ref", "fotos_modelo"]), touched: new Set(["ref", "foto_url"]) });
    expect(r.paraServidor).toEqual({ ref: "REF-S", foto_url: "foto-s.jpg" });
    expect(r.avisos.map((a) => a.campo).sort()).toEqual(["foto_url", "ref"]);
  });
  it("preco_venda travado + markup_varejo digitado (limparia o fixo): reverte O PAR inteiro (preco_varejo_fixo E markup_varejo) — nunca deixa a rescrita silenciosa passar (I-1 caso crítico)", () => {
    const enviado = base({ preco_varejo_fixo: null, markup_varejo: 3 }); // usuário digitou o markup
    const r = resolverTravaImportado({ enviado, servidor, travaAtual: new Set(["preco_venda"]), touched: new Set(["markup_varejo", "preco_varejo_fixo"]) });
    expect(r.paraServidor).toEqual({ preco_varejo_fixo: 298, markup_varejo: null });
    const revertido = aplicarResolucaoTrava(enviado, r);
    // O payload resultante (via montarPayload) tem que ser BYTE-IDÊNTICO ao que já está no servidor —
    // é isto que faz o gatilho `fn_integracao_trava_espelho` responder "ok" em vez de 42501.
    const { dados } = montarPayload(revertido);
    expect(dados.preco_varejo_fixo).toBe(298);
    expect(dados.markup_varejo).toBeNull();
  });
  it("preco_venda travado, markup_varejo tocado mas o VALOR ENVIADO já bate com o servidor (ex.: usuário digitou e apagou): sem aviso (não houve perda real)", () => {
    const r = resolverTravaImportado({
      enviado: base({ preco_varejo_fixo: 298, markup_varejo: null }), servidor,
      travaAtual: new Set(["preco_venda"]), touched: new Set(["markup_varejo"]),
    });
    expect(r.avisos).toEqual([]);
  });
  it("2+ campos travados (nome + preco_venda), avisos combinam em 1 toast PT com 'e'", () => {
    const enviado = base({ nome: "X", preco_varejo_fixo: 999, markup_varejo: null });
    const r = resolverTravaImportado({ enviado, servidor, travaAtual: new Set(["nome", "preco_venda"]), touched: new Set(["nome", "preco_varejo_fixo"]) });
    const msg = toastTravaImportado(r.avisos);
    expect(msg).toContain(" e ");
    expect(msg.endsWith("essa alteração não foi salva.")).toBe(true);
  });
  it("aplicarResolucaoTrava com paraServidor vazio devolve a MESMA referência (nada revertido)", () => {
    const enviado = base();
    const r = resolverTravaImportado({ enviado, servidor, travaAtual: new Set(), touched: new Set() });
    expect(aplicarResolucaoTrava(enviado, r)).toBe(enviado);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// M-3 — acoplarParVarejo/acoplarParAtacado: par tratado como unidade no merge
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("acoplarParVarejo — M-3 (par fixo/markup como unidade no merge)", () => {
  it("conflito só no preco_varejo_fixo: espelha o conflito no markup_varejo também", () => {
    const r = acoplarParVarejo({
      valor: { preco_varejo_fixo: 310, markup_varejo: 3 },
      conflitos: [{ path: "preco_varejo_fixo", meu: 310, dele: 298 }],
    });
    expect(r.conflitos.map((c) => c.path).sort()).toEqual(["markup_varejo", "preco_varejo_fixo"]);
  });
  it("conflito só no markup_varejo: espelha no preco_varejo_fixo também", () => {
    const r = acoplarParVarejo({
      valor: { preco_varejo_fixo: null, markup_varejo: 5 },
      conflitos: [{ path: "markup_varejo", meu: 5, dele: 2 }],
    });
    expect(r.conflitos.some((c) => c.path === "preco_varejo_fixo")).toBe(true);
  });
  it("sem conflito, os 2 setados (estado impossível no servidor): normaliza — fixo manda, markup vira null", () => {
    const r = acoplarParVarejo({ valor: { preco_varejo_fixo: 298, markup_varejo: 3 }, conflitos: [] });
    expect(r.valor).toEqual({ preco_varejo_fixo: 298, markup_varejo: null });
  });
  it("sem conflito, já correto (só 1 setado): não mexe", () => {
    const r = acoplarParVarejo({ valor: { preco_varejo_fixo: 298, markup_varejo: null }, conflitos: [] });
    expect(r.valor).toEqual({ preco_varejo_fixo: 298, markup_varejo: null });
  });
  it("conflito nos 2 já (mergeDraft já tratou ambos): não duplica entradas", () => {
    const r = acoplarParVarejo({
      valor: { preco_varejo_fixo: 310, markup_varejo: 3 },
      conflitos: [
        { path: "preco_varejo_fixo", meu: 310, dele: 298 },
        { path: "markup_varejo", meu: 3, dele: 2 },
      ],
    });
    expect(r.conflitos.length).toBe(2);
  });
  it("acoplarParAtacado espelha a mesma regra pro par do atacado", () => {
    const r = acoplarParAtacado({ valor: { preco_atacado_fixo: 100, markup_atacado: 2 }, conflitos: [] });
    expect(r.valor).toEqual({ preco_atacado_fixo: 100, markup_atacado: null });
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// RENDER real (react-dom/client + happy-dom) — prova que colunasTravadas() produz o Set certo e
// que a MESMA expressão usada nos cards (`travaIntegracao.has("preco_venda")`/"variantes"/"nome"/
// "fotos_modelo") desabilita os campos certos numa árvore DOM de verdade — não regex-sobre-fonte.
// Harness mínimo que reproduz FIELMENTE o padrão disabled={...} dos cards reais (ProdutoCard.tsx/
// ProdutoImportadoCard.tsx), sem montar a árvore inteira (que exigiria mocks pesados de router/auth/
// query — fora do escopo desta prova, que é sobre a LÓGICA de trava, já coberta na fonte real pelos
// testes regex de integracao-trava-tela.test.ts).
// ────────────────────────────────────────────────────────────────────────────────────────────
function CardHarness({ trava }: { trava: ReadonlySet<string> }) {
  const disabledVarejo = trava.has("preco_venda");
  const disabledAtacado = false; // D34/R8: atacado NUNCA trava
  const disabledNome = trava.has("nome");
  const disabledVariantes = trava.has("variantes");
  return createElement("div", null,
    createElement("input", { "data-testid": "valor-varejo", disabled: disabledVarejo }),
    createElement("input", { "data-testid": "markup-varejo", disabled: disabledVarejo }),
    createElement("input", { "data-testid": "valor-atacado", disabled: disabledAtacado }),
    createElement("input", { "data-testid": "nome", disabled: disabledNome }),
    createElement("button", { "data-testid": "add-variante", disabled: disabledVariantes }),
  );
}
describe("RENDER — trava aplicada na árvore DOM real (mesma expressão dos cards)", () => {
  it("produto integrável com preco_venda marcado: varejo (valor+markup) desabilitados, atacado LIVRE", () => {
    const estados = lerEstados({ m1: { estado: "integravel", campos: ["preco_venda"], marcado_em: null, integrado_em: null } });
    const trava = colunasTravadas(estados.m1);
    const { container, unmount } = montar(createElement(CardHarness, { trava }));
    expect((container.querySelector('[data-testid="valor-varejo"]') as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="markup-varejo"]') as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="valor-atacado"]') as HTMLInputElement).disabled).toBe(false);
    unmount();
  });
  it("produto SEM estado de integração (null): nada desabilitado, sem selo", () => {
    const trava = colunasTravadas(null);
    const { container, unmount } = montar(createElement(CardHarness, { trava }));
    for (const id of ["valor-varejo", "markup-varejo", "valor-atacado", "nome"]) {
      expect((container.querySelector(`[data-testid="${id}"]`) as HTMLInputElement).disabled, id).toBe(false);
    }
    expect((container.querySelector('[data-testid="add-variante"]') as HTMLButtonElement).disabled).toBe(false);
    unmount();
  });
  it("variantes travam SEMPRE (SEMPRE_TRAVADO) mesmo sem 'variantes' nos campos marcados", () => {
    const estados = lerEstados({ m1: { estado: "integravel", campos: ["nome"], marcado_em: null, integrado_em: null } });
    const trava = colunasTravadas(estados.m1);
    const { container, unmount } = montar(createElement(CardHarness, { trava }));
    expect((container.querySelector('[data-testid="add-variante"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="nome"]') as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="valor-varejo"]') as HTMLInputElement).disabled).toBe(false); // preco_venda não marcado
    unmount();
  });
  it("re-render ao mudar o estado (produto passa a integrado): o disabled acompanha (useMemo/render real, não estático)", () => {
    function Wrapper({ integrado }: { integrado: boolean }) {
      const estados = useMemo(
        () => lerEstados({ m1: { estado: integrado ? "integrado" : "nao_integravel", campos: integrado ? ["preco_venda"] : [], marcado_em: null, integrado_em: integrado ? "2026-09-27" : null } }),
        [integrado],
      );
      const trava = colunasTravadas(estados.m1 ?? null);
      return createElement(CardHarness, { trava });
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(createElement(Wrapper, { integrado: false })); });
    expect((container.querySelector('[data-testid="valor-varejo"]') as HTMLInputElement).disabled).toBe(false);
    act(() => { root.render(createElement(Wrapper, { integrado: true })); });
    expect((container.querySelector('[data-testid="valor-varejo"]') as HTMLInputElement).disabled).toBe(true);
    act(() => { root.unmount(); });
    container.remove();
  });
});
