// Tipos/helpers compartilhados entre a página do Planejamento
// (`criacao.planejamento.tsx`) e o detalhe do card (`PlanejamentoDetail.tsx`).
// Extraído (refactor 2026-08-25) do arquivo monolítico da rota — código MOVIDO
// sem mudança de comportamento. Nada aqui importa de `PlanejamentoDetail` nem da
// rota (evita ciclo de import).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type StatusTone } from "@/components/shared/StatusBadge";
import { type CustoSimInput } from "@/lib/preco";

export const BUCKET = "modelos";

export type Opt = { id: string; nome: string };
export type CatOpt = { id: string; nome: string; grupo_id: string | null };
export type ArtigoOpt = { id: string; nome: string; unidade_medida: string | null; preco_por_metro: number | null };
export type LinhaOpt = { id: string; nome: string; markup: number | null };
export type SubOpt = { id: string; nome: string; categoria_id: string | null };

// `color` = badge tonalizado (bg claro + texto escuro; passa WCAG AA, ao contrário do
// -500 + branco de antes ~2:1) p/ onde o status aparece como badge (ex.: diálogo/detalhe).
// `border` = faixa esquerda do card no Planejamento: o status vira a BORDA do card (não
// ocupa linha de texto). Cor-só p/ scan; o label vai no `title`/tooltip do card.
// `color` = badge tonalizado (usado no diálogo/detalhe; passa WCAG AA). `border` = faixa
// esquerda do card no Planejamento: o status vira a BORDA (não gasta linha); o label vai
// no `title`/tooltip do card (desktop). Cor da borda como sinal principal (decisão do dono).
export const STATUS_OPTS = [
  { value: "em_planejamento", label: "Em Planejamento", tone: "warning" as StatusTone, border: "border-l-amber-500" },
  { value: "reprovado", label: "Reprovado", tone: "danger" as StatusTone, border: "border-l-red-500" },
  { value: "planejado", label: "Planejado", tone: "success" as StatusTone, border: "border-l-emerald-500" },
];
export const statusMeta = (s: string | null) => STATUS_OPTS.find((o) => o.value === s) ?? STATUS_OPTS[0];

export const numOr0 = (v: any) => Number(v ?? 0) || 0;

export async function uploadFile(file: File, prefix: string) {
  const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

export function useOpts(table: string, key = "nome") {
  return useQuery({
    queryKey: ["opt", table, key],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, ${key}`).order(table === "meses" ? "ordem" : key);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, nome: r[key] })) as Opt[];
    },
  });
}

const _cache = new Map<string, { url: string; exp: number }>();
export function useSignedUrlBucket(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    const key = `${BUCKET}:${path}`;
    const cached = _cache.get(key);
    const now = Date.now();
    if (cached && cached.exp > now + 60_000) { setUrl(cached.url); return; }
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data }) => {
      if (!alive || !data?.signedUrl) return;
      _cache.set(key, { url: data.signedUrl, exp: now + 3600_000 });
      setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  return url;
}

export type Draft = {
  nome: string;
  estilista_id: string | null;
  linha_id: string | null;
  colecao: string;
  colecao_id: string | null;
  subcolecao: string;
  semana: string;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  origem: string;
  preco_venda: number | null;
  preco_atacado: number | null;
  data_lancamento: string | null;
  tecidos_planejados: string[];
  status_planejamento: string;
  croqui_url: string;
  desenho_tecnico_url: string;
  fotos_modelo: string[];
  fotos_referencia: string[];
  observacoes_gerais: string;
  observacoes_mao_obra: string;
  versao: number;
  modelo_base_id: string | null;
  custo_simulado: CustoSimInput;
};
export const emptyDraft = (): Draft => ({
  nome: "", estilista_id: null, linha_id: null, colecao: "", colecao_id: null, subcolecao: "", semana: "", mes_id: null, ano_id: null,
  categoria_principal_id: null,
  subcategoria1_id: null, subcategoria2_id: null, origem: "interno", preco_venda: null, preco_atacado: null, data_lancamento: null,
  tecidos_planejados: [],
  status_planejamento: "em_planejamento", croqui_url: "", desenho_tecnico_url: "", fotos_modelo: [], fotos_referencia: [],
  observacoes_gerais: "",
  observacoes_mao_obra: "",
  versao: 1, modelo_base_id: null,
  custo_simulado: {},
});

// Colab (spec 2026-08-03, Task 2 — adoção Plan. Produto). Extraída como função PURA (era
// montada inline dentro do queryFn, com side-effects de setState no meio — o queryFn roda em
// TODO refetch, não só na 1ª carga, então cada refetch em background sobrescrevia o rascunho
// do usuário às cegas: o mesmo bug de fundo que o piloto OC Tecido corrigiu). Serve tanto a
// semeadura (1ª carga) quanto o "fresh" do merge 3-vias (refetch/Realtime/retry P0409).
export function draftFromModeloRow(data: any): Draft {
  return {
    nome: data.nome ?? "",
    estilista_id: data.estilista_id,
    linha_id: data.linha_id ?? null,
    colecao: data.colecao ?? "",
    colecao_id: data.colecao_id ?? null,
    subcolecao: data.subcolecao ?? "",
    semana: data.semana ?? "",
    mes_id: data.mes_id,
    ano_id: data.ano_id,
    categoria_principal_id: data.categoria_principal_id,
    subcategoria1_id: data.subcategoria1_id ?? null,
    subcategoria2_id: data.subcategoria2_id ?? null,
    origem: data.origem ?? "interno",
    preco_venda: data.preco_venda ?? null,
    preco_atacado: data.preco_atacado ?? null,
    data_lancamento: data.data_lancamento ?? null,
    tecidos_planejados: data.tecidos_planejados ?? [],
    status_planejamento: data.status_planejamento ?? "em_planejamento",
    croqui_url: data.croqui_url ?? "",
    desenho_tecnico_url: data.desenho_tecnico_url ?? "",
    fotos_modelo: data.fotos_modelo ?? [],
    fotos_referencia: data.fotos_referencia ?? [],
    observacoes_gerais: data.observacoes_gerais ?? "",
    observacoes_mao_obra: data.observacoes_mao_obra ?? "",
    versao: data.versao ?? 1,
    modelo_base_id: data.modelo_base_id ?? null,
    custo_simulado: (data.custo_simulado ?? {}) as CustoSimInput,
  };
}
