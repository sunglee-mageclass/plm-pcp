// Reforço de segurança S3b — P-245 A: "Marcar verificado" do #Erro (PCP Serviços, CQ, Direcionamento, Lançamentos, Oficina) GRAVA
// e exige EDITAR a página da etapa no servidor (marcar_etapa_verificada, 20261101130000); para quem só VÊ, o botão SOME (o aviso
// do #Erro continua). Render real do banner (react-dom/server) + anti-drift do mapa etapa → página contra a migration e o gerador.
// Também confere que toda chave de página que a S3b passa ao _seg_exige_pagina existe no catálogo e que a S3b não trouxe prefixo de
// RAISE novo sem tradução.
import { describe, it, expect, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { VerificarRevisaoBanner, PAGINAS_POR_ETAPA, PAGINAS_ETAPA_OUTRA, paginasDaEtapa, podeVerificarEtapa } from "@/components/producao/RevisaoErro";
import { ALL_PAGE_KEYS } from "@/lib/permissions-catalog";
import { rotuloPaginaPermissao } from "@/lib/erro-mensagem";
import { S3B_ETAPAS, S3B_ETAPA_OUTRA } from "../integration/seg-s3b-dados";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (dir: string, re: RegExp) =>
  readdirSync(ROOT + dir).filter((f) => re.test(f)).map((f) => readFileSync(ROOT + dir + "/" + f, "utf8")).join("\n");
const IDA = ler("supabase/migrations", /^202611011[3-5]0000_seg_s3b_.*\.sql$/);
const VOLTA = ler("supabase/rollback", /^202611011[3-5]0000_seg_s3b_.*_down\.sql$/);
const prefixos = (sql: string) => new Set([...sql.matchAll(/RAISE EXCEPTION '([a-z_]+): /g)].map((m) => m[1]));
const render = (podeVerificar: boolean) => renderToStaticMarkup(h(VerificarRevisaoBanner, { podeVerificar, onVerificar: () => {} }));

describe("Verificar #Erro — só quem edita a etapa (P-245 A)", () => {
  it("quem edita vê o botão; quem só vê NÃO vê botão nenhum, mas o aviso do #Erro continua", () => {
    expect(render(true)).toContain("Marcar verificado</button>");
    const leitura = render(false);
    expect(leitura).not.toContain("<button");
    expect(leitura).not.toContain("Marcar verificado");
    expect(leitura).toContain("#Erro — revisão pendente.");
  });

  it("mapa etapa → página = o do servidor (gerador + migration), inclusive o OU de 'outra etapa'", () => {
    expect(Object.fromEntries(Object.entries(PAGINAS_POR_ETAPA).map(([k, v]) => [k, [...v]]))).toEqual(S3B_ETAPAS);
    expect([...PAGINAS_ETAPA_OUTRA].sort()).toEqual([...S3B_ETAPA_OUTRA].sort());
    for (const [etapa, paginas] of Object.entries(S3B_ETAPAS)) {
      expect(IDA, etapa).toContain(`WHEN '${etapa}' THEN ARRAY[${paginas.map((p) => `'${p}'`).join(", ")}]`);
    }
    expect(paginasDaEtapa("cad")).toEqual(PAGINAS_ETAPA_OUTRA);
    expect(podeVerificarEtapa("cq", (p) => p === "producao_cq")).toBe(true);
    expect(podeVerificarEtapa("cq", (p) => p === "producao_terceirizados")).toBe(false);
    expect(podeVerificarEtapa("terceirizados", () => false)).toBe(false);
    expect(podeVerificarEtapa("kanban", (p) => p === "criacao_planejamento")).toBe(true);
  });

  it("o componente usa o banner com a regra (não um botão solto)", () => {
    const src = readFileSync(ROOT + "src/components/producao/RevisaoErro.tsx", "utf8");
    expect(src).toMatch(/const podeVerificar = podeVerificarEtapa\(etapa, canEdit\);/);
    expect(src).toMatch(/<VerificarRevisaoBanner podeVerificar=\{podeVerificar\}/);
    expect(src.match(/\/> Marcar verificado/g)?.length).toBe(1); // o botão só existe no banner
  });
});

describe("S3b — anti-drift banco × tela", () => {
  it("toda chave passada ao _seg_exige_pagina na S3b existe no catálogo e tem rótulo", () => {
    const chamadas = [...IDA.matchAll(/_seg_exige_pagina\(([^;]*)\);/g)].map((m) => m[1]);
    expect(chamadas.length).toBeGreaterThanOrEqual(17 + 4);
    const chaves = new Set(chamadas.flatMap((a) => [...a.matchAll(/'([a-z0-9_:]+)'/g)].map((m) => m[1])).filter((k) => k.includes("_")));
    expect(chaves.size).toBeGreaterThanOrEqual(9);
    for (const k of chaves) {
      expect(ALL_PAGE_KEYS, k).toContain(k);
      expect(rotuloPaginaPermissao(k).modulo, k).not.toBe("");
    }
  });
  it("a S3b não traz prefixo de RAISE novo (só o sem_permissao_pagina do helper da S3a, já traduzido)", () => {
    const antes = prefixos(VOLTA);
    expect([...prefixos(IDA)].filter((p) => !antes.has(p)).filter((p) => !p.startsWith("s3b_"))).toEqual([]);
  });
});
