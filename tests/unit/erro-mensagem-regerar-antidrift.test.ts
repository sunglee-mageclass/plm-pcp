// Regerar REF / Regerar SKUs - anti-drift das mensagens: todo prefixo `xxx:` que o SQL das 3 migrations pode mandar para a tela tem traducao em MENSAGENS_REGERAR,
// e toda traducao ainda existe no SQL. Roda so com as 3 migrations no repo (por isso nasce na Task do lote da loja).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MENSAGENS_REGERAR } from "@/lib/erro-mensagem";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SQL = [
  "20261201100000_regerar_pulo_integracao", "20261201110000_regerar_ref_card", "20261201120000_regerar_skus_loja",
].map((f) => readFileSync(ROOT + `supabase/migrations/${f}.sql`, "utf8")).join("\n");

const MENSAGENS_NO_SQL = [
  "previa_desatualizada: ref", "ref_manual_confirmar: a REF foi digitada a mao - confirme a troca", "limite_pagina: a pagina aceita de 1 a 50 produtos",
  "itens_invalidos: envie de 1 a 50 produtos, sem repetir", "loja_mudou: a loja ativa mudou - recarregue a pagina",
  "sem_permissao_admin: so o administrador da loja regera os SKUs", "sem_permissao_modelo: modelo fora da loja", "loja_inativa: operacao nao permitida",
  "nao_autenticado: login necessario",
];

describe("erro-mensagem - anti-drift contra as migrations do Regerar REF / Regerar SKUs", () => {
  it("toda mensagem fixa existe no SQL; o prefixo dinamico ref_<motivo> e os 6 motivos tambem", () => {
    for (const m of MENSAGENS_NO_SQL) expect(SQL, m).toContain(`'${m}`);
    expect(SQL).toContain("'ref_%: nao da para regerar a REF deste card'");
    const motivos = [...SQL.matchAll(/'motivo', '([a-z_]+)'|WHEN 'integracao' THEN '([a-z_]+)' ELSE '([a-z_]+)'/g)].flatMap((m) => [m[1], m[2], m[3]]).filter(Boolean);
    for (const mot of ["nao_interno", "nao_revelada", "sem_sigla", "sem_numero", "pulado_integracao", "pulado_exportado"]) {
      expect(motivos, mot).toContain(mot);
      expect(Object.keys(MENSAGENS_REGERAR), mot).toContain(`ref_${mot}`);
    }
  });
  it("todo RAISE novo com prefixo `xxx: ` tem traducao (ou e guarda de migration / ja traduzido por outra frente)", () => {
    const prefixos = new Set([...SQL.matchAll(/RAISE EXCEPTION '([a-z_]+): /g)].map((m) => m[1])
      // guardas de migration (nao chegam a tela) | ja traduzidos por outra frente: P0002 nao_encontrado (B3), 42501 sem_permissao_pagina (S3) e nao_autenticado (S1)
      .filter((p) => !["regerar_pulo", "regerar_ref", "regerar_loja", "nao_encontrado", "sem_permissao_pagina", "nao_autenticado"].includes(p)));
    for (const p of prefixos) {
      const chave = p === "previa_desatualizada" ? "previa_desatualizada_ref" : p;
      expect(Object.keys(MENSAGENS_REGERAR).some((k) => k === chave || k.startsWith(p + "_")), p).toBe(true);
    }
  });
});
