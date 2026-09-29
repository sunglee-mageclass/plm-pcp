import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { InfoHover } from "@/components/shared/InfoHover";
import {
  canonico, chaveSeparador, corNoNomeEfetiva, normalizarSkuConfig, normalizarTamanhosSku, resolverSku, textoAviso, textoFalta,
  COR_NO_NOME, SKU_PARTES, SKU_PARTE_LABEL, SKU_SEP_CHARS, SKU_SEP_MAX,
  type CorNoNome, type SkuConfig, type SkuCor, type SkuParte,
} from "@/lib/sku-montar";
import { nomeSublinha } from "@/lib/integracao/nome-sublinha";
import { chaveLista } from "@/components/integracao/useIntegracao";
import { ladoTamanho, type TamanhoTipo } from "@/lib/tamanho";

// Card "Formato do SKU" (Config da Loja, logo abaixo do "Formato da REF") — F3.5a, spec SKU §4.3.
// Grava SÓ `tenant_config.sku_config`, num `update` da coluna, com o SEU botão (não entra no upsert genérico da
// página — lição RP3 da F2: uma aba velha não sobrescreve o Formato; e se outra pessoa mudou o Formato depois que a
// tela abriu, o salvar recusa). O servidor valida/canoniza de novo (gatilho) com as MESMAS regras de
// `normalizarSkuConfig`. A prévia usa `resolverSku` (espelho byte a byte do SQL) com um exemplo REAL da loja.

type Rascunho = { partes: SkuParte[]; separadores: Record<string, string>; corNoNome: CorNoNome };
const rascunhoDe = (cfg: SkuConfig | null): Rascunho => ({
  partes: cfg ? [...cfg.partes] : [],
  separadores: cfg ? { ...cfg.separadores } : {},
  // P-126 (dono 29/set): semeia da escolha EFETIVA (chave explícita; senão derivada das partes) — nunca dirty falso.
  corNoNome: corNoNomeEfetiva(cfg),
});
/** Forma canônica p/ COMPARAR (dirty / concorrência): a chave `cor_no_nome` SEMPRE explícita como a escolha EFETIVA
 *  (nunca a crua) — assim um `sku_config` gravado sem a chave (padrão derivado) e o mesmo valor escolhido no rádio
 *  comparam IGUAIS (sem dirty falso), dos dois lados (base carregada do servidor E rascunho do usuário). */
const paraComparar = (cfg: SkuConfig | null) => ({
  partes: cfg?.partes ?? [], separadores: cfg?.separadores ?? {}, cor_no_nome: corNoNomeEfetiva(cfg),
});
// F3.6 (dono 25/set, R10): SEM padrão da loja — o "Tamanho em" é escolhido em CADA card; a prévia mostra as 2 formas.
const TIPOS_PREVIA: { tipo: TamanhoTipo; rotulo: string }[] = [{ tipo: "letra", rotulo: "Letra" }, { tipo: "numero", rotulo: "Número" }];
// P-126: "Cor no nome da sublinha (Integração)" — rótulo do rádio nativo (padrão do "Tamanho em" da CodigosSecao).
const COR_NO_NOME_LABEL: Record<CorNoNome, string> = { cor_base: "Cor base", cor_apelido: "Apelido" };
const TEXTO_COR_NO_NOME_INFO =
  "Na Integração e na API, cada sublinha se chama Nome do produto + cor + tamanho (ex.: Vestido Suelen Preto PPP). Escolha se entra o nome da Cor base ou do Apelido. Variante sem apelido usa a cor base; sem cor, fica só o tamanho. Vale para o que for marcado como Integrável a partir de agora — os já integráveis/integrados mantêm o nome do retrato.";

type Exemplo = { ref: string | null; nome: string | null; cor: SkuCor | null; apelido: SkuCor | null };

export function FormatoSkuCard({ paginaSuja }: { paginaSuja?: boolean } = {}) {
  const qc = useQueryClient();
  const tenantId = useActiveTenantId();
  const chave = ["tenant-config-sku", tenantId];

  const { data, isSuccess, isError, refetch, isRefetching } = useQuery({
    queryKey: chave,
    enabled: !!tenantId,
    queryFn: async () => {
      const { data: row, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      const r = row as any;
      const cfg = normalizarSkuConfig(r?.sku_config ?? null);
      const ts = normalizarTamanhosSku(r?.tamanhos_sku ?? null);
      return {
        cfg: cfg.ok ? cfg.valor : null,
        tamanhosSku: ts.ok ? ts.valor : null,
        grade: Array.isArray(r?.tamanhos_grade) ? (r.tamanhos_grade as string[]) : [],
      };
    },
  });

  // Exemplo REAL da loja p/ a prévia: a REF mais recente + a 1ª cor base com sigla (senão a 1ª) + um apelido dela.
  const { data: ex } = useQuery({
    queryKey: ["tenant-sku-exemplo", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<Exemplo> => {
      const [m, cores, apelidos] = await Promise.all([
        supabase.from("modelos").select("ref, nome").eq("tenant_id", tenantId).not("ref", "is", null).neq("ref", "")
          .order("created_at", { ascending: false }).limit(1),
        supabase.from("cores").select("*").order("nome"),
        supabase.from("cores_apelido").select("*").order("nome"),
      ]);
      if (m.error) throw m.error;
      if (cores.error) throw cores.error;
      if (apelidos.error) throw apelidos.error;
      const lista = (cores.data ?? []) as any[];
      const cor = lista.find((c) => !!c.sigla_sku) ?? lista[0] ?? null;
      const daCor = ((apelidos.data ?? []) as any[]).filter((a) => cor && a.cor_base_id === cor.id);
      const ape = daCor.find((a) => !!a.sigla_sku) ?? daCor[0] ?? null;
      const comoCor = (x: any): SkuCor | null => (x ? { id: x.id, nome: x.nome, sigla: x.sigla_sku ?? null } : null);
      const modelo = (m.data?.[0] as any) ?? null;
      return { ref: modelo?.ref ?? null, nome: modelo?.nome ?? null, cor: comoCor(cor), apelido: comoCor(ape) };
    },
  });

  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoDe(null));
  const [base, setBase] = useState<SkuConfig | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  // Sempre grava a chave explícita `cor_no_nome` (mesmo p/ loja sem formato — {partes:[],separadores:{},cor_no_nome}).
  const cru = { partes: rascunho.partes, separadores: rascunho.separadores, cor_no_nome: rascunho.corNoNome };
  const norm = normalizarSkuConfig(cru);
  const dirty = isSuccess && canonico(norm.ok ? paraComparar(norm.valor) : cru) !== canonico(paraComparar(base));
  const { confirm } = useUnsavedGuard({ dirty, blockNav: true });
  // Sem isSuccess ainda (carregando OU erro), os controles ficam travados: evita `dirty` prematuro
  // contra um rascunho vazio (e o falso "Outra pessoa mudou o Formato do SKU..." que isso geraria no save).
  const travado = !isSuccess;

  // Semeia do servidor só SEM edição pendente (o salvar geral da página invalida esta query — não pode apagar o rascunho).
  const servidorCanon = canonico(data?.cfg ?? null);
  useEffect(() => {
    if (!isSuccess || dirty) return;
    setRascunho(rascunhoDe(data?.cfg ?? null));
    setBase(data?.cfg ?? null);
  }, [servidorCanon, isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const marcadas = new Set(rascunho.partes);
  const alternar = (p: SkuParte, on: boolean) =>
    setRascunho((r) => ({ ...r, partes: on ? [...r.partes, p] : r.partes.filter((x) => x !== p) }));
  const mover = (i: number, d: -1 | 1) =>
    setRascunho((r) => {
      const j = i + d;
      if (j < 0 || j >= r.partes.length) return r;
      const partes = [...r.partes];
      [partes[i], partes[j]] = [partes[j], partes[i]];
      return { ...r, partes };
    });
  const setSep = (k: string, v: string) =>
    setRascunho((r) => ({ ...r, separadores: { ...r.separadores, [k]: v.replace(/[^-._/]/g, "") } }));
  const setCorNoNome = (v: CorNoNome) => setRascunho((r) => ({ ...r, corNoNome: v }));

  const salvar = useMutation({
    mutationFn: async () => {
      // P-126: grava SEMPRE a chave explícita `cor_no_nome` — mesmo p/ loja sem formato (`partes` vazio), pra ela
      // ter onde guardar a escolha (o normalizador devolve `{partes:[],separadores:{},cor_no_nome}` neste caso).
      const n = normalizarSkuConfig(cru);
      if (!n.ok) throw new Error(n.erro);
      const { data: agora, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      const noBanco = normalizarSkuConfig((agora as any)?.sku_config ?? null);
      if (canonico(paraComparar(noBanco.ok ? noBanco.valor : null)) !== canonico(paraComparar(base))) {
        throw new Error("Outra pessoa mudou o Formato do SKU enquanto você editava. Recarregue a página para ver a versão atual.");
      }
      const { data: gravou, error: e2 } = await supabase
        .from("tenant_config")
        .update({ sku_config: n.valor } as any)
        .eq("tenant_id", tenantId)
        .select("tenant_id");
      if (e2) throw e2;
      if (!gravou?.length) throw new Error("Sem permissão para salvar o Formato do SKU (só o admin da loja).");
      return n.valor;
    },
    onSuccess: (valor) => {
      setRascunho(rascunhoDe(valor));
      setBase(valor);
      qc.setQueryData(chave, (old: any) => (old ? { ...old, cfg: valor } : old));
      // P-126: a lista da Integração mostra o nome da sublinha com a cor — invalidar pra refletir a escolha nova.
      void qc.invalidateQueries({ queryKey: chaveLista(tenantId) });
      setConfirmar(false);
      toast.success("Formato do SKU salvo.");
    },
    onError: (e: unknown) => {
      setConfirmar(false);
      toast.error(mensagemErro(e, "Erro ao salvar o Formato do SKU."));
    },
  });

  // Prévia ao vivo (mesma função do servidor, em TS): com apelido e sem apelido.
  // Quando a loja não tem grade cadastrada, o tamanho é FICTÍCIO ("34|PPP") — nesse caso as siglas
  // também têm de ser fictícias (não as `tamanhosSku` REAIS da loja, que não têm entrada pra ele; senão
  // a prévia de uma loja sem grade mostraria "Falta sigla: Tamanho PPP" por engano).
  const usaGradeFicticia = !data?.grade?.length;
  const grade0 = data?.grade?.[0] ?? "34|PPP";
  const tamanhosSkuPrevia = usaGradeFicticia ? { "34": "34", PPP: "PPP" } : (data?.tamanhosSku ?? null);
  const corExemploFicticia: SkuCor = { id: "exemplo", nome: "Amarelo", sigla: "AM" };
  const corPrevia = ex?.cor ?? corExemploFicticia;
  const corRotulo = ex?.cor ? corPrevia.nome : `${corPrevia.nome} (cor de exemplo)`;
  const previa = (apelido: SkuCor | null, tipo: TamanhoTipo) =>
    norm.ok && norm.valor
      ? resolverSku({
          cfg: norm.valor,
          ref: ex?.ref ?? "REF00000001",
          cor: corPrevia,
          apelido,
          tamanhoKey: grade0,
          tipo,
          tamanhosSku: tamanhosSkuPrevia,
        })
      : null;
  const exemplos = TIPOS_PREVIA.flatMap(({ tipo, rotulo }) => [
    { rotulo: `${corRotulo}${ex?.apelido ? ` · ${ex.apelido.nome}` : ""} · ${grade0} · Tamanho em ${rotulo}`, r: previa(ex?.apelido ?? null, tipo) },
    ...(ex?.apelido ? [{ rotulo: `${corRotulo} (sem apelido) · ${grade0} · Tamanho em ${rotulo}`, r: previa(null, tipo) }] : []),
  ]);

  // P-126: prévia do NOME DA SUBLINHA (Integração/API) — nome do produto mais recente da loja (ou "Produto Exemplo",
  // sem nenhum ainda) + a cor de exemplo/real + o tamanho pelo LADO Letra (`ladoTamanho`).
  const nomeProdutoPrevia = ex?.nome || "Produto Exemplo";
  const tamanhoPreviaNome = ladoTamanho(grade0, "letra") ?? grade0;
  const nomeSublinhaPrevia = nomeSublinha(nomeProdutoPrevia, corPrevia.nome, ex?.apelido?.nome ?? null, tamanhoPreviaNome, rascunho.corNoNome);
  const nomeSublinhaPreviaSemApelido = ex?.apelido
    ? nomeSublinha(nomeProdutoPrevia, corPrevia.nome, null, tamanhoPreviaNome, rascunho.corNoNome)
    : null;

  return (
    <Card data-secao="formato-sku">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Formato do SKU</CardTitle>
          <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
        </div>
        <CardDescription>
          Como o SKU de cada variante × tamanho é montado a partir da REF e das siglas de Cor base, Cor apelido e
          Tamanho (Cadastro › Atributos). Salva só este bloco, no botão abaixo. Sem nenhuma parte marcada, a loja não
          gera SKU.
        </CardDescription>
      </CardHeader>
      {isError ? (
        <CardContent className="space-y-3">
          <p className="text-sm text-destructive">Não foi possível carregar o formato do SKU.</p>
          <Button type="button" variant="outline" disabled={isRefetching} onClick={() => refetch()}>
            {isRefetching ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Tentar de novo
          </Button>
        </CardContent>
      ) : (
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Montagem do SKU</p>
          <p className="text-xs text-muted-foreground">
            Marque as partes e ordene com as setas. Entre duas partes, um separador opcional (até {SKU_SEP_MAX}
            caracteres, só {SKU_SEP_CHARS}; vazio = colado).
          </p>
          <ul className="space-y-1.5">
            {rascunho.partes.map((p, i) => (
              <li key={p} className="space-y-1.5">
                <div className="flex items-center gap-3 rounded-md border bg-card p-2">
                  <Checkbox checked disabled={travado} onCheckedChange={(v) => alternar(p, !!v)} aria-label={`Usar "${SKU_PARTE_LABEL[p]}" no SKU`} />
                  <span
                    className={`flex-1 text-sm ${travado ? "" : "cursor-pointer select-none"}`}
                    onClick={() => { if (!travado) alternar(p, false); }}
                  >
                    {SKU_PARTE_LABEL[p]}
                  </span>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={travado || i === 0}
                    onClick={() => mover(i, -1)} aria-label={`Mover "${SKU_PARTE_LABEL[p]}" para cima`}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={travado || i === rascunho.partes.length - 1}
                    onClick={() => mover(i, 1)} aria-label={`Mover "${SKU_PARTE_LABEL[p]}" para baixo`}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {i < rascunho.partes.length - 1 && (
                  <div className="flex items-center gap-2 pl-8">
                    <Label className="text-xs font-normal text-muted-foreground">
                      Separador entre {SKU_PARTE_LABEL[p]} e {SKU_PARTE_LABEL[rascunho.partes[i + 1]]}
                    </Label>
                    <Input
                      className="h-8 w-16 font-mono max-md:h-11"
                      aria-label={`Separador entre ${SKU_PARTE_LABEL[p]} e ${SKU_PARTE_LABEL[rascunho.partes[i + 1]]}`}
                      maxLength={SKU_SEP_MAX}
                      placeholder="—"
                      disabled={travado}
                      value={rascunho.separadores[chaveSeparador(p, rascunho.partes[i + 1])] ?? ""}
                      onChange={(e) => setSep(chaveSeparador(p, rascunho.partes[i + 1]), e.target.value)}
                    />
                  </div>
                )}
              </li>
            ))}
            {SKU_PARTES.filter((p) => !marcadas.has(p)).map((p) => (
              <li key={p} className="flex items-center gap-3 rounded-md border border-dashed p-2">
                <Checkbox checked={false} disabled={travado} onCheckedChange={(v) => alternar(p, !!v)} aria-label={`Usar "${SKU_PARTE_LABEL[p]}" no SKU`} />
                <span
                  className={`flex-1 text-sm text-muted-foreground ${travado ? "" : "cursor-pointer select-none"}`}
                  onClick={() => { if (!travado) alternar(p, true); }}
                >
                  {SKU_PARTE_LABEL[p]}
                </span>
              </li>
            ))}
          </ul>
          {rascunho.partes.length > 0 && !marcadas.has("ref") && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Sem a REF, o mesmo SKU pode se repetir entre produtos — o sistema recusa o repetido.
            </p>
          )}
        </div>

        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prévia</p>
          <p className="text-xs text-muted-foreground">
            Exemplo com {ex?.ref ? `a REF ${ex.ref}` : "uma REF de exemplo"}, {ex?.cor ? `a cor ${ex.cor.nome}` : `a cor de exemplo (${corPrevia.nome})`}
            {" "}e {usaGradeFicticia ? "um tamanho de exemplo" : "o 1º tamanho da grade"} ({grade0}). O &#8220;Tamanho em&#8221;
            (Letra ou Número) é escolhido em cada card — obrigatório para gerar os SKUs; a prévia mostra as duas formas.
          </p>
          {!norm.ok ? (
            <p className="text-sm text-destructive">{norm.erro}</p>
          ) : !norm.valor || norm.valor.partes.length === 0 ? (
            // P-126: "sem formato" agora inclui `{partes:[],separadores:{},cor_no_nome}` — a loja que só escolheu a
            // cor do nome (sem marcar nenhuma parte do SKU) continua sem gerar SKU.
            <p className="text-sm text-muted-foreground">Nenhuma parte marcada: a loja não gera SKU.</p>
          ) : (
            <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
              {exemplos.map((e) => (
                <div key={e.rotulo} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{e.rotulo}</span>
                  {e.r?.sku ? (
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      <span className="font-mono text-sm tabular-nums" data-sku-previa>{e.r.sku}</span>
                      {e.r.avisos.length > 0 && (
                        // D4: apelido sem sigla não bloqueia — o SKU sai com a cor base; o aviso pede a sigla
                        <span className="text-xs text-amber-700 dark:text-amber-300">
                          {e.r.avisos.map(textoAviso).join(" · ")} —{" "}
                          <Link to="/cadastro/atributos" className="underline">cadastrar</Link>
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-700 dark:text-amber-300">
                      {(e.r?.faltas ?? []).map(textoFalta).join(" · ") || "SKU vazio"} —{" "}
                      <Link to="/cadastro/atributos" className="underline">cadastrar</Link>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t pt-4" role="radiogroup" aria-labelledby="formato-sku-cor-no-nome" data-secao="cor-no-nome">
          <div className="flex items-center gap-1">
            <Label id="formato-sku-cor-no-nome" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cor no nome da sublinha (Integração)
            </Label>
            <InfoHover ariaLabel="Como a cor entra no nome da sublinha">{TEXTO_COR_NO_NOME_INFO}</InfoHover>
          </div>
          <div className="flex min-h-9 items-center gap-4 text-sm">
            {COR_NO_NOME.map((v) => (
              <label key={v} className="flex cursor-pointer items-center gap-1.5 max-sm:min-h-11">
                <input
                  type="radio"
                  name="formato-sku-cor-no-nome"
                  value={v}
                  className="h-4 w-4 accent-primary"
                  checked={rascunho.corNoNome === v}
                  disabled={travado}
                  onChange={() => setCorNoNome(v)}
                />
                {COR_NO_NOME_LABEL[v]}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Exemplo: {nomeSublinhaPrevia ?? "—"}
          </p>
          {nomeSublinhaPreviaSemApelido && (
            <p className="text-xs text-muted-foreground">sem apelido: {nomeSublinhaPreviaSemApelido}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Os SKUs já gerados não mudam sozinhos: só pelo "Regerar SKUs" do card (os editados à mão nunca mudam).
          </p>
          {paginaSuja && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Salve ou descarte as outras alterações da página antes.
            </p>
          )}
          <Button
            type="button"
            className="ml-auto shrink-0"
            disabled={travado || !dirty || !norm.ok || salvar.isPending || !!paginaSuja}
            onClick={() => setConfirmar(true)}
          >
            {salvar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar formato do SKU
          </Button>
        </div>
      </CardContent>
      )}

      {confirmar && (
        <AlertDialog open onOpenChange={(o) => { if (!o && !salvar.isPending) setConfirmar(false); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Salvar o Formato do SKU?</AlertDialogTitle>
              <AlertDialogDescription>
                Vale para os SKUs gerados a partir de agora, em todos os produtos da loja. Os SKUs já gerados NÃO mudam
                sozinhos — só pelo botão "Regerar SKUs" no card (e os editados à mão nunca mudam). A cor no nome da
                sublinha (Integração) vale para o que for marcado como Integrável a partir de agora — os já
                integráveis/integrados mantêm o nome do retrato.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={salvar.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); salvar.mutate(); }} disabled={salvar.isPending}>
                {salvar.isPending ? "Salvando…" : "Salvar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <UnsavedChangesGuard confirm={confirm} message="O Formato do SKU tem alterações não salvas." />
    </Card>
  );
}
