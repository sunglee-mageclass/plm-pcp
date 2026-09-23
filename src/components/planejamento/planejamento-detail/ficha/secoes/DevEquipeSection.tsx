// Seção "Desenvolvimento — equipe e cronograma" do Sheet unificado do Planejamento (F3.1). CÓPIA ADAPTADA do
// cluster "Desenvolvimento" + "Cronograma & pilotos" + "Observações Técnicas" do `ModeloInfoSection` do Dev
// (src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx:214-365), que fica INTOCADO (decisão 8).
// Diferenças deliberadas:
//  • estilo de campo do Planejamento (FieldSelect/Label; "— Nenhum —" p/ limpar Modelista/Piloteiros);
//  • Piloto 2/3 visíveis DERIVADOS do draft (o Dev guarda num estado calculado 1× na montagem e não vê um
//    piloto 2 que chega depois por merge do colab — ModeloInfoSection.tsx:94-101);
//  • o cluster "Cronograma & pilotos" some quando a config de revenda esconde todos os campos dele (no Dev
//    vira caixa vazia — fast-follow conhecido) e o "Adicionar Piloto N" só aparece se os campos dele aparecem;
//  • `data-colab-path` em todo input de texto/data (anel de presença + merge por campo);
//  • grid de 2 colunas e ordem Piloto 1 → bloco Piloto 2 → bloco Piloto 3 → Data Desenho Técnico → Data
//    Aprovação (mockup `gen_anotado.py` §s3 e paridade com ModeloInfoSection.tsx:318-339 — as datas de
//    desenho/aprovação vêm DEPOIS dos pilotos, não junto do Piloto 1).
// O estado mora no orquestrador (`draft`/`setDraftTracked`); a trava (enviado à Explosão / sem permissão) é o
// <fieldset disabled> em volta, no orquestrador — MAS o Radix Select (usado pelo FieldSelect) abre no
// `pointerdown` e só respeita a prop `disabled` do próprio componente, não o atributo HTML `disabled` herdado
// do fieldset (ele não é um <select> nativo). Por isso TODO FieldSelect aqui recebe `disabled={bloqueado}`
// explícito — o fieldset sozinho não trava a seleção com o mouse (fix round 1, revisão Opus). A F3.2 reusa
// essa mesma trava no BOM: qualquer campo baseado em Radix Select/Popover dentro de um fieldset precisa do
// `disabled` explícito, não só do fieldset.
import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/shared/DateField";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { type Draft, type Opt } from "@/components/planejamento/modelo-shared";
import { FieldSelect } from "@/components/planejamento/planejamento-detail/campos";

// MESMA queryKey e MESMO shape (Opt[]) do Dev (`useColabs`, ModeloDetailPanel.tsx:3290-3299): cache compartilhado
// sem colisão de forma.
function useColaboradoresTipo(tipo: "modelista" | "piloteiro") {
  return useQuery({
    queryKey: ["colab", tipo],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome").eq("tipo", tipo).order("nome");
      if (error) throw error;
      return (data ?? []) as Opt[];
    },
  });
}

function CampoData({ label, value, onChange, path }: { label: string; value: string; onChange: (v: string) => void; path: string }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <DateField value={value ?? ""} onChange={(e) => onChange(e.target.value)} data-colab-path={path} />
    </div>
  );
}

const CAMPOS_CRONOGRAMA = [
  "piloteiro1_id", "data_piloto1", "piloteiro2_id", "data_piloto2", "piloteiro3_id", "data_piloto3",
  "data_desenho_tecnico", "data_aprovacao",
] as const;

export function DevEquipeSection({ draft, setDraftTracked, refVisivel, campoVisivel, bloqueado }: {
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  /** Campo REF a partir da etapa configurada (refCampoVisivel; posição derivada c/ a chave ligada). */
  refVisivel: boolean;
  /** Interno: sempre true. Comprado: config "Fluxo de Revenda" (revendaCampoVisivel). */
  campoVisivel: (key: string) => boolean;
  /** = `devBloqueado` do orquestrador. Repassado a TODO FieldSelect (Radix Select ignora o fieldset —
   *  ver comentário de topo). DateField/Input/Textarea seguem travando só pelo fieldset (confirmado). */
  bloqueado: boolean;
}) {
  const fl = useFieldLabels();
  const { data: modelistas = [] } = useColaboradoresTipo("modelista");
  const { data: piloteiros = [] } = useColaboradoresTipo("piloteiro");
  const [abertos, setAbertos] = useState<Set<2 | 3>>(new Set());
  const set = (patch: Partial<Draft>) => setDraftTracked((d) => ({ ...d, ...patch }));

  const tem2 = !!(draft.piloteiro2_id || draft.data_piloto2);
  const tem3 = !!(draft.piloteiro3_id || draft.data_piloto3);
  const mostra3 = abertos.has(3) || tem3;
  const mostra2 = abertos.has(2) || tem2 || mostra3;
  const ver2 = campoVisivel("piloteiro2_id") || campoVisivel("data_piloto2");
  const ver3 = campoVisivel("piloteiro3_id") || campoVisivel("data_piloto3");
  const remover = (n: 2 | 3) => {
    // Remover o Piloto 2 limpa também o 3 (paridade com o Dev, ModeloInfoSection.tsx:107-120).
    set(n === 2
      ? { piloteiro2_id: null, data_piloto2: "", piloteiro3_id: null, data_piloto3: "" }
      : { piloteiro3_id: null, data_piloto3: "" });
    setAbertos((prev) => {
      const s = new Set(prev);
      s.delete(n);
      if (n === 2) s.delete(3);
      return s;
    });
  };

  const verModelista = campoVisivel("modelista_id");
  const verCronograma = CAMPOS_CRONOGRAMA.some((k) => campoVisivel(k));

  return (
    <div className="space-y-3">
      {(refVisivel || verModelista) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {refVisivel && (
            <div className="grid gap-1">
              <Label>{fl("ref")}</Label>
              <Input className="font-mono" value={draft.ref} onChange={(e) => set({ ref: e.target.value })} data-colab-path="ref" />
            </div>
          )}
          {verModelista && (
            <FieldSelect
              label={fl("modelista")}
              value={draft.modelista_id}
              onChange={(v) => set({ modelista_id: v })}
              onLimpar={() => set({ modelista_id: null })}
              options={modelistas}
              disabled={bloqueado}
            />
          )}
        </div>
      )}

      {verCronograma && (
        <div className="rounded-md border border-dashed p-3 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cronograma &amp; pilotos</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {campoVisivel("piloteiro1_id") && (
              <FieldSelect label={`${fl("piloteiro")} 1`} value={draft.piloteiro1_id} onChange={(v) => set({ piloteiro1_id: v })} onLimpar={() => set({ piloteiro1_id: null })} options={piloteiros} disabled={bloqueado} />
            )}
            {campoVisivel("data_piloto1") && (
              <CampoData label="Data Piloto 1" value={draft.data_piloto1} onChange={(v) => set({ data_piloto1: v })} path="data_piloto1" />
            )}
          </div>

          {ver2 && mostra2 && (
            <div className="space-y-2 border-t border-dashed pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Piloto 2</span>
                <Button type="button" variant="ghost" size="iconSm" aria-label="Remover piloto 2" onClick={() => remover(2)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {campoVisivel("piloteiro2_id") && (
                  <FieldSelect label={`${fl("piloteiro")} 2`} value={draft.piloteiro2_id} onChange={(v) => set({ piloteiro2_id: v })} onLimpar={() => set({ piloteiro2_id: null })} options={piloteiros} disabled={bloqueado} />
                )}
                {campoVisivel("data_piloto2") && (
                  <CampoData label="Data Piloto 2" value={draft.data_piloto2} onChange={(v) => set({ data_piloto2: v })} path="data_piloto2" />
                )}
              </div>
            </div>
          )}

          {ver3 && mostra3 && (
            <div className="space-y-2 border-t border-dashed pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Piloto 3</span>
                <Button type="button" variant="ghost" size="iconSm" aria-label="Remover piloto 3" onClick={() => remover(3)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {campoVisivel("piloteiro3_id") && (
                  <FieldSelect label={`${fl("piloteiro")} 3`} value={draft.piloteiro3_id} onChange={(v) => set({ piloteiro3_id: v })} onLimpar={() => set({ piloteiro3_id: null })} options={piloteiros} disabled={bloqueado} />
                )}
                {campoVisivel("data_piloto3") && (
                  <CampoData label="Data Piloto 3" value={draft.data_piloto3} onChange={(v) => set({ data_piloto3: v })} path="data_piloto3" />
                )}
              </div>
            </div>
          )}

          {((ver2 && !mostra2) || (ver3 && mostra2 && !mostra3)) && (
            <div className="flex gap-2">
              {ver2 && !mostra2 && (
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAbertos((p) => new Set(p).add(2))}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar Piloto 2
                </Button>
              )}
              {ver3 && mostra2 && !mostra3 && (
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAbertos((p) => new Set(p).add(3))}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar Piloto 3
                </Button>
              )}
            </div>
          )}

          {/* Data Desenho Técnico / Data Aprovação vêm DEPOIS dos pilotos (mockup + paridade com o Dev,
              ModeloInfoSection.tsx:318-339) — não junto do Piloto 1. */}
          {(campoVisivel("data_desenho_tecnico") || campoVisivel("data_aprovacao")) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-dashed pt-2">
              {campoVisivel("data_desenho_tecnico") && (
                <CampoData label="Data Desenho Técnico" value={draft.data_desenho_tecnico} onChange={(v) => set({ data_desenho_tecnico: v })} path="data_desenho_tecnico" />
              )}
              {campoVisivel("data_aprovacao") && (
                <CampoData label="Data Aprovação" value={draft.data_aprovacao} onChange={(v) => set({ data_aprovacao: v })} path="data_aprovacao" />
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-1">
        <Label>Observações Técnicas</Label>
        <Textarea rows={3} value={draft.observacoes_tecnicas} onChange={(e) => set({ observacoes_tecnicas: e.target.value })} data-colab-path="observacoes_tecnicas" />
      </div>
    </div>
  );
}
