// F3.2 — dados do BOM que o Sheet do Planejamento precisa. queryKeys PRÓPRIAS ("plan-ficha-*"; CLAUDE.md:
// "queryKey única por tela" — key compartilhada já causou bug), selects IGUAIS aos do Desenvolvimento
// (ModeloDetailPanel.tsx:262-514), que fica intocado. A de tenant_config contém "tenant" no nome para o
// predicate da Config da Loja/Realtime (`matchTenantConfig`) invalidá-la.
import { useMemo, useRef } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { lerRevendaConfig } from "@/lib/revenda-config";
import type { EtiquetaInfo, Opt } from "@/components/desenvolvimento/modelo-detail/types";
import type { AviamentoVarOpt } from "@/components/desenvolvimento/modelo-detail/ModeloAviamentosSection";
import type { AviamentoRowDb, EtiquetaRowDb, GradeRowDb, OcLinkRowDb, TecidoRowDb, VarianteRowDb } from "./ficha-calc";
import type { CadRowDb } from "./ficha-cad";

export type ArtigoFicha = {
  id: string; nome: string; preco: number | null; preco_por_metro: number | null; unidade_medida: string | null;
  categoria_tecido_id: string | null; largura_estimada: number | null;
  empresa?: { nome_fantasia: string | null; razao_social: string | null } | null;
};
export type AviamentoFicha = { id: string; codigo_nome: string; preco: number | null; variantes?: AviamentoVarOpt[] };

// Defaults ESTÁVEIS (mesma identidade entre renders) — evita efeitos rodando à toa (Dev :751-758).
const SEM_ARTIGOS: ArtigoFicha[] = [];
const SEM_CATEGORIAS: Opt[] = [];
const SEM_LINKS_CAT: { artigo_id: string; categoria_tecido_id: string }[] = [];
const SEM_AVIAMENTOS: AviamentoFicha[] = [];
const SEM_ETIQUETAS: EtiquetaInfo[] = [];
const SEM_PRECOS: Record<string, number> = {};
const SEM_CONDICOES: Record<string, boolean> = {};
const TAMANHOS_PADRAO = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];

/** F3.3 — `cad` + `cad_tecidos` (com o artigo) + `cad_tecido_variantes` (com os rótulos): os MESMOS campos do Dev
 *  (ModeloDetailPanel.tsx:520, :531), numa query só. Sem espaços (o supabase-js os tira da URL — o QA casa por isto). */
const SELECT_CAD_FICHA =
  "id,cad_tecidos(id,numero,tipo,artigo_id,consumo_cad,loss_percent_cad,custo_cad,tamanho_folha," +
  "artigos:artigo_id(nome,preco_por_metro,unidade_medida,etiqueta_lavagem_urls,largura_estimada)," +
  "cad_tecido_variantes(id,variante_tecido_id,ordem,multiplicador,quantidade_folhas,metragem_planejada,metragem_enviada,complementa_variante_ids," +
  "variantes_tecido:variante_tecido_id(nome_variante,codigo_variante,cor:cor_id(nome),apelido:cor_apelido_id(nome))))";

/** As 5 keys EXATAS do BOM do servidor (T5 m1) — fonte única p/ `bomMudouNoServidor`/`chavesFichaBom`. */
export function chavesBomServidor(modeloId: string | null): QueryKey[] {
  return [
    ["plan-ficha-tecidos", modeloId],
    ["plan-ficha-oc-links", modeloId],
    ["plan-ficha-aviamentos", modeloId],
    ["plan-ficha-etiquetas", modeloId],
    ["plan-ficha-grades", modeloId],
  ];
}

/** Chaves do BOM deste modelo — invalidadas no pós-save e quando outra pessoa salva. */
export function chavesFichaBom(modeloId: string | null): QueryKey[] {
  return [
    ...chavesBomServidor(modeloId),
    ["plan-ficha-precos-congelado", modeloId],
    ["plan-ficha-condicoes", modeloId],
    ["plan-ficha-cad", modeloId],
  ];
}

export function useFichaDados({ modeloId, habilitada }: { modeloId: string | null; habilitada: boolean }) {
  const tenantId = useActiveTenantId();
  const on = habilitada && !!modeloId;

  // ── Catálogos (Dev :336-422) ──
  const qArtigos = useQuery({
    queryKey: ["plan-ficha-artigos"],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("id, nome, preco, preco_por_metro, unidade_medida, categoria_tecido_id, largura_estimada, empresa:empresa_id(nome_fantasia, razao_social)")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as ArtigoFicha[];
    },
  });
  const qCatTecido = useQuery({
    queryKey: ["plan-ficha-cat-tecido"],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.from("categorias_tecido").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as Opt[];
    },
  });
  const qArtigoCats = useQuery({
    queryKey: ["plan-ficha-artigo-cats"],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.from("artigo_categorias_tecido").select("artigo_id, categoria_tecido_id");
      if (error) throw error;
      return (data ?? []) as { artigo_id: string; categoria_tecido_id: string }[];
    },
  });
  const qAviamentos = useQuery({
    queryKey: ["plan-ficha-aviamentos-cat"],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aviamentos" as any)
        .select("id, codigo_nome, preco, variantes:variantes_aviamento(id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome))")
        .order("codigo_nome");
      if (error) throw error;
      return (data ?? []) as unknown as AviamentoFicha[];
    },
  });
  const qEtiquetas = useQuery({
    queryKey: ["plan-ficha-etiquetas-cat"],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("etiquetas" as any)
        .select("id, nome, formato_tamanho, preco, variantes_etiqueta(cor_id, preco, cor:cor_id(nome))")
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as any[]).map((e) => ({
        id: e.id, nome: e.nome, formato_tamanho: e.formato_tamanho ?? "ambos", preco: e.preco,
        variantes: (e.variantes_etiqueta ?? []).map((v: any) => ({ cor_id: v.cor_id, cor_nome: v.cor?.nome ?? null, preco: v.preco })),
      })) as EtiquetaInfo[];
    },
  });
  const qTenant = useQuery({
    queryKey: ["plan-ficha-tenant-config", tenantId],
    enabled: on && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("tamanhos_grade, status_kanban, kanban_requisitos, revenda_campos, revenda_kanban_colunas, revenda_kanban_requisitos")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // ── BOM do modelo (Dev :433-514) ──
  // `bomFetching` (I2, fix round 1): as 5 queries do BOM resolvem em commits separados; a carga da
  // Ficha (`useFichaBom`) espera TODAS ficarem estáveis (nenhuma em refetch) antes de hidratar ou
  // comparar — mesma receita do gate do CAD no Dev (`ModeloDetailPanel.tsx:1047-1054`,
  // `cadRowDevFetching || tecidosDataFetching`). Sem isso, um refetch parcial re-hidrata coleções com
  // o cache velho das outras (sem toque) ou compara um BOM MISTO (com toque, `aoRecarregarComTocado`).
  const qTecidos = useQuery({
    queryKey: ["plan-ficha-tecidos", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data: tecidos, error } = await supabase
        .from("modelo_tecidos")
        .select("id, modelo_id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto")
        .eq("modelo_id", modeloId as string);
      if (error) throw error;
      const ids = (tecidos ?? []).map((t: any) => t.id);
      let variantes: any[] = [];
      if (ids.length > 0) {
        const { data: vs, error: e2 } = await supabase
          .from("modelo_tecido_variantes")
          .select("modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids, variantes_tecido:variante_tecido_id(artigo_id)")
          .in("modelo_tecido_id", ids);
        if (e2) throw e2;
        variantes = vs ?? [];
      }
      return { tecidos: (tecidos ?? []) as unknown as TecidoRowDb[], variantes: variantes as VarianteRowDb[] };
    },
  });
  const qOcLinks = useQuery({
    queryKey: ["plan-ficha-oc-links", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecido_oc_links" as any)
        .select("tipo, numero, ordem, oc_tecido_item_id, quantidade_m, prioridade")
        .eq("modelo_id", modeloId as string);
      if (error) throw error;
      return (data ?? []) as unknown as OcLinkRowDb[];
    },
  });
  // Preço congelado pela OC vinculada (Dev :467-477): "tipo|numero" → preço/m.
  const qFrozen = useQuery({
    queryKey: ["plan-ficha-precos-congelado", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("precos_tecido_congelado" as any, { _modelo_id: modeloId });
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
  });
  const qAviamentosModelo = useQuery({
    queryKey: ["plan-ficha-aviamentos", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_aviamentos" as any)
        .select("id, aviamento_id, variante_aviamento_id, numero, consumo, loss_percent, custo_previsto")
        .eq("modelo_id", modeloId as string)
        .order("numero");
      if (error) throw error;
      return (data ?? []) as unknown as AviamentoRowDb[];
    },
  });
  const qEtiquetasModelo = useQuery({
    queryKey: ["plan-ficha-etiquetas", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_etiquetas" as any)
        .select("id, etiqueta_id, cor_id, consumo, loss_percent, custo_previsto")
        .eq("modelo_id", modeloId as string)
        .order("numero");
      if (error) throw error;
      return (data ?? []) as unknown as EtiquetaRowDb[];
    },
  });
  const qGrades = useQuery({
    queryKey: ["plan-ficha-grades", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_grades")
        .select("variante_numero, grades, grade_total")
        .eq("modelo_id", modeloId as string)
        .order("variante_numero");
      if (error) throw error;
      return (data ?? []) as unknown as GradeRowDb[];
    },
  });
  // Condições do kanban no estado SALVO (selos por requisito — Dev :283-291).
  const qCondicoes = useQuery({
    queryKey: ["plan-ficha-condicoes", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("avaliar_condicoes_kanban" as any, { _ids: [modeloId] });
      if (error) throw error;
      return (((data ?? {}) as any)[modeloId as string] ?? {}) as Record<string, boolean>;
    },
  });
  // I2 — em refetch (foco/invalidação) TODAS as 5 precisam assentar antes da carga mexer no estado.
  // T5 m1 — NÃO derivável de `chavesBomServidor` sem mudar a ordem dos hooks: cada `.isFetching` vem do
  // objeto de retorno de um `useQuery` individual (qTecidos/qOcLinks/…), não das keys (que são só arrays
  // de identidade); trocar para `useQueries([...chavesBomServidor(...)])` mudaria a estrutura dos hooks
  // acima. Documentado conforme o brief (T5 m1) — deixado como está.
  // F3.3 — o CAD do modelo EMBUTIDO numa query só (Dev :516-534 — `dev-cad-row` + `dev-cad-tecidos`): alimenta a seção
  // CAD (useFichaCad) e segue decidindo o "carregando"/erro (cadFetched/cadErro). Key PRÓPRIA, já em `chavesFichaBom`.
  const qCad = useQuery({
    queryKey: ["plan-ficha-cad", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("cad").select(SELECT_CAD_FICHA).eq("modelo_id", modeloId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as CadRowDb | null;
    },
  });
  // I2 (F3.2) + F3.3 — a carga só mexe no estado com as 6 queries ESTÁVEIS: as 5 do BOM e a do CAD.
  const bomFetching = qTecidos.isFetching || qOcLinks.isFetching || qAviamentosModelo.isFetching
    || qEtiquetasModelo.isFetching || qGrades.isFetching || qCad.isFetching;

  // ── Derivados (Dev :347-422, :328-334) ──
  const artigos = qArtigos.data ?? SEM_ARTIGOS;
  const categoriasTecido = qCatTecido.data ?? SEM_CATEGORIAS;
  const artigoCatLinks = qArtigoCats.data ?? SEM_LINKS_CAT;
  const artigoMap = useMemo(() => Object.fromEntries(artigos.map((a) => [a.id, a])) as Record<string, ArtigoFicha>, [artigos]);
  const catsByArtigo = useMemo(() => {
    const m = new Map<string, Set<string>>();
    artigoCatLinks.forEach((l) => {
      const s = m.get(l.artigo_id) ?? new Set<string>();
      s.add(l.categoria_tecido_id);
      m.set(l.artigo_id, s);
    });
    return m;
  }, [artigoCatLinks]);
  const artigosPorCategoriaNome = (nome: string) => {
    const cat = categoriasTecido.find((c) => c.nome.trim().toLowerCase() === nome.toLowerCase());
    if (!cat) return SEM_ARTIGOS;
    return artigos.filter((a) => catsByArtigo.get(a.id)?.has(cat.id) || artigoMap[a.id]?.categoria_tecido_id === cat.id);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const artigosForro = useMemo(() => artigosPorCategoriaNome("Forro"), [artigos, categoriasTecido, catsByArtigo]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const artigosEntretela = useMemo(() => artigosPorCategoriaNome("Entretela"), [artigos, categoriasTecido, catsByArtigo]);
  const aviamentos = qAviamentos.data ?? SEM_AVIAMENTOS;
  const aviamentoMap = useMemo(() => Object.fromEntries(aviamentos.map((a) => [a.id, a])) as Record<string, AviamentoFicha>, [aviamentos]);
  const etiquetasList = qEtiquetas.data ?? SEM_ETIQUETAS;
  const etiquetaMap = useMemo(() => Object.fromEntries(etiquetasList.map((e) => [e.id, e])) as Record<string, EtiquetaInfo>, [etiquetasList]);
  const etiquetaOpts = useMemo<Opt[]>(() => etiquetasList.map((e) => ({ id: e.id, nome: e.nome })), [etiquetasList]);
  const tenantCfg = qTenant.data ?? null;
  const tamanhos: string[] = useMemo(() => {
    const raw = (tenantCfg as any)?.tamanhos_grade;
    if (Array.isArray(raw) && raw.length > 0) return raw.map((x: any) => (typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x))));
    return TAMANHOS_PADRAO;
  }, [tenantCfg]);
  const revendaCfg = useMemo(() => lerRevendaConfig(tenantCfg), [tenantCfg]);
  // Espelho síncrono dos ids de etiqueta do SERVIDOR (lido dentro do mutationFn do Salvar).
  const etiquetasDataRef = useRef(qEtiquetasModelo.data);
  etiquetasDataRef.current = qEtiquetasModelo.data;

  return {
    artigos, artigoMap, artigosForro, artigosEntretela,
    aviamentos, aviamentoMap, etiquetaOpts, etiquetaMap,
    tamanhos, tenantCfg, revendaCfg,
    tecidosData: qTecidos.data,
    ocLinksData: qOcLinks.data,
    frozenPrecos: qFrozen.data ?? SEM_PRECOS,
    aviamentosData: qAviamentosModelo.data,
    etiquetasData: qEtiquetasModelo.data,
    etiquetasDataRef,
    gradesData: qGrades.data,
    bomFetching,
    condicoes: qCondicoes.data ?? SEM_CONDICOES,
    cadExiste: !!qCad.data?.id,
    cadFetched: qCad.isSuccess,
    /** T9 m3 — a trava "carregando" não pode ficar muda pra sempre se a query de CAD der erro. */
    cadErro: qCad.isError,
    /** F3.3 — o CAD cru (undefined = ainda não chegou; null = o modelo não tem CAD). */
    cadData: qCad.data,
    /** F3.3 — condições do kanban carregadas (selos: sem isto só o informativo — nunca "falta" no escuro). */
    condicoesProntas: qCondicoes.isSuccess,
    catalogosProntos: qArtigos.isSuccess && qCatTecido.isSuccess && qArtigoCats.isSuccess && qAviamentos.isSuccess
      && qEtiquetas.isSuccess && qFrozen.isSuccess && qTenant.isSuccess,
  };
}

export type FichaDados = ReturnType<typeof useFichaDados>;
