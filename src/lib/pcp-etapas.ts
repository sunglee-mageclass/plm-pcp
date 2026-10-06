export type EtapaKey =
  | "peca_teste"
  | "separacao"
  | "retorno_grade"
  | "oficina"
  | "finalizacao"
  // Chave RESERVADA da coluna terminal SINTÉTICA "Finalizado" (Task 3, kanban coluna
  // terminal). NÃO entra em ETAPAS_DEFAULT/tenant_config.pcp_etapas (fora da config
  // editável); é injetada pelo board e recebe os cards com `modelos.lancado===true`.
  // `slugify` de etapa real nunca gera `__x__`, então não colide.
  | "__finalizado__";

/** Chave da coluna terminal sintética "Finalizado" (derivada de `modelos.lancado`). */
export const ETAPA_FINALIZADO: EtapaKey = "__finalizado__";
export type EtapaCfg = { key: EtapaKey; label: string; ativa: boolean };

export const ETAPAS_DEFAULT: EtapaCfg[] = [
  { key: "peca_teste",    label: "Peça Teste",                 ativa: true },
  { key: "separacao",     label: "Separação de Materiais",     ativa: true },
  { key: "retorno_grade", label: "Retorno de Grade de Corte",  ativa: true },
  { key: "oficina",       label: "Oficina",                    ativa: true },
  { key: "finalizacao",   label: "Finalização",                ativa: true },
];

export type BlocoEtapa = {
  // [R9] `pt_*` (colunas legadas de `producao_terceirizados`) são OPCIONAIS e IGNORADAS: a peça teste vive no CARD do produto
  // (seção "Peça Teste"). Ficam no tipo só para quem ainda carrega a linha crua (pass-through do `salvar_terceirizados`).
  pt_data_saida?: string | null; pt_data_entrada?: string | null;
  pt_aprovacao?: "aprovado" | "reprovado" | null;
  data_enviado: string | null; data_entregue: string | null; qtd_recebida: number | null;
  grade_detalhe?: Record<string, Record<string, { cortada?: number }>> | null;
};

function cortadaRetornou(gd: BlocoEtapa["grade_detalhe"]): boolean {
  if (!gd) return false;
  for (const v of Object.values(gd)) for (const c of Object.values(v)) if ((c?.cortada ?? 0) > 0) return true;
  return false;
}

// true = a etapa está COMPLETA (o card já saiu dela).
function completa(key: EtapaKey, b: BlocoEtapa): boolean {
  switch (key) {
    // [R9] a Peça Teste é alimentada pelo CARD do produto (montarCardsPecaTeste); para o BLOCO de serviço ela já passou
    // (o bloco só existe depois da Explosão) — conta como cumprida e o bloco começa em Separação de Materiais.
    case "peca_teste":    return true;
    case "separacao":     return Boolean(b.data_enviado);
    case "retorno_grade": return cortadaRetornou(b.grade_detalhe);
    case "oficina":       return Boolean(b.data_entregue && (b.qtd_recebida ?? 0) > 0);
    case "finalizacao":   return false; // terminal
    // `__finalizado__` (coluna terminal sintética) nunca chega aqui — não está em
    // ETAPAS_DEFAULT/pcp_etapas, então `etapaDoBloco` não itera sobre ela. Só p/ exaustividade.
    default:              return false;
  }
}

export function etapaDoBloco(b: BlocoEtapa, etapas: EtapaCfg[]): { key: EtapaKey | null; reprovada: false } {
  // [R9] nunca devolve `reprovada: true`: a reprovação da peça teste mora no card do produto (o servidor tira o card do quadro);
  // `pt_aprovacao='reprovado'` legado num bloco NÃO o tira mais do quadro.
  const ativas = etapas.filter((e) => e.ativa);
  let atual: EtapaKey | null = ativas[0]?.key ?? null;
  for (const e of ativas) {
    if (completa(e.key, b)) {
      const idx = ativas.findIndex((x) => x.key === e.key);
      atual = ativas[idx + 1]?.key ?? e.key; // se a última completa, fica nela
    } else break;
  }
  return { key: atual, reprovada: false };
}
