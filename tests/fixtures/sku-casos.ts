// Casos COMPARTILHADOS do anti-drift do SKU (F3.5a): o MESMO arquivo alimenta
//   tests/unit/sku-montar.test.ts           → src/lib/tamanho.ts + src/lib/sku-montar.ts (TS)
//   tests/integration/sku-automatico.test.ts → public._sku_* (SQL, só na cópia local)
// Toda entrada é serializável em JSON (vai ao banco como jsonb/text). Mudou a regra? Mude TS, SQL e AQUI.
import type { SkuConfig, SkuCor, SkuFalta } from "../../src/lib/sku-montar";
import type { TamanhoTipo } from "../../src/lib/tamanho";

export const CASOS_TAMANHO: {
  entrada: string | null;
  numero: string | null;
  letra: string | null;
  ladoNumero: string | null;
  ladoLetra: string | null;
}[] = [
  { entrada: "34|PPP", numero: "34", letra: "PPP", ladoNumero: "34", ladoLetra: "PPP" },
  { entrada: "PPP|34", numero: "34", letra: "PPP", ladoNumero: "34", ladoLetra: "PPP" },
  { entrada: " 38 | P ", numero: "38", letra: "P", ladoNumero: "38", ladoLetra: "P" },
  { entrada: "36", numero: "36", letra: null, ladoNumero: "36", ladoLetra: "36" },
  { entrada: "PP", numero: null, letra: "PP", ladoNumero: "PP", ladoLetra: "PP" },
  { entrada: "UN", numero: null, letra: "UN", ladoNumero: "UN", ladoLetra: "UN" },
  { entrada: "3M", numero: null, letra: "3M", ladoNumero: "3M", ladoLetra: "3M" },
  { entrada: "34|", numero: "34", letra: null, ladoNumero: "34", ladoLetra: "34" },
  { entrada: "|PPP", numero: null, letra: "PPP", ladoNumero: "PPP", ladoLetra: "PPP" },
  { entrada: "|34", numero: "34", letra: null, ladoNumero: "34", ladoLetra: "34" },
  { entrada: "10|12", numero: "10", letra: "12", ladoNumero: "10", ladoLetra: "12" },
  { entrada: "P|M", numero: "P", letra: "M", ladoNumero: "P", ladoLetra: "M" },
  { entrada: "34|PPP|X", numero: "34", letra: "PPP|X", ladoNumero: "34", ladoLetra: "PPP|X" },
  { entrada: "|", numero: null, letra: null, ladoNumero: null, ladoLetra: null },
  { entrada: "   ", numero: null, letra: null, ladoNumero: null, ladoLetra: null },
  { entrada: null, numero: null, letra: null, ladoNumero: null, ladoLetra: null },
  { entrada: "\t40\n|\tM ", numero: "40", letra: "M", ladoNumero: "40", ladoLetra: "M" },
];

// D6/R4 (pendente do dono): sem acento (lista fixa), só A–Z/0–9, MAIÚSCULAS.
export const CASOS_SIGLA: { entrada: string | null; esperado: string | null }[] = [
  { entrada: "am", esperado: "AM" },
  { entrada: "  vd \t", esperado: "VD" },
  { entrada: "Off White", esperado: "OFFWHITE" },
  { entrada: "açaí", esperado: "ACAI" },
  { entrada: "a-m", esperado: "AM" },
  { entrada: "Ñandú 2", esperado: "NANDU2" },
  { entrada: "ß", esperado: null },
  { entrada: "", esperado: null },
  { entrada: " \t\r\n ", esperado: null },
  { entrada: null, esperado: null },
];

// A REF dentro do SKU: sem acento, só A–Z/0–9 e - . _ /, MAIÚSCULAS (o resto sai).
export const CASOS_REF: { entrada: string | null; esperado: string }[] = [
  { entrada: " r1 ", esperado: "R1" },
  { entrada: "ab c#1", esperado: "ABC1" },
  { entrada: "TOBMC10000009", esperado: "TOBMC10000009" },
  { entrada: "ref-01/a.b_c", esperado: "REF-01/A.B_C" },
  { entrada: "Ação", esperado: "ACAO" },
  { entrada: "", esperado: "" },
  { entrada: null, esperado: "" },
];

// SKU digitado à mão: sem espaço, sem acento, MAIÚSCULAS; só A–Z, 0–9 e - . _ / (senão erro).
export const CASOS_SKU_MANUAL: ({ entrada: string | null; esperado: string } | { entrada: string | null; erro: string })[] = [
  { entrada: " abc-1 ", esperado: "ABC-1" },
  { entrada: "açaí 34", esperado: "ACAI34" },
  { entrada: "a b/c.d_e", esperado: "AB/C.D_E" },
  { entrada: "a\tb\r\nc", esperado: "ABC" },
  { entrada: "x#1", erro: "SKU inválido: use só letras, números e - . _ /." },
  { entrada: " x", erro: "SKU inválido: use só letras, números e - . _ /." },
  { entrada: "   ", erro: "Informe o SKU." },
  { entrada: null, erro: "Informe o SKU." },
];

export const CASOS_CONFIG: ({ entrada: unknown; esperado: SkuConfig | null } | { entrada: unknown; erro: string })[] = [
  { entrada: null, esperado: null },
  { entrada: { partes: [] }, esperado: null },
  { entrada: {}, esperado: null },
  {
    entrada: { partes: ["ref", "cor_base", "tamanho"] },
    esperado: { partes: ["ref", "cor_base", "tamanho"], separadores: {} },
  },
  {
    entrada: {
      partes: ["ref", "cor_base", "cor_apelido", "tamanho"],
      separadores: { "ref|cor_base": "-", "cor_base|cor_apelido": "", "cor_apelido|tamanho": "/", "ref|tamanho": "#" },
      tamanho_padrao: "numero",
      lixo: 1,
    },
    esperado: {
      partes: ["ref", "cor_base", "cor_apelido", "tamanho"],
      separadores: { "ref|cor_base": "-", "cor_apelido|tamanho": "/" },
    },
  },
  { entrada: { partes: ["ref"], tamanho_padrao: "" }, esperado: { partes: ["ref"], separadores: {} } },
  { entrada: { partes: ["ref"], tamanho_padrao: null }, esperado: { partes: ["ref"], separadores: {} } },
  { entrada: { partes: ["ref"], separadores: null }, esperado: { partes: ["ref"], separadores: {} } },
  { entrada: [], erro: "Formato do SKU inválido." },
  { entrada: "x", erro: "Formato do SKU inválido." },
  { entrada: { partes: "ref" }, erro: "Formato do SKU inválido: partes." },
  { entrada: { partes: ["ref", "cor"] }, erro: 'Parte do SKU desconhecida: "cor".' },
  { entrada: { partes: ["ref", 5] }, erro: "Parte do SKU desconhecida: 5." },
  { entrada: { partes: ["ref", "ref"] }, erro: "Parte do SKU repetida: ref." },
  { entrada: { partes: ["ref", "tamanho"], separadores: [] }, erro: "Formato do SKU inválido: separadores." },
  { entrada: { partes: ["ref", "tamanho"], separadores: { "ref|tamanho": 1 } }, erro: "Separador do SKU inválido." },
  { entrada: { partes: ["ref", "tamanho"], separadores: { "ref|tamanho": "- " } }, erro: "Separador do SKU: use só - . _ /." },
  { entrada: { partes: ["ref", "tamanho"], separadores: { "ref|tamanho": "#" } }, erro: "Separador do SKU: use só - . _ /." },
  { entrada: { partes: ["ref", "tamanho"], separadores: { "ref|tamanho": "_/" } },
    esperado: { partes: ["ref", "tamanho"], separadores: { "ref|tamanho": "_/" } } },
  { entrada: { partes: ["ref", "tamanho"], separadores: { "ref|tamanho": "----" } }, erro: "Separador do SKU: no máximo 3 caracteres." },
  // F3.6 (dono 25/set, R24): a chave legada tamanho_padrao é IGNORADA — qualquer valor, sem erro; a saída não a tem.
  { entrada: { partes: ["ref"], tamanho_padrao: "grande" }, esperado: { partes: ["ref"], separadores: {} } },
  { entrada: { partes: ["ref"], tamanho_padrao: 5 }, esperado: { partes: ["ref"], separadores: {} } },
  // P-126 (dono 29/set, 20261013100000): cor no nome da sublinha da Integração — 'cor_base' | 'cor_apelido', no MESMO jsonb.
  { entrada: { partes: ["ref", "cor_base", "tamanho"], separadores: { "ref|cor_base": "-" }, cor_no_nome: "cor_apelido" },
    esperado: { partes: ["ref", "cor_base", "tamanho"], separadores: { "ref|cor_base": "-" }, cor_no_nome: "cor_apelido" } },
  { entrada: { partes: ["ref"], cor_no_nome: "cor_base" }, esperado: { partes: ["ref"], separadores: {}, cor_no_nome: "cor_base" } },
  // loja SEM formato do SKU que escolheu a cor do nome: partes [] + a chave ⇒ objeto (sem a chave continua null)
  { entrada: { partes: [], cor_no_nome: "cor_apelido" }, esperado: { partes: [], separadores: {}, cor_no_nome: "cor_apelido" } },
  { entrada: { cor_no_nome: "cor_base" }, esperado: { partes: [], separadores: {}, cor_no_nome: "cor_base" } },
  { entrada: { partes: [], separadores: { "ref|tamanho": "-" }, cor_no_nome: "cor_base" },
    esperado: { partes: [], separadores: {}, cor_no_nome: "cor_base" } },
  { entrada: { partes: [], separadores: [], cor_no_nome: "cor_base" }, esperado: { partes: [], separadores: {}, cor_no_nome: "cor_base" } },
  // null = fora da saída
  { entrada: { partes: ["ref"], cor_no_nome: null }, esperado: { partes: ["ref"], separadores: {} } },
  { entrada: { partes: [], cor_no_nome: null }, esperado: null },
  // inválida = P0001 (checada DEPOIS das partes: parte ruim + chave ruim ⇒ o erro da parte)
  { entrada: { partes: ["ref"], cor_no_nome: "apelido" }, erro: "Cor no nome da sublinha inválida (use cor_base ou cor_apelido)." },
  { entrada: { partes: ["ref"], cor_no_nome: 5 }, erro: "Cor no nome da sublinha inválida (use cor_base ou cor_apelido)." },
  { entrada: { partes: [], cor_no_nome: "COR_BASE" }, erro: "Cor no nome da sublinha inválida (use cor_base ou cor_apelido)." },
  { entrada: { partes: ["ref"], cor_no_nome: ["cor_base"] }, erro: "Cor no nome da sublinha inválida (use cor_base ou cor_apelido)." },
  { entrada: { partes: ["ref", "cor"], cor_no_nome: "x" }, erro: 'Parte do SKU desconhecida: "cor".' },
  { entrada: { partes: ["ref", "ref"], cor_no_nome: 5 }, erro: "Parte do SKU repetida: ref." },
  { entrada: { partes: "ref", cor_no_nome: "x" }, erro: "Formato do SKU inválido: partes." },
  // …e ANTES dos separadores (que só são lidos com partes)
  { entrada: { partes: ["ref", "tamanho"], separadores: { "ref|tamanho": "#" }, cor_no_nome: "x" },
    erro: "Cor no nome da sublinha inválida (use cor_base ou cor_apelido)." },
];

export const CASOS_TAMANHOS_SKU: ({ entrada: unknown; esperado: Record<string, string> | null } | { entrada: unknown; erro: string })[] = [
  { entrada: null, esperado: null },
  { entrada: {}, esperado: null },
  { entrada: { "34": "34", PPP: " ppp ", PP: "", " P ": "p", M: null }, esperado: { "34": "34", PPP: "PPP", P: "P" } },
  { entrada: { " ": "X" }, esperado: null },
  { entrada: [], erro: "Siglas de tamanho inválidas." },
  { entrada: { "34": 34 }, erro: "Sigla de tamanho inválida: 34." },
  { entrada: { "34": "A", " 34": "B" }, erro: "Sigla de tamanho repetida: 34." },
  // repetida vale mesmo com uma das siglas vazia, e não depende da ordem das chaves (jsonb × JS — G-plano NOTA)
  { entrada: { "34": "", " 34": "B" }, erro: "Sigla de tamanho repetida: 34." },
  { entrada: { " P": "", P: "B" }, erro: "Sigla de tamanho repetida: P." },
  { entrada: { PPP: "p p p", "36": "3-6" }, esperado: { PPP: "PPP", "36": "36" } },
  { entrada: { B: 1, A: 2 }, erro: "Sigla de tamanho inválida: A." },
];

const F_TODAS: SkuConfig = {
  partes: ["ref", "cor_base", "cor_apelido", "tamanho"],
  separadores: { "ref|cor_base": "-", "cor_base|cor_apelido": ".", "cor_apelido|tamanho": "/" },
};
const F_COLADO: SkuConfig = { partes: ["ref", "cor_base", "tamanho"], separadores: {} };
const F_APELIDO_1O: SkuConfig = {
  partes: ["cor_apelido", "ref", "tamanho"],
  separadores: { "cor_apelido|ref": "_", "ref|tamanho": "-" },
};

export const CASOS_MONTAR: { cfg: SkuConfig; valores: Record<string, string | null>; esperado: string }[] = [
  { cfg: F_COLADO, valores: { ref: "REF00000001", cor_base: "AM", tamanho: "34" }, esperado: "REF00000001AM34" },
  { cfg: F_COLADO, valores: { ref: "REF00000001", cor_base: "VD", tamanho: "PPP" }, esperado: "REF00000001VDPPP" },
  { cfg: F_TODAS, valores: { ref: "R1", cor_base: "AM", cor_apelido: "CAN", tamanho: "P" }, esperado: "R1-AM.CAN/P" },
  { cfg: F_TODAS, valores: { ref: "R1", cor_base: "AM", cor_apelido: null, tamanho: "P" }, esperado: "R1-AM/P" },
  { cfg: F_TODAS, valores: { ref: "R1", cor_base: "AM", cor_apelido: "", tamanho: null }, esperado: "R1-AM" },
  { cfg: F_APELIDO_1O, valores: { cor_apelido: null, ref: "R1", tamanho: "34" }, esperado: "R1-34" },
  { cfg: F_APELIDO_1O, valores: { cor_apelido: "CAN", ref: "R1", tamanho: "34" }, esperado: "CAN_R1-34" },
  { cfg: F_COLADO, valores: {}, esperado: "" },
];

const AM: SkuCor = { id: "00000000-0000-0000-0000-0000000000a1", nome: "Amarelo", sigla: "AM" };
const VD_SEM: SkuCor = { id: "00000000-0000-0000-0000-0000000000a2", nome: "Verde", sigla: null };
const CAN: SkuCor = { id: "00000000-0000-0000-0000-0000000000b1", nome: "Canário", sigla: "CAN" };
const MUS_SEM: SkuCor = { id: "00000000-0000-0000-0000-0000000000b2", nome: "Musgo", sigla: null };
const TSKU: Record<string, string> = { "34": "34", PPP: "PPP", "36": "36", PP: "PP", P: "P", "38": "38" };

export type CasoResolver = {
  entrada: {
    cfg: SkuConfig;
    ref: string | null;
    cor: SkuCor | null;
    apelido: SkuCor | null;
    tamanhoKey: string;
    tipo: TamanhoTipo;
    tamanhosSku: Record<string, string> | null;
  };
  esperado: { sku: string | null; faltas: SkuFalta[]; avisos: SkuFalta[] };
};

export const CASOS_RESOLVER: CasoResolver[] = [
  { entrada: { cfg: F_COLADO, ref: "REF00000001", cor: AM, apelido: null, tamanhoKey: "34|PPP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: "REF00000001AM34", faltas: [], avisos: [] } },
  { entrada: { cfg: F_COLADO, ref: "REF00000001", cor: AM, apelido: CAN, tamanhoKey: "34|PPP", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "REF00000001AMPPP", faltas: [], avisos: [] } },
  { entrada: { cfg: F_TODAS, ref: " R1 ", cor: AM, apelido: CAN, tamanhoKey: "38|P", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "R1-AM.CAN/P", faltas: [], avisos: [] } },
  { entrada: { cfg: F_TODAS, ref: "R1", cor: AM, apelido: null, tamanhoKey: "38|P", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: "R1-AM/38", faltas: [], avisos: [] } },
  // D4: apelido SEM sigla não bloqueia — vira aviso; aqui a linha para pela cor base e pelo tamanho (Q4)
  { entrada: { cfg: F_TODAS, ref: "R1", cor: VD_SEM, apelido: MUS_SEM, tamanhoKey: "40|M", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: null, faltas: [
      { atributo: "cor_base", id: VD_SEM.id, nome: "Verde" },
      { atributo: "tamanho", id: null, nome: "M" },
    ], avisos: [{ atributo: "cor_apelido", id: MUS_SEM.id, nome: "Musgo" }] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: null, apelido: null, tamanhoKey: "36", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: null, faltas: [{ atributo: "cor_base", id: null, nome: null }], avisos: [] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "36", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "R1AM36", faltas: [], avisos: [] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "PP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: "R1AMPP", faltas: [], avisos: [] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "UN", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "R1AM", faltas: [], avisos: [] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "UN", tipo: "letra", tamanhosSku: { UN: "U" } },
    esperado: { sku: "R1AMU", faltas: [], avisos: [] } },
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "44|GG", tipo: "letra", tamanhosSku: null },
    esperado: { sku: null, faltas: [{ atributo: "tamanho", id: null, nome: "GG" }], avisos: [] } },
  // o Formato não usa cor_apelido: apelido sem sigla não conta (nem falta, nem aviso)
  { entrada: { cfg: { partes: ["ref", "cor_base"], separadores: {} }, ref: "R1", cor: AM, apelido: MUS_SEM,
      tamanhoKey: "44|GG", tipo: "letra", tamanhosSku: null },
    esperado: { sku: "R1AM", faltas: [], avisos: [] } },
  // D4, Formato SEM cor_base: sem apelido ⇒ a sigla da cor base vai na posição do apelido — sem ela, falta (bloqueia)
  { entrada: { cfg: F_APELIDO_1O, ref: "R1", cor: VD_SEM, apelido: null, tamanhoKey: "34|PPP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: null, faltas: [{ atributo: "cor_base", id: VD_SEM.id, nome: "Verde" }], avisos: [] } },
  { entrada: { cfg: { partes: ["cor_apelido"], separadores: {} }, ref: "R1", cor: AM, apelido: null,
      tamanhoKey: "34|PPP", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "AM", faltas: [], avisos: [] } },
  // D4 (casos novos)
  { entrada: { cfg: F_TODAS, ref: "R1", cor: AM, apelido: MUS_SEM, tamanhoKey: "38|P", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "R1-AM/P", faltas: [], avisos: [{ atributo: "cor_apelido", id: MUS_SEM.id, nome: "Musgo" }] } },
  { entrada: { cfg: F_APELIDO_1O, ref: "R1", cor: AM, apelido: null, tamanhoKey: "34|PPP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: "AM_R1-34", faltas: [], avisos: [] } },
  { entrada: { cfg: F_APELIDO_1O, ref: "R1", cor: AM, apelido: MUS_SEM, tamanhoKey: "34|PPP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: "AM_R1-34", faltas: [], avisos: [{ atributo: "cor_apelido", id: MUS_SEM.id, nome: "Musgo" }] } },
  { entrada: { cfg: F_APELIDO_1O, ref: "R1", cor: AM, apelido: CAN, tamanhoKey: "34|PPP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: "CAN_R1-34", faltas: [], avisos: [] } },
  { entrada: { cfg: F_APELIDO_1O, ref: "R1", cor: VD_SEM, apelido: MUS_SEM, tamanhoKey: "34|PPP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: null, faltas: [{ atributo: "cor_base", id: VD_SEM.id, nome: "Verde" }],
      avisos: [{ atributo: "cor_apelido", id: MUS_SEM.id, nome: "Musgo" }] } },
  { entrada: { cfg: F_APELIDO_1O, ref: "R1", cor: null, apelido: null, tamanhoKey: "34|PPP", tipo: "numero", tamanhosSku: TSKU },
    esperado: { sku: null, faltas: [{ atributo: "cor_base", id: null, nome: null }], avisos: [] } },
  // apelido COM sigla: a cor base não é exigida quando o Formato não tem cor_base
  { entrada: { cfg: { partes: ["cor_apelido"], separadores: {} }, ref: "R1", cor: VD_SEM, apelido: CAN,
      tamanhoKey: "34|PPP", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: "CAN", faltas: [], avisos: [] } },
  // tamanhoKey = nome de propriedade do protótipo ("constructor"): tamanhosSku[lado] em JS puro devolveria a
  // função Object (herdada do protótipo, truthy) em vez de "sem sigla" — Object.hasOwn/->> devolvem falta nos dois.
  { entrada: { cfg: F_COLADO, ref: "R1", cor: AM, apelido: null, tamanhoKey: "constructor", tipo: "letra", tamanhosSku: TSKU },
    esperado: { sku: null, faltas: [{ atributo: "tamanho", id: null, nome: "constructor" }], avisos: [] } },
];
