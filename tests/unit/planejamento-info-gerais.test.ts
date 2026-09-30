import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// F3.6 (Parte B — spec 2026-09-25 §5.1): seção 1 = L1 Status|Estilista|Origem · L2 Nome 50%|Versão 25%|NCM 25% · L3 Grupo…
// Sub2 · L4 Título para a página · L5 Descrição · L6 Peso|Comprimento|Largura|Altura. Gate de FONTE (sem testing-library).
const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const IG = "src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx";

describe("InfoGeraisSecao (fonte)", () => {
  const s = fonte(IG);
  it("L1 sem o Nome; L2 = Nome | Versão | NCM em 2fr/1fr/1fr", () => {
    const iL2 = s.indexOf("sm:grid-cols-[2fr_1fr_1fr]");
    expect(iL2).toBeGreaterThan(s.indexOf("<Label>Origem</Label>"));
    const l2 = s.slice(iL2, s.indexOf('label="Grupo"'));
    expect(l2.indexOf('label="Nome do Modelo"')).toBeGreaterThan(0);
    expect(l2.indexOf("<Label>Versão</Label>")).toBeGreaterThan(l2.indexOf('label="Nome do Modelo"'));
    expect(l2.indexOf("NCM do Produto")).toBeGreaterThan(l2.indexOf("<Label>Versão</Label>"));
    expect(s.slice(0, iL2)).not.toContain('label="Nome do Modelo"');
  });
  it("NCM: texto simples, placeholder do formato, filtro dígitos/pontos, data-colab-path", () => {
    expect(s).toContain('placeholder="0000.00.00"');
    expect(s).toContain("filtrarNcm(e.target.value)");
    expect(s).toContain('data-colab-path="ncm"');
  });
  // P8 (fix1) — SEM `maxLength` no <Input> do NCM: ele cortava o texto COLADO antes de `filtrarNcm` rodar
  // (ex.: "NCM: 6204.43.00" virava "6204." — o prefixo já consumia os 10 caracteres). `filtrarNcm` já limita a 10.
  it("NCM: o <Input> NÃO tem maxLength (cortava o texto colado antes do filtro)", () => {
    const iNcm = s.indexOf('id="ncm-produto"');
    const iFimTag = s.indexOf("/>", iNcm);
    const tagNcm = s.slice(iNcm, iFimTag);
    expect(tagNcm).not.toContain("maxLength");
  });
  it("L4 Título entre as subcategorias e a Descrição, com badge automático, ↺ e o hint do mockup", () => {
    const iSub2 = s.indexOf('label="Subcategoria 2"');
    const iTit = s.indexOf('<Label htmlFor="titulo-pagina">Título para a página</Label>');
    const iDesc = s.indexOf("<Label>Descrição do produto</Label>");
    expect(iTit).toBeGreaterThan(iSub2);
    expect(iDesc).toBeGreaterThan(iTit);
    expect(s).toContain('data-colab-path="titulo_pagina"');
    // P-155 B + R4: o automático vem de `tituloAutomatico` (v2+ = o HERDADO da versão anterior; v1 = o calculado do
    // Nome do rascunho + a loja) — é com ele que o "digitou igual ao automático" compara.
    expect(s).toContain("const autoTitulo = tituloAutomaticoDe(versaoAnterior, draft.nome, nomeLoja);");
    expect(s).toContain("const tituloCalculado = autoTitulo.valor;");
    expect(s).toContain("Na v2+, segue o Título da versão anterior enquanto ninguém editar; na v1, o Nome do Modelo + o nome da loja. Editado à mão, fica fixo até clicar em ↺.");
    // Dono 26/set: a explicação é hover (InfoHover ao lado do rótulo), nunca texto fixo embaixo do campo.
    expect(s).toMatch(/<InfoHover ariaLabel="Como funciona o Título para a página\?">\s*<p>Na v2\+, segue o Título/);
    expect(s).not.toContain('<p className="text-xs text-muted-foreground">Acompanha o Nome do Modelo');
    // selo "herdado da vN" (v2+) / "automático" (v1) e o campo travado enquanto a versão anterior carrega
    expect(s).toContain("{seloTitulo(autoTitulo)}");
    expect(s).toContain('disabled={planBloqueado || trava.has("titulo_pagina") || versaoAnteriorCarregando}');
    expect(s).toContain('aria-label="Título: voltar ao automático"');
  });
  it("L6 Peso/medidas DEPOIS da Descrição: MoneyInput com casas 3/2, placeholder e data-colab-path por campo (NULL = vazio)", () => {
    const iDesc = s.indexOf("<Label>Descrição do produto</Label>");
    expect(s.indexOf("MEDIDAS.map(")).toBeGreaterThan(iDesc);
    for (const t of ['"Peso (kg)"', '"Comprimento (cm)"', '"Largura (cm)"', '"Altura (cm)"']) expect(s).toContain(t);
    expect(s).toContain("decimals={m.casas}");
    expect(s).toContain("placeholder={m.placeholder}");
    expect(s).toContain("data-colab-path={m.key}");
    expect(s).toContain("numeroDoInput(e.target.value)");
  });
  it("R28 — o 'i' com hover da Origem (adb57add) FICA: MotivosOrigemInfo + InfoHover; o <p> antigo do motivo não volta", () => {
    expect(s).toContain("<MotivosOrigemInfo opcoes={origemOpcoes} />");
    expect(s).toContain('import { InfoHover } from "@/components/shared/InfoHover";');
    expect(s).toContain("function MotivosOrigemInfo(");
    expect(s).not.toMatch(/origemOpcoes\.find\(\(o\) => o\.disabled && o\.motivo\)\?\.motivo/);
  });
  it("o orquestrador passa o nome da loja (tenants.nome)", () => {
    expect(fonte("src/components/planejamento/PlanejamentoDetail.tsx")).toMatch(/<InfoGeraisSecao[\s\S]*?nomeLoja=\{nomeLoja\}/);
  });
});
