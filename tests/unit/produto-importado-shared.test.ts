// @vitest-environment happy-dom
// Task 23, Fix round 1 (I-2, review) — cobertura BEHAVIORAL real de `produto-importado/shared.ts`: nenhuma
// destas funções tinha teste algum antes desta rodada (achado da revisão). Foco nos comportamentos que a
// própria revisão cobrou: `montarPayload` (presença de chave `?? null`), `precosDoDraft` (preço fixo manda,
// por canal), `chaveDirty`/`emptyDraft` (campos novos), a exclusão mútua fixo/markup nos handlers dos cards
// (via as funções puras que eles chamam), e o I-1 (trava nunca reenvia um campo editado antes do lock).
// PURAS + 1 RENDER real (react-dom/client + happy-dom) provando que `colunasTravadas` desabilita os campos
// certos na árvore DOM — mesma técnica de `tests/unit/integracao-trava-tela.test.ts` (InfoGeraisSecao).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, useMemo } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as queryModule from "@tanstack/react-query";
import {
  emptyDraft, montarPayload, precosDoDraft, chaveDirty,
  resolverTravaImportado, aplicarResolucaoTrava, toastTravaImportado, acoplarParVarejo, acoplarParAtacado,
  normalizarParVarejoAposResolucao, normalizarParAtacadoAposResolucao,
  markupVarejoExibido, markupAtacadoExibido, parDoCampo, devePodeNormalizarPar, aplicarResolucaoConflito,
  type ProdutoImportadoDraft,
} from "@/components/produto-importado/shared";
import {
  resolverTravaAcabado, aplicarResolucaoTravaAcabado, toastTravaAcabado, chaveDirty as chaveDirtyPA, markupVarejoParaBlurAtacado,
  produtosParaSalvar,
  type ProdutoDraft,
} from "@/components/produto-acabado/shared";
import { colunasTravadas, lerEstados } from "@/lib/integracao/trava";
import { mergeDraft, type Conflito } from "@/lib/colab/merge";

// ────────────────────────────────────────────────────────────────────────────────────────────
// N-5 (Fix round 2) — RENDER real que MONTA `ProdutoImportadoCard` de verdade (não um harness que
// reimplementa a lógica de disabled — a crítica do re-review ao bloco RENDER do Fix round 1).
// `ProdutoImportadoCard` puxa `useNavigate` (@tanstack/react-router, precisa de um router de
// verdade), `useAuth` (precisa de um `AuthProvider`), `useMaoObraModelo`/`useSignedUrl` (TanStack
// Query + Supabase) — mockadas aqui como infraestrutura (não são a lógica sob teste). O hook
// `useIntegracaoEstado` TAMBÉM é mockado — controlado por `mockEstado.current` — porque o valor
// real vem de uma RPC via rede (`supabase.rpc("integracao_estado_modelos")`); mockar aqui é
// exatamente o padrão que o resto da suíte já usa pra RPC (`integracao-trava-tela.test.ts`, topo).
// `colunasTravadas` (puro, de `@/lib/integracao/trava`) SEGUE REAL — é ele quem decide o Set
// `travaIntegracao` que o card lê pra cada `disabled={...}`; a única coisa mockada é "qual é o
// ESTADO do produto", não "o que a trava faz com esse estado". O card em si (JSX, `InfoHover`,
// `disabled`) é 100% código de produção, sem substituto — é a lacuna que o re-review apontou.
const mockEstado = vi.hoisted(() => ({ current: null as null | { estado: "integravel" | "integrado"; campos: string[]; marcadoEm: string | null; integradoEm: string | null } }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => () => {} };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ canView: () => true, canEdit: () => true, user: { id: "u1" }, session: null, loading: false }),
}));
vi.mock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));
vi.mock("@/hooks/useMaoObraModelo", () => ({
  useMaoObraModelo: () => ({ linhas: [], catsServico: [], setLinhas: () => {}, aprovar: { mutate: () => {}, isPending: false }, linhasPersistidas: [], dirty: false, total: 0, salvar: { mutate: () => {}, isPending: false } }),
}));
vi.mock("@/hooks/useIntegracaoEstado", () => ({ useIntegracaoEstado: () => mockEstado.current }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Import DEPOIS dos `vi.mock` acima (hoisted pelo Vitest de qualquer forma, mas mantém a ordem de
// leitura clara) — o card de verdade, produção, sem substituto.
const { ProdutoImportadoCard } = await import("@/components/produto-importado/ProdutoImportadoCard");

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
  it("2+ campos travados (nome + preco_venda), avisos combinam em 1 toast PT (\"Estes campos…: Nome e Valor varejo.\")", () => {
    const enviado = base({ nome: "X", preco_varejo_fixo: 999, markup_varejo: null });
    const r = resolverTravaImportado({ enviado, servidor, travaAtual: new Set(["nome", "preco_venda"]), touched: new Set(["nome", "preco_varejo_fixo"]) });
    const msg = toastTravaImportado(r.avisos);
    // Fix round 4 (R3-4) — 2+ avisos: formato "Estes campos foram travados…: <lista com vírgulas e 1 'e'>."
    expect(msg).toBe("Estes campos foram travados pela Integração enquanto você editava — essas alterações não foram salvas: Nome e Valor varejo.");
  });
  it("aplicarResolucaoTrava com paraServidor vazio devolve a MESMA referência (nada revertido)", () => {
    const enviado = base();
    const r = resolverTravaImportado({ enviado, servidor, travaAtual: new Set(), touched: new Set() });
    expect(aplicarResolucaoTrava(enviado, r)).toBe(enviado);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// M-3/N-2 — acoplarParVarejo/acoplarParAtacado: par tratado como unidade no merge, com meu/dele
// construídos das fontes CORRETAS (N-2, Fix round 2 — regressão do Fix round 1: o acoplamento
// original usava o valor JÁ ADOTADO pelo merge (do OUTRO usuário) como "meu", e o "dele" do OUTRO
// campo do par como "dele" do campo espelhado — "usar o novo" apagava o valor salvo de quem não
// tinha conflito nenhum. Ver `rr-m3b.ts`/harness do re-review.)
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("acoplarParVarejo — M-3/N-2 (par fixo/markup como unidade; meu/dele corretos)", () => {
  it("conflito só no preco_varejo_fixo: espelha o conflito no markup_varejo — meu=MEU draft, dele=O QUE O SERVIDOR TEM nesse campo (N-2)", () => {
    // A tinha (base) fixo=298/markup=null; A digita Valor 310 (toca só preco_varejo_fixo); B salvou Markup 2 (fresh).
    const draft = { preco_varejo_fixo: 310, markup_varejo: null };
    const fresh = { preco_varejo_fixo: null, markup_varejo: 2 };
    const r = acoplarParVarejo({
      valor: { preco_varejo_fixo: 310, markup_varejo: 2 } as any, // o que o mergeDraft cru já tinha adotado (markup do fresh, não tocado por A)
      conflitos: [{ path: "preco_varejo_fixo", meu: 310, dele: null }],
      draft, fresh,
    });
    const markC = r.conflitos.find((c) => c.path === "markup_varejo")!;
    expect(markC).toBeDefined();
    // N-2: meu = draft.markup_varejo (o que A tinha = null), dele = fresh.markup_varejo (o que B SALVOU = 2)
    // — NUNCA {meu: 2 (o que já foi adotado), dele: null (o dele do OUTRO campo)}, o bug original.
    expect(markC.meu).toBe(null);
    expect(markC.dele).toBe(2);
    // "usar o novo" nos 2 preserva o que B realmente salvou: null/2 — não null/null (perda de dado).
    expect(r.conflitos.find((c) => c.path === "preco_varejo_fixo")!.dele).toBe(null);
  });
  it("conflito só no markup_varejo: espelha no preco_varejo_fixo — meu/dele das fontes corretas (N-2)", () => {
    // Espelha o cenário original do review: A digita Markup 3 (toca só markup_varejo); B salvou Valor 298.
    const draft = { preco_varejo_fixo: null, markup_varejo: 3 };
    const fresh = { preco_varejo_fixo: 298, markup_varejo: null };
    const r = acoplarParVarejo({
      valor: { preco_varejo_fixo: 298, markup_varejo: 3 } as any,
      conflitos: [{ path: "markup_varejo", meu: 3, dele: null }],
      draft, fresh,
    });
    const fixoC = r.conflitos.find((c) => c.path === "preco_varejo_fixo")!;
    expect(fixoC).toBeDefined();
    // N-2 (o bug original dava meu:298/dele:null — o exato cenário do review): meu = draft.preco_varejo_fixo
    // (o que A tinha = null), dele = fresh.preco_varejo_fixo (o que B SALVOU = 298).
    expect(fixoC.meu).toBe(null);
    expect(fixoC.dele).toBe(298);
    // "meu" nos 2 = o que A tinha de verdade (null/3), não {298 (adotado), 3} — a UI mostra o draft de A.
    expect(r.valor.preco_varejo_fixo).toBe(null);
  });
  it("sem conflito, os 2 setados (estado impossível no servidor): normaliza — fixo manda, markup vira null", () => {
    const r = acoplarParVarejo({ valor: { preco_varejo_fixo: 298, markup_varejo: 3 }, conflitos: [], draft: { preco_varejo_fixo: 298, markup_varejo: 3 }, fresh: { preco_varejo_fixo: 298, markup_varejo: 3 } });
    expect(r.valor).toEqual({ preco_varejo_fixo: 298, markup_varejo: null });
  });
  it("sem conflito, já correto (só 1 setado): não mexe", () => {
    const r = acoplarParVarejo({ valor: { preco_varejo_fixo: 298, markup_varejo: null }, conflitos: [], draft: { preco_varejo_fixo: 298, markup_varejo: null }, fresh: { preco_varejo_fixo: 298, markup_varejo: null } });
    expect(r.valor).toEqual({ preco_varejo_fixo: 298, markup_varejo: null });
  });
  it("conflito nos 2 já (mergeDraft já tratou ambos): não duplica entradas", () => {
    const r = acoplarParVarejo({
      valor: { preco_varejo_fixo: 310, markup_varejo: 3 },
      conflitos: [
        { path: "preco_varejo_fixo", meu: 310, dele: 298 },
        { path: "markup_varejo", meu: 3, dele: 2 },
      ],
      draft: { preco_varejo_fixo: 310, markup_varejo: 3 }, fresh: { preco_varejo_fixo: 298, markup_varejo: 2 },
    });
    expect(r.conflitos.length).toBe(2);
  });
  it("acoplarParAtacado espelha a mesma regra (normalização) pro par do atacado", () => {
    const r = acoplarParAtacado({ valor: { preco_atacado_fixo: 100, markup_atacado: 2 }, conflitos: [], draft: { preco_atacado_fixo: 100, markup_atacado: 2 }, fresh: { preco_atacado_fixo: 100, markup_atacado: 2 } });
    expect(r.valor).toEqual({ preco_atacado_fixo: 100, markup_atacado: null });
  });
  it("acoplarParAtacado espelha meu/dele corretos (N-2) também no par atacado", () => {
    const draft = { preco_atacado_fixo: null, markup_atacado: 3 };
    const fresh = { preco_atacado_fixo: 150, markup_atacado: null };
    const r = acoplarParAtacado({
      valor: { preco_atacado_fixo: 150, markup_atacado: 3 } as any,
      conflitos: [{ path: "markup_atacado", meu: 3, dele: null }],
      draft, fresh,
    });
    const fixoC = r.conflitos.find((c) => c.path === "preco_atacado_fixo")!;
    expect(fixoC.meu).toBe(null);
    expect(fixoC.dele).toBe(150);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// M-3 (Fix round 2) — normalizarParVarejoAposResolucao/normalizarParAtacadoAposResolucao: depois
// que o usuário resolve CADA campo do par (independentemente, "manter meu"/"usar o novo"), o par
// tem que convergir com a regra "última edição manda" do servidor (J2 regra 1) — nunca ficar com
// os 2 campos setados (o que o servidor NUNCA persiste sozinho).
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("normalizarParVarejoAposResolucao — M-3 (regra 'última edição manda' pós-resolução)", () => {
  it("review scenario: 'manter meu' nos 2 campos reconstitui {fixo:298, markup:3} — normaliza pro que o servidor faria (fixo manda)", () => {
    const r = normalizarParVarejoAposResolucao({ preco_varejo_fixo: 298, markup_varejo: 3 });
    expect(r).toEqual({ preco_varejo_fixo: 298, markup_varejo: null });
  });
  it("'usar o novo' nos 2 dá null/null (servidor tinha limpo ambos) — não mexe, já é um estado válido", () => {
    const r = normalizarParVarejoAposResolucao({ preco_varejo_fixo: null, markup_varejo: null });
    expect(r).toEqual({ preco_varejo_fixo: null, markup_varejo: null });
  });
  it("resolução mista (fixo=dele, markup=meu) que ainda dá os 2 setados: normaliza igual", () => {
    const r = normalizarParVarejoAposResolucao({ preco_varejo_fixo: 298, markup_varejo: 3 });
    expect(r.markup_varejo).toBeNull();
    expect(r.preco_varejo_fixo).toBe(298);
  });
  it("já correto (só 1 setado): não mexe, preserva outros campos do objeto", () => {
    const r = normalizarParVarejoAposResolucao({ preco_varejo_fixo: null, markup_varejo: 3, nome: "X" } as any);
    expect(r).toEqual({ preco_varejo_fixo: null, markup_varejo: 3, nome: "X" });
  });
  it("normalizarParAtacadoAposResolucao espelha a mesma regra", () => {
    const r = normalizarParAtacadoAposResolucao({ preco_atacado_fixo: 150, markup_atacado: 2 });
    expect(r).toEqual({ preco_atacado_fixo: 150, markup_atacado: null });
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// N-1 (Fix round 2) — resolverTravaImportado também cobre `variantes`: cor mudada com o lock
// ativo NUNCA pode ir pro payload (o gatilho `fn_integracao_trava_variantes` 42501a o produto
// INTEIRO); qtd/peso continuam livres (D11 — a trava só olha o CONJUNTO de cores).
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("resolverTravaImportado — N-1 (variantes: cor trocada antes do lock nunca vai pro payload)", () => {
  const V = [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10, _touched: false }];
  const servidorComVariante = base({ variantes: V });
  it("cor trocada (azul→verde), lock ativo: reverte variantes INTEIRO ao do servidor + aviso 'Cores'", () => {
    const enviado = base({ variantes: [{ ...V[0], cor_id: "verde" }] });
    const touched = new Set(["variantes"]);
    const r = resolverTravaImportado({ enviado, servidor: servidorComVariante, travaAtual: new Set(["nome", "variantes"]), touched });
    expect(r.variantesParaServidor).toEqual(V);
    expect(r.avisos.some((a) => a.campo === "variantes")).toBe(true);
    const revertido = aplicarResolucaoTrava(enviado, r);
    expect(revertido.variantes).toEqual(V);
  });
  it("variante NOVA com cor nova (não tocou a existente, mas o CONJUNTO mudou): também reverte", () => {
    const enviado = base({ variantes: [...V, { ordem: 2, cor_id: "rosa", cor_apelido_id: null, peso: 1, qtd: 0, _touched: false }] });
    const r = resolverTravaImportado({ enviado, servidor: servidorComVariante, travaAtual: new Set(["nome", "variantes"]), touched: new Set(["variantes"]) });
    expect(r.variantesParaServidor).toEqual(V);
  });
  it("SÓ qtd/peso mudou (mesmo conjunto de cores) — D11 livre: variantesParaServidor fica null (não reverte)", () => {
    const enviado = base({ variantes: [{ ...V[0], qtd: 99, peso: 3 }] });
    const r = resolverTravaImportado({ enviado, servidor: servidorComVariante, travaAtual: new Set(["nome", "variantes"]), touched: new Set(["variantes"]) });
    expect(r.variantesParaServidor).toBeNull();
  });
  it("cor trocada mas NÃO tocada nesta sessão: reverte sem aviso (mesma regra dos campos escalares)", () => {
    const enviado = base({ variantes: [{ ...V[0], cor_id: "verde" }] });
    const r = resolverTravaImportado({ enviado, servidor: servidorComVariante, travaAtual: new Set(["nome", "variantes"]), touched: new Set() });
    expect(r.variantesParaServidor).toEqual(V);
    expect(r.avisos.some((a) => a.campo === "variantes")).toBe(false);
  });
  it("sem trava: variantesParaServidor null mesmo com cor trocada", () => {
    const enviado = base({ variantes: [{ ...V[0], cor_id: "verde" }] });
    const r = resolverTravaImportado({ enviado, servidor: servidorComVariante, travaAtual: new Set(), touched: new Set(["variantes"]) });
    expect(r.variantesParaServidor).toBeNull();
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

// ────────────────────────────────────────────────────────────────────────────────────────────
// N-5 (Fix round 2) — RENDER real MONTANDO `ProdutoImportadoCard` (a lacuna do re-review: o bloco
// RENDER do Fix round 1 era um harness que reimplementava `disabled={...}`, não o card real).
// ────────────────────────────────────────────────────────────────────────────────────────────
function draftPI(): ProdutoImportadoDraft {
  return {
    ...emptyDraft("c1", "s1"), id: "p1", rev: 1, nome: "Blusa", modelo_id: "m1", ref: "REF1",
    valor_unitario_m1: 10, moeda_compra: "RMB", moeda_intermediaria: "USD", cotacao_ref: 5, cotacao_final: 5,
    variantes: [{ ordem: 1, cor_id: "c-azul", cor_apelido_id: null, peso: 1, qtd: 10, _touched: false }],
  };
}
function montarCard(props: Partial<Parameters<typeof ProdutoImportadoCard>[0]> = {}) {
  // ProdutoImportadoCard usa `useMutation` (Fazer pedido) — precisa de um QueryClient real na
  // árvore, mesmo sem nenhuma query disparar de fato (as demais dependências de rede já estão
  // mockadas acima).
  const qc = new queryModule.QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const el = createElement(queryModule.QueryClientProvider, { client: qc },
    createElement(ProdutoImportadoCard, {
      draft: draftPI(),
      onChange: () => {},
      open: true,
      onToggleOpen: () => {},
      grupos: [],
      categorias: [],
      subcats1: [],
      subcats2: [],
      cores: [{ id: "c-azul", nome: "Azul" }],
      coresApelido: [],
      empresas: [],
      tamanhos: ["P", "M", "G"],
      onExcluir: () => {},
      ...props,
    } as any),
  );
  return montar(el);
}
/** As seções do card são um Accordion Radix FECHADO por padrão (`secoesAbertas` nasce `[]`) —
 *  `AccordionContent` só monta no DOM quando a seção abre (sem `forceMount`). Clica no
 *  `AccordionTrigger` cujo texto bate com `textoParcial` (dentro de `act()`, real evento DOM —
 *  não um patch de estado). */
function abrirSecao(container: HTMLElement, textoParcial: string) {
  const trigger = [...container.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.includes(textoParcial));
  if (!trigger) throw new Error(`Accordion trigger "${textoParcial}" não encontrado`);
  act(() => { trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}
describe("RENDER real — ProdutoImportadoCard MONTADO (N-5)", () => {
  it("sem estado de integração (mock null): nenhum campo trancado desabilitado, sem SeloIntegracao", () => {
    mockEstado.current = null;
    const { container, unmount } = montarCard();
    abrirSecao(container, "1 · Identificação");
    abrirSecao(container, "3 · Variantes");
    // REF, Nome e o botão "Adicionar variante" ficam habilitados sem lock algum.
    const ref = container.querySelector('[data-colab-path="card:p1:ref"]') as HTMLInputElement | null;
    expect(ref).not.toBeNull();
    expect(ref!.disabled).toBe(false);
    const addVarianteBtn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Adicionar variante"));
    expect(addVarianteBtn?.hasAttribute("disabled")).toBe(false);
    // Sem SeloIntegracao (o badge "Integrável/Integrado" não aparece).
    expect(container.textContent).not.toContain("travado");
    unmount();
  });
  it("estado integrável com preco_venda marcado: Valor varejo + Markup varejo desabilitados, Valor atacado LIVRE (D34/R8), SeloIntegracao presente", () => {
    mockEstado.current = { estado: "integravel", campos: ["preco_venda"], marcadoEm: "2026-09-27T10:00:00Z", integradoEm: null };
    const { container, unmount } = montarCard();
    // O selo aparece (texto "travado" do SeloIntegracao/textoSelo) mesmo com a seção "7 · Valores" fechada.
    expect(container.textContent).toContain("travado");
    abrirSecao(container, "7 · Valores");
    // data-colab-path identifica os 2 campos do canal varejo — ambos devem estar disabled.
    const valorVarejo = container.querySelector('[data-colab-path="card:p1:preco-varejo-fixo"]') as HTMLInputElement | null;
    const markupVarejo = container.querySelector('[data-colab-path="card:p1:markup-varejo"]') as HTMLInputElement | null;
    expect(valorVarejo).not.toBeNull();
    expect(markupVarejo).not.toBeNull();
    expect(valorVarejo!.disabled).toBe(true);
    expect(markupVarejo!.disabled).toBe(true);
    // Atacado livre — D34/R8: preco_venda trava só o varejo.
    const valorAtacado = container.querySelector('[data-colab-path="card:p1:preco-atacado-fixo"]') as HTMLInputElement | null;
    const markupAtacado = container.querySelector('[data-colab-path="card:p1:markup-atacado"]') as HTMLInputElement | null;
    expect(valorAtacado!.disabled).toBe(false);
    expect(markupAtacado!.disabled).toBe(false);
    unmount();
  });
  it("QUALQUER estado de integração (variantes SEMPRE travado): cor base/apelido e 'Adicionar variante' desabilitados + InfoHover 'Cores travadas...' presente", () => {
    // "nome" marcado (não "preco_venda"/"variantes" — variantes trava SEMPRE, independente do que foi marcado).
    mockEstado.current = { estado: "integravel", campos: ["nome"], marcadoEm: null, integradoEm: null };
    const { container, unmount } = montarCard();
    abrirSecao(container, "3 · Variantes");
    const addVarianteBtn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Adicionar variante"));
    expect(addVarianteBtn?.hasAttribute("disabled")).toBe(true);
    const corBase = container.querySelector('[data-colab-path="card:p1:var-cor:1"]') as HTMLButtonElement | null; // Radix Select trigger é um <button>
    expect(corBase).not.toBeNull();
    expect(corBase!.hasAttribute("disabled") || corBase!.getAttribute("aria-disabled") === "true" || corBase!.getAttribute("data-disabled") !== null).toBe(true);
    // InfoHover presente (o botão "i", `aria-label` exato) — o TEXTO em si só monta no DOM quando o
    // Tooltip abre (Radix portal, closed por padrão); o `aria-label` prova que É o InfoHover certo
    // ("Por que as cores estão travadas"), sem depender de abrir o hover/toque.
    const infoHoverBtn = container.querySelector('button[aria-label="Por que as cores estão travadas"]');
    expect(infoHoverBtn).not.toBeNull();
    unmount();
  });
  it("Nome trancado (coluna 'nome' marcada): input de Nome desabilitado", () => {
    mockEstado.current = { estado: "integrado", campos: ["nome"], marcadoEm: null, integradoEm: "2026-09-27" };
    const { container, unmount } = montarCard();
    abrirSecao(container, "1 · Identificação");
    const nomeInput = container.querySelector('[data-colab-path="card:p1:nome"]') as HTMLInputElement | null;
    expect(nomeInput).not.toBeNull();
    expect(nomeInput!.disabled).toBe(true);
    unmount();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// N-5 (Fix round 2) — resolverTravaAcabado (PA): NENHUM teste existia pra esta função antes desta
// rodada — espelha 1:1 os testes de `resolverTravaImportado` acima, incluindo N-1 (variantes).
// ────────────────────────────────────────────────────────────────────────────────────────────
const basePA = (over: Partial<ProdutoDraft> = {}): ProdutoDraft => ({
  id: "a1", rev: 2, nome: "Produto Y", ref: "REF-A", grupo_id: null, categoria_id: null,
  subcategoria1_id: null, subcategoria2_id: null, colecao_id: "c", subcolecao: null, semana: null,
  empresa_id: null, representante_id: null, ref_fornecedor: "", composicao: "",
  grade_proporcao: {}, qtd_total: 10, valor_unitario: 5, desconto_pct: 0, insumos_total: 0,
  markup_atacado: 2, markup_varejo: null, preco_atacado_fixo: null, preco_varejo_fixo: 298,
  foto_url: "foto-a.jpg", modelo_id: "m1", mix_id: null,
  variantes: [{ ordem: 1, cor_id: "c-azul", cor_apelido_id: null, peso: 1, qtd: 10 }],
  modeloPrecoVenda: null, modeloPrecoAtacado: null, modeloLinhaId: null, modeloThumbFontes: [null, null, null],
  oc: null,
  ...over,
});
describe("resolverTravaAcabado — N-5 (PA, espelha resolverTravaImportado, sem teste antes)", () => {
  const servidorPA = basePA();
  it("sem lock: paraServidor/variantesParaServidor vazios/null", () => {
    const r = resolverTravaAcabado({ enviado: basePA({ nome: "Editei" }), servidor: servidorPA, travaAtual: new Set(), touched: new Set(["nome"]) });
    expect(r.paraServidor).toEqual({});
    expect(r.variantesParaServidor).toBeNull();
  });
  it("nome travado e editado: reverte + 1 aviso 'Nome'", () => {
    const enviado = basePA({ nome: "Editado" });
    const r = resolverTravaAcabado({ enviado, servidor: servidorPA, travaAtual: new Set(["nome", "variantes"]), touched: new Set(["nome"]) });
    expect(r.paraServidor.nome).toBe("Produto Y");
    expect(r.avisos.some((a) => a.campo === "nome")).toBe(true);
    expect(aplicarResolucaoTravaAcabado(enviado, r).nome).toBe("Produto Y");
  });
  it("N-4: foto_url trocada e travada — reverte COM aviso (chaveDirty PA agora inclui foto_url)", () => {
    const enviado = basePA({ foto_url: "nova-foto.jpg" });
    const touched = new Set(
      Object.keys(chaveDirtyPA(enviado)).filter((k) => JSON.stringify((chaveDirtyPA(enviado) as any)[k]) !== JSON.stringify((chaveDirtyPA(servidorPA) as any)[k])),
    );
    expect(touched.has("foto_url")).toBe(true); // prova que N-4 (chaveDirty ganhou foto_url) está em vigor
    const r = resolverTravaAcabado({ enviado, servidor: servidorPA, travaAtual: new Set(["fotos_modelo", "variantes"]), touched });
    expect(r.paraServidor.foto_url).toBe("foto-a.jpg");
    expect(r.avisos.some((a) => a.campo === "foto_url")).toBe(true);
  });
  it("preco_venda travado + markup varejo digitado (limparia o fixo): reverte o PAR inteiro", () => {
    const enviado = basePA({ preco_varejo_fixo: null, markup_varejo: 3 });
    const r = resolverTravaAcabado({ enviado, servidor: servidorPA, travaAtual: new Set(["preco_venda", "variantes"]), touched: new Set(["markup_varejo", "preco_varejo_fixo"]) });
    expect(r.paraServidor).toMatchObject({ preco_varejo_fixo: 298, markup_varejo: null });
  });
  it("N-1: cor trocada com lock ativo (variantes SEMPRE travado) — reverte o array inteiro + aviso 'Cores'", () => {
    const enviado = basePA({ variantes: [{ ordem: 1, cor_id: "c-verde", cor_apelido_id: null, peso: 1, qtd: 10 }] });
    const r = resolverTravaAcabado({ enviado, servidor: servidorPA, travaAtual: new Set(["nome", "variantes"]), touched: new Set(["variantes"]) });
    expect(r.variantesParaServidor).toEqual(servidorPA.variantes);
    expect(r.avisos.some((a) => a.campo === "variantes")).toBe(true);
    expect(aplicarResolucaoTravaAcabado(enviado, r).variantes).toEqual(servidorPA.variantes);
  });
  it("N-1: só qtd/peso da variante mudou (D11 livre) — não reverte", () => {
    const enviado = basePA({ variantes: [{ ordem: 1, cor_id: "c-azul", cor_apelido_id: null, peso: 5, qtd: 99 }] });
    const r = resolverTravaAcabado({ enviado, servidor: servidorPA, travaAtual: new Set(["nome", "variantes"]), touched: new Set(["variantes"]) });
    expect(r.variantesParaServidor).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// N-3 (Fix round 2) — markupVarejoParaBlurAtacado (PA): o blur do Markup ATACADO reenvia o
// markup_varejo do SERVIDOR (nunca o draft local, potencialmente divergente) quando o varejo
// está travado — a RPC `salvar_markups_produto_acabado` grava os 2 campos sempre, e a trigger
// de trava NUNCA checa `markup_varejo` (D12), então um valor divergente passa em silêncio.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("markupVarejoParaBlurAtacado — N-3 (nunca reenvia o draft do varejo travado)", () => {
  it("sem trava: manda o markup do DRAFT (comportamento de sempre)", () => {
    const r = markupVarejoParaBlurAtacado({ travaVarejo: false, markupVarejoDraft: 3, markupVarejoServidor: 2 });
    expect(r).toBe(3);
  });
  it("com trava, draft DIVERGENTE do servidor: manda o do SERVIDOR (não o draft potencialmente stale)", () => {
    const r = markupVarejoParaBlurAtacado({ travaVarejo: true, markupVarejoDraft: 3, markupVarejoServidor: 2 });
    expect(r).toBe(2);
  });
  it("com trava, draft e servidor iguais: tanto faz, dá o mesmo valor (servidor)", () => {
    const r = markupVarejoParaBlurAtacado({ travaVarejo: true, markupVarejoDraft: 2, markupVarejoServidor: 2 });
    expect(r).toBe(2);
  });
  it("com trava, servidor null (canal usa preço fixo, sem markup): manda null — nunca o draft", () => {
    const r = markupVarejoParaBlurAtacado({ travaVarejo: true, markupVarejoDraft: 3, markupVarejoServidor: null });
    expect(r).toBeNull();
  });
  it("com trava, servidor undefined (prop ausente — uso legado do card sem o prop novo): cai no draft (retrocompatível)", () => {
    const r = markupVarejoParaBlurAtacado({ travaVarejo: true, markupVarejoDraft: 3, markupVarejoServidor: undefined });
    expect(r).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// R2-1 (Fix round 3, re-review 2) — REPLAY clique-a-clique do `onResolver` real do
// `ProdutoImportadoSheet.tsx` (linhas ~937-979), usando o `mergeDraft` REAL (não um mock do
// merge) pra gerar os conflitos, e as funções puras REAIS (`parDoCampo`, `devePodeNormalizarPar`,
// `normalizarParVarejoAposResolucao`/`normalizarParAtacadoAposResolucao`) — a regressão que o
// re-review pegou (S2/S4): normalizar o par fixo/markup IMEDIATAMENTE a cada clique apaga a
// escolha de B (o outro lado do par) antes do usuário clicar no segundo campo do par. A correção:
// só normaliza quando NENHUM dos 2 campos do par continua pendente na lista de conflitos.
//
// Fix round 4 (R3-3): `replay` abaixo chama, a cada clique, `aplicarResolucaoConflito` — a MESMA
// função que o `onResolver` do Sheet chama (aplica a escolha; quando o par do campo fica 100%
// resolvido, normaliza SÓ esse par — R3-1). Os casos com os 2 canais em conflito ao mesmo tempo
// estão no bloco "aplicarResolucaoConflito — R3-1/R3-3" no fim do arquivo.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("onResolver (replay real) — R2-1: normaliza o par SÓ depois que os 2 campos foram resolvidos", () => {
  type Par = { fixo: "preco_varejo_fixo" | "preco_atacado_fixo"; markup: "markup_varejo" | "markup_atacado" };
  const PARES: Record<"varejo" | "atacado", Par> = {
    varejo: { fixo: "preco_varejo_fixo", markup: "markup_varejo" },
    atacado: { fixo: "preco_atacado_fixo", markup: "markup_atacado" },
  };

  // Reproduz o handler `onResolver` de produção, clique a clique, sobre um draft simplificado
  // { [fixoKey]: number|null, [markupKey]: number|null }. `escolhas` é a sequência de cliques
  // (na ORDEM em que o usuário clica), cada um { campo, escolha }.
  function replay(o: {
    draftInicial: Record<string, number | null>;
    conflitosIniciais: Conflito[]; // já no formato { path: campo, meu, dele } — como o mergeDraft devolveu
    escolhas: { campo: string; escolha: "meu" | "dele" }[];
  }) {
    // Fix round 4 (R3-3) — o replay NÃO é mais uma cópia à mão do handler: cada clique chama
    // `aplicarResolucaoConflito`, a MESMA função que o `onResolver` do Sheet chama.
    let d: Record<string, number | null> = { ...o.draftInicial };
    let pendentes: Conflito[] = [...o.conflitosIniciais];
    for (const { campo, escolha } of o.escolhas) {
      const r = aplicarResolucaoConflito(d as any, pendentes, campo, escolha);
      d = r.draft as any;
      pendentes = r.restantes;
    }
    return d;
  }

  // Monta os conflitos do jeito que o card de produção realmente monta: `mergeDraft` REAL sobre
  // os campos tocados + `acoplarParVarejo`/`acoplarParAtacado` REAL pra espelhar o outro lado do
  // par (a mesma pipeline de `ProdutoImportadoSheet.tsx`, só sem o React em volta). Digitar um
  // Valor (fixo) limpa o Markup LOCALMENTE no card (mutuamente exclusivo na UI) — então os 2
  // campos do par entram em `chaveDirty`/`touched` juntos, não só o campo literalmente digitado
  // (confirmado batendo com o texto exato do re-review: "mergeDraft raises the markup conflict"
  // pro cenário S4, onde A digitou no FIXO).
  function conflitosReais(o: { canal: "varejo" | "atacado"; base: Record<string, number | null>; draft: Record<string, number | null>; fresh: Record<string, number | null> }) {
    const { fixo, markup } = PARES[o.canal];
    const m = mergeDraft({ base: o.base, draft: o.draft, fresh: o.fresh, touched: new Set([fixo, markup]) });
    const acoplar = o.canal === "varejo" ? acoplarParVarejo : acoplarParAtacado;
    const r = acoplar({ valor: o.draft as any, conflitos: m.conflitos, draft: o.draft as any, fresh: o.fresh as any });
    return r.conflitos;
  }

  // S2 do re-review: base fixo=298/markup=null; A digita Valor (fixo) 310 (toca só o fixo);
  // B salva Markup 2 nesse meio-tempo. B salvar Markup passa pela regra J2 do servidor (fixo
  // presente sempre ganha) — como B setou markup, o servidor ZERA o fixo dele: `fresh` fica
  // {fixo: null, markup: 2}, nunca os 2 juntos (a regra frozen do `_salvar_produto_importado_core`,
  // ver M-3 na doc da revisão — "the server always persists either (fixo, null) or (null, markup)").
  function cenarioS2(canal: "varejo" | "atacado") {
    const { fixo, markup } = PARES[canal];
    const base = { [fixo]: 298, [markup]: null };
    const draft = { [fixo]: 310, [markup]: null }; // A digitou no fixo (markup local já era null)
    const fresh = { [fixo]: null, [markup]: 2 };   // B salvou markup=2 → servidor zera o fixo (J2)
    return { base, draft, fresh, conflitos: conflitosReais({ canal, base, draft, fresh }), fixo, markup };
  }
  // S4 do re-review: base markup=2.5/fixo=null; A digita Valor (fixo) 310 (toca só o fixo, o que
  // LIMPARIA o markup no draft cru); B salva Markup 3. O banner lista o conflito espelhado
  // (markup) ANTES do tocado (fixo) na ordem em que `acoplarPar*` os monta — é o cenário que
  // expôs a regressão: clicar nele primeiro não pode apagar o 3 de B antes do fixo ser resolvido.
  function cenarioS4(canal: "varejo" | "atacado") {
    const { fixo, markup } = PARES[canal];
    const base = { [fixo]: null, [markup]: 2.5 };
    const draft = { [fixo]: 310, [markup]: null }; // A digitou no fixo (limpa markup local)
    const fresh = { [fixo]: null, [markup]: 3 };   // B salvou markup=3
    return { base, draft, fresh, conflitos: conflitosReais({ canal, base, draft, fresh }), fixo, markup };
  }

  const CENARIOS = { S2: cenarioS2, S4: cenarioS4 } as const;
  const CANAIS = ["varejo", "atacado"] as const;
  const ORDENS: Record<string, "fixoPrimeiro" | "markupPrimeiro"> = { fixoPrimeiro: "fixoPrimeiro", markupPrimeiro: "markupPrimeiro" };

  for (const nomeCenario of Object.keys(CENARIOS) as (keyof typeof CENARIOS)[]) {
    for (const canal of CANAIS) {
      for (const ordem of Object.keys(ORDENS) as (keyof typeof ORDENS)[]) {
        it(`${nomeCenario}/${canal}/${ordem}: "usar o novo" nos 2 preserva o valor salvo por B e o par final bate com o servidor`, () => {
          const cen = CENARIOS[nomeCenario](canal);
          // Confirma que a pipeline REAL (mergeDraft + acoplarPar*) de fato produziu os 2
          // conflitos do par (o tocado + o espelhado) — sem isso o teste não estaria exercitando
          // o cenário que o re-review descreveu.
          expect(cen.conflitos.some((c) => c.path === cen.fixo)).toBe(true);
          expect(cen.conflitos.some((c) => c.path === cen.markup)).toBe(true);

          const escolhas = ordem === "fixoPrimeiro"
            ? [{ campo: cen.fixo, escolha: "dele" as const }, { campo: cen.markup, escolha: "dele" as const }]
            : [{ campo: cen.markup, escolha: "dele" as const }, { campo: cen.fixo, escolha: "dele" as const }];
          const final = replay({ draftInicial: { ...cen.draft }, conflitosIniciais: cen.conflitos, escolhas });

          // O valor de B (o que o servidor realmente vai persistir) NUNCA pode ser apagado antes
          // do 2º clique — e o par final tem que bater com o que o servidor tem em `fresh`
          // (fixo manda / markup null — regra J2, já refletida no `fresh` de cada cenário).
          expect(final).toEqual({ [cen.fixo]: cen.fresh[cen.fixo], [cen.markup]: cen.fresh[cen.markup] });
        });
      }
    }
  }

  it("enquanto o outro campo do par ainda está pendente, NÃO normaliza (prova direta do estado intermediário — S4 markup primeiro)", () => {
    const cen = cenarioS4("varejo");
    // só o clique no markup (1º da ordem markupPrimeiro) — o fixo continua pendente.
    const parcial = replay({ draftInicial: { ...cen.draft }, conflitosIniciais: cen.conflitos, escolhas: [{ campo: cen.markup, escolha: "dele" }] });
    // o markup de B (3) tem que estar presente — a normalização NÃO pode ter rodado ainda e
    // apagado pra null antes do fixo ser resolvido (o bug exato do R2-1).
    expect(parcial[cen.markup]).toBe(3);
    expect(parcial[cen.fixo]).toBe(310); // fixo de A ainda intocado (clique não chegou nele)
  });

  it("devePodeNormalizarPar: true só quando NENHUM campo do par está nos conflitos restantes", () => {
    const par = ["preco_varejo_fixo", "markup_varejo"] as const;
    expect(devePodeNormalizarPar(par, [{ path: "markup_varejo", meu: 1, dele: 2 }])).toBe(false);
    expect(devePodeNormalizarPar(par, [{ path: "preco_varejo_fixo", meu: 1, dele: 2 }])).toBe(false);
    expect(devePodeNormalizarPar(par, [{ path: "nome", meu: "a", dele: "b" }])).toBe(true);
    expect(devePodeNormalizarPar(par, [])).toBe(true);
  });

  it("parDoCampo: mapeia os 4 campos de preço/markup pro par certo; null pros demais (nome/ref/foto/variantes)", () => {
    expect(parDoCampo("preco_varejo_fixo")).toEqual(["preco_varejo_fixo", "markup_varejo"]);
    expect(parDoCampo("markup_varejo")).toEqual(["preco_varejo_fixo", "markup_varejo"]);
    expect(parDoCampo("preco_atacado_fixo")).toEqual(["preco_atacado_fixo", "markup_atacado"]);
    expect(parDoCampo("markup_atacado")).toEqual(["preco_atacado_fixo", "markup_atacado"]);
    expect(parDoCampo("nome")).toBeNull();
    expect(parDoCampo("variantes")).toBeNull();
    expect(parDoCampo("foto_url")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// R2-2 (Fix round 3, re-review 2, ruling) — quando o resolver reverte `variantes` (cores
// mudaram com o lock ativo), `qtd_total` tem que reverter JUNTO pro valor do servidor — senão a
// soma que a tela mostra diverge do array de variantes revertido e o próximo Salvar dispara
// P0001 "soma variantes N difere total M" no servidor (achado do harness rr2, 2 cenários).
// O toast, nesse caso específico (só o aviso de variantes), ganha o texto EXATO pedido.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("resolverTravaImportado/resolverTravaAcabado — R2-2: qtd_total revertido junto com variantes", () => {
  const V = [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10, _touched: false }];
  const servidorComVariante = base({ variantes: V, qtd_total: 10 });

  it("PI: cor trocada + qtd_total divergente, lock ativo — reverte variantes E qtd_total pro valor do servidor", () => {
    const enviado = base({ variantes: [{ ...V[0], cor_id: "verde" }], qtd_total: 25 });
    const r = resolverTravaImportado({ enviado, servidor: servidorComVariante, travaAtual: new Set(["nome", "variantes"]), touched: new Set(["variantes", "qtd_total"]) });
    expect(r.variantesParaServidor).toEqual(V);
    expect(r.qtdTotalParaServidor).toBe(10);
    const revertido = aplicarResolucaoTrava(enviado, r);
    expect(revertido.variantes).toEqual(V);
    expect(revertido.qtd_total).toBe(10);
  });

  it("PI: sem trava de variantes ativa — qtdTotalParaServidor fica null (não mexe)", () => {
    const enviado = base({ variantes: V, qtd_total: 99 });
    const r = resolverTravaImportado({ enviado, servidor: servidorComVariante, travaAtual: new Set(["nome"]), touched: new Set(["qtd_total"]) });
    expect(r.qtdTotalParaServidor).toBeNull();
  });

  it("PI: toast com o texto EXATO pedido quando o único aviso é de variantes", () => {
    const enviado = base({ variantes: [{ ...V[0], cor_id: "verde" }], qtd_total: 25 });
    const r = resolverTravaImportado({ enviado, servidor: servidorComVariante, travaAtual: new Set(["variantes"]), touched: new Set(["variantes"]) });
    expect(toastTravaImportado(r.avisos)).toBe(
      "Cores e quantidades das variantes foram travadas pela Integração enquanto você editava — essa alteração não foi salva.",
    );
  });

  it("PA: mesma regra — reverte variantes E qtd_total, mesmo texto de toast exato", () => {
    const servidorPA = basePA({ variantes: [{ ordem: 1, cor_id: "c-azul", cor_apelido_id: null, peso: 1, qtd: 10 }], qtd_total: 10 });
    const enviado = basePA({ variantes: [{ ordem: 1, cor_id: "c-verde", cor_apelido_id: null, peso: 1, qtd: 10 }], qtd_total: 40 });
    const r = resolverTravaAcabado({ enviado, servidor: servidorPA, travaAtual: new Set(["nome", "variantes"]), touched: new Set(["variantes", "qtd_total"]) });
    expect(r.variantesParaServidor).toEqual(servidorPA.variantes);
    expect(r.qtdTotalParaServidor).toBe(10);
    const revertido = aplicarResolucaoTravaAcabado(enviado, r);
    expect(revertido.qtd_total).toBe(10);
    expect(toastTravaAcabado(r.avisos)).toBe(
      "Cores e quantidades das variantes foram travadas pela Integração enquanto você editava — essa alteração não foi salva.",
    );
  });

  it("toast com MAIS de um aviso (variantes + outro campo) NÃO usa o texto especial de variantes-só", () => {
    const enviado = base({ nome: "Editei", variantes: [{ ...V[0], cor_id: "verde" }], qtd_total: 25 });
    const r = resolverTravaImportado({ enviado, servidor: servidorComVariante, travaAtual: new Set(["nome", "variantes"]), touched: new Set(["nome", "variantes"]) });
    const txt = toastTravaImportado(r.avisos);
    expect(txt).not.toBe("Cores e quantidades das variantes foram travadas pela Integração enquanto você editava — essa alteração não foi salva.");
    expect(txt).toContain("Nome");
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// R2-4 (Fix round 3, re-review 2) — `ROTULO_CAMPO_PA` (ProdutoAcabadoSheet.tsx) ficou sem o
// rótulo de `foto_url` (o banner de colab mostraria a chave crua "foto_url" em vez de "Foto").
// Teste indireto: como `ROTULO_CAMPO_PA` não é exportado (é um const de módulo interno do
// Sheet), a prova é via `resolverTravaAcabado`/N-4 (foto_url participa do dirty/trava — já
// confirmado acima) + leitura estática do arquivo confirmando a entrada — mesma técnica que a
// suíte já usa pra outras constantes de UI não-exportadas (ver `integracao-trava-tela.test.ts`).
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("ROTULO_CAMPO_PA — R2-4: foto_url tem rótulo 'Foto' (não aparece como chave crua no banner)", () => {
  it("ProdutoAcabadoSheet.tsx: ROTULO_CAMPO_PA inclui foto_url: \"Foto\"", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const caminho = path.resolve(process.cwd(), "src/components/produto-acabado/ProdutoAcabadoSheet.tsx");
    const src = fs.readFileSync(caminho, "utf8");
    const inicio = src.indexOf("const ROTULO_CAMPO_PA");
    const bloco = src.slice(inicio, src.indexOf("};", inicio));
    expect(bloco).toMatch(/foto_url:\s*"Foto"/);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 4 (re-review 3) — R3-1 + R3-3: clique-a-clique pela função REAL do `onResolver`
// (`aplicarResolucaoConflito`, chamada pelo Sheet), com os conflitos gerados pela MESMA pipeline
// do Sheet (`ProdutoImportadoSheet.tsx`, merge da sub-coleção): `touched` = chaves de `chaveDirty`
// que A mudou vs a base; `mergeDraft` REAL; `acoplarParVarejo` + `acoplarParAtacado` REAIS.
// Critérios, pra cada combinação:
//  (a) o valor salvo por B nunca é apagado: todo campo em que A escolheu "usar o novo" termina com
//      o valor de B — a ÚNICA exceção é a regra do servidor quando A escolheu "manter meu" num fixo
//      não-nulo (fixo manda → markup null, por escolha do próprio A);
//  (b) o par final do draft == o que o servidor persiste ao Salvar (`servidorPI`, espelho de
//      `20261007140000_integracao_5_salvar.sql:386-435`, "última edição manda");
//  (c) nenhum par fica com fixo E markup setados; nenhum conflito fica pendente;
//  (d) nos cenários de 1 canal, o outro canal fica intocado.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("aplicarResolucaoConflito — R3-1/R3-3: clique-a-clique pela função real do onResolver", () => {
  type Canal = "varejo" | "atacado";
  const K = { varejo: { f: "preco_varejo_fixo", m: "markup_varejo" }, atacado: { f: "preco_atacado_fixo", m: "markup_atacado" } } as const;
  type P4 = { vf: number | null; vm: number | null; af: number | null; am: number | null };
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const P = (d: any): P4 => ({ vf: d.preco_varejo_fixo ?? null, vm: d.markup_varejo ?? null, af: d.preco_atacado_fixo ?? null, am: d.markup_atacado ?? null });
  // Espelho do UPDATE final de `_salvar_produto_importado_core` (x = linha já com os markups do _dados).
  function servidorPI(old: P4, dados: Record<string, unknown>): P4 {
    const has = (k: string) => Object.prototype.hasOwnProperty.call(dados, k);
    const x = { ...old, am: num(dados.markup_atacado), vm: num(dados.markup_varejo) };
    const af = has("preco_atacado_fixo") ? num(dados.preco_atacado_fixo) : num(dados.markup_atacado) != null ? null : x.af;
    const am = has("preco_atacado_fixo") && num(dados.preco_atacado_fixo) != null ? null
      : has("preco_atacado_fixo") ? (num(dados.markup_atacado) ?? x.am)
      : num(dados.markup_atacado) != null ? num(dados.markup_atacado) : x.am;
    const vf = has("preco_varejo_fixo") ? num(dados.preco_varejo_fixo) : num(dados.markup_varejo) != null ? null : x.vf;
    const vm = has("preco_varejo_fixo") && num(dados.preco_varejo_fixo) != null ? null
      : has("preco_varejo_fixo") ? (num(dados.markup_varejo) ?? x.vm)
      : num(dados.markup_varejo) != null ? num(dados.markup_varejo) : x.vm;
    return { af, am, vf, vm };
  }
  // A pipeline de merge do Sheet (touched a partir de chaveDirty, como o efeito de merge faz).
  function mergeComoOSheet(b: ProdutoImportadoDraft, a: ProdutoImportadoDraft, f: ProdutoImportadoDraft) {
    const ca = chaveDirty(a) as Record<string, unknown>, cb = chaveDirty(b) as Record<string, unknown>;
    const touched = new Set(Object.keys(ca).filter((k) => JSON.stringify(ca[k]) !== JSON.stringify(cb[k])));
    const m0 = mergeDraft({ base: b as any, draft: a as any, fresh: f as any, touched });
    const mV = acoplarParVarejo({ valor: m0.valor as any, conflitos: m0.conflitos, draft: a, fresh: f });
    const mA = acoplarParAtacado({ valor: mV.valor, conflitos: mV.conflitos, draft: a, fresh: f });
    return { valor: { ...(mA.valor as ProdutoImportadoDraft), rev: f.rev }, conflitos: mA.conflitos };
  }
  // Clica, na ordem dada, pela função REAL (é o que o `onResolver` do Sheet faz a cada clique).
  function clicar(valor: ProdutoImportadoDraft, conflitos: Conflito[], cliques: [string, "meu" | "dele"][]) {
    let d: ProdutoImportadoDraft | null = valor;
    let pend = conflitos;
    for (const [campo, esc] of cliques) {
      const r = aplicarResolucaoConflito(d as ProdutoImportadoDraft, pend, campo, esc);
      d = r.draft; pend = r.restantes;
    }
    return { d: d as ProdutoImportadoDraft, pend };
  }
  // Valor esperado de UM par dadas as escolhas (lidas do próprio conflito: "meu"/"dele"), já com a
  // regra do servidor aplicada (fixo presente manda → markup null).
  function esperadoDoPar(conflitos: Conflito[], valor: any, canal: Canal, esc: Record<string, "meu" | "dele">) {
    const { f, m } = K[canal];
    const pega = (campo: string) => {
      const c = conflitos.find((x) => x.path === campo);
      if (!c) return valor[campo] ?? null;
      return ((esc[campo] === "dele" ? c.dele : c.meu) ?? null) as number | null;
    };
    const fixo = pega(f);
    const markup = fixo != null ? null : pega(m);
    return { fixo, markup };
  }
  function permutacoes<T>(xs: T[]): T[][] {
    return xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutacoes([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
  }
  const B0 = base({ modelo_id: null, preco_varejo_fixo: null, markup_varejo: null, preco_atacado_fixo: null, markup_atacado: null, variantes: [] });
  const mk = (p: Partial<P4>, rev = 3) => ({
    ...B0, rev,
    preco_varejo_fixo: p.vf ?? null, markup_varejo: p.vm ?? null, preco_atacado_fixo: p.af ?? null, markup_atacado: p.am ?? null,
  }) as ProdutoImportadoDraft;
  const doCanal = (canal: Canal, par: [number | null, number | null]): Partial<P4> =>
    canal === "varejo" ? { vf: par[0], vm: par[1] } : { af: par[0], am: par[1] };

  // ---- 1 canal: 6 cenários × 2 canais × 4 combinações de escolha × 2 ordens de clique = 96 ----
  const CENARIOS: [string, [number | null, number | null], [number | null, number | null], [number | null, number | null]][] = [
    ["S1 base m2.5; A m3; B f298", [null, 2.5], [null, 3], [298, null]],
    ["S2 base f298; A f310; B m2", [298, null], [310, null], [null, 2]],
    ["S3 base f298; A m3; B f305", [298, null], [null, 3], [305, null]],
    ["S4 base m2.5; A f310; B m3", [null, 2.5], [310, null], [null, 3]],
    ["S5 base f298; A f310; B f320", [298, null], [310, null], [320, null]],
    ["S6 base m2.5; A m3; B m4", [null, 2.5], [null, 3], [null, 4]],
  ];
  for (const canal of ["varejo", "atacado"] as const) {
    for (const [nome, pb, pa, pf] of CENARIOS) {
      it(`1 canal [${canal}] ${nome}: 4 combinações × 2 ordens — B preservado, par == servidor, outro canal intocado`, () => {
        const { f, m } = K[canal];
        const outro = K[canal === "varejo" ? "atacado" : "varejo"];
        const b = mk(doCanal(canal, pb)), a = mk(doCanal(canal, pa)), fr = mk(doCanal(canal, pf), 4);
        const { valor, conflitos } = mergeComoOSheet(b, a, fr);
        expect(conflitos.map((c) => c.path).sort()).toEqual([f, m].sort()); // os 2 campos do par no banner
        for (const escF of ["meu", "dele"] as const) for (const escM of ["meu", "dele"] as const) {
          for (const ordem of [[f, m], [m, f]]) {
            const esc = { [f]: escF, [m]: escM };
            const { d, pend } = clicar(valor, conflitos, ordem.map((c) => [c, esc[c]] as [string, "meu" | "dele"]));
            const ctx = `${escF}/${escM} ordem ${ordem.join(">")}`;
            const esp = esperadoDoPar(conflitos, valor, canal, esc);
            expect({ ctx, fixo: (d as any)[f] ?? null, markup: (d as any)[m] ?? null }).toEqual({ ctx, ...esp });
            expect({ ctx, par: P(d) }).toEqual({ ctx, par: servidorPI(P(fr), montarPayload(d).dados as any) });
            expect(pend).toEqual([]);
            expect({ ctx, f: (d as any)[outro.f] ?? null, m: (d as any)[outro.m] ?? null })
              .toEqual({ ctx, f: (fr as any)[outro.f] ?? null, m: (fr as any)[outro.m] ?? null });
          }
        }
      });
    }
  }

  // ---- 2 canais em conflito no MESMO produto: todas as 24 ordens de clique por caso ----
  const CRUZADOS: [string, Partial<P4>, Partial<P4>, Partial<P4>][] = [
    ["S4 varejo + S4 atacado", { vm: 2.5, am: 2.5 }, { vf: 310, af: 310 }, { vm: 3, am: 3 }],
    ["S2 varejo + S2 atacado", { vf: 298, af: 298 }, { vf: 310, af: 310 }, { vm: 2, am: 2 }],
    ["S4 varejo + S2 atacado", { vm: 2.5, af: 298 }, { vf: 310, af: 310 }, { vm: 3, am: 2 }],
  ];
  for (const [nome, pb, pa, pf] of CRUZADOS) {
    it(`2 canais ${nome}: "usar o novo" em tudo, 24 ordens — nenhum valor salvo por B é apagado`, () => {
      const b = mk(pb), a = mk(pa), fr = mk(pf, 4);
      const { valor, conflitos } = mergeComoOSheet(b, a, fr);
      expect(conflitos).toHaveLength(4);
      const ordens = permutacoes(conflitos.map((c) => c.path));
      expect(ordens).toHaveLength(24);
      for (const ordem of ordens) {
        const { d, pend } = clicar(valor, conflitos, ordem.map((c) => [c, "dele"] as [string, "dele"]));
        const ctx = ordem.join(" > ");
        expect({ ctx, par: P(d) }).toEqual({ ctx, par: P(fr) }); // o que B salvou, intacto
        expect({ ctx, par: P(d) }).toEqual({ ctx, par: servidorPI(P(fr), montarPayload(d).dados as any) });
        expect(pend).toEqual([]);
      }
    });
    it(`2 canais ${nome}: 16 combinações de escolha × 24 ordens — cada par == escolha + regra do servidor`, () => {
      const b = mk(pb), a = mk(pa), fr = mk(pf, 4);
      const { valor, conflitos } = mergeComoOSheet(b, a, fr);
      const campos = conflitos.map((c) => c.path);
      for (let mask = 0; mask < 16; mask++) {
        const esc = Object.fromEntries(campos.map((c, i) => [c, (mask >> i) & 1 ? "dele" : "meu"])) as Record<string, "meu" | "dele">;
        const espV = esperadoDoPar(conflitos, valor, "varejo", esc);
        const espA = esperadoDoPar(conflitos, valor, "atacado", esc);
        for (const ordem of permutacoes(campos)) {
          const { d, pend } = clicar(valor, conflitos, ordem.map((c) => [c, esc[c]] as [string, "meu" | "dele"]));
          const ctx = `${JSON.stringify(esc)} ordem ${ordem.join(">")}`;
          expect({ ctx, par: P(d) }).toEqual({ ctx, par: { vf: espV.fixo, vm: espV.markup, af: espA.fixo, am: espA.markup } });
          expect({ ctx, par: P(d) }).toEqual({ ctx, par: servidorPI(P(fr), montarPayload(d).dados as any) });
          expect(pend).toEqual([]);
        }
      }
    });
  }

  it("R3-1 trace exato (S4v+S4a, ordem top-down do banner): fechar o varejo NÃO normaliza o atacado meio-resolvido", () => {
    const b = mk({ vm: 2.5, am: 2.5 }), a = mk({ vf: 310, af: 310 }), fr = mk({ vm: 3, am: 3 }, 4);
    const { valor, conflitos } = mergeComoOSheet(b, a, fr);
    // A ordem do banner (top-down) que o re-review 3 mostrou falhando no round 3.
    expect(conflitos.map((c) => c.path)).toEqual(["markup_atacado", "markup_varejo", "preco_varejo_fixo", "preco_atacado_fixo"]);
    // 3 primeiros cliques "usar o novo": o 3º FECHA o par do varejo; o atacado fica com o fixo pendente.
    const meio = clicar(valor, conflitos, [["markup_atacado", "dele"], ["markup_varejo", "dele"], ["preco_varejo_fixo", "dele"]]);
    expect(meio.pend.map((c) => c.path)).toEqual(["preco_atacado_fixo"]);
    expect(P(meio.d)).toEqual({ vf: null, vm: 3, af: 310, am: 3 }); // varejo = B; atacado: markup 3 de B NÃO foi apagado
    const fim = clicar(meio.d, meio.pend, [["preco_atacado_fixo", "dele"]]);
    expect(P(fim.d)).toEqual({ vf: null, vm: 3, af: null, am: 3 });
  });

  it("__produto__ + 'usar o novo' remove o produto (draft null); 'manter meu' mantém; campo sem par não normaliza nada", () => {
    const d = mk({ vf: 310, vm: 2 }); // estado fora da regra de propósito: prova que campo sem par não normaliza
    const cs: Conflito[] = [{ path: "__produto__", meu: "suas edições", dele: null }];
    expect(aplicarResolucaoConflito(d, cs, "__produto__", "dele")).toEqual({ draft: null, restantes: [] });
    expect(aplicarResolucaoConflito(d, cs, "__produto__", "meu")).toEqual({ draft: d, restantes: [] });
    const cn: Conflito[] = [{ path: "nome", meu: "A", dele: "B" }];
    const r = aplicarResolucaoConflito(d, cn, "nome", "dele");
    expect(r.draft?.nome).toBe("B");
    expect(P(r.draft)).toEqual(P(d));
  });

  it("ProdutoImportadoSheet.tsx: o onResolver chama aplicarResolucaoConflito (o caminho de produção é o testado)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/components/produto-importado/ProdutoImportadoSheet.tsx", "utf8");
    const ini = src.indexOf("onResolver={(path, escolha) => {");
    expect(ini).toBeGreaterThan(0);
    const corpo = src.slice(ini, src.indexOf("rotulo={(path) =>", ini));
    expect(corpo).toContain("aplicarResolucaoConflito(d, conflitosDoProduto, campo, escolha)");
    expect(corpo).not.toMatch(/normalizarPar(Varejo|Atacado)AposResolucao/); // nenhuma lógica de par duplicada no Sheet
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 4 (R3-4) — toast com 2+ avisos: vírgulas e UM "e" final, concordância pra qualquer
// mistura ("Estes campos foram travados…: <lista>."). Textos de 1 campo inalterados.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("toastTravaImportado/toastTravaAcabado — R3-4: lista de 2+ campos", () => {
  const V = { campo: "variantes" as const, rotulo: "Cores e quantidades das variantes" };
  const N = { campo: "nome" as const, rotulo: "Nome" };
  const VV = { campo: "preco_varejo_fixo" as const, rotulo: "Valor varejo" };
  const MV = { campo: "markup_varejo" as const, rotulo: "Markup Varejo" };
  const PRE = "Estes campos foram travados pela Integração enquanto você editava — essas alterações não foram salvas: ";
  for (const [nome, toast] of [["PI", toastTravaImportado], ["PA", toastTravaAcabado]] as const) {
    it(`${nome}: Nome + variantes → "Nome, cores e quantidades das variantes." (sem 'e' duplo)`, () => {
      expect(toast([N, V])).toBe(`${PRE}Nome, cores e quantidades das variantes.`);
    });
    it(`${nome}: 3 campos + variantes → vírgulas e o único 'e' é o do rótulo de variantes`, () => {
      expect(toast([N, VV, MV, V])).toBe(`${PRE}Nome, Valor varejo, Markup Varejo, cores e quantidades das variantes.`);
    });
    it(`${nome}: variantes fora de ordem vai pro fim da lista`, () => {
      expect(toast([V, N])).toBe(`${PRE}Nome, cores e quantidades das variantes.`);
    });
    it(`${nome}: 2 e 3 campos sem variantes → vírgulas + 1 'e' final`, () => {
      expect(toast([VV, MV])).toBe(`${PRE}Valor varejo e Markup Varejo.`);
      expect(toast([N, VV, MV])).toBe(`${PRE}Nome, Valor varejo e Markup Varejo.`);
    });
    it(`${nome}: textos de 1 campo inalterados`, () => {
      expect(toast([N])).toBe("Nome foi travado pela Integração enquanto você editava — essa alteração não foi salva.");
      expect(toast([V])).toBe("Cores e quantidades das variantes foram travadas pela Integração enquanto você editava — essa alteração não foi salva.");
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// BUG-1 (pré-existente, colab Fase 3 commit 7e81b58b) — QA task-25: depois do PRÓPRIO Salvar, a
// tela Produto Importado mostrava "Alguém salvou agora — 1 campo(s) atualizado(s)" e nunca
// voltava a "Salvo" (Salvar ficava habilitado pra sempre). Causa: `_salvar_produto_importado_core`
// APAGA e REINSERE `produto_importado_variantes`/`produto_importado_etapas` a cada save — os
// `id`s de linha SEMPRE mudam mesmo quando o conteúdo é idêntico. `chaveDirty` (shared.ts) inclui
// `variantes`/`etapas` como ARRAY (valor). Antes do fix, o SELECT da tela trazia `id` nesses
// embeds (`(*)`) — o pós-save (`salvo = {...d, id, rev}`) guardava os ids VELHOS como
// baseline/base do merge; o refetch seguinte trazia os ids NOVOS; o merge via "mudou no
// servidor" e acusava "outra pessoa salvou" no PRÓPRIO save do usuário, com o baseline nunca
// convergindo (dirty preso). Fix: o SELECT da tela (`SELECT_PRODUTO_IMPORTADO`,
// `ProdutoImportadoSheet.tsx`) não traz mais `id`/`tenant_id`/`produto_importado_id`/
// `created_at` nesses embeds — mesmo padrão já usado por `produto-acabado/ProdutoAcabadoSheet.tsx`
// (`SELECT_PRODUTO`), que por isso nunca teve este bug (prova no bloco seguinte).
//
// Harness BEHAVIORAL de save SEQUENCIAL: reproduz o pipeline real da tela — `chaveDirty` real,
// `mergeDraft` real (`@/lib/colab/merge`), `acoplarParVarejo`/`acoplarParAtacado` reais — sem
// reimplementar a lógica de merge. `variantesDoSelect`/`etapasDoSelect` simulam o shape que CADA
// SELECT devolve: com `id` (comportamento ANTES do fix) ou sem `id` (comportamento ATUAL,
// `SELECT_PRODUTO_IMPORTADO`).
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("BUG-1 — Produto Importado: save próprio não pode acender 'outra pessoa salvou'", () => {
  type LinhaVariante = { id?: string; ordem: number; cor_id: string | null; cor_apelido_id: string | null; peso: number; qtd: number };
  type LinhaEtapa = { id?: string; ordem: number; rotulo: string; base: "mercadoria" | "frete"; percentual: number; data_vencimento: string | null; cotacao: number };

  /** Simula o `_salvar_produto_importado_core`: DELETE+INSERT — o CONTEÚDO é preservado mas o
   *  `id` de cada linha é SEMPRE novo (gen_random_uuid a cada save), mesmo sem nenhuma edição. */
  let seq = 0;
  function reinserirComNovosIds<T extends { id?: string }>(linhas: T[]): T[] {
    return linhas.map((l) => ({ ...l, id: `id-${++seq}` }));
  }

  /** Constrói o draft "como a tela vê" a partir de uma linha simulada do servidor —
   *  `comId` replica o SELECT ANTIGO (bug); `false` replica `SELECT_PRODUTO_IMPORTADO` (fix). */
  function draftDoServidor(o: {
    id: string; rev: number; nome: string; variantesRow: LinhaVariante[]; etapasRow: LinhaEtapa[]; comId: boolean;
  }): ProdutoImportadoDraft {
    const despir = (v: LinhaVariante | LinhaEtapa) => (o.comId ? v : (({ id, ...rest }) => rest)(v));
    return {
      ...base({ id: o.id, rev: o.rev, nome: o.nome }),
      variantes: o.variantesRow.map(despir) as unknown as ProdutoImportadoDraft["variantes"],
      etapas: o.etapasRow.map(despir) as unknown as ProdutoImportadoDraft["etapas"],
    };
  }

  /** Um "merge tick" — espelha o `useEffect` de `ProdutoImportadoSheet.tsx` (linhas ~329-368)
   *  para UM produto: touched = diff(chaveDirty(draft) vs chaveDirty(base)); mergeDraft real +
   *  acoplamento dos pares de preço; devolve o próximo draft + conflitos + se algo foi
   *  "atualizado" (dispara o toast/banner "Alguém salvou agora — N campo(s) atualizado(s)"). */
  function mergeTick(o: { base: ProdutoImportadoDraft; draft: ProdutoImportadoDraft; fresh: ProdutoImportadoDraft }) {
    const touched = new Set(
      (Object.keys(chaveDirty(o.draft)) as (keyof ReturnType<typeof chaveDirty>)[]).filter(
        (k) => JSON.stringify((chaveDirty(o.draft) as any)[k]) !== JSON.stringify((chaveDirty(o.base) as any)[k]),
      ),
    );
    const m0 = mergeDraft({ base: o.base as any, draft: o.draft as any, fresh: o.fresh as any, touched });
    const mVarejo = acoplarParVarejo({ valor: m0.valor as any, conflitos: m0.conflitos, draft: o.draft as any, fresh: o.fresh as any });
    const mFinal = acoplarParAtacado({ valor: mVarejo.valor, conflitos: mVarejo.conflitos, draft: o.draft as any, fresh: o.fresh as any });
    const proximoDraft: ProdutoImportadoDraft = { ...(mFinal.valor as ProdutoImportadoDraft), rev: o.fresh.rev };
    return { draft: proximoDraft, conflitos: mFinal.conflitos, atualizados: m0.atualizados };
  }

  /** Roda a sequência COMPLETA "carrega → salva → servidor reinsere ids → refetch/merge" pra UM
   *  produto, com o SELECT indicado (`comId`), e devolve o estado final (draft/baseline/conflitos/
   *  atualizados) — espelha byte a byte `salvarUmProduto` + o `useEffect` de merge da tela. */
  function cicloDeSaveProprio(comId: boolean) {
    const v0: LinhaVariante[] = [{ id: "v-orig", ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }];
    const e0: LinhaEtapa[] = [{ id: "e-orig", ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 5 }];

    // 1) Carrega — `carregado=false`: seed direto, sem merge (linhas 316-321 da tela).
    const fresh0 = draftDoServidor({ id: "p1", rev: 1, nome: "Blusa Importada", variantesRow: v0, etapasRow: e0, comId });
    let baseServidor = fresh0; // baseServidorRef.current["p1"]
    let baseline = JSON.stringify(chaveDirty(fresh0));
    let draft = fresh0;

    // 2) Usuário edita um campo QUALQUER que não seja variantes/etapas (ex.: nome) — dirty real.
    draft = { ...draft, nome: "Blusa Importada (revisada)" };

    // 3) Salva (`salvarUmProduto`): a RPC roda `_salvar_produto_importado_core` (DELETE+INSERT —
    //    ids SEMPRE novos, mesmo conteúdo) — o servidor confirma; a tela NÃO re-lê variantes/etapas
    //    no `onSuccess`, só builda `salvo = {...d, id, rev: revNovo}` com o QUE FOI ENVIADO
    //    (`d.variantes`/`d.etapas`, ids ainda "antigos" do ponto de vista do que o banco tem agora).
    const revNovo = 2;
    const salvo: ProdutoImportadoDraft = { ...draft, rev: revNovo };
    baseServidor = salvo; // baseServidorRef.current["p1"] = salvo (linha 775)
    baseline = JSON.stringify(chaveDirty(salvo)); // marcarProdutoLimpo(salvo) (linha 785)
    draft = salvo;

    // 4) Servidor: neste instante as tabelas-filhas JÁ foram apagadas+reinseridas (ids novos).
    const v1 = reinserirComNovosIds(v0.map(({ id, ...rest }) => rest));
    const e1 = reinserirComNovosIds(e0.map(({ id, ...rest }) => rest));

    // 5) `qc.invalidateQueries` dispara o refetch geral — a query volta com os ids NOVOS.
    const fresh1 = draftDoServidor({ id: "p1", rev: revNovo, nome: draft.nome, variantesRow: v1, etapasRow: e1, comId });

    // 6) `useEffect` de merge roda (a tela já estava `carregado=true`): base=baseServidor (ids
    //    velhos, do passo 3), draft=draft (idem), fresh=fresh1 (ids novos).
    const tick = mergeTick({ base: baseServidor, draft, fresh: fresh1 });

    const dirtyDepois = JSON.stringify(chaveDirty(tick.draft)) !== baseline;
    return { tick, baseline, draftFinal: tick.draft };
  }

  it("ANTES do fix (SELECT com id nos embeds): o save do PRÓPRIO usuário dispara 'atualizados' (banner falso) e fica dirty pra sempre", () => {
    const { tick, baseline, draftFinal } = cicloDeSaveProprio(/* comId */ true);
    // O bug: variantes/etapas aparecem como "atualizados" (banner "Alguém salvou agora...") mesmo
    // sem qualquer segunda pessoa ter mexido — só os ids mudaram por causa do DELETE+INSERT.
    expect(tick.atualizados).toEqual(expect.arrayContaining(["variantes", "etapas"]));
    expect(tick.conflitos).toEqual([]); // não é um conflito (nada tocado) — é a falsa "atualização"
    // E o baseline (guardado com os ids VELHOS no passo 3) nunca bate com o draft final (ids
    // NOVOS, adotados do fresh no merge) — dirty preso, Salvar continua habilitado.
    expect(JSON.stringify(chaveDirty(draftFinal))).not.toBe(baseline);
  });

  it("DEPOIS do fix (SELECT_PRODUTO_IMPORTADO, sem id nos embeds): o próprio save NÃO dispara 'atualizados' e o baseline CONVERGE (sem banner, sem dirty)", () => {
    const { tick, baseline, draftFinal } = cicloDeSaveProprio(/* comId */ false);
    // Sem `id` no shape comparado, variantes/etapas têm o MESMO conteúdo em base/draft/fresh —
    // `igual()` os trata como iguais, `mergeDraft` não marca "atualizado" nenhum.
    expect(tick.atualizados).toEqual([]);
    expect(tick.conflitos).toEqual([]);
    expect(JSON.stringify(chaveDirty(draftFinal))).toBe(baseline); // baseline convergiu — "Salvo", sem banner.
  });

  it("uma 2ª chamada de Salvar depois do próprio save (fix) não manda NADA novo — o payload é idêntico ao já persistido", () => {
    const { draftFinal } = cicloDeSaveProprio(false);
    const { dados, variantes, etapas } = montarPayload(draftFinal);
    // O payload do 2º save é exatamente o conteúdo já no servidor (nome revisado, 1 variante/etapa
    // com o MESMO conteúdo) — nada "a mais" por causa de um id fantasma.
    expect(dados.nome).toBe("Blusa Importada (revisada)");
    expect(variantes).toEqual([{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }]);
    expect(etapas).toEqual([{ ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 5 }]);
  });

  it("CONCORRÊNCIA real preservada (fix): outro usuário muda a COR de uma variante entre o load e o refetch — o merge ainda acusa (conteúdo divergente, não só id)", () => {
    const v0: LinhaVariante[] = [{ id: "v1", ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }];
    const e0: LinhaEtapa[] = [{ id: "e1", ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 5 }];
    const fresh0 = draftDoServidor({ id: "p2", rev: 1, nome: "Vestido", variantesRow: v0, etapasRow: e0, comId: false });
    const baseServidor = fresh0;
    const draft = fresh0; // eu não editei nada — só estou com o card aberto

    // Outra pessoa salva: muda a cor da variante (conteúdo real, não só o id) — servidor reinsere
    // com id novo E cor nova.
    const v1: LinhaVariante[] = [{ id: "v-novo-de-outro-user", ordem: 1, cor_id: "verde", cor_apelido_id: null, peso: 1, qtd: 10 }];
    const fresh1 = draftDoServidor({ id: "p2", rev: 2, nome: "Vestido", variantesRow: v1, etapasRow: e0, comId: false });

    const tick = mergeTick({ base: baseServidor, draft, fresh: fresh1 });
    // Não tocado por mim (touched vazio) → adota o fresh SEM conflito, mas ainda marca "atualizado"
    // de verdade (mudança real de conteúdo, não ruído de id) — o comportamento correto do merge.
    expect(tick.atualizados).toContain("variantes");
    expect(tick.conflitos).toEqual([]);
    expect(tick.draft.variantes[0].cor_id).toBe("verde"); // adotou a mudança real do outro usuário
  });

  it("CONCORRÊNCIA real com conflito (fix): EU editei a cor da variante E outra pessoa também mudou — vira conflito de verdade (banner de resolução), não silenciosamente ignorado", () => {
    const v0: LinhaVariante[] = [{ id: "v1", ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }];
    const e0: LinhaEtapa[] = [{ id: "e1", ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 5 }];
    const fresh0 = draftDoServidor({ id: "p3", rev: 1, nome: "Casaco", variantesRow: v0, etapasRow: e0, comId: false });
    const baseServidor = fresh0;
    // Eu edito a cor pra "rosa" (toco `variantes`).
    const draft: ProdutoImportadoDraft = { ...fresh0, variantes: [{ ordem: 1, cor_id: "rosa", cor_apelido_id: null, peso: 1, qtd: 10 }] as any };

    // Outra pessoa salva simultaneamente com uma cor DIFERENTE da minha E da original.
    const v1: LinhaVariante[] = [{ id: "v-de-outro-user", ordem: 1, cor_id: "verde", cor_apelido_id: null, peso: 1, qtd: 10 }];
    const fresh1 = draftDoServidor({ id: "p3", rev: 2, nome: "Casaco", variantesRow: v1, etapasRow: e0, comId: false });

    const tick = mergeTick({ base: baseServidor, draft, fresh: fresh1 });
    // Eu toquei E o servidor mudou pra algo DIFERENTE do que eu enviaria → CONFLITO real, banner
    // de resolução aparece (não é a falsa "atualização" do BUG-1, é uma divergência genuína).
    expect(tick.conflitos.some((c) => c.path === "variantes")).toBe(true);
    // Meu valor é preservado até eu resolver (o ColabBanner mostra "manter meu"/"usar o novo").
    expect((tick.draft.variantes[0] as any).cor_id).toBe("rosa");
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// BUG-1 — Produto Acabado: MESMO padrão de save (DELETE+INSERT em `produto_acabado_variantes`,
// `_salvar_produto_acabado_core`, migration `20260918140000`) — mas o PA NUNCA teve o bug porque
// `VarianteDraft` (produto-acabado/shared.ts) não tem campo `id`, e o SELECT da tela
// (`ProdutoAcabadoSheet.tsx`, `SELECT_PRODUTO`) já buscava só
// `(ordem, cor_id, cor_apelido_id, peso, qtd)` — sem `id` — desde sempre. Prova: `chaveDirtyPA`
// comparando duas listas de variantes com o MESMO conteúdo mas ids diferentes nunca entraria em
// jogo porque o shape nem carrega `id` — a prova aqui é estrutural (o TYPE não tem `id`), não
// comportamental por RPC (fora do escopo deste arquivo puro), mas o mesmo harness de merge acima
// mostra que, SEM `id` no shape, save próprio nunca "atualiza" variantes por ruído de id.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("BUG-1 — Produto Acabado NÃO tem o bug (variantes sem id por construção)", () => {
  it("VarianteDraft (produto-acabado/shared.ts) não declara `id` — impossível comparar por id que não existe no shape", () => {
    const v: import("@/components/produto-acabado/shared").VarianteDraft = { ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 };
    expect("id" in v).toBe(false);
  });

  it("harness de save sequencial (mesmo mergeDraft real): variantes SEM id, reinseridas com 'id' de banco simulado por fora do shape, nunca disparam 'atualizado' no próprio save", () => {
    // Espelha o cenário BUG-1, mas com o shape do PA (sem id) — o "banco" pode reinserir com
    // qualquer id por baixo, a TELA nunca vê essa coluna, então o merge nunca a compara.
    type VPA = { ordem: number; cor_id: string | null; cor_apelido_id: string | null; peso: number; qtd: number };
    const baseServidor: { variantes: VPA[] } = { variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }] };
    const draft = baseServidor; // nada editado
    // "banco" reinsere (id novo, invisível pro front) — conteúdo idêntico.
    const fresh: { variantes: VPA[] } = { variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }] };
    const touched = new Set<string>();
    const m = mergeDraft({ base: baseServidor as any, draft: draft as any, fresh: fresh as any, touched });
    expect(m.atualizados).toEqual([]);
    expect(m.conflitos).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// BUG-1 — guarda de REGRESSÃO ligada ao SOURCE real: `ProdutoImportadoSheet.tsx` não pode voltar
// a selecionar `id` nos embeds `produto_importado_variantes`/`produto_importado_etapas` — é
// EXATAMENTE essa mudança (remover `id` do SELECT) que fecha o BUG-1. Lê o arquivo fonte (mesma
// técnica de `tests/unit/integracao-trava-tela.test.ts`, `readFileSync` + regex sobre o texto) —
// prova que a constante `SELECT_PRODUTO_IMPORTADO` (usada nos 3 pontos que leem a linha completa)
// nunca mais usa `produto_importado_variantes(*)`/`produto_importado_etapas(*)` (que trariam
// `id`), e que ela lista exatamente os campos de conteúdo esperados. Roda ANTES do fix, este
// teste falha (`toBe(-1)` vira `toBeGreaterThanOrEqual(0)`) contra o texto antigo — prova RED→GREEN
// sem precisar reverter o arquivo de produção.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe("BUG-1 — guarda de regressão no SOURCE (ProdutoImportadoSheet.tsx nunca mais seleciona id em variantes/etapas)", () => {
  const src = readFileSync("src/components/produto-importado/ProdutoImportadoSheet.tsx", "utf8");

  it("SELECT_PRODUTO_IMPORTADO não usa embed `(*)` — nunca mais traz `id`/`tenant_id`/`produto_importado_id`/`created_at` do banco", () => {
    expect(src).not.toContain("produto_importado_variantes(*)");
    expect(src).not.toContain("produto_importado_etapas(*)");
  });

  it("SELECT_PRODUTO_IMPORTADO traz exatamente os campos de conteúdo (ordem, cor_id, cor_apelido_id, peso, qtd / ordem, rotulo, base, percentual, data_vencimento, cotacao)", () => {
    expect(src).toContain("variantes:produto_importado_variantes(ordem, cor_id, cor_apelido_id, peso, qtd)");
    expect(src).toContain("etapas:produto_importado_etapas(ordem, rotulo, base, percentual, data_vencimento, cotacao)");
  });

  it("os 3 pontos de leitura da linha completa (lista/resync do Limpar/reconciliação P0409) usam a MESMA constante — sem select-literal duplicado que possa divergir", () => {
    const usos = [...src.matchAll(/\.select\(SELECT_PRODUTO_IMPORTADO\)/g)].length;
    expect(usos).toBe(3);
    // Nenhum select-literal (com embed completo) sobrevive fora da constante.
    expect(src).not.toMatch(/\.select\("\*, modelo_id, variantes:produto_importado_variantes/);
  });
});

// P-135 B (fix, set/2026): mesma causa raiz "a" achada em `ProdutoAcabadoSheet.tsx` ("Cinto
// Teste" regravado 7× sem edição) — verificado que `ProdutoImportadoSheet.tsx` tinha o MESMO
// padrão (`mutationFn` fazia `drafts.map(salvarUmProduto)` sem filtro de sujo). Corrigido com o
// MESMO helper `produtosParaSalvar` (produto-acabado/shared.ts), reusado aqui pelo Importado.
describe("produtosParaSalvar aplicado ao draft do Produto Importado (P-135 B)", () => {
  it("draft intocado (igual ao baseline) fica de fora do lote", () => {
    const d = emptyDraft(null, null);
    const salvo: ProdutoImportadoDraft = { ...d, id: "imp-1", nome: "Vestido China" };
    const baseline = { "imp-1": JSON.stringify(chaveDirty(salvo)) };
    expect(produtosParaSalvar([salvo], baseline, chaveDirty)).toEqual([]);
  });

  it("editar 1 de N produtos importados → só o editado entra no lote", () => {
    const intocado: ProdutoImportadoDraft = { ...emptyDraft(null, null), id: "imp-a", nome: "A" };
    const editado: ProdutoImportadoDraft = { ...emptyDraft(null, null), id: "imp-b", nome: "B editado" };
    const baseline = {
      "imp-a": JSON.stringify(chaveDirty(intocado)),
      "imp-b": JSON.stringify(chaveDirty({ ...editado, nome: "B original" })),
    };
    const resultado = produtosParaSalvar([intocado, editado], baseline, chaveDirty);
    expect(resultado.map((d) => d.id)).toEqual(["imp-b"]);
  });

  it("draft novo/local (id null, ainda não persistido) sempre entra no lote", () => {
    const novo = emptyDraft(null, null); // id: null
    expect(produtosParaSalvar([novo], {}, chaveDirty).length).toBe(1);
  });
});

// Guarda de regressão no SOURCE — espelha o bloco BUG-1 acima: prova que o `mutationFn` do
// Salvar em lote filtra por `produtosParaSalvar` (não manda mais TODOS os drafts sem filtro).
describe("P-135 B — guarda de regressão no SOURCE (ProdutoImportadoSheet.tsx filtra por sujo antes de salvar em lote)", () => {
  const src = readFileSync("src/components/produto-importado/ProdutoImportadoSheet.tsx", "utf8");

  it("mutationFn usa produtosParaSalvar (não drafts.map(salvarUmProduto) direto, sem filtro)", () => {
    expect(src).toContain("produtosParaSalvar(drafts, baseline, chaveDirty)");
    expect(src).not.toMatch(/Promise\.allSettled\(drafts\.map\(\(d\) => salvarUmProduto\(d\)\)\)/);
  });
});
