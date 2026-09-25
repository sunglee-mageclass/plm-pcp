import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ChevronUp, ChevronDown, Save, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import {
  canonico, ladosDaGrade, mesclarSiglasTamanho, normalizarSigla, normalizarTamanhosSku, TAMANHO_UNICO,
} from "@/lib/sku-montar";

const DEFAULT_GRADE = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];

/**
 * Grade de tamanhos da loja (tenant_config.tamanhos_grade). Antes ficava na Config da Loja;
 * agora é cadastrada aqui (Cadastro > Atributos). Formato "Número|Sigla" (ex.: 38|P); a ordem
 * define as colunas das grades no desenvolvimento/CAD/CQ.
 * F3.5a: abaixo da lista, as SIGLAS NO SKU de cada lado dos pares (tenant_config.tamanhos_sku) — bloco próprio,
 * com o seu "Salvar siglas" (a grade continua gravando na hora, como antes).
 */
export function GradeTamanhosCard({ readOnly }: { readOnly?: boolean } = {}) {
  const qc = useQueryClient();
  const tenantId = useActiveTenantId();
  const [draft, setDraft] = useState("");

  const gradeKey = ["tenant-config-grade", tenantId];
  const { data: items = [] } = useQuery({
    queryKey: gradeKey,
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from("tenant_config")
        .select("tamanhos_grade")
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      const g = (data as any)?.tamanhos_grade;
      return Array.isArray(g) ? (g as string[]) : DEFAULT_GRADE;
    },
  });

  const save = useMutation({
    mutationFn: async (next: string[]) => {
      const { error } = await supabase
        .from("tenant_config")
        .upsert({ tenant_id: tenantId, tamanhos_grade: next } as any, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onMutate: (next) => qc.setQueryData(gradeKey, next), // otimista
    onError: (e: any) => {
      toast.error(mensagemErro(e, "Erro ao salvar a grade."));
      qc.invalidateQueries({ queryKey: gradeKey });
    },
    // A grade é lida em várias telas sob prefixos diferentes (tenant_config, ...-grade).
    onSuccess: () => qc.invalidateQueries(),
  });

  const commit = (next: string[]) => save.mutate(next);
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) return toast.error("Tamanho já existe.");
    commit([...items, v]);
    setDraft("");
  };
  const remove = (i: number) => commit(items.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Formato <b>Número|Sigla</b> (ex.: <code>38|P</code>). A <b>ordem</b> define as colunas das grades.
        </p>
        {/* readOnly (sem permissão de editar Grade): esconde adicionar/reordenar/remover. */}
        {!readOnly && (
          <div className="flex gap-2">
            <Input
              placeholder="Ex: 38|P"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            />
            <Button type="button" variant="secondary" onClick={add}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </div>
        )}
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={`${i}::${it}`} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
              <span className="flex-1 text-sm">{it}</span>
              {!readOnly && (<>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Descer">
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(i)} aria-label="Remover">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>)}
            </li>
          ))}
          {items.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nenhum tamanho.</li>}
        </ul>
      </div>

      <SiglasTamanhoBloco itens={items} readOnly={readOnly} />
    </div>
  );
}

/**
 * Siglas no SKU de CADA LADO dos pares da grade (spec SKU §4.1/§4.3): "34|PPP" → número 34 → sigla, letra PPP →
 * sigla. Item solto é um lado só (classificado: só dígitos = número). O mapa é por TEXTO do lado — dois pares com o
 * mesmo lado dividem a sigla. Grava SÓ `tamanhos_sku` (update da coluna, nunca a linha inteira — lição RP3 da F2),
 * aplicando sobre o valor ATUAL do banco apenas os lados que VOCÊ mudou. O servidor normaliza (sem acento/espaço, só
 * A–Z/0–9, maiúsculas — D6).
 */
function SiglasTamanhoBloco({ itens, readOnly }: { itens: string[]; readOnly?: boolean }) {
  const qc = useQueryClient();
  const tenantId = useActiveTenantId();
  const chave = ["tenant-config-tamanhos-sku", tenantId];
  const { data: servidor = null, isSuccess } = useQuery({
    queryKey: chave,
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      const r = normalizarTamanhosSku((data as any)?.tamanhos_sku ?? null);
      return r.ok ? r.valor : null;
    },
  });

  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [base, setBase] = useState<Record<string, string> | null>(null);
  const normRascunho = normalizarTamanhosSku(rascunho);
  const dirty = isSuccess && canonico(normRascunho.ok ? normRascunho.valor : rascunho) !== canonico(base);
  const { confirm } = useUnsavedGuard({ dirty, blockNav: true });

  // Semeia do servidor só SEM edição pendente (um refetch/realtime não apaga o que você digitou).
  const servidorCanon = canonico(servidor);
  useEffect(() => {
    if (!isSuccess || dirty) return;
    setRascunho({ ...(servidor ?? {}) });
    setBase(servidor);
  }, [servidorCanon, isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const linhas = ladosDaGrade(itens);
  const lados = [...new Set(linhas.flatMap((l) => [l.numero, l.letra]).filter((x): x is string => !!x))];
  const semSigla = lados.filter((l) => !normalizarSigla(rascunho[l]));

  const salvar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      const fresco = normalizarTamanhosSku((data as any)?.tamanhos_sku ?? null);
      const proximo = normalizarTamanhosSku(mesclarSiglasTamanho(fresco.ok ? fresco.valor : null, base, rascunho));
      if (!proximo.ok) throw new Error(proximo.erro);
      const { data: gravou, error: e2 } = await supabase
        .from("tenant_config")
        .update({ tamanhos_sku: proximo.valor } as any)
        .eq("tenant_id", tenantId)
        .select("tenant_id");
      if (e2) throw e2;
      if (!gravou?.length) throw new Error("Sem permissão para salvar as siglas de tamanho (só o admin da loja).");
      return proximo.valor;
    },
    onSuccess: (valor) => {
      setRascunho({ ...(valor ?? {}) });
      setBase(valor);
      qc.setQueryData(chave, valor);
      toast.success("Siglas de tamanho salvas.");
    },
    onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao salvar as siglas de tamanho.")),
  });

  const campo = (rotulo: string, lado: string) => (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">{rotulo} {lado} →</span>
      <Input
        value={rascunho[lado] ?? ""}
        onChange={(e) => setRascunho((r) => ({ ...r, [lado]: e.target.value }))}
        placeholder="—"
        maxLength={10}
        disabled={readOnly}
        aria-label={`Sigla SKU do tamanho ${lado}`}
        className="h-8 w-20 uppercase max-md:h-11"
      />
    </label>
  );

  return (
    <div className="space-y-3 border-t pt-4" data-secao="siglas-tamanho">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Siglas no SKU</p>
        <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
      </div>
      <p className="text-xs text-muted-foreground">
        Cada lado do tamanho tem a sua sigla (ex.: <code>34 → 34 · PPP → PPP</code>). O SKU usa o lado escolhido em
        "Tamanho em" (Letra ou Número). Tamanho sem sigla não gera SKU. A grade única "{TAMANHO_UNICO}" dos acessórios
        sem sigla sai sem o tamanho.
      </p>
      <ul className="space-y-2">
        {linhas.map((l, i) => {
          const previa = [l.numero, l.letra]
            .filter((x): x is string => !!x)
            .map((lado) => `${lado} → ${normalizarSigla(rascunho[lado]) ?? "—"}`)
            .join(" · ");
          return (
            <li key={`${i}::${l.item}`} className="rounded-md border bg-card px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="w-20 shrink-0 text-sm font-medium">{l.item}</span>
                {l.numero && campo("Número", l.numero)}
                {l.letra && campo("Letra", l.letra)}
                <span className="ml-auto font-mono text-xs text-muted-foreground">{previa}</span>
              </div>
            </li>
          );
        })}
        {linhas.length === 0 && <li className="py-2 text-sm text-muted-foreground">Cadastre a grade acima primeiro.</li>}
      </ul>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={semSigla.length === 0}
            onClick={() => setRascunho((r) => {
              const n = { ...r };
              for (const lado of semSigla) n[lado] = lado;
              return n;
            })}
          >
            <Wand2 className="h-4 w-4 mr-1" /> Preencher vazias com o próprio tamanho
          </Button>
          <Button type="button" className="ml-auto" disabled={!dirty || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar siglas
          </Button>
        </div>
      )}
      <UnsavedChangesGuard confirm={confirm} message="As siglas de tamanho têm alterações não salvas." />
    </div>
  );
}
