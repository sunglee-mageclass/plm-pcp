// Distribuição por produto — dialog "Distribuir por loja" (spec §5.3, R8–R13, R18–R19, R32–R33). Rascunho LOCAL: o
// "Salvar" daqui aplica no card (onSalvar → funil `patch` do PlanTecidoSheet: normalização, dirty, touched, colab) e grava
// de vez no Salvar do plano. Presença: o Dialog é portal — o ColabPresenceOverlay do <main> não alcança o conteúdo, então
// este monta o SEU (scope = corpo rolável); o foco chega ao canal pelo onFocusCapture do <main> (evento React atravessa portal).
//
// Ruling do controlador (revisão T5/M1): o fieldset (disabled=readOnly) do SheetContent do Plan. Tecido (modo só-leitura
// da PÁGINA) desabilita qualquer <button> nativo dentro dele — inclusive o gatilho "Distribuir por loja" do ModelCard. A
// spec pede "ver e imprimir sem permissão": por isso este dialog NÃO usa esse elemento HTML aqui (o só-leitura vem de
// `readOnly` em cada campo/ação) e o GATILHO no ModelCard usa `role="button"` (não `<button>`) — mesmo padrão já usado
// em `ImagePreview.tsx` para escapar de um fieldset ancestral.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Printer, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import type { PresencaColab } from "@/hooks/useColabRegistro";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InfoHover } from "@/components/shared/InfoHover";
import { PrintArea } from "@/components/shared/PrintArea";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { printWithImages } from "@/lib/print";
import { varKey } from "@/lib/plan-tecido/calc";
import { ehTecido1, igual } from "@/lib/plan-tecido/atendimento";
import type { PtSlot, PtVariante } from "@/lib/plan-tecido/types";
import {
  TEXTO_AJUDA_DIST, chaveSlot, definirBase, definirCelula, definirProporcao, normalizarDistribuicao, pathDistAberto,
  pathEhDoProduto, proporcaoDoTamanho, tamanhosDoTipo, temDistribuicao, tipoDoProduto, totaisDaDistribuicao,
  voltarAoCalculado, type Distribuicao,
} from "@/lib/distribuicao-produto";
import { ModeloThumb } from "./ModeloThumb";
import { DistribuicaoTabelas, type CorDist, type LojaDist } from "./DistribuicaoTabelas";

type LojaDb = { id: string; nome: string; ativo: boolean; is_default: boolean; ordem: number | null };

/** "Marrom" + "Canela" a partir da variante (a cor planejada guarda "Cor - Apelido" no label). */
export function partesCor(v: PtVariante): { cor: string; apelido: string | null } {
  const cor = v.cor_nome || v.label || "—";
  const apelido = v.label && v.cor_nome && v.label.startsWith(`${v.cor_nome} - `) ? v.label.slice(v.cor_nome.length + 3) : null;
  return { cor, apelido: apelido || null };
}

/** T6 fix1 · m9: rótulo completo (cor + apelido) da variante — a confirmação de zerar não pode mostrar só a
 *  cor base quando há apelido (2 cores "Marrom" de apelidos diferentes ficariam indistinguíveis no aviso). */
const rotuloCor = (v: PtVariante): string => {
  const { cor, apelido } = partesCor(v);
  return apelido ? `${cor} · ${apelido}` : cor;
};

export function DistribuirPorLojaDialog({ slot, tamanhosGrade, readOnly, motivoSoLeitura, presentes, onFoco, onSalvar, onClose }: {
  slot: PtSlot;
  tamanhosGrade: string[];
  readOnly: boolean;
  motivoSoLeitura: string;
  presentes: PresencaColab[];
  onFoco?: (path: string | null) => void;
  onSalvar: (novo: PtSlot) => void;
  onClose: () => void;
}) {
  const tenantId = useActiveTenantId();
  const slotKey = chaveSlot(slot);
  const tipo = tipoDoProduto(slot.tamanho_tipo);
  const tamanhos = useMemo(() => tamanhosDoTipo(tamanhosGrade, tipo), [tamanhosGrade, tipo]);
  const t1 = slot.materiais.find(ehTecido1);
  // Snapshot na ABERTURA (o card monta o dialog só aberto — {distOpen && …}): é o rascunho local.
  const [inicial] = useState(() => ({
    prop: Object.fromEntries(tamanhos.map((t) => [t, proporcaoDoTamanho(slot.proporcoes, t)])) as Record<string, number>,
    dists: Object.fromEntries(
      (t1?.variantes ?? []).map((v) => [varKey(v), normalizarDistribuicao(v.distribuicao, slot.proporcoes, tamanhos)]),
    ) as Record<string, Distribuicao>,
  }));
  const [prop, setProp] = useState(inicial.prop);
  const [dists, setDists] = useState(inicial.dists);
  // T6 fix1 · m5: comparação CANÔNICA (chaves ordenadas) — reusa `igual`/`canon` de atendimento.ts, não
  // JSON.stringify cru (o jsonb do Postgres reordena chaves; comparar bruto acusaria "sujo" sem edição real).
  const dirty = !igual({ prop, dists }, inicial);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const [zeradas, setZeradas] = useState<string[] | null>(null);
  const corpoRef = useRef<HTMLDivElement>(null);

  const { data: lojasDb, isFetched: lojasProntas, isError: lojasErro, error: lojasErroObj, refetch: refetchLojas } = useQuery({
    queryKey: ["dist-produto-lojas", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("lojas_direcionamento" as any) as any)
        .select("id, nome, ativo, is_default, ordem")
        .order("is_default", { ascending: false })
        .order("ordem", { ascending: true, nullsFirst: false })
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as LojaDb[];
    },
  });
  // T6 fix1 · m3: erro na query de lojas ganha toast + aviso no corpo do dialog — não pode abrir a tabela
  // como se estivesse simplesmente vazia (sem loja nenhuma pareceria "sem distribuição" por engano).
  useEffect(() => {
    if (lojasErro) toast.error(mensagemErro(lojasErroObj, "Não foi possível carregar as lojas."));
  }, [lojasErro, lojasErroObj]);
  // `isFetched` fica true depois de QUALQUER settle (sucesso OU erro) — Imprimir/impressão só quando deu certo.
  const podeImprimir = lojasProntas && !lojasErro;
  // R13: ativas + qualquer loja com dado (inativa/excluída, esmaecida e editável — dá para zerar).
  // T6 fix1 · m4: `comDado` une as chaves do RASCUNHO ATUAL (`dists`) com as do SNAPSHOT da abertura
  // (`inicial.dists`) — sem isso, zerar a última linha manual de uma loja inativa fazia `dists` perder a
  // chave e a loja sumia da lista NO MEIO da edição (antes de salvar), quebrando "dá para zerar" (R13).
  const lojas = useMemo<LojaDist[]>(() => {
    const comDado = new Set([
      ...Object.values(dists).flatMap((d) => Object.keys(d)),
      ...Object.values(inicial.dists).flatMap((d) => Object.keys(d)),
    ]);
    const out: LojaDist[] = (lojasDb ?? [])
      .filter((l) => l.ativo || comDado.has(l.id))
      .map((l) => ({ id: l.id, nome: l.ativo ? l.nome : `${l.nome} (inativa)`, inativa: !l.ativo }));
    const conhecidas = new Set((lojasDb ?? []).map((l) => l.id));
    for (const id of comDado) if (!conhecidas.has(id)) out.push({ id, nome: "Loja excluída", inativa: true });
    return out;
  }, [lojasDb, dists, inicial.dists]);
  const cores = useMemo<CorDist[]>(
    () => (t1?.variantes ?? []).map((v) => {
      const { cor, apelido } = partesCor(v);
      return { key: varKey(v), cor, apelido, swatch: v.cor_nome ?? v.label ?? null, pcCard: Number(v.grade_total) || 0 };
    }),
    [t1],
  );

  // Presença de página (R19): com o dialog aberto e nenhum campo focado, os outros veem "neste produto".
  useEffect(() => {
    onFoco?.(pathDistAberto(slotKey));
    return () => onFoco?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey]);
  const presentesAqui = presentes.filter((p) => pathEhDoProduto(p.campoFocado, slotKey));

  const setBase = (k: string, loja: string, v: number) => setDists((d) => ({ ...d, [k]: definirBase(d[k] ?? {}, loja, v, prop, tamanhos) }));
  const setCel = (k: string, loja: string, t: string, v: number) => setDists((d) => ({ ...d, [k]: definirCelula(d[k] ?? {}, loja, t, v, prop, tamanhos) }));
  const voltar = (k: string, loja: string, t: string) => setDists((d) => ({ ...d, [k]: voltarAoCalculado(d[k] ?? {}, loja, t, prop, tamanhos) }));
  const setPropT = (t: string, v: number) => {
    const np = definirProporcao(prop, tamanhos, t, v);
    setProp(np);
    setDists((d) => Object.fromEntries(Object.entries(d).map(([k, x]) => [k, normalizarDistribuicao(x, np, tamanhos)])));
  };
  const pedirFechar = () => (dirty && !readOnly ? setConfirmarDescarte(true) : onClose());

  // PR5/R10: aplica sobre o slot ATUAL (prop viva) — só as cores do T1 do rascunho e a proporção (se mudou).
  const montar = () => {
    const nomes: string[] = [];
    const materiais = slot.materiais.map((m) => {
      if (!ehTecido1(m)) return m;
      return {
        ...m,
        variantes: m.variantes.map((v) => {
          const k = varKey(v);
          if (!(k in dists)) return v;
          const d = dists[k];
          const antes = Number(v.grade_total) || 0;
          if (temDistribuicao(d)) {
            const tot = totaisDaDistribuicao(d);
            if (antes > 0 && tot.total === 0) nomes.push(rotuloCor(v));
            return { ...v, distribuicao: d, grades: tot.grades, grade_total: tot.total };
          }
          if (temDistribuicao(v.distribuicao)) { // tinha e perdeu todas as linhas → 0 (R10)
            if (antes > 0) nomes.push(rotuloCor(v));
            return { ...v, distribuicao: {}, grades: {}, grade_total: 0 };
          }
          return v;
        }),
      };
    });
    const propMudou = !igual(prop, inicial.prop);
    const novo: PtSlot = { ...slot, ...(propMudou ? { proporcoes: { ...(slot.proporcoes ?? {}), ...prop } } : {}), materiais };
    return { novo, nomes };
  };
  const salvar = (forcar = false) => {
    if (!dirty) return onClose();
    const { novo, nomes } = montar();
    if (nomes.length > 0 && !forcar) return setZeradas(nomes);
    onSalvar(novo);
  };

  const n = cores.length;
  // T6 fix1 · m1: a versão de IMPRESSÃO não leva o InfoHover — é um <button> (não tocamos o componente
  // compartilhado; o controlador registrou o problema geral dele dentro de fieldset para uma frente própria)
  // e a impressão é "sem botões" por definição (P-36). A versão de TELA continua com o "i".
  const cabecalho = (impressao: boolean) => (
    <div className="flex items-start gap-3">
      <ModeloThumb path={slot.thumb_path ?? slot.referencia_paths?.[0] ?? null} className="h-16 w-12 shrink-0" zoom alt={slot.nome ?? "Produto"} />
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-semibold">{slot.nome ?? "Produto sem nome"}{slot.ref ? ` · ${slot.ref}` : ""}</p>
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Tecido 1: {t1?.artigo_nome ?? "—"} · {n} {n === 1 ? "cor" : "cores"} · tamanhos em {tipo === "numero" ? "Número" : "Letra"}
          {!impressao && (
            <InfoHover ariaLabel="De onde vêm as lojas e os tamanhos">
              O “Tamanho em” vem do Planejamento de Produto (seção Códigos). Lojas ativas de Cadastro › Lojas; todos os tamanhos da grade da loja.
            </InfoHover>
          )}
        </p>
      </div>
    </div>
  );
  const tabelas = (modo: "edicao" | "impressao") => (
    <DistribuicaoTabelas modo={modo} slotKey={slotKey} tamanhos={tamanhos} tipo={tipo} prop={prop} cores={cores} dists={dists}
      lojas={lojas} readOnly={readOnly} onProp={setPropT} onBase={setBase} onCel={setCel} onVoltar={voltar} />
  );

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) pedirFechar(); }}>
        <DialogContent fixedFooter mobileFull className="md:max-w-5xl">
          <DialogHeader className="space-y-2 text-left">
            <div className="flex items-center gap-2 pr-8">
              <DialogTitle className="flex-1">Distribuir por loja</DialogTitle>
              {/* P-36 = B (dono 25/set): Imprimir SÓ no desktop — a PrintArea fica.
                  Ruling do controlador (mesma classe do gatilho no ModelCard): o DialogContent (dialog.tsx) embrulha
                  os filhos no PRÓPRIO fieldset (disabled=readOnly de página), então um <button> nativo aqui também
                  seria desabilitado em modo só-leitura — quebraria "ver e imprimir sem permissão". `asChild` troca o
                  elemento renderizado por um `role="button"` (não nativo), que o fieldset não desabilita; mantém o
                  MESMO visual/props do Button (outline/sm) e o clique. */}
              <Button asChild variant="outline" size="sm" className="max-sm:hidden" onClick={() => void printWithImages()} aria-label="Imprimir" disabled={!podeImprimir}>
                {/* `asChild` (Radix Slot) troca o <button> nativo por este elemento — o onClick acima só dispara aqui
                    porque o span não tem bloqueio nativo de `disabled` (diferente de um <button>), então a checagem
                    de "pronto" precisa ficar no MEIO do clique/tecla, não delegada ao atributo. */}
                <span role="button" tabIndex={podeImprimir ? 0 : -1} aria-disabled={!podeImprimir}
                  onClickCapture={(e) => { if (!podeImprimir) { e.preventDefault(); e.stopPropagation(); } }}
                  onKeyDown={(e) => { if (podeImprimir && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); void printWithImages(); } }}>
                  <Printer className="h-4 w-4 md:mr-1" /><span className="max-md:sr-only">Imprimir</span>
                </span>
              </Button>
            </div>
            <DialogDescription className="sr-only">Distribuição do produto por loja, cor e tamanho</DialogDescription>
            {cabecalho(false)}
            <ColabBanner presentes={presentesAqui} ultimoMerge={null} />
          </DialogHeader>
          {/* Corpo rolável = scope do overlay de presença (DialogBody não repassa ref; mesmas classes). */}
          <div ref={corpoRef} className="min-h-0 space-y-3 overflow-y-auto py-2">
            <p className="text-xs text-muted-foreground">{TEXTO_AJUDA_DIST}</p>
            <p className="text-xs text-muted-foreground md:hidden">Por loja · deslize para o lado</p>
            {/* Sem fieldset travando o corpo inteiro: ele desligaria também os balões de LEITURA (ponto à mão — PR16 — e
                nome abreviado no celular); o só-leitura vem de `readOnly` → cada NumberInput `disabled` e o ↺ escondido. */}
            {lojasErro ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 py-6 text-center text-sm text-destructive">
                <AlertTriangle className="h-5 w-5" aria-hidden />
                <p>Não foi possível carregar as lojas.</p>
                <Button variant="outline" size="sm" onClick={() => void refetchLojas()}>Tentar de novo</Button>
              </div>
            ) : lojasProntas ? tabelas("edicao") : <p className="py-6 text-center text-sm text-muted-foreground">Carregando lojas…</p>}
          </div>
          <DialogFooter className="-mx-4 -mb-4 border-t bg-background px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
            {/* Mesmo motivo do Imprimir acima: em modo só-leitura de página este <button> nativo ficaria desabilitado
                pelo fieldset do próprio DialogContent — "Voltar" tem que continuar funcionando (é a única forma de
                fechar com o texto certo; ESC/clique fora ainda funcionam, mas o botão precisa também). */}
            <Button asChild variant="outline" onClick={pedirFechar} aria-label="Voltar">
              <span role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pedirFechar(); } }}>
                <ArrowLeft className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Voltar</span>
              </span>
            </Button>
            {readOnly ? (
              <span className="ml-auto text-xs text-muted-foreground">{motivoSoLeitura}</span>
            ) : (
              <>
                {/* T6 fix1 · m9: singular "da 1 cor" / plural "das N cores" — antes sempre dizia "das 1 cores". */}
                <span className="hidden flex-1 text-xs text-muted-foreground sm:block">
                  Salvar preenche o pç {n === 1 ? `da ${n} cor` : `das ${n} cores`} no card. Grava de vez no Salvar do plano.
                </span>
                <Button className="ml-auto max-sm:aspect-square max-sm:px-0" onClick={() => salvar()} aria-label="Salvar">
                  <Save className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Salvar</span>
                </Button>
              </>
            )}
          </DialogFooter>
          <ColabPresenceOverlay presentes={presentes} scopeRef={corpoRef} />
          {confirmarDescarte && (
            <AlertDialog open onOpenChange={(o) => !o && setConfirmarDescarte(false)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
                  <AlertDialogDescription>O que você mudou na distribuição deste produto se perde.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Continuar editando</AlertDialogCancel>
                  <AlertDialogAction onClick={onClose}>Descartar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {zeradas && (
            <AlertDialog open onOpenChange={(o) => !o && setZeradas(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Zerar o pç destas cores?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {zeradas.join(", ")} {zeradas.length === 1 ? "tinha peças no card e vai ficar" : "tinham peças no card e vão ficar"} com 0. Salvar mesmo assim?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { setZeradas(null); salvar(true); }}>Salvar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </DialogContent>
      </Dialog>
      {podeImprimir && (
        <PrintArea>
          {/* Pedido do dono 26/set: esta impressão (só esta — a tag só existe enquanto o dialog está
              aberto, dentro da PrintArea) sai em A4 PAISAGEM — a tabela de Distribuir por loja é larga
              (Base + N tamanhos + Total por cor); em retrato ela ficaria espremida/cortando colunas.
              O @page global (styles.css) continua retrato para todo o resto do app. */}
          <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
          <div className="space-y-4 p-6">
            <h1 className="text-lg font-semibold">Distribuir por loja</h1>
            {cabecalho(true)}
            {tabelas("impressao")}
          </div>
        </PrintArea>
      )}
    </>
  );
}
