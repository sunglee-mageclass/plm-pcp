import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ANTI-DRIFT — padrões v3 (docs/design/ui-padroes.md §Q). Scanner PURO sobre `src/`
// (fs síncrono, sem banco, sem servidor). Cada regra é um grep conservador — poucos
// falsos positivos — que caça valor solto fora do token/primitivo esperado pelo §Q.
//
// Onda 2 (ago/2026) varreu os hits e ligou o gate abaixo. Regras a/d/e em ZERO fora
// das exceções documentadas (regra a) — ver docs/design/ui-padroes.md §Q3.
// Regra (f) — hsl() cru (dataviz, §R) — adicionada e ZERADA na onda de Dashboard v2
// (ago/2026): cor de gráfico agora só via tokens --chart-* (src/lib/chart-colors.ts),
// mantendo a exceção de impressão (PrintBarChart usa hsl fixo de propósito).
// Regra (g) — moeda formatada à mão (§Q12, campanha tela-a-tela ago/2026) — adicionada e ZERADA
// migrando toda moeda (Intl.NumberFormat / toLocaleString currency / `R$ ${…toLocaleString}`) pra
// brl() de src/lib/format.ts. Escopo SÓ moeda (não número/percentual/markup, que são usos
// legítimos à mão sem 1:1 no format.ts); print reusa a exceção §Q3.
//
// Regras (h)/(i) — pass de consolidação (revisão adversarial, ago/2026) — REPORT-ONLY (contam
// no console.info, FORA do gate). (h) fonte abaixo do piso §Q5 (text-[Npx] N<11): o achado 4
// (3 StatusBadge do Planejamento com text-[9px]/[8px] + 2 chips text-[9px] do Dashboard Leadtime)
// FOI zerado, mas restam ~146 hits pré-existentes — 125× text-[10px] (o tamanho DE-FACTO do repo,
// incl. o próprio StatusBadge primitivo) + 21× text-[8/9px] densos em plan-tecido/produto-acabado/
// sidebar. Zerar tudo é campanha própria, não este pass — por isso (h) NÃO entra no gate (ligaria
// com 146 falhas). (i) born-empty §Q11/§D: MoneyInput de dinheiro sem placeholder — heurística
// MULTI-LINHA (as props da tag cruzam linhas, não é grep limpo linha-a-linha), report-only por
// definição/nunca gate.
const ANTIDRIFT_LIGADO = true;

const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(ROOT, "src");
const UI_DIR = path.join(SRC, "components", "ui");
const LIB_DIR = path.join(SRC, "lib");
const STYLES_CSS = path.join(SRC, "styles.css");

// Regra (a) — exceção de IMPRESSÃO (decisão do dono, onda 2 §Q3): componentes cujo
// propósito é gerar HTML impresso (.print-area) usam cores FIXAS de propósito (fundo
// sempre claro, tinta sempre escura) — nunca reagem a tema claro/escuro, então não
// fazem sentido como token semântico. Cada arquivo abaixo é 100% print (ou, quando
// mistura conteúdo interativo + print, teve o bloco de impressão EXTRAÍDO pra um
// arquivo dedicado só de print) — ver §Q3 pro racional completo por arquivo.
const EXCECAO_IMPRESSAO = [
  "src/components/producao/FichaHeader.tsx",
  "src/components/producao/FichaTecnica.tsx",
  "src/components/producao/OrdemServicoTerceirizados.tsx",
  "src/components/producao/RomaneioDirecionamento.tsx",
  "src/components/producao/cad/CadFichaCorte.tsx",
  "src/components/producao/cad/shared.tsx", // ModeloPhotoPrint
  "src/components/producao/cad/types.ts", // cellH/cell — estilo das tabelas do printável
  "src/components/shared/RelatorioPrint.tsx",
  "src/components/shared/EtiquetaLavagemArtigo.tsx", // EtiquetaLavagemArtigoPrint (mesmo arquivo)
  "src/components/oc-tecido/Rolos.tsx", // EtiquetaRolo — etiqueta de rolo p/ imprimir
  "src/components/shared/PrintBarChart.tsx", // PBar/PBar2 — gráfico de tamanho fixo p/ impressão
  "src/components/financeiro/ComprovantePagamentoPrint.tsx",
  "src/routes/_authenticated/pcp.oficina.$modeloId.tsx", // Ficha de Oficina — Impressão (PrintArea)
].map((p) => path.join(ROOT, p));

// Regra (a) — segunda exceção, NÃO impressão: cor literal que representa um valor de
// DADO real (não decoração de UI), onde forçar um token semântico do tema seria
// semanticamente ERRADO ou tecnicamente inviável:
//  - cor-hex.ts: dicionário nome-da-cor→hex do TECIDO/produto (swatch da variante) —
//    é a cor REAL da peça, não um acento de UI; não tem equivalente em --primary/
//    --success/etc. (isso mudaria a cor exibida do produto, não só o estilo).
//  - error-page.ts: página de fallback renderizada pelo Worker (src/start.ts,
//    src/server.ts) ANTES/fora do bundle React — não tem acesso a styles.css
//    (`:root`/`.dark`) nesse ponto, então precisa ser 100% autocontida.
const EXCECAO_DADO_REAL = [
  "src/lib/cor-hex.ts",
  "src/lib/error-page.ts",
].map((p) => path.join(ROOT, p));

const EXCECAO_COR = new Set([...EXCECAO_IMPRESSAO, ...EXCECAO_DADO_REAL]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

function isScannable(file: string): boolean {
  if (!/\.(ts|tsx)$/.test(file)) return false; // só código; styles.css cai fora sozinho
  if (file === STYLES_CSS) return false;
  if (file.startsWith(UI_DIR + path.sep)) return false; // shadcn gerado — fora de escopo
  if (/\.test\.[tj]sx?$/.test(file)) return false; // *.test.*
  if (path.resolve(file) === path.resolve(THIS_FILE)) return false; // o próprio teste
  return true;
}

const ALL_FILES = walk(SRC).filter(isScannable);
const FILES_NO_LIB = ALL_FILES.filter((f) => !f.startsWith(LIB_DIR + path.sep));
const FILES_SEM_EXCECAO_COR = ALL_FILES.filter((f) => !EXCECAO_COR.has(f));
// Regra (f) — hsl() cru. Mesmas exceções de cor (print/dado real) da regra (a) MAIS a fonte
// única de cor de gráfico src/lib/chart-colors.ts, que é a ÚNICA autorizada a nomear cor de
// dataviz (e ainda assim só referencia tokens var(--chart-*), nunca hsl solto). Ver §R.
const CHART_COLORS_TS = path.join(ROOT, "src/lib/chart-colors.ts");
const FILES_SEM_HSL = FILES_SEM_EXCECAO_COR.filter((f) => f !== CHART_COLORS_TS);
// Regra (g) — moeda formatada à mão. Fora de src/lib (fonte única = `brl()` em src/lib/format.ts,
// que o format.ts documenta: "não duplicar const brl por tela") E fora da exceção de impressão
// (§Q3 — comprovante/etiqueta/ficha imprimem com formato fixo). Print files reusam a exceção de cor.
const FILES_NO_LIB_SEM_PRINT = FILES_NO_LIB.filter((f) => !EXCECAO_COR.has(f));

// Linha de comentário (// … | JSDoc/bloco * … | abertura /* …) fica de fora do grep —
// reduz falso-positivo grosseiro (ex.: "(React #185)" batendo na regra de hex dentro
// de um comentário; JSDoc do DateField citando `<input type="date">` como o que NÃO
// fazer). Não cobre bloco `/* … */` sem `*` de continuação — aceitável, é raro no repo.
function stripComment(line: string): string {
  const t = line.trimStart();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
  return line;
}

type Hit = { file: string; line: number; text: string };
type RuleId = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";

const ICON_SIZES_OK = new Set([14, 16, 20, 24]);

const RULES: Record<RuleId, { label: string; files: string[]; find: (line: string) => string[] }> = {
  a: {
    label: "cor literal (#hex 3/6 díg ou oklch()) fora de src/components/ui/, styles.css e da exceção de impressão/dado real (§Q3)",
    files: FILES_SEM_EXCECAO_COR,
    find: (line) => {
      const m = line.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|oklch\(/g);
      return m ?? [];
    },
  },
  b: {
    label: '<input type="date"> (deveria ser <DateField> — @/components/shared/DateField)',
    files: ALL_FILES,
    find: (line) => {
      const m = line.match(/<input[^>]*\btype=["']date["']/g);
      return m ?? [];
    },
  },
  c: {
    label: "ícone lucide size={N} com N fora de {14,16,20,24}",
    files: ALL_FILES,
    find: (line) => {
      const out: string[] = [];
      for (const m of line.matchAll(/size=\{(\d+)\}/g)) {
        if (!ICON_SIZES_OK.has(Number(m[1]))) out.push(m[0]);
      }
      return out;
    },
  },
  d: {
    label: ".toFixed( fora de src/lib/ (usar fmtNum/brl/fmtNumEdit — src/lib/format.ts)",
    files: FILES_NO_LIB,
    find: (line) => {
      const m = line.match(/\.toFixed\(/g);
      return m ?? [];
    },
  },
  e: {
    label: "font-size fracionário arbitrário (text-[13.5px], fontSize: 13.5…)",
    files: ALL_FILES,
    find: (line) => {
      const m = line.match(/text-\[\d+\.\d+px\]|fontSize:\s*["']?\d+\.\d+/g);
      return m ?? [];
    },
  },
  f: {
    label: "hsl() cru fora de styles.css/chart-colors e da exceção de impressão/dado real (§R — usar tokens --chart-* via src/lib/chart-colors.ts)",
    files: FILES_SEM_HSL,
    find: (line) => {
      const m = line.match(/hsl\(/g);
      return m ?? [];
    },
  },
  g: {
    label:
      'moeda formatada à mão fora de src/lib (Intl.NumberFormat | toLocaleString com style:"currency" | `R$ ${…toLocaleString}`) — usar brl() de src/lib/format.ts (§Q12; format.ts: "não duplicar const brl por tela"). Só MOEDA: número/percentual/markup à mão são usos legítimos e ficam de fora.',
    files: FILES_NO_LIB_SEM_PRINT,
    find: (line) => {
      const out: string[] = [];
      // Intl.NumberFormat — no repo é SEMPRE moeda (style:"currency"); fonte única = brl()
      for (const m of line.matchAll(/Intl\.NumberFormat\(/g)) out.push(m[0]);
      // toLocaleString com style:"currency" (moeda montada via API do JS)
      for (const m of line.matchAll(/toLocaleString\([^)]*currency/g)) out.push(m[0]);
      // moeda montada à mão: literal "R$" seguido de .toLocaleString( na MESMA linha
      for (const m of line.matchAll(/R\$[^\n]*?toLocaleString\(/g)) out.push(m[0]);
      return out;
    },
  },
  h: {
    label:
      "fonte abaixo do piso §Q5 (menor token = 11px/--text-2xs): text-[Npx] com N<11 — REPORT-ONLY (text-[10px] é o tamanho de-facto do repo, 125×, incl. StatusBadge primitivo; débito grande, zerar é campanha própria)",
    files: FILES_SEM_EXCECAO_COR, // fora de src/components/ui/, print/§Q3 e cor-de-dado
    find: (line) => {
      const out: string[] = [];
      for (const m of line.matchAll(/text-\[(\d+)px\]/g)) {
        if (Number(m[1]) < 11) out.push(m[0]);
      }
      return out;
    },
  },
};

// Regras contadas no console.info mas FORA do gate: (h) débito pré-existente grande demais p/
// zerar sem campanha própria/regressão visual. Mover p/ o gate quando zerado.
const REPORT_ONLY = new Set<RuleId>(["h"]);

// Regra (i) — born-empty (§Q11/§D), REPORT-ONLY multi-linha: <MoneyInput> de dinheiro sem
// `placeholder` (nasce "0" em vez de vazio+placeholder). As props da tag cruzam várias linhas,
// então NÃO é grep limpo linha-a-linha — fica FORA do RULES (line-based) e nunca vira gate.
function scanMoneyBornEmpty(): Hit[] {
  const hits: Hit[] = [];
  for (const file of FILES_NO_LIB) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/<MoneyInput\b[\s\S]*?\/>/g)) {
      const tag = m[0];
      if (/placeholder=/.test(tag)) continue;
      const line = src.slice(0, m.index ?? 0).split("\n").length;
      hits.push({ file: path.relative(ROOT, file), line, text: tag.split("\n")[0].trim() + " …" });
    }
  }
  return hits;
}

function scanRule(id: RuleId): Hit[] {
  const rule = RULES[id];
  const hits: Hit[] = [];
  for (const file of rule.files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((raw, idx) => {
      const clean = stripComment(raw);
      if (!clean.trim()) return;
      const matches = rule.find(clean);
      for (const _ of matches) {
        hits.push({ file: path.relative(ROOT, file), line: idx + 1, text: raw.trim() });
      }
    });
  }
  return hits;
}

function fmtHits(hits: Hit[]): string {
  return hits.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join("\n");
}

// Sempre ativo — nunca falha. Roda o scanner e deixa o débito visível a cada `npm test`,
// independente do valor de ANTIDRIFT_LIGADO.
describe("ui-padroes anti-drift — scanner v3 (§Q)", () => {
  it("reporta a contagem de débito por regra (console.info, não falha)", () => {
    const counts: Record<string, number> = {};
    for (const id of Object.keys(RULES) as RuleId[]) counts[id] = scanRule(id).length;
    counts.i = scanMoneyBornEmpty().length; // regra (i) — fora do RULES (multi-linha)
    console.info(
      "[ui-padroes anti-drift §Q/§R] débito por regra:",
      JSON.stringify(counts),
      "\n  a = cor literal | b = <input type=date> | c = ícone size fora da escala | d = .toFixed fora de lib | e = font-size fracionário | f = hsl() cru (§R) | g = moeda à mão (§Q12)",
      "\n  h = fonte < piso 11px (§Q5, REPORT-ONLY) | i = MoneyInput sem placeholder (§Q11/§D, REPORT-ONLY)",
    );
    expect(Object.keys(counts).length).toBe(Object.keys(RULES).length + 1); // + regra (i)
  });
});

// Ligado (onda 3, ago/2026) — varredura completa; regra a respeita a exceção de
// impressão/dado real (§Q3). `describe.skipIf` fica como cinto de segurança pra
// religar rápido se um caso legítimo novo precisar de exceção temporária.
describe.skipIf(!ANTIDRIFT_LIGADO)("ui-padroes anti-drift — asserções (§Q, gate ATIVO)", () => {
  for (const id of Object.keys(RULES) as RuleId[]) {
    if (REPORT_ONLY.has(id)) continue; // report-only — débito pré-existente, contado no console.info, fora do gate
    const rule = RULES[id];
    it(`(${id}) ${rule.label}`, () => {
      const hits = scanRule(id);
      expect(hits, hits.length ? `\n${fmtHits(hits)}` : undefined).toEqual([]);
    });
  }
});
