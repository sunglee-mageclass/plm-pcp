// Oficina · "Partes do Molde" (cad.observacoes_molde) com rev otimista — decisao PURA do efeito de adocao (Realtime Onda 1 · T1).
// O `cad.rev` sobe por QUALQUER escritor do CAD (Explosao, Direcionamento, CQ, Servicos...), nao so pelo molde: so e conflito
// de verdade quando o TEXTO do molde no servidor difere da base que a tela semeou.
export type AdocaoMolde = "nada" | "avancar_rev" | "adotar";

export function decidirAdocaoMolde(o: {
  srvRev: number | null;
  srvMolde: string;
  revBase: number | null;
  moldeBase: string;
  moldeForm: string;
}): AdocaoMolde {
  if (o.srvRev == null || (o.revBase != null && o.srvRev <= o.revBase)) return "nada";
  // Molde do servidor igual a base: o rev subiu por OUTRO campo do CAD -> so avanca o rev (mantem o texto digitado, se houver).
  if (o.srvMolde === o.moldeBase) return "avancar_rev";
  // Molde do servidor mudou: com edicao pendente e conflito real (rev antigo fica; o Salvar recusa); sem edicao, adota o do servidor.
  return o.moldeForm !== o.moldeBase ? "nada" : "adotar";
}
