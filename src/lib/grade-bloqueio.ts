// Motivos (PT-BR) mostrados no tooltip (`title`) de toda célula BLOQUEADA das grades "Lista tipo Excel" dos cadastros
// (Tecido/Aviamento/Insumo). Nos cadastros não há trava de Integração nem permissão por seção: ou a tela inteira está
// somente-leitura (sem permissão de editar o cadastro), ou o campo é derivado/calculado, ou uma regra do próprio cadastro o trava.

export const MOTIVO_SEM_PERMISSAO = "Você não tem permissão para editar.";
export const MOTIVO_SOMENTE_LEITURA = "Somente leitura: este valor é calculado automaticamente.";
/** Último recurso: célula travada sem motivo específico informado. */
export const MOTIVO_GENERICO = "Campo bloqueado: não pode ser editado agora.";

/** Insumo: trava do "Tamanho vinculado" (só vale em insumo sem tamanho próprio). */
export const MOTIVO_VINCULO_INDISPONIVEL =
  'Só vale em insumo sem tamanho próprio: formato "Nenhum" ou nenhuma cor com tamanho marcado.';
/** Insumo: trava da coluna "Tamanhos" quando o formato é "Nenhum". */
export const MOTIVO_SEM_TAMANHO = 'Formato "Nenhum": o insumo não tem tamanho.';

/**
 * Por que a célula está bloqueada (ou `undefined` se não está). Precedência: tela sem permissão > campo derivado > regra do cadastro.
 * @param readOnly   a tela inteira está somente-leitura (sem permissão de editar)
 * @param editavel   a coluna é editável no catálogo (false = derivada)
 * @param motivoRegra motivo de uma trava por regra do cadastro (ex.: "Rendimento só vale em Kg"); passe `undefined` se não travou
 */
export function motivoBloqueio(
  readOnly: boolean,
  editavel: boolean,
  motivoRegra?: string,
): string | undefined {
  if (readOnly) return MOTIVO_SEM_PERMISSAO;
  if (!editavel) return MOTIVO_SOMENTE_LEITURA;
  return motivoRegra;
}
