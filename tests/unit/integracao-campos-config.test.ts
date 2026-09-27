// @vitest-environment happy-dom
// Integração — aba "Campos da API" (Task 14, super admin). Helpers puros (seleção/alerta/rótulo) + render de
// verdade de `CamposAba` (checklist não-negociável: "regex-on-source test does NOT count" para componente com
// hooks/estado — mesmo padrão de tests/unit/integracao-celula.test.ts e integracao-tela-fonte.test.ts). O
// `@vitest-environment happy-dom` troca o ambiente SÓ deste arquivo (é um superset de "node" p/ os testes de
// helper puro acima, que não tocam DOM).
//
// Adaptações do controlador sobre o brief (ver task-14-report.md):
// - `descricao`/`metatag` são gate "planejamento" na campos.ts REAL (não testado aqui — é o teste anti-drift de
//   integracao-campos.test.ts que cobre o CASE do SQL; esta suíte só cobre os helpers/UI da Task 14).
// - `useIntegracaoConfig` devolve `{ campos, layout, rev, api }` (não só `{ campos, rev }` como o esqueleto do
//   brief sugeria) — os testes de render mockam esse shape completo.
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { useQuery } from "@tanstack/react-query";
import { alternarCampo, mesmaSelecao, precisaAlertaLayout, rotuloNaLista } from "@/lib/integracao/campos";

// n6 (mesma razão de integracao-celula.test.ts): silencia o aviso de act() do React 19 dev.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Campos da API — seleção (P-60 B, P-83 A)", () => {
  it("marcar/desmarcar mantém a ordem fixa do layout", () => {
    expect(alternarCampo(["peso", "nome"], "ncm", true)).toEqual(["nome", "peso", "ncm"]);
    expect(alternarCampo(["nome", "peso"], "nome", false)).toEqual(["peso"]);
    expect(alternarCampo(["nome"], "nome", true)).toEqual(["nome"]);
  });
  it("alerta só ao DESMARCAR campo do layout (1-17); Foto é opcional e não alerta", () => {
    expect(precisaAlertaLayout("nome", false)).toBe(true);
    expect(precisaAlertaLayout("nome", true)).toBe(false);
    expect(precisaAlertaLayout("foto", false)).toBe(false);
  });
  it("rótulo na lista: 'Foto do Modelo' (a coluna da API continua 'Foto')", () => {
    expect(rotuloNaLista("foto")).toBe("Foto do Modelo");
    expect(rotuloNaLista("titulo")).toBe("Título para a página");
  });
  it("mesmaSelecao ignora a ordem", () => {
    expect(mesmaSelecao(["nome", "peso"], ["peso", "nome"])).toBe(true);
    expect(mesmaSelecao(["nome"], ["nome", "peso"])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Render de verdade — react-dom/client + happy-dom (mesmo padrão de integracao-celula.test.ts). Mocka
// useActiveTenantId, sonner, o client do Supabase (rpc) e o módulo useIntegracao (useIntegracaoConfig/
// chaveConfig/invalidarIntegracao) — CamposAba real, guard.ts real (useAbaSuja é seguro sem Provider: o
// GuardaIntegracaoContext default é null e o hook faz ctx?.informarSujo).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("CamposAba — render", () => {
  async function montar(opts: {
    campos?: string[];
    rev?: number;
    rpcImpl?: (nome: string, args: unknown) => Promise<{ data: unknown; error: unknown }>;
  } = {}) {
    vi.resetModules();
    const campos = opts.campos ?? [
      "nome", "ref_sku", "preco_anterior", "preco_venda", "peso", "ncm", "preco_custo", "cor_base", "cor_apelido",
      "tamanho", "titulo", "descricao", "keywords", "metatag", "comprimento", "largura", "altura",
    ];
    const rev = opts.rev ?? 3;
    const rpcSpy = vi.fn(
      opts.rpcImpl ?? (async () => ({ data: { campos, layout: campos, rev, api: null }, error: null })),
    );
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcSpy } }));
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
    const toastMocks = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
    vi.doMock("sonner", () => ({ toast: toastMocks }));
    vi.doMock("@tanstack/react-router", () => ({ useRouter: () => ({ history: { back: () => {} } }) }));
    const invalidarIntegracaoSpy = vi.fn();
    vi.doMock("@/components/integracao/useIntegracao", () => ({
      chaveConfig: (tenantId: string) => ["integracao-config", tenantId],
      invalidarIntegracao: invalidarIntegracaoSpy,
      useIntegracaoConfig: () => {
        return useQuery({
          queryKey: ["integracao-config", "t1"],
          queryFn: async () => {
            const { data, error } = await rpcSpy("integracao_config_ler", {});
            if (error) throw error;
            return data;
          },
        });
      },
    }));
    const { createElement } = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { SidebarProvider } = await import("@/components/ui/sidebar");
    const { CamposAba } = await import("@/components/integracao/CamposAba");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const arvore = () =>
      createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(CamposAba)));
    await act(async () => { root.render(arvore()); });
    // Espera a query terminar (rpcSpy resolvido) antes de devolver o controle ao teste.
    for (let i = 0; i < 20 && rpcSpy.mock.calls.length === 0; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    }
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return {
      container, rpcSpy, toastMocks, invalidarIntegracaoSpy, qc,
      rerender: () => act(async () => { root.render(arvore()); }),
      esperar: () => act(async () => { await new Promise((r) => setTimeout(r, 10)); }),
      desmontar: () => act(async () => { root.unmount(); container.remove(); }),
    };
  }

  it("carrega os 17 campos do layout marcados e 'Foto do Modelo' desmarcada (P-79/P-83 A)", async () => {
    const view = await montar();
    const checks = view.container.querySelectorAll('button[role="checkbox"]');
    // 18 campos no total (17 layout + foto).
    expect(checks.length).toBe(18);
    const fotoRow = Array.from(view.container.querySelectorAll("li")).find((li) => li.textContent?.includes("Foto do Modelo"));
    expect(fotoRow).toBeDefined();
    expect(fotoRow!.querySelector('button[role="checkbox"]')?.getAttribute("data-state")).toBe("unchecked");
    const nomeRow = Array.from(view.container.querySelectorAll("li")).find((li) => li.textContent?.startsWith("1Nome"));
    expect(nomeRow!.querySelector('button[role="checkbox"]')?.getAttribute("data-state")).toBe("checked");
    await view.desmontar();
  });

  it("desmarcar um campo do LAYOUT abre o alerta 'Tem certeza?' (P-79); confirmar mantém rascunho e marca sujo", async () => {
    const view = await montar();
    const nomeCheckbox = Array.from(view.container.querySelectorAll("li"))
      .find((li) => li.textContent?.startsWith("1Nome"))!
      .querySelector('button[role="checkbox"]') as HTMLButtonElement;
    await act(async () => { nomeCheckbox.click(); });
    // O AlertDialog "Tem certeza?" tem que estar no documento (Radix porta pro body).
    expect(document.body.textContent).toMatch(/Tem certeza\?/);
    expect(document.body.textContent).toMatch(/pode deixar de funcionar/);
    // Ainda não desmarcou de verdade — só o alerta está aberto.
    expect(nomeCheckbox.getAttribute("data-state")).toBe("checked");
    const botaoDesmarcar = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Desmarcar mesmo assim")!;
    await act(async () => { botaoDesmarcar.click(); });
    expect(nomeCheckbox.getAttribute("data-state")).toBe("unchecked");
    await view.desmontar();
  });

  it("desmarcar 'Foto do Modelo' (opcional) NÃO abre alerta — desmarca direto", async () => {
    const view = await montar({ campos: [
      "nome", "ref_sku", "preco_anterior", "preco_venda", "peso", "ncm", "preco_custo", "cor_base", "cor_apelido",
      "tamanho", "titulo", "descricao", "keywords", "metatag", "comprimento", "largura", "altura", "foto",
    ] });
    const fotoCheckbox = Array.from(view.container.querySelectorAll("li"))
      .find((li) => li.textContent?.includes("Foto do Modelo"))!
      .querySelector('button[role="checkbox"]') as HTMLButtonElement;
    expect(fotoCheckbox.getAttribute("data-state")).toBe("checked");
    await act(async () => { fotoCheckbox.click(); });
    expect(document.body.textContent).not.toMatch(/Tem certeza\?/);
    expect(fotoCheckbox.getAttribute("data-state")).toBe("unchecked");
    await view.desmontar();
  });

  it("Salvar pede confirmação ('Confirmar mudança de campos') antes de gravar", async () => {
    const view = await montar();
    const fotoCheckbox = Array.from(view.container.querySelectorAll("li"))
      .find((li) => li.textContent?.includes("Foto do Modelo"))!
      .querySelector('button[role="checkbox"]') as HTMLButtonElement;
    await act(async () => { fotoCheckbox.click(); }); // marca Foto (opcional, sem alerta) — fica "sujo"
    const botaoSalvar = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Salvar")!;
    expect((botaoSalvar as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { (botaoSalvar as HTMLButtonElement).click(); });
    expect(document.body.textContent).toMatch(/Confirmar mudança de campos/);
    // Ainda não chamou o RPC de salvar — só abriu a confirmação.
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_salvar_config")).toBe(false);
    await view.desmontar();
  });

  it("RPC de salvar recebe _campos NA ORDEM FIXA do layout e _rev do config carregado", async () => {
    const view = await montar({ rev: 7 });
    const fotoCheckbox = Array.from(view.container.querySelectorAll("li"))
      .find((li) => li.textContent?.includes("Foto do Modelo"))!
      .querySelector('button[role="checkbox"]') as HTMLButtonElement;
    await act(async () => { fotoCheckbox.click(); }); // marca Foto por ÚLTIMO — a ordem final deve ser a do layout
    const botaoSalvar = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Salvar")!;
    await act(async () => { (botaoSalvar as HTMLButtonElement).click(); });
    const botaoConfirmar = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Confirmar e salvar")!;
    await act(async () => { botaoConfirmar.click(); });
    await view.esperar();
    const chamada = view.rpcSpy.mock.calls.find((c) => c[0] === "integracao_salvar_config");
    expect(chamada).toBeDefined();
    const args = chamada![1] as { _campos: string[]; _rev: number };
    expect(args._campos).toEqual([
      "nome", "ref_sku", "preco_anterior", "preco_venda", "peso", "ncm", "preco_custo", "cor_base", "cor_apelido",
      "tamanho", "titulo", "descricao", "keywords", "metatag", "comprimento", "largura", "altura", "foto",
    ]);
    expect(args._rev).toBe(7);
    await view.desmontar();
  });

  it("P0409 conflito_versao: mostra erro, relê a config e NÃO fica em loop (confirmação fecha, sem 2º save automático)", async () => {
    let chamadasSalvar = 0;
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          return {
            data: {
              campos: [
                "nome", "ref_sku", "preco_anterior", "preco_venda", "peso", "ncm", "preco_custo", "cor_base",
                "cor_apelido", "tamanho", "titulo", "descricao", "keywords", "metatag", "comprimento", "largura", "altura",
              ],
              layout: [], rev: chamadasSalvar > 0 ? 2 : 1, api: null,
            },
            error: null,
          };
        }
        if (nome === "integracao_salvar_config") {
          chamadasSalvar++;
          return { data: null, error: Object.assign(new Error("conflito_versao: a configuracao foi salva por outra pessoa"), { code: "P0409" }) };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    const fotoCheckbox = Array.from(view.container.querySelectorAll("li"))
      .find((li) => li.textContent?.includes("Foto do Modelo"))!
      .querySelector('button[role="checkbox"]') as HTMLButtonElement;
    await act(async () => { fotoCheckbox.click(); });
    const botaoSalvar = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Salvar")!;
    await act(async () => { (botaoSalvar as HTMLButtonElement).click(); });
    const botaoConfirmar = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Confirmar e salvar")!;
    await act(async () => { botaoConfirmar.click(); });
    await view.esperar();
    await view.esperar();
    // Exatamente 1 tentativa de salvar — nunca um retry automático em loop.
    expect(chamadasSalvar).toBe(1);
    expect(view.toastMocks.error).toHaveBeenCalled();
    // A confirmação fecha (não fica esperando um 2º clique sobre o mesmo payload rejeitado).
    expect(document.body.textContent).not.toMatch(/Confirmar mudança de campos/);
    await view.desmontar();
  });
});
