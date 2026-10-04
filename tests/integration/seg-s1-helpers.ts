/**
 * Reforço de segurança — Release S1 (plano .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md §2 S1).
 * Aplica as 6 migrations DENTRO da transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local.
 * Usado por `seg-s1.test.ts` e pelo gancho `S1_TXN=1` de `db.ts` (ensaio da suíte inteira com a S1 aplicada, sem tocar a cópia).
 */
import type { Client } from "pg";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import { voltaS2SePreciso } from "./seg-s2-helpers";
import { voltaS3bSePreciso } from "./seg-s3b-helpers";
import { voltaS3cSePreciso } from "./seg-s3c-helpers";
import { voltaS3dSePreciso } from "./seg-s3d-helpers";

export const S1_MIGS = [
  "supabase/migrations/20261031100000_seg_s1_usuario_proprio.sql",
  "supabase/migrations/20261031110000_seg_s1_modulos_super.sql",
  "supabase/migrations/20261031120000_seg_s1_modelos_guarda.sql",
  "supabase/migrations/20261031130000_seg_s1_revoke_anon.sql",
  "supabase/migrations/20261031140000_seg_s1_default_acl.sql",
  "supabase/migrations/20261031150000_seg_s1_residuos.sql",
] as const;

/** Inversos em ordem LIFO (o mais novo primeiro). */
export const S1_DOWNS = [...S1_MIGS].reverse().map((m) => m.replace("supabase/migrations/", "supabase/rollback/").replace(/\.sql$/, "_down.sql"));

/** md5 de ANTES|DEPOIS de cada função redefinida (o mesmo das guardas/pós-condições das migrations). */
export const S1_MD5: Record<string, { antes: string; depois: string }> = {
  "public.prevent_users_self_role_change()": { antes: "1646cd991e542bde6298bca5884165d1", depois: "67b3a01f0702d6515d00a8dc4472e2ba" },
  "public.fn_kanban_chave_protegida()": { antes: "1ef1c127ef0981132f66b4549914368b", depois: "b0d06cc77762643040c8aff07fba3f0b" },
  "public.fn_modelo_preco_venda_gate()": { antes: "4eeb8baaaee829f0a44c643e3beb69fe", depois: "e89be53c25f421724994e78b756a027d" },
  "public._enviar_modelo_para_cad_core(uuid,text,text)": { antes: "14179bce7709643ea068edfed128ca43", depois: "bf28796bcd86538a3a5b516e9cf356c6" },
  "public.excluir_cad(uuid)": { antes: "4c1e576932ed160fdb0ec5ebec3d3a2c", depois: "a737f81cfd9c08abc8ac2a581aa88db4" },
  "public.voltar_modelo_desenvolvimento(uuid)": { antes: "3a43fa4204a4f429a6c878e63c2557eb", depois: "b5c893d56d4745b0a4e0938b20676ba7" },
  "public._salvar_cad_completo_core(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)": {
    antes: "8f1455c310792b91fd69c1d7b624a64e", depois: "de45e1c2d045648ebbb4a9b3a86bb7c7",
  },
  "public._pa_recomputar_precos_modelo(uuid)": { antes: "3f0c4d88da8e23a61ff9e3dda7817be2", depois: "5ab86f9ef7abd8f11310da804aa6eb4b" },
  "public._imp_recomputar_precos_modelo(uuid)": { antes: "bbda77c40c515686a4307a563749b3dc", depois: "1c525cb7ab309240c6fec182f59d58a8" },
  "public.cq_set_oficina_desconto_multa(uuid,numeric,numeric)": { antes: "47b8d71b87c932628d3246b34b735af2", depois: "04fcd75c8d467ab07476a43395d27eee" },
  "public.confirmar_direcionamento(uuid,jsonb,jsonb)": { antes: "8ffed432a737ff2694b20176e8460166", depois: "eabcf06adce7b406982d69299c116d49" },
  // fix round 1 (BAIXO-1): a sobrecarga antiga de 2 argumentos também confere login + loja antes do _cq_liberado
  "public.confirmar_direcionamento(uuid,jsonb)": { antes: "7ac742b325e289b8c2e069c2cea9216c", depois: "f77843db2651601c490bd3c64f4f8030" },
  "public.tenant_module_enabled(text)": { antes: "843163ccc128c53753ed08d3e4041cb3", depois: "ddd46592f2ff7cdb352778c605ecd8a4" },
  "public._sync_foto_modelo_do_produto()": { antes: "c0892e7c9fed1d47b9256fc8fb61deaf", depois: "59e8a2f84660aad1dc89fabaa3f30735" },
};

async function zeraTimeouts(c: Client): Promise<void> {
  // As migrations fazem SET LOCAL transaction_timeout (vale para a txn INTEIRA do teste) — devolve ao normal do teste.
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

export async function aplicaS1(c: Client): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  await voltaS3dSePreciso(c); // LIFO: a S3d (20261101190000) redefine RPCs que a S1 (20261031130000) guarda — sai antes
  await voltaS3cSePreciso(c); // LIFO: a S3c (20261101160000) redefine excluir_cad por cima da S1 (20261031120000) — sai antes
  await voltaS3bSePreciso(c); // LIFO: a S3b (20261101130000) redefine voltar_modelo_desenvolvimento/confirmar_direcionamento por cima da S1 — sai antes
  for (const m of S1_MIGS) await aplicarArquivo(c, m);
  await zeraTimeouts(c);
}

export async function voltaS1(c: Client): Promise<void> {
  exigeBancoLocal();
  const { voltaS5SePreciso } = await import("./seg-s5-helpers"); // LIFO: a S5 (grants por cima de tudo) sai antes
  await voltaS5SePreciso(c);
  await voltaS3dSePreciso(c); // LIFO: a S3d sai antes da S1
  await voltaS3cSePreciso(c); // LIFO: a S3c sai antes da S1
  await voltaS3bSePreciso(c); // LIFO: a S3b sai antes da S1
  for (const m of S1_DOWNS) await aplicarArquivo(c, m);
  await zeraTimeouts(c);
}

/** ANON-1: as 52 RPCs SECURITY DEFINER que o anon executava (ACL de EXECUTE de ANTES, lida da cópia). */
export const S1_RPCS: ReadonlyArray<[sig: string, aclAntes: string]> = [
  ["public.ajustar_rolo(uuid,numeric)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.ajustes_estoque_lista()", "authenticated,postgres,PUBLIC,service_role"],
  ["public.aplicar_plan_tecido_grade(uuid,jsonb)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.aplicar_resolucao_alerta_tecido(uuid,text,uuid,uuid,numeric)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.aprovar_servico_mo(uuid,uuid,boolean,text)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.baixar_estoque_tecido_corte(uuid,integer)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.cancelar_rolo(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.confirmar_direcionamento(uuid,jsonb,jsonb)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.cq_oficina_servico(uuid)", "authenticated,postgres,PUBLIC,service_role"],
  ["public.cq_set_oficina_desconto_multa(uuid,numeric,numeric)", "authenticated,postgres,PUBLIC,service_role"],
  ["public.criar_card_produto_importado(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.custo_unitario_modelos(uuid[])", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.desmarcar_recebimento_oc_etiqueta(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.desmarcar_recebimento_oc(text,uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.enderecos_tecido()", "authenticated,postgres,PUBLIC,service_role"],
  ["public.estoque_tecido()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.excluir_oc_tecido(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.excluir_produto_importado(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.gerar_rolos_recebimento(uuid,jsonb)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.marcar_etapa_verificada(uuid,text)", "authenticated,postgres,PUBLIC,service_role"],
  ["public.marcar_revisao_pendente(uuid,text[])", "authenticated,postgres,PUBLIC,service_role"],
  ["public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)", "authenticated,postgres,PUBLIC,service_role"],
  ["public.modelo_etapas_afetadas(uuid)", "authenticated,postgres,PUBLIC,service_role"],
  ["public.modelo_mo_resumo(uuid[])", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.modelos_mo_a_aprovar_count()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.ocs_para_rolo()", "authenticated,postgres,PUBLIC,service_role"],
  ["public.otb_atribuir_card(uuid,uuid,text)", "authenticated,postgres,PUBLIC,service_role"],
  ["public.otb_desconfirmar(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.otb_orcamento(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.plan_tecido_pedido_fotos(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.plan_tecido_set_pedido_fotos(uuid,text,text[])", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.proximo_codigo_rolo(uuid)", "authenticated,postgres,PUBLIC,service_role"],
  ["public.reabrir_rolo(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.receber_reposicao_troca(uuid,date,numeric)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.remover_metragem_oc(uuid,numeric,text)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.renomear_tipo_colaborador(uuid,text,uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.reverter_ajuste_estoque(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.reverter_rolos_oc(uuid)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_direcionamento(uuid,jsonb,jsonb)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_modelo_servico_mo(uuid,jsonb)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_oc_aviamento(uuid,jsonb,jsonb)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_oc_etiqueta(uuid,jsonb,jsonb)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb,integer)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_oc_p_acabado(uuid,jsonb,jsonb,integer)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_produto_acabado(uuid,jsonb,jsonb,integer)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb,integer)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.set_artigo_categorias(uuid,uuid[])", "authenticated,postgres,PUBLIC,service_role"],
  ["public.set_user_permissions(uuid,uuid,jsonb)", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.trocar_rolo(uuid,numeric)", "anon,authenticated,postgres,PUBLIC,service_role"],
];
/** ANON-2: as 54 funções de GATILHO SECURITY DEFINER com EXECUTE para PUBLIC/anon/authenticated (ACL de ANTES). */
export const S1_GATILHOS: ReadonlyArray<[sig: string, aclAntes: string]> = [
  ["public.criar_tenant_config_padrao()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.enforce_empresa_tenant()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.enforce_oc_pa_produto_tenant()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.enforce_produto_acabado_modelo_tenant()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.enforce_servico_mo_aprovacao()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.enforce_servico_mo_del_aprovacao()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_aviamento_codigo()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_colab_bump_cq()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_colab_bump_modelo_via_tecido()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_colab_bump_modelo()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_colab_bump_oc()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_colab_bump_plan()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_espelho_modelo_nome_ref()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_integracao_trava_espelho()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_integracao_trava_modelos_del()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_integracao_trava_modelos()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_integracao_trava_skus()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_integracao_trava_variantes()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_chave_protegida()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_config()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_fila_categoria()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_fila_modelo()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_fila_por_cad_tecido()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_fila_por_cad()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_fila_por_modelo_tecido()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_fila_por_modelo()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_historico()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_processar_fila()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_regredir_cad_grades()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_regredir_cad()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_regredir_cq()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_regredir_modelos()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_kanban_status_guard()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_modelo_espelho_nome_ref()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_modelo_mo_flag_derivada()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_modelo_ref_auto()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_modelo_servico_mo_rollup()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_oc_importado_numero()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_oc_p_acabado_numero()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_produto_acabado_ref()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_produto_importado_ref()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_rebaixa_direcionamento_grade()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_rebaixa_lancado_cq()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.fn_sync_modelo_subcolecao()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.gerar_parcelas_oc_etiqueta()", "authenticated,postgres,service_role"],
  ["public.gerar_parcelas_oc_p_acabado()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.recalc_parcelas_aviamento_on_item()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.recalc_parcelas_etiqueta_on_item()", "authenticated,postgres,service_role"],
  ["public.recalc_parcelas_on_valor()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.trg_fn_parcelas_importado_etapa()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.trg_fn_parcelas_importado_oc()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.variantes_etiqueta_sync_preco()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.variantes_tecido_log_preco()", "anon,authenticated,postgres,PUBLIC,service_role"],
  ["public.variantes_tecido_sync_artigo_preco()", "anon,authenticated,postgres,PUBLIC,service_role"],
];
/** Os 4 auxiliares de RLS que FICAM com EXECUTE para o anon até a S5 (depois do ANON-3). */
export const S1_AUX_RLS = ["public.meu_tenant_ativo()", "public.tenant_module_enabled(text)", "public.user_can_edit(text)", "public.user_can_view(text)"] as const;

/** Teste md5-pinado de release ANTERIOR: aceita também o texto da S1 quando a S1 redefiniu aquela função por cima
 *  (sucessor aceito, mesmo padrão do `md5OuSucessorI3`). `pinado` = o md5 que o teste antigo esperava. */
export function md5OuSucessorS1(sig: string, pinado: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const s = S1_MD5[k];
  return s && s.antes === pinado ? [pinado, s.depois] : [pinado];
}

/** A S1 está viva NESTA txn (cópia com a S1 aplicada, ou S1_TXN=1)? Pela função-sentinela da guarda de modelos. */
export async function s1Viva(c: Client): Promise<boolean> {
  const sig = "public.fn_modelo_preco_venda_gate()";
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig]);
  return r.rows[0]?.m === S1_MD5[sig].depois;
}
/** LIFO para as suítes que VOLTAM releases anteriores dentro da txn (L8, R14, distribuição, L3…): a S1 sai primeiro. */
export async function voltaS1SePreciso(c: Client): Promise<void> {
  await voltaS2SePreciso(c); // LIFO: a S2 (20261031200000..220000) é mais nova que a S1 — sai antes
  if (!(await s1Viva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaS1(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}
