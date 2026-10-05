/**
 * MO por serviço — helpers puros (espelham a lógica do rollup no banco).
 * `aprovado`: null = pendente / true / false. A regra de LIBERAÇÃO é a mesma do
 * trigger `_mo_liberada`: liberada = nenhuma linha com aprovado ≠ true (sem linha = liberada).
 */
export type MoLinha = {
  // `id` da INSTÂNCIA (set/2026, multi-instância): a identidade de uma linha de MO passou a ser
  // o `id` próprio, não mais (modelo, categoria) — o mesmo serviço pode aparecer N vezes.
  // `undefined`/null = linha nova (ainda não persistida); o save insere e o servidor devolve o id.
  id?: string | null;
  categoria_terceirizado_id: string | null;
  nome?: string | null;
  valor?: number | null;
  aprovado: boolean | null;
  motivo_reprovacao?: string | null;
  // [urg R4] fornecedor de serviço da linha (empresas tipo 'servico'). Só o Sheet do Planejamento lê/manda; os cards PA/PI
  // não têm a chave (undefined ≡ null) e o servidor mantém o gravado quando a chave não vem.
  empresa_id?: string | null;
  empresa_nome?: string | null;
};

/** Liberada p/ lançar? = nenhuma linha pendente/reprovada. Vazio = true. */
export function moLiberada(linhas: MoLinha[]): boolean {
  return !linhas.some((l) => l.aprovado !== true);
}

export type EstadoMO = "sem_servico" | "reprovada" | "pendente" | "aprovada";

/** Estado de exibição do modelo derivado das linhas (para o badge 3-estados). */
export function estadoMO(linhas: MoLinha[]): EstadoMO {
  if (linhas.length === 0) return "sem_servico";
  if (linhas.some((l) => l.aprovado === false)) return "reprovada";
  if (linhas.some((l) => l.aprovado == null)) return "pendente";
  return "aprovada";
}

/** Σ dos valores das linhas APROVADAS (aprovado === true). */
export function somaAprovada(linhas: MoLinha[]): number {
  return linhas.reduce((s, l) => s + (l.aprovado === true ? Number(l.valor) || 0 : 0), 0);
}

/** Σ de todos os valores (planejado total). */
export function somaTotal(linhas: MoLinha[]): number {
  return linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
}

/**
 * Compara duas listas de linhas de MO p/ "sujo" (`moLinhas` vs `moLinhasBase`), tratando
 * `valor` 0 e `null`/`undefined` como o MESMO valor de negócio (o `MaoObraEditor` exibe os
 * dois como campo vazio c/ placeholder). Sem esta normalização, uma linha que nasceu 0 no
 * banco (ou nasceu `null` ao ser adicionada e foi salva sem digitar) acende "não salvo" à
 * toa se o usuário só clicar no campo e sair, ou digitar e apagar de volta pro vazio.
 * Mudança ESTRUTURAL (adicionar/remover linha) continua sempre "suja" — o length diverge
 * antes mesmo de qualquer normalização de valor.
 */
export function moLinhasEqual(a: MoLinha[], b: MoLinha[]): boolean {
  if (a.length !== b.length) return false;
  // [urg R4] fornecedor: `empresa_id` undefined ≡ null (cards PA/PI não têm a chave) e `empresa_nome` é só rótulo (fica de fora),
  // senão escolher e desfazer o fornecedor numa linha recém-adicionada deixaria "não salvo" aceso à toa.
  const norm = (ls: MoLinha[]) =>
    ls.map(({ empresa_nome: _rotulo, ...l }) => ({ ...l, valor: l.valor ? l.valor : null, empresa_id: l.empresa_id ?? null }));
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Texto da dica âmbar da linha que vai reabrir (MaoObraEditor). */
export const TEXTO_MO_VAI_REABRIR = "Mudar o valor, o serviço ou o fornecedor volta este serviço para pendente — precisa de nova aprovação.";
/** Title dos botões Aprovar/Reprovar enquanto a linha tem valor/serviço mudado e ainda não salvo. */
export const TEXTO_MO_SALVE_ANTES = "Salve o novo valor antes de aprovar ou reprovar";

/**
 * Contas certas item 8 (P-163 A): no servidor, linha JÁ DECIDIDA (aprovada OU reprovada) que muda de VALOR ou de SERVIÇO
 * volta a PENDENTE no Salvar (`enforce_servico_mo_aprovacao`). Este espelho diz se a linha do rascunho vai reabrir (valor, serviço OU fornecedor):
 * `base` = a mesma linha como está no servidor (casada por `id`). Valor 0 ≡ vazio (o Salvar manda `Number(v) || 0`,
 * igual a `moLinhasEqual`); comparação em centavos. Linha nova (sem id) ou pendente no servidor nunca "reabre".
 */
export function moLinhaVaiReabrir(linha: MoLinha, base: MoLinha | null | undefined): boolean {
  if (!base || base.id == null || linha.id !== base.id) return false;
  if (base.aprovado == null) return false;
  const centavos = (v: number | null | undefined) => Math.round((Number(v) || 0) * 100);
  return centavos(linha.valor) !== centavos(base.valor)
    || (linha.categoria_terceirizado_id ?? null) !== (base.categoria_terceirizado_id ?? null)
    || (linha.empresa_id ?? null) !== (base.empresa_id ?? null);
}

/**
 * "Total aprovado" exibido no editor: Σ das linhas aprovadas, EXCETO as que vão reabrir no Salvar (valor/serviço
 * editado e ainda não salvo — `moLinhaVaiReabrir`). `base` = linhas como estão no servidor (casadas por `id`).
 */
export function somaAprovadaVigente(linhas: MoLinha[], base: MoLinha[] | null | undefined): number {
  return linhas.reduce((s, l) => {
    if (l.aprovado !== true) return s;
    if (moLinhaVaiReabrir(l, l.id != null ? base?.find((b) => b.id === l.id) : undefined)) return s;
    return s + (Number(l.valor) || 0);
  }, 0);
}

// ───────────── Reforço de segurança S3c (P-244 = B): quem muda os VALORES de M.O. ─────────────
// O servidor (salvar_modelo_servico_mo, migration 20261101160000) só aceita quem EDITA o Planejamento E vê custos
// (`_pode_ver_custos()`); quem só edita o Desenvolvimento ou o card do Produto Acabado/Importado perde (os preços são dados
// sensíveis). Aprovar/reprovar NÃO é editar valor (aprovar_servico_mo, `producao_servico_aprovacao`, inv. 12).
/** Espelho de public._pode_ver_custos() — VER qualquer uma destas. Anti-drift contra o SQL em tests/unit. */
export const CHAVES_VER_CUSTOS = [
  "criacao_planejamento:custos",
  "criacao_desenvolvimento:custos",
  "producao_terceirizados:precos",
  "dashboard_custos",
  "dashboard_comercial",
] as const;
export const PAGINA_EDITAR_VALOR_MO = "criacao_planejamento";
export function podeVerCustosServidor(canView: (k: string) => boolean): boolean {
  return CHAVES_VER_CUSTOS.some((k) => canView(k));
}
/** Pode mudar o VALOR (digitar, adicionar, remover serviço) — a mesma regra do servidor. */
export function podeEditarValorMO(canEdit: (k: string) => boolean, canView: (k: string) => boolean): boolean {
  return canEdit(PAGINA_EDITAR_VALOR_MO) && podeVerCustosServidor(canView);
}

/**
 * Item de `_linhas` do `salvar_modelo_servico_mo` (estado completo). [urg R4 / fix round 1 M1] `empresa_id` só vai quando a linha é
 * NOVA (sem id, ou id que não está na base) ou quando difere da BASE (o que o editor carregou do servidor / gravou por último):
 * chave ausente = o servidor MANTÉM o gravado. Assim, quem não mexeu no fornecedor não desfaz (nem reabre a aprovação por causa de)
 * a troca que outra pessoa salvou no meio; limpar (null) e trocar continuam valendo porque diferem da base.
 * (O mesmo "último vence" já existe para `valor` — backlog.)
 */
export function moLinhaParaPayload(
  l: MoLinha,
  base: MoLinha[] | null | undefined,
): { id: string | null; categoria_terceirizado_id: string | null; valor: number; observacoes: null; empresa_id?: string | null } {
  const item: { id: string | null; categoria_terceirizado_id: string | null; valor: number; observacoes: null; empresa_id?: string | null } = {
    id: l.id ?? null, // multi-instância: id preserva a linha (e sua aprovação) no diff do servidor
    categoria_terceirizado_id: l.categoria_terceirizado_id,
    valor: Number(l.valor) || 0,
    observacoes: null,
  };
  const daBase = l.id != null ? base?.find((b) => b.id === l.id) : undefined;
  if (!daBase || (l.empresa_id ?? null) !== (daBase.empresa_id ?? null)) item.empresa_id = l.empresa_id ?? null;
  return item;
}
