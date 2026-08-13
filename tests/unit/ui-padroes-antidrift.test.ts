import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ANTI-DRIFT — padrões v3 (docs/design/ui-padroes.md §Q). Scanner PURO sobre `src/`
// (fs síncrono, sem banco, sem servidor). Cada regra é um grep conservador — poucos
// falsos positivos — que caça valor solto fora do token/primitivo esperado pelo §Q.
//
// §Q ainda não tem tokens/componentes implementados (é só a cartilha aprovada como
// direção). Ligar as asserções abaixo SÓ depois da implementação v3 + limpeza do
// legado — até lá, o repo reprovaria em massa por débito conhecido e não por bug novo.
const ANTIDRIFT_LIGADO = false;

const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(ROOT, "src");
const UI_DIR = path.join(SRC, "components", "ui");
const LIB_DIR = path.join(SRC, "lib");
const STYLES_CSS = path.join(SRC, "styles.css");

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
type RuleId = "a" | "b" | "c" | "d" | "e";

const ICON_SIZES_OK = new Set([14, 16, 20, 24]);

const RULES: Record<RuleId, { label: string; files: string[]; find: (line: string) => string[] }> = {
  a: {
    label: "cor literal (#hex 3/6 díg ou oklch()) fora de src/components/ui/ e styles.css",
    files: ALL_FILES,
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
};

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
// mesmo com ANTIDRIFT_LIGADO=false.
describe("ui-padroes anti-drift — scanner v3 (§Q)", () => {
  it("reporta a contagem de débito por regra (console.info, não falha)", () => {
    const counts: Record<RuleId, number> = { a: 0, b: 0, c: 0, d: 0, e: 0 };
    for (const id of Object.keys(RULES) as RuleId[]) counts[id] = scanRule(id).length;
    console.info(
      "[ui-padroes anti-drift §Q] débito por regra:",
      JSON.stringify(counts),
      "\n  a = cor literal | b = <input type=date> | c = ícone size fora da escala | d = .toFixed fora de lib | e = font-size fracionário",
    );
    expect(Object.keys(counts).length).toBe(Object.keys(RULES).length);
  });
});

// Ligar após implementação v3 + limpeza do legado (ANTIDRIFT_LIGADO = true).
describe.skipIf(!ANTIDRIFT_LIGADO)("ui-padroes anti-drift — asserções (§Q, desligado até v3)", () => {
  for (const id of Object.keys(RULES) as RuleId[]) {
    const rule = RULES[id];
    it(`(${id}) ${rule.label}`, () => {
      const hits = scanRule(id);
      expect(hits, hits.length ? `\n${fmtHits(hits)}` : undefined).toEqual([]);
    });
  }
});
