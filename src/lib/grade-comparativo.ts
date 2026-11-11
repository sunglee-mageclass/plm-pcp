// F5-2 "Grade por fase" (Task 4): lib PURA que MOLDA o retorno da RPC `grade_comparativo` em linhas para a matriz da UI
// (outer-join por variante x tamanho). NÃO refaz a conta das fases (o servidor já casou); célula ausente = tudo null.
// A formatação "—" é da UI (Task 5): aqui só devolvemos null.

export type GradeComparativoPcp = { enviada: number; cortada: number; recebida: number; defeito: number };
export type GradeComparativoCq = { recebida: number; defeito: number; real: number };

export type GradeComparativoCelula = {
  programada: number | null;
  cad: number | null;
  pcp: GradeComparativoPcp | null;
  cq: GradeComparativoCq | null;
};

export type GradeComparativoVariante = {
  variante_numero: number;
  variante_tecido_id: string | null;
  label: string;
};

/** Retorno da RPC `grade_comparativo` (chave de `celulas` = "<variante_numero>|<tamanho>"). */
export type GradeComparativoResp = {
  variantes: GradeComparativoVariante[];
  tamanhos: string[];
  celulas: Record<string, Partial<GradeComparativoCelula> | null | undefined>;
};

export type GradeComparativoLinha = {
  variante: { num: number; label: string };
  celulas: Record<string, GradeComparativoCelula>;
};


/** Uma linha por variante (ordem do servidor); cada tamanho da união com as 4 fases (ausente = null). Tolera resp vazio/parcial. */
export function linhasComparativo(resp: GradeComparativoResp | null | undefined): GradeComparativoLinha[] {
  const variantes = resp?.variantes ?? [];
  const tamanhos = resp?.tamanhos ?? [];
  const celulas = resp?.celulas ?? {};
  return variantes.map((v) => {
    const porTamanho: Record<string, GradeComparativoCelula> = {};
    for (const t of tamanhos) {
      const c = celulas[`${v.variante_numero}|${t}`];
      porTamanho[t] = {
        programada: c?.programada ?? null,
        cad: c?.cad ?? null,
        pcp: c?.pcp ?? null,
        cq: c?.cq ?? null,
      };
    }
    return { variante: { num: v.variante_numero, label: v.label }, celulas: porTamanho };
  });
}

/** União ordenada de tamanhos (já vem do servidor). */
export function tamanhosDaResp(resp: GradeComparativoResp | null | undefined): string[] {
  return resp?.tamanhos ?? [];
}

