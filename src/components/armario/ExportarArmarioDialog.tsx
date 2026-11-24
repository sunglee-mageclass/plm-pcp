// F7 Armário — dialog "Baixar CSV": escolhe as COLUNAS DO CSV (as 6 do catálogo; por padrão só o SKU vem marcado) e baixa 1 linha por
// item (cor) do armário, na ordem da vitrine. Export é LEITURA: o botão que abre este dialog aparece mesmo com a tela travada.
// ⚠️ "Colunas do CSV" ≠ o Select "Colunas" do header da montagem (aquele é o nº de colunas do LAYOUT da vitrine).
// A seleção persiste por usuário (`useUserPref("export","armario-csv","colunas",[])`; `[]` = nunca escolheu = só o SKU, COLUNAS_PADRAO).
import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUserPref } from "@/hooks/useUiPrefs";
import { mensagemArmario } from "@/lib/armario/mensagem";
import {
  CAMPOS_ARMARIO, baixarCsvArmario, colunasEscolhidas, lerRetornoExportarArmario, prefDeColunas,
} from "@/lib/armario/export-csv";

export function ExportarArmarioDialog({
  open, onOpenChange, armarioId, alteracoesNaoSalvas = false,
}: { open: boolean; onOpenChange: (open: boolean) => void; armarioId: string; alteracoesNaoSalvas?: boolean }) {
  const [colunasPref, setColunasPref] = useUserPref("export", "armario-csv", "colunas", []);
  const colunasSel = useMemo(() => colunasEscolhidas(colunasPref), [colunasPref]);

  const baixar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("exportar_armario", { _armario_id: armarioId });
      if (error) throw error;
      const ret = lerRetornoExportarArmario(data);
      return { n: baixarCsvArmario(ret, colunasSel), vazio: ret.linhas.length === 0 };
    },
    onSuccess: ({ n, vazio }) => {
      if (vazio) { toast.info("Este armário não tem variantes — nada para exportar."); return; }
      toast.success(`CSV gerado com ${n} ${n === 1 ? "linha" : "linhas"}.`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(mensagemArmario(e, "Não foi possível gerar o CSV.")),
  });

  const alternar = (key: string, marcar: boolean) => {
    const set = new Set(colunasSel);
    if (marcar) set.add(key);
    else set.delete(key);
    setColunasPref(prefDeColunas([...set]));
  };

  const semColuna = colunasSel.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!baixar.isPending) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Baixar CSV</DialogTitle>
          <DialogDescription>
            Uma linha por variante (cor) do armário, na ordem da vitrine. Escolha as colunas do arquivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2" role="group" aria-label="Colunas do CSV">
          <p className="text-sm font-medium">Colunas do CSV</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {CAMPOS_ARMARIO.map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <Checkbox
                  id={`armario-csv-col-${c.key}`}
                  checked={colunasSel.includes(c.key)}
                  onCheckedChange={(v) => alternar(c.key, v === true)}
                />
                <label htmlFor={`armario-csv-col-${c.key}`} className="text-sm">{c.rotulo}</label>
              </div>
            ))}
          </div>
          {semColuna && <p className="text-xs text-destructive" role="status">Marque ao menos uma coluna.</p>}
        </div>
        {alteracoesNaoSalvas && (
          <p className="text-xs text-muted-foreground" role="note">
            O CSV usa o armário como está salvo. Salve antes para incluir as alterações da grade.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={baixar.isPending}>Cancelar</Button>
          <Button type="button" onClick={() => baixar.mutate()} disabled={semColuna || baixar.isPending}>
            {baixar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
            {baixar.isPending ? "Gerando…" : "Baixar CSV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
