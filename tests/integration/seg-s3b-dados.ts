// GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3b.mjs (nunca editar à mão; rode o gerador de novo).
// Reforço de segurança S3b — md5 de ANTES|DEPOIS das funções redefinidas, textos novos (e neutros) e ACL exata das 8 tabelas,
// lidos da cópia 54422 (produção + S1 + S2; a S3a não toca nada disto). Usado por seg-s3b-helpers.ts / seg-s3b.test.ts.
export const S3B_MD5: Record<string, { antes: string; depois: string }> = {
  "public.baixar_estoque_tecido_corte(uuid,integer)": { antes: "5dda094db517e00cfd33ec0cfbf20c4b", depois: "9cac6689b615cc1eed1fa8de894dbb5a" },
  "public.salvar_explosao_metragem(uuid,jsonb,integer)": { antes: "2b5aba5b5950a2f1a518e272ce7d9119", depois: "95fa0bdd1b1a5045781e2152edba4980" },
  "public.salvar_explosao_aviamento_separar(uuid,jsonb,integer)": { antes: "1845b1344db449e48bce8b7c130a21e3", depois: "e0f35d177abd29b05557f22837f9ef9c" },
  "public.salvar_explosao_etiqueta_enviar(uuid,jsonb,integer)": { antes: "4878cd5b60d6325eb61205cf4f457ee7", depois: "9ba9b5dcb9917290db0b463dd12e7049" },
  "public.voltar_modelo_desenvolvimento(uuid)": { antes: "b5c893d56d4745b0a4e0938b20676ba7", depois: "f113c6d63fe95083b71238a21b0914ca" },
  "public.reverter_corte_tecido(uuid)": { antes: "a0618165459e6f108234568e2a9f2b55", depois: "3828600c053a87149670e0cff9985f5e" },
  "public.salvar_terceirizados(uuid,jsonb,text,jsonb)": { antes: "e5a6f830516e463911529664a4940883", depois: "7199a05fac6716ac110bfa637944c2e9" },
  "public.salvar_cq(uuid,jsonb,jsonb,jsonb,boolean,jsonb)": { antes: "f97b669067369880338e13ba0bd02da8", depois: "a8a4e3897521959ed703a3ed3334d2a1" },
  "public.desmarcar_cq(uuid)": { antes: "359e16a0cc30fa685400590938153441", depois: "8f60caff1f81f138f7e94c8f422608e9" },
  "public.voltar_cq_para_servico(uuid)": { antes: "b59ab5ce0ac0508b1d12eee3a09c186f", depois: "0864b68c5b72e7a3ad5962fe2436f76c" },
  "public.salvar_cq_pos(uuid,jsonb,jsonb,boolean)": { antes: "f286be52d2661accdf1a6e7b15967b3a", depois: "3979153ea0aee5aea6456a3b225f5c35" },
  "public.desmarcar_cq_pos(uuid)": { antes: "769367d2984c389358b9271f90565abe", depois: "fe4290b5047b7e901f105ac310788e5e" },
  "public.salvar_direcionamento(uuid,jsonb)": { antes: "b3b3825d18cb62d9e128bf575aae4b84", depois: "1ad733ba008eeede3c5448c8556c6a25" },
  "public.salvar_direcionamento(uuid,jsonb,jsonb)": { antes: "936e401662f35fe205c85d11e13e2d82", depois: "7f5e84c87bcfe7f14d123053063da1d0" },
  "public.confirmar_direcionamento(uuid,jsonb)": { antes: "f77843db2651601c490bd3c64f4f8030", depois: "dfb42e20403796a8dfa227d9d29bcbcc" },
  "public.confirmar_direcionamento(uuid,jsonb,jsonb)": { antes: "eabcf06adce7b406982d69299c116d49", depois: "ae30cec520c8a1cc436e500b3b976396" },
  "public.marcar_etapa_verificada(uuid,text)": { antes: "4e959d07d13535aca36be38c6f19c3f3", depois: "771b79bc4b30403c50f01256cfd6ba58" },
};
export const S3B_PAGINAS: Record<string, string[]> = {
  "public.baixar_estoque_tecido_corte(uuid,integer)": ["producao_explosao"],
  "public.salvar_explosao_metragem(uuid,jsonb,integer)": ["producao_explosao"],
  "public.salvar_explosao_aviamento_separar(uuid,jsonb,integer)": ["producao_explosao"],
  "public.salvar_explosao_etiqueta_enviar(uuid,jsonb,integer)": ["producao_explosao"],
  "public.voltar_modelo_desenvolvimento(uuid)": ["producao_explosao"],
  "public.reverter_corte_tecido(uuid)": ["producao_terceirizados","producao_explosao"],
  "public.salvar_terceirizados(uuid,jsonb,text,jsonb)": ["producao_terceirizados","producao_etapas"],
  "public.salvar_cq(uuid,jsonb,jsonb,jsonb,boolean,jsonb)": ["producao_cq"],
  "public.desmarcar_cq(uuid)": ["producao_cq"],
  "public.voltar_cq_para_servico(uuid)": ["producao_cq"],
  "public.salvar_cq_pos(uuid,jsonb,jsonb,boolean)": ["producao_cq"],
  "public.desmarcar_cq_pos(uuid)": ["producao_cq"],
  "public.salvar_direcionamento(uuid,jsonb)": ["producao_direcionamento"],
  "public.salvar_direcionamento(uuid,jsonb,jsonb)": ["producao_direcionamento"],
  "public.confirmar_direcionamento(uuid,jsonb)": ["producao_direcionamento"],
  "public.confirmar_direcionamento(uuid,jsonb,jsonb)": ["producao_direcionamento"],
  "public.marcar_etapa_verificada(uuid,text)": ["criacao_desenvolvimento","criacao_planejamento","producao_terceirizados","producao_cq","producao_direcionamento","producao_lancamentos","producao_oficina"],
};
/** marcar_etapa_verificada: página(s) por etapa (espelho de PAGINAS_POR_ETAPA no front) e o OU de "outra etapa". */
export const S3B_ETAPAS: Record<string, string[]> = {"kanban":["criacao_desenvolvimento","criacao_planejamento"],"terceirizados":["producao_terceirizados"],"cq":["producao_cq"],"direcionamento":["producao_direcionamento"],"lancamentos":["producao_lancamentos"],"oficina":["producao_oficina"]};
export const S3B_ETAPA_OUTRA: string[] = ["criacao_desenvolvimento","criacao_planejamento","producao_terceirizados","producao_cq","producao_direcionamento","producao_lancamentos","producao_oficina"];
export const S3B_GATILHOS: { tabela: string; fn: string; depois: string; neutra: string; tgtype: number }[] = [
  { tabela: "cad", fn: "public.fn_seg_pagina_cad()", depois: "ebe2e35d3f617c3de27304294553c4ba", neutra: "a8576e43dacb0bb3d280f86eb22f5a15", tgtype: 19 },
  { tabela: "controle_qualidade", fn: "public.fn_seg_pagina_controle_qualidade()", depois: "95a0241d7ec2691c49e3a87a89ab2ed8", neutra: "21f12cc9d8e0175456233c1c32ec2ab2", tgtype: 19 },
  { tabela: "producao_oficina", fn: "public.fn_seg_pagina_producao_oficina()", depois: "f852373524c41e60c117148b6ffc87e0", neutra: "468a65bc549fcc0dd7106be99205cbb6", tgtype: 31 },
];
export const S3B_ACL: Record<string, { antes: [string, string | null]; depois: [string, string | null] }> = {
  cad: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", "observacoes_molde={authenticated=w/postgres} direcionamento_status={authenticated=w/postgres} direcionamento_confirmado_at={authenticated=w/postgres} sem_acabamento={authenticated=w/postgres}"] },
  controle_qualidade: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", "fotografado_variantes={authenticated=w/postgres}"] },
  producao_oficina: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  cq_variantes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  cq_pos_variantes: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  direcionamento_controle: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  lancamentos: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
  producao_terceirizados: { antes: ["{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}", null], depois: ["{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}", null] },
};
export const S3B_COLUNAS: Record<string, string[] | null> = {
  cad: ["direcionamento_status","direcionamento_confirmado_at","sem_acabamento","observacoes_molde"],
  controle_qualidade: ["fotografado_variantes"],
  producao_oficina: null,
  cq_variantes: [],
  cq_pos_variantes: [],
  direcionamento_controle: [],
  lancamentos: [],
  producao_terceirizados: [],
};
