import { X, Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { NumberInput } from "@/components/shared/NumberInput";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { InfoHover } from "@/components/shared/InfoHover";
import { cn } from "@/lib/utils";
import {
  LIMITE_INSUMOS_PADRAO,
  TEXTO_COR_REMOVIDA_SEM_CORES,
  TEXTO_PROBLEMA_INSUMO_PADRAO,
  cortarCasasConsumo,
  type CatalogoInsumoPadrao,
  type DiagnosticoLinhaInsumoPadrao,
  type InsumoPadrao,
} from "@/lib/insumos-padrao";

// Card "Insumos padrão" (Config da Loja, urg R2 T11) - lista da loja (insumo + cor + consumo) que PRE-PREENCHE a seção Insumos
// de um produto INTERNO novo. Grava no Salvar da página (coluna `insumos_padrao` de `salvar_config_loja`, compare-and-set
// por coluna - conflito P0409 e anel de presença como os outros blocos). Regras de validação/normalização: `src/lib/insumos-padrao.ts`.
// Linha cujo insumo/cor sumiu do cadastro NUNCA quebra a tela: aparece como "Insumo removido" / "Cor removida" para a pessoa
// REMOVER (o servidor recusa a lista com id que não é da loja - sem isso a lista nunca mais poderia ser salva).

const SEM_COR = "__sem_cor__";

export function InsumosPadraoCard({
  value,
  onChange,
  catalogo,
  carregando,
  erro,
  tentando,
  onTentarDeNovo,
  diagnostico,
  anelClassName = "",
  disabled = false,
}: {
  value: InsumoPadrao[];
  onChange: (next: InsumoPadrao[]) => void;
  /** Insumos da loja com as cores das variantes; `undefined` = ainda não chegou (ou falhou). */
  catalogo: CatalogoInsumoPadrao[] | undefined;
  carregando: boolean;
  erro: boolean;
  tentando: boolean;
  onTentarDeNovo: () => void;
  /** Um por linha (mesma ordem); `null` enquanto não há catálogo (nada é marcado como "removido" sem saber). */
  diagnostico: DiagnosticoLinhaInsumoPadrao[] | null;
  /** Classe do anel âmbar de conflito P0409 (`anelConflito("cfg:insumos_padrao")`). */
  anelClassName?: string;
  disabled?: boolean;
}) {
  const porId = new Map((catalogo ?? []).map((i) => [i.id, i]));
  const cheia = value.length >= LIMITE_INSUMOS_PADRAO;
  const travado = disabled || catalogo === undefined;

  const setLinha = (i: number, patch: Partial<InsumoPadrao>) =>
    onChange(value.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remover = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const adicionar = () => onChange([...value, { etiqueta_id: "", cor_id: null, consumo: 0 }]);

  const escolherInsumo = (i: number, etiquetaId: string) => {
    const ins = porId.get(etiquetaId);
    const corAtual = value[i].cor_id;
    // mantém a cor só se ela também é variante do insumo novo; senão volta a "Sem cor"
    setLinha(i, { etiqueta_id: etiquetaId, cor_id: corAtual && ins?.cores.some((c) => c.id === corAtual) ? corAtual : null });
  };

  return (
    <Card data-colab-path="cfg:insumos_padrao" className={anelClassName}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Insumos padrão</CardTitle>
          <InfoHover ariaLabel="Sobre os insumos padrão">
            Até {LIMITE_INSUMOS_PADRAO} insumos. A cor vem das variantes do insumo no cadastro; o consumo aceita até 4 casas decimais.
          </InfoHover>
          <StatusBadge tone="neutral" className="ml-auto">
            {value.length}/{LIMITE_INSUMOS_PADRAO}
          </StatusBadge>
        </div>
        <CardDescription>
          {'Entram já preenchidos na seção Insumos ao criar um produto INTERNO pelo "Novo Modelo" (como rascunho — só gravam no Salvar do card). Produtos existentes não mudam.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {erro && catalogo === undefined && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-destructive font-medium">Não foi possível carregar os insumos.</span>
            <Button type="button" variant="outline" size="sm" onClick={onTentarDeNovo} disabled={tentando}>
              {tentando ? "Tentando…" : "Tentar de novo"}
            </Button>
          </div>
        )}
        {carregando && catalogo === undefined && !erro && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando insumos…
          </p>
        )}

        {value.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum insumo padrão.</p>
        ) : (
          <div role="table" aria-label="Insumos padrão" className="min-w-0">
            <div
              role="row"
              className="hidden gap-2 border-b px-1 pb-1 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_7rem_2rem]"
            >
              <span role="columnheader">Insumo</span>
              <span role="columnheader">Cor</span>
              <span role="columnheader">Consumo</span>
              <span role="columnheader" className="sr-only">Ações</span>
            </div>
            {value.map((l, i) => {
              const d = diagnostico?.[i] ?? null;
              const problema = d?.problema ?? null;
              const ins = porId.get(l.etiqueta_id);
              const insumoRemovido = problema === "insumo_removido";
              const corRemovida = problema === "cor_removida";
              const consumoRuim = problema === "consumo_invalido";
              const msgNeutra = problema === "sem_insumo";
              return (
                <div
                  key={i}
                  role="row"
                  data-testid="insumo-padrao-linha"
                  className={cn(
                    "grid gap-2 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_7rem_2rem] sm:items-start sm:border-b sm:px-1",
                    // mobile: cada linha vira um cartão empilhado
                    "max-sm:mb-2 max-sm:rounded-md max-sm:border max-sm:p-3",
                    problema && !msgNeutra && "max-sm:border-amber-400",
                  )}
                >
                  <div role="cell" className="min-w-0 space-y-1">
                    <Label className="text-xs text-muted-foreground sm:sr-only">Insumo</Label>
                    {insumoRemovido ? (
                      <div className="flex h-9 items-center rounded-md border border-amber-400 bg-amber-50 px-3 text-sm font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                        Insumo removido
                      </div>
                    ) : (
                      <Select value={l.etiqueta_id} onValueChange={(v) => escolherInsumo(i, v)} disabled={travado}>
                        <SelectTrigger aria-label="Insumo" className="w-full">
                          <SelectValue placeholder="Selecione o insumo" />
                        </SelectTrigger>
                        <SelectContent>
                          {(catalogo ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div role="cell" className="min-w-0 space-y-1">
                    <Label className="text-xs text-muted-foreground sm:sr-only">Cor</Label>
                    {insumoRemovido ? (
                      <div className="flex h-9 items-center px-3 text-sm text-muted-foreground">—</div>
                    ) : (
                      <Select
                        value={l.cor_id ?? SEM_COR}
                        onValueChange={(v) => setLinha(i, { cor_id: v === SEM_COR ? null : v })}
                        disabled={travado || l.etiqueta_id === "" || ((ins?.cores.length ?? 0) === 0 && !corRemovida)}
                      >
                        <SelectTrigger
                          aria-label="Cor"
                          className={cn("w-full", corRemovida && "border-amber-400 text-amber-800 dark:text-amber-300")}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_COR}>Sem cor</SelectItem>
                          {corRemovida && l.cor_id && (
                            <SelectItem value={l.cor_id} disabled>Cor removida</SelectItem>
                          )}
                          {(ins?.cores ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div role="cell" className="space-y-1">
                    <Label className="text-xs text-muted-foreground sm:sr-only">Consumo</Label>
                    <NumberInput
                      aria-label="Consumo"
                      step={0.001}
                      value={l.consumo}
                      disabled={travado}
                      aria-invalid={consumoRuim || undefined}
                      className={cn(consumoRuim && "border-amber-500")}
                      onChange={(e) => setLinha(i, { consumo: Number(cortarCasasConsumo(e.target.value)) })}
                    />
                  </div>

                  <div role="cell" className="flex justify-end max-sm:order-first sm:pt-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      aria-label="Remover insumo"
                      disabled={travado}
                      onClick={() => remover(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {problema && (
                    <p
                      role={msgNeutra ? undefined : "alert"}
                      className={cn(
                        "text-xs sm:col-span-4",
                        msgNeutra ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {problema === "cor_removida" && (ins?.cores.length ?? 0) === 0
                        ? TEXTO_COR_REMOVIDA_SEM_CORES
                        : TEXTO_PROBLEMA_INSUMO_PADRAO[problema]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={adicionar} disabled={travado || cheia}>
            + Adicionar insumo
          </Button>
          {cheia && <span className="text-xs text-muted-foreground">Máximo de {LIMITE_INSUMOS_PADRAO} insumos.</span>}
        </div>
      </CardContent>
    </Card>
  );
}
