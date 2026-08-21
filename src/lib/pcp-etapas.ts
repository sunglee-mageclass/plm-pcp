export type EtapaKey = "peca_teste" | "separacao" | "retorno_grade" | "oficina" | "finalizacao";
export type EtapaCfg = { key: EtapaKey; label: string; ativa: boolean };

export const ETAPAS_DEFAULT: EtapaCfg[] = [
  { key: "peca_teste",    label: "Peça Teste",                 ativa: true },
  { key: "separacao",     label: "Separação de Materiais",     ativa: true },
  { key: "retorno_grade", label: "Retorno de Grade de Corte",  ativa: true },
  { key: "oficina",       label: "Oficina",                    ativa: true },
  { key: "finalizacao",   label: "Finalização",                ativa: true },
];

export type BlocoEtapa = {
  pt_data_saida: string | null; pt_data_entrada: string | null;
  pt_aprovacao: "aprovado" | "reprovado" | null;
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
    case "peca_teste":    return Boolean(b.pt_data_saida && b.pt_data_entrada && b.pt_aprovacao === "aprovado");
    case "separacao":     return Boolean(b.data_enviado);
    case "retorno_grade": return cortadaRetornou(b.grade_detalhe);
    case "oficina":       return Boolean(b.data_entregue && (b.qtd_recebida ?? 0) > 0);
    case "finalizacao":   return false; // terminal
  }
}

export function etapaDoBloco(b: BlocoEtapa, etapas: EtapaCfg[]): { key: EtapaKey | null; reprovada: boolean } {
  if (b.pt_aprovacao === "reprovado") return { key: "peca_teste", reprovada: true };
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
