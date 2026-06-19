import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { FileField } from "./FileField";
import { uploadFile } from "./shared";

type NfHist = { url: string; data: string };

const fmtD = (d: string) => (d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—");

// Notas fiscais da OC: NF atual + histórico. Anexar nova arquiva a anterior.
export function OcNfHistorico({ ocId }: { ocId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["oc-nf", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido").select("nf_url, nf_historico").eq("id", ocId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as { nf_url: string | null; nf_historico: NfHist[] | null } | null;
    },
  });

  const hist = (data?.nf_historico ?? []) as NfHist[];

  const setNf = useMutation({
    mutationFn: async (novaPath: string | null) => {
      // Arquiva a NF atual (se houver) antes de trocar/limpar.
      const novoHist = data?.nf_url
        ? [...hist, { url: data.nf_url, data: new Date().toISOString().slice(0, 10) }]
        : hist;
      const { error } = await supabase
        .from("ocs_tecido")
        .update({ nf_url: novaPath, nf_historico: novoHist } as any)
        .eq("id", ocId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("NF atualizada (anterior arquivada)");
      qc.invalidateQueries({ queryKey: ["oc-nf", ocId] });
      qc.invalidateQueries({ queryKey: ["oc-tecido", ocId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao atualizar NF"),
  });

  const onUpload = async (file: File) => {
    try {
      const path = await uploadFile(file, "nf_url");
      setNf.mutate(path);
    } catch (e: any) {
      toast.error(e.message ?? "Erro no upload");
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Notas fiscais</h3>
      <FileField
        label="NF atual"
        path={data?.nf_url ?? null}
        onChange={onUpload}
        onClear={() => setNf.mutate(null)}
      />
      {hist.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Histórico ({hist.length}) — NFs anteriores</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {hist.slice().reverse().map((h, i) => (
              <FileField key={i} label={`NF de ${fmtD(h.data)}`} path={h.url} onChange={() => {}} onClear={() => {}} disabled />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
