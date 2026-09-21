// Importar Dados — importação em massa via planilha XLSX (piloto: Tecido).
// Fluxo: Baixar Modelo → subir XLSX + imagens soltas → parse → lookups → agregar →
// ÁREA DE ANÁLISE (divergências) → match visual de foto → Confirmar → engine (upload+RPC
// por linha) → relatório. Nada grava até Confirmar. Arquitetura genérica: itera DESCRIPTORS.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, XCircle, ArrowLeft, Images } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { MatchVisualFoto } from "@/components/importar/MatchVisualFoto";
import { alvosDeFoto } from "@/lib/import/foto-match";
import { DESCRIPTORS, descriptorPorEntidade } from "@/lib/import/registry";
import { lerWorkbook, parseAba } from "@/lib/import/parse";
import { carregarLookups } from "@/lib/import/lookup";
import { agregar, resumoProblemas, todosProblemas, type AgregadoResult } from "@/lib/import/aggregate";
import { baixarTemplate } from "@/lib/import/template";
import { importar, type FotosConfirmadas } from "@/lib/import/engine";
import type { EntidadeAgregada, ImportReport } from "@/lib/import/types";

export const Route = createFileRoute("/_authenticated/cadastro/importar")({
  component: () => (
    <RequirePermission page="importar">
      <ImportarDadosPage />
    </RequirePermission>
  ),
});

type Fase = "vazio" | "analisando" | "analisado" | "importando" | "concluido";

function ImportarDadosPage() {
  const readOnly = useReadOnly();
  const qc = useQueryClient();
  const [entidade, setEntidade] = useState<string>(DESCRIPTORS[0]?.entidade ?? "");
  const [fase, setFase] = useState<Fase>("vazio");
  const [agregado, setAgregado] = useState<AgregadoResult | null>(null);
  const [fotos, setFotos] = useState<File[]>([]);
  const [fotosConfirmadas, setFotosConfirmadas] = useState<FotosConfirmadas>(new Map());
  const [relatorio, setRelatorio] = useState<ImportReport | null>(null);
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);

  const xlsxRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const desc = descriptorPorEntidade(entidade);

  const resetar = () => {
    setFase("vazio");
    setAgregado(null);
    setFotos([]);
    setFotosConfirmadas(new Map());
    setRelatorio(null);
    setProgresso(null);
    if (xlsxRef.current) xlsxRef.current.value = "";
    if (imgRef.current) imgRef.current.value = "";
  };

  const onBaixarModelo = () => {
    try {
      baixarTemplate(DESCRIPTORS);
      toast.success("Modelo baixado.");
    } catch (e) {
      toast.error(mensagemErro(e, "Erro ao gerar o modelo."));
    }
  };

  const onImagens = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setFotos(files);
  };

  const onXlsx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !desc) return;
    setFase("analisando");
    try {
      const buf = await file.arrayBuffer();
      const wb = lerWorkbook(buf);
      const parsed = parseAba(wb, desc.sheetName, desc.colunas, "nome");
      if (!parsed.encontrada) {
        toast.error(`A aba "${desc.sheetName}" não foi encontrada no arquivo.`);
        setFase("vazio");
        return;
      }
      if (parsed.linhas.length === 0) {
        toast.error(`Nenhuma linha preenchida na aba "${desc.sheetName}".`);
        setFase("vazio");
        return;
      }
      // carrega lookups da loja (tenant-scoped por RLS) e resolve nome→id.
      const maps = await carregarLookups(supabase, desc.lookups);
      // duplicatas já existentes no banco (nome sem unique — ex.: artigos).
      let dup: Set<string> | undefined;
      if (desc.duplicatasExistentes) {
        const chaves = parsed.linhas.map((l) => desc.chaveNatural(l));
        dup = await desc.duplicatasExistentes(supabase, chaves);
      }
      const ag = agregar(desc, parsed.linhas, maps, dup);
      setAgregado(ag);
      setFase("analisado");
    } catch (err) {
      toast.error(mensagemErro(err, "Erro ao analisar a planilha."));
      setFase("vazio");
    }
  };

  const resumo = useMemo(() => (agregado ? resumoProblemas(agregado.entidades) : null), [agregado]);
  const problemasLista = useMemo(() => (agregado ? todosProblemas(agregado.entidades) : []), [agregado]);

  // Alvos de foto conforme o modo do descritor (tecido = 1 por cor; produto = 1 por registro).
  const alvosParaMatch = useMemo(
    () => (desc && agregado ? alvosDeFoto(desc, agregado.entidades) : []),
    [desc, agregado],
  );

  const handleFotosChange = useCallback((m: FotosConfirmadas) => setFotosConfirmadas(m), []);

  const onConfirmar = async () => {
    if (!desc || !agregado) return;
    setFase("importando");
    setProgresso({ feito: 0, total: 0 });
    try {
      const rep = await importar(
        supabase,
        desc,
        agregado.entidades as EntidadeAgregada[],
        fotosConfirmadas,
        (feito, total) => setProgresso({ feito, total }),
      );
      setRelatorio(rep);
      setFase("concluido");
      // invalida as listas que a entidade alimenta (tecido → artigos).
      if (desc.entidade === "tecido") qc.invalidateQueries({ queryKey: ["artigos"] });
      if (rep.erros === 0) toast.success(`${rep.criados} criado(s), ${rep.pulados} pulado(s).`);
      else toast.warning(`${rep.criados} criado(s), ${rep.pulados} pulado(s), ${rep.erros} com erro.`);
    } catch (err) {
      toast.error(mensagemErro(err, "Erro na importação."));
      setFase("analisado");
    }
  };

  return (
    <div className="container mx-auto p-4 pb-28 max-w-5xl">
      <div className="mb-4">
        <Breadcrumb items={[{ label: "Importar Dados" }]} />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">Tipo de dado</label>
          <Select value={entidade} onValueChange={(v) => { setEntidade(v); resetar(); }}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DESCRIPTORS.map((d) => (
                <SelectItem key={d.entidade} value={d.entidade}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={onBaixarModelo}>
          <Download className="h-4 w-4 mr-2" /> Baixar Modelo
        </Button>
        <input ref={xlsxRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onXlsx} />
        <Button onClick={() => xlsxRef.current?.click()} disabled={readOnly || fase === "analisando" || fase === "importando"}>
          <Upload className="h-4 w-4 mr-2" /> Importar planilha
        </Button>
        <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={onImagens} />
        <Button variant="outline" onClick={() => imgRef.current?.click()} disabled={readOnly}>
          <Images className="h-4 w-4 mr-2" /> Selecionar imagens {fotos.length > 0 ? `(${fotos.length})` : ""}
        </Button>
      </div>

      {/* Área de ANÁLISE */}
      <Card className="p-5 min-h-[300px]">
        {fase === "vazio" && (
          <div className="grid place-items-center h-64 text-center text-muted-foreground">
            <div>
              <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">Baixe o modelo, preencha e importe a planilha.</p>
              <p className="text-sm">Selecione também as imagens (arquivos soltos nomeados pelo nome do produto).</p>
            </div>
          </div>
        )}

        {fase === "analisando" && (
          <div className="grid place-items-center h-64 text-muted-foreground">
            <div className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Analisando a planilha…</div>
          </div>
        )}

        {(fase === "analisado" || fase === "importando") && resumo && agregado && (
          <div className="space-y-5">
            <div>
              <h3 className="font-semibold mb-2">Análise ({desc?.label})</h3>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{resumo.total} item(ns) no arquivo</Badge>
                {resumo.comErro > 0 && <Badge variant="destructive">{resumo.comErro} com erro</Badge>}
                {resumo.duplicatas > 0 && <Badge variant="outline">{resumo.duplicatas} duplicata(s)</Badge>}
                {resumo.semFoto > 0 && <Badge variant="outline">{resumo.semFoto} sem foto</Badge>}
                {resumo.avisos > 0 && <Badge variant="outline" className="text-amber-600 border-amber-300">{resumo.avisos} com aviso</Badge>}
              </div>
            </div>

            {problemasLista.length > 0 && (
              <div className="rounded-md border p-3 max-h-56 overflow-auto text-sm space-y-2">
                {problemasLista.map((p) => (
                  <div key={p.nome}>
                    <p className="font-medium">{p.nome}</p>
                    <ul className="pl-4 list-disc text-muted-foreground">
                      {p.problemas.map((pr, i) => (
                        <li key={i} className={pr.nivel === "erro" ? "text-destructive" : pr.nivel === "duplicata" ? "text-muted-foreground" : "text-amber-600"}>
                          {pr.mensagem}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {desc?.temFoto && (
              <div>
                <h3 className="font-semibold mb-2">Fotos</h3>
                <MatchVisualFoto alvos={alvosParaMatch} arquivos={fotos} onChange={handleFotosChange} />
              </div>
            )}

            {fase === "importando" && progresso && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Importando… {progresso.feito}/{progresso.total}
              </div>
            )}
          </div>
        )}

        {fase === "concluido" && relatorio && (
          <div className="space-y-4">
            <h3 className="font-semibold">Resultado</h3>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-emerald-600"><CheckCircle2 className="h-3.5 w-3.5 mr-1" />{relatorio.criados} criado(s)</Badge>
              <Badge variant="outline">{relatorio.pulados} pulado(s)</Badge>
              {relatorio.erros > 0 && <Badge variant="destructive"><XCircle className="h-3.5 w-3.5 mr-1" />{relatorio.erros} com erro</Badge>}
            </div>
            <div className="rounded-md border max-h-72 overflow-auto text-sm divide-y">
              {relatorio.itens.map((it) => (
                <div key={it.chave} className="flex items-center gap-2 p-2">
                  {it.status === "criado" && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                  {it.status === "pulado" && <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
                  {it.status === "erro" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                  <span className="font-medium">{it.nome}</span>
                  {it.motivo && <span className="text-muted-foreground truncate">— {it.motivo}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <PageActionBar>
        <Button variant="ghost" onClick={resetar}><ArrowLeft className="h-4 w-4 mr-2" /> Recomeçar</Button>
        {fase === "analisado" && (
          <Button className="ml-auto" onClick={onConfirmar} disabled={readOnly || !agregado || agregado.entidades.length === 0}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar importação
          </Button>
        )}
        {fase === "importando" && (
          <Button className="ml-auto" disabled><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importando…</Button>
        )}
      </PageActionBar>
    </div>
  );
}
