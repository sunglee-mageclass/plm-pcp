// Importar Dados — importação em massa via planilha XLSX (piloto: Tecido).
// Fluxo: Baixar Modelo → subir XLSX + imagens soltas → parse → lookups → agregar →
// ÁREA DE ANÁLISE (divergências) → match visual de foto → Confirmar → engine (upload+RPC
// por linha) → relatório. Nada grava até Confirmar. Arquitetura genérica: itera DESCRIPTORS.

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
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { alvosDeFoto, casarFotos } from "@/lib/import/foto-match";
import { DESCRIPTORS, descriptorPorEntidade } from "@/lib/import/registry";
import { lerWorkbook, parseAba } from "@/lib/import/parse";
import { carregarLookups, carregarOpcoes, type OpcoesLookup } from "@/lib/import/lookup";
import { TabelaAnalise } from "@/components/importar/TabelaAnalise";
import { agregar, resumoProblemas, type AgregadoResult } from "@/lib/import/aggregate";
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
  const [opcoes, setOpcoes] = useState<OpcoesLookup>({});
  const [ignoradas, setIgnoradas] = useState<Set<string>>(new Set());
  const [fotos, setFotos] = useState<File[]>([]);
  // trocas manuais de foto na tabela: chave do alvo (chaveFotoVariante) → File (override do auto-match).
  const [fotosManuais, setFotosManuais] = useState<Map<string, File>>(new Map());
  const [relatorio, setRelatorio] = useState<ImportReport | null>(null);
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);

  const xlsxRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const desc = descriptorPorEntidade(entidade);

  const resetar = () => {
    setFase("vazio");
    setAgregado(null);
    setFotos([]);
    setFotosManuais(new Map());
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
      // carrega lookups da loja (tenant-scoped por RLS): maps p/ casar + opções p/ os dropdowns.
      const [maps, opts] = await Promise.all([
        carregarLookups(supabase, desc.lookups),
        carregarOpcoes(supabase, desc.lookups),
      ]);
      const ag = agregar(desc, parsed.linhas, maps);
      // upsert incremental: confronta com o banco e marca o estado de cada entidade.
      if (desc.analisarBanco) await desc.analisarBanco(supabase, ag.entidades);
      setOpcoes(opts);
      setIgnoradas(new Set());
      setAgregado(ag);
      setFase("analisado");
    } catch (err) {
      toast.error(mensagemErro(err, "Erro ao analisar a planilha."));
      setFase("vazio");
    }
  };

  const resumo = useMemo(() => (agregado ? resumoProblemas(agregado.entidades) : null), [agregado]);

  // Fotos finais p/ o engine: auto-match (por nome do arquivo) + trocas manuais (override).
  // Chave = chaveFotoVariante do alvo (o engine casa por ela). Reage a fotos/manuais/entidades.
  const fotosParaEngine = useMemo<FotosConfirmadas>(() => {
    const out = new Map<string, File>();
    if (!desc || !agregado) return out;
    const alvos = alvosDeFoto(desc, agregado.entidades);
    const fileByName = new Map(fotos.map((f) => [f.name, f]));
    const { matches } = casarFotos(alvos.map((a) => ({ chave: a.chave, rotulo: a.rotulo })), fotos.map((f) => f.name));
    for (const a of alvos) {
      const manual = fotosManuais.get(a.chave);
      const auto = fileByName.get(matches.find((x) => x.chave === a.chave)?.principal?.arquivo ?? "");
      const file = manual ?? auto;
      if (file) out.set(a.chave, file);
    }
    return out;
  }, [desc, agregado, fotos, fotosManuais]);

  const onTrocarFoto = useCallback((chaveAlvo: string, file: File | null) => {
    setFotosManuais((prev) => { const n = new Map(prev); if (file) n.set(chaveAlvo, file); else n.delete(chaveAlvo); return n; });
  }, []);

  // fotos que não casaram com nenhuma cor (aviso; a foto agora é inline na tabela).
  const fotosOrfas = useMemo<string[]>(() => {
    if (!desc || !agregado || fotos.length === 0) return [];
    const alvos = alvosDeFoto(desc, agregado.entidades);
    const { orfas } = casarFotos(alvos.map((a) => ({ chave: a.chave, rotulo: a.rotulo })), fotos.map((f) => f.name));
    return orfas.map((o) => o.arquivo);
  }, [desc, agregado, fotos]);

  // Patch local de UMA entidade (dropdown corrigido, cor trocada, "mesmo tecido", etc.).
  // Recomputa os `problemas` da linha (revalidar) — senão um erro do resolve inicial persistiria
  // e a linha corrigida seria pulada em silêncio (achado da revisão).
  const onPatch = useCallback((chave: string, patch: Partial<EntidadeAgregada>) => {
    setAgregado((prev) => prev && ({
      ...prev,
      entidades: prev.entidades.map((e) => {
        if (e.chave !== chave) return e;
        const merged = { ...e, ...patch };
        return desc?.revalidar ? { ...merged, problemas: desc.revalidar(merged) } : merged;
      }),
    }));
  }, [desc]);
  const onToggleIgnorar = useCallback((chave: string) => {
    setIgnoradas((prev) => { const n = new Set(prev); n.has(chave) ? n.delete(chave) : n.add(chave); return n; });
  }, []);
  // v1: cadastrar-novo abre a tela de cadastro correspondente numa nova aba (o dono cadastra e
  // reimporta ou troca no dropdown). Refino futuro: dialog inline.
  const onCadastrar = useCallback((tipo: "fornecedor" | "cor" | "categoria", nome: string) => {
    const url = tipo === "fornecedor" ? "/cadastro/servico" : "/cadastro/atributos";
    toast.info(`Cadastre "${nome}" em ${tipo === "fornecedor" ? "Fornecedores" : "Atributos"} e selecione no campo.`);
    window.open(url, "_blank");
  }, []);

  // pendência aberta = campo de cadastro obrigatório não resolvido, ou conflito sem decisão.
  const pendencias = useMemo(() => {
    if (!agregado) return 0;
    return agregado.entidades.filter((e) => {
      if (ignoradas.has(e.chave)) return false;
      const semForn = e.raw.fornecedor?.trim() && !e.cabecalho.empresa_id;
      const conflito = e.estado === "conflito_fornecedor" && e.mesmoTecidoConfirmado == null;
      const corPend = e.variantes.some((v) => !v.cor_id);
      return semForn || conflito || corPend;
    }).length;
  }, [agregado, ignoradas]);

  const onConfirmar = async () => {
    if (!desc || !agregado) return;
    setFase("importando");
    setProgresso({ feito: 0, total: 0 });
    try {
      const aGravar = agregado.entidades.filter((e) => !ignoradas.has(e.chave)) as EntidadeAgregada[];
      const rep = await importar(
        supabase,
        desc,
        aGravar,
        fotosParaEngine,
        (feito, total) => setProgresso({ feito, total }),
      );
      setRelatorio(rep);
      setFase("concluido");
      // invalida as listas que a entidade alimenta (tecido → artigos).
      if (desc.entidade === "tecido") qc.invalidateQueries({ queryKey: ["artigos"] });
      const resumoTxt = `${rep.criados} criado(s), ${rep.complementados} complementado(s), ${rep.soFoto} c/ foto`;
      if (rep.erros === 0) toast.success(resumoTxt + ".");
      else toast.warning(`${resumoTxt}, ${rep.erros} com erro.`);
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
          <div className="space-y-4">
            {/* resumo por estado do upsert */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{resumo.total} item(ns)</Badge>
              {(() => {
                const cont = { novo: 0, complementar: 0, so_foto: 0, conflito_fornecedor: 0 } as Record<string, number>;
                agregado.entidades.forEach((e) => { if (!ignoradas.has(e.chave)) cont[e.estado ?? "novo"] = (cont[e.estado ?? "novo"] ?? 0) + 1; });
                return (
                  <>
                    {cont.novo > 0 && <Badge variant="outline">{cont.novo} novo(s)</Badge>}
                    {cont.complementar > 0 && <Badge variant="outline" className="text-emerald-600 border-emerald-300">{cont.complementar} complementar</Badge>}
                    {cont.so_foto > 0 && <Badge variant="outline" className="text-sky-600 border-sky-300">{cont.so_foto} só foto</Badge>}
                    {cont.conflito_fornecedor > 0 && <Badge variant="outline" className="text-amber-600 border-amber-300">{cont.conflito_fornecedor} conflito</Badge>}
                    {pendencias > 0 && <Badge variant="destructive">{pendencias} pendência(s)</Badge>}
                  </>
                );
              })()}
            </div>

            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              Campos de cadastro são dropdown (vermelho = corrigir; sugestão automática no topo). Role à direita para todos os campos.
            </p>

            <TabelaAnalise
              descriptor={desc!}
              entidades={agregado.entidades as EntidadeAgregada[]}
              opcoes={opcoes}
              arquivos={fotos}
              ignoradas={ignoradas}
              onToggleIgnorar={onToggleIgnorar}
              onPatch={onPatch}
              onCadastrar={onCadastrar}
              fotosManuais={fotosManuais}
              onTrocarFoto={onTrocarFoto}
            />

            {desc?.temFoto && fotosOrfas.length > 0 && (
              <p className="text-xs text-amber-600">
                {fotosOrfas.length} foto(s) não casaram com nenhuma cor: {fotosOrfas.slice(0, 5).join(", ")}{fotosOrfas.length > 5 ? "…" : ""}
              </p>
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
        )}
      </Card>

      <PageActionBar>
        <Button variant="ghost" onClick={resetar}><ArrowLeft className="h-4 w-4 mr-2" /> Recomeçar</Button>
        {fase === "analisado" && agregado && (
          <span className="text-sm text-muted-foreground">
            {agregado.entidades.filter((e) => !ignoradas.has(e.chave)).length} a importar
            {ignoradas.size > 0 && ` · ${ignoradas.size} ignorado(s)`}
            {pendencias > 0 && ` · ${pendencias} pendência(s)`}
          </span>
        )}
        {fase === "analisado" && (
          <Button
            className="ml-auto"
            onClick={onConfirmar}
            disabled={readOnly || !agregado || agregado.entidades.length === 0 || pendencias > 0}
            title={pendencias > 0 ? "Resolva as pendências (campos em vermelho) para confirmar" : undefined}
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
