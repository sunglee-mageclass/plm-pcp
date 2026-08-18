import { AlertTriangle, Check } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { NfList } from "./NfList";
import { ResponsavelSelect } from "@/components/shared/ResponsavelSelect";
import { uploadFile } from "./shared";
import { OcSecTitle } from "./OcTecidoForm";
import { OcTecidoCalculos } from "./OcTecidoCalculos";
import { EtiquetaLavagemArtigoEditor } from "@/components/shared/EtiquetaLavagemArtigo";
import type { Artigo, Draft, ItemDraft, ParcelaRecebimento, RoloEntry, Variante } from "./shared";

// Um requisito do "marcar recebido" — derivado da MESMA fonte que valida o botão
// (requisitosRecebimento no OcDialog); aqui só vira badge verde ✓ / âmbar ⚠.
export type RequisitoRecebimento = { key: string; ok: boolean; rotulo: string; faltas: string[] };

export function OcTecidoRecebimento({
  draft, setDraft,
  items, artigoMap, varianteMap, setQtd, totalPrevisto, totalReal,
  tecido2Aberto, artigoId1, artigoId2, status, readOnly = false,
  toggleCancelado, canCancel,
  modoRolo = false, rolos = {}, setRolos, onRoloCq, onRoloCancelar, onRoloAjuste,
  semEtiquetaPorArtigo = {}, setSemEtiquetaPorArtigo, onSemEtiqueta, etiquetasByArtigo = {},
  requisitos = [],
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  handleSingleUpload: (file: File, key: keyof Draft) => void;
  items: ItemDraft[];
  artigoMap: Record<string, Artigo>;
  varianteMap: Record<string, Variante>;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number | null) => void;
  totalPrevisto: number;
  totalReal: number;
  tecido2Aberto: boolean;
  artigoId1: string | null;
  artigoId2: string | null;
  status?: string | null;
  readOnly?: boolean;
  toggleCancelado?: (tempId: string, value: boolean) => void;
  canCancel?: boolean;
  modoRolo?: boolean;
  rolos?: Record<string, RoloEntry[]>;
  setRolos?: React.Dispatch<React.SetStateAction<Record<string, RoloEntry[]>>>;
  onRoloCq?: (roloItemId: string, patch: { cq_ok?: boolean; cq_alerta?: boolean; obs?: string }) => void;
  onRoloCancelar?: (roloId: string, cancel: boolean) => void;
  onRoloAjuste?: (roloId: string, novaQtd: number) => void;
  semEtiquetaPorArtigo?: Record<string, boolean>;
  setSemEtiquetaPorArtigo?: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSemEtiqueta?: (artigoId: string, value: boolean) => void;
  etiquetasByArtigo?: Record<string, string[]>;
  // Checklist SEMPRE visível dos requisitos do "marcar recebido" (fonte única no OcDialog).
  requisitos?: RequisitoRecebimento[];
}) {
  return (
    <section id="oc-sec-recebimento" className="scroll-mt-2">
      <div className="space-y-4">
        <OcSecTitle n={4}>Recebimento</OcSecTitle>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="grid gap-1">
            {/* ÚNICO controle de entregas parceladas na edição (a duplicata que
                morava na seção Pedido foi removida no redesign ago/2026). */}
            <Label>Entregas parceladas (qtd)</Label>
            <NumberInput
              type="number"
              integer
              min={1}
              max={24}
              value={draft.parcelas_recebimento?.length || 1}
              onChange={(e) => {
                const n = Math.max(1, Math.min(24, Math.trunc(Number(e.target.value)) || 1));
                setDraft((d) => {
                  const prev: ParcelaRecebimento[] = d.parcelas_recebimento ?? [];
                  const next: ParcelaRecebimento[] = Array.from({ length: n }, (_, i) =>
                    prev[i] ?? { data: "", recebido: false },
                  );
                  return { ...d, parcelas_recebimento: next };
                });
              }}
              disabled={readOnly}
            />
          </div>
          <div className="grid gap-1">
            {/* Espelha o Responsável do pedido (seção 1): mesmo componente, grava id+nome.
                Escritas SEMPRE via o setter que o dialog passa (setDraftTracked). Opcional. */}
            <Label>Responsável pelo recebimento</Label>
            <ResponsavelSelect
              nome={draft.recebimento_responsavel_nome}
              id={draft.recebimento_responsavel_id}
              onChange={(n, cid) =>
                setDraft((d) => ({ ...d, recebimento_responsavel_nome: n ?? "", recebimento_responsavel_id: cid }))
              }
              disabled={readOnly}
            />
          </div>
        </div>

        <NfList
          value={draft.nfs}
          onChange={(nfs) => setDraft((d) => ({ ...d, nfs }))}
          uploadFn={(f) => uploadFile(f, "nf_url")}
          readOnly={readOnly}
        />

        <div className="rounded-md border p-3 space-y-2">
          <Label className="text-sm">Parcelas de entrega</Label>
          {(draft.parcelas_recebimento?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">
              Defina a quantidade de parcelas acima.
            </p>
          ) : (
            <div className="space-y-2">
              {(draft.parcelas_recebimento ?? []).map((p, idx) => (
                <div
                  key={idx}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2"
                >
                  <span className="text-sm text-muted-foreground">#{idx + 1}</span>
                  <DateField
                    className="w-40"
                    value={p.data}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraft((d) => {
                        const arr = [...(d.parcelas_recebimento ?? [])];
                        arr[idx] = { ...arr[idx], data: v };
                        return { ...d, parcelas_recebimento: arr };
                      });
                    }}
                    disabled={readOnly}
                  />
                  <label className="inline-flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={p.recebido}
                      onCheckedChange={(v) => {
                        const checked = v === true;
                        setDraft((d) => {
                          const arr = [...(d.parcelas_recebimento ?? [])];
                          arr[idx] = { ...arr[idx], recebido: checked };
                          return { ...d, parcelas_recebimento: arr };
                        });
                      }}
                      disabled={readOnly}
                    />
                    Recebida
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border p-3 space-y-3 bg-muted/30">
          <p className="text-xs text-muted-foreground">
            A etiqueta de lavagem fica vinculada ao artigo (tecido) e acompanha todo o processo.
            Subir aqui salva diretamente no cadastro do artigo.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <EtiquetaLavagemArtigoEditor
                artigoId={artigoId1}
                label="Etiqueta de Lavagem — Tecido 1"
              />
              {!readOnly && artigoId1 && (etiquetasByArtigo[artigoId1]?.length ?? 0) === 0 && onSemEtiqueta && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={!!semEtiquetaPorArtigo[artigoId1]}
                    onCheckedChange={(v) => onSemEtiqueta(artigoId1, v === true)}
                  />
                  Este tecido não tem etiqueta de lavagem
                </label>
              )}
            </div>
            {tecido2Aberto && (
              <div className="space-y-2">
                <EtiquetaLavagemArtigoEditor
                  artigoId={artigoId2}
                  label="Etiqueta de Lavagem — Tecido 2"
                />
                {!readOnly && artigoId2 && (etiquetasByArtigo[artigoId2]?.length ?? 0) === 0 && onSemEtiqueta && (
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={!!semEtiquetaPorArtigo[artigoId2]}
                      onCheckedChange={(v) => onSemEtiqueta(artigoId2, v === true)}
                    />
                    Este tecido não tem etiqueta de lavagem
                  </label>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-1">
          <Label>Observações sobre Defeitos</Label>
          <Textarea
            value={draft.observacoes_defeitos}
            onChange={(e) => setDraft((d) => ({ ...d, observacoes_defeitos: e.target.value }))}
            disabled={readOnly}
          />
        </div>

        {/* Checklist dos requisitos do "marcar recebido" — sempre visível; derivado da
            MESMA fonte da validação do botão (não re-implementa nenhuma regra). */}
        {requisitos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {requisitos.map((r) => (
              <StatusBadge
                key={r.key}
                tone={r.ok ? "success" : "warning"}
                title={r.ok ? undefined : r.faltas.join(" ")}
                className="gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
              >
                {r.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {r.rotulo}
              </StatusBadge>
            ))}
          </div>
        )}

        <OcTecidoCalculos
          items={items}
          artigoMap={artigoMap}
          varianteMap={varianteMap}
          setQtd={setQtd}
          totalPrevisto={totalPrevisto}
          totalReal={totalReal}
          dataPrevista={draft.data_prevista_entrega}
          dataEntrega={draft.data_entrega}
          status={status}
          readOnly={readOnly}
          toggleCancelado={toggleCancelado}
          canCancel={canCancel}
          modoRolo={modoRolo}
          rolos={rolos}
          setRolos={setRolos}
          onRoloCq={onRoloCq}
          onRoloCancelar={onRoloCancelar}
          onRoloAjuste={onRoloAjuste}
        />
      </div>
    </section>
  );
}
