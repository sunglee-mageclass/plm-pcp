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
  { key: "descricao", rotulo: "Descrição", rotuloCurto: "Descrição", layout: true, soVariante: false, tipo: "texto_longo", coluna: "descricao_produto", gate: "planejamento" },
  { key: "keywords", rotulo: "Keywords", rotuloCurto: "Keywords", layout: true, soVariante: false, tipo: "keywords", coluna: null, gate: "keywords" },
  { key: "metatag", rotulo: "Metatag Description", rotuloCurto: "Metatag Description", layout: true, soVariante: false, tipo: "texto_longo", coluna: "descricao_produto", gate: "planejamento", info: "= Descrição (é o mesmo texto)." },
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
// Fix round 2 T12b (minor m-R4): mapa reverso ColunaEditavel → rótulo curto do campo — usado pra nomear o campo no
// toast de `validarRascunho` (ex.: faixa numérica fora do permitido), que hoje só diz "…para este campo." mesmo
// com `erros[0].coluna` disponível. `CAMPO_BY_KEY` é indexado por `CampoKey` (chave da API), não por `coluna` (a
// coluna real do card) — como mais de um `CampoKey` pode apontar pra mesma coluna (ex.: "descricao"/"metatag" → a
// mesma `descricao_produto`), o PRIMEIRO achado no catálogo (`CAMPOS`, ordem fixa do layout) vira o rótulo
// canônico — `Map` nunca sobrescreve silenciosamente porque o `for` abaixo só define a chave quando ainda não
// existe (`!has`).
const CAMPO_POR_COLUNA = new Map<ColunaEditavel, string>();
for (const c of CAMPOS) {
  if (c.coluna !== null && !CAMPO_POR_COLUNA.has(c.coluna)) CAMPO_POR_COLUNA.set(c.coluna, c.rotuloCurto);
}
export function rotuloDaColuna(coluna: ColunaEditavel): string {
  return CAMPO_POR_COLUNA.get(coluna) ?? coluna;
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

// ── Aba "Campos da API" (Task 14) ──────────────────────────────────────────────────────────────────────────────────────
export const TEXTO_SO_SUPER = "Esta aba é só do super admin. Admin da loja e usuários com permissão veem só Produtos e Log.";
export const TEXTO_CAMPOS_REGRA =
  'Marcado = entra na API e é obrigatório para integrar. A ordem é sempre esta (layout fixo do pedido). Os campos do layout (1–17) vêm marcados por padrão numa loja NOVA; "Foto do Modelo" nasce DESMARCADA (opcional). Mudar a seleção vale só para as PRÓXIMAS integrações — retratos já gravados não mudam.';
export const TEXTO_TRAVA_SEMPRE = 'Travam sempre, marcados ou não: SKUs, cores e tamanhos das sublinhas e o "Tamanho em".';
export const TEXTO_CONFIRMAR_CAMPOS =
  "Esta mudança vale para as próximas integrações. Produtos já integrados mantêm o retrato gravado no momento da integração deles.";
// Fix round 1 T14 (revisão T14 #2, task-14-review.md Important I1): banner do P0409 — as suas mudanças (a
// seleção rebaseada) já estão aplicadas por cima da versão nova do servidor; "usar a da loja" descarta e "manter
// a minha" só fecha o aviso (o rascunho rebaseado já é o que está na tela).
// Fix round 2 T14 (revisão T14 #n1, task-14-review.md Minor n1): 3 textos, um por cenário — o mesmo tom do banner
// de conflito do KeywordsDialog (curto, sem prometer nada que não aconteceu):
// - TEXTO_CAMPOS_CONFLITO: outra pessoa mudou OS CAMPOS de verdade — a lista de campos muda (usado com o diff).
// - TEXTO_CAMPOS_CONFLITO_SO_REV: falso conflito — o rev mudou mas os campos são os MESMOS (alguém salvou só a
//   config da API da Task 15, que compartilha o mesmo rev). Nada pra rebasear de verdade.
// - TEXTO_CAMPOS_CONFLITO_NADA_A_SALVAR: depois do rebase a seleção do usuário ficou IDÊNTICA à do servidor —
//   não afirma "suas mudanças foram mantidas" (não sobrou mudança nenhuma pra manter).
export const TEXTO_CAMPOS_CONFLITO =
  "Outra pessoa mudou os campos da API — as suas mudanças foram mantidas por cima da versão nova.";
export const TEXTO_CAMPOS_CONFLITO_SO_REV =
  "A configuração foi salva por outra pessoa enquanto você editava; as suas mudanças continuam aqui.";
export const TEXTO_CAMPOS_CONFLITO_NADA_A_SALVAR =
  "Outra pessoa já salvou exatamente a mudança que você fez — não sobrou nada para salvar.";
export const TEXTO_CAMPOS_VAZIO = "Marque pelo menos um campo para salvar.";
/** Fix round 2 T14 (n1): monta "Peso (desmarcado), Foto (marcado)" — o diff entre a base ANTIGA (antes do
 *  conflito) e a seleção FRESCA do servidor, na ordem do layout. Usado só para MOSTRAR o que a OUTRA pessoa
 *  mudou (nunca o diff do próprio usuário, que já está refletido nos checkboxes rebaseados). */
export function diffCampos(baseAntiga: readonly string[], fresco: readonly string[]): string {
  const marcados = ordenarCampos(fresco.filter((k) => !baseAntiga.includes(k)));
  const desmarcados = ordenarCampos(baseAntiga.filter((k) => !fresco.includes(k)));
  const partes = [
    ...desmarcados.map((k) => `${rotuloNaLista(k)} (desmarcado)`),
    ...marcados.map((k) => `${rotuloNaLista(k)} (marcado)`),
  ];
  return partes.join(", ");
}
export function alternarCampo(sel: readonly string[], key: CampoKey, marcar: boolean): CampoKey[] {
  const s = new Set(sel);
  if (marcar) s.add(key);
  else s.delete(key);
  return ordenarCampos([...s]);
}
export const precisaAlertaLayout = (key: CampoKey, marcar: boolean): boolean => !marcar && (CAMPO_BY_KEY.get(key)?.layout ?? false);
export const rotuloNaLista = (key: CampoKey): string => (key === "foto" ? "Foto do Modelo" : (CAMPO_BY_KEY.get(key)?.rotulo ?? key));
export function mesmaSelecao(a: readonly string[], b: readonly string[]): boolean {
  const x = ordenarCampos(a);
  const y = ordenarCampos(b);
  return x.length === y.length && x.every((k, i) => k === y[i]);
}
