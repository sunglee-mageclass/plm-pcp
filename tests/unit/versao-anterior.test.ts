// Preço anterior e Título por VERSÃO (P-146..P-159) — composição TS (src/lib/versao-anterior.ts) com a MESMA fixture que a
// integração confere no SQL (tests/fixtures/versao-anterior-casos.ts ⇄ tests/integration/preco-titulo-versao.test.ts).
// + RB2 (linha da RPC sem anterior ⇒ null), textos dos selos, erro-mensagem e as funções puras da T5 (P-156 C).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CASOS_VERSAO, LOJA_CASOS } from "../fixtures/versao-anterior-casos";
import {
  DICA_PRECO_ANTERIOR_EDITADO, dicaPrecoAnterior, hoverTituloHerdado, infoDaLinha, mapaVersaoAnterior, precoAnteriorAutomatico, seloPrecoAnterior,
  seloTitulo, tituloAutomatico, type VersaoAnteriorInfo,
} from "@/lib/versao-anterior";
import { TEXTO_VERSAO_CONGELAR, TEXTO_VERSAO_LIMITE, mensagemErro } from "@/lib/erro-mensagem";
import {
  FILTROS_VAZIOS, produtoPassaFiltroVersao, filtrosParaRpc, lerVersoesIntegradas, resumoVariantes, rotuloVarianteComparada,
  seloVersaoIntegrada, textoFiltroVersao,
} from "@/lib/integracao/produtos";

const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("anti-drift — composição TS ≡ fixture (a mesma que a integração confere no SQL)", () => {
  for (const caso of CASOS_VERSAO) {
    it(caso.nome, () => {
      const info: VersaoAnteriorInfo = caso.helper
        ? {
            anterior_versao: caso.helper.anterior_versao,
            anterior_preco: caso.helper.anterior_preco,
            titulo_herdado: caso.helper.titulo_herdado,
            titulo_origem_versao: caso.helper.titulo_origem_versao,
          }
        : null;
      const alvo = caso.familia.find((l) => l.k === caso.alvo)!;
      expect(precoAnteriorAutomatico(info, alvo.preco_venda)).toEqual(caso.ts.preco);
      expect(tituloAutomatico(info, alvo.nome, LOJA_CASOS)).toEqual(caso.ts.titulo);
      // composição SQL (_modelo_automaticos) ≡ TS onde se sobrepõem: com anterior sempre; sem anterior só quando o próprio
      // preço é > 0 (o SQL manda o preco_venda cru; o retrato trata ≤ 0 como vazio — `_integracao_num`)
      if (caso.composicao.preco_fonte === "anterior" || (alvo.preco_venda ?? 0) > 0) {
        expect(caso.ts.preco.valor).toBe(caso.composicao.preco_auto);
      }
      expect(caso.ts.titulo.valor || null).toBe(caso.composicao.titulo_auto);
    });
  }
});

describe("RB2 — linha da RPC sem anterior (anterior_id NULL) ⇒ info null (regra da v1, nunca 'aguardando' falso)", () => {
  it("linha só de NULLs vira null; com anterior vira info (numeric em texto também)", () => {
    const vazio = { modelo_id: "m1", anterior_id: null, anterior_versao: null, anterior_preco: null, titulo_herdado: null, titulo_origem_versao: null };
    expect(infoDaLinha(vazio)).toBeNull();
    expect(precoAnteriorAutomatico(infoDaLinha(vazio), 150)).toEqual({ valor: 150, fonte: "proprio", versao: null, aguardando: false });
    expect(infoDaLinha({ ...vazio, anterior_id: "a", anterior_versao: 2, anterior_preco: "199.90", titulo_herdado: "T", titulo_origem_versao: 1 }))
      .toEqual({ anterior_versao: 2, anterior_preco: 199.9, titulo_herdado: "T", titulo_origem_versao: 1 });
    expect(infoDaLinha({ ...vazio, anterior_id: "a", anterior_versao: 1, anterior_preco: 0 })?.anterior_preco).toBeNull();
    const m = mapaVersaoAnterior([vazio, { ...vazio, modelo_id: "m2", anterior_id: "a", anterior_versao: 1, anterior_preco: 10 }]);
    expect(m.get("m1")).toBeNull();
    expect(m.get("m2")?.anterior_versao).toBe(1);
    expect(infoDaLinha(undefined)).toBeNull();
  });
});

describe("textos (selos/dicas) — Sheet e Integração", () => {
  const ant = (preco: number | null): VersaoAnteriorInfo => ({ anterior_versao: 2, anterior_preco: preco, titulo_herdado: "X", titulo_origem_versao: 1 });
  it("Preço anterior", () => {
    expect(seloPrecoAnterior(300, precoAnteriorAutomatico(ant(200), 0))).toEqual({ texto: "editado", tom: "info" });
    expect(seloPrecoAnterior(null, precoAnteriorAutomatico(ant(200), 0)).texto).toBe("acompanha o preço da versão anterior (v2)");
    expect(seloPrecoAnterior(null, precoAnteriorAutomatico(ant(null), 999))).toEqual({ texto: "aguardando preço da v2", tom: "warning" });
    expect(seloPrecoAnterior(null, precoAnteriorAutomatico(null, 150)).texto).toBe("automático");
    expect(seloPrecoAnterior(null, precoAnteriorAutomatico(null, null))).toEqual({ texto: "aguardando preço de venda", tom: "warning" });
    expect(dicaPrecoAnterior(precoAnteriorAutomatico(ant(200), 0))).toBe("preço de venda da v2 até ser editado · ↺ volta ao automático");
    expect(dicaPrecoAnterior(precoAnteriorAutomatico(ant(null), 0))).toBe("fica vazio até a v2 ter preço de venda · ou digite um valor");
    // Minor 3 (revisão front): na v1 sem preço DIGITADO, deixa claro que o sugerido não conta
    expect(dicaPrecoAnterior(precoAnteriorAutomatico(null, null)))
      .toBe("fica vazio até ter um Preço de venda digitado (o sugerido não vai para a loja virtual) · ou digite um valor");
    expect(DICA_PRECO_ANTERIOR_EDITADO).toBe("valor fixado à mão · ↺ volta ao automático"); // Minor 2
  });
  it("Título", () => {
    const h = tituloAutomatico(ant(1), "QUALQUER", "L");
    expect(seloTitulo(h)).toBe("herdado da v2");
    expect(hoverTituloHerdado(h)).toBe("Segue o Título da v2, que também herdou: o texto vem da v1.");
    expect(seloTitulo(tituloAutomatico(null, "BLUSA", "L"))).toBe("automático");
    expect(hoverTituloHerdado(tituloAutomatico(null, "BLUSA", "L"))).toBeNull();
    // P-155 B: o herdado ignora o Nome desta versão
    expect(tituloAutomatico(ant(1), "OUTRO NOME", "L").valor).toBe("X");
  });
});

describe("erro-mensagem — recusas ASCII da frente", () => {
  it("versao_congelar (falha fechada) e os tetos de 500 ids viram PT", () => {
    expect(mensagemErro({ code: "P0001", message: "versao_congelar: 55P03" })).toBe(TEXTO_VERSAO_CONGELAR);
    expect(mensagemErro({ code: "P0001", message: "versao_anterior: limite de 500 ids" })).toBe(TEXTO_VERSAO_LIMITE);
    expect(mensagemErro({ code: "P0001", message: "versoes_integradas: limite de 500 ids" })).toBe(TEXTO_VERSAO_LIMITE);
    expect(TEXTO_VERSAO_CONGELAR).toMatch(/nada foi exclu[ií]do/);
  });
});

describe("T5 (P-156 C) — funções puras", () => {
  const raw = [
    { modelo_id: "m2", anterior_id: "m1", anterior_versao: 1, anterior_estado: "integrado", anterior_marcado_em: "2026-09-01T00:00:00Z",
      anterior_integrado_em: "2026-09-02T00:00:00Z",
      iguais: [{ variante_key: "k1", cor_nome: "Preto", apelido_nome: "Ônix" }],
      novas: [{ variante_key: "k3", cor_nome: "Azul", apelido_nome: null }],
      sairam: [{ variante_key: "k2", cor_nome: null, apelido_nome: null }] },
    { modelo_id: "m9", anterior_id: "m8", anterior_versao: 3, anterior_estado: "integravel", iguais: [], novas: [], sairam: [] },
    { modelo_id: "lixo" }, // ilegível: fica de fora
  ];
  const mapa = lerVersoesIntegradas(raw);
  it("leitura tolerante + selo", () => {
    expect([...mapa.keys()]).toEqual(["m2", "m9"]);
    expect(seloVersaoIntegrada(mapa.get("m2")!)).toBe("v1 já integrada");
    expect(seloVersaoIntegrada(mapa.get("m9")!)).toBe("v3 já integrável");
    expect(lerVersoesIntegradas(null).size).toBe(0);
  });
  it("resumoVariantes: título + 3 grupos com contagem e o rótulo de variante do sistema ('cor sem nome' sem nome)", () => {
    const r = resumoVariantes(mapa.get("m2")!);
    expect(r.titulo).toBe("Comparado com o que a v1 enviou à loja virtual:");
    expect(r.grupos).toEqual([
      { rotulo: "Iguais (1)", itens: ["Preto - Ônix"] },
      { rotulo: "Novas nesta versão (1)", itens: ["Azul"] },
      { rotulo: "Saíram (1)", itens: ["cor sem nome"] },
    ]);
    expect(rotuloVarianteComparada({ varianteKey: "k", corNome: "  ", apelidoNome: null })).toBe("cor sem nome");
  });
  it("produtoPassaFiltroVersao (o predicado que a aba usa): LOCAL, sobre a lista carregada; desligado = tudo", () => {
    const ps = [{ modeloId: "m1" }, { modeloId: "m2" }, { modeloId: "m9" }];
    expect(ps.filter((p) => produtoPassaFiltroVersao(p, mapa, true)).map((p) => p.modeloId)).toEqual(["m2", "m9"]);
    expect(ps.filter((p) => produtoPassaFiltroVersao(p, mapa, false))).toEqual(ps);
    // Minor 5: a aba usa ESTE helper (não uma cópia inline)
    expect(fonte("src/components/integracao/ProdutosAba.tsx"))
      .toContain("produtoPassaFiltroVersao(p, versoesInt.mapa, filtros.versaoIntegrada)");
  });
  it("o filtro NÃO vai para a RPC da lista (R7c)", () => {
    expect(FILTROS_VAZIOS.versaoIntegrada).toBe(false);
    expect(filtrosParaRpc({ ...FILTROS_VAZIOS, versaoIntegrada: true })).toEqual({});
    expect(filtrosParaRpc({ ...FILTROS_VAZIOS, estado: "integrado", versaoIntegrada: true })).toEqual({ estado: "integrado" });
    expect(textoFiltroVersao(false)).toContain("até 500");
    expect(textoFiltroVersao(true)).toContain("desta página");
  });
  it("gate de fonte: linha âmbar + selo na coluna Estado; filtro 'Versão' depois do Estado; 1 chamada com os ids da lista", () => {
    const t = fonte("src/components/integracao/ProdutosTabela.tsx");
    // I2 (revisão front): marca = borda esquerda âmbar na 1ª célula; o FUNDO âmbar fica só para a pendência
    expect(t).toContain('export const MARCA_VERSAO_INTEGRADA = "border-l-4 border-l-[var(--tone-warning-fg)]";');
    expect(t).toContain('<tr className="border-t align-top" data-versao-integrada=');
    expect(t).not.toContain("align-top bg-[var(--tone-warning-bg)]");
    expect(t).toContain("{versaoIntegrada && <SeloVersaoIntegrada info={versaoIntegrada} />}");
    const a = fonte("src/components/integracao/ProdutosAba.tsx");
    const iEstado = a.indexOf('<FiltroSelect id="f-estado"');
    const iVersao = a.indexOf('<FiltroSelect id="f-versao" rotulo="Versão"');
    expect(iEstado).toBeGreaterThan(0);
    expect(iVersao).toBeGreaterThan(iEstado);
    expect(a).toContain('label: "Já integrado (versão)"');
    // Layout (1280/1024): o gatilho do Select encolhe e trunca em vez de vazar sobre o "Buscar"; texto completo no title.
    expect(a).toContain('className="min-w-0 [&>span]:truncate"');
    expect(a).toContain("opcoes.find((o) => o.key === valor)?.label");
    // Falha da verificação com o filtro Versão DESLIGADO: aviso não bloqueante com "Tentar de novo" (não some em silêncio).
    expect(a).toContain("{versoesInt.erro && !filtros.versaoIntegrada && (");
    expect(a).toContain("<FalhaVersaoAnterior onTentar={versoesInt.tentarDeNovo}");
    expect(a).toContain("const versoesInt = useVersoesIntegradas(idsPagina);");
    // Minor 6: filtro ligado com o mapa carregando/em erro NÃO cai no "nenhum produto" enganoso
    expect(a).toContain("Verificando as versões já integradas…");
    expect(a).toContain("Não foi possível verificar as versões já integradas");
    const u = fonte("src/components/integracao/useIntegracao.ts");
    expect(u).toContain('supabase.rpc("integracao_versoes_integradas" as any');
    expect(u).toContain('if ((error as { code?: string }).code === "PGRST202") return [];');
  });
});
