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
//
// Fix round 1 (task-14-review.md, revisão T14 #1-#8): reescrita da suíte de render para cobrir:
// - I2: rev CONGELADO no 1º toggle — um refetch em foco no meio da edição não muda o rev que o save manda.
// - I1: P0409 mantém a seleção do usuário (rebaseada sobre a versão fresca do servidor) — nunca reseta pra null;
//   o próximo save manda o REV FRESCO. Outros erros (rede/P0001/42501) preservam a seleção sem rebase nenhum.
// - m4(a): a guarda `useAbaSuja` é exercitada de verdade (Provider + spy em `informarSujo`).
// - m4(b): "marca sujo" também prova que o botão Salvar habilita (não só o estado do checkbox).
// - m4(c): teste de `onSuccess` (toast, refetch, invalidação, reset do rascunho).
// - m4(d): "Manter marcado" (cancelar o alerta do layout mantém o campo marcado).
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

const CAMPOS_17 = [
  "nome", "ref_sku", "preco_anterior", "preco_venda", "peso", "ncm", "preco_custo", "cor_base", "cor_apelido",
  "tamanho", "titulo", "descricao", "keywords", "metatag", "comprimento", "largura", "altura",
];
const CAMPOS_18 = [...CAMPOS_17, "foto"];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Render de verdade — react-dom/client + happy-dom (mesmo padrão de integracao-celula.test.ts). Mocka
// useActiveTenantId, sonner, o client do Supabase (rpc) e o módulo useIntegracao (useIntegracaoConfig/
// chaveConfig/invalidarIntegracao) — CamposAba real, guard.ts real (envolvido no Provider quando o teste precisa
// espiar `informarSujo`, m4(a)).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("CamposAba — render", () => {
  async function montar(opts: {
    campos?: string[];
    rev?: number;
    rpcImpl?: (nome: string, args: unknown) => Promise<{ data: unknown; error: unknown }>;
    comGuarda?: boolean;
  } = {}) {
    vi.resetModules();
    const campos = opts.campos ?? CAMPOS_17;
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
    // m4(a): monta com a GuardaIntegracaoContext real quando o teste quer espiar `informarSujo` (a guarda única
    // da página) — `guard.ts` é o módulo REAL, só o valor do Provider é espionado aqui.
    const { GuardaIntegracaoContext } = await import("@/components/integracao/guard");
    const informarSujoSpy = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const conteudo = createElement(SidebarProvider, null, createElement(CamposAba));
    const arvore = () =>
      createElement(
        QueryClientProvider,
        { client: qc },
        opts.comGuarda
          ? createElement(GuardaIntegracaoContext.Provider, { value: { informarSujo: informarSujoSpy } }, conteudo)
          : conteudo,
      );
    await act(async () => { root.render(arvore()); });
    // Espera a query terminar (rpcSpy resolvido) antes de devolver o controle ao teste.
    for (let i = 0; i < 20 && rpcSpy.mock.calls.length === 0; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    }
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return {
      container, rpcSpy, toastMocks, invalidarIntegracaoSpy, informarSujoSpy, qc,
      rerender: () => act(async () => { root.render(arvore()); }),
      esperar: () => act(async () => { await new Promise((r) => setTimeout(r, 10)); }),
      desmontar: () => act(async () => { root.unmount(); container.remove(); }),
    };
  }

  const acharLinha = (container: HTMLElement, texto: string) =>
    Array.from(container.querySelectorAll("li")).find((li) => li.textContent?.includes(texto))!;
  const checkboxDe = (container: HTMLElement, texto: string) =>
    acharLinha(container, texto).querySelector('button[role="checkbox"]') as HTMLButtonElement;
  const botaoSalvar = () =>
    Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Salvar") as HTMLButtonElement;
  const botaoDoc = (texto: string) =>
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent === texto) as HTMLButtonElement;

  it("carrega os 17 campos do layout marcados e 'Foto do Modelo' desmarcada (P-79/P-83 A)", async () => {
    const view = await montar();
    const checks = view.container.querySelectorAll('button[role="checkbox"]');
    // 18 campos no total (17 layout + foto).
    expect(checks.length).toBe(18);
    expect(checkboxDe(view.container, "Foto do Modelo").getAttribute("data-state")).toBe("unchecked");
    const nomeRow = Array.from(view.container.querySelectorAll("li")).find((li) => li.textContent?.startsWith("1Nome"));
    expect(nomeRow!.querySelector('button[role="checkbox"]')?.getAttribute("data-state")).toBe("checked");
    await view.desmontar();
  });

  it("desmarcar um campo do LAYOUT abre o alerta 'Tem certeza?' (P-79); confirmar desmarca de fato e marca sujo + habilita Salvar (m4b)", async () => {
    const view = await montar({ comGuarda: true });
    const nomeCheckbox = Array.from(view.container.querySelectorAll("li"))
      .find((li) => li.textContent?.startsWith("1Nome"))!
      .querySelector('button[role="checkbox"]') as HTMLButtonElement;
    await act(async () => { nomeCheckbox.click(); });
    // O AlertDialog "Tem certeza?" tem que estar no documento (Radix porta pro body).
    expect(document.body.textContent).toMatch(/Tem certeza\?/);
    expect(document.body.textContent).toMatch(/pode deixar de funcionar/);
    // Ainda não desmarcou de verdade — só o alerta está aberto; Salvar continua desabilitado (nada sujo ainda).
    expect(nomeCheckbox.getAttribute("data-state")).toBe("checked");
    expect(botaoSalvar().disabled).toBe(true);
    const confirmado = botaoDoc("Desmarcar mesmo assim");
    await act(async () => { confirmado.click(); });
    expect(nomeCheckbox.getAttribute("data-state")).toBe("unchecked");
    // m4(b): Salvar habilita de verdade (não só o checkbox mudou).
    expect(botaoSalvar().disabled).toBe(false);
    // m4(a): a guarda única da página foi avisada.
    expect(view.informarSujoSpy).toHaveBeenCalledWith("campos", true);
    await view.desmontar();
  });

  it("m4(d): 'Manter marcado' cancela o alerta e o campo continua marcado, sem sujar nada", async () => {
    const view = await montar({ comGuarda: true });
    const nomeCheckbox = checkboxDe(view.container, "1Nome") ?? Array.from(view.container.querySelectorAll("li"))
      .find((li) => li.textContent?.startsWith("1Nome"))!.querySelector('button[role="checkbox"]') as HTMLButtonElement;
    await act(async () => { nomeCheckbox.click(); });
    expect(document.body.textContent).toMatch(/Tem certeza\?/);
    const manter = botaoDoc("Manter marcado");
    await act(async () => { manter.click(); });
    expect(document.body.textContent).not.toMatch(/Tem certeza\?/);
    expect(nomeCheckbox.getAttribute("data-state")).toBe("checked");
    expect(botaoSalvar().disabled).toBe(true);
    // "Manter marcado" é só o Cancel do Radix — não abre um rascunho novo, nada fica sujo.
    expect(view.informarSujoSpy).not.toHaveBeenCalledWith("campos", true);
    await view.desmontar();
  });

  it("desmarcar 'Foto do Modelo' (opcional) NÃO abre alerta — desmarca direto", async () => {
    const view = await montar({ campos: CAMPOS_18 });
    const fotoCheckbox = checkboxDe(view.container, "Foto do Modelo");
    expect(fotoCheckbox.getAttribute("data-state")).toBe("checked");
    await act(async () => { fotoCheckbox.click(); });
    expect(document.body.textContent).not.toMatch(/Tem certeza\?/);
    expect(fotoCheckbox.getAttribute("data-state")).toBe("unchecked");
    await view.desmontar();
  });

  it("Salvar pede confirmação ('Confirmar mudança de campos') antes de gravar", async () => {
    const view = await montar();
    const fotoCheckbox = checkboxDe(view.container, "Foto do Modelo");
    await act(async () => { fotoCheckbox.click(); }); // marca Foto (opcional, sem alerta) — fica "sujo"
    expect(botaoSalvar().disabled).toBe(false);
    await act(async () => { botaoSalvar().click(); });
    expect(document.body.textContent).toMatch(/Confirmar mudança de campos/);
    // Ainda não chamou o RPC de salvar — só abriu a confirmação.
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_salvar_config")).toBe(false);
    await view.desmontar();
  });

  it("RPC de salvar recebe _campos NA ORDEM FIXA do layout e _rev CONGELADO no 1º toggle", async () => {
    const view = await montar({ rev: 7 });
    const fotoCheckbox = checkboxDe(view.container, "Foto do Modelo");
    await act(async () => { fotoCheckbox.click(); }); // marca Foto por ÚLTIMO — a ordem final deve ser a do layout
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    const chamada = view.rpcSpy.mock.calls.find((c) => c[0] === "integracao_salvar_config");
    expect(chamada).toBeDefined();
    const args = chamada![1] as { _campos: string[]; _rev: number };
    expect(args._campos).toEqual(CAMPOS_18);
    expect(args._rev).toBe(7);
    await view.desmontar();
  });

  it("I2: um refetch em foco DEPOIS do 1º toggle não muda o rev que o Save manda (rev CONGELADO, não o rev ao vivo)", async () => {
    let revAoVivo = 3;
    const view = await montar({
      rev: 3,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: CAMPOS_17, layout: [], rev: revAoVivo, api: null }, error: null };
        if (nome === "integracao_salvar_config") return { data: { campos: CAMPOS_18, layout: [], rev: revAoVivo + 1, api: null }, error: null };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    // 1º toggle: congela rev=3 (o rev do servidor NO MOMENTO do 1º toggle).
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    // Um refetch em background (ex.: foco de janela) traz um rev NOVO (outra pessoa salvou config da API — T15
    // compartilha o mesmo rev) — isso NÃO pode mudar o rev que o save vai mandar.
    revAoVivo = 4;
    await act(async () => { await view.qc.refetchQueries({ queryKey: ["integracao-config", "t1"] }); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    const chamada = view.rpcSpy.mock.calls.find((c) => c[0] === "integracao_salvar_config");
    expect((chamada![1] as { _rev: number })._rev).toBe(3); // o rev CONGELADO no 1º toggle, não o 4 do refetch.
    await view.desmontar();
  });

  it("onSuccess (m4c): toast de sucesso, refetch da config antes de limpar o rascunho, e invalidarIntegracao chamado", async () => {
    const view = await montar({ rev: 5 });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    await view.esperar();
    expect(view.toastMocks.success).toHaveBeenCalledWith("Campos da API salvos. Valem para as próximas integrações.");
    expect(view.invalidarIntegracaoSpy).toHaveBeenCalledWith(view.qc, "t1");
    // O rascunho local esvaziou: Salvar volta a ficar desabilitado (nada sujo) e o config exibido é o do servidor.
    expect(botaoSalvar().disabled).toBe(true);
    await view.desmontar();
  });

  it("m2: nenhum flicker — os checkboxes seguem no valor SALVO durante o refetch pós-sucesso (nunca voltam ao pré-Salvar)", async () => {
    let liberarRefetch: (() => void) | null = null;
    const travaRefetch = new Promise<void>((resolve) => { liberarRefetch = resolve; });
    let chamadasConfig = 0;
    const view = await montar({
      rev: 5,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          // 1ª chamada (carga inicial): resolve na hora com os 17 do layout. 2ª chamada em diante (refetch pós-
          // sucesso): espera a trava, simulando uma rede lenta — o teste prova que os checkboxes NÃO regridem
          // pro estado pré-Salvar enquanto essa promessa não resolve.
          if (chamadasConfig++ > 0) {
            await travaRefetch;
            return { data: { campos: CAMPOS_18, layout: [], rev: 6, api: null }, error: null };
          }
          return { data: { campos: CAMPOS_17, layout: [], rev: 5, api: null }, error: null };
        }
        if (nome === "integracao_salvar_config") return { data: null, error: null };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    // Enquanto o refetch pós-sucesso ainda não voltou (travado de propósito), a Foto continua MARCADA (o valor
    // que o usuário salvou) — nunca regride pro "unchecked" que era o estado ANTES do Salvar.
    expect(checkboxDe(view.container, "Foto do Modelo").getAttribute("data-state")).toBe("checked");
    liberarRefetch!();
    await view.esperar();
    await view.esperar();
    expect(checkboxDe(view.container, "Foto do Modelo").getAttribute("data-state")).toBe("checked");
    await view.desmontar();
  });

  it("m3: seleção vazia mostra aviso em PT e trava o Salvar", async () => {
    const view = await montar({ campos: ["nome"] });
    // Desmarcar o único campo do layout precisa passar pelo alerta (nome é campo de layout).
    await act(async () => { checkboxDe(view.container, "1Nome").click(); });
    await act(async () => { botaoDoc("Desmarcar mesmo assim").click(); });
    expect(view.container.textContent).toMatch(/Marque pelo menos um campo/);
    expect(botaoSalvar().disabled).toBe(true);
    await view.desmontar();
  });

  it("I1: P0409 conflito_versao MANTÉM a seleção do usuário (rebaseada), mostra o banner, e o PRÓXIMO save usa o rev fresco (sem loop)", async () => {
    let chamadasSalvar = 0;
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          // A config fresca do servidor (outra pessoa salvou): perdeu "peso" (desmarcado por ela) e ganhou rev 2.
          // O usuário local marcou "foto" (não estava no layout) — o rebase deve manter "foto" mesmo em cima
          // dessa base nova, e "peso" deve continuar fora (a base nova já não tem).
          const fresco = CAMPOS_17.filter((k) => k !== "peso");
          return { data: { campos: fresco, layout: [], rev: 2, api: null }, error: null };
        }
        if (nome === "integracao_salvar_config") {
          chamadasSalvar++;
          if (chamadasSalvar === 1) {
            return { data: null, error: Object.assign(new Error("conflito_versao: a configuracao foi salva por outra pessoa"), { code: "P0409" }) };
          }
          return { data: null, error: null };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    // Usuário marca Foto (1º toggle — congela base=os 17 originais, rev=1).
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    await view.esperar();
    // Exatamente 1 tentativa de salvar até aqui — nunca um retry automático em loop.
    expect(chamadasSalvar).toBe(1);
    expect(view.toastMocks.error).toHaveBeenCalledWith("Outra pessoa mudou os campos da API — as suas mudanças foram mantidas por cima da versão nova.");
    // A confirmação fecha (não fica esperando um 2º clique sobre o mesmo payload rejeitado).
    expect(document.body.textContent).not.toMatch(/Confirmar mudança de campos/);
    // O banner de conflito aparece.
    expect(view.container.textContent).toMatch(/as suas mudanças foram mantidas por cima da versão nova/);
    // A seleção do usuário foi PRESERVADA e REBASEADA: Foto continua marcada (o que ele marcou); Peso continua
    // desmarcado (a base fresca já não tinha — não é uma perda do usuário, é o estado real do servidor agora).
    expect(checkboxDe(view.container, "Foto do Modelo").getAttribute("data-state")).toBe("checked");
    const semPeso = Array.from(view.container.querySelectorAll("li")).find((li) => li.textContent?.includes("Peso") && !li.textContent?.includes("Preço"));
    expect(semPeso?.querySelector('button[role="checkbox"]')?.getAttribute("data-state")).toBe("unchecked");
    // 2º Salvar: deve mandar o REV FRESCO (2), não o velho (1) que já foi rejeitado.
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    expect(chamadasSalvar).toBe(2);
    const args2 = view.rpcSpy.mock.calls.filter((c) => c[0] === "integracao_salvar_config")[1][1] as { _rev: number };
    expect(args2._rev).toBe(2);
    await view.desmontar();
  });

  it("I1: 42501 (sem permissão) e falha de rede mantêm a seleção do usuário intocada (sem rebase, sem reset)", async () => {
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: CAMPOS_17, layout: [], rev: 1, api: null }, error: null };
        if (nome === "integracao_salvar_config") return { data: null, error: Object.assign(new Error("Só o super admin pode fazer isto."), { code: "42501" }) };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    // A seleção do usuário fica exatamente como estava — Foto continua marcada.
    expect(checkboxDe(view.container, "Foto do Modelo").getAttribute("data-state")).toBe("checked");
    expect(view.toastMocks.error).toHaveBeenCalledWith("Só o super admin pode fazer isto.");
    // Nenhum banner de conflito (não é P0409) — e Salvar continua habilitado pra tentar de novo.
    expect(view.container.textContent).not.toMatch(/as suas mudanças foram mantidas/);
    expect(botaoSalvar().disabled).toBe(false);
    await view.desmontar();
  });

  it("m1: erro de carga (1ª vez, sem dado nenhum) mostra 'Tentar de novo'", async () => {
    const view = await montar({
      rpcImpl: async () => ({ data: null, error: new Error("falhou") }),
    });
    expect(view.container.textContent).toMatch(/Não foi possível carregar os campos/);
    const tentar = Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "Tentar de novo");
    expect(tentar).toBeDefined();
    await view.desmontar();
  });
});
