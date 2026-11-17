// Integração + API — abas por papel. Historico: antes Campos da API / API / Manual da API / Log eram "SO super admin"
// em bloco. Agora (nov/2026, dono) so 3 abas tem PERMISSAO PROPRIA por SECTION (`integracao:campos_api` /
// `integracao:api` / `integracao:manual_api`), concedida SO pelo super admin (useAuth.ehPaginaSemBypassAdmin ja cobre
// `integracao:*`; o servidor libera a aba de verdade — ver migration 20261205100000). A aba LOG volta a vir junto da
// permissao base `integracao` (como Produtos — decisao do dono): Log NAO tem section propria.
export type Aba = "produtos" | "campos" | "api" | "manual" | "log";
export const ROTULO_ABA: Record<Aba, string> = {
  produtos: "Produtos", campos: "Campos da API", api: "API", manual: "Manual da API", log: "Log",
};

// Mapa aba → chave da SECTION de permissao — SO as 3 abas com permissao propria. "produtos" e "log" NAO entram aqui
// (ambas pela permissao base `integracao`).
export const SECTION_DA_ABA: Partial<Record<Aba, string>> = {
  campos: "integracao:campos_api",
  api: "integracao:api",
  manual: "integracao:manual_api",
};

/**
 * Abas visiveis. `produtos` e `log` aparecem com a permissao base `integracao` (resolvida fora daqui — super admin ou
 * quem tem a pagina `integracao` em bloco). Cada uma das 3 abas proprias (Campos/API/Manual) aparece se o usuario e
 * super admin OU ve a section dela (`podeVer("integracao:<aba>")`). Super admin continua vendo todas.
 */
export function abasVisiveis(superAdmin: boolean, podeVer: (chave: string) => boolean): Aba[] {
  const abas: Aba[] = ["produtos"];
  (["campos", "api", "manual"] as const).forEach((a) => {
    const sec = SECTION_DA_ABA[a];
    if (superAdmin || (sec && podeVer(sec))) abas.push(a);
  });
  abas.push("log"); // Log fica sempre apos as 3 abas proprias (gate base `integracao`, resolvido fora).
  return abas;
}
