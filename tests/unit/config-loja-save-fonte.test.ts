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
});
