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
//
// Fix round 2 (task-14-review.md "Re-review round 1"):
// - R1 (Important, test-only): o teste de I1 do round 1 era VAZIO nas duas propriedades que importam — o mock de
//   `integracao_config_ler` devolvia SEMPRE a config pós-conflito (rev 2, sem Peso), inclusive na carga inicial,
//   então "Peso desmarcado" valia mesmo SEM rebase nenhum (Peso nunca esteve marcado pra começo de conversa) e
//   "_rev: 2 no 2º save" valia mesmo SEM nenhum refresh de rev (o rev congelado no 1º toggle já era 2). Reescrito
//   abaixo: a 1ª leitura devolve `{17 campos INCLUINDO Peso, rev 1}`, só a leitura PÓS-conflito devolve
//   `{sem Peso, rev 2}` — agora "Peso marcado antes / desmarcado depois" e "1º save manda rev 1, 2º manda rev 2"
//   são provas de verdade do rebase e do refresh de rev. Duas sabotagens têm que virar RED: (a) manter `ed.rev`
//   velho no handler do P0409 em vez do `r.data.rev` fresco; (b) trocar `rebasear(ed, fresco)` por `ed.sel` cru.
// - n1: o banner agora lista o que a OUTRA pessoa mudou; testes para os 3 textos (diff normal, falso conflito
//   "só rev", "nada a salvar" quando o rebase zera a diferença).
// - n2: `ed` some quando o usuário desfaz o próprio toggle (volta a bater com a base) — a tela volta a espelhar
//   o servidor ao vivo.
// - n3: os checkboxes desabilitam durante `salvar.isPending`.
// - n4: título do teste 42501 corrigido (só testava 42501, nunca rede); teste do guard resetando pra `false`
//   após sucesso/desmontagem; teste do ramo de erro em BACKGROUND do m1 (lista com dado em cache continua
//   visível, só ganha o aviso inline).
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { useQuery } from "@tanstack/react-query";
import { alternarCampo, mesmaSelecao, ordenarCampos, precisaAlertaLayout, rotuloNaLista } from "@/lib/integracao/campos";

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
    // revisão T15 #1 (code-review I1): permite mudar o tenant ATIVO no meio do teste, sem desmontar o
    // componente — simula o cenário em que a página NÃO remonta (o `key={tenantId}` de `IntegracaoPage`
    // normalmente cobre isso; este teste prova a defesa em profundidade DENTRO de `CamposAba` sozinha).
    tenantIdRef?: { current: string };
    // revisão T15 #I1-R (code-review "Re-check round 1"): mocka o comportamento de `confirmarLojaAtiva` — por
    // padrão resolve como se a loja NÃO tivesse mudado (não afeta nenhum teste antigo).
    confirmarLojaAtivaImpl?: () => Promise<void>;
  } = {}) {
    vi.resetModules();
    const campos = opts.campos ?? CAMPOS_17;
    const rev = opts.rev ?? 3;
    const rpcSpy = vi.fn(
      opts.rpcImpl ?? (async () => ({ data: { campos, layout: campos, rev, api: null }, error: null })),
    );
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcSpy } }));
    const tRef = opts.tenantIdRef ?? { current: "t1" };
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => tRef.current }));
    const toastMocks = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
    vi.doMock("sonner", () => ({ toast: toastMocks }));
    vi.doMock("@tanstack/react-router", () => ({ useRouter: () => ({ history: { back: () => {} } }) }));
    const invalidarIntegracaoSpy = vi.fn();
    const confirmarLojaAtivaSpy = vi.fn(opts.confirmarLojaAtivaImpl ?? (async () => {}));
    vi.doMock("@/components/integracao/useIntegracao", () => ({
      chaveConfig: (tenantId: string) => ["integracao-config", tenantId],
      invalidarIntegracao: invalidarIntegracaoSpy,
      TEXTO_LOJA_MUDOU: "A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.",
      confirmarLojaAtiva: confirmarLojaAtivaSpy,
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
      container, rpcSpy, toastMocks, invalidarIntegracaoSpy, informarSujoSpy, qc, confirmarLojaAtivaSpy,
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

  it("R1/I1: P0409 conflito_versao MANTÉM a seleção do usuário (rebaseada), mostra o banner, e o PRÓXIMO save usa o rev fresco (sem loop)", async () => {
    // R1 fix (task-14-review.md "Re-review round 1"): a 1ª leitura (carga inicial) devolve os 17 campos do
    // layout COM Peso e rev 1 — só a leitura seguinte (a que o handler do P0409 dispara) devolve a versão SEM
    // Peso e rev 2. Assim "Peso desmarcado" só vale se o rebase de verdade rodou (Peso ESTAVA marcado antes), e
    // "_rev: 2 no 2º save" só vale se o refresh de rev de verdade aconteceu (o rev congelado no 1º toggle foi 1).
    let leiturasConfig = 0;
    let chamadasSalvar = 0;
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leiturasConfig++;
          if (leiturasConfig === 1) return { data: { campos: CAMPOS_17, layout: [], rev: 1, api: null }, error: null };
          // A config fresca do servidor (outra pessoa salvou): perdeu "peso" (desmarcado por ela) e ganhou rev 2.
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
    // Peso está marcado ANTES do conflito (a 1ª leitura tem os 17, incluindo Peso).
    const linhaPeso = () => Array.from(view.container.querySelectorAll("li")).find((li) => li.textContent?.includes("Peso") && !li.textContent?.includes("Preço"))!;
    expect(linhaPeso().querySelector('button[role="checkbox"]')?.getAttribute("data-state")).toBe("checked");
    // Usuário marca Foto (1º toggle — congela base=os 17 originais COM Peso, rev=1).
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    await view.esperar();
    // Exatamente 1 tentativa de salvar até aqui — nunca um retry automático em loop.
    expect(chamadasSalvar).toBe(1);
    // A confirmação fecha (não fica esperando um 2º clique sobre o mesmo payload rejeitado).
    expect(document.body.textContent).not.toMatch(/Confirmar mudança de campos/);
    // O banner de conflito aparece.
    expect(view.container.textContent).toMatch(/as suas mudanças foram mantidas por cima da versão nova/);
    // A seleção do usuário foi PRESERVADA e REBASEADA: Foto continua marcada (o que ele marcou); Peso agora
    // DESMARCADO — só é prova de rebase de verdade porque Peso ESTAVA marcado antes do conflito.
    expect(checkboxDe(view.container, "Foto do Modelo").getAttribute("data-state")).toBe("checked");
    expect(linhaPeso().querySelector('button[role="checkbox"]')?.getAttribute("data-state")).toBe("unchecked");
    // 2º Salvar: deve mandar o REV FRESCO (2), não o velho (1) que já foi rejeitado — só é prova de refresh de
    // verdade porque o rev CONGELADO no 1º toggle era 1 (a 1ª leitura), não 2.
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    expect(chamadasSalvar).toBe(2);
    const chamadas = view.rpcSpy.mock.calls.filter((c) => c[0] === "integracao_salvar_config");
    expect((chamadas[0][1] as { _rev: number })._rev).toBe(1);
    expect((chamadas[1][1] as { _rev: number })._rev).toBe(2);
    await view.desmontar();
  });

  it("I1: 42501 (sem permissão) mantém a seleção do usuário intocada (sem rebase, sem reset)", async () => {
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

  it("n4: falha de rede (erro sem code, ex.: 'Failed to fetch') também mantém a seleção do usuário intocada", async () => {
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: CAMPOS_17, layout: [], rev: 1, api: null }, error: null };
        if (nome === "integracao_salvar_config") return { data: null, error: new Error("Failed to fetch") };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    expect(checkboxDe(view.container, "Foto do Modelo").getAttribute("data-state")).toBe("checked");
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

  it("n4: erro de carga em BACKGROUND (dado já em cache) mantém a lista visível, só soma um aviso inline", async () => {
    let leituras = 0;
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras === 1) return { data: { campos: CAMPOS_17, layout: [], rev: 1, api: null }, error: null };
          return { data: null, error: new Error("falhou de novo") };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    // Carga inicial ok: a lista está visível.
    expect(view.container.querySelectorAll('button[role="checkbox"]').length).toBe(18);
    // Um refetch em BACKGROUND que falha (ex.: reabrir a aba) não pode esconder a lista já carregada.
    // p3 (task-14-review.md): `refetchQueries` NÃO rejeita quando a query falha — no query-core 5.101 a própria
    // promise ENGOLE o erro internamente (a menos que `throwOnError` seja passado), então o `.catch(() => {})`
    // abaixo não faz nada de fato; fica só por precaução/documentação (o que importa de verdade é o ESTADO da
    // query, `isError`, checado logo abaixo — não a promise desta chamada).
    await act(async () => { await view.qc.refetchQueries({ queryKey: ["integracao-config", "t1"] }).catch(() => {}); });
    await view.esperar();
    expect(view.container.querySelectorAll('button[role="checkbox"]').length).toBe(18);
    expect(view.container.textContent).toMatch(/Não foi possível atualizar os campos/);
    const tentar = Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "Tentar de novo");
    expect(tentar).toBeDefined();
    await view.desmontar();
  });

  it("n4: useAbaSuja volta para false depois de um Salvar bem-sucedido, e também ao desmontar", async () => {
    const view = await montar({ rev: 5, comGuarda: true });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    expect(view.informarSujoSpy).toHaveBeenCalledWith("campos", true);
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    await view.esperar();
    expect(view.informarSujoSpy).toHaveBeenLastCalledWith("campos", false);
    await view.desmontar();
    // A desmontagem também reporta `false` (guard.ts: o segundo useEffect roda no cleanup).
    expect(view.informarSujoSpy).toHaveBeenLastCalledWith("campos", false);
  });

  it("n1: o banner lista o que a OUTRA pessoa mudou (diff base-antiga → fresca)", async () => {
    let leituras = 0;
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras === 1) return { data: { campos: CAMPOS_17, layout: [], rev: 1, api: null }, error: null };
          // A outra pessoa desmarcou Peso e marcou Foto — o diff deve citar os dois. O usuário local mexeu num
          // campo DIFERENTE (Largura), então o rebase não consome nada desse diff — ele aparece intacto no banner.
          const fresco = ordenarCampos([...CAMPOS_17.filter((k) => k !== "peso"), "foto"]);
          return { data: { campos: fresco, layout: [], rev: 2, api: null }, error: null };
        }
        if (nome === "integracao_salvar_config") {
          return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    // Largura é campo de layout — desmarcar passa pelo alerta "Tem certeza?" (congela a base no clique do checkbox).
    await act(async () => { checkboxDe(view.container, "Largura").click(); });
    await act(async () => { botaoDoc("Desmarcar mesmo assim").click(); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    await view.esperar();
    expect(view.container.textContent).toMatch(/Mudou na loja:/);
    expect(view.container.textContent).toMatch(/Peso \(desmarcado\)/);
    expect(view.container.textContent).toMatch(/Foto do Modelo \(marcado\)/);
    await view.desmontar();
  });

  it("n1: falso conflito (rev mudou, mas os CAMPOS continuam os mesmos — Task 15 salvou só a config da API)", async () => {
    let leituras = 0;
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          // MESMA lista de campos nas duas leituras — só o rev muda (compartilhado com a Task 15).
          return { data: { campos: CAMPOS_17, layout: [], rev: leituras === 1 ? 1 : 2, api: null }, error: null };
        }
        if (nome === "integracao_salvar_config") {
          return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    await view.esperar();
    expect(view.container.textContent).toMatch(/A configuração foi salva por outra pessoa enquanto você editava; as suas mudanças continuam aqui\./);
    // Foto continua marcada — a mudança do usuário sobrevive ao falso conflito.
    expect(checkboxDe(view.container, "Foto do Modelo").getAttribute("data-state")).toBe("checked");
    await view.desmontar();
  });

  it("n1/n2: quando o rebase deixa a seleção IDÊNTICA à fresca, avisa 'não sobrou nada' e limpa o rascunho (ed volta a espelhar o servidor)", async () => {
    let leituras = 0;
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras === 1) return { data: { campos: CAMPOS_17, layout: [], rev: 1, api: null }, error: null };
          // A outra pessoa JÁ marcou Foto — exatamente a mesma mudança que o usuário local fez.
          return { data: { campos: CAMPOS_18, layout: [], rev: 2, api: null }, error: null };
        }
        if (nome === "integracao_salvar_config") {
          return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); }); // mesma mudança que a loja já tem
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    await view.esperar();
    expect(view.container.textContent).toMatch(/não sobrou nada para salvar/);
    // n2: o rascunho fechou — Salvar volta a ficar desabilitado (a seleção "espelha" o servidor, que já tem Foto).
    expect(botaoSalvar().disabled).toBe(true);
    expect(checkboxDe(view.container, "Foto do Modelo").getAttribute("data-state")).toBe("checked");
    await view.desmontar();
  });

  // p1 (task-14-review.md, revisão T14 "Re-review round 2"): quando a mudança do usuário está CONTIDA na mudança
  // maior da loja (ele só marcou Foto; a loja marcou Foto E TAMBÉM desmarcou Peso), o rebase ainda deixa a seleção
  // do usuário IDÊNTICA à fresca (nadaRestou=true) — mas dizer "exatamente a mudança que você fez" seria falso (a
  // loja mudou MAIS coisa). O banner "nada a salvar" precisa CONTINUAR listando "Mudou na loja: …" com o que mais
  // mudou por lá, e mostrar 1 botão só de dispensar (não há "minha" vs "da loja" pra escolher — ed já é null).
  it("p1: mudança do usuário CONTIDA na da loja — 'nada a salvar' ainda lista 'Mudou na loja: …' e mostra 1 botão só (Entendi)", async () => {
    let leituras = 0;
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras === 1) return { data: { campos: CAMPOS_17, layout: [], rev: 1, api: null }, error: null };
          // A loja marcou Foto (a MESMA mudança do usuário) E TAMBÉM desmarcou Peso (mudança A MAIS, que o
          // usuário não fez) — a mudança do usuário está CONTIDA na da loja, não é idêntica a ela.
          const fresco = ordenarCampos([...CAMPOS_17.filter((k) => k !== "peso"), "foto"]);
          return { data: { campos: fresco, layout: [], rev: 2, api: null }, error: null };
        }
        if (nome === "integracao_salvar_config") {
          return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); }); // só isso — não mexeu em Peso
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    await view.esperar();
    // Ainda é "nada a salvar" (a seleção do usuário, rebaseada, bate com a fresca) — mas SEM "exatamente".
    expect(view.container.textContent).toMatch(/não sobrou nada para salvar/);
    expect(view.container.textContent).not.toMatch(/exatamente/);
    // E lista o que MAIS mudou na loja (Peso desmarcado) — informação que o usuário não causou.
    expect(view.container.textContent).toMatch(/Mudou na loja:/);
    expect(view.container.textContent).toMatch(/Peso \(desmarcado\)/);
    // 1 botão só no banner ("Entendi") — não "usar a da loja"/"manter a minha" (não há nada pra escolher: ed é null).
    const botoesBanner = Array.from(view.container.querySelectorAll("button")).filter(
      (b) => b.textContent === "Entendi" || b.textContent === "usar a da loja" || b.textContent === "manter a minha",
    );
    expect(botoesBanner.map((b) => b.textContent)).toEqual(["Entendi"]);
    await view.desmontar();
  });

  // p2 (task-14-review.md, revisão T14 "Re-review round 2"): os botões do banner de conflito desabilitam durante
  // um 2º Salvar em voo — um clique em "usar a da loja"/"manter a minha" nesse intervalo não pode disputar com o
  // `setEd` que o onError do 2º save aplicar ao resolver.
  it("p2: os botões do banner de conflito desabilitam enquanto um 2º Salvar está em voo", async () => {
    let leituras = 0;
    let chamadasSalvar = 0;
    let liberarSegundoSalvar: (() => void) | null = null;
    const travaSegundoSalvar = new Promise<void>((resolve) => { liberarSegundoSalvar = resolve; });
    const view = await montar({
      rev: 1,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras === 1) return { data: { campos: CAMPOS_17, layout: [], rev: 1, api: null }, error: null };
          const fresco = CAMPOS_17.filter((k) => k !== "peso");
          return { data: { campos: fresco, layout: [], rev: 2, api: null }, error: null };
        }
        if (nome === "integracao_salvar_config") {
          chamadasSalvar++;
          if (chamadasSalvar === 1) {
            return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
          }
          // 2º save: fica pendente até o teste liberar — simula uma rede lenta enquanto o banner ainda está aberto.
          await travaSegundoSalvar;
          return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    await view.esperar();
    // O banner do 1º conflito está aberto — dispara um 2º Salvar (fica pendente, travado de propósito).
    expect(view.container.textContent).toMatch(/Mudou na loja:/);
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    // Enquanto o 2º save está em voo, os botões do banner (ainda visível, da mensagem do 1º conflito) desabilitam.
    const botaoUsarLoja = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "usar a da loja") as HTMLButtonElement | undefined;
    const botaoManterMinha = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "manter a minha") as HTMLButtonElement | undefined;
    expect(botaoUsarLoja()?.disabled).toBe(true);
    expect(botaoManterMinha()?.disabled).toBe(true);
    liberarSegundoSalvar!();
    await view.esperar();
    await view.esperar();
    // Depois que o 2º save resolve (outro P0409), o banner volta a ficar clicável.
    expect(botaoUsarLoja()?.disabled).toBe(false);
    expect(botaoManterMinha()?.disabled).toBe(false);
    await view.desmontar();
  });

  it("n2: desfazer manualmente o próprio toggle (voltar pra base) fecha o rascunho de verdade — um refetch DEPOIS aparece na hora", async () => {
    // A prova de que `ed` virou null de verdade (não só que `sujo`/Salvar ficaram desabilitados, que também
    // aconteceria com `ed` não-nulo mas `sel===base`): um refetch em BACKGROUND que chega DEPOIS de desfazer o
    // toggle só pode aparecer nos checkboxes se a tela estiver espelhando `q.data` ao vivo (ed===null). Com `ed`
    // preso não-nulo (sabotagem), os checkboxes continuariam mostrando o `ed.sel` velho, cego ao refetch.
    let leituras = 0;
    const view = await montar({
      rev: 3,
      comGuarda: true,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras === 1) return { data: { campos: CAMPOS_17, layout: [], rev: 3, api: null }, error: null };
          // A loja mudou por fora (outra pessoa): Peso saiu.
          return { data: { campos: CAMPOS_17.filter((k) => k !== "peso"), layout: [], rev: 4, api: null }, error: null };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    const foto = () => checkboxDe(view.container, "Foto do Modelo");
    await act(async () => { foto().click(); }); // marca
    expect(botaoSalvar().disabled).toBe(false);
    expect(view.informarSujoSpy).toHaveBeenCalledWith("campos", true);
    await act(async () => { foto().click(); }); // desmarca de novo — volta a bater com a base
    expect(botaoSalvar().disabled).toBe(true);
    expect(view.informarSujoSpy).toHaveBeenLastCalledWith("campos", false);
    // Refetch em background chega DEPOIS de desfazer o toggle — só aparece se `ed` for null (tela ao vivo).
    await act(async () => { await view.qc.refetchQueries({ queryKey: ["integracao-config", "t1"] }); });
    await view.esperar();
    const linhaPeso = Array.from(view.container.querySelectorAll("li")).find((li) => li.textContent?.includes("Peso") && !li.textContent?.includes("Preço"))!;
    expect(linhaPeso.querySelector('button[role="checkbox"]')?.getAttribute("data-state")).toBe("unchecked");
    await view.desmontar();
  });

  it("n3: os checkboxes desabilitam durante o Salvar (inclusive no refetch pós-sucesso aguardado)", async () => {
    let liberarRefetch: (() => void) | null = null;
    const travaRefetch = new Promise<void>((resolve) => { liberarRefetch = resolve; });
    let leituras = 0;
    const view = await montar({
      rev: 5,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras > 1) { await travaRefetch; return { data: { campos: CAMPOS_18, layout: [], rev: 6, api: null }, error: null }; }
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
    // A mutation ainda está pendente (presa no refetch travado) — os checkboxes têm que estar desabilitados.
    expect(checkboxDe(view.container, "Foto do Modelo").disabled).toBe(true);
    liberarRefetch!();
    await view.esperar();
    await view.esperar();
    expect(checkboxDe(view.container, "Foto do Modelo").disabled).toBe(false);
    await view.desmontar();
  });

  // revisão T15 #1 (code-review I1, "wrong-store save" — defesa em profundidade): o `TenantSwitcher` troca a loja
  // NO SERVIDOR antes de navegar; se o super admin cancela o "Descartar alterações?" da guarda de navegação, a
  // página (normalmente) remonta a aba por `key={tenantId}` — mas ESTE teste prova que, mesmo que isso NÃO
  // aconteça (bug futuro, engano de composição), `CamposAba` sozinha recusa salvar o rascunho da loja errada: o
  // `Edicao` carrega o `tenantId` em que nasceu, e o mutationFn recusa ANTES de qualquer chamada de rede se ele
  // não bate mais com o tenant ATIVO.
  it("revisão T15 #1: rascunho nascido na loja A não é salvo depois de o tenant ativo virar B (RPC nunca chamada)", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ rev: 3, tenantIdRef });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); }); // rascunho nasce em lojaA
    // O super admin troca de loja (o componente NÃO desmonta — simula a ausência do key={tenantId}/um bug futuro).
    tenantIdRef.current = "lojaB";
    await view.rerender();
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    // A RPC de salvar NUNCA foi chamada — a recusa acontece ANTES de qualquer chamada de rede.
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_salvar_config")).toBe(false);
    expect(view.toastMocks.error).toHaveBeenCalledWith("A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.");
    await view.desmontar();
  });

  // revisão T15 #I1-R (code-review "Re-check round 1"): a defesa acima (`Edicao.tenantId` vs `tenantId` cacheado)
  // só pega uma troca que ESTA aba já viu no cache — uma 2ª aba/janela que trocou a loja no SERVIDOR sem que esta
  // aba reobservasse a query (`tenantId` continua "t1" nos dois lados) não é pega por ela. `confirmarLojaAtiva`
  // relê DIRETO do servidor imediatamente antes do `rpc`, e é a ÚLTIMA linha de defesa real.
  it("I1-R: confirmarLojaAtiva recusa salvar quando o servidor já está noutra loja (RPC nunca chamada)", async () => {
    const view = await montar({
      confirmarLojaAtivaImpl: async () => {
        throw Object.assign(new Error("A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar."), { code: "LOJA_MUDOU" });
      },
    });
    await act(async () => { checkboxDe(view.container, "Foto do Modelo").click(); });
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Confirmar e salvar").click(); });
    await view.esperar();
    expect(view.confirmarLojaAtivaSpy).toHaveBeenCalled();
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_salvar_config")).toBe(false);
    expect(view.toastMocks.error).toHaveBeenCalledWith("A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.");
    await view.desmontar();
  });
});
