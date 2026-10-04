// Reforço de segurança S3d — anti-drift banco × tela: (1) markup e preço fixo do comprado no Sheet (PrecoRevendaBloco) travam com o
// MESMO OU do servidor (Produto Acabado OU a seção "Editar preço de venda"); (2) toda chave passada ao _seg_exige_pagina pela S3d
// existe no catálogo e tem rótulo; (3) a S3d não traz prefixo de RAISE novo sem tradução (só o sem_permissao_pagina da S3a).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALL_PAGE_KEYS } from "@/lib/permissions-catalog";
import { rotuloPaginaPermissao } from "@/lib/erro-mensagem";
import { S3D_PAGINAS } from "../integration/seg-s3d-dados";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (dir: string, re: RegExp) =>
  readdirSync(ROOT + dir).filter((f) => re.test(f)).sort().map((f) => readFileSync(ROOT + dir + "/" + f, "utf8")).join("\n");
const IDA = ler("supabase/migrations", /^202611012[01]0000_seg_s3d_.*\.sql$|^20261101190000_seg_s3d_.*\.sql$/);
const VOLTA = ler("supabase/rollback", /^202611012[01]0000_seg_s3d_.*_down\.sql$|^20261101190000_seg_s3d_.*_down\.sql$/);
const prefixos = (sql: string) => new Set([...sql.matchAll(/RAISE EXCEPTION '([a-z_]+): /g)].map((m) => m[1]));
const src = (rel: string) => readFileSync(ROOT + rel, "utf8");

describe("S3d — preço/markup do comprado no Sheet = o OU do servidor", () => {
  it("o servidor exige Produto Acabado OU a seção de preço; a tela trava os 4 inputs pela mesma regra", () => {
    for (const sig of ["public.salvar_precos_fixo_produto_acabado(uuid,boolean,numeric,boolean,numeric)", "public.salvar_markups_produto_acabado(uuid,numeric,numeric)"]) {
      expect([...S3D_PAGINAS[sig]].sort(), sig).toEqual(["criacao_planejamento:preco_venda", "criacao_produto_acabado"]);
    }
    expect(src("src/components/planejamento/PlanejamentoDetail.tsx"))
      .toContain('const podeEditarPrecoComprado = canEdit("criacao_planejamento:preco_venda") || canEdit("criacao_produto_acabado");');
    const bloco = src("src/components/planejamento/planejamento-detail/RevendaSetores.tsx");
    expect(bloco.match(/disabled=\{planBloqueado \|\| !podeEditarPrecoComprado/g)?.length).toBe(4);
  });
});

describe("S3d — anti-drift banco × catálogo", () => {
  it("toda chave passada ao _seg_exige_pagina na S3d existe no catálogo e tem rótulo", () => {
    expect(IDA.length).toBeGreaterThan(0);
    const chamadas = [...IDA.matchAll(/_seg_exige_pagina\(([^;]*)\);/g)].map((m) => m[1]);
    expect(chamadas.length).toBeGreaterThanOrEqual(39 + 3);
    const chaves = new Set(chamadas.flatMap((a) => [...a.matchAll(/'([a-z0-9_:]+)'/g)].map((m) => m[1])).filter((k) => k.includes("_") || k === "importar"));
    expect(chaves.size).toBeGreaterThanOrEqual(8);
    for (const k of chaves) {
      expect(ALL_PAGE_KEYS, k).toContain(k);
      expect(rotuloPaginaPermissao(k).modulo, k).not.toBe("");
    }
  });
  it("a S3d não traz prefixo de RAISE novo (s3d_* = guardas de deploy)", () => {
    const antes = prefixos(VOLTA);
    expect([...prefixos(IDA)].filter((p) => !antes.has(p) && !p.startsWith("s3d_"))).toEqual([]);
  });
});
