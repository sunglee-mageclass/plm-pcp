// Reforço de segurança S2: as recusas ASCII com prefixo novas (Financeiro por aba, módulo Financeiro) viram texto PT na tela.
// Os RAISE abaixo são os EXATOS do banco (migrations 20261031200000..220000); a última asserção confere, nos dois sentidos, que
// todo prefixo NOVO do SQL (o que está na ida e não estava no texto de antes, guardado nos inversos) tem tradução e que toda
// tradução ainda existe no SQL (anti-drift banco × tela).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mensagemErro, MENSAGENS_SEG_S2 } from "@/lib/erro-mensagem";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (dir: string, re: RegExp) =>
  readdirSync(ROOT + dir).filter((f) => re.test(f)).map((f) => readFileSync(ROOT + dir + "/" + f, "utf8")).join("\n");
const IDA = ler("supabase/migrations", /^202610312[0-2]0000_seg_s2_.*\.sql$/);
const VOLTA = ler("supabase/rollback", /^202610312[0-2]0000_seg_s2_.*_down\.sql$/);
const prefixos = (sql: string) => new Set([...sql.matchAll(/RAISE EXCEPTION '([a-z_]+): /g)].map((m) => m[1]));

const CASOS: [string, string, string][] = [
  ["42501", "financeiro_sem_permissao: sem permissao para editar parcelas de OC (Financeiro, abas OCs ou Calendario)",
    MENSAGENS_SEG_S2.financeiro_sem_permissao],
  ["42501", "financeiro_servicos_sem_permissao: sem permissao para editar parcelas de Servicos (Financeiro, aba Servicos)",
    MENSAGENS_SEG_S2.financeiro_servicos_sem_permissao],
  ["42501", "modulo_financeiro_desligado: o modulo Financeiro nao esta habilitado para esta loja", MENSAGENS_SEG_S2.modulo_financeiro_desligado],
];

describe("erro-mensagem — Reforço de segurança S2", () => {
  it.each(CASOS)("%s %s", (code, message, esperado) => {
    expect(mensagemErro({ code, message }, "fallback")).toBe(esperado);
  });

  it("anti-drift: toda mensagem dos CASOS existe no SQL e todo RAISE NOVO com prefixo tem caso", () => {
    expect(IDA.length).toBeGreaterThan(0);
    for (const [, message] of CASOS) expect(IDA, message).toContain(`'${message}'`);
    const antes = prefixos(VOLTA);
    const novos = [...prefixos(IDA)].filter((p) => !antes.has(p)).filter((p) => !p.startsWith("s2_")); // s2_* = guardas de deploy
    const comCaso = new Set(CASOS.map(([, m]) => m.split(":")[0]));
    expect(novos.filter((p) => !comCaso.has(p))).toEqual([]);
    expect([...comCaso].filter((p) => !novos.includes(p))).toEqual([]);
  });

  it("o mesmo prefixo com o código errado não é traduzido por engano; 42501 genérico de grant segue a mensagem padrão", () => {
    expect(mensagemErro({ code: "P0001", message: "financeiro_sem_permissao: x" }, "fb")).toBe("financeiro_sem_permissao: x");
    expect(mensagemErro({ code: "42501", message: "permission denied for table parcelas" }, "fb")).toBe(
      "Você não tem permissão para esta ação.",
    );
  });
});
