// Maps Supabase auth error messages to user-friendly Portuguese strings.
// Unknown errors fall back to a generic message; full error is logged server/console-side.
export function friendlyAuthError(message: string | undefined | null): string {
  const m = (message ?? "").toLowerCase();
  if (!m) return "Ocorreu um erro inesperado. Tente novamente.";
  if (m.includes("invalid login credentials") || m.includes("invalid_credentials"))
    return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed"))
    return "E-mail ainda não confirmado. Verifique sua caixa de entrada.";
  if (m.includes("user already registered") || m.includes("already registered"))
    return "Já existe uma conta com este e-mail.";
  if (m.includes("password should be") || m.includes("password") && m.includes("characters"))
    return "Senha não atende aos requisitos mínimos.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (m.includes("network") || m.includes("fetch"))
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  return "Não foi possível concluir a operação. Tente novamente.";
}

// Generic sanitizer for non-auth backend errors shown via toast.
export function friendlyError(_err: unknown, fallback = "Ocorreu um erro inesperado. Tente novamente."): string {
  if (import.meta.env.DEV) console.error(_err);
  return fallback;
}
