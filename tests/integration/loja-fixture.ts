// Helpers de PREPARAÇÃO para testes de integração que dependiam do estado VIVO da Loja Teste da cópia local (T1, frente Backend, 05/out).
// Regra: tudo roda DENTRO da txn do `withTx` (BEGIN…ROLLBACK) — nada persiste; nunca escreve dado fora dela. A Loja Teste é dado do dono
// (ex.: ele liga a chave do kanban automático, mexe na config) e o teste não pode depender do valor que ela tem hoje.
import type { Client } from "pg";
import { TENANT_TESTE } from "./db";

/**
 * Desliga a chave do kanban automático da loja NESTA txn, pelo caminho da RPC `kanban_definir_automatico` (GUC transação-local
 * `app.kanban_chave='rpc'`; sem ela `trg_kanban_chave_protegida` mantém o valor). Com a chave ligada o status do card é DERIVADO pelo motor
 * (guard 3G ignora o UPDATE direto de coluna automática) — testes do modo manual (REF por etapa, Envio à Explosão…) precisam dela desligada.
 */
export async function kanbanChaveDesligada(c: Client, tenant: string = TENANT_TESTE): Promise<void> {
  await c.query(`SELECT set_config('app.kanban_chave', 'rpc', true)`);
  try {
    await c.query(`UPDATE public.tenant_config SET kanban_automatico = false WHERE tenant_id = $1`, [tenant]);
  } finally {
    await c.query(`SELECT set_config('app.kanban_chave', '', true)`);
  }
}
