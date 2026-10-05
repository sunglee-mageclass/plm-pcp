import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Config da Loja colaborativa — T3 (gate de FONTE, sem montar a tela). O Salvar principal de
// `admin/configuracoes.tsx` grava SÓ pela RPC `salvar_config_loja` (compare-and-set por coluna) e as
// travas do P-57 A seguem no botão. Se alguém reintroduzir o upsert da linha inteira (ou o update
// do kanban em outra transação), ou apagar uma trava, este teste falha.
const s = readFileSync(
  fileURLToPath(new URL("../../src/routes/_authenticated/admin/configuracoes.tsx", import.meta.url)),
  "utf8",
);

// Corpo do componente da página (o Salvar principal) — do `function ConfiguracoesLojaPage` até a
// próxima função de topo. O diálogo "Nomenclaturas" (T5) mora FORA deste trecho.
const inicio = s.indexOf("function ConfiguracoesLojaPage()");
const fim = s.indexOf("\nfunction ", inicio + 10);
const pagina = s.slice(inicio, fim);

describe("Config da Loja — Salvar principal (T3, fonte)", () => {
  it("o trecho da página foi encontrado", () => {
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
    expect(pagina).toContain("const save = useMutation({");
  });

  it("sem upsert/update direto em tenant_config no save principal (só a RPC)", () => {
    expect(pagina).not.toMatch(/\.from\(\s*["']tenant_config["']\s*\)\s*\.(upsert|update)\(/);
    expect(pagina).not.toMatch(/\.upsert\(/);
    expect(pagina).not.toMatch(/\.update\(/);
    expect(pagina).not.toContain("geralOk");
    expect(pagina).toContain('supabase.rpc("salvar_config_loja"');
    expect(pagina).toContain("montarMudancas({");
  });

  it("Salvar travado sem hidratar, sem loja e com conflito pendente — com o comentário P-57 A", () => {
    const m = pagina.match(/onClick=\{prepararSalvar\}\s*disabled=\{([^}]*)\}/);
    expect(m).not.toBeNull();
    const cond = m![1];
    expect(cond).toContain("!hydrated");
    expect(cond).toContain("!data?.tenantId");
    expect(cond).toContain("conflitosPendentes.length > 0");
    expect(cond).toContain("save.isPending");
    const antes = pagina.slice(Math.max(0, pagina.indexOf("onClick={prepararSalvar}") - 1200), pagina.indexOf("onClick={prepararSalvar}"));
    expect(antes).toContain("P-57 A");
  });

  it("mantém as garantias D19 (prévia) e a proteção do kanban em voo", () => {
    expect(pagina).toContain("diffMudouDesdeAPrevia(diffEsperadoRef.current, diff)");
    expect(pagina).toContain("kanbanProtegidoRef.current = true");
    expect(pagina).toContain("_chave_kanban_esperada");
  });

  it("P0409 tratados: conflito_versao (refetch + conflitos + toast com rótulos) e chave_kanban_mudou", () => {
    expect(pagina).toContain('msg.startsWith("conflito_versao: config_loja")');
    expect(pagina).toContain("colunasDoErro(e)");
    expect(pagina).toContain("agora há pouco. Confira os itens em destaque e salve de novo.");
    expect(pagina).toContain('msg.startsWith("chave_kanban_mudou:")');
    expect(pagina).toContain("toast.error(MENSAGEM_CHAVE_KANBAN_MUDOU)");
    expect(pagina).toContain("refetchCfg()");
  });

  it("T4: presença por loja, banner com resolução e checagem de 'nada mudou' antes da confirmação", () => {
    expect(pagina).toContain("canal: data?.tenantId ? `colab:config-loja:${data.tenantId}` : null");
    // Fix round pós-QA (achado #8): o overlay da PÁGINA ganhou `abaixoDeModal` (fica abaixo do
    // z-50 de Dialog/Sheet/AlertDialog abertos por cima — ex. Nomenclaturas) — segue sendo o MESMO
    // `<ColabPresenceOverlay>`, só com a prop nova.
    expect(pagina).toContain("<ColabPresenceOverlay presentes={presentesNoBloco} scopeRef={colabScopeRef} abaixoDeModal />");
    expect(pagina).toMatch(/<ColabBanner[\s\S]*onResolver=\{resolverConflito\}[\s\S]*rotulo=\{rotuloColuna\}/);
    const prep = pagina.slice(pagina.indexOf("const prepararSalvar = async"), pagina.indexOf("setConfirmSalvar(true)", pagina.indexOf("const prepararSalvar = async")));
    expect(prep).toContain('toast.info("Nenhuma alteração para salvar.")');
  });

  it("T5: nenhum upsert/update direto de tenant_config em TODO o arquivo (Nomenclaturas também vai pela RPC)", () => {
    expect(s).not.toMatch(/\.from\(\s*["']tenant_config["']\s*\)\s*\.(upsert|update)\(/);
    expect(s).not.toMatch(/\.upsert\(/);
    const dlg = s.slice(s.indexOf("function NomesDasAbasDialog("));
    expect(dlg).toContain('supabase.rpc("salvar_config_loja"');
    expect(dlg).toContain("mesclarNomes(");
    expect(dlg).toContain("colunasDoErro(error, COLUNAS_NOMENCLATURAS)");
    expect(dlg).toContain('queryKey: ["tenant_config", "nomenclaturas_edit", tenantId]');
    expect(dlg).toMatch(/disabled=\{saveMut\.isPending \|\| !hydrated \|\| conflitos\.length > 0\}/);
    expect(dlg).toContain("<ColabPresenceOverlay presentes={presentesNaJanela} scopeRef={corpoRef} />");
  });

  it("revisão T3/T4: M2 (conflito pendente barra no handler), I1 (loja do save), M1 (colunas em voo)", () => {
    expect(pagina).toContain("if (conflitosRef.current.length > 0) {");
    // Fix round pós-QA (L3): a guarda M2 virou uma recusa MARCADA (`conflitoEsperado`/
    // `fecharDialogoKanban`), não um `throw new Error(...)` cru — o onError agora fecha o
    // KanbanSalvarDialog/AlertDialog quando ela dispara com a prévia aberta (achado QA (d)).
    expect(pagina).toContain("conflitoEsperado: true, kanbanEmConflito");
    expect(pagina).toContain("if (e?.conflitoEsperado) {");
    expect(pagina).toContain("onMutate: () => ({ tenantId: data?.tenantId ?? null })");
    expect(pagina).toContain("ctx?.tenantId !== cfgBaseTenantRef.current");
    expect(pagina).toContain("emVooRef.current = new Set(Object.keys(mudancas))");
    expect(pagina).not.toContain("salvandoRef");
  });
  // urg R2 T11: card "Insumos padrão" participa do Salvar colaborativo (coluna 17) como os outros blocos.
  it("T11: Insumos padrão - estado, leitura CRUA do servidor, anel/presença por bloco e trava do Salvar", () => {
    expect(s).toContain("insumos_padrao: [] as InsumoPadrao[]");
    expect(s).toContain("insumos_padrao: normalizarInsumosPadrao((r as any).insumos_padrao)");
    expect(s).toContain('insumos_padrao: "cfg:insumos_padrao"');
    // o card mora logo depois de "Planejamento — análise de markup" e antes de Nomenclaturas
    const iMarkup = s.indexOf("Planejamento — análise de markup</CardTitle>");
    const iCard = s.indexOf("<InsumosPadraoCard");
    const iNomen = s.indexOf('<Card data-colab-path="cfg:nomenclaturas">');
    expect(iMarkup).toBeGreaterThan(0);
    expect(iCard).toBeGreaterThan(iMarkup);
    expect(iNomen).toBeGreaterThan(iCard);
    expect(s).toContain("anelConflito={anelConflito}");
    // Salvar travado quando a lista tocada tem linha com problema (órfã/duplicada/consumo) - o servidor recusaria
    const m = pagina.match(/onClick=\{prepararSalvar\}\s*disabled=\{([^}]*)\}/);
    expect(m![1]).toContain("insumosPadraoBloqueiaSalvar");
    // a base é a CRUA (colunasCruas) e o hydrated cobre o catálogo
    expect(pagina).toContain("colunasCruas(data.cfg");
    expect(pagina).toContain("catalogoInsumosPronto");
  });
});
