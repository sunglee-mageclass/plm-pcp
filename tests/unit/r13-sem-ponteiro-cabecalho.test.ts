/**
 * R13 — anti-drift do PONTEIRO do cabecalho (o produto saiu de ocs_p_acabado/ocs_importado para os ITENS).
 *
 *  (1) Fixtures: sigla SQL⇄TS e motivos SQL⇄motivosForaDoPedido (tests/fixtures/oc-lote-casos.ts) — espelhos coerentes.
 *  (2) SQL: no arquivo da migration da R13, `produto_acabado_id`/`produto_importado_id` do CABECALHO so aparece nos blocos
 *      permitidos (copia, backup, zerar, guardas de vinculo, pos-condicoes) — nenhum leitor NOVO filtra pela coluna legada.
 *  (3) Front (T6/T9): zero embed `ocs:ocs_p_acabado(` / `ocs:ocs_importado(` a partir do produto e zero filtro por
 *      `produto_*_id` em `from("ocs_p_acabado"|"ocs_importado")`. A migracao do front e T6/T9: aqui mantemos a LISTA BRANCA
 *      dos arquivos ainda nao migrados (BASELINE) — o teste falha se um arquivo NOVO entrar, e a baseline deve ESVAZIAR quando
 *      o front migrar. Ajustar a baseline e parte de T6/T9 (nunca crescer).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { conferirCasosSiglaTS, MOTIVOS_SQL_PARA_TS } from "../fixtures/oc-lote-casos";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("R13 — fixtures sigla/motivos (espelho TS)", () => {
  it("CASOS_SIGLA: o espelho TS bate com o esperado e com ehGrupoAcessorio", () => {
    const r = conferirCasosSiglaTS();
    expect(r.falhas, r.falhas.join("\n")).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("mapa de motivos SQL->TS cobre os 8 codigos do servidor, codigos TS validos", () => {
    const codsSql = MOTIVOS_SQL_PARA_TS.map((m) => m.sql);
    expect(new Set(codsSql).size).toBe(codsSql.length); // sem repetir
    // os codigos TS existem em motivosForaDoPedido (lista conhecida)
    const tsValidos = new Set(["ja_tem_oc", "sem_nome", "sem_fornecedor", "sem_quantidade", "sem_variantes", "soma_nao_bate", "grade_vazia", "sem_valor"]);
    for (const m of MOTIVOS_SQL_PARA_TS) expect(tsValidos.has(m.ts), `${m.sql}->${m.ts}`).toBe(true);
  });
});

describe("R13 — SQL: ponteiro do cabecalho so nos blocos permitidos", () => {
  const MIG = join(ROOT, "supabase/migrations/20261105100000_urg_r13_oc_itens.sql");
  it("o arquivo da R13 existe", () => {
    expect(existsSync(MIG)).toBe(true);
  });
  it("toda linha que cita produto_*_id do CABECALHO (sem _itens) esta num bloco permitido", () => {
    if (!existsSync(MIG)) return;
    const linhas = readFileSync(MIG, "utf8").split("\n");
    // permitido: linhas que tambem citam a tabela de ITENS (ocs_*_itens) OU o backup OU o cabecalho legitimamente
    // (copia/zerar/guarda/pos-condicao). A regra: NENHUMA linha nova de LEITOR deve filtrar o header por produto_*_id.
    // Heuristica segura: a coluna produto_*_id so pode aparecer junto de: _itens, _bkp_r13, "SET produto", "IS NOT NULL",
    // "IS NULL", comentario (--), coluna da tabela de itens no INSERT/SELECT da copia, ou o enforce (NEW.produto_*).
    // O alvo real: nenhum LEITOR NOVO filtra o header pela coluna legada — i.e. nenhum "FROM ocs_p_acabado/ocs_importado ...
    // WHERE produto_*_id = <produto>" novo. A migration cita produto_*_id legitimamente em: DDL/colunas das tabelas de ITENS,
    // gatilhos das ITENS, copia, backup, zerar, guardas enforce (NEW.), chaves jsonb, campos de record (v_item./v_oc.),
    // produto_acabado_variantes, e nos corpos ANTES dos escritores que a R13 recusa cedo (dead code preservado). A unica coisa
    // PROIBIDA e um SELECT/embed de LEITOR filtrando o header pela coluna — capturado pelo padrao abaixo.
    const leitorProibido = (l: string): boolean => {
      if (!/\bocs_(p_acabado|importado)\b(?!_itens)[\s\S]*produto_(acabado|importado)_id/.test(l)) return false;
      if (!/(WHERE|ON|JOIN)\b/i.test(l)) return false;
      if (/ocs_(p_acabado|importado)_itens/.test(l)) return false;
      // snapshot/backup/zerar/pos-condicao da PROPRIA migration (leitura unica do header antes de zerar): permitido.
      if (/produto_(acabado|importado)_id\s+IS\s+(NOT\s+)?NULL/i.test(l)) return false; // count/backup/zerar
      if (/SET\s+produto_(acabado|importado)_id\s*=\s*NULL/i.test(l)) return false; // zerar
      if (/JOIN\s+public\.ocs_(p_acabado|importado)\s+o\s+ON\s+o\.produto_(acabado|importado)_id\s*=\s*p[ai]?\.id/i.test(l)) return false; // _r13_custo_antes snapshot (ANTES)
      return true;
    };
    const suspeitas = linhas
      .map((l, i) => ({ l, i: i + 1 }))
      .filter((x) => leitorProibido(x.l) && !x.l.trim().startsWith("--"));
    // os corpos ANTES (dead code dos escritores recusados) e o _down ficam em arquivos/linhas proprios; aqui so a migration de IDA.
    expect(suspeitas.map((s) => `${s.i}: ${s.l.trim()}`), "LEITOR filtrando o header pela coluna legada (migre para os itens)").toEqual([]);
  });
});

describe("R13 — Front: embed/filtro do ponteiro do cabecalho (baseline a esvaziar em T6/T9)", () => {
  // BASELINE: arquivos que AINDA embedam ocs:ocs_* a partir do produto ou filtram from("ocs_*") por produto_*_id.
  // A migracao do front e T6/T9; esta lista NAO pode CRESCER e deve chegar a vazio quando o front migrar.
  const BASELINE = new Set<string>([
    "src/components/produto-acabado/ProdutoAcabadoSheet.tsx",
    "src/components/produto-importado/ProdutoImportadoSheet.tsx",
    "src/components/planejamento/PlanejamentoDetail.tsx",
    "src/lib/categoria-card-produto.ts",
  ]);

  function listarTsx(dir: string, out: string[]): void {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (nome === "node_modules" || nome === "dist" || nome.startsWith(".")) continue;
        listarTsx(p, out);
      } else if (/\.(ts|tsx)$/.test(nome) && !/\.test\./.test(nome)) out.push(p);
    }
  }

  it("nenhum arquivo NOVO embeda/filtra o ponteiro do cabecalho (so a baseline conhecida)", () => {
    const src = join(ROOT, "src");
    if (!existsSync(src)) return;
    const arquivos: string[] = [];
    listarTsx(src, arquivos);
    const violadores = new Set<string>();
    for (const abs of arquivos) {
      const rel = abs.slice(ROOT.length);
      const txt = readFileSync(abs, "utf8");
      const embed = /ocs:\s*ocs_(p_acabado|importado)\s*\(/.test(txt);
      const filtro =
        /from\(\s*["']ocs_(p_acabado|importado)["']\s*\)[\s\S]{0,200}?produto_(acabado|importado)_id/.test(txt);
      if (embed || filtro) violadores.add(rel);
    }
    const novos = [...violadores].filter((v) => !BASELINE.has(v)).sort();
    expect(novos, "arquivos NOVOS usando o ponteiro do cabecalho (migre para os itens)").toEqual([]);
  });
});
