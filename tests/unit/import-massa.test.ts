import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseNomeFoto, casarFotos, alvosDeFoto } from "@/lib/import/foto-match";
import { levenshtein, similaridade, sugestoes, melhorSugestao } from "@/lib/import/fuzzy";
import { agregar, resumoProblemas, gravaveis, temErroBloqueante } from "@/lib/import/aggregate";
import { tecidoDescriptor } from "@/lib/import/entities/tecido.descriptor";
import { importar } from "@/lib/import/engine";
import type { EntidadeAgregada } from "@/lib/import/types";
import { parseAba, lerWorkbook } from "@/lib/import/parse";
import { gerarTemplateWorkbook } from "@/lib/import/template";
import type { LookupMaps, RawRow } from "@/lib/import/types";

// ---------------------------------------------------------------------------
// foto-match
// ---------------------------------------------------------------------------
describe("foto-match: parseNomeFoto", () => {
  // normalizeCat preserva espaços internos (só tira acento/caixa/trim). O que importa é que os
  // DOIS lados (nome do produto e nome do arquivo) normalizem igual — o casamento é consistente.
  it("extrai nome normalizado + sufixo _Referencia", () => {
    expect(parseNomeFoto("Malha Fiore_Referencia.jpg")).toEqual({
      arquivo: "Malha Fiore_Referencia.jpg",
      nomeNorm: "malha fiore",
      tipo: "referencia",
    });
  });
  it("sem sufixo = foto principal (modelo)", () => {
    expect(parseNomeFoto("Vestal.png").tipo).toBe("modelo");
    expect(parseNomeFoto("Vestal.png").nomeNorm).toBe("vestal");
  });
  it("sufixo desconhecido NÃO é tratado como sufixo (fica no nome)", () => {
    const r = parseNomeFoto("Camisa_Frente.jpg");
    expect(r.nomeNorm).toBe("camisa_frente"); // "_frente" não é sufixo conhecido → fica no nome
    expect(r.tipo).toBe("modelo");
  });
  it("acento e caixa são normalizados", () => {
    expect(parseNomeFoto("Áçaí_Modelo.jpeg").nomeNorm).toBe("acai");
  });
});

describe("foto-match: casarFotos", () => {
  it("casa por nome, escolhe a principal e lista órfãs", () => {
    const produtos = [
      { chave: "malha fiore", nome: "Malha Fiore" },
      { chave: "vestal", nome: "Vestal" },
    ];
    const arquivos = ["Malha Fiore_Modelo.jpg", "Malha Fiore_Referencia.jpg", "Sobra.png"];
    const { matches, orfas } = casarFotos(produtos, arquivos);
    const fiore = matches.find((m) => m.chave === "malha fiore")!;
    expect(fiore.fotos).toHaveLength(2);
    expect(fiore.principal?.tipo).toBe("modelo");
    const vestal = matches.find((m) => m.chave === "vestal")!;
    expect(vestal.principal).toBeNull();
    expect(orfas.map((o) => o.arquivo)).toEqual(["Sobra.png"]);
  });
});

// ---------------------------------------------------------------------------
// fuzzy — sugestão do valor de cadastro mais próximo
// ---------------------------------------------------------------------------
describe("fuzzy match", () => {
  const empresas = [{ id: "1", nome: "Tecidos Suzy" }, { id: "2", nome: "Royal Malhas" }, { id: "3", nome: "Alfaiataria Prime" }];

  it("levenshtein básico", () => {
    expect(levenshtein("gato", "gato")).toBe(0);
    expect(levenshtein("gato", "pato")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("similaridade ignora acento/caixa", () => {
    expect(similaridade("Petróleo", "petroleo")).toBe(1);
    expect(similaridade("Azul", "Azul")).toBe(1);
    expect(similaridade("Azul", "Verde")).toBeLessThan(0.5);
  });

  it("melhorSugestao acha o fornecedor mais próximo do erro de digitação", () => {
    expect(melhorSugestao("Tecidos Suzi", empresas, (e) => e.nome)?.nome).toBe("Tecidos Suzy");
    expect(melhorSugestao("Royal", empresas, (e) => e.nome)?.nome).toBe("Royal Malhas");
  });

  it("sem candidato próximo o suficiente = null", () => {
    expect(melhorSugestao("XYZ Totalmente Diferente", empresas, (e) => e.nome)).toBeNull();
  });

  it("sugestoes ranqueia do mais próximo ao menos", () => {
    const r = sugestoes("Tecido Suzy", empresas, (e) => e.nome, 3, 0.2);
    expect(r[0].item.nome).toBe("Tecidos Suzy"); // o topo é o mais parecido
    expect(r[0].score).toBeGreaterThanOrEqual(r[r.length - 1].score); // ordenado desc
    expect(r[0].score).toBeGreaterThan(0.8); // e é uma sugestão forte
  });
});

// ---------------------------------------------------------------------------
// foto-match POR VARIANTE (tecido): casa Nome_CorApelido, fallback Nome_CorBase
// ---------------------------------------------------------------------------
describe("foto-match por variante (tecido)", () => {
  const maps: LookupMaps = {
    cores: new Map([["azul", "cor-azul"], ["verde", "cor-verde"]]),
    apelidos: new Map([["cor-azul::petroleo", "ap-petroleo"]]),
    categorias: new Map(), meses: new Map(), anos: new Map(),
    fornecedores: new Map(), representantes: new Map(),
  };

  it("chaveFotoVariante usa apelido (Nome_Apelido)", () => {
    const r = tecidoDescriptor.resolve(
      { __linha: 2, nome: "Malha Fiore", cor_base: "Azul", cor_apelido: "Petróleo" } as RawRow, maps);
    expect(tecidoDescriptor.chaveFotoVariante!(r, 0)).toBe("malha fiore_petroleo");
  });

  it("chaveFotoVariante cai na cor base quando sem apelido", () => {
    const r = tecidoDescriptor.resolve(
      { __linha: 2, nome: "Malha Fiore", cor_base: "Verde" } as RawRow, maps);
    expect(tecidoDescriptor.chaveFotoVariante!(r, 0)).toBe("malha fiore_verde");
  });

  it("alvosDeFoto gera 1 alvo por cor + casa a foto certa", () => {
    const linhas = [
      { __linha: 2, nome: "Malha Fiore", cor_base: "Azul", cor_apelido: "Petróleo" } as RawRow,
      { __linha: 3, nome: "Malha Fiore", cor_base: "Verde" } as RawRow,
    ];
    const ag = agregar(tecidoDescriptor, linhas, maps);
    const alvos = alvosDeFoto(tecidoDescriptor, ag.entidades);
    expect(alvos).toHaveLength(2); // 1 por cor
    expect(alvos.map((a) => a.chave).sort()).toEqual(["malha fiore_petroleo", "malha fiore_verde"]);
    expect(alvos[0].varIdx).toBe(0);
    expect(alvos[1].varIdx).toBe(1);

    // casa arquivos por cor: só a foto do Petróleo bate na 1ª cor
    const { matches, orfas } = casarFotos(
      alvos.map((a) => ({ chave: a.chave, rotulo: a.rotulo })),
      ["Malha Fiore_Petróleo.jpg", "Malha Fiore_Verde.png", "Outro.jpg"],
    );
    expect(matches.find((m) => m.chave === "malha fiore_petroleo")?.principal?.arquivo).toBe("Malha Fiore_Petróleo.jpg");
    expect(matches.find((m) => m.chave === "malha fiore_verde")?.principal?.arquivo).toBe("Malha Fiore_Verde.png");
    expect(orfas.map((o) => o.arquivo)).toEqual(["Outro.jpg"]);
  });
});

// ---------------------------------------------------------------------------
// parse — round-trip com o template REAL (regressão: header "Nome *" tem de casar "nome";
// linha "(exemplo)" tem de ser descartada). Este teste reproduz o bug do arquivo do dono.
// ---------------------------------------------------------------------------
describe("parse: round-trip template → parseAba", () => {
  it("casa headers com ' *' (obrigatório) e descarta linha (exemplo)", () => {
    // gera o template REAL (headers "Nome *", "Cor base *", …) e uma linha de dados de verdade.
    const wb = gerarTemplateWorkbook([tecidoDescriptor]);
    const ws = wb.Sheets["Tecido"];
    // acrescenta 2 linhas reais logo após o cabeçalho + exemplo (sheet_add_aoa por origem -1 = fim)
    XLSX.utils.sheet_add_aoa(
      ws,
      [
        // ordem das colunas do descritor: nome, unidade, ncm, fornecedor, representante,
        // categorias, composicao, rendimento, preco, mes, ano, cor_base, cor_apelido, ...
        ["Tecido Exemplo", "metro", "", "Royal", "", "Alfaiataria", "50% CO 50% PE", "", "35", "", "", "Verde", "Musgo", "", "", ""],
        ["Tecido Exemplo", "metro", "", "Royal", "", "Alfaiataria", "50% CO 50% PE", "", "35", "", "", "Amarelo", "Mostarda", "", "", ""],
      ],
      { origin: -1 },
    );
    // reparseia como o app faz (via ArrayBuffer)
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const wb2 = lerWorkbook(buf);
    const parsed = parseAba(wb2, "Tecido", tecidoDescriptor.colunas, "nome");

    // a linha (exemplo) foi DESCARTADA → só as 2 reais sobram
    expect(parsed.linhas).toHaveLength(2);
    // headers com ' *' casaram → nome e cor_base foram lidos (não undefined)
    expect(parsed.linhas[0].nome).toBe("Tecido Exemplo");
    expect(parsed.linhas[0].cor_base).toBe("Verde");
    expect(parsed.linhas[1].cor_base).toBe("Amarelo");
    // nenhum header do template ficou "desconhecido"
    expect(parsed.headersDesconhecidos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolve (descritor tecido) + aggregate
// ---------------------------------------------------------------------------
const maps: LookupMaps = {
  cores: new Map([["azul", "cor-azul"], ["vermelho", "cor-verm"]]),
  apelidos: new Map([["cor-azul::petroleo", "ap-petroleo"]]),
  categorias: new Map([["malha", "cat-malha"], ["chiffon", "cat-chiffon"]]),
  meses: new Map(),
  anos: new Map(),
  fornecedores: new Map([["tecidos suzy", ["emp-suzy"]], ["duplicada", ["emp-a", "emp-b"]]]),
  representantes: new Map(),
};

function row(n: number, over: Partial<Record<string, string>> = {}): RawRow {
  return { __linha: n, nome: "", cor_base: "", ...over } as RawRow;
}

describe("tecidoDescriptor.resolve", () => {
  it("resolve cor base + apelido + categorias + fornecedor", () => {
    const r = tecidoDescriptor.resolve(
      row(2, { nome: "Malha Fiore", cor_base: "Azul", cor_apelido: "Petróleo", categorias: "Malha, Chiffon", fornecedor: "Tecidos Suzy", preco: "28,00" }),
      maps,
    );
    expect(r.chave).toBe("malha fiore");
    expect(r.cabecalho.empresa_id).toBe("emp-suzy");
    expect(r.cabecalho.preco).toBe(28);
    expect(r.categoriaIds).toEqual(["cat-malha", "cat-chiffon"]);
    expect(r.variantes[0].cor_id).toBe("cor-azul");
    expect(r.variantes[0].cor_apelido_id).toBe("ap-petroleo");
    expect(r.problemas.filter((p) => p.nivel === "erro")).toHaveLength(0);
  });

  it("cor base inexistente = ERRO bloqueante", () => {
    const r = tecidoDescriptor.resolve(row(2, { nome: "X", cor_base: "Roxo" }), maps);
    expect(r.problemas.some((p) => p.nivel === "erro" && p.campo === "cor_base")).toBe(true);
  });

  it("apelido que não pertence à cor base = ERRO", () => {
    const r = tecidoDescriptor.resolve(row(2, { nome: "X", cor_base: "Vermelho", cor_apelido: "Petróleo" }), maps);
    expect(r.problemas.some((p) => p.nivel === "erro" && p.campo === "cor_apelido")).toBe(true);
  });

  it("fornecedor homônimo = AVISO (usa o primeiro)", () => {
    const r = tecidoDescriptor.resolve(row(2, { nome: "X", cor_base: "Azul", fornecedor: "Duplicada" }), maps);
    expect(r.cabecalho.empresa_id).toBe("emp-a");
    expect(r.problemas.some((p) => p.nivel === "aviso" && p.campo === "fornecedor")).toBe(true);
  });

  it("rendimento só entra quando unidade = kg", () => {
    const metro = tecidoDescriptor.resolve(row(2, { nome: "X", cor_base: "Azul", unidade: "metro", rendimento: "3,5" }), maps);
    expect(metro.cabecalho.rendimento).toBeNull();
    const kg = tecidoDescriptor.resolve(row(2, { nome: "Y", cor_base: "Azul", unidade: "kg", rendimento: "3,5" }), maps);
    expect(kg.cabecalho.rendimento).toBe(3.5);
  });
});

describe("aggregate: agrupa variantes da mesma entidade e detecta duplicatas", () => {
  it("mesmo nome em 2 linhas = 1 entidade com 2 variantes", () => {
    const linhas = [
      row(2, { nome: "Malha Fiore", cor_base: "Azul" }),
      row(3, { nome: "Malha Fiore", cor_base: "Vermelho" }),
    ];
    const ag = agregar(tecidoDescriptor, linhas, maps);
    expect(ag.entidades).toHaveLength(1);
    expect(ag.entidades[0].variantes).toHaveLength(2);
  });

  it("cor repetida na mesma entidade = duplicata de cor (não duplica variante)", () => {
    const linhas = [
      row(2, { nome: "Malha Fiore", cor_base: "Azul" }),
      row(3, { nome: "Malha Fiore", cor_base: "Azul" }),
    ];
    const ag = agregar(tecidoDescriptor, linhas, maps);
    expect(ag.entidades[0].variantes).toHaveLength(1);
    expect(ag.entidades[0].problemas.some((p) => p.nivel === "duplicata" && p.campo === "cor")).toBe(true);
  });

  it("entidade com erro bloqueante não é gravável", () => {
    const linhas = [row(2, { nome: "X", cor_base: "Roxo" })];
    const ag = agregar(tecidoDescriptor, linhas, maps);
    expect(temErroBloqueante(ag.entidades[0])).toBe(true);
    expect(gravaveis(ag.entidades)).toHaveLength(0);
  });

  it("cabeçalho divergente entre linhas do mesmo item = aviso (usa o da 1ª)", () => {
    const linhas = [
      row(2, { nome: "Malha Fiore", cor_base: "Azul", preco: "28,00" }),
      row(3, { nome: "Malha Fiore", cor_base: "Vermelho", preco: "35,00" }), // preço diferente
    ];
    const ag = agregar(tecidoDescriptor, linhas, maps);
    expect(ag.entidades[0].variantes).toHaveLength(2);
    expect(ag.entidades[0].cabecalho.preco).toBe(28); // o da 1ª linha vale
    expect(ag.entidades[0].problemas.some((p) => p.nivel === "aviso" && /cabeçalho/i.test(p.mensagem))).toBe(true);
  });

  it("resumoProblemas conta sem-foto / erro / duplicata", () => {
    const linhas = [
      row(2, { nome: "Bom", cor_base: "Azul" }),
      row(3, { nome: "RuimCor", cor_base: "Roxo" }),
    ];
    const ag = agregar(tecidoDescriptor, linhas, maps);
    const res = resumoProblemas(ag.entidades);
    expect(res.total).toBe(2);
    expect(res.comErro).toBe(1);
    expect(res.semFoto).toBe(0); // fotoNome = nome normalizado (sempre presente aqui)
  });
});

// ---------------------------------------------------------------------------
// analisarBanco — estado do UPSERT incremental (novo/complementar/so_foto/conflito)
// ---------------------------------------------------------------------------
describe("tecidoDescriptor.analisarBanco (upsert)", () => {
  // fake do supabase: .from("artigos").select(...) resolve os artigos existentes fornecidos.
  const fakeSb = (artigos: unknown[]) =>
    ({ from: () => ({ select: async () => ({ data: artigos, error: null }) }) }) as never;

  const EMP = "emp-suzy";
  // maps com fornecedor "Tecidos Suzy" = emp-suzy
  const maps2: LookupMaps = { ...maps, fornecedores: new Map([["tecidos suzy", [EMP]]]) };

  async function analisar(linhas: RawRow[], artigos: unknown[]) {
    const ag = agregar(tecidoDescriptor, linhas, maps2);
    await tecidoDescriptor.analisarBanco!(fakeSb(artigos), ag.entidades);
    return ag.entidades;
  }

  it("nome+fornecedor inexistentes = novo", async () => {
    const [e] = await analisar([row(2, { nome: "Malha Nova", cor_base: "Azul", fornecedor: "Tecidos Suzy" })], []);
    expect(e.estado).toBe("novo");
    expect(e.artigoAlvoId).toBeNull();
  });

  it("mesmo nome+fornecedor, cor nova = complementar", async () => {
    const artigos = [{ id: "art-1", nome: "Malha Fiore", empresa_id: EMP, empresas: { nome_fantasia: "Tecidos Suzy" },
      variantes_tecido: [{ cor_id: "cor-verm", cor_apelido_id: null, foto_url: null }] }];
    const [e] = await analisar([row(2, { nome: "Malha Fiore", cor_base: "Azul", fornecedor: "Tecidos Suzy" })], artigos);
    expect(e.estado).toBe("complementar");
    expect(e.artigoAlvoId).toBe("art-1");
    expect(e.varianteExiste).toEqual([false]); // Azul é nova
  });

  it("cor já existe SEM foto = so_foto", async () => {
    const artigos = [{ id: "art-1", nome: "Malha Fiore", empresa_id: EMP, empresas: { nome_fantasia: "Tecidos Suzy" },
      variantes_tecido: [{ cor_id: "cor-azul", cor_apelido_id: null, foto_url: null }] }];
    const [e] = await analisar([row(2, { nome: "Malha Fiore", cor_base: "Azul", fornecedor: "Tecidos Suzy" })], artigos);
    expect(e.estado).toBe("so_foto");
    expect(e.varianteExiste).toEqual([true]);
    expect(e.varianteTemFoto).toEqual([false]);
  });

  it("nome existe com fornecedor DIFERENTE = conflito_fornecedor", async () => {
    const artigos = [{ id: "art-9", nome: "Malha Fiore", empresa_id: "emp-outro", empresas: { nome_fantasia: "Royal" },
      variantes_tecido: [] }];
    const [e] = await analisar([row(2, { nome: "Malha Fiore", cor_base: "Azul", fornecedor: "Tecidos Suzy" })], artigos);
    expect(e.estado).toBe("conflito_fornecedor");
    expect(e.artigoAlvoId).toBe("art-9");
    expect(e.fornecedorExistenteNome).toBe("Royal");
  });
});

// ---------------------------------------------------------------------------
// REGRESSÃO (achados da revisão): revalidar após correção + ação no relatório
// ---------------------------------------------------------------------------
describe("regressão: revalidar limpa erro após correção inline", () => {
  const maps3: LookupMaps = {
    cores: new Map([["azul", "cor-azul"]]),
    apelidos: new Map(), categorias: new Map(), meses: new Map(), anos: new Map(),
    fornecedores: new Map(), representantes: new Map(),
  };
  it("cor base inexistente = erro; após corrigir cor_id, revalidar remove o erro", () => {
    const ag = agregar(tecidoDescriptor, [{ __linha: 2, nome: "Malha", cor_base: "Roxo" } as RawRow], maps3);
    const ent = ag.entidades[0];
    expect(temErroBloqueante(ent)).toBe(true); // Roxo não existe
    // usuário corrige a cor no dropdown → cor_id preenchido
    const corrigida: EntidadeAgregada = { ...ent, variantes: ent.variantes.map((v) => ({ ...v, cor_id: "cor-azul" })) };
    corrigida.problemas = tecidoDescriptor.revalidar!(corrigida);
    expect(temErroBloqueante(corrigida)).toBe(false); // erro sumiu → será gravada, não pulada
    expect(gravaveis([corrigida])).toHaveLength(1);
  });
});

describe("regressão: engine reporta a AÇÃO retornada pela rpc", () => {
  const desc = {
    ...tecidoDescriptor,
    temFoto: false, // sem foto p/ não depender de upload no teste
    rpc: async (_sb: unknown, ent: EntidadeAgregada) =>
      // simula a RPC: 1º "criado", os demais pela cor
      (ent.cabecalho.nome === "A" ? "criado" : ent.cabecalho.nome === "B" ? "complementado" : "so_foto") as const,
  };
  it("criado/complementado/so_foto entram no relatório certo (não tudo 'criado')", async () => {
    const ents = ["A", "B", "C"].map((n) => ({
      chave: n, cabecalho: { nome: n }, variantes: [{ cor_id: "x" }], problemas: [], raw: { __linha: 2 },
      fotoNome: null, categoriaIds: [],
    })) as unknown as EntidadeAgregada[];
    const rep = await importar({} as never, desc as never, ents, new Map());
    expect(rep.criados).toBe(1);
    expect(rep.complementados).toBe(1);
    expect(rep.soFoto).toBe(1);
    expect(rep.itens.map((i) => i.status).sort()).toEqual(["complementado", "criado", "so_foto"]);
  });
});
