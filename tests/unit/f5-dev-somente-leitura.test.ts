// @vitest-environment happy-dom
// F5a (dono 28/set, P-104 B ajustado + P-110 A) — Sheet do Desenvolvimento SÓ LEITURA.
// Monta o COMPONENTE REAL `ModeloDetailPanel` (react-dom/client + happy-dom, sem @testing-library) com o
// QueryClient de produção e um Supabase FALSO que registra toda escrita (insert/update/delete/upsert,
// RPC fora da lista de leitura, storage.upload/remove). Prova:
//   (1) em modo leitura NADA grava — nem digitando/blur em todo campo, nem clicando em todo botão, nem
//       "subindo" arquivo;
//   (2) todos os campos (input/textarea/select) ficam desabilitados;
//   (3) o rodapé tem exatamente Voltar · Imprimir · Ir para P. Produto, e "Ir para P. Produto" navega com
//       `?modelo=<id>` (e some, ficando 2 botões, sem a permissão do Planejamento);
//   (4) com `somenteLeitura=false` (padrão) o rodapé/cabeçalho de hoje continuam iguais.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));
const navigateMock = vi.hoisted(() => vi.fn());
const PERM = vi.hoisted(() => ({ planejamento: true }));

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./_fix_hidratacao/fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1", email: "qa@teste" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: (k: string) => (k === "criacao_planejamento" ? PERM.planejamento : true),
    canEdit: () => true, loading: false, signOut: async () => {},
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
    useNavigate: () => navigateMock,
    useBlocker: () => ({ status: "idle", proceed() {}, reset() {} }),
  };
});
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, toastMock), Toaster: () => null }));

import { act, createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./_fix_hidratacao/fake-supabase";
import { montar, esperar, aguardar, digitar, clicar } from "./_fix_hidratacao/dom-helpers";
import { ModeloDetailPanel } from "@/components/desenvolvimento/ModeloDetailPanel";

// RPCs de LEITURA que o Sheet do Dev chama (qualquer outra RPC é escrita).
const RPC_LEITURA = new Set([
  "avaliar_condicoes_kanban", "modelo_mo_resumo", "precos_tecido_congelado", "modelo_etapas_afetadas", "ocs_disponiveis_variante",
  "get_user_tenant_id", // leitura do prefixo do storage (tenantPrefix) — o upload em si é contado em `storageOps`
]);
const storageOps: { op: string; bucket: string; args: unknown }[] = [];
const escritas = () => [
  ...FAKE.chamadas.filter((c) =>
    ["insert", "update", "delete", "upsert"].includes(c.op) || (c.op === "rpc" && !RPC_LEITURA.has(c.tabela.replace(/^rpc:/, "")))),
  ...storageOps,
];

function seed({ enviadoCad }: { enviadoCad: boolean }) {
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1", nome: "QA" }];
  FAKE.linhas.tenant_config = [{
    tenant_id: "t1", status_kanban: ["Em Modelagem", "Aprovado"], tamanhos_grade: ["38|P", "40|M"],
    explosao_envio_status: "aprovado", ref_exibir_status: "aprovado", kanban_requisitos: {}, timezone: "America/Sao_Paulo",
  }];
  FAKE.linhas.modelos = [{
    id: "m1", tenant_id: "t1", nome: "BLUSA TESTE", ref: "BT10000001", versao: 1, rev: 3, origem: "interno",
    status_desenvolvimento: "aprovado", enviado_cad: enviadoCad, estilista_id: null, linha_id: null,
    categoria_principal_id: null, observacoes_gerais: "obs gerais", observacoes_tecnicas: "obs técnicas",
    observacoes_mao_obra: "obs mo", custos_adicionais: [{ descricao: "Frete", valor: 2 }], proporcoes: { "38|P": 1, "40|M": 1 },
    fotos_modelo: ["t1/fotos_modelo/a.jpg"], fotos_referencia: [], croqui_url: "t1/croqui/c.jpg", desenho_tecnico_url: "",
    ficha_medida_url: "", tecidos_planejados: [], data_piloto1: "2026-09-01", data_desenho_tecnico: "2026-09-01",
  }];
  FAKE.linhas.modelo_observacoes = [{ id: "o1", modelo_id: "m1", ordem: 1, descricao: "Lavagem", observacao: "à mão" }];
  FAKE.linhas.modelo_prova_comentarios = [{
    id: "c1", modelo_id: "m1", parent_id: null, user_id: "u1", texto: "subir a barra", resolvido: false, resolvido_at: null,
    created_at: "2026-09-28T10:00:00Z", autor: { nome: "QA" },
  }];
  FAKE.linhas.aviamentos = [{ id: "av1", codigo_nome: "Botão", preco: 1, variantes: [] }];
  FAKE.linhas.modelo_aviamentos = [{ id: "ma1", modelo_id: "m1", aviamento_id: "av1", variante_aviamento_id: null, numero: 1, consumo: 2, loss_percent: 0, custo_previsto: 2 }];
  FAKE.linhas.etiquetas = [{ id: "e1", nome: "Etiqueta", formato_tamanho: "ambos", preco: 1, variantes_etiqueta: [] }];
  FAKE.linhas.modelo_etiquetas = [{ id: "me1", modelo_id: "m1", etiqueta_id: "e1", cor_id: null, numero: 1, consumo: 1, loss_percent: 0, custo_previsto: 1 }];
  FAKE.linhas.modelo_grades = [{ modelo_id: "m1", variante_numero: 1, grades: { "38|P": 2, "40|M": 2 }, grade_total: 4 }];
  FAKE.linhas.categorias_terceirizado = [{ id: "ct1", nome: "Costura", ativo: true }];
}

let desmontar: (() => Promise<void>) | null = null;
const onClose = vi.fn();
async function abrir(props: { somenteLeitura?: boolean }) {
  const qc = new QueryClient(); // MESMO default do app
  const m = await montar(createElement(QueryClientProvider, { client: qc },
    createElement(ModeloDetailPanel, { modeloId: "m1", onClose, ...props })));
  desmontar = m.desmontar;
  await aguardar(() => !!document.querySelector('[data-acc="s1"]'), "seed do modelo");
  await esperar(50);
}
/** Abre TODAS as seções do accordion (o conteúdo só monta aberto). */
async function abrirTodasSecoes() {
  // Só os gatilhos do accordion (`[data-acc] > h3 > button`). Obs.: o happy-dom NÃO bloqueia `.click()` em botão
  // dentro de `fieldset[disabled]` (o navegador bloqueia) — por isso o teste de "nenhuma escrita" clica em tudo e
  // depende das guardas nos handlers, não só do fieldset.
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-acc] > h3 > button[aria-expanded="false"]'))) await clicar(b);
  await esperar(50);
}
const campos = () => Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"));
const desabilitado = (el: Element) => (el as HTMLInputElement).disabled || !!el.closest("fieldset[disabled]");
const botoesRodape = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="dev-ro-rodape"] button')).map((b) => (b.textContent ?? "").trim());

beforeEach(() => {
  FAKE.reset();
  storageOps.length = 0;
  FAKE.supabase.storage = {
    from: (bucket: string) => ({
      upload: (...args: unknown[]) => { storageOps.push({ op: "storage.upload", bucket, args }); return Promise.resolve({ data: null, error: null }); },
      remove: (...args: unknown[]) => { storageOps.push({ op: "storage.remove", bucket, args }); return Promise.resolve({ data: null, error: null }); },
      getPublicUrl: () => ({ data: { publicUrl: "" } }),
      createSignedUrl: () => Promise.resolve({ data: { signedUrl: "blob:x" }, error: null }),
      createSignedUrls: () => Promise.resolve({ data: [], error: null }),
    }),
  };
  PERM.planejamento = true;
  navigateMock.mockClear();
  onClose.mockClear();
  Object.values(toastMock).forEach((f) => f.mockClear());
  (window as any).print = vi.fn();
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

describe("F5a — Sheet do Desenvolvimento SÓ LEITURA", () => {
  it("nenhuma escrita: digitar/blur em todo campo, clicar em todo botão e 'subir' arquivo não gravam nada", async () => {
    seed({ enviadoCad: false });
    await abrir({ somenteLeitura: true });
    await abrirTodasSecoes();
    expect(campos().length).toBeGreaterThan(10); // montou as seções de verdade

    // 1) digita + blur em TODO campo (inclusive os do auto-save das Observações do bloco)
    for (const el of campos()) {
      if (el instanceof HTMLSelectElement) continue;
      if ((el as HTMLInputElement).type === "file") {
        Object.defineProperty(el, "files", { value: [new File(["x"], "a.png", { type: "image/png" })], configurable: true });
        await act(async () => { el.dispatchEvent(new Event("change", { bubbles: true })); });
        continue;
      }
      if ((el as HTMLInputElement).type === "checkbox") { await clicar(el as HTMLElement); continue; }
      await digitar(el as HTMLInputElement, "123");
      await act(async () => {
        el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        el.dispatchEvent(new FocusEvent("blur"));
      });
    }
    // 2) clica em TODO botão (menos os que saem do Sheet — Voltar/Ir para P. Produto testados à parte)
    const pular = new Set(["Voltar", "Ir para P. Produto", "Close"]);
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("button"))) {
      if (!b.isConnected || pular.has((b.textContent ?? "").trim())) continue;
      await clicar(b);
    }
    await esperar(100);

    expect(escritas()).toEqual([]);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("todos os campos (input/textarea/select) e botões de edição ficam desabilitados; sem Salvar/Enviar/Importar/Editar", async () => {
    seed({ enviadoCad: false });
    await abrir({ somenteLeitura: true });
    await abrirTodasSecoes();
    const soltos = campos().filter((el) => !desabilitado(el)).map((el) => el.outerHTML.slice(0, 120));
    expect(soltos).toEqual([]);
    const textos = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
    // Ações de ciclo/gravação: nem aparecem.
    for (const t of ["Salvar", "Enviar", "Importar dados", "Responder", "Resolver", "Reabrir", "Excluir"]) expect(textos).not.toContain(t);
    expect(document.querySelector('button[aria-label="Editar"]')).toBeNull();
    // Todo <button> que sobra está desabilitado, exceto os de NAVEGAÇÃO/LEITURA: abrir/fechar seção do
    // accordion, abas da Prova, fechar o Sheet e o rodapé (Voltar · Imprimir · Ir para P. Produto).
    const permitido = (b: HTMLButtonElement) =>
      !!b.closest('[data-testid="dev-ro-rodape"]') || b.getAttribute("role") === "tab"
      || (!!b.closest("[data-acc]") && b.parentElement?.tagName === "H3") || (b.textContent ?? "").trim() === "Close";
    const ativos = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .filter((b) => !permitido(b) && !desabilitado(b)).map((b) => (b.textContent ?? "").trim() || b.getAttribute("aria-label"));
    expect(ativos).toEqual([]);
    // Ajustes na Prova: o fio aparece e as abas seguem clicáveis (leitura), sem caixa de envio.
    expect(document.body.textContent).toContain("subir a barra");
    const abaResolvidos = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent?.includes("Resolvidos"));
    expect(abaResolvidos && desabilitado(abaResolvidos)).toBe(false);
    // Cabeçalho: título + REF + selo de etapa; sem a barra "Status no fluxo".
    expect(document.querySelector('[data-testid="dev-ro-ref"]')?.textContent).toContain("BT10000001");
    expect(document.querySelector('[data-testid="dev-ro-etapa"]')?.textContent).toBe("Aprovado");
    expect(document.body.textContent).not.toContain("Status no fluxo");
  });

  it("rodapé = exatamente Voltar · Imprimir · Ir para P. Produto; navega com ?modelo=<id>; Voltar fecha sem guarda", async () => {
    seed({ enviadoCad: true });
    await abrir({ somenteLeitura: true });
    expect(botoesRodape()).toEqual(["Voltar", "Imprimir", "Ir para P. Produto"]);
    const imprimir = document.querySelector<HTMLButtonElement>('[data-testid="dev-ro-rodape"] button[aria-label="Imprimir"]')!;
    expect(imprimir.disabled).toBe(false); // enviado à Explosão → a Ficha Técnica existe
    await clicar(Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="dev-ro-rodape"] button')).find((b) => b.textContent?.trim() === "Ir para P. Produto")!);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/criacao/planejamento", search: { modelo: "m1" } });
    await clicar(document.querySelector<HTMLButtonElement>('[data-testid="dev-ro-rodape"] button[aria-label="Voltar"]')!);
    expect(onClose).toHaveBeenCalledTimes(1); // nunca pede "Descartar alterações?"
    expect(document.body.textContent).not.toContain("Descartar alterações");
    expect(escritas()).toEqual([]);
  });

  it("Imprimir fica desabilitado antes do Enviar à Explosão (igual ao botão Ficha Técnica de hoje)", async () => {
    seed({ enviadoCad: false });
    await abrir({ somenteLeitura: true });
    expect(document.querySelector<HTMLButtonElement>('[data-testid="dev-ro-rodape"] button[aria-label="Imprimir"]')!.disabled).toBe(true);
  });

  it("sem permissão de ver o Planejamento, 'Ir para P. Produto' some (ficam Voltar · Imprimir)", async () => {
    PERM.planejamento = false;
    seed({ enviadoCad: true });
    await abrir({ somenteLeitura: true });
    expect(botoesRodape()).toEqual(["Voltar", "Imprimir"]);
  });

  // M3 da revisão (28/set, ModeloDetailPanel.tsx ~886-899 e ~1078): antes do fix, um save de
  // OUTRA pessoa que mexe SÓ no CAD (Explosão/PCP) não reabaixava `cadSeeded` — a seção "4. CAD"
  // ficava com o valor antigo até o Sheet ser reaberto, mesmo a tela estando "ao vivo" (Realtime).
  // Este teste seeda um `cad`+`cad_tecidos` com consumo_cad=5, confirma que a seção mostra 5,00,
  // muda o valor no FAKE p/ 9 e dispara o mesmo evento que o Realtime dispararia
  // (`postgres_changes` em `modelos`, que é o que `useColabRegistro({tabela:"modelos"})` escuta),
  // e afirma que a seção "4. CAD" passa a mostrar 9,00 — SEM reabrir o Sheet.
  it("CAD (seção 4) re-semeia sozinha quando um save de outra pessoa muda só o CAD", async () => {
    seed({ enviadoCad: true });
    FAKE.linhas.cad = [{ id: "cad1", modelo_id: "m1" }];
    FAKE.linhas.cad_tecidos = [{
      id: "ct1", cad_id: "cad1", numero: 1, tipo: "tecido", artigo_id: null,
      consumo_cad: 5, loss_percent_cad: 0, custo_cad: 0, tamanho_folha: 0,
      artigos: null, cad_tecido_variantes: [],
    }];
    await abrir({ somenteLeitura: true });
    await abrirTodasSecoes();
    const campoConsumo = () => Array.from(document.querySelectorAll<HTMLInputElement>("input"))
      .find((el) => Number(el.value.replace(",", ".")) === 5 || Number(el.value.replace(",", ".")) === 9);
    await aguardar(() => !!campoConsumo(), "seed do CAD (consumo_cad=5)");
    expect(campoConsumo()!.value).toBe("5,00");

    // Simula outro usuário salvando SÓ o CAD (não muda `modelos`, mas o Realtime entrega o
    // mesmo evento — o comentário em ModeloDetailPanel.tsx confirma isto: "o evento
    // postgres_changes não distingue escalar de BOM"). Muda o dado e dispara o listener da
    // tabela "modelos", exatamente como `useColabRegistro({tabela:"modelos"})` recebe.
    FAKE.linhas.cad_tecidos[0].consumo_cad = 9;
    await act(async () => { FAKE.emitirRealtime("modelos"); });
    await aguardar(() => campoConsumo()?.value === "9,00", "re-seed do CAD após mudança do servidor");
    expect(campoConsumo()!.value).toBe("9,00");
  });
});

describe("F5a — somenteLeitura=false (padrão) segue IGUAL a hoje", () => {
  it("rodapé, cabeçalho e ações de hoje (Voltar · Ficha Técnica · Enviar · Salvar; Importar dados; Status no fluxo)", async () => {
    seed({ enviadoCad: false });
    await abrir({});
    expect(document.querySelector('[data-testid="dev-ro-rodape"]')).toBeNull();
    const rodape = document.querySelector<HTMLButtonElement>('button[aria-label="Voltar"]')!.parentElement!;
    const botoes = Array.from(rodape.querySelectorAll<HTMLButtonElement>("button")).map((b) => ({
      texto: (b.textContent ?? "").trim(), aria: b.getAttribute("aria-label"), disabled: b.disabled,
    }));
    // Retrato do rodapé de HOJE (base c065b055): Voltar · links "Para enviar, falta…" · Ficha Técnica (só após
    // Enviar) · Enviar (travado pelas pendências) · Salvar.
    expect(botoes).toEqual([
      { texto: "Voltar", aria: "Voltar", disabled: false },
      { texto: "Estilista", aria: null, disabled: false },
      { texto: "Categoria", aria: null, disabled: false },
      { texto: "ao menos 1 tecido com variante", aria: null, disabled: false },
      { texto: "Ficha Técnica", aria: "Imprimir Ficha Técnica", disabled: true },
      { texto: "Enviar", aria: null, disabled: true },
      { texto: "Salvar", aria: null, disabled: false },
    ]);
    const textos = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
    expect(textos).toContain("Importar dados");
    expect(document.body.textContent).toContain("Status no fluxo");
    expect(document.querySelector('[data-testid="dev-ro-ref"]')).toBeNull();
    expect(document.querySelector('[data-testid="dev-ro-etapa"]')).toBeNull();
    await abrirTodasSecoes();
    // Campos seguem editáveis (não enviado à Explosão) e o bloco de Observações segue com Adicionar.
    expect(campos().some((el) => !desabilitado(el))).toBe(true);
    expect(Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim())).toContain("Adicionar");
  });

  // M2 da revisão (28/set): o teste acima só prova o RETRATO do rodapé/campos, não que o
  // caminho editável ainda GRAVA. Uma regressão que deixasse `persistModelo`/`ModeloObservacoes`
  // no-op com `somenteLeitura=false` passaria pelo teste de cima sem ser percebida.
  it("Observações do bloco: o auto-save do onBlur grava modelo_observacoes.update (somenteLeitura=false)", async () => {
    seed({ enviadoCad: false });
    await abrir({});
    await abrirTodasSecoes();
    const campoDescricao = document.querySelector<HTMLInputElement>('input[placeholder="Descrição"]');
    expect(campoDescricao, "campo Descrição da Observação do bloco não encontrado").not.toBeNull();
    expect(desabilitado(campoDescricao!)).toBe(false);
    await digitar(campoDescricao!, "Lavagem a seco");
    await act(async () => {
      campoDescricao!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      campoDescricao!.dispatchEvent(new FocusEvent("blur"));
    });
    await esperar(50);
    expect(escritas().some((c) => c.op === "update" && c.tabela === "modelo_observacoes")).toBe(true);
  });

  it("Salvar: habilitado e dispara modelos.update + rpc:salvar_modelo_bom (somenteLeitura=false)", async () => {
    seed({ enviadoCad: false });
    await abrir({});
    const salvar = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").trim() === "Salvar")!;
    expect(salvar, "botão Salvar não encontrado").toBeTruthy();
    expect(salvar.disabled).toBe(false);
    await clicar(salvar);
    await esperar(100);
    expect(escritas().some((c) => c.op === "update" && c.tabela === "modelos")).toBe(true);
    expect(escritas().some((c) => c.op === "rpc" && c.tabela === "rpc:salvar_modelo_bom")).toBe(true);
  });
});
