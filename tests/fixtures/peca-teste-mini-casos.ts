// Fixture ANTI-DRIFT da mini explosao da Peca Teste (urg R11, 199300): TS (`linhasUmaPeca`/`alocarTecido`) x SQL
// (`_peca_teste_mini_linhas`/`_peca_teste_tecido_baixar`). Os CASOS sao consumidos pelo unit `tests/unit/peca-teste-mini.test.ts`
// e pela integracao `tests/integration/urgd-r11-regras.test.ts` (que semeia a MESMA estrutura no banco e compara).
// Mudou a regra? Mude TS, SQL e esta fixture. Ids SAO placeholders estaveis (a integracao mapeia placeholder -> uuid semeado).

import type {
  AjusteLinha, ModeloBom, MiniLinha, OcLink, OcLote, FonteTecido,
} from "@/lib/peca-teste-mini";

// Placeholders de uuid (a integracao troca por uuids reais; o unit usa como strings opacas).
export const V1 = "v1", V2 = "v2", V3 = "v3"; // variantes do Tecido 1
export const AVI1 = "avi1", AVI2 = "avi2";
export const AV1 = "av1", AV2 = "av2", AV3 = "av3"; // variantes de aviamento
export const ETQ1 = "etq1", ETQ2 = "etq2";
export const COR1 = "cor1", COR2 = "cor2";
export const OC_A = "ocItemA", OC_B = "ocItemB", OC_C = "ocItemC";

export type CasoLinhas = {
  nome: string;
  bom: ModeloBom;
  tamanho: string | null;
  /** ordem da variante V escolhida no Tecido 1 (null = card sem Tecido 1 / sem V). */
  ordemN: number | null;
  varianteV: string | null;
  ajustes: Record<string, AjusteLinha>;
  esperado: MiniLinha[];
};

// Helpers de montagem (reduzem ruido nos casos).
const t1 = (variantes: ModeloBom["tecidos"][number]["variantes"], consumo = 1, loss = 0): ModeloBom["tecidos"][number] =>
  ({ tipo: "tecido", numero: 1, consumo, loss_percent: loss, variantes });
const forro = (numero: number, variantes: ModeloBom["tecidos"][number]["variantes"], consumo = 1, loss = 0): ModeloBom["tecidos"][number] =>
  ({ tipo: "forro", numero, consumo, loss_percent: loss, variantes });
const varT = (ordem: number, id: string | null, opt: { mult?: number; casa?: string[]; nome?: string } = {}) =>
  ({ ordem, variante_tecido_id: id, multiplicador: opt.mult ?? 1, complementa_variante_ids: opt.casa ?? null, nome_variante: opt.nome ?? null });

const bomVazio = (over: Partial<ModeloBom> = {}): ModeloBom =>
  ({ tecidos: [], aviamentos: [], insumos: [], corDeV: null, ...over });

// Linha esperada: so os campos que a comparacao confere (4 casas).
const L = (p: Partial<MiniLinha> & Pick<MiniLinha, "chave" | "familia" | "necessaria" | "a_enviar">): MiniLinha => ({
  rotulo: "", variante_rotulo: null, unidade: p.familia === "tecido" ? "m" : "un",
  tipo: null, numero: null, ordem: null, variante_tecido_id: null, pecas: p.familia === "tecido" ? 1 : 1,
  aviamento_id: null, variante_aviamento_id: null, etiqueta_id: null, cor_id: null, tamanho_bucket: null,
  consumo: 0, loss_percent: 0, oc_tecido_item_id: null, ...p,
});

export const CASOS_MINI_LINHAS: CasoLinhas[] = [
  // 1) Tecido 1: so a variante de ordem N entra (V = ordem 1).
  {
    nome: "T1 so a variante de ordem N",
    bom: bomVazio({ tecidos: [t1([varT(1, V1), varT(2, V2)], 2, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 2, necessaria: 2, a_enviar: 2 })],
  },
  // 2) Tecido 1 com V = ordem 2.
  {
    nome: "T1 V = ordem 2",
    bom: bomVazio({ tecidos: [t1([varT(1, V1), varT(2, V2)], 1.5, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 2, varianteV: V2, ajustes: {},
    esperado: [L({ chave: "t:tecido:1:2:v2", familia: "tecido", tipo: "tecido", numero: 1, ordem: 2, variante_tecido_id: V2, consumo: 1.5, necessaria: 1.5, a_enviar: 1.5 })],
  },
  // 3) Forro SEM casamento -> a variante de ordem N.
  {
    nome: "forro sem casamento -> ordem N",
    bom: bomVazio({ tecidos: [t1([varT(1, V1), varT(2, V2)], 1, 0), forro(1, [varT(1, V3)], 0.8, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [
      L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1, necessaria: 1, a_enviar: 1 }),
      L({ chave: "t:forro:1:1:v3", familia: "tecido", tipo: "forro", numero: 1, ordem: 1, variante_tecido_id: V3, consumo: 0.8, necessaria: 0.8, a_enviar: 0.8 }),
    ],
  },
  // 4) Forro casado com V (entra).
  {
    nome: "forro casado com V",
    bom: bomVazio({ tecidos: [t1([varT(1, V1), varT(2, V2)], 1, 0), forro(1, [varT(1, V3, { casa: [V1] })], 0.5, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [
      L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1, necessaria: 1, a_enviar: 1 }),
      L({ chave: "t:forro:1:1:v3", familia: "tecido", tipo: "forro", numero: 1, ordem: 1, variante_tecido_id: V3, consumo: 0.5, necessaria: 0.5, a_enviar: 0.5 }),
    ],
  },
  // 5) Forro casado com OUTRA (nao entra).
  {
    nome: "forro casado com outra -> fora",
    bom: bomVazio({ tecidos: [t1([varT(1, V1), varT(2, V2)], 1, 0), forro(1, [varT(1, V3, { casa: [V2] })], 0.5, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1, necessaria: 1, a_enviar: 1 })],
  },
  // 6) Multiplicador 2.
  {
    nome: "multiplicador 2",
    bom: bomVazio({ tecidos: [t1([varT(1, V1, { mult: 2 })], 1.2, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, pecas: 2, consumo: 1.2, necessaria: 2.4, a_enviar: 2.4 })],
  },
  // 7) consumo/loss ajustados.
  {
    nome: "consumo e loss ajustados",
    bom: bomVazio({ tecidos: [t1([varT(1, V1)], 1, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: { "t:tecido:1:1:v1": { consumo: 2, loss_percent: 10 } },
    esperado: [L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 2, loss_percent: 10, necessaria: 2.2, a_enviar: 2.2 })],
  },
  // 8) a_enviar ajustado (necessaria 1, a_enviar 0.5).
  {
    nome: "a_enviar ajustado",
    bom: bomVazio({ tecidos: [t1([varT(1, V1)], 1, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: { "t:tecido:1:1:v1": { a_enviar: 0.5 } },
    esperado: [L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1, necessaria: 1, a_enviar: 0.5 })],
  },
  // 9) meio centavo: 1.005 -> 1.01 (round 2).
  {
    nome: "meio centavo 1.005 -> 1.01",
    bom: bomVazio({ tecidos: [t1([varT(1, V1)], 1.005, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1.005, necessaria: 1.01, a_enviar: 1.01 })],
  },
  // 10) meio centavo: 1.5 x (1+5%) = 1.575 -> 1.58 (round 2).
  {
    nome: "meio centavo 1.5 x 1.05 -> 1.58",
    bom: bomVazio({ tecidos: [t1([varT(1, V1)], 1.5, 5)], corDeV: COR1 }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1.5, loss_percent: 5, necessaria: 1.58, a_enviar: 1.58 })],
  },
  // 11) aviamento variante POR COR de V (unica). Precisa de Tecido 1 com V (de onde a cor de V vem).
  {
    nome: "aviamento variante por cor de V",
    bom: bomVazio({
      corDeV: COR1,
      tecidos: [t1([varT(1, V1)], 1, 0)],
      aviamentos: [{ aviamento_id: AVI1, numero: 1, consumo: 3, variante_aviamento_id: null,
        variantes: [{ variante_aviamento_id: AV1, cor_id: COR1 }, { variante_aviamento_id: AV2, cor_id: COR2 }] }],
    }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [
      L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1, necessaria: 1, a_enviar: 1 }),
      L({ chave: "a:avi1:1", familia: "aviamento", numero: 1, aviamento_id: AVI1, variante_aviamento_id: AV1, consumo: 3, necessaria: 3, a_enviar: 3 }),
    ],
  },
  // 12) aviamento variante do BOM (cor de V nao resolve unica: 2 variantes com a cor de V).
  {
    nome: "aviamento variante do BOM",
    bom: bomVazio({
      corDeV: COR1,
      tecidos: [t1([varT(1, V1)], 1, 0)],
      aviamentos: [{ aviamento_id: AVI1, numero: 1, consumo: 2, variante_aviamento_id: AV2,
        variantes: [{ variante_aviamento_id: AV1, cor_id: COR1 }, { variante_aviamento_id: AV2, cor_id: COR1 }] }],
    }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [
      L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1, necessaria: 1, a_enviar: 1 }),
      L({ chave: "a:avi1:1", familia: "aviamento", numero: 1, aviamento_id: AVI1, variante_aviamento_id: AV2, consumo: 2, necessaria: 2, a_enviar: 2 }),
    ],
  },
  // 13) aviamento variante UNICA (sem cor de V, sem BOM).
  {
    nome: "aviamento variante unica",
    bom: bomVazio({
      corDeV: null,
      aviamentos: [{ aviamento_id: AVI1, numero: 1, consumo: 1, variante_aviamento_id: null,
        variantes: [{ variante_aviamento_id: AV1, cor_id: COR1 }] }],
    }),
    tamanho: "M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [L({ chave: "a:avi1:1", familia: "aviamento", numero: 1, aviamento_id: AVI1, variante_aviamento_id: AV1, consumo: 1, necessaria: 1, a_enviar: 1 })],
  },
  // 14) aviamento variante NULL (2+ variantes, sem cor de V, sem BOM).
  {
    nome: "aviamento variante NULL (sem variante)",
    bom: bomVazio({
      corDeV: null,
      aviamentos: [{ aviamento_id: AVI1, numero: 1, consumo: 1, variante_aviamento_id: null,
        variantes: [{ variante_aviamento_id: AV1, cor_id: COR1 }, { variante_aviamento_id: AV2, cor_id: COR2 }] }],
    }),
    tamanho: "M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [L({ chave: "a:avi1:1", familia: "aviamento", numero: 1, aviamento_id: AVI1, variante_aviamento_id: null, consumo: 1, necessaria: 1, a_enviar: 1 })],
  },
  // 15) 2 linhas do MESMO aviamento (k = 1, 2).
  {
    nome: "duas linhas do mesmo aviamento (k)",
    bom: bomVazio({
      corDeV: null,
      aviamentos: [
        { aviamento_id: AVI1, numero: 1, consumo: 1, variante_aviamento_id: AV1, variantes: [{ variante_aviamento_id: AV1, cor_id: COR1 }] },
        { aviamento_id: AVI1, numero: 2, consumo: 2, variante_aviamento_id: AV1, variantes: [{ variante_aviamento_id: AV1, cor_id: COR1 }] },
      ],
    }),
    tamanho: "M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [
      L({ chave: "a:avi1:1", familia: "aviamento", numero: 1, aviamento_id: AVI1, variante_aviamento_id: AV1, consumo: 1, necessaria: 1, a_enviar: 1 }),
      L({ chave: "a:avi1:2", familia: "aviamento", numero: 2, aviamento_id: AVI1, variante_aviamento_id: AV1, consumo: 2, necessaria: 2, a_enviar: 2 }),
    ],
  },
  // 16) aviamento com variante ajustada (ajuste explicito vence a padrao). Tecido 1 presente (cor de V).
  {
    nome: "aviamento variante ajustada",
    bom: bomVazio({
      corDeV: COR1,
      tecidos: [t1([varT(1, V1)], 1, 0)],
      aviamentos: [{ aviamento_id: AVI1, numero: 1, consumo: 1, variante_aviamento_id: null,
        variantes: [{ variante_aviamento_id: AV1, cor_id: COR1 }, { variante_aviamento_id: AV2, cor_id: COR2 }] }],
    }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: { "a:avi1:1": { variante_aviamento_id: AV2 } },
    esperado: [
      L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1, necessaria: 1, a_enviar: 1 }),
      L({ chave: "a:avi1:1", familia: "aviamento", numero: 1, aviamento_id: AVI1, variante_aviamento_id: AV2, consumo: 1, necessaria: 1, a_enviar: 1 }),
    ],
  },
  // 17) insumo vinculado = T (entra; vinculo efetivo exige insumo SEM tamanho proprio -> formato nenhum; bucket = NULL).
  {
    nome: "insumo vinculado = T",
    bom: bomVazio({
      insumos: [{ etiqueta_id: ETQ1, cor_id: null, numero: 1, consumo: 5, tamanho_vinculado: "40|M",
        formato_tamanho: "nenhum", variantes_etiqueta: [] }],
    }),
    tamanho: "40|M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [L({ chave: "i:etq1:-:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: null, tamanho_bucket: null, consumo: 5, necessaria: 5, a_enviar: 5 })],
  },
  // 18) insumo vinculado != T (fora; vinculo efetivo -> formato nenhum).
  {
    nome: "insumo vinculado != T -> fora",
    bom: bomVazio({
      insumos: [{ etiqueta_id: ETQ1, cor_id: null, numero: 1, consumo: 5, tamanho_vinculado: "42|G",
        formato_tamanho: "nenhum", variantes_etiqueta: [] }],
    }),
    tamanho: "40|M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [],
  },
  // 18b) insumo vinculado a T mas COM tamanho proprio (formato letra + variante) -> vinculo IGNORADO -> entra, bucket T.
  {
    nome: "insumo vinculado ignorado (tem tamanho proprio) -> entra",
    bom: bomVazio({
      insumos: [{ etiqueta_id: ETQ1, cor_id: null, numero: 1, consumo: 5, tamanho_vinculado: "42|G",
        formato_tamanho: "letra", variantes_etiqueta: [{ tamanho: "40|M" }, { tamanho: "42|G" }] }],
    }),
    tamanho: "40|M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [L({ chave: "i:etq1:-:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: null, tamanho_bucket: "40|M", consumo: 5, necessaria: 5, a_enviar: 5 })],
  },
  // 19) insumo com tamanho proprio, SEM vinculo -> bucket = T.
  {
    nome: "insumo com tamanho proprio -> bucket T",
    bom: bomVazio({
      insumos: [{ etiqueta_id: ETQ1, cor_id: null, numero: 1, consumo: 2, tamanho_vinculado: null,
        formato_tamanho: "letra", variantes_etiqueta: [{ tamanho: "40|M" }] }],
    }),
    tamanho: "40|M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [L({ chave: "i:etq1:-:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: null, tamanho_bucket: "40|M", consumo: 2, necessaria: 2, a_enviar: 2 })],
  },
  // 20) insumo SEM tamanho proprio (formato nenhum) -> bucket NULL.
  {
    nome: "insumo formato nenhum -> bucket NULL",
    bom: bomVazio({
      insumos: [{ etiqueta_id: ETQ1, cor_id: null, numero: 1, consumo: 2, tamanho_vinculado: null,
        formato_tamanho: "nenhum", variantes_etiqueta: [] }],
    }),
    tamanho: "40|M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [L({ chave: "i:etq1:-:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: null, tamanho_bucket: null, consumo: 2, necessaria: 2, a_enviar: 2 })],
  },
  // 21) insumo sem variante com tamanho (todas NULL) -> bucket NULL.
  {
    nome: "insumo sem variante com tamanho -> bucket NULL",
    bom: bomVazio({
      insumos: [{ etiqueta_id: ETQ1, cor_id: null, numero: 1, consumo: 1, tamanho_vinculado: null,
        formato_tamanho: "ambos", variantes_etiqueta: [{ tamanho: null }] }],
    }),
    tamanho: "40|M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [L({ chave: "i:etq1:-:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: null, tamanho_bucket: null, consumo: 1, necessaria: 1, a_enviar: 1 })],
  },
  // 22) insumo variante com tamanho ' ' (so espaco) -> SEM tamanho proprio (btrim) -> bucket NULL.
  {
    nome: "insumo variante tamanho ' ' (espaco) -> bucket NULL",
    bom: bomVazio({
      insumos: [{ etiqueta_id: ETQ1, cor_id: null, numero: 1, consumo: 1, tamanho_vinculado: null,
        formato_tamanho: "ambos", variantes_etiqueta: [{ tamanho: " " }] }],
    }),
    tamanho: "40|M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [L({ chave: "i:etq1:-:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: null, tamanho_bucket: null, consumo: 1, necessaria: 1, a_enviar: 1 })],
  },
  // 23) insumo com cor (cor_id na chave e no bucket).
  {
    nome: "insumo com cor",
    bom: bomVazio({
      insumos: [{ etiqueta_id: ETQ1, cor_id: COR1, numero: 1, consumo: 4, tamanho_vinculado: null,
        formato_tamanho: "nenhum", variantes_etiqueta: [] }],
    }),
    tamanho: "M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [L({ chave: "i:etq1:cor1:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: COR1, tamanho_bucket: null, consumo: 4, necessaria: 4, a_enviar: 4 })],
  },
  // 24) 2 linhas do mesmo insumo+cor (k = 1, 2).
  {
    nome: "duas linhas do mesmo insumo+cor (k)",
    bom: bomVazio({
      insumos: [
        { etiqueta_id: ETQ1, cor_id: COR1, numero: 1, consumo: 1, tamanho_vinculado: null, formato_tamanho: "nenhum", variantes_etiqueta: [] },
        { etiqueta_id: ETQ1, cor_id: COR1, numero: 2, consumo: 2, tamanho_vinculado: null, formato_tamanho: "nenhum", variantes_etiqueta: [] },
      ],
    }),
    tamanho: "M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [
      L({ chave: "i:etq1:cor1:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: COR1, consumo: 1, necessaria: 1, a_enviar: 1 }),
      L({ chave: "i:etq1:cor1:2", familia: "insumo", numero: 2, etiqueta_id: ETQ1, cor_id: COR1, consumo: 2, necessaria: 2, a_enviar: 2 }),
    ],
  },
  // 25) insumo necessaria 4 casas (consumo 1.23455 -> 1.2346... round 4 = 1.2346).
  {
    nome: "insumo round 4 casas",
    bom: bomVazio({
      insumos: [{ etiqueta_id: ETQ1, cor_id: null, numero: 1, consumo: 1.23455, tamanho_vinculado: null, formato_tamanho: "nenhum", variantes_etiqueta: [] }],
    }),
    tamanho: "M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [L({ chave: "i:etq1:-:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: null, consumo: 1.23455, necessaria: 1.2346, a_enviar: 1.2346 })],
  },
  // 26) BOM sem Tecido 1 (so forro) -> sem V/ordem N a cor nao se aplica e o forro uncasado nao resolve ordem (nao entra);
  //     a variante do aviamento pula o passo 1 (cor de V) e cai no BOM (AV2).
  {
    nome: "BOM sem Tecido 1",
    bom: bomVazio({
      corDeV: null,
      tecidos: [forro(1, [varT(1, V3)], 1, 0)],
      aviamentos: [{ aviamento_id: AVI1, numero: 1, consumo: 1, variante_aviamento_id: AV2,
        variantes: [{ variante_aviamento_id: AV1, cor_id: COR1 }, { variante_aviamento_id: AV2, cor_id: COR2 }] }],
    }),
    tamanho: "M", ordemN: null, varianteV: null, ajustes: {},
    esperado: [
      L({ chave: "a:avi1:1", familia: "aviamento", numero: 1, aviamento_id: AVI1, variante_aviamento_id: AV2, consumo: 1, necessaria: 1, a_enviar: 1 }),
    ],
  },
  // 27) V fora do BOM (ordem N que nao existe) -> Tecido 1 nao entra.
  {
    nome: "V fora do BOM (ordem inexistente)",
    bom: bomVazio({ tecidos: [t1([varT(1, V1), varT(2, V2)], 1, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 3, varianteV: V3, ajustes: {},
    esperado: [],
  },
  // 28) consumo nulo no BOM -> necessaria 0 (linha entra se pecas > 0).
  {
    nome: "tecido consumo nulo -> necessaria 0",
    bom: bomVazio({ tecidos: [t1([varT(1, V1)], null, 0)], corDeV: COR1 }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 0, necessaria: 0, a_enviar: 0 })],
  },
  // 29) tecido + aviamento + insumo juntos (caso cheio).
  {
    nome: "caso cheio (3 familias)",
    bom: bomVazio({
      corDeV: COR1,
      tecidos: [t1([varT(1, V1)], 1.3, 10)],
      aviamentos: [{ aviamento_id: AVI1, numero: 1, consumo: 6, variante_aviamento_id: null, variantes: [{ variante_aviamento_id: AV1, cor_id: COR1 }] }],
      insumos: [{ etiqueta_id: ETQ1, cor_id: null, numero: 1, consumo: 2, tamanho_vinculado: null, formato_tamanho: "nenhum", variantes_etiqueta: [] }],
    }),
    tamanho: "40|M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [
      L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1.3, loss_percent: 10, necessaria: 1.43, a_enviar: 1.43 }),
      L({ chave: "a:avi1:1", familia: "aviamento", numero: 1, aviamento_id: AVI1, variante_aviamento_id: AV1, consumo: 6, necessaria: 6, a_enviar: 6 }),
      L({ chave: "i:etq1:-:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: null, consumo: 2, necessaria: 2, a_enviar: 2 }),
    ],
  },
  // 30) forro mult 2 casado com V -> pecas 2.
  {
    nome: "forro casado mult 2",
    bom: bomVazio({ corDeV: COR1, tecidos: [t1([varT(1, V1)], 1, 0), forro(1, [varT(1, V3, { mult: 2, casa: [V1] })], 0.5, 0)] }),
    tamanho: "M", ordemN: 1, varianteV: V1, ajustes: {},
    esperado: [
      L({ chave: "t:tecido:1:1:v1", familia: "tecido", tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1, consumo: 1, necessaria: 1, a_enviar: 1 }),
      L({ chave: "t:forro:1:1:v3", familia: "tecido", tipo: "forro", numero: 1, ordem: 1, variante_tecido_id: V3, pecas: 2, consumo: 0.5, necessaria: 1, a_enviar: 1 }),
    ],
  },
  // 31) a_enviar ajustado no aviamento e no insumo.
  {
    nome: "a_enviar ajustado aviamento + insumo",
    bom: bomVazio({
      corDeV: COR1,
      aviamentos: [{ aviamento_id: AVI1, numero: 1, consumo: 3, variante_aviamento_id: AV1, variantes: [{ variante_aviamento_id: AV1, cor_id: COR1 }] }],
      insumos: [{ etiqueta_id: ETQ1, cor_id: null, numero: 1, consumo: 2, tamanho_vinculado: null, formato_tamanho: "nenhum", variantes_etiqueta: [] }],
    }),
    tamanho: "M", ordemN: null, varianteV: null, ajustes: { "a:avi1:1": { a_enviar: 1 }, "i:etq1:-:1": { a_enviar: 0 } },
    esperado: [
      L({ chave: "a:avi1:1", familia: "aviamento", numero: 1, aviamento_id: AVI1, variante_aviamento_id: AV1, consumo: 3, necessaria: 3, a_enviar: 1 }),
      L({ chave: "i:etq1:-:1", familia: "insumo", numero: 1, etiqueta_id: ETQ1, cor_id: null, consumo: 2, necessaria: 2, a_enviar: 0 }),
    ],
  },
];

export type CasoAlocar = {
  nome: string;
  modo: "por_oc" | "automatico";
  mesma_oc: boolean;
  itemEscolhido: string | null;
  metros: number;
  vinculos: OcLink[];
  fifo: OcLote[];
  esperado: { baixado: number; fontes: FonteTecido[] };
};

export const CASOS_MINI_ALOCAR: CasoAlocar[] = [
  // 1) por_oc: 1 vinculo cobre tudo.
  {
    nome: "por_oc 1 vinculo cobre tudo", modo: "por_oc", mesma_oc: true, itemEscolhido: null, metros: 3,
    vinculos: [{ oc_tecido_item_id: OC_A, quantidade_m: 0, prioridade: 1 }],
    fifo: [{ oc_tecido_item_id: OC_A, saldo: 10 }],
    esperado: { baixado: 3, fontes: [{ oc_tecido_item_id: OC_A, metros: 3 }] },
  },
  // 2) por_oc: vinculo com teto quantidade_m, depois FIFO fora.
  {
    nome: "por_oc teto + FIFO", modo: "por_oc", mesma_oc: true, itemEscolhido: null, metros: 5,
    vinculos: [{ oc_tecido_item_id: OC_A, quantidade_m: 2, prioridade: 1 }],
    fifo: [{ oc_tecido_item_id: OC_A, saldo: 10 }, { oc_tecido_item_id: OC_B, saldo: 10 }],
    esperado: { baixado: 5, fontes: [{ oc_tecido_item_id: OC_A, metros: 2 }, { oc_tecido_item_id: OC_B, metros: 3 }] },
  },
  // 3) por_oc: dois vinculos por prioridade.
  {
    nome: "por_oc dois vinculos por prioridade", modo: "por_oc", mesma_oc: true, itemEscolhido: null, metros: 7,
    vinculos: [{ oc_tecido_item_id: OC_B, quantidade_m: 0, prioridade: 2 }, { oc_tecido_item_id: OC_A, quantidade_m: 3, prioridade: 1 }],
    fifo: [{ oc_tecido_item_id: OC_A, saldo: 5 }, { oc_tecido_item_id: OC_B, saldo: 5 }],
    esperado: { baixado: 7, fontes: [{ oc_tecido_item_id: OC_A, metros: 3 }, { oc_tecido_item_id: OC_B, metros: 4 }] },
  },
  // 4) automatico: so FIFO (ignora vinculos).
  {
    nome: "automatico so FIFO", modo: "automatico", mesma_oc: true, itemEscolhido: null, metros: 4,
    vinculos: [{ oc_tecido_item_id: OC_A, quantidade_m: 0, prioridade: 1 }],
    fifo: [{ oc_tecido_item_id: OC_B, saldo: 2 }, { oc_tecido_item_id: OC_A, saldo: 10 }],
    esperado: { baixado: 4, fontes: [{ oc_tecido_item_id: OC_B, metros: 2 }, { oc_tecido_item_id: OC_A, metros: 2 }] },
  },
  // 5) desmarcado com item escolhido.
  {
    nome: "desmarcado item escolhido", modo: "por_oc", mesma_oc: false, itemEscolhido: OC_B, metros: 3,
    vinculos: [{ oc_tecido_item_id: OC_A, quantidade_m: 0, prioridade: 1 }],
    fifo: [{ oc_tecido_item_id: OC_A, saldo: 10 }, { oc_tecido_item_id: OC_B, saldo: 10 }],
    esperado: { baixado: 3, fontes: [{ oc_tecido_item_id: OC_B, metros: 3 }] },
  },
  // 6) desmarcado sem item -> nada.
  {
    nome: "desmarcado sem item -> nada", modo: "por_oc", mesma_oc: false, itemEscolhido: null, metros: 3,
    vinculos: [], fifo: [{ oc_tecido_item_id: OC_A, saldo: 10 }],
    esperado: { baixado: 0, fontes: [] },
  },
  // 7) saldo 0 no vinculo -> cai no FIFO.
  {
    nome: "vinculo saldo 0 -> FIFO fora", modo: "por_oc", mesma_oc: true, itemEscolhido: null, metros: 2,
    vinculos: [{ oc_tecido_item_id: OC_A, quantidade_m: 0, prioridade: 1 }],
    fifo: [{ oc_tecido_item_id: OC_A, saldo: 0 }, { oc_tecido_item_id: OC_B, saldo: 5 }],
    esperado: { baixado: 2, fontes: [{ oc_tecido_item_id: OC_B, metros: 2 }] },
  },
  // 8) OC nao recebida (ausente do fifo) -> sem saldo.
  {
    nome: "OC nao recebida (fora do fifo)", modo: "por_oc", mesma_oc: true, itemEscolhido: null, metros: 2,
    vinculos: [{ oc_tecido_item_id: OC_A, quantidade_m: 0, prioridade: 1 }],
    fifo: [{ oc_tecido_item_id: OC_B, saldo: 5 }],
    esperado: { baixado: 2, fontes: [{ oc_tecido_item_id: OC_B, metros: 2 }] },
  },
  // 9) tudo falta (sem saldo).
  {
    nome: "tudo falta", modo: "por_oc", mesma_oc: true, itemEscolhido: null, metros: 3,
    vinculos: [{ oc_tecido_item_id: OC_A, quantidade_m: 0, prioridade: 1 }], fifo: [],
    esperado: { baixado: 0, fontes: [] },
  },
  // 10) falta parcial (saldo < metros).
  {
    nome: "falta parcial", modo: "automatico", mesma_oc: true, itemEscolhido: null, metros: 10,
    vinculos: [], fifo: [{ oc_tecido_item_id: OC_A, saldo: 4 }],
    esperado: { baixado: 4, fontes: [{ oc_tecido_item_id: OC_A, metros: 4 }] },
  },
  // 11) vinculo usado mesmo com saldo 0, FIFO nao repete o item usado.
  {
    nome: "vinculo marca usado mesmo saldo 0", modo: "por_oc", mesma_oc: true, itemEscolhido: null, metros: 3,
    vinculos: [{ oc_tecido_item_id: OC_A, quantidade_m: 0, prioridade: 1 }],
    fifo: [{ oc_tecido_item_id: OC_A, saldo: 0 }, { oc_tecido_item_id: OC_B, saldo: 10 }],
    esperado: { baixado: 3, fontes: [{ oc_tecido_item_id: OC_B, metros: 3 }] },
  },
  // 12) por_oc sem vinculos -> FIFO puro.
  {
    nome: "por_oc sem vinculos -> FIFO", modo: "por_oc", mesma_oc: true, itemEscolhido: null, metros: 6,
    vinculos: [], fifo: [{ oc_tecido_item_id: OC_A, saldo: 4 }, { oc_tecido_item_id: OC_B, saldo: 4 }],
    esperado: { baixado: 6, fontes: [{ oc_tecido_item_id: OC_A, metros: 4 }, { oc_tecido_item_id: OC_B, metros: 2 }] },
  },
  // 13) metros 0 -> nada.
  {
    nome: "metros 0 -> nada", modo: "por_oc", mesma_oc: true, itemEscolhido: null, metros: 0,
    vinculos: [{ oc_tecido_item_id: OC_A, quantidade_m: 0, prioridade: 1 }], fifo: [{ oc_tecido_item_id: OC_A, saldo: 10 }],
    esperado: { baixado: 0, fontes: [] },
  },
];
