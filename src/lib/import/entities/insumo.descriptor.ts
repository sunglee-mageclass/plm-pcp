// Descritor de importação — INSUMO (ex-Etiquetas, Fase 3). Diferenças-chave:
//  • Variante = COR × TAMANHO: 1 linha da planilha (1 cor + coluna "Tamanhos" lista por vírgula)
//    EXPLODE em N variantes (cor × cada tamanho). Sem apelido, sem código/nome de variante, sem foto.
//  • Tamanho casado TOLERANTE (número "34" OU letra "PPP" → chave "34|PPP" da grade da loja).
//  • Nome = `nome`; sem código auto. Unique = NOME só (não fornecedor) → sem conflito_fornecedor.
//  • Cabeçalho: nome, unidade, tipo de insumo, fornecedor, representante, observações, formato_tamanho.
//  • temFoto: false (a UI de insumo não usa foto). RPC importar_insumo_linha.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCat } from "@/lib/fornecedor-categoria";
import { parseNumeroBR } from "../parse";
import type {
  AcaoImport,
  EntidadeAgregada,
  EntityImportDescriptor,
  LookupMaps,
  Problema,
  RawRow,
  ResolvedRow,
} from "../types";

const UNIDADES = new Set(["unidade", "metro", "rolo", "milheiro"]);
const FORMATOS = new Set(["ambos", "numero", "letra", "nenhum"]);

/** Rótulo EXIBÍVEL de um tamanho da grade conforme o formato do insumo. A chave é "num|sigla"
 *  (ex.: "34|PPP"): `letra`→sigla ("PPP"), `numero`→número ("34"), `ambos`→"34 · PPP".
 *  Sem uma das partes, cai na outra. `null` (sem tamanho) → "—". */
export function rotuloTamanho(chave: string | null, formato: string): string {
  if (!chave) return "—";
  const [num, sigla] = chave.split("|");
  if (formato === "letra") return sigla || num || chave;
  if (formato === "numero") return num || sigla || chave;
  // ambos / nenhum / desconhecido → mostra o que houver
  if (num && sigla) return `${num} · ${sigla}`;
  return num || sigla || chave;
}

const parseNum = parseNumeroBR;
function look(maps: LookupMaps, id: string, nome: string | undefined): string | null {
  const key = normalizeCat(nome);
  if (!key) return null;
  return (maps[id] as Map<string, string> | undefined)?.get(key) ?? null;
}
function lookForn(maps: LookupMaps, nome: string | undefined): { id: string | null; ambiguo: boolean } {
  const key = normalizeCat(nome);
  if (!key) return { id: null, ambiguo: false };
  const arr = (maps["fornecedores"] as Map<string, string[]> | undefined)?.get(key);
  if (!arr?.length) return { id: null, ambiguo: false };
  return { id: arr[0], ambiguo: arr.length > 1 };
}

export const insumoDescriptor: EntityImportDescriptor = {
  entidade: "insumo",
  sheetName: "Insumo",
  label: "Insumos",
  nomeCampo: "nome",
  temVariante: true,
  temFoto: false, // a UI de insumo não usa foto

  colunas: [
    { key: "nome", header: "Nome", required: true, hint: "nome do insumo", exemplo: "Etiqueta bordada" },
    { key: "unidade", header: "Unidade", opcoes: ["unidade", "metro", "rolo", "milheiro"], exemplo: "unidade" },
    { key: "tipo_insumo", header: "Tipo de insumo", hint: "tipo cadastrado (Etiqueta, Cartão…)", exemplo: "Etiqueta" },
    { key: "fornecedor", header: "Fornecedor", hint: "nome da empresa fornecedora" },
    { key: "representante", header: "Representante", hint: "nome do representante" },
    { key: "observacoes", header: "Observações", hint: "opcional" },
    { key: "formato_tamanho", header: "Formato do tamanho", opcoes: ["ambos", "numero", "letra", "nenhum"], exemplo: "ambos" },
    // variante: 1 linha por COR + lista de tamanhos (explode em cor × tamanho)
    { key: "cor_base", header: "Cor", hint: "cor (opcional — insumo pode não ter cor)", exemplo: "Branco" },
    { key: "tamanhos", header: "Tamanhos", hint: "lista separada por vírgula (ex.: 34,36,38 ou P,M,G) — vazio p/ sem tamanho", exemplo: "34,36,38,40,42,44" },
    { key: "preco_variante", header: "Preço", hint: "preço desta cor (R$)", exemplo: "0,50" },
  ],

  lookups: [
    { id: "cores", table: "cores" },
    { id: "tipos", table: "tipos_insumo" },
    { id: "tamanhos", table: "__grade__", gradeTamanhos: true }, // grade de tenant_config (não é tabela)
    { id: "fornecedores", table: "empresas", nameCol: "nome_fantasia", semUnique: true },
    { id: "representantes", table: "representantes", semUnique: true },
  ],

  gridColunas: [
    { rotulo: "Unidade", escopo: "cabecalho", tipo: "texto", campoId: "unidade", narrow: true },
    { rotulo: "Tipo", escopo: "cabecalho", tipo: "lookup", campoId: "tipo_insumo_id", digitadoKey: "tipo_insumo", lookupId: "tipos" },
    { rotulo: "Fornecedor", escopo: "cabecalho", tipo: "lookup", campoId: "empresa_id", digitadoKey: "fornecedor", lookupId: "fornecedores", cadastroTipo: "fornecedor" },
    { rotulo: "Representante", escopo: "cabecalho", tipo: "lookup", campoId: "representante_id", digitadoKey: "representante", lookupId: "representantes" },
    { rotulo: "Formato", escopo: "cabecalho", tipo: "texto", campoId: "formato_tamanho", narrow: true },
    { rotulo: "Observações", escopo: "cabecalho", tipo: "texto", campoId: "observacoes", wide: true },
    // variante (por cor×tamanho): tamanho (dropdown da grade, corrige match errado) e preço
    { rotulo: "Tamanho", escopo: "variante", tipo: "tamanho", campoId: "tamanho", lookupId: "tamanhos", narrow: true },
    { rotulo: "Preço", escopo: "variante", tipo: "num", campoId: "preco", moeda: true },
  ],

  chaveNatural: (row) => normalizeCat(row.nome),

  resolve(row: RawRow, maps: LookupMaps): ResolvedRow {
    const problemas: Problema[] = [];
    const nome = (row.nome ?? "").trim();
    if (!nome) problemas.push({ nivel: "erro", campo: "nome", mensagem: "Nome do insumo é obrigatório." });

    let unidade = normalizeCat(row.unidade) || "unidade";
    if (!UNIDADES.has(unidade)) { problemas.push({ nivel: "aviso", campo: "unidade", mensagem: `Unidade "${row.unidade}" inválida — usando "unidade".` }); unidade = "unidade"; }
    let formato = normalizeCat(row.formato_tamanho) || "ambos";
    if (!FORMATOS.has(formato)) { problemas.push({ nivel: "aviso", campo: "formato_tamanho", mensagem: `Formato "${row.formato_tamanho}" inválido — usando "ambos".` }); formato = "ambos"; }

    const forn = lookForn(maps, row.fornecedor);
    if (row.fornecedor?.trim() && !forn.id) problemas.push({ nivel: "aviso", campo: "fornecedor", mensagem: `Fornecedor "${row.fornecedor}" não encontrado — ficará em branco.` });
    if (forn.ambiguo) problemas.push({ nivel: "aviso", campo: "fornecedor", mensagem: `Mais de um fornecedor "${row.fornecedor}" — usando o primeiro.` });
    const representante_id = (maps["representantes"] as Map<string, string[]>)?.get(normalizeCat(row.representante))?.[0] ?? null;
    if (row.representante?.trim() && !representante_id) problemas.push({ nivel: "aviso", campo: "representante", mensagem: `Representante "${row.representante}" não encontrado.` });
    const tipo_insumo_id = look(maps, "tipos", row.tipo_insumo);
    if (row.tipo_insumo?.trim() && !tipo_insumo_id) problemas.push({ nivel: "aviso", campo: "tipo_insumo", mensagem: `Tipo "${row.tipo_insumo}" não encontrado.` });

    // cor (opcional)
    const cor_id = look(maps, "cores", row.cor_base);
    if (row.cor_base?.trim() && !cor_id) problemas.push({ nivel: "erro", campo: "cor_base", mensagem: `Cor "${row.cor_base}" não encontrada no cadastro.` });

    // tamanhos: lista por vírgula → chaves da grade (match tolerante número/letra).
    const tamanhosRaw = (row.tamanhos ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const gradeMap = maps["tamanhos"] as Map<string, string> | undefined;
    const tamanhosChave: string[] = [];
    for (const t of tamanhosRaw) {
      const chave = gradeMap?.get(normalizeCat(t));
      if (chave) { if (!tamanhosChave.includes(chave)) tamanhosChave.push(chave); }
      else problemas.push({ nivel: "aviso", campo: "tamanhos", mensagem: `Tamanho "${t}" não existe na grade — ignorado.` });
    }

    const cabecalho: Record<string, unknown> = {
      nome, unidade, formato_tamanho: formato,
      empresa_id: forn.id, representante_id, tipo_insumo_id,
      observacoes: (row.observacoes ?? "").trim() || null,
      preco: parseNum(row.preco_variante),
    };

    // EXPLODE: 1 variante por (cor × tamanho). Sem tamanho → 1 variante (só cor). Sem cor+sem tamanho → nada.
    const preco = parseNum(row.preco_variante);
    const variantes: Record<string, unknown>[] = [];
    if (cor_id || tamanhosChave.length) {
      const tams = tamanhosChave.length ? tamanhosChave : [null];
      for (const tam of tams) {
        variantes.push({ cor_id: cor_id ?? null, tamanho: tam, preco, __tamanhoLabel: rotuloTamanho(tam, formato) });
      }
    }

    return { raw: row, cabecalho, variantes, fotoNome: null, problemas, chave: normalizeCat(nome) };
  },

  revalidar(ent: EntidadeAgregada): Problema[] {
    const out: Problema[] = [];
    if (!String(ent.cabecalho.nome ?? "").trim()) out.push({ nivel: "erro", campo: "nome", mensagem: "Nome do insumo é obrigatório." });
    // cor é opcional; erro só se a variante tem cor_base digitada não resolvida (cor_id null MAS tinha texto)
    // — no explode, cor null é legítimo (sem cor). Nada obrigatório por variante aqui.
    const editaveis = new Set(["nome", "cor_base", "fornecedor"]);
    for (const p of ent.problemas) if (p.nivel === "aviso" && !editaveis.has(p.campo ?? "")) out.push(p);
    // mantém erro de cor não resolvida (o resolve marca "erro" quando cor_base foi digitada e não casou)
    for (const p of ent.problemas) if (p.nivel === "erro" && p.campo === "cor_base") out.push(p);
    return out;
  },

  // UPSERT por NOME (insumo não tem dimensão fornecedor no unique).
  async analisarBanco(sb: SupabaseClient, entidades: EntidadeAgregada[]): Promise<void> {
    const { data, error } = await sb
      .from("etiquetas")
      .select("id, nome, variantes_etiqueta(cor_id, tamanho)");
    if (error) return;
    type EtqRow = { id: string; nome: string; variantes_etiqueta?: { cor_id: string | null; tamanho: string | null }[] };
    const etqs = (data ?? []) as unknown as EtqRow[];
    const porNome = new Map<string, EtqRow>();
    for (const e of etqs) porNome.set(normalizeCat(e.nome), e); // nome único por loja

    for (const ent of entidades) {
      const achou = porNome.get(ent.chave);
      if (achou) {
        ent.artigoAlvoId = achou.id;
        const sig = (c: unknown, t: unknown) => `${c ?? ""}::${t ?? ""}`;
        const setExist = new Set((achou.variantes_etiqueta ?? []).map((v) => sig(v.cor_id, v.tamanho)));
        // sempre "complementar" na UI; a RPC devolve "inalterado" no relatório se nada de novo entrar.
        ent.estado = "complementar";
        ent.varianteExiste = ent.variantes.map((v) => setExist.has(sig(v.cor_id, v.tamanho)));
        ent.varianteTemFoto = ent.variantes.map(() => false);
      } else {
        ent.estado = "novo";
        ent.artigoAlvoId = null;
        ent.varianteExiste = ent.variantes.map(() => false);
        ent.varianteTemFoto = ent.variantes.map(() => false);
      }
    }
  },

  async rpc(sb: SupabaseClient, ent: EntidadeAgregada): Promise<AcaoImport | void> {
    const cabecalho = { ...ent.cabecalho };
    // remove o rótulo auxiliar de tamanho (não é coluna do banco).
    const variantes = ent.variantes.map((v) => {
      const { __tamanhoLabel, ...limpa } = v as Record<string, unknown>;
      void __tamanhoLabel;
      return limpa;
    });
    const alvo = ent.estado === "complementar" || ent.estado === "so_foto" ? ent.artigoAlvoId ?? null : null;
    const { data, error } = await sb.rpc("importar_insumo_linha" as never, {
      _cabecalho: cabecalho as never,
      _variantes: variantes as never,
      _etiqueta_alvo_id: alvo as never,
    });
    if (error) throw error;
    const acao = (data as { acao?: string } | null)?.acao;
    if (acao === "criado" || acao === "complementado" || acao === "inalterado") return acao;
  },
};
