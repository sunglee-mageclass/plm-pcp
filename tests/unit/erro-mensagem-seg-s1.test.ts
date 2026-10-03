// Reforço de segurança S1: as recusas ASCII com prefixo das guardas novas viram texto PT na tela. Os RAISE abaixo são
// os EXATOS do banco (migrations 20261031100000..150000); a última asserção confere, nos dois sentidos, que todo prefixo
// novo do SQL tem tradução e que toda tradução ainda existe no SQL (anti-drift banco × tela).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mensagemErro, MENSAGENS_SEG_S1, TEXTO_SESSAO_EXPIRADA } from "@/lib/erro-mensagem";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SQL = readdirSync(ROOT + "supabase/migrations")
  .filter((f) => /^202610311[0-5]0000_seg_s1_.*\.sql$/.test(f))
  .map((f) => readFileSync(ROOT + "supabase/migrations/" + f, "utf8"))
  .join("\n");

const CASOS: [string, string, string][] = [
  ["42501", "usuario_proprio: nao e permitido alterar o proprio papel, status, e-mail ou id", MENSAGENS_SEG_S1.usuario_proprio],
  ["42501", "explosao_protegida: o envio a Explosao so muda pelos botoes Enviar a Explosao / Voltar ao Desenvolvimento",
    MENSAGENS_SEG_S1.explosao_protegida],
  ["P0001", "ordem_com_explosao: o card ja foi enviado a Explosao - a Ordem de Criacao nao pode ser cancelada",
    MENSAGENS_SEG_S1.ordem_com_explosao],
  ["P0001", "cad_sem_ordem: envie a Ordem de Criacao antes de gravar o CAD", MENSAGENS_SEG_S1.cad_sem_ordem],
  ["42501", "preco_comprado_derivado: o preco de venda do comprado vem do markup ou do preco fixo do produto",
    MENSAGENS_SEG_S1.preco_comprado_derivado],
  ["42501", "preco_anterior_sem_permissao: sem permissao para editar o preco anterior", MENSAGENS_SEG_S1.preco_anterior_sem_permissao],
  ["42501", "modulo_producao_desligado: o modulo Producao nao esta habilitado para esta loja", MENSAGENS_SEG_S1.modulo_producao_desligado],
  ["42501", "sem_permissao_cq: sem permissao para editar o Controle de Qualidade", MENSAGENS_SEG_S1.sem_permissao_cq],
  ["42501", "nao_autenticado: faca login de novo", TEXTO_SESSAO_EXPIRADA],
  ["P0001", "cad_nao_encontrado: CAD nao encontrado nesta loja", MENSAGENS_SEG_S1.cad_nao_encontrado],
];

describe("erro-mensagem — Reforço de segurança S1", () => {
  it.each(CASOS)("%s %s", (code, message, esperado) => {
    expect(mensagemErro({ code, message }, "fallback")).toBe(esperado);
  });

  it("anti-drift: toda mensagem dos CASOS existe no SQL e todo RAISE novo com prefixo tem caso", () => {
    for (const [, message] of CASOS) expect(SQL, message).toContain(`'${message}'`);
    const novos = [...SQL.matchAll(/RAISE EXCEPTION '([a-z_]+): /g)].map((m) => m[1])
      .filter((p) => !p.startsWith("s1_")) // s1_* = guardas da própria migration (deploy), não chegam à tela
      .filter((p) => p !== "reprovado_explosao"); // pré-existente no texto redefinido (L3), já traduzido em mensagemLevesL3
    const comCaso = new Set(CASOS.map(([, m]) => m.split(":")[0]));
    expect([...new Set(novos)].filter((p) => !comCaso.has(p))).toEqual([]);
  });

  it("o mesmo prefixo com o código errado não é traduzido por engano", () => {
    expect(mensagemErro({ code: "P0001", message: "usuario_proprio: x" }, "fb")).toBe("usuario_proprio: x");
  });
});
