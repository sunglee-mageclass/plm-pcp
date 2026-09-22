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
// Coluna da TABELA DE ANÁLISE (grade editável) — como renderizar cada campo já resolvido.
// Separada de ColumnSpec (que é do template XLSX). Dirige a TabelaAnalise genérica: cada
// entidade mostra SEUS campos (tecido ≠ aviamento), sem hardcode.
//   escopo: "cabecalho" (1 valor por entidade, editável só na 1ª linha) | "variante" (por cor).
//   tipo: "lookup" (dropdown CelulaLookup) | "texto" | "num" | "unidade" (metro/kg) | "multi-lookup".
//   campoId: a chave RESOLVIDA no cabeçalho/variante (ex.: "empresa_id", "cor_id").
//   digitadoKey: a chave do texto CRU (raw) p/ o fuzzy quando não casou (ex.: "fornecedor").
//   lookupId: qual lookup do descritor alimenta o dropdown (ex.: "fornecedores").
//   obrigatorio: campo obrigatório (vazio = pendência vermelha; senão "— nenhum").
//   filtraPorCorBase: apelido — filtra opções pela cor base da variante.
// ---------------------------------------------------------------------------
export type GridColuna = {
  rotulo: string;
  escopo: "cabecalho" | "variante";
  tipo: "lookup" | "multi-lookup" | "texto" | "num" | "unidade" | "tamanho";
  campoId: string;
  digitadoKey?: string;
  lookupId?: string;
  obrigatorio?: boolean;
  filtraPorCorBase?: boolean;
  cadastroTipo?: "fornecedor" | "cor" | "categoria"; // p/ o "cadastrar novo"
  wide?: boolean; // texto largo (composição)
  narrow?: boolean; // texto estreito (código, ncm) — default = largura padrão
  readonly?: boolean; // só exibe (não edita) — ex.: tamanho derivado da explosão cor×tamanho
  moeda?: boolean; // (tipo "num") campo de dinheiro → exibe SEMPRE 2 casas ("60" → "60,00")
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
  // GRADE de tamanhos (tenant_config.tamanhos_grade, não é tabela). O "id" resolvido é a própria
  // chave da grade ("34|PPP"); o Map casa TOLERANTE: número ("34") E letra ("PPP") → chave.
  gradeTamanhos?: boolean;
};

// Um lookup carregado: nomeNorm → id (ou id[] quando semUnique).
export type LookupMap = Map<string, string> | Map<string, string[]>;
export type LookupMaps = Record<string, LookupMap>;

// Estado de uma entidade após confrontar com o banco (upsert incremental):
//  - "novo": nome+fornecedor não existem → cria.
//  - "complementar": tecido existe (nome+MESMO fornecedor) → adiciona variantes/foto que faltam.
//  - "so_foto": tecido+cor já existem SEM foto → só completa a foto.
//  - "conflito_fornecedor": nome existe com fornecedor DIFERENTE → precisa do usuário
//    ("é o mesmo tecido?"). `artigoExistenteId`/`fornecedorExistenteNome` descrevem o que há.
export type EstadoEntidade = "novo" | "complementar" | "so_foto" | "conflito_fornecedor";

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
  // --- preenchidos por analisarBanco (upsert incremental) ---
  estado?: EstadoEntidade;
  artigoAlvoId?: string | null; // artigo existente a complementar (ou null = criar)
  // por variante: true se a cor+apelido já existe no artigo alvo (p/ marcar "só foto"/"existe").
  varianteExiste?: boolean[];
  varianteTemFoto?: boolean[]; // por variante: já tem foto no banco (não sobrescrever)
  // conflito_fornecedor: nome do fornecedor do tecido existente + a decisão do usuário.
  fornecedorExistenteNome?: string | null;
  mesmoTecidoConfirmado?: boolean; // usuário disse "sim, é o mesmo" (usa artigoAlvoId)
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
  // colunas da TABELA DE ANÁLISE (grade editável) — como renderizar cada campo. Se ausente, a
  // tabela cai num fallback mínimo (só nome+cor). Ordem = ordem das colunas na grade.
  gridColunas?: GridColuna[];
  // chave do cabecalho que guarda o NOME EXIBÍVEL (original, não normalizado). Tecido="nome",
  // aviamento="codigo_nome". Usado pela tabela de análise, relatório e rótulo de foto. Default "nome".
  nomeCampo?: string;
  temVariante?: boolean; // a entidade tem variantes de cor? (aviamento: cor opcional; produto revenda: sim)
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

  // recomputa `problemas` a partir dos VALORES RESOLVIDOS atuais (após o usuário corrigir na
  // tabela editável). Sem isso, um erro do resolve inicial persistiria e a linha corrigida seria
  // pulada em silêncio. Devolve o novo array de problemas. Opcional (entidades sem edição inline).
  revalidar?: (ent: EntidadeAgregada) => Problema[];

  // confronta as entidades agregadas com o BANCO (1 consulta em lote) e MUTA cada uma com o
  // estado do upsert: novo / complementar / so_foto / conflito_fornecedor + artigoAlvoId +
  // varianteExiste[]/varianteTemFoto[]. Opcional (entidades sem upsert não implementam).
  analisarBanco?: (sb: SupabaseClient, entidades: EntidadeAgregada[]) => Promise<void>;

  // grava UMA entidade agregada (cabeçalho + variantes) atômico via RPC transacional.
  // Recebe a foto já subida (path) quando houver. Lança em erro (o motor isola por linha).
  // Retorna a AÇÃO realizada (do upsert) p/ o relatório; void = trata como "criado" (retrocompat).
  rpc: (sb: SupabaseClient, ent: EntidadeAgregada) => Promise<AcaoImport | void>;
};

// Ação efetiva de uma linha do upsert (espelha o `acao` da RPC importar_tecido_linha).
export type AcaoImport = "criado" | "complementado" | "so_foto" | "inalterado";

// ---------------------------------------------------------------------------
// Relatório final da importação (mostrado após confirmar).
// ---------------------------------------------------------------------------
export type ImportReportItem = {
  chave: string;
  nome: string;
  // sucesso: criado/complementado/so_foto/inalterado. pulado (ignorado/duplicata) e erro à parte.
  status: AcaoImport | "pulado" | "erro";
  motivo?: string;
};

export type ImportReport = {
  entidade: string;
  criados: number;
  complementados: number;
  soFoto: number;
  inalterados: number;
  pulados: number;
  erros: number;
  itens: ImportReportItem[];
};
