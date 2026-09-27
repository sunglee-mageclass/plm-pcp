// Integração + API — catálogo dos 18 campos da API (ordem FIXA do layout do pedido — P-60 B) e das configurações da API.
// Fonte do banco: _integracao_layout() (migration 1) e _integracao_rotulos() (migration 2); o teste anti-drift compara os dois.
// "coluna" = onde o CARD grava o campo (mão dupla — a tela nunca tem cópia própria); "gate" = a regra do card (servidor:
// _integracao_gates — D24). Custo, cor base, cor apelido e tamanho = só leitura com "i" + "abrir card" (P-80 A).
export type CampoKey =
  | "nome" | "ref_sku" | "preco_anterior" | "preco_venda" | "peso" | "ncm" | "preco_custo" | "cor_base" | "cor_apelido"
  | "tamanho" | "titulo" | "descricao" | "keywords" | "metatag" | "comprimento" | "largura" | "altura" | "foto";
export type ColunaEditavel =
  | "nome" | "ref" | "preco_anterior" | "preco_venda" | "peso_kg" | "ncm" | "titulo_pagina" | "descricao_produto"
  | "comprimento_cm" | "largura_cm" | "altura_cm" | "fotos_modelo";
export type GateKey = "compartilhado" | "planejamento" | "preco" | "ref" | "sku" | "keywords";
export type TipoCampo = "texto" | "texto_longo" | "dinheiro" | "peso" | "medida" | "fotos" | "keywords" | "somente_leitura";
export type CampoDef = {
  key: CampoKey; rotulo: string; rotuloCurto: string; layout: boolean; soVariante: boolean; tipo: TipoCampo;
  coluna: ColunaEditavel | null; gate: GateKey | null; info?: string;
};

const INFO_COR = "Só leitura — vem da cor do tecido/variante, usada por outros produtos.";
export const CAMPOS: readonly CampoDef[] = [
  { key: "nome", rotulo: "Nome", rotuloCurto: "Nome", layout: true, soVariante: false, tipo: "texto", coluna: "nome", gate: "compartilhado" },
  { key: "ref_sku", rotulo: "REF / SKU", rotuloCurto: "REF / SKU", layout: true, soVariante: false, tipo: "texto", coluna: "ref", gate: "ref" },
  { key: "preco_anterior", rotulo: "Preço anterior", rotuloCurto: "Preço anterior", layout: true, soVariante: false, tipo: "dinheiro", coluna: "preco_anterior", gate: "preco" },
  { key: "preco_venda", rotulo: "Preço de venda", rotuloCurto: "Preço de venda", layout: true, soVariante: false, tipo: "dinheiro", coluna: "preco_venda", gate: "preco" },
  { key: "peso", rotulo: "Peso", rotuloCurto: "Peso", layout: true, soVariante: false, tipo: "peso", coluna: "peso_kg", gate: "planejamento" },
  { key: "ncm", rotulo: "NCM", rotuloCurto: "NCM", layout: true, soVariante: false, tipo: "texto", coluna: "ncm", gate: "planejamento" },
  { key: "preco_custo", rotulo: "Preço de custo", rotuloCurto: "Preço de custo", layout: true, soVariante: false, tipo: "somente_leitura", coluna: null, gate: null },
  { key: "cor_base", rotulo: "Cor base", rotuloCurto: "Cor base", layout: true, soVariante: true, tipo: "somente_leitura", coluna: null, gate: null, info: INFO_COR },
  { key: "cor_apelido", rotulo: "Cor apelido", rotuloCurto: "Cor apelido", layout: true, soVariante: true, tipo: "somente_leitura", coluna: null, gate: null, info: INFO_COR },
  { key: "tamanho", rotulo: "Tamanho", rotuloCurto: "Tamanho", layout: true, soVariante: true, tipo: "somente_leitura", coluna: null, gate: null, info: "Só leitura — vem da grade." },
  { key: "titulo", rotulo: "Título para a página", rotuloCurto: "Título", layout: true, soVariante: false, tipo: "texto", coluna: "titulo_pagina", gate: "planejamento" },
  { key: "descricao", rotulo: "Descrição", rotuloCurto: "Descrição", layout: true, soVariante: false, tipo: "texto_longo", coluna: "descricao_produto", gate: "compartilhado" },
  { key: "keywords", rotulo: "Keywords", rotuloCurto: "Keywords", layout: true, soVariante: false, tipo: "keywords", coluna: null, gate: "keywords" },
  { key: "metatag", rotulo: "Metatag Description", rotuloCurto: "Metatag Description", layout: true, soVariante: false, tipo: "texto_longo", coluna: "descricao_produto", gate: "compartilhado", info: "= Descrição (é o mesmo texto)." },
  { key: "comprimento", rotulo: "Comprimento", rotuloCurto: "Compr.", layout: true, soVariante: false, tipo: "medida", coluna: "comprimento_cm", gate: "planejamento" },
  { key: "largura", rotulo: "Largura", rotuloCurto: "Larg.", layout: true, soVariante: false, tipo: "medida", coluna: "largura_cm", gate: "planejamento" },
  { key: "altura", rotulo: "Altura", rotuloCurto: "Alt.", layout: true, soVariante: false, tipo: "medida", coluna: "altura_cm", gate: "planejamento" },
  { key: "foto", rotulo: "Foto", rotuloCurto: "Foto", layout: false, soVariante: false, tipo: "fotos", coluna: "fotos_modelo", gate: "compartilhado" },
];
export const CAMPO_BY_KEY: Map<CampoKey, CampoDef> = new Map(CAMPOS.map((c) => [c.key, c]));
export const LAYOUT_KEYS: CampoKey[] = CAMPOS.map((c) => c.key);
export const CAMPOS_PADRAO: CampoKey[] = CAMPOS.filter((c) => c.layout).map((c) => c.key);
export function ordenarCampos(keys: readonly string[]): CampoKey[] {
  const set = new Set(keys);
  return LAYOUT_KEYS.filter((k) => set.has(k));
}
const EXTRA_TRAVA: Record<string, string> = {
  tamanho_tipo: "Tamanho em", sku: "SKUs", variantes: "cores/variantes", vinculo: "vínculo do produto", produto: "produto",
};
export function rotuloDoCampoTravado(campo: string): string {
  return EXTRA_TRAVA[campo] ?? CAMPO_BY_KEY.get(campo as CampoKey)?.rotulo ?? campo;
}
export function infoCusto(origem: string): string {
  if (origem === "revenda") return "Só leitura — revenda: valor da OC (bruto − desconto) + insumos.";
  if (origem === "importado") return "Só leitura — importado: custo de chegada (câmbio + frete) + insumos.";
  return "Só leitura — soma da ficha: tecido + aviamentos + insumos + mão de obra.";
}

export type ChaveConfigApi = "limite_por_minuto" | "max_por_pagina" | "validade_foto_dias" | "bloqueio_tentativas";
export const CONFIG_API: Record<ChaveConfigApi, { rotulo: string; rotuloCurto: string; recomendado: number; min: number; max: number; unidade: string }> = {
  limite_por_minuto: { rotulo: "Limite de consultas por minuto, por chave", rotuloCurto: "Limite por minuto", recomendado: 60, min: 1, max: 600, unidade: "consultas/min" },
  max_por_pagina: { rotulo: "Máximo de produtos por página", rotuloCurto: "Máximo por página", recomendado: 50, min: 1, max: 500, unidade: "produtos" },
  validade_foto_dias: { rotulo: "Validade dos links das fotos (dias)", rotuloCurto: "Validade das fotos", recomendado: 7, min: 1, max: 30, unidade: "dias" },
  bloqueio_tentativas: { rotulo: "Bloqueio de IP após N chaves erradas em 10 min", rotuloCurto: "Bloqueio de IP", recomendado: 10, min: 3, max: 100, unidade: "tentativas" },
};
export const CHAVES_CONFIG_API = Object.keys(CONFIG_API) as ChaveConfigApi[];
export function validarConfigApi(v: Record<ChaveConfigApi, number>): { erros: Partial<Record<ChaveConfigApi, string>>; foraRecomendado: ChaveConfigApi[] } {
  const erros: Partial<Record<ChaveConfigApi, string>> = {};
  const foraRecomendado: ChaveConfigApi[] = [];
  for (const k of CHAVES_CONFIG_API) {
    const c = CONFIG_API[k];
    const n = v[k];
    if (!Number.isInteger(n) || n < c.min || n > c.max) {
      erros[k] = `${c.rotuloCurto}: ${Number.isFinite(n) ? n : "valor"} está fora da faixa permitida (${c.min}–${c.max}). Corrija para salvar.`;
    } else if (n !== c.recomendado) {
      foraRecomendado.push(k);
    }
  }
  return { erros, foraRecomendado };
}
// P-89 A (dono 27/set): plano GRATUITO do Cloudflare = 10 ms de CPU por consulta. Padrão/recomendado 50; a faixa segue 1–500
// (aumentar depois = mudar aqui na aba API, sem migration nem deploy); ACIMA de 100, alerta próprio além do "fora do recomendado".
export const PAGINA_MAX_PLANO_GRATUITO = 100;
export const TEXTO_ALERTA_PAGINA_PLANO_GRATUITO =
  "Acima de 100 pode passar do limite de processamento do plano gratuito do Cloudflare (10 ms por consulta). Só use com o plano pago (Workers Paid).";
export function alertaPaginaPlanoGratuito(maxPorPagina: number): string | null {
  return Number.isInteger(maxPorPagina) && maxPorPagina > PAGINA_MAX_PLANO_GRATUITO ? TEXTO_ALERTA_PAGINA_PLANO_GRATUITO : null;
}
export const TEXTO_ALERTA_INTEGRAR = "Você tem certeza? Se estiver errado, você poderá ser demitido";
export const TEXTO_ALERTA_LAYOUT =
  "Este campo faz parte do layout obrigatório da API. Se ele sair, o programa do dev pode deixar de funcionar. Tem certeza?";
export const TEXTO_MAO_DUPLA =
  "Os campos editados aqui são os MESMOS do card do produto — mudou aqui, muda lá (e vice-versa), enquanto não estiver integrável.";
