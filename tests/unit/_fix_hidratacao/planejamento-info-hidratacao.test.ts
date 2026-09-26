// @vitest-environment happy-dom
// Teste de REGRESSÃO (P-57 A, fix hidratação) — baseado na investigação 26/set (Achado 1 da QA
// pós "Dev oculto", .superpowers/investigacao-corrida-salvar-2026-09-26.md §2/§4.2).
// Monta o COMPONENTE REAL `PlanejamentoDetail` (src/components/planejamento/PlanejamentoDetail.tsx)
// com o QueryClient de produção e um Supabase falso, e prova: (A) antes do seed de
// ["modelo", modeloId] a seção 1 NÃO existe (placeholder "Carregando o card…") e o Salvar fica
// desabilitado — nada para digitar em cima do emptyDraft(); depois do seed, digitar+Salvar grava
// o que foi digitado (não o valor do servidor).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1", email: "qa@teste" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: () => true, canEdit: () => true, loading: false, signOut: async () => {},
  };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useTenantModules", () => {
  const modules = { cadastro: true, criacao: true, entrada_saida: true, producao: true, financeiro: true, dashboard: true, otb: false, produto_acabado: false, produto_importado: false, etapas_pl: false };
  return { useTenantModules: () => ({ modules, isModuleEnabled: (k: string) => !!(modules as any)[k], isStockOnly: false, firstActiveModulePath: "/", isLoading: false }) };
});
vi.mock("@tanstack/react-router", async (orig) => {
  const m: any = await orig();
  const { createElement } = await import("react");
  return {
    ...m,
    createFileRoute: () => (opts: any) => ({ options: opts }),
    Link: (p: any) => createElement("a", { href: String(p.to ?? "") }, p.children),
    Navigate: () => null,
    useNavigate: () => () => {},
    useBlocker: () => ({ status: "idle", proceed() {}, reset() {} }),
  };
});
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, toastMock), Toaster: () => null }));

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, digitar, clicar } from "./dom-helpers";
import { PlanejamentoDetail } from "@/components/planejamento/PlanejamentoDetail";
import { SidebarProvider } from "@/components/ui/sidebar";

const linhaModelo = () => ({
  id: "m1", tenant_id: "t1", nome: "BLUSA TESTE", ref: "", origem: "interno", status_planejamento: "planejado", versao: 1,
  titulo_pagina: null, ncm: "0000.00.00", peso_kg: null, rev: 5, ordem_criacao_enviada: false, enviado_cad: false, lancado: false,
  tamanho_tipo: "letra", tecidos_planejados: [], fotos_modelo: [], fotos_referencia: [],
});

const campo = (path: string) => document.querySelector<HTMLInputElement>(`[data-colab-path="${path}"]`);
const updatesModelo = () => FAKE.chamadas.filter((c) => c.tabela === "modelos" && c.op === "update");
const getsModelo = () => FAKE.chamadas.filter((c) => c.tabela === "modelos" && c.op === "select" && c.filtros.some((f) => f.col === "id" && f.val === "m1")).length;
const botaoSalvar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Salvar"]');

let desmontar: (() => Promise<void>) | null = null;
async function abrirSheet() {
  const qc = new QueryClient(); // MESMO default do app
  const m = await montar(createElement(QueryClientProvider, { client: qc },
    createElement(SidebarProvider, null,
      createElement(PlanejamentoDetail, { modeloId: "m1", onClose: () => {}, onSaved: () => {} }))));
  desmontar = m.desmontar;
}

beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenants = [{ id: "t1", nome: "Loja Teste" }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1", status_kanban: ["Em Modelagem", "Aprovado"] }];
  FAKE.linhas.modelos = [linhaModelo()];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("[fix hidratação] Sheet do Planejamento — seção 1: a edição sobrevive (P-57 A)", () => {
  it("A' antes do seed a seção 1 não existe e o Salvar fica desabilitado; depois do seed, digitar+Salvar grava", async () => {
    const soltar = FAKE.segurar("modelos"); // a linha do modelo ainda não chegou
    await abrirSheet();
    await esperar(50);
    expect(campo("titulo_pagina")).toBeNull(); // "Carregando o card…" — nada para digitar em cima
    expect(botaoSalvar()?.disabled).toBe(true); // Salvar travado antes do seed
    soltar(); // chega a linha do modelo
    await aguardar(() => campo("ncm")?.value === "0000.00.00", "seed");
    expect(botaoSalvar()?.disabled).toBe(false); // destrava após o seed
    await digitar(campo("titulo_pagina")!, "Título QA (restaurar)");
    await digitar(campo("ncm")!, "6204.43.00");
    await clicar(botaoSalvar()!);
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Modelo salvo"), "toast Modelo salvo");
    const p = updatesModelo().at(-1)!.payload as any;
    expect(p.titulo_pagina).toBe("Título QA (restaurar)"); // NÃO grava null (automático)
    expect(p.ncm).toBe("6204.43.00"); // NÃO grava o valor do servidor por cima
  });

  it("B (controle, sem regressão): DEPOIS do seed, eco do Realtime (outra pessoa mudou o NOME) NÃO apaga Título/NCM digitados — merge 3-vias", async () => {
    await abrirSheet();
    await aguardar(() => campo("ncm")?.value === "0000.00.00", "seed");
    await digitar(campo("titulo_pagina")!, "Título QA (restaurar)");
    await digitar(campo("ncm")!, "6204.43.00");

    Object.assign(FAKE.linhas.modelos[0], { nome: "BLUSA OUTRA PESSOA", rev: 6 }); // save alheio (rev sobe)
    const antes = getsModelo();
    FAKE.emitirRealtime("modelos");
    await aguardar(() => getsModelo() > antes, "refetch do modelo", 2000);
    await aguardar(() => campo("nome")?.value === "BLUSA OUTRA PESSOA", "merge adotar o campo NÃO tocado", 2000);
    expect(campo("titulo_pagina")!.value).toBe("Título QA (restaurar)"); // tocado → preservado
    expect(campo("ncm")!.value).toBe("6204.43.00");

    await clicar(botaoSalvar()!);
    await aguardar(() => toastMock.success.mock.calls.some((c) => c[0] === "Modelo salvo"), "toast Modelo salvo");
    const p = updatesModelo().at(-1)!.payload as any;
    expect(p.titulo_pagina).toBe("Título QA (restaurar)");
    expect(p.ncm).toBe("6204.43.00");
  });

  // Achado M1 da revisão: "Carregando o card…" ficava preso pra sempre se `["modelo", modeloId]`
  // desse ERRO (o efeito de seed só roda com `modeloData` truthy/null — nunca com `undefined` de
  // erro). Prova: com a leitura de `modelos` falhando, aparece "Não foi possível carregar o card."
  // + "Tentar de novo", nunca fica preso em "Carregando…".
  it("M1: modelos falha ao carregar — mostra 'Não foi possível carregar o card' + 'Tentar de novo' (não fica preso em 'Carregando…')", async () => {
    FAKE.falhar("modelos", 4);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const m = await montar(createElement(QueryClientProvider, { client: qc },
      createElement(SidebarProvider, null,
        createElement(PlanejamentoDetail, { modeloId: "m1", onClose: () => {}, onSaved: () => {} }))));
    desmontar = m.desmontar;
    await esperar(80);
    expect(document.body.textContent).not.toContain("Carregando o card…");
    expect(document.body.textContent).toContain("Não foi possível carregar o card");
    expect(document.body.textContent).toContain("Tentar de novo");
    expect(botaoSalvar()?.disabled).toBe(true);
    // "Voltar" continua funcionando (fica na barra de rodapé, fora do placeholder).
    expect(document.querySelector('button[aria-label="Voltar"]')).not.toBeNull();
  });

  // M1 (2º ramo): `modeloData` volta `null` (card excluído por outra pessoa, ou sem acesso) — o
  // efeito de seed sai em `!modeloData` e `semeado` nunca vira true. Antes: preso em "Carregando…".
  it("M1: modelos volta vazio (card excluído/sem acesso) — mostra 'Card não encontrado.'", async () => {
    FAKE.linhas.modelos = []; // maybeSingle() sem linha → null
    await abrirSheet();
    await esperar(80);
    expect(document.body.textContent).not.toContain("Carregando o card…");
    expect(document.body.textContent).toContain("Card não encontrado.");
    expect(botaoSalvar()?.disabled).toBe(true);
    expect(document.querySelector('button[aria-label="Voltar"]')).not.toBeNull();
  });

  // Achado M7 da revisão: `MotivoCancelamento` vive no HEADER, fora do placeholder "Carregando o
  // card…" (que só cobre o fieldset principal) — antes do seed, dava para digitar um motivo em
  // cima do `emptyDraft()`, que o seed depois substituía (perda de digitação visível).
  // NOTA HONESTA (TDD): `isReprovado` (que decide se este bloco aparece) e `semeado` (o seed)
  // derivam da MESMA chegada de `modeloData` — neste harness síncrono (`act()`), não há como
  // forçar um frame onde um já mudou e o outro não (o efeito que seta `semeado` roda ANTES do
  // commit visível ao teste). Por isso este teste passa mesmo contra 67e665d7 (não é uma prova
  // de regressão fail→pass) — é um teste de REGRESSÃO PREVENTIVA: com `&& semeado` no código,
  // ele documenta e trava o comportamento correto (o achado em si — file:line na revisão — é
  // sobre uma janela de 1 render entre "dado chegou" e "efeito rodou" que o React pode abrir em
  // produção sob concorrência, mas que este harness não reproduz).
  it("M7: MotivoCancelamento (card Reprovado) só aparece DEPOIS do seed", async () => {
    FAKE.linhas.tenant_config = [{ tenant_id: "t1", status_kanban: ["Em Modelagem", "Reprovado", "Aprovado"] }];
    FAKE.linhas.modelos = [{ ...linhaModelo(), ordem_criacao_enviada: true, status_desenvolvimento: "reprovado" }];
    const soltar = FAKE.segurar("modelos");
    await abrirSheet();
    await esperar(80);
    expect(document.body.textContent).not.toContain("Motivo do Cancelamento");
    soltar();
    await aguardar(() => document.body.textContent?.includes("Motivo do Cancelamento") ?? false, "MotivoCancelamento aparece após o seed", 2000);
  });
});
