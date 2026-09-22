// Agregação genérica: linhas cruas → entidades (1 cabeçalho + N variantes por chave natural),
// com dedupe intra-arquivo e coleta de problemas. NÃO grava nada — só prepara p/ a análise.
//
// Fluxo: cada linha é resolvida pelo descritor (nome→id, no cliente). Linhas com a MESMA
// chave natural (nome) são a MESMA entidade: a 1ª define o cabeçalho, todas contribuem 1 variante.
// Variante duplicada exata dentro do arquivo (mesma cor+apelido no mesmo item) vira problema.

import type {
  EntityImportDescriptor,
  EntidadeAgregada,
  LookupMaps,
  Problema,
  RawRow,
} from "./types";

/** Assinatura de variante p/ detectar duplicata intra-arquivo. Inclui cor + apelido + TAMANHO:
 *  tecido/aviamento não têm tamanho (fica "::" no fim, retrocompat), mas o insumo é cor×tamanho —
 *  sem o tamanho, variantes que diferem só no tamanho eram descartadas como duplicata (perda de dado). */
function assinaturaVariante(v: Record<string, unknown>): string {
  return `${v.cor_id ?? ""}::${v.cor_apelido_id ?? ""}::${v.tamanho ?? ""}`;
}

export type AgregadoResult = {
  entidades: EntidadeAgregada[];
  // contagens p/ a área de análise
  totalLinhas: number;
  totalEntidades: number;
};

/**
 * Agrega as linhas cruas em entidades (1 cabeçalho + N variantes por chave natural).
 * O estado vs banco (novo/complementar/so_foto/conflito) é preenchido DEPOIS por
 * `descriptor.analisarBanco` — aqui só agrupamos e detectamos duplicata INTRA-arquivo.
 */
export function agregar(
  desc: EntityImportDescriptor,
  linhas: RawRow[],
  maps: LookupMaps,
): AgregadoResult {
  const byChave = new Map<string, EntidadeAgregada>();

  for (const row of linhas) {
    const resolved = desc.resolve(row, maps);
    const chave = resolved.chave;

    let ent = byChave.get(chave);
    if (!ent) {
      ent = { ...resolved, variantes: [...resolved.variantes], problemas: [...resolved.problemas] };
      byChave.set(chave, ent);
    } else if (desc.mesclar) {
      // Entidade com estrutura NÃO-uniforme (ex.: MODELO = cabeçalho + N materiais heterogêneos
      // de BOM em linhas-filhas). O descritor sabe mesclar a nova linha na entidade acumulada
      // (juntar arrays de BOM, escolher a linha de cabeçalho) — não é o fluxo de variantes por cor.
      desc.mesclar(ent, resolved, row);
    } else {
      // cabeçalho divergente: o modelo é "1 tecido = N cores", então só o cabeçalho da 1ª
      // linha vale. Se uma linha seguinte traz cabeçalho diferente (ex.: outro fornecedor/preço),
      // avisa que será IGNORADO — transparência p/ a migração (achado da revisão).
      if (JSON.stringify(ent.cabecalho) !== JSON.stringify(resolved.cabecalho)) {
        ent.problemas.push({
          nivel: "aviso",
          mensagem: `Linha ${row.__linha}: dados do cabeçalho diferentes da 1ª linha deste item — usando os da 1ª.`,
        });
      }
      // mesma entidade → agrega variantes desta linha, checando duplicata intra-arquivo
      const existentes = new Set(ent.variantes.map(assinaturaVariante));
      for (const v of resolved.variantes) {
        const sig = assinaturaVariante(v);
        if (existentes.has(sig)) {
          ent.problemas.push({
            nivel: "duplicata",
            campo: "cor",
            mensagem: `Variante repetida na planilha (linha ${row.__linha}) — será ignorada.`,
          });
        } else {
          ent.variantes.push(v);
          existentes.add(sig);
        }
      }
      // problemas de resolução desta linha (ex.: cor não encontrada) sobem p/ a entidade
      ent.problemas.push(...resolved.problemas.filter((p) => p.nivel === "erro" || p.nivel === "aviso"));
    }
  }

  const entidades = Array.from(byChave.values());
  return { entidades, totalLinhas: linhas.length, totalEntidades: entidades.length };
}

/** true se a entidade tem algum problema que BLOQUEIA o envio (erro). */
export function temErroBloqueante(ent: EntidadeAgregada): boolean {
  return ent.problemas.some((p) => p.nivel === "erro");
}

/** true se a entidade deve ser PULADA (duplicata), sem tentar gravar. */
export function ehDuplicata(ent: EntidadeAgregada): boolean {
  return ent.problemas.some((p) => p.nivel === "duplicata" && !p.campo); // duplicata de entidade (não de cor)
}

/** Resumo de problemas p/ a área de análise. */
export function resumoProblemas(entidades: EntidadeAgregada[]) {
  let semFoto = 0;
  let comErro = 0;
  let duplicatas = 0;
  let avisos = 0;
  for (const e of entidades) {
    if (temErroBloqueante(e)) comErro++;
    if (ehDuplicata(e)) duplicatas++;
    if (!e.fotoNome) semFoto++;
    if (e.problemas.some((p) => p.nivel === "aviso")) avisos++;
  }
  return { semFoto, comErro, duplicatas, avisos, total: entidades.length };
}

/** Filtra as entidades que serão realmente gravadas (sem erro e não duplicata). */
export function gravaveis(entidades: EntidadeAgregada[]): EntidadeAgregada[] {
  return entidades.filter((e) => !temErroBloqueante(e) && !ehDuplicata(e));
}

/** Nome EXIBÍVEL (original) de uma entidade: lê o campo do descritor (tecido="nome",
 *  aviamento="codigo_nome"); fallback p/ a chave normalizada só se o cabeçalho não tiver. */
export function nomeEntidade(desc: EntityImportDescriptor, ent: EntidadeAgregada): string {
  const campo = desc.nomeCampo ?? "nome";
  return String(ent.cabecalho[campo] ?? ent.chave);
}

/** Reúne os problemas de todas as entidades num único array (para depuração/aviso). */
export function todosProblemas(desc: EntityImportDescriptor, entidades: EntidadeAgregada[]): { nome: string; problemas: Problema[] }[] {
  return entidades
    .filter((e) => e.problemas.length > 0)
    .map((e) => ({ nome: nomeEntidade(desc, e), problemas: e.problemas }));
}
