// Mensagens de erro amigáveis em PT-BR para toasts.
//
// Muitos erros do Postgres/Supabase chegam em INGLÊS (violação de chave estrangeira,
// índice único, RLS, JWT). Aqui traduzimos pelo código SQLSTATE e por padrões de texto.
// Nossas RPCs com `RAISE EXCEPTION` já mandam a mensagem em PT (código P0001) — essas
// passam direto. Quando não reconhecemos o erro, caímos no `fallback` em PT da tela.
//
// Uso: toast.error(mensagemErro(e, "Erro ao excluir."))

import { rotuloDoCampoTravado } from "@/lib/integracao/campos";

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
  "40P01": "Outra pessoa salvou este produto ao mesmo tempo. Tente de novo.",
  "42501": "Você não tem permissão para esta ação.",
  P0409: "Outra pessoa salvou este registro agora há pouco. A tela foi atualizada — confira suas alterações e salve de novo.",
  P0001: "", // RAISE das nossas funções: já vem em PT, usa a própria mensagem.
  PGRST301: "Sua sessão expirou. Entre novamente.",
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
]);

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
    return "Outra pessoa mudou as Keywords da loja enquanto você editava. O texto foi recarregado — confira e salve de novo.";
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
    return "Sua sessão expirou. Entre novamente.";
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network request failed"))
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  return null;
}

// A mensagem já parece português? (evita devolver texto cru em inglês).
const PARECE_PT =
  /[áàâãéêíóôõúüç]|\b(n[aã]o|j[aá]|usu[aá]rio|loja|rolo|estoque|parcela|tecido|erro|inv[aá]lid|obrigat[oó]ri|permiss|registro|excluir|salvar|nenhum|quantidade|metragem)\b/i;

export function mensagemErro(e: unknown, fallback?: string): string {
  if (import.meta.env.DEV) console.error(e);
  const code = getCode(e);
  const msg = getMessage(e);

  // RAISE custom (P0001) das nossas funções → mensagem já está em PT.
  if (code === "P0001" && msg) return msg;

  const integracao = mensagemIntegracao(code, msg);
  if (integracao) return integracao;

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
