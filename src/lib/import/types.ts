// Importação em massa (XLSX) — CONTRATO genérico.
//
// A arquitetura é: TUDO é genérico (parser/lookup/resolve/validate/template/foto-match/engine),
// e a ÚNICA coisa que muda por entidade é um `EntityImportDescriptor` (colunas, lookups, resolve,
// rpc). Assim, adicionar Aviamento/Insumo/Produto = escrever mais 1 descritor + 1 RPC + 1 aba,
// sem tocar o motor. Ver docs/plano em `.claude/plans/` e a memória `project_importacao_massa`.

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Coluna de uma aba do template. `key` é o campo interno; `header` é o rótulo
// que aparece no XLSX (PT-BR). `hint` alimenta a legenda. `required` marca * no
// header e vira erro na validação se vazio.
// ---------------------------------------------------------------------------
export type ColumnSpec = {
  key: string;
  header: string;
  required?: boolean;
  hint?: string; // valores aceitos / observação, mostrado na legenda
  exemplo?: string; // valor de exemplo nas linhas `(exemplo)`
};

// ---------------------------------------------------------------------------
// Uma tabela de apoio a resolver nome→id. `table` = nome da tabela Supabase;
// `nameCol` = coluna do nome (default "nome"). `apelidoDeCorBase` marca o caso
// especial cores_apelido (chave composta `${corBaseId}::${nomeNorm}`).
// `semUnique` marca lookups sem UNIQUE(tenant,nome) (ex.: empresas) → Map de
// arrays, homônimo vira AVISO em vez de escolha silenciosa.
// ---------------------------------------------------------------------------
export type LookupSpec = {
  id: string; // identificador do lookup dentro do descritor (ex.: "cores", "fornecedores")
  table: string;
  nameCol?: string; // default "nome"
  extraCols?: string[]; // colunas extra a trazer (ex.: cor_base_id do apelido)
  apelidoDeCorBase?: boolean; // cores_apelido: chave `${cor_base_id}::${nomeNorm}`
  semUnique?: boolean; // sem UNIQUE(tenant,nome) → Map<nomeNorm, id[]> (homônimo = aviso)
};

// Um lookup carregado: nomeNorm → id (ou id[] quando semUnique).
export type LookupMap = Map<string, string> | Map<string, string[]>;
export type LookupMaps = Record<string, LookupMap>;

// ---------------------------------------------------------------------------
// Problema detectado numa linha ANTES de gravar. `nivel`:
//  - "erro"    → bloqueia a linha (não será enviada ao servidor)
//  - "aviso"   → não bloqueia, só sinaliza (ex.: homônimo, sem foto)
//  - "duplicata" → linha será PULADA (duplicata intra-arquivo ou já existe no banco)
// ---------------------------------------------------------------------------
export type Problema = {
  nivel: "erro" | "aviso" | "duplicata";
  campo?: string; // coluna relacionada, se houver
  mensagem: string;
};

// ---------------------------------------------------------------------------
// Linha crua vinda do parser: chave da coluna → valor de célula (string trim).
// `__linha` = número da linha na planilha (2 = 1ª de dados), p/ mensagens.
// ---------------------------------------------------------------------------
export type RawRow = Record<string, string> & { __linha: number };

// Resultado de resolver + validar uma linha crua.
export type ResolvedRow = {
  raw: RawRow;
  cabecalho: Record<string, unknown>; // payload do cabeçalho (ids já resolvidos)
  variantes: Record<string, unknown>[]; // payload das variantes (ids já resolvidos)
  categoriaIds?: string[]; // p/ set_artigo_categorias (tecido) e afins
  fotoNome: string | null; // nome normalizável p/ casar com a foto
  problemas: Problema[];
  // chave natural p/ agrupar variantes da MESMA entidade (mesmo nome) e dedupe intra-arquivo.
  chave: string;
};

// Uma entidade agregada (1 cabeçalho + N variantes vindas de N linhas com o mesmo nome).
export type EntidadeAgregada = ResolvedRow & {
  fotoPath?: string | null; // (fotoModo "entidade") path no storage da foto principal
  // (fotoModo "variante") path por índice de variante — só as que o usuário confirmou.
  fotoPathVariante?: (string | null)[];
};

// Modo de casamento de foto:
//  - "entidade": 1 foto por registro, casa pelo NOME (produto: Nome_Modelo/_Referencia/_Desenho).
//  - "variante": N fotos, 1 por COR, casa por Nome_CorApelido (tecido — cada cor tem sua foto).
export type FotoModo = "entidade" | "variante";

// ---------------------------------------------------------------------------
// DESCRITOR — a única peça específica por entidade.
// ---------------------------------------------------------------------------
export type EntityImportDescriptor = {
  entidade: string; // "tecido" | "aviamento" | ...
  sheetName: string; // nome da aba no XLSX ("Tecido")
  label: string; // rótulo humano ("Tecidos")
  colunas: ColumnSpec[];
  lookups: LookupSpec[];
  temFoto: boolean;
  fotoModo?: FotoModo; // default "entidade"; tecido usa "variante"
  bucket?: string; // bucket de storage p/ a foto (ex.: "tecido-variantes")
  fotoPrefix?: string; // subpasta dentro do tenantPrefix (ex.: "importacao")

  // chave natural da linha (agrupa variantes + dedupe). Normalmente o nome normalizado.
  chaveNatural: (row: RawRow) => string;

  // (fotoModo "variante") chave de casamento de UMA variante com o nome do arquivo de foto.
  // Ex. tecido: normalizeCat(`${nome}_${apelido ?? corBase}`). O foto-match casa o nome do
  // arquivo (sem extensão) com essa chave. Ausente = usa só a chaveNatural (fotoModo entidade).
  chaveFotoVariante?: (ent: ResolvedRow, varIdx: number) => string;

  // resolve + valida UMA linha crua (nome→id no CLIENTE, via maps). NÃO grava nada.
  resolve: (row: RawRow, maps: LookupMaps) => ResolvedRow;

  // detecta duplicata já EXISTENTE no banco (consulta), p/ entidades cujo nome não tem UNIQUE
  // (ex.: artigos.nome). Recebe as chaves naturais do arquivo; devolve o set das que já existem.
  // Opcional — só para entidades sem unique de nome.
  duplicatasExistentes?: (
    sb: SupabaseClient,
    chaves: string[],
  ) => Promise<Set<string>>;

  // grava UMA entidade agregada (cabeçalho + variantes) atômico via RPC transacional.
  // Recebe a foto já subida (path) quando houver. Lança em erro (o motor isola por linha).
  rpc: (sb: SupabaseClient, ent: EntidadeAgregada) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Relatório final da importação (mostrado após confirmar).
// ---------------------------------------------------------------------------
export type ImportReportItem = {
  chave: string;
  nome: string;
  status: "criado" | "pulado" | "erro";
  motivo?: string;
};

export type ImportReport = {
  entidade: string;
  criados: number;
  pulados: number;
  erros: number;
  itens: ImportReportItem[];
};
