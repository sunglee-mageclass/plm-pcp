// Mensagens de erro amigáveis em PT-BR para toasts.
//
// Muitos erros do Postgres/Supabase chegam em INGLÊS (violação de chave estrangeira,
// índice único, RLS, JWT). Aqui traduzimos pelo código SQLSTATE e por padrões de texto.
// Nossas RPCs com `RAISE EXCEPTION` já mandam a mensagem em PT (código P0001) — essas
// passam direto. Quando não reconhecemos o erro, caímos no `fallback` em PT da tela.
//
// Uso: toast.error(mensagemErro(e, "Erro ao excluir."))

import { rotuloDoCampoTravado } from "@/lib/integracao/campos";
import { MENSAGEM_CHAVE_KANBAN_MUDOU } from "@/lib/kanban-auto-config";
import { PREFIXO_CATEGORIA_ACESSORIO_PEDIDO, RecusaEsperadaError, TEXTO_CATEGORIA_ACESSORIO_PEDIDO } from "@/lib/categoria-card-produto";
import { TEXTO_REF_FORMATO_SEM_NUMERO, textoRefSiglaComDigito } from "@/lib/ref-montar";
import { PAGES_CATALOG, MODULE_ROTULO } from "@/lib/permissions-catalog";
import { chavesDoModuloDesligado, textoAcaoPrecisaDeModulos } from "@/lib/modulos-texto";

/** Texto ÚNICO de sessão expirada no app (JWT expirado do PostgREST, padrão "jwt" em inglês e a sessão ausente
 *  de `confirmarLojaAtiva` da Integração) — uma redação só para a mesma situação. */
export const TEXTO_SESSAO_EXPIRADA = "Sua sessão expirou. Entre novamente.";

// SQLSTATE / código PostgREST → mensagem amigável.
const POR_CODIGO: Record<string, string> = {
  "23503": "Não é possível concluir: este registro está em uso por outros dados. Remova ou troque os vínculos antes.",
  "23505": "Já existe um registro com esses dados (valor duplicado).",
  "23502": "Preencha todos os campos obrigatórios.",
  "23514": "Um dos valores informados é inválido.",
  "23P01": "Conflito com outro registro existente.",
  "22P02": "Valor inválido para um dos campos.",
  "22001": "Texto longo demais para um dos campos.",
  "22003": "Número fora do intervalo permitido.",
  "40001": "Conflito de acesso simultâneo. Tente novamente.",
  // Revisão T5 Minor 4: pode acontecer quando o mesmo produto comprado é salvo simultaneamente
  // pelo Sheet do Planejamento e pela tela de Produto Acabado/Importado.
  // deadlock: salvar o mesmo comprado em 2 telas (T5 Minor 4) OU excluir versões da MESMA família ao mesmo tempo (M2 da
  // frente Preço anterior/Título por versão — o congelamento ao excluir). A transação inteira é desfeita.
  "40P01": "Outra pessoa salvou ou excluiu este produto ao mesmo tempo. Nada foi gravado — tente de novo.",
  "42501": "Você não tem permissão para esta ação.",
  // statement_timeout (ex.: Salvar da Config da Loja com o Kanban automático ligado recalcula a loja inteira
  // na MESMA transação — loja grande pode estourar o tempo). A transação inteira é desfeita.
  "57014": "O salvamento demorou demais e foi cancelado — nada foi gravado. Tente de novo em instantes.",
  P0409: "Outra pessoa salvou este registro agora há pouco. A tela foi atualizada — confira suas alterações e salve de novo.",
  P0001: "", // RAISE das nossas funções: já vem em PT, usa a própria mensagem.
  PGRST301: TEXTO_SESSAO_EXPIRADA,
  PGRST116: "Registro não encontrado.",
};

// 42501 com mensagem PRÓPRIA em PT (RAISE das RPCs do Kanban automático — F1): a genérica "Você não
// tem permissão" esconderia o motivo real (ex.: só o ADMIN da loja liga a chave). Lista FECHADA — não
// abrir para todo 42501 (policies/RLS mandam texto técnico em inglês).
const MENSAGENS_42501_PROPRIAS = new Set([
  "Apenas o administrador da loja pode ver a prévia do Kanban automático.",
  "Apenas o administrador da loja pode ligar ou desligar o Kanban automático.",
  "Apenas o administrador da loja pode restaurar as colunas do Kanban.",
  "Sem permissão para mover cards do Desenvolvimento.",
  // Integração + API (motivo real, não o genérico)
  "Sem permissão para ver a Integração.",
  "Sem permissão para editar a Integração.",
  "Só o super admin pode fazer isto.",
  "Loja inativa ou sem loja — operação não permitida.",
  // Config da Loja colaborativa (RPC `salvar_config_loja`, T1/T3)
  "Apenas o administrador da loja pode salvar a Configuração da Loja.",
  // Reprocessar faltas do corte (RPC `reprocessar_faltas_corte`, leves L6)
  "Apenas o administrador da loja pode reprocessar as faltas do corte.",
]);

// Integração › Gerar JSON (20261102100000): recusas P0001 em ASCII com prefixo `gerar_json_*:` (do banco) e `gerar_json_falhou`
// (da server function, qualquer code) → texto PT. Roda ANTES do ramo genérico "P0001 = mensagem já em PT" (senão o ASCII
// cru apareceria). O teto de produtos vem NA mensagem do banco (`min(100, máx. por página da loja)`) — nunca fixo aqui.
const TEXTO_GERAR_JSON_LOJA_MUDOU = "A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.";
function mensagemGerarJson(code: string, msg: string): string | null {
  if (msg.startsWith("gerar_json_falhou")) {
    return "Não foi possível concluir a geração. Nenhum arquivo foi entregue; confira a lista e tente de novo.";
  }
  if (code === "PGRST202" && msg.includes("integracao_gerar_json")) {
    return "O Gerar JSON ainda não está disponível nesta loja (atualização pendente). Nada foi integrado.";
  }
  if (code !== "P0001") return null;
  if (msg.startsWith("gerar_json_loja_mudou:")) return TEXTO_GERAR_JSON_LOJA_MUDOU;
  if (msg.startsWith("gerar_json_itens:")) {
    const m = /envie de 1 a (\d+) produtos/.exec(msg);
    if (msg.includes("repetido")) return "Selecione os produtos sem repetir.";
    return m ? `Selecione de 1 a ${m[1]} produtos.` : "Quantidade de produtos inválida para gerar o arquivo. Selecione menos produtos e tente de novo.";
  }
  if (msg.startsWith("gerar_json_loja:")) return "Algum produto selecionado não é desta loja. Recarregue a página.";
  if (msg.startsWith("gerar_json_limite:")) return "Muitas gerações em pouco tempo. Espere um minuto e tente de novo.";
  // estado de VOLTA: o `_down` da migration neutraliza as RPCs e elas passam a levantar este P0001 (recurso desligado)
  if (msg.startsWith("gerar_json_desligado:")) return "O Gerar JSON está desligado no momento.";
  return null;
}

// Integração + API: as recusas do banco chegam em ASCII com prefixo (lição P-58/P-59 — 5xx só ASCII); a tela traduz aqui.
function mensagemIntegracao(code: string, msg: string): string | null {
  if (code === "42501" && msg.startsWith("integracao_travado:")) {
    const campo = msg.slice("integracao_travado:".length).trim();
    if (campo === "excluir") {
      return "Produto travado pela Integração (integrável ou integrado). Volte para não integrável na tela Integração antes de excluir.";
    }
    return `Produto travado pela Integração (integrável ou integrado): "${rotuloDoCampoTravado(campo)}" não pode mudar. Volte para não integrável na tela Integração (ou, se já integrado, peça ao super admin para desfazer).`;
  }
  if (code === "42501" && msg.startsWith("integracao_sem_permissao:")) {
    // Fix round 1 T12b (revisão A-I4/B-I7 b): a mensagem genérica derrubava até o CAMPO — com um lote de até 50
    // produtos sujos, "você não tem permissão para editar este campo" sem dizer QUAL campo é inútil pra achar a
    // célula certa. Mesmo helper que `integracao_travado:*` já usa (`rotuloDoCampoTravado`).
    const campo = msg.slice("integracao_sem_permissao:".length).trim();
    return `Você não tem permissão para editar "${rotuloDoCampoTravado(campo)}" (mesma regra do card do produto).`;
  }
  if (code === "42501" && msg.startsWith("integracao_sem_custo:")) return 'Com "Preço de custo" marcado, só integra quem pode ver custos.';
  if (code === "P0409" && msg.startsWith("integracao_mudou:")) {
    return "O produto mudou desde o resumo (outra pessoa editou, integrou ou voltou). Confira o resumo novo e confirme de novo.";
  }
  if (code === "P0409" && msg.startsWith("keywords_mudou:")) {
    // Fix round 2 T12b (minor m6): "O texto foi recarregado" ficou falso pro caminho corrigido de
    // `KeywordsDialog.tsx` — o texto DIGITADO nunca é tocado; só o valor de referência (`base`) atualiza por
    // baixo. Esta função é um FALLBACK genérico (usado por qualquer chamador que deixe um erro cru chegar aqui,
    // não só o diálogo — que já trata o P0409 localmente e nunca cai neste `return`); o texto agora descreve o
    // que de fato acontece, sem prometer um recarregamento visível.
    return "Outra pessoa mudou as Keywords da loja enquanto você editava. Confira o valor mais recente e salve de novo.";
  }
  return null;
}

// "Tamanho em" nos cards (20261014100000): `tamanho_tipo invalido: use letra ou numero` (P0001, ASCII) vem de
// _salvar_produto_acabado/importado_core, _salvar_plan_tecido_core e _plan_tecido_criar_card_core.
const PREFIXO_TAMANHO_INVALIDO = "tamanho_tipo invalido:";
export const TEXTO_TAMANHO_INVALIDO = 'O "Tamanho em" precisa ser Letra ou Número.';

// P-207 A (L8, 20261028200000): `_salvar_produto_importado_core` e `_salvar_oc_importado_core` recusam (P0001, ASCII)
// etapa de MERCADORIA com % > 0 e cotação 0 quando a compra tem valor — a tela recusa antes; isto cobre aba com JS
// antigo / outro caminho de gravação.
const PREFIXO_ETAPA_SEM_COTACAO = "Informe a cotacao da etapa de mercadoria";
export const TEXTO_ETAPA_SEM_COTACAO =
  "Há etapa de mercadoria com percentual e sem cotação — informe a cotação da etapa (a de referência é o padrão).";

// Preço anterior e Título por versão (20261018100000): recusas P0001 em ASCII com prefixo → texto PT.
// `versao_congelar: <SQLSTATE>` = a exclusão INTEIRA foi desfeita (falha fechada do congelamento — P-154 A);
// `versao_anterior: limite` / `versoes_integradas: limite` = teto de 500 ids das RPCs de leitura.
export const TEXTO_VERSAO_CONGELAR =
  "Não foi possível guardar o preço/título automático das outras versões — nada foi excluído. Tente excluir de novo.";
export const TEXTO_VERSAO_LIMITE = "Muitos produtos de uma vez (máximo 500). Filtre a lista e tente de novo.";
function mensagemVersao(code: string, msg: string): string | null {
  if (code !== "P0001") return null;
  if (msg.startsWith("versao_congelar:")) return TEXTO_VERSAO_CONGELAR;
  if (msg.startsWith("versao_anterior: limite") || msg.startsWith("versoes_integradas: limite")) return TEXTO_VERSAO_LIMITE;
  return null;
}

// Config da Loja colaborativa (RPC `salvar_config_loja`): recusas P0409 em ASCII com prefixo (regra "RAISE 5xx só
// ASCII"). A tela trata as duas no próprio onError (com os rótulos das colunas); isto é o FALLBACK genérico.
function mensagemConfigLoja(code: string, msg: string): string | null {
  if (code === "P0409" && msg.startsWith("conflito_versao: config_loja")) {
    return "Outra pessoa salvou a Configuração da Loja agora há pouco. Confira os itens em destaque e salve de novo.";
  }
  if (code === "P0409" && msg.startsWith("chave_kanban_mudou:")) return MENSAGEM_CHAVE_KANBAN_MUDOU;
  return null;
}

// Contas certas (blocos A e B, set/2026): as recusas novas chegam em ASCII com prefixo técnico (padrão das mensagens
// novas); a tela mostra o texto PT daqui. P0001 = 400 (acento seria permitido, mas o banco manda o prefixo p/ a tela
// reconhecer). Um texto por prefixo — `MENSAGENS_CONTAS_CERTAS` é exportado p/ os testes.
export const MENSAGENS_CONTAS_CERTAS = {
  parcela_paga: "Esta parcela já está paga — o vencimento de parcela paga não muda.",
  parcela_nao_encontrada: "Esta parcela não existe mais (as parcelas podem ter sido recalculadas). Recarregue a tela.",
  oc_nao_encontrada: "A OC desta parcela não foi encontrada. Recarregue a tela.",
  tipo_oc_sem_regra: "Este tipo de parcela não tem cálculo automático de vencimento.",
  parcela_fora_do_prazo:
    "Esta parcela saiu do prazo atual do serviço (o prazo mudou). Recarregue a tela antes de pagar.",
  parcela_servico_outra_loja: "Esta parcela não pertence à loja do serviço — não foi possível registrar o pagamento.",
  servico_nao_encontrado: "O serviço desta parcela não foi encontrado nesta loja. Recarregue a tela.",
  servico_sem_data_base:
    "O serviço está sem data de entrega nem de envio — não há base para calcular o vencimento. Preencha uma delas e tente de novo.",
  sem_permissao_financeiro: "Você não tem permissão para editar o Financeiro.",
  modulo_financeiro_desligado: "O módulo Financeiro não está habilitado para esta loja.",
  sem_permissao_financeiro_servicos: "Você não tem permissão para editar os Serviços do Financeiro.",
} as const;
function mensagemContasCertas(code: string, msg: string): string | null {
  if (code === "P0001") {
    for (const prefixo of ["parcela_paga", "parcela_nao_encontrada", "oc_nao_encontrada", "tipo_oc_sem_regra",
      "parcela_fora_do_prazo", "parcela_servico_outra_loja", "servico_nao_encontrado",
      "servico_sem_data_base"] as const) {
      if (msg.startsWith(prefixo + ":")) return MENSAGENS_CONTAS_CERTAS[prefixo];
    }
  }
  if (code === "42501") {
    if (msg === "Sem permissao para editar o Financeiro") return MENSAGENS_CONTAS_CERTAS.sem_permissao_financeiro;
    if (msg === "Sem permissao para editar os Servicos do Financeiro") return MENSAGENS_CONTAS_CERTAS.sem_permissao_financeiro_servicos;
    if (msg === "Modulo financeiro nao habilitado para esta loja") return MENSAGENS_CONTAS_CERTAS.modulo_financeiro_desligado;
    if (msg === "Nao autenticado") return TEXTO_SESSAO_EXPIRADA;
  }
  return null;
}

// Leves L3 (kanban #18, R14 msg reprovado): recusas P0001 em ASCII com prefixo (padrão das mensagens novas) → texto PT.
//   `reprovado_explosao:`      — _enviar_modelo_para_cad_core: card em Reprovado (chave do kanban ligada, P-190 A).
//   `ref_formato_sem_numero:`  — salvar_config_loja: Formato da REF com partes e sem a parte "Número sequencial".
//   `ref_sigla_com_digito: X`  — salvar_config_loja: sigla de grupo/categoria/subcategoria com número.
export const TEXTO_REPROVADO_EXPLOSAO = "Card reprovado não vai à Explosão.";
// Leves L3 fix round 1 (M2): `salvar_config_loja` recusa a etapa da REF junto com o Kanban (a tela pré-checa: ref-revelar.ts).
export const PREFIXO_REF_ETAPA_COM_KANBAN = "ref_etapa_com_kanban:";
export const TEXTO_REF_ETAPA_COM_KANBAN =
  "Salve a etapa da REF e o Kanban em dois passos: primeiro as mudanças do Kanban, depois a etapa de revelar a REF.";
export function mensagemLevesL3(code: string, msg: string): string | null {
  if (code !== "P0001") return null;
  if (msg.startsWith("reprovado_explosao:")) return TEXTO_REPROVADO_EXPLOSAO;
  if (msg.startsWith("ref_formato_sem_numero:")) return TEXTO_REF_FORMATO_SEM_NUMERO;
  if (msg.startsWith(PREFIXO_REF_ETAPA_COM_KANBAN)) return TEXTO_REF_ETAPA_COM_KANBAN; // fix round 1 (M2)
  if (msg.startsWith("ref_sigla_com_digito:")) return textoRefSiglaComDigito(msg.slice("ref_sigla_com_digito:".length).trim());
  return null;
}

// OC de Aviamento (release L9, `_salvar_oc_aviamento_core`): recusas P0001 em ASCII com prefixo → texto PT.
// `oc_aviamento_cor_obrigatoria: <aviamento>` (P-208 A: 2+ cores exigem a cor no item novo/editado) e
// `oc_aviamento_preco_invalido:` (P-206 A: preço da compra negativo). O nome vem em ASCII (acento vira "?") — só é mostrado
// quando não perdeu letra.
export const TEXTO_OC_AVIAMENTO_PRECO_INVALIDO = "O preço do aviamento não pode ser negativo.";
export function textoOcAviamentoCorObrigatoria(nome?: string): string {
  const n = (nome ?? "").trim();
  const quem = n && !n.includes("?") ? ` "${n}"` : "";
  return `Escolha a cor do aviamento${quem}: ele tem 2 ou mais cores cadastradas e a cor é obrigatória no item novo ou editado.`;
}
function mensagemOcAviamento(code: string, msg: string): string | null {
  if (code !== "P0001") return null;
  if (msg.startsWith("oc_aviamento_cor_obrigatoria:")) {
    return textoOcAviamentoCorObrigatoria(msg.slice("oc_aviamento_cor_obrigatoria:".length));
  }
  if (msg.startsWith("oc_aviamento_preco_invalido:")) return TEXTO_OC_AVIAMENTO_PRECO_INVALIDO;
  return null;
}

// Reforço de segurança S1 (out/2026, migrations 20261031100000..150000): recusas novas do banco em ASCII com prefixo (regra
// "RAISE só ASCII") → texto PT. 42501 = sem permissão (403); P0001 = regra de negócio (400).
export const MENSAGENS_SEG_S1 = {
  usuario_proprio: "Você não pode alterar o seu próprio papel, status ou e-mail. Peça ao administrador da loja.",
  explosao_protegida:
    "O envio à Explosão só muda pelos botões \"Enviar à Explosão\" e \"Voltar ao Desenvolvimento\". Recarregue o card e tente de novo.",
  ordem_com_explosao: "Este card já foi enviado à Explosão — a Ordem de Criação não pode ser cancelada.",
  cad_sem_ordem: "Envie a Ordem de Criação antes de gravar o CAD.",
  preco_comprado_derivado:
    "O preço de venda do produto comprado vem do markup ou do preço fixo do produto — edite por lá.",
  preco_anterior_sem_permissao: "Você não tem permissão para editar o Preço anterior (a mesma do preço de venda).",
  modulo_producao_desligado: "O módulo Produção não está habilitado para esta loja.",
  sem_permissao_cq: "Você não tem permissão para editar o Controle de Qualidade.",
  cad_nao_encontrado: "CAD não encontrado nesta loja. Recarregue a tela.",
} as const;
export function mensagemSegS1(code: string, msg: string): string | null {
  if (code === "42501") {
    for (const prefixo of ["usuario_proprio", "explosao_protegida", "preco_comprado_derivado", "preco_anterior_sem_permissao",
      "modulo_producao_desligado", "sem_permissao_cq"] as const) {
      if (msg.startsWith(prefixo + ":")) return MENSAGENS_SEG_S1[prefixo];
    }
    if (msg.startsWith("nao_autenticado:")) return TEXTO_SESSAO_EXPIRADA;
  }
  if (code === "P0001") {
    for (const prefixo of ["ordem_com_explosao", "cad_sem_ordem", "cad_nao_encontrado"] as const) {
      if (msg.startsWith(prefixo + ":")) return MENSAGENS_SEG_S1[prefixo];
    }
  }
  return null;
}

// Reforço de segurança S2 (out/2026, migrations 20261031200000..220000): Financeiro por aba NO SERVIDOR (P-232 = D3 A) e o
// módulo Financeiro nas RPCs (C6) — recusas 42501 ASCII com prefixo → texto PT.
export const MENSAGENS_SEG_S2 = {
  financeiro_sem_permissao:
    "Você não tem permissão para editar parcelas de OC (Financeiro › OCs ou Calendário). Peça ao administrador da loja.",
  financeiro_servicos_sem_permissao:
    "Você não tem permissão para editar parcelas de Serviços (Financeiro › Serviços). Peça ao administrador da loja.",
  modulo_financeiro_desligado: "O módulo Financeiro não está habilitado para esta loja.",
} as const;
export function mensagemSegS2(code: string, msg: string): string | null {
  if (code !== "42501") return null;
  for (const prefixo of ["financeiro_servicos_sem_permissao", "financeiro_sem_permissao", "modulo_financeiro_desligado"] as const) {
    if (msg.startsWith(prefixo + ":")) return MENSAGENS_SEG_S2[prefixo];
  }
  return null;
}

// Reforço de segurança S3 (out/2026, S3a = migrations 20261101100000..120000): permissão de PÁGINA no servidor (P-231 = D2 A).
// O banco recusa com 42501 'sem_permissao_pagina: <chave>|<chave>' (ASCII; chaves do permissions-catalog, OU entre elas) — a tela
// mostra o rótulo da página ("Módulo › Página", várias do mesmo módulo juntas: "Entrada e Saída › Alertas de Tecido ou OC Tecido").
export const PREFIXO_SEM_PERMISSAO_PAGINA = "sem_permissao_pagina:";
export const MENSAGENS_SEG_S3 = {
  sem_permissao_pagina: (paginas: string) => `Você não tem permissão para editar ${paginas}. Peça ao administrador da loja.`,
  sem_permissao_pagina_generica: "Você não tem permissão para editar esta tela. Peça ao administrador da loja.",
  // fix round 1 (B3): nº do pedido / código direto só no rolo; OC comum muda pelo Salvar da OC Tecido
  oc_numero_so_pela_rpc: "O número do pedido de uma OC só muda pelo Salvar da OC Tecido. Recarregue a tela e tente de novo.",
  // S3c (P-244 = B): valores de mão de obra só quem EDITA o Planejamento E vê custos
  mao_obra_sem_permissao:
    "Só quem edita o Planejamento e vê custos pode mudar os valores de mão de obra. Peça ao administrador da loja.",
  // S3c (B3): etiqueta/insumo, cor ou modelo de OUTRA loja numa linha desta loja
  loja_diferente: "Esse item é de outra loja e não pode ser usado aqui. Recarregue a tela e escolha de novo.",
  // S6 (P-236 = D7 A): o Salvar nunca faz uma OC recebida voltar a encomendada — só o botão "Desmarcar recebimento"
  oc_recebida_so_desmarcar:
    "Esta OC já foi recebida (talvez por outra pessoa agora). Para voltá-la a encomendada, use \"Desmarcar recebimento\". A tela foi atualizada.",
} as const;
/** "Módulo › Página" de uma chave do catálogo (seção: "Módulo › Página › Seção"); chave desconhecida = a própria chave. */
export function rotuloPaginaPermissao(chave: string): { modulo: string; pagina: string } {
  for (const m of PAGES_CATALOG) {
    for (const p of m.pages) {
      if (p.key === chave) return { modulo: m.label, pagina: p.label };
      const sec = p.sections?.find((x) => x.key === chave);
      if (sec) return { modulo: m.label, pagina: `${p.label} › ${sec.label}` };
    }
  }
  return { modulo: "", pagina: chave };
}
export function textoSemPermissaoPagina(chaves: string[]): string {
  const limpas = chaves.map((k) => k.trim()).filter(Boolean);
  if (!limpas.length) return MENSAGENS_SEG_S3.sem_permissao_pagina_generica;
  const porModulo = new Map<string, string[]>();
  for (const k of limpas) {
    const { modulo, pagina } = rotuloPaginaPermissao(k);
    const lista = porModulo.get(modulo) ?? [];
    if (!lista.includes(pagina)) lista.push(pagina);
    porModulo.set(modulo, lista);
  }
  const partes = [...porModulo.entries()].map(([modulo, paginas]) => (modulo ? `${modulo} › ` : "") + paginas.join(" ou "));
  return MENSAGENS_SEG_S3.sem_permissao_pagina(partes.join(" ou "));
}
export function mensagemSegS3(code: string, msg: string): string | null {
  if (code === "42501" && msg.startsWith("oc_numero_so_pela_rpc:")) return MENSAGENS_SEG_S3.oc_numero_so_pela_rpc;
  if (code === "42501" && msg.startsWith("mao_obra_sem_permissao:")) return MENSAGENS_SEG_S3.mao_obra_sem_permissao;
  if (code === "P0001" && msg.startsWith("loja_diferente:")) return MENSAGENS_SEG_S3.loja_diferente;
  if (code === "P0001" && msg.startsWith("oc_recebida_so_desmarcar:")) return MENSAGENS_SEG_S3.oc_recebida_so_desmarcar;
  if (code !== "42501" || !msg.startsWith(PREFIXO_SEM_PERMISSAO_PAGINA)) return null;
  return textoSemPermissaoPagina(msg.slice(PREFIXO_SEM_PERMISSAO_PAGINA.length).split("|"));
}

// Modularidade (out/2026, migrations 20261103100000..120000): recusas do servidor por MÓDULO desligado e por coleção com cards.
// - 42501 `modulo_desligado: a,b` (ASCII, `_exige_modulos`) → "Esta ação precisa do módulo A (e dos módulos A e B)…".
// - 42501 com o texto LEGADO "Módulo criacao não habilitado para esta loja" (checagens antigas que rodam antes do portão novo, e
//   as de outras RPCs): a mesma frase PT, com o rótulo do módulo (chave interna ou nome já em PT, como veio).
// - P0001 `colecao_com_cards: N` (otb_excluir_colecao) → quantos cards seguram a coleção.
// - 23503 ao excluir coleção ligada só por produto acabado/importado (a contagem do servidor olha os cards): a FK barra, texto PT.
const TEXTO_COLECAO_EM_USO_POR_PRODUTO =
  "Esta coleção está em uso por produto(s) acabado(s) ou importado(s) — mova ou exclua esses produtos antes de excluir a coleção.";
const TEXTO_COLECAO_COM_CARDS_GENERICO = "Esta coleção tem cards no Planejamento — mova ou exclua os cards antes de excluir a coleção.";
export function textoColecaoComCards(n: number): string {
  const cards = n === 1 ? "1 card" : `${n} cards`;
  return `Esta coleção tem ${cards} no Planejamento — mova ou exclua os cards antes de excluir a coleção.`;
}
export function mensagemModularidade(code: string, msg: string): string | null {
  if (code === "42501" && msg.startsWith("modulo_desligado:")) {
    const chaves = chavesDoModuloDesligado(msg);
    return chaves.length ? textoAcaoPrecisaDeModulos(chaves) : null;
  }
  if (code === "42501") {
    const legado = /^Módulo (.+?) não habilitado/.exec(msg);
    if (legado) {
      // chave interna ("criacao", "entrada_saida", "otb"…) → rótulo do catálogo; nome já em PT ("Produto Acabado (Revenda)") fica como veio.
      const bruto = legado[1].trim();
      const chave = bruto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return textoAcaoPrecisaDeModulos([(MODULE_ROTULO as Record<string, string>)[chave] ?? bruto]);
    }
  }
  if (code === "P0001" && msg.startsWith("colecao_com_cards:")) {
    const n = Number(/colecao_com_cards:\s*(\d+)/.exec(msg)?.[1]);
    return Number.isFinite(n) && n > 0 ? textoColecaoComCards(n) : TEXTO_COLECAO_COM_CARDS_GENERICO;
  }
  if (code === "23503") {
    const fk = /delete on table "colecoes" violates foreign key constraint "(produtos_acabados|produtos_importados|modelos)_colecao_id_fkey"/.exec(msg);
    if (fk) return fk[1] === "modelos" ? TEXTO_COLECAO_COM_CARDS_GENERICO : TEXTO_COLECAO_EM_USO_POR_PRODUTO;
  }
  return null;
}

function getCode(e: any): string {
  return String(e?.code ?? e?.error?.code ?? e?.cause?.code ?? "");
}
function getMessage(e: any): string {
  if (typeof e === "string") return e;
  return String(e?.message ?? e?.error?.message ?? e?.error_description ?? e?.msg ?? "");
}

// Traduz mensagens em inglês conhecidas quando não há código confiável.
function traduzPadrao(msg: string): string | null {
  const m = msg.toLowerCase();
  if (!m) return null;
  if (m.includes("violates foreign key") || m.includes("still referenced")) return POR_CODIGO["23503"];
  if (m.includes("duplicate key") || m.includes("unique constraint")) return POR_CODIGO["23505"];
  // Colisão de e-mail vinda do Auth (GoTrue) — chega em inglês, sem SQLSTATE.
  if (m.includes("already registered") || m.includes("already been registered") ||
      m.includes("email_exists") || (m.includes("email") && m.includes("already")))
    return "Já existe uma conta com este e-mail.";
  if (m.includes("null value") && m.includes("not-null")) return POR_CODIGO["23502"];
  if (m.includes("violates check constraint")) return POR_CODIGO["23514"];
  if (m.includes("row-level security") || m.includes("row level security"))
    return "Você não tem permissão para esta ação nesta loja.";
  if (m.includes("permission denied") || m.includes("not authorized") || m.includes("insufficient privilege"))
    return POR_CODIGO["42501"];
  if (m.includes("jwt") || m.includes("not authenticated") || m.includes("invalid token") || m.includes("token is expired"))
    return TEXTO_SESSAO_EXPIRADA;
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network request failed"))
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  return null;
}

// A mensagem já parece português? (evita devolver texto cru em inglês).
const PARECE_PT =
  /[áàâãéêíóôõúüç]|\b(n[aã]o|j[aá]|usu[aá]rio|loja|rolo|estoque|parcela|tecido|erro|inv[aá]lid|obrigat[oó]ri|permiss|registro|excluir|salvar|nenhum|quantidade|metragem)\b/i;

export function mensagemErro(e: unknown, fallback?: string): string {
  // Validação do próprio front (RecusaEsperadaError): o texto já é o final em PT — devolve direto,
  // mesmo sem acento (PARECE_PT não pode engoli-lo). Não afrouxa PARECE_PT para o resto.
  if (e instanceof RecusaEsperadaError && e.message) return e.message;
  const code = getCode(e);
  const msg = getMessage(e);
  // Recusas ESPERADAS (P-137: pré-checagem do front ou P0001 do gatilho) não são erro do sistema: não vão pro console.
  const recusaEsperada = e instanceof RecusaEsperadaError
    || (code === "P0001" && msg.startsWith(PREFIXO_CATEGORIA_ACESSORIO_PEDIDO));
  if (import.meta.env.DEV && !recusaEsperada) console.error(e);

  // "Tamanho em" nos cards (20261014100000): recusa em ASCII (padrão das mensagens novas) → texto PT.
  if (code === "P0001" && msg.startsWith(PREFIXO_TAMANHO_INVALIDO)) return TEXTO_TAMANHO_INVALIDO;
  if (code === "P0001" && msg.startsWith(PREFIXO_ETAPA_SEM_COTACAO)) return TEXTO_ETAPA_SEM_COTACAO; // P-207 A (L8)
  const versao = mensagemVersao(code, msg);
  if (versao) return versao;

  // P-137 A (20261017100000): produto com pedido não troca entre Acessórios e outro grupo pela Categoria do card —
  // recusa ASCII com prefixo (do gatilho fn_modelo_espelho_categoria OU da pré-checagem do front) → texto PT.
  if (code === "P0001" && msg.startsWith(PREFIXO_CATEGORIA_ACESSORIO_PEDIDO)) return TEXTO_CATEGORIA_ACESSORIO_PEDIDO;

  // OC de Aviamento (L9): cor obrigatória / preço negativo — prefixos ASCII (P0001) → texto PT.
  const ocAviamento = mensagemOcAviamento(code, msg);
  if (ocAviamento) return ocAviamento;

  // Contas certas: prefixos ASCII (P0001) e 42501 sem acento das RPCs novas → texto PT.
  const contasCertas = mensagemContasCertas(code, msg);
  if (contasCertas) return contasCertas;

  // Leves L3: prefixos ASCII (P0001) do reprovado na Explosão e do Formato da REF → texto PT.
  const levesL3 = mensagemLevesL3(code, msg);
  if (levesL3) return levesL3;

  // Reforço de segurança S1: prefixos ASCII (42501/P0001) das guardas novas → texto PT.
  const segS1 = mensagemSegS1(code, msg);
  if (segS1) return segS1;
  // Reforço de segurança S2: Financeiro por aba / módulo Financeiro (42501 ASCII) → texto PT.
  const segS2 = mensagemSegS2(code, msg);
  if (segS2) return segS2;
  // Reforço de segurança S3: permissão de página no servidor (42501 ASCII 'sem_permissao_pagina: <chaves>') → texto PT.
  const segS3 = mensagemSegS3(code, msg);
  if (segS3) return segS3;

  // Modularidade: módulo desligado (portão novo + texto legado), coleção com cards e a FK da coleção → texto PT.
  const modularidade = mensagemModularidade(code, msg);
  if (modularidade) return modularidade;

  // Integração › Gerar JSON: ASCII com prefixo (P0001) → texto PT (antes do ramo genérico abaixo).
  const gerarJson = mensagemGerarJson(code, msg);
  if (gerarJson) return gerarJson;

  // RAISE custom (P0001) das nossas funções → mensagem já está em PT.
  if (code === "P0001" && msg) return msg;

  const integracao = mensagemIntegracao(code, msg);
  if (integracao) return integracao;

  const configLoja = mensagemConfigLoja(code, msg);
  if (configLoja) return configLoja;

  // 42501 do Kanban automático com texto próprio → mostra o motivo real.
  if (code === "42501" && MENSAGENS_42501_PROPRIAS.has(msg)) return msg;

  // Código SQLSTATE/PostgREST conhecido.
  if (code && POR_CODIGO[code]) return POR_CODIGO[code];

  // Padrão de texto em inglês reconhecível.
  const traduzido = traduzPadrao(msg);
  if (traduzido) return traduzido;

  // Mensagem já em PT (validações próprias, RAISE sem código detectado) → mantém.
  if (msg && PARECE_PT.test(msg)) return msg;

  // Caso contrário, prefere o fallback em PT da própria tela.
  if (fallback) return fallback;

  return msg || "Ocorreu um erro inesperado. Tente novamente.";
}
