// Exportar dados — escolhe o TIPO (produto/tecido/aviamento/insumo), o recorte do tipo, as colunas e os níveis, mostra uma PRÉVIA
// (20 itens) e baixa o arquivo (CSV com 1 nível; Excel com 2-3 níveis, 1 aba por nível).
//
// - Esta tela só tem o que é COMUM a todo tipo: seletor de TIPO, colunas (catálogo do tipo), níveis, prévia do menor nível e Baixar.
//   O RECORTE (filtros) e a RPC de cada tipo moram no driver (`./drivers/<tipo>.tsx`, contrato em `./drivers/tipos.ts`).
// - Tipo/colunas/níveis persistem POR USUÁRIO (`useUserPref("export", …)`). Todo valor é string[]: tipo = array de 1 elemento
//   (vazio = "produto"), níveis = ["1","2","3"] (NUNCA number[]). O produto mantém as prefs de sempre (`export`/`integracao`).
// - Ao LER do pref: colunas passam pelas chaves válidas do tipo (chave que saiu do catálogo é ignorada).
// - A prévia mostra as linhas do MENOR nível marcado (1 = pai, 2 = até cor, 3 = até tamanho); o limite da RPC conta ITENS do tipo.
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
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useUserPref } from "@/hooks/useUiPrefs";
import { mensagemErro } from "@/lib/erro-mensagem";
import { baixarExport } from "@/lib/integracao/export";
import { rotulosDoTipo, keysValidasDoTipo } from "@/lib/exportar/campos-por-tipo";
import { driverProduto } from "./drivers/produto";
import { driverTecido } from "./drivers/tecido";
import { driverAviamento } from "./drivers/aviamento";
import { driverInsumo } from "./drivers/insumo";
import { TIPOS_EXPORT, tipoValido, type DriverRecorte, type TipoExport } from "./drivers/tipos";

/** Quantos ITENS a prévia traz (o limite da RPC conta itens do tipo, não linhas). */
const LIMITE_PREVIA = 20;

/** Um driver por tipo do seletor (o `Partial` fica: tipo sem driver mostra o aviso "ainda não está disponível"). */
const DRIVERS: Partial<Record<TipoExport, DriverRecorte>> = {
  produto: driverProduto,
  tecido: driverTecido,
  aviamento: driverAviamento,
  insumo: driverInsumo,
};

/** Aviso do bloco "Campos de variante" quando o driver não define o próprio (o do produto de sempre). */
const AVISO_VARIANTE_PADRAO = "Campos de variante: só têm valor nas linhas de cor e de tamanho (ficam vazios no SKU pai).";

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function ExportarDados() {
  const [tipoPref, setTipoPref] = useUserPref("export", "tipo", "tipo", []);
  const tipo = tipoValido(tipoPref);
  const driver = DRIVERS[tipo];

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div className="grid max-w-xs gap-1">
          <Label htmlFor="exportar-tipo">Tipo</Label>
          <Select value={tipo} onValueChange={(v) => setTipoPref([v])}>
            <SelectTrigger id="exportar-tipo" className="min-w-0 [&>span]:truncate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_EXPORT.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </section>
      {driver ? (
        // key={tipo}: cada tipo monta o PRÓPRIO conjunto de hooks (prefs/queries do recorte) — trocar de tipo troca filtro+colunas+níveis+prévia.
        <ExportarCorpo key={tipo} driver={driver} />
      ) : (
        <p className="text-sm text-muted-foreground">A exportação de {TIPOS_EXPORT.find((t) => t.valor === tipo)?.rotulo.toLowerCase()} ainda não está disponível.</p>
      )}
    </div>
  );
}

function ExportarCorpo({ driver }: { driver: DriverRecorte }) {
  const tenantId = useActiveTenantId();
  const { tipo, catalogo, niveis: niveisDriver, prefScreen } = driver;

  const [colunasPref, setColunasPref] = useUserPref("export", prefScreen, "colunas", []);
  const [niveisPref, setNiveisPref] = useUserPref("export", prefScreen, "niveis", []);

  const recorte = driver.useRecorte();

  const camposComuns = useMemo(() => catalogo.filter((c) => !c.soVariante), [catalogo]);
  const camposVariante = useMemo(() => catalogo.filter((c) => c.soVariante), [catalogo]);
  const rotulos = useMemo(() => rotulosDoTipo(tipo), [tipo]);

  // Colunas: só as chaves do catálogo do tipo (na ordem do catálogo, que é a ordem do arquivo).
  const colunasSel = useMemo(() => catalogo.filter((c) => colunasPref.includes(c.key)).map((c) => c.key), [catalogo, colunasPref]);
  // Níveis: só os do tipo, ordenados.
  const niveisSel = useMemo(() => niveisDriver.map((n) => n.valor).filter((v) => niveisPref.includes(v)), [niveisDriver, niveisPref]);

  const pronto = recorte.escolhido && colunasSel.length > 0 && niveisSel.length > 0;

  // ---- Prévia ----
  const previaQ = useQuery({
    queryKey: ["exportar-previa", tenantId, ...recorte.chave, colunasSel.join(","), niveisSel.join(",")],
    enabled: !!tenantId && pronto && recorte.pronta,
    retry: 1,
    placeholderData: (anterior) => anterior,
    queryFn: () => recorte.chamarRpc(colunasSel, niveisSel, LIMITE_PREVIA),
  });

  // ---- Baixar ----
  const baixar = useMutation({
    mutationFn: async () => {
      const dados = await recorte.chamarRpc(colunasSel, niveisSel, null);
      baixarExport(dados, niveisSel, recorte.nomeBaseArquivo(), {
        rotulos,
        nomeAba: driver.nomeAba,
        keysValidas: keysValidasDoTipo(tipo),
      });
      return dados.total;
    },
    onSuccess: (total) => {
      toast.success(`Arquivo gerado com ${total} ${total === 1 ? driver.item.um : driver.item.varios}.`);
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível exportar.")),
  });

  const alternarColuna = (key: string, marcar: boolean) => {
    const set = new Set(colunasSel);
    if (marcar) set.add(key);
    else set.delete(key);
    setColunasPref(catalogo.filter((c) => set.has(c.key)).map((c) => c.key));
  };
  const alternarNivel = (valor: string, marcar: boolean) => {
    const set = new Set(niveisSel);
    if (marcar) set.add(valor);
    else set.delete(valor);
    setNiveisPref(niveisDriver.map((n) => n.valor).filter((v) => set.has(v)));
  };

  const baixarDesabilitado = !pronto || baixar.isPending;
  const menorNivel = niveisSel[0];
  const previa = previaQ.data;
  const linhasPrevia = previa && menorNivel ? (previa.niveis[menorNivel] ?? []) : [];
  const nomeMenorNivel = niveisDriver.find((n) => n.valor === menorNivel)?.rotulo ?? "";
  const itensMostrados = previa ? Math.min(LIMITE_PREVIA, previa.total) : 0;
  const nNiveis = niveisDriver.length;

  return (
    <div className="grid gap-6">
      {/* 1. Filtros */}
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">1. Recorte</h2>
        {recorte.filtros}
      </section>

      {/* 2. Colunas */}
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">2. Colunas</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {camposComuns.map((c) => (
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
        {camposVariante.length > 0 && (
        <div className="grid gap-2 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            {driver.avisoVariante ?? AVISO_VARIANTE_PADRAO}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {camposVariante.map((c) => (
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
        )}
      </section>

      {/* 3. Níveis */}
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">3. Níveis</h2>
        <div className="grid gap-2">
          {niveisDriver.map((n) => (
            <div key={n.valor} className="flex items-center gap-2">
              <Checkbox
                id={`exportar-nivel-${n.valor}`}
                checked={niveisSel.includes(n.valor)}
                onCheckedChange={(v) => alternarNivel(n.valor, v === true)}
              />
              <label htmlFor={`exportar-nivel-${n.valor}`} className="text-sm">
                {n.rotulo}{n.ajuda && <> <span className="text-xs text-muted-foreground">— {n.ajuda}</span></>}
              </label>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Um nível gera um arquivo CSV; {nNiveis > 2 ? "dois ou três níveis geram" : "dois níveis geram"} um Excel com uma aba por nível.
        </p>
      </section>

      {/* Prévia */}
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">Prévia</h2>
        {!recorte.escolhido ? (
          <p className="text-sm text-muted-foreground">{recorte.avisoSemRecorte}</p>
        ) : colunasSel.length === 0 ? (
          <p className="text-sm text-muted-foreground">Marque ao menos uma coluna.</p>
        ) : niveisSel.length === 0 ? (
          <p className="text-sm text-muted-foreground">Marque ao menos um nível.</p>
        ) : recorte.avisoDependenciaErro ? (
          <p className="text-sm text-muted-foreground">{recorte.avisoDependenciaErro}</p>
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
          <p className="text-sm text-muted-foreground">Nenhum {driver.item.um} neste recorte.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Mostrando {itensMostrados} {itensMostrados === 1 ? driver.item.um : driver.item.varios} de {previa.total} · linhas do nível “{nomeMenorNivel}”
              {niveisSel.length > 1 ? " (o arquivo traz também os outros níveis marcados)" : ""}
            </p>
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {previa.colunas.map((k) => (
                      <TableHead key={k} className="whitespace-nowrap">{rotulos.get(k) ?? k}</TableHead>
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
