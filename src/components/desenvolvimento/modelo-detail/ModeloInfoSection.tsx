import { useState, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldSelectOpt } from "./shared";
import { STATUS_DESENV_OPTS, type Opt } from "./types";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";

type StatusOpt = { value: string; label: string };
type SubOpt = { id: string; nome: string; categoria_id: string | null };

type Draft = Record<string, any>;

export function ModeloInfoSection({
  draft,
  setDraft,
  linhas,
  estilistas,
  modelistas,
  piloteiros,
  categorias,
  grupos,
  meses,
  anos,
  sub1Opts,
  sub2Opts,
  isAprovado,
  isReprovado,
  statusOptions,
  podeEntrarStatus,
  otbOn,
  colecoes,
  subcolecoes,
  camposCopiados = new Set(),
  onCampoEditado,
  colab,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  linhas: Opt[];
  estilistas: Opt[];
  modelistas: Opt[];
  piloteiros: Opt[];
  categorias: { id: string; nome: string; grupo_id: string | null }[];
  grupos: Opt[];
  meses: Opt[];
  anos: Opt[];
  sub1Opts: SubOpt[];
  sub2Opts: SubOpt[];
  isAprovado: boolean;
  isReprovado: boolean;
  statusOptions?: StatusOpt[];
  podeEntrarStatus?: (statusKey: string) => { ok: boolean; faltando: { label: string }[] };
  otbOn?: boolean;
  colecoes?: { id: string; nome: string; mes_id: string | null; ano_id: string | null }[];
  subcolecoes?: string[];
  camposCopiados?: Set<string>;
  onCampoEditado?: (k: string) => void;
  // Colab (spec 2026-08-03, Task 1): presença por campo — SÓ nome/datas nesta 1ª adoção
  // (escopo pragmático do brief). Conflito é resolvido no ColabBanner (genérico), não aqui.
  colab?: { focadoPor: (path: string) => string | undefined };
}) {
  const fl = useFieldLabels();
  // Ring sky = colega focado no campo agora (presença); sem UI de conflito inline aqui —
  // o ColabBanner (resolução genérica) já cobre qualquer conflito nestes campos.
  const colabField = (path: string) => {
    const nome = colab?.focadoPor(path);
    return {
      "data-colab-path": path,
      title: nome ? `${nome} está neste campo` : undefined,
      className: nome ? "ring-1 ring-sky-400" : undefined,
    };
  };
  // Grupo é um FILTRO da Categoria (não é salvo no modelo) — deriva da categoria atual.
  const [grupoId, setGrupoId] = useState<string | null>(null);
  useEffect(() => {
    if (!draft.categoria_principal_id) return;
    const cat = categorias.find((c) => c.id === draft.categoria_principal_id);
    if (cat?.grupo_id) setGrupoId(cat.grupo_id);
  }, [draft.categoria_principal_id, categorias]);
  const [visiblePilotos, setVisiblePilotos] = useState<Set<number>>(() => {
    const has2 = !!(draft.piloteiro2_id || draft.data_piloto2);
    const has3 = !!(draft.piloteiro3_id || draft.data_piloto3);
    const s = new Set<number>([1]);
    if (has2 || has3) s.add(2);
    if (has3) s.add(3);
    return s;
  });

  const addPiloto = (n: 2 | 3) => {
    setVisiblePilotos((prev) => new Set(prev).add(n));
  };

  const removePiloto = (n: 2 | 3) => {
    const clear: Draft = { [`piloteiro${n}_id`]: null, [`data_piloto${n}`]: "" };
    if (n === 2) {
      clear.piloteiro3_id = null;
      clear.data_piloto3 = "";
    }
    setDraft({ ...draft, ...clear });
    setVisiblePilotos((prev) => {
      const next = new Set(prev);
      next.delete(n);
      if (n === 2) next.delete(3);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Nome">
          <Input
            value={draft.nome}
            onChange={(e) => setDraft({ ...draft, nome: e.target.value })}
            data-colab-path={colabField("nome")["data-colab-path"]}
            title={colabField("nome").title}
            className={colabField("nome").className}
          />
        </Field>
        {/* Status foi promovido a uma barra persistente ACIMA do accordion (ModeloDetailPanel). */}
        {isAprovado && (
          <Field label={fl("ref")}>
            <Input value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} />
          </Field>
        )}
        {isReprovado && (
          <Field label="Motivo do Cancelamento" full>
            <Textarea rows={2} value={draft.motivo_cancelamento} onChange={(e) => setDraft({ ...draft, motivo_cancelamento: e.target.value })} />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldSelectOpt label={fl("estilista")} value={draft.estilista_id} onChange={(v) => setDraft({ ...draft, estilista_id: v })} options={estilistas} />
        <FieldSelectOpt label={fl("modelista")} value={draft.modelista_id} onChange={(v) => setDraft({ ...draft, modelista_id: v })} options={modelistas} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Grupo FILTRA a Categoria (não é salvo). Categoria vem do Planejamento, editável aqui. */}
        <FieldSelectOpt
          label="Grupo"
          value={grupoId}
          onChange={(v) => {
            setGrupoId(v);
            const cat = categorias.find((c) => c.id === draft.categoria_principal_id);
            // Se a categoria atual não pertence ao novo grupo, limpa categoria + subcategorias.
            if (cat && cat.grupo_id !== v) setDraft({ ...draft, categoria_principal_id: null, subcategoria1_id: null, subcategoria2_id: null });
          }}
          options={grupos}
        />
        <FieldSelectOpt
          label="Categoria"
          value={draft.categoria_principal_id}
          onChange={(v) =>
            // Trocar a categoria invalida as subcategorias (que pertencem a ela).
            setDraft({ ...draft, categoria_principal_id: v, subcategoria1_id: null, subcategoria2_id: null })
          }
          options={grupoId ? categorias.filter((c) => c.grupo_id === grupoId) : categorias}
        />
        <FieldSelectOpt
          label="Subcategoria 1"
          value={draft.subcategoria1_id}
          onChange={(v) => setDraft({ ...draft, subcategoria1_id: v })}
          options={sub1Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
        />
        <FieldSelectOpt
          label="Subcategoria 2"
          value={draft.subcategoria2_id}
          onChange={(v) => setDraft({ ...draft, subcategoria2_id: v })}
          options={sub2Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FieldSelectOpt label="Lançamento" value={draft.semana || null} onChange={(v) => setDraft({ ...draft, semana: v })} options={["1", "2", "3", "4", "5"].map((s) => ({ id: s, nome: s }))} />
        <FieldSelectOpt label="Mês" value={draft.mes_id || null} onChange={(v) => setDraft({ ...draft, mes_id: v })} options={meses} />
        <FieldSelectOpt label="Ano" value={draft.ano_id || null} onChange={(v) => setDraft({ ...draft, ano_id: v })} options={anos} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {otbOn && (
          <FieldSelectOpt
            label="Coleção"
            value={draft.colecao_id}
            onChange={(v) => {
              const col = (colecoes ?? []).find((c) => c.id === v);
              setDraft({ ...draft, colecao_id: v, colecao: col?.nome ?? draft.colecao,
                mes_id: draft.mes_id ?? col?.mes_id ?? null, ano_id: draft.ano_id ?? col?.ano_id ?? null });
            }}
            options={(colecoes ?? []).map((c) => ({ id: c.id, nome: c.nome }))}
          />
        )}
        {otbOn ? (
          <FieldSelectOpt
            label="Subcoleção"
            value={draft.subcolecao || null}
            onChange={(v) => setDraft({ ...draft, subcolecao: v })}
            options={Array.from(new Set([...(subcolecoes ?? []), ...(draft.subcolecao ? [draft.subcolecao] : [])])).map((s) => ({ id: s, nome: s }))}
          />
        ) : (
          <Field label="Subcoleção">
            <Input value={draft.subcolecao ?? ""} onChange={(e) => setDraft({ ...draft, subcolecao: e.target.value })} />
          </Field>
        )}
        <FieldSelectOpt label={fl("linha")} value={draft.linha_id} onChange={(v) => setDraft({ ...draft, linha_id: v })} options={linhas} />
      </div>
      {/* Cronograma & pilotos — cluster agrupado (mockup) p/ separar de identidade/classificação. */}
      <div className="rounded-md border border-dashed p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Cronograma &amp; pilotos</div>
        <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3">
          <FieldSelectOpt label={`${fl("piloteiro")} 1`} value={draft.piloteiro1_id} onChange={(v) => setDraft({ ...draft, piloteiro1_id: v })} options={piloteiros} />
          <Field label="Data Piloto 1">
            <DateField
              value={draft.data_piloto1 ?? ""}
              onChange={(e) => setDraft({ ...draft, data_piloto1: e.target.value })}
              data-colab-path={colabField("data_piloto1")["data-colab-path"]}
              title={colabField("data_piloto1").title}
              inputClassName={colabField("data_piloto1").className}
            />
          </Field>
        </div>
        {visiblePilotos.has(2) && (
          <>
            <div className="sm:col-span-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Piloto 2</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => removePiloto(2)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3">
              <FieldSelectOpt label={`${fl("piloteiro")} 2`} value={draft.piloteiro2_id} onChange={(v) => setDraft({ ...draft, piloteiro2_id: v })} options={piloteiros} />
              <Field label="Data Piloto 2">
                <DateField
                  value={draft.data_piloto2 ?? ""}
                  onChange={(e) => setDraft({ ...draft, data_piloto2: e.target.value })}
                  data-colab-path={colabField("data_piloto2")["data-colab-path"]}
                  title={colabField("data_piloto2").title}
                  inputClassName={colabField("data_piloto2").className}
                />
              </Field>
            </div>
          </>
        )}
        {visiblePilotos.has(3) && (
          <>
            <div className="sm:col-span-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Piloto 3</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => removePiloto(3)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3">
              <FieldSelectOpt label={`${fl("piloteiro")} 3`} value={draft.piloteiro3_id} onChange={(v) => setDraft({ ...draft, piloteiro3_id: v })} options={piloteiros} />
              <Field label="Data Piloto 3">
                <DateField
                  value={draft.data_piloto3 ?? ""}
                  onChange={(e) => setDraft({ ...draft, data_piloto3: e.target.value })}
                  data-colab-path={colabField("data_piloto3")["data-colab-path"]}
                  title={colabField("data_piloto3").title}
                  inputClassName={colabField("data_piloto3").className}
                />
              </Field>
            </div>
          </>
        )}
        {(!visiblePilotos.has(2) || !visiblePilotos.has(3)) && (
          <div className="sm:col-span-2 flex gap-2">
            {!visiblePilotos.has(2) && (
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => addPiloto(2)}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar Piloto 2
              </Button>
            )}
            {visiblePilotos.has(2) && !visiblePilotos.has(3) && (
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => addPiloto(3)}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar Piloto 3
              </Button>
            )}
          </div>
        )}
        <Field label="Data Desenho Técnico">
          <DateField
            value={draft.data_desenho_tecnico ?? ""}
            onChange={(e) => setDraft({ ...draft, data_desenho_tecnico: e.target.value })}
            data-colab-path={colabField("data_desenho_tecnico")["data-colab-path"]}
            title={colabField("data_desenho_tecnico").title}
            inputClassName={colabField("data_desenho_tecnico").className}
          />
        </Field>
        <Field label="Data Aprovação">
          <DateField
            value={draft.data_aprovacao ?? ""}
            onChange={(e) => setDraft({ ...draft, data_aprovacao: e.target.value })}
            data-colab-path={colabField("data_aprovacao")["data-colab-path"]}
            title={colabField("data_aprovacao").title}
            inputClassName={colabField("data_aprovacao").className}
          />
        </Field>
        </div>
      </div>
      <Field label="Observações Técnicas" full>
        <Textarea
          rows={3}
          className={classeCopiado(camposCopiados, "obs_tecnicas")}
          value={draft.observacoes_tecnicas}
          onChange={(e) => { setDraft({ ...draft, observacoes_tecnicas: e.target.value }); onCampoEditado?.("obs_tecnicas"); }}
        />
      </Field>
    </div>
  );
}
