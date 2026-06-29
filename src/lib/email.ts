import { z } from "zod";

// E-mail "de verdade": exige usuário, @, domínio e TLD com ponto.
// O zod `.email()` e o `<input type="email">` aceitam coisas como "a@b" / "teste@teste"
// (sem domínio real). Esta regra fecha isso — usada no client e nos server functions.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isEmail = (s: string): boolean => EMAIL_RE.test((s ?? "").trim());

export const emailSchema = z
  .string()
  .trim()
  .max(255)
  .regex(EMAIL_RE, "E-mail inválido — use um endereço completo (ex.: nome@empresa.com).");
