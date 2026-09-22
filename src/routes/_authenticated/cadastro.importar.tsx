// Importar Dados — importação em massa via planilha XLSX (multi-tipo).
// Fluxo: Baixar Modelo → subir 1 XLSX (com várias abas) + imagens soltas → parse de TODAS as
// abas presentes → lookups → agregar por tipo → ÁREA DE ANÁLISE em ABAS (uma por tipo) →
// match visual de foto → Confirmar (grava TODOS os tipos, dependências primeiro) → relatório
// consolidado. Nada grava até Confirmar. Arquitetura genérica: itera DESCRIPTORS.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, XCircle, ArrowLeft, Images, Image as ImageIcon, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { AbaAnalise, contarPendencias } from "@/components/importar/AbaAnalise";
import { alvosDeFoto, casarFotos } from "@/lib/import/foto-match";
import { DESCRIPTORS, descriptorPorEntidade } from "@/lib/import/registry";
import { lerWorkbook, parseAba } from "@/lib/import/parse";
import { carregarLookups, carregarOpcoes, type OpcoesLookup } from "@/lib/import/lookup";
import { agregar, type AgregadoResult } from "@/lib/import/aggregate";
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

// Estado de UM tipo (aba) após analisar a planilha. As fotos são globais (arquivos soltos);
// aqui guardamos só o que é por-tipo: o agregado, as opções de dropdown, o que foi ignorado
// e as trocas manuais de foto daquele tipo.
type EstadoTipo = {
  entidade: string;
  agregado: AgregadoResult;
  opcoes: OpcoesLookup;
  ignoradas: Set<string>;
  fotosManuais: Map<string, File>;
};

function ImportarDadosPage() {
  const readOnly = useReadOnly();
  const qc = useQueryClient();
  const [fase, setFase] = useState<Fase>("vazio");
  // resultado por tipo, na ordem de DESCRIPTORS (só os tipos presentes no arquivo).
  const [porTipo, setPorTipo] = useState<Record<string, EstadoTipo>>({});
  const [abaAtiva, setAbaAtiva] = useState<string>("");
  const [fotos, setFotos] = useState<File[]>([]);
  const [relatorios, setRelatorios] = useState<ImportReport[] | null>(null);
  const [progresso, setProgresso] = useState<{ entidade: string; feito: number; total: number } | null>(null);

  const xlsxRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  // tipos analisados, na ordem canônica de DESCRIPTORS (dependências primeiro: tecido→aviamento→insumo).
  const tiposAtivos = useMemo(
    () => DESCRIPTORS.map((d) => d.entidade).filter((e) => porTipo[e]),
    [porTipo],
  );

  const resetar = () => {
    setFase("vazio");
    setPorTipo({});
    setAbaAtiva("");
    setFotos([]);
    setRelatorios(null);
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

  // Sobe UM arquivo e analisa TODAS as abas presentes (uma por tipo). Cada aba com linhas vira
  // uma entrada em `porTipo`; abas ausentes/vazias são ignoradas (aviso ao final).
  const onXlsx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFase("analisando");
    try {
      const buf = await file.arrayBuffer();
      const wb = lerWorkbook(buf);

      const novos: Record<string, EstadoTipo> = {};
      const semLinhas: string[] = []; // abas presentes mas vazias (só exemplos/em branco)
      for (const desc of DESCRIPTORS) {
        const parsed = parseAba(wb, desc.sheetName, desc.colunas, "nome");
        if (!parsed.encontrada || parsed.linhas.length === 0) {
          if (parsed.encontrada) semLinhas.push(desc.label);
          continue;
        }
        // lookups da loja (tenant-scoped por RLS): maps p/ casar + opções p/ os dropdowns.
        const [maps, opts] = await Promise.all([
          carregarLookups(supabase, desc.lookups),
          carregarOpcoes(supabase, desc.lookups),
        ]);
        const ag = agregar(desc, parsed.linhas, maps);
        // upsert incremental: confronta com o banco e marca o estado de cada entidade.
        if (desc.analisarBanco) await desc.analisarBanco(supabase, ag.entidades);
        novos[desc.entidade] = { entidade: desc.entidade, agregado: ag, opcoes: opts, ignoradas: new Set(), fotosManuais: new Map() };
      }

      const tipos = Object.keys(novos);
      if (tipos.length === 0) {
        toast.error("Nenhuma aba com dados encontrada. Baixe o modelo, preencha e importe.");
        setFase("vazio");
        return;
      }
      setPorTipo(novos);
      setAbaAtiva(DESCRIPTORS.find((d) => novos[d.entidade])?.entidade ?? tipos[0]);
      setRelatorios(null);
      setFase("analisado");
      if (semLinhas.length > 0) toast.info(`Sem dados (ignorada): ${semLinhas.join(", ")}.`);
    } catch (err) {
      toast.error(mensagemErro(err, "Erro ao analisar a planilha."));
      setFase("vazio");
    }
  };

  // Fotos finais p/ o engine, POR TIPO: auto-match (por nome do arquivo) + trocas manuais.
  // O engine casa cada foto por `chaveFotoVariante`; construímos o mapa do tipo `entidade`.
  const fotosParaEngine = useCallback((entidade: string): FotosConfirmadas => {
    const out = new Map<string, File>();
    const est = porTipo[entidade];
    const desc = descriptorPorEntidade(entidade);
    if (!est || !desc) return out;
    const alvos = alvosDeFoto(desc, est.agregado.entidades);
    const fileByName = new Map(fotos.map((f) => [f.name, f]));
    const { matches } = casarFotos(alvos.map((a) => ({ chave: a.chave, rotulo: a.rotulo })), fotos.map((f) => f.name));
    for (const a of alvos) {
      const manual = est.fotosManuais.get(a.chave);
      const auto = fileByName.get(matches.find((x) => x.chave === a.chave)?.principal?.arquivo ?? "");
      const file = manual ?? auto;
      if (file) out.set(a.chave, file);
    }
    return out;
  }, [porTipo, fotos]);

  // Mutações locais SEMPRE por tipo (a aba onde a mudança aconteceu).
  const onTrocarFoto = useCallback((entidade: string, chaveAlvo: string, file: File | null) => {
    setPorTipo((prev) => {
      const est = prev[entidade]; if (!est) return prev;
      const n = new Map(est.fotosManuais); if (file) n.set(chaveAlvo, file); else n.delete(chaveAlvo);
      return { ...prev, [entidade]: { ...est, fotosManuais: n } };
    });
  }, []);

  // Patch de UMA entidade (dropdown corrigido, cor trocada, "mesmo tecido", etc.). Recomputa os
  // `problemas` da linha (revalidar) — senão um erro do resolve inicial persistiria e a linha
  // corrigida seria pulada em silêncio (achado da revisão).
  const onPatch = useCallback((entidade: string, chave: string, patch: Partial<EntidadeAgregada>) => {
    const desc = descriptorPorEntidade(entidade);
    setPorTipo((prev) => {
      const est = prev[entidade]; if (!est) return prev;
      return {
        ...prev,
        [entidade]: {
          ...est,
          agregado: {
            ...est.agregado,
            entidades: est.agregado.entidades.map((e) => {
              if (e.chave !== chave) return e;
              const merged = { ...e, ...patch };
              return desc?.revalidar ? { ...merged, problemas: desc.revalidar(merged) } : merged;
            }),
          },
        },
      };
    });
  }, []);

  const onToggleIgnorar = useCallback((entidade: string, chave: string) => {
    setPorTipo((prev) => {
      const est = prev[entidade]; if (!est) return prev;
      const n = new Set(est.ignoradas); n.has(chave) ? n.delete(chave) : n.add(chave);
      return { ...prev, [entidade]: { ...est, ignoradas: n } };
    });
  }, []);

  // v1: cadastrar-novo abre a tela de cadastro correspondente numa nova aba (o dono cadastra e
  // reimporta ou troca no dropdown). Refino futuro: dialog inline.
  const onCadastrar = useCallback((tipo: "fornecedor" | "cor" | "categoria", nome: string) => {
    const url = tipo === "fornecedor" ? "/cadastro/servico" : "/cadastro/atributos";
    toast.info(`Cadastre "${nome}" em ${tipo === "fornecedor" ? "Fornecedores" : "Atributos"} e selecione no campo.`);
    window.open(url, "_blank");
  }, []);

  // Pendências e "a importar" somam TODAS as abas (a confirmação grava tudo).
  const pendenciasPorTipo = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of tiposAtivos) out[t] = contarPendencias(porTipo[t].agregado.entidades, porTipo[t].ignoradas);
    return out;
  }, [tiposAtivos, porTipo]);
  const pendenciasTotal = useMemo(() => Object.values(pendenciasPorTipo).reduce((a, b) => a + b, 0), [pendenciasPorTipo]);
  const aImportarTotal = useMemo(
    () => tiposAtivos.reduce((acc, t) => acc + porTipo[t].agregado.entidades.filter((e) => !porTipo[t].ignoradas.has(e.chave)).length, 0),
    [tiposAtivos, porTipo],
  );
  const ignoradasTotal = useMemo(() => tiposAtivos.reduce((acc, t) => acc + porTipo[t].ignoradas.size, 0), [tiposAtivos, porTipo]);

  // Confirmar = grava TODOS os tipos, na ordem de DESCRIPTORS (dependências primeiro).
  const onConfirmar = async () => {
    if (tiposAtivos.length === 0) return;
    setFase("importando");
    const reps: ImportReport[] = [];
    try {
      for (const entidade of tiposAtivos) {
        const desc = descriptorPorEntidade(entidade)!;
        const est = porTipo[entidade];
        const aGravar = est.agregado.entidades.filter((e) => !est.ignoradas.has(e.chave)) as EntidadeAgregada[];
        setProgresso({ entidade: desc.label, feito: 0, total: aGravar.length });
        const rep = await importar(
          supabase,
          desc,
          aGravar,
          fotosParaEngine(entidade),
          (feito, total) => setProgresso({ entidade: desc.label, feito, total }),
        );
        reps.push(rep);
      }
      setRelatorios(reps);
      setFase("concluido");
      // invalida as listas que cada tipo alimenta.
      if (porTipo["tecido"]) qc.invalidateQueries({ queryKey: ["artigos"] });
      const tot = reps.reduce((a, r) => ({
        criados: a.criados + r.criados, complementados: a.complementados + r.complementados,
        soFoto: a.soFoto + r.soFoto, erros: a.erros + r.erros,
      }), { criados: 0, complementados: 0, soFoto: 0, erros: 0 });
      const resumoTxt = `${tot.criados} criado(s), ${tot.complementados} complementado(s), ${tot.soFoto} c/ foto`;
      if (tot.erros === 0) toast.success(resumoTxt + ".");
      else toast.warning(`${resumoTxt}, ${tot.erros} com erro.`);
    } catch (err) {
      toast.error(mensagemErro(err, "Erro na importação."));
      setFase("analisado");
    }
  };

  return (
    <div className="container mx-auto p-4 pb-28 max-w-5xl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-start gap-3">
          <Upload className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Importar Dados</h1>
            <p className="text-sm text-muted-foreground">Importe planilhas e imagens em massa — vários tipos de uma vez.</p>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 mb-6">
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
              <p className="font-medium">Baixe o modelo, preencha as abas e importe a planilha.</p>
              <p className="text-sm">Todas as abas com dados (Tecido, Aviamento, Insumo…) são importadas de uma vez.</p>
              <p className="text-sm">Selecione também as imagens (arquivos soltos nomeados pelo nome do produto).</p>
            </div>
          </div>
        )}

        {fase === "analisando" && (
          <div className="grid place-items-center h-64 text-muted-foreground">
            <div className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Analisando a planilha…</div>
          </div>
        )}

        {(fase === "analisado" || fase === "importando") && tiposAtivos.length > 0 && (
          <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
            <TabsList>
              {tiposAtivos.map((t) => {
                const desc = descriptorPorEntidade(t)!;
                const n = porTipo[t].agregado.entidades.length;
                const pend = pendenciasPorTipo[t] ?? 0;
                return (
                  <TabsTrigger key={t} value={t} className="gap-1.5">
                    {desc.label} <span className="text-muted-foreground">({n})</span>
                    {pend > 0 && <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">{pend}</Badge>}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {tiposAtivos.map((t) => {
              const est = porTipo[t];
              const desc = descriptorPorEntidade(t)!;
              return (
                <TabsContent key={t} value={t} className="mt-4">
                  <AbaAnalise
                    descriptor={desc}
                    entidades={est.agregado.entidades as EntidadeAgregada[]}
                    opcoes={est.opcoes}
                    fotos={fotos}
                    ignoradas={est.ignoradas}
                    onToggleIgnorar={(chave) => onToggleIgnorar(t, chave)}
                    onPatch={(chave, patch) => onPatch(t, chave, patch)}
                    onCadastrar={onCadastrar}
                    fotosManuais={est.fotosManuais}
                    onTrocarFoto={(chaveAlvo, file) => onTrocarFoto(t, chaveAlvo, file)}
                  />
                </TabsContent>
              );
            })}

            {fase === "importando" && progresso && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Importando {progresso.entidade}… {progresso.feito}/{progresso.total}
              </div>
            )}
          </Tabs>
        )}

        {fase === "concluido" && relatorios && (
          <div className="space-y-6">
            <h3 className="font-semibold">Resultado</h3>
            {relatorios.map((relatorio) => {
              const desc = descriptorPorEntidade(relatorio.entidade);
              return (
                <div key={relatorio.entidade} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{desc?.label ?? relatorio.entidade}</span>
                    {relatorio.criados > 0 && <Badge className="bg-emerald-600"><CheckCircle2 className="h-3.5 w-3.5 mr-1" />{relatorio.criados} criado(s)</Badge>}
                    {relatorio.complementados > 0 && <Badge variant="outline" className="text-emerald-600 border-emerald-300">{relatorio.complementados} complementado(s)</Badge>}
                    {relatorio.soFoto > 0 && <Badge variant="outline" className="text-sky-600 border-sky-300">{relatorio.soFoto} foto(s) adicionada(s)</Badge>}
                    {relatorio.inalterados > 0 && <Badge variant="outline">{relatorio.inalterados} sem mudança</Badge>}
                    {relatorio.pulados > 0 && <Badge variant="outline">{relatorio.pulados} pulado(s)</Badge>}
                    {relatorio.erros > 0 && <Badge variant="destructive"><XCircle className="h-3.5 w-3.5 mr-1" />{relatorio.erros} com erro</Badge>}
                  </div>
                  <div className="rounded-md border max-h-72 overflow-auto text-sm divide-y">
                    {relatorio.itens.map((it) => (
                      <div key={it.chave} className="flex items-center gap-2 p-2">
                        {(it.status === "criado" || it.status === "complementado") && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                        {it.status === "so_foto" && <ImageIcon className="h-4 w-4 text-sky-600 shrink-0" />}
                        {it.status === "inalterado" && <MinusCircle className="h-4 w-4 text-muted-foreground shrink-0" />}
                        {it.status === "pulado" && <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
                        {it.status === "erro" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                        <span className="font-medium">{it.nome}</span>
                        <span className="text-xs text-muted-foreground">
                          {it.status === "complementado" ? "complementado" : it.status === "so_foto" ? "foto adicionada" : it.status === "inalterado" ? "sem mudança" : ""}
                        </span>
                        {it.motivo && <span className="text-muted-foreground truncate">— {it.motivo}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <PageActionBar>
        <Button variant="ghost" onClick={resetar}><ArrowLeft className="h-4 w-4 mr-2" /> Recomeçar</Button>
        {fase === "analisado" && tiposAtivos.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {aImportarTotal} a importar
            {ignoradasTotal > 0 && ` · ${ignoradasTotal} ignorado(s)`}
            {pendenciasTotal > 0 && ` · ${pendenciasTotal} pendência(s)`}
          </span>
        )}
        {fase === "analisado" && (
          <Button
            className="ml-auto"
            onClick={onConfirmar}
            disabled={readOnly || aImportarTotal === 0 || pendenciasTotal > 0}
            title={pendenciasTotal > 0 ? "Resolva as pendências (campos em vermelho) em todas as abas para confirmar" : undefined}
          >
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
