// Integração — aba Exportar (Exportar dados): escolhe Coleção/Subcoleção, colunas e níveis, mostra uma PRÉVIA (20 produtos) e baixa
// o arquivo (CSV com 1 nível; Excel com 2-3 níveis, 1 aba por nível).
//
// - Filtros/colunas/níveis persistem POR USUÁRIO (`useUserPref("export", "integracao", chave, string[])`). Todo valor é string[]:
//   coleção/subcoleção = array de 1 elemento (ou vazio), níveis = ["1","2","3"] (NUNCA number[]).
// - "Todas as coleções" é uma ESCOLHA EXPLÍCITA (valor sentinela guardado no pref da coleção; a RPC recebe `_colecao: null` = loja
//   inteira, sem aviso de tamanho). 3 estados: (a) nada escolhido = Baixar desabilitado e nada é consultado; (b) "Todas" = libera
//   (subcoleção fica desabilitada/“Todas”, pois subcoleção é POR coleção); (c) uma coleção específica. O vazio NUNCA vira "todas".
// - Ao LER do pref: colunas passam por KEYS_VALIDAS (chave que saiu do catálogo é ignorada); coleção/subcoleção só valem se ainda
//   existirem nas listas carregadas do servidor (senão contam como "não escolhida"/"todas" — nunca mandam texto velho ao RPC).
// - A prévia mostra as linhas do MENOR nível marcado (1 = pai, 2 = até cor, 3 = até tamanho); o limite da RPC conta PRODUTOS.
// - O botão Baixar chama a RPC SEM limite e usa `baixarExport` (a geração do arquivo mora em `@/lib/integracao/export`).
import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useUserPref } from "@/hooks/useUiPrefs";
import { mensagemErro } from "@/lib/erro-mensagem";
import { CAMPO_EXPORT_BY_KEY, CAMPOS_EXPORT, KEYS_VALIDAS } from "@/lib/integracao/campos-export";
import { baixarExport, type DadosExport } from "@/lib/integracao/export";
import { buscarOpcoesColecao } from "@/lib/opcoes-colecao";

/** Quantos PRODUTOS a prévia traz (o limite da RPC conta produtos, não linhas). */
const LIMITE_PREVIA = 20;
/** Valor do item "Todas" no Select da subcoleção (Radix não aceita value vazio). */
const TODAS = "__todas__";
/** Valor do item "Todas as coleções" no Select da coleção (escolha explícita; distinto do estado vazio = nada escolhido). */
const TODAS_COLECOES = "__todas_colecoes__";

const NIVEIS: { valor: string; rotulo: string; ajuda: string }[] = [
  { valor: "1", rotulo: "SKU pai", ajuda: "1 linha por produto" },
  { valor: "2", rotulo: "Até cor", ajuda: "o pai e 1 linha por cor" },
  { valor: "3", rotulo: "Até tamanho", ajuda: "o pai e 1 linha por cor × tamanho" },
];

type RespostaExport = DadosExport & { total: number };

const CAMPOS_COMUNS = CAMPOS_EXPORT.filter((c) => !c.soVariante);
const CAMPOS_VARIANTE = CAMPOS_EXPORT.filter((c) => c.soVariante);

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function lerSubcolecoes(data: unknown): string[] {
  return Array.isArray(data) ? data.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

async function chamarExportar(
  colecao: string | null, // null = todas as coleções (loja inteira)
  subcolecao: string | null,
  campos: string[],
  niveis: string[],
  limite: number | null,
): Promise<RespostaExport> {
  const { data, error } = await supabase.rpc("exportar_produtos" as any, {
    _colecao: colecao,
    _subcolecao: subcolecao,
    _campos: campos,
    _niveis: niveis,
    _limite: limite,
  });
  if (error) throw error;
  const d = (data ?? {}) as Partial<RespostaExport>;
  return {
    colunas: Array.isArray(d.colunas) ? d.colunas : [],
    total: typeof d.total === "number" ? d.total : 0,
    niveis: d.niveis && typeof d.niveis === "object" ? d.niveis : {},
  };
}

export function ExportarDados() {
  const tenantId = useActiveTenantId();

  const [colecaoPref, setColecaoPref] = useUserPref("export", "integracao", "colecao", []);
  const [subPref, setSubPref] = useUserPref("export", "integracao", "subcolecao", []);
  const [colunasPref, setColunasPref] = useUserPref("export", "integracao", "colunas", []);
  const [niveisPref, setNiveisPref] = useUserPref("export", "integracao", "niveis", []);

  // Colunas: só as chaves do catálogo (na ordem do catálogo, que é a ordem do arquivo).
  const colunasSel = useMemo(
    () => CAMPOS_EXPORT.filter((c) => KEYS_VALIDAS.has(c.key) && colunasPref.includes(c.key)).map((c) => c.key),
    [colunasPref],
  );
  // Níveis: só "1" | "2" | "3", ordenados.
  const niveisSel = useMemo(() => NIVEIS.map((n) => n.valor).filter((v) => niveisPref.includes(v)), [niveisPref]);

  // ---- Coleção (lista da loja) ----
  const colecoesQ = useQuery({
    queryKey: ["exportar-colecoes", tenantId],
    enabled: !!tenantId,
    retry: 1,
    queryFn: async () => (await buscarOpcoesColecao()).colecoes,
  });
  const colecoes = colecoesQ.data;
  // Só vale a coleção salva que ainda existe na lista (lista ainda não chegou = sem coleção, nada é consultado).
  const colecao = colecoes && colecaoPref[0] && colecoes.includes(colecaoPref[0]) ? colecaoPref[0] : "";
  // "Todas as coleções" só vale com a lista carregada e não vazia (mesmo critério do Select habilitado); vazio/inválido NÃO vira "todas".
  const todasColecoes = !!colecoes && colecoes.length > 0 && colecaoPref[0] === TODAS_COLECOES;
  const colecaoEscolhida = colecao !== "" || todasColecoes;
  /** O que vai para a RPC: null só quando "Todas" foi escolhida; senão a coleção específica. */
  const colecaoRpc: string | null = todasColecoes ? null : colecao;

  // ---- Subcoleção (dependente da coleção escolhida) ----
  const subsQ = useQuery({
    queryKey: ["exportar-subcolecoes", tenantId, colecao],
    enabled: !!tenantId && !!colecao && !todasColecoes,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("exportar_subcolecoes" as any, { _colecao: colecao });
      if (error) throw error;
      return lerSubcolecoes(data);
    },
  });
  const subcolecoes = subsQ.data;
  // Subcoleção salva que não existe nesta coleção = "todas" (nunca manda texto velho ao servidor).
  const subcolecao = subcolecoes && subPref[0] && subcolecoes.includes(subPref[0]) ? subPref[0] : null;
  // Enquanto a lista de subcoleções não chegou, a prévia espera (senão consultaria com a subcoleção errada).
  const subsPronta = !colecao || todasColecoes || subsQ.isSuccess;

  const pronto = colecaoEscolhida && colunasSel.length > 0 && niveisSel.length > 0;

  // ---- Prévia ----
  const previaQ = useQuery({
    queryKey: ["exportar-previa", tenantId, todasColecoes ? "__todas_colecoes__" : colecao, subcolecao, colunasSel.join(","), niveisSel.join(",")],
    enabled: !!tenantId && pronto && subsPronta,
    retry: 1,
    placeholderData: (anterior) => anterior,
    queryFn: () => chamarExportar(colecaoRpc, subcolecao, colunasSel, niveisSel, LIMITE_PREVIA),
  });

  // ---- Baixar ----
  const baixar = useMutation({
    mutationFn: async () => {
      const dados = await chamarExportar(colecaoRpc, subcolecao, colunasSel, niveisSel, null);
      baixarExport(dados, niveisSel, `export-${colecaoRpc ?? "todas-as-colecoes"}-${subcolecao ?? "todas"}`);
      return dados.total;
    },
    onSuccess: (total) => {
      toast.success(`Arquivo gerado com ${total} ${total === 1 ? "produto" : "produtos"}.`);
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível exportar.")),
  });

  const alternarColuna = (key: string, marcar: boolean) => {
    const set = new Set(colunasSel);
    if (marcar) set.add(key);
    else set.delete(key);
    setColunasPref(CAMPOS_EXPORT.filter((c) => set.has(c.key)).map((c) => c.key));
  };
  const alternarNivel = (valor: string, marcar: boolean) => {
    const set = new Set(niveisSel);
    if (marcar) set.add(valor);
    else set.delete(valor);
    setNiveisPref(NIVEIS.map((n) => n.valor).filter((v) => set.has(v)));
  };
  const trocarColecao = (v: string) => {
    setColecaoPref([v]);
    setSubPref([]); // a subcoleção é DA coleção: trocar a coleção (ou escolher "Todas as coleções") volta para "todas"
  };

  const baixarDesabilitado = !pronto || baixar.isPending;
  const menorNivel = niveisSel[0];
  const previa = previaQ.data;
  const linhasPrevia = previa && menorNivel ? (previa.niveis[menorNivel] ?? []) : [];
  const nomeMenorNivel = NIVEIS.find((n) => n.valor === menorNivel)?.rotulo ?? "";
  const produtosMostrados = previa ? Math.min(LIMITE_PREVIA, previa.total) : 0;

  return (
    <div className="grid gap-6">
      {/* 1. Filtros */}
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">1. Recorte</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="exportar-colecao">Coleção</Label>
            <Select value={todasColecoes ? TODAS_COLECOES : colecao || undefined} onValueChange={trocarColecao} disabled={!colecoes || colecoes.length === 0}>
              <SelectTrigger id="exportar-colecao" className="min-w-0 [&>span]:truncate">
                <SelectValue placeholder={colecoesQ.isPending ? "Carregando…" : "Escolha uma coleção"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS_COLECOES}>Todas as coleções</SelectItem>
                {(colecoes ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            {colecoesQ.isError && (
              <p className="text-xs text-destructive">
                Não foi possível carregar as coleções.{" "}
                <button type="button" className="underline" onClick={() => void colecoesQ.refetch()}>Tentar de novo</button>
              </p>
            )}
            {colecoes && colecoes.length === 0 && (
              <p className="text-xs text-muted-foreground">Esta loja ainda não tem coleções.</p>
            )}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="exportar-subcolecao">Subcoleção</Label>
            <Select
              value={subcolecao ?? TODAS}
              onValueChange={(v) => setSubPref(v === TODAS ? [] : [v])}
              disabled={!colecao || todasColecoes || !subcolecoes}
            >
              <SelectTrigger id="exportar-subcolecao" className="min-w-0 [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas</SelectItem>
                {(subcolecoes ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {subsQ.isError && (
              <p className="text-xs text-destructive">
                Não foi possível carregar as subcoleções.{" "}
                <button type="button" className="underline" onClick={() => void subsQ.refetch()}>Tentar de novo</button>
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 2. Colunas */}
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">2. Colunas</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CAMPOS_COMUNS.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <Checkbox
                id={`exportar-col-${c.key}`}
                checked={colunasSel.includes(c.key)}
                onCheckedChange={(v) => alternarColuna(c.key, v === true)}
              />
              <label htmlFor={`exportar-col-${c.key}`} className="text-sm">{c.rotulo}</label>
            </div>
          ))}
        </div>
        <div className="grid gap-2 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            Campos de variante: só têm valor nas linhas de cor e de tamanho (ficam vazios no SKU pai).
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CAMPOS_VARIANTE.map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <Checkbox
                  id={`exportar-col-${c.key}`}
                  checked={colunasSel.includes(c.key)}
                  onCheckedChange={(v) => alternarColuna(c.key, v === true)}
                />
                <label htmlFor={`exportar-col-${c.key}`} className="text-sm">{c.rotulo}</label>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Níveis */}
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">3. Níveis</h2>
        <div className="grid gap-2">
          {NIVEIS.map((n) => (
            <div key={n.valor} className="flex items-center gap-2">
              <Checkbox
                id={`exportar-nivel-${n.valor}`}
                checked={niveisSel.includes(n.valor)}
                onCheckedChange={(v) => alternarNivel(n.valor, v === true)}
              />
              <label htmlFor={`exportar-nivel-${n.valor}`} className="text-sm">
                {n.rotulo} <span className="text-xs text-muted-foreground">— {n.ajuda}</span>
              </label>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Um nível gera um arquivo CSV; dois ou três níveis geram um Excel com uma aba por nível.
        </p>
      </section>

      {/* Prévia */}
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">Prévia</h2>
        {!colecaoEscolhida ? (
          <p className="text-sm text-muted-foreground">Escolha uma coleção (ou “Todas as coleções”) para ver a prévia.</p>
        ) : colunasSel.length === 0 ? (
          <p className="text-sm text-muted-foreground">Marque ao menos uma coluna.</p>
        ) : niveisSel.length === 0 ? (
          <p className="text-sm text-muted-foreground">Marque ao menos um nível.</p>
        ) : subsQ.isError ? (
          <p className="text-sm text-muted-foreground">Carregue as subcoleções para ver a prévia.</p>
        ) : previaQ.isError ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-destructive">{mensagemErro(previaQ.error, "Não foi possível carregar a prévia.")}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void previaQ.refetch()} disabled={previaQ.isFetching}>
              {previaQ.isFetching ? "Tentando…" : "Tentar de novo"}
            </Button>
          </div>
        ) : !previa ? (
          <p className="text-sm text-muted-foreground">Carregando a prévia…</p>
        ) : previa.total === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum produto neste recorte.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Mostrando {produtosMostrados} {produtosMostrados === 1 ? "produto" : "produtos"} de {previa.total} · linhas do nível “{nomeMenorNivel}”
              {niveisSel.length > 1 ? " (o arquivo traz também os outros níveis marcados)" : ""}
            </p>
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {previa.colunas.map((k) => (
                      <TableHead key={k} className="whitespace-nowrap">{CAMPO_EXPORT_BY_KEY.get(k)?.rotulo ?? k}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhasPrevia.map((l, i) => (
                    <TableRow key={i}>
                      {previa.colunas.map((k) => (
                        <TableCell key={k} className="max-w-64 truncate" title={texto(l[k])}>{texto(l[k])}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>

      <div>
        <Button type="button" onClick={() => baixar.mutate()} disabled={baixarDesabilitado}>
          <Download className="mr-2 h-4 w-4" />
          {baixar.isPending ? "Gerando…" : "Baixar"}
        </Button>
      </div>
    </div>
  );
}
