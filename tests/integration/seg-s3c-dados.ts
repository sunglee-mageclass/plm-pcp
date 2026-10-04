// GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3c.mjs (nunca editar à mão; rode o gerador de novo).
// Reforço de segurança S3c — md5 de ANTES|DEPOIS das funções redefinidas, textos novos (e neutros) e ACL exata das 14 tabelas,
// lidos da cópia 54422 (produção + S1 + S2; a S3a/S3b não tocam nada disto). Usado por seg-s3c-helpers.ts / seg-s3c.test.ts.
export const S3C_MD5: Record<string, { antes: string; depois: string }> = {
  "public.salvar_modelo_bom(uuid,jsonb,jsonb,jsonb,integer)": { antes: "25fe991666987cf10d285f72ab08641b", depois: "42d05bcf0f41a517ab73c7beb37d5c99" },
  "public.salvar_cad_completo(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)": { antes: "140eef0b9563420ec27af07f7346813a", depois: "eba98c3bed577eedfdb5aad91a8a9b50" },
  "public.enviar_modelo_para_cad(uuid,text,text)": { antes: "0ba99e761c58da0b5304a35cf00ce7ec", depois: "52fa66fc058af40264f5536185bc7a9a" },
  "public.excluir_cad(uuid)": { antes: "a737f81cfd9c08abc8ac2a581aa88db4", depois: "ba41974bab8c81cd2729da7f440dcef3" },
  "public.salvar_modelo_servico_mo(uuid,jsonb)": { antes: "9a192fad5d62bf5f20f9ea88e6c1be88", depois: "3afb7fd75fdf4c8e12751d804b2861b1" },
  "public.prova_comentar(uuid,text,uuid)": { antes: "a0d692f6e3c22deb08a1fb99a9037e3b", depois: "cbedfe465bab885dd2e860f20f6c2ba4" },
  "public.prova_resolver(uuid,boolean)": { antes: "a57e7bb488d0a2d59cb2464e104975dc", depois: "53a3efab69ac3d7c825bdeb0fa13ed3d" },
  "public.prova_excluir(uuid)": { antes: "4b49851dc684d0300d6b8dbbcf8bf92f", depois: "4c3804c9ea6e5e3fabd61cc4e1682367" },
  "public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)": { antes: "105d1d0eb3b2d0678a28a8edb21dd3af", depois: "a98d8650da2e08696d7a619f97ead5ec" },
  "public.marcar_revisao_pendente(uuid,text[])": { antes: "aaab228d06e2277eaae8f797e00e285c", depois: "1f623c133bc0cae79283a7517f9405d0" },
  "public.set_artigo_categorias(uuid,uuid[])": { antes: "e46f5d73d2f9ec81bd75b7dc566c099c", depois: "03a85084aa485236b9bf5295c8dbd3bf" },
  "public._plan_tecido_arvore_core(uuid)": { antes: "5111f417c2679a4bb2157ad0df61f55a", depois: "7659339f6781ba94decf5fc65524608a" },
};
/** Páginas do portão (OU) por RPC; [] = só B3 (sem página). salvar_modelo_servico_mo = EDITAR o Planejamento E ver custos. */
export const S3C_PAGINAS: Record<string, string[]> = {
  "public.salvar_modelo_bom(uuid,jsonb,jsonb,jsonb,integer)": ["criacao_desenvolvimento","criacao_planejamento"],
  "public.salvar_cad_completo(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)": ["criacao_desenvolvimento"],
  "public.enviar_modelo_para_cad(uuid,text,text)": ["criacao_desenvolvimento"],
  "public.excluir_cad(uuid)": ["criacao_desenvolvimento"],
  "public.salvar_modelo_servico_mo(uuid,jsonb)": ["criacao_planejamento"],
  "public.prova_comentar(uuid,text,uuid)": ["criacao_desenvolvimento"],
  "public.prova_resolver(uuid,boolean)": ["criacao_desenvolvimento"],
  "public.prova_excluir(uuid)": ["criacao_desenvolvimento"],
  "public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)": ["criacao_planejamento","criacao_desenvolvimento","criacao_plan_tecido"],
  "public.marcar_revisao_pendente(uuid,text[])": ["criacao_planejamento","criacao_desenvolvimento","criacao_plan_tecido"],
  "public.set_artigo_categorias(uuid,uuid[])": [],
  "public._plan_tecido_arvore_core(uuid)": [],
};
export const S3C_PAGINA_MO = "criacao_planejamento";
export const S3C_GATILHOS: { tabela: string; fn: string; depois: string; neutra: string; tgtype: number; paginas: string[] }[] = [
  { tabela: "modelo_etiquetas", fn: "public.fn_seg_pagina_modelo_etiquetas()", depois: "7e8cb620cd8c697d068bc712e5f2c0df", neutra: "2930cab11f9b2836e2005cf0229f9754", tgtype: 31, paginas: ["criacao_desenvolvimento"] },
  { tabela: "modelo_observacoes", fn: "public.fn_seg_pagina_modelo_observacoes()", depois: "649719a1ac1b14f87fdf07bab66aa8f1", neutra: "63076d0418d076f0799a58cb48e78eb3", tgtype: 31, paginas: ["criacao_desenvolvimento","producao_terceirizados"] },
];
export const S3C_ACL: Record<string, { antes: [string, string | null]; depois: [string, string | null] }> = {
  modelo_etiquetas: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  modelo_observacoes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  modelo_tecidos: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  modelo_tecido_variantes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  modelo_tecido_oc_links: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  modelo_aviamentos: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  modelo_grades: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  modelo_servico_mo: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  modelo_prova_comentarios: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  cad_tecidos: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  cad_tecido_variantes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  cad_grades: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  cad_aviamentos: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  cad_etiquetas: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
};
/** A tela grava direto (INSERT/UPDATE/DELETE com o gatilho de página + B3). */
export const S3C_DIRETAS: string[] = ["modelo_etiquetas","modelo_observacoes"];
/** Só por RPC (o cliente só lê). */
export const S3C_SO_RPC: string[] = ["modelo_tecidos","modelo_tecido_variantes","modelo_tecido_oc_links","modelo_aviamentos","modelo_grades","modelo_servico_mo","modelo_prova_comentarios","cad_tecidos","cad_tecido_variantes","cad_grades","cad_aviamentos","cad_etiquetas"];
