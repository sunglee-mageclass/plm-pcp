import { Plus, RefreshCw, Trash2, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { varianteLabel } from "@/lib/variante";
import { GradeDestrinchada } from "./GradeDestrinchada";
import { OcPaRecebimento, type ColaboradorOpt } from "./OcPaRecebimento";
import { totaisDoItem, type ItemOcPa } from "./itens";
import {
  redistribuirPedida, redistribuirVariantesPorPeso, fmtMoney, TAM_ACESSORIO,
  type GradeDetalhe, type VarianteDraft,
} from "./shared";

export type Opt = { id: string; nome: string };
export type CatOpt = Opt & { grupo_id: string | null };
export type SubOpt = Opt & { categoria_id: string | null };
export type CorApelidoOpt = Opt & { cor_base_id: string | null };

/** Select simples id→nome (sem cascata) — usado nos 4 níveis de taxonomia do produto. */
export function CatSelect({
  label, value, onChange, options, placeholder = "Selecione…", disabled, colabPath,
}: {
  label: string; value: string | null; onChange: (v: string | null) => void; options: Opt[]; placeholder?: string; disabled?: boolean; colabPath: string;
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)} disabled={disabled}>
        <SelectTrigger data-colab-path={colabPath}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * O CORPO de UM produto da OC (R13): campos do produto (nome, taxonomia, REF fornecedor, composição, variantes, proporção, valores) +
 * grade pedida + recebimento do produto. Vai dentro do `OcItemAcordeao`. Não conhece RPC nem colaboração: tudo muda por
 * `onItemChange(updater)`, e as ações de ciclo (tirar / receber) chegam por props já com o motivo de estar desabilitada.
 */
export function OcPaItem({
  item, onItemChange,
  grupos, categorias, subcats1, subcats2, cores, coresApelido, tamanhos, colaboradores,
  isEdit, motivoNaoTira, onTirar, motivoNaoRecebe, onReceber, recebendo = false, somenteLeitura = false,
}: {
  item: ItemOcPa;
  onItemChange: (updater: (it: ItemOcPa) => ItemOcPa) => void;
  grupos: Opt[]; categorias: CatOpt[]; subcats1: SubOpt[]; subcats2: SubOpt[];
  cores: Opt[]; coresApelido: CorApelidoOpt[];
  /** Colunas de tamanho da loja (o item acessório usa só "UN"). */
  tamanhos: string[];
  colaboradores: ColaboradorOpt[];
  /** OC já salva: só então existe recebimento (item salvo). */
  isEdit: boolean;
  /** `null` = o botão "Tirar da OC" está habilitado; senão o motivo (texto ao lado do botão desabilitado). */
  motivoNaoTira: string | null;
  onTirar: () => void;
  /** `null` = "Marcar este produto como recebido" habilitado; senão o motivo. */
  motivoNaoRecebe: string | null;
  onReceber: () => void;
  recebendo?: boolean;
  /** Sem permissão de edição da tela: tudo desabilitado. */
  somenteLeitura?: boolean;
}) {
  const recebido = item.status === "recebido";
  const pendente = item.doProduto && !item.id; // vem do picker: o servidor monta ao Salvar
  const grupoNome = grupos.find((g) => g.id === item.grupo_id)?.nome ?? "";
  const acessorio = ehGrupoAcessorio(grupoNome);
  const tamanhosAtivos = acessorio ? [TAM_ACESSORIO] : tamanhos;
  const bloqueado = somenteLeitura || pendente;       // campos do produto
  const valoresTravados = bloqueado || recebido;      // OC/produto recebido: qtd, valor, desconto e grade pedida congelam (servidor)
  const prefixo = `item:${item.id ?? item.tempId}:`;
  const cp = (campo: string) => `${prefixo}${campo}`;
  const { bruto, total, unitReal, desconto } = totaisDoItem(item);

  const patch = (p: Partial<ItemOcPa>) => onItemChange((it) => ({ ...it, ...p }));
  const setGrade = (grade: GradeDetalhe) => patch({ grade });

  const corNome = (id: string | null) => cores.find((c) => c.id === id)?.nome ?? null;
  const apelidoNome = (id: string | null) => coresApelido.find((c) => c.id === id)?.nome ?? null;
  const labelVariante = (v: VarianteDraft) => `${v.ordem} · ${varianteLabel({ cor: corNome(v.cor_id), apelido: apelidoNome(v.cor_apelido_id) })}`;

  const addVariante = () => onItemChange((it) => {
    const proxima = it.variantes.length ? Math.max(...it.variantes.map((v) => v.ordem)) + 1 : 1;
    return { ...it, variantes: [...it.variantes, { ordem: proxima, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 0 }] };
  });
  const removeVariante = (ordem: number) => onItemChange((it) => {
    const grade = { ...it.grade };
    delete grade[String(ordem)];
    return { ...it, variantes: it.variantes.filter((v) => v.ordem !== ordem), grade };
  });
  const setVariante = (ordem: number, p: Partial<VarianteDraft>) =>
    onItemChange((it) => ({ ...it, variantes: it.variantes.map((v) => (v.ordem === ordem ? { ...v, ...p } : v)) }));
  const setPeso = (tam: string, peso: number) => onItemChange((it) => ({ ...it, grade_proporcao: { ...it.grade_proporcao, [tam]: peso } }));

  // "Redistribuir por peso" (§N): 1 clique refaz a qtd de cada variante (peso × qtd_total) E a grade pedida de cada uma (maior resto);
  // `redistribuirPedida` já devolve a grade inteira mesclada célula a célula (preserva recebida/defeito).
  const redistribuirTudo = () => onItemChange((it) => {
    const variantes = redistribuirVariantesPorPeso(it.variantes, it.qtd_total);
    return { ...it, variantes, grade: redistribuirPedida(variantes, it.grade, it.grade_proporcao, ehGrupoAcessorio(grupos.find((g) => g.id === it.grupo_id)?.nome ?? "")) };
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground">Compra &amp; grade pedida</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {motivoNaoTira && <span className="text-xs text-muted-foreground">{motivoNaoTira}</span>}
          <Button
            type="button" variant="outline" size="sm" disabled={somenteLeitura || !!motivoNaoTira} onClick={onTirar}
            title={motivoNaoTira ?? (pendente ? "Remover da lista (ainda não foi salvo)" : "Tirar este produto da OC")}
          >
            <X className="mr-1 h-3.5 w-3.5" /> {pendente ? "Remover da lista" : "Tirar da OC"}
          </Button>
        </div>
      </div>

      {pendente && (
        <p className="flex items-start gap-2 rounded-md bg-[var(--tone-info-bg)] p-2 text-xs text-[var(--tone-info-fg)]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Produto novo: entra na OC ao Salvar, com os dados do cadastro do produto (grade, valores e variantes). Depois de salvar, dá para ajustar aqui.</span>
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2 grid gap-1">
          <Label>Nome do produto *</Label>
          <Input value={item.nome_produto} disabled={bloqueado} data-colab-path={cp("nome_produto")} onChange={(e) => patch({ nome_produto: e.target.value })} />
        </div>
        <CatSelect label="Grupo" value={item.grupo_id} disabled={bloqueado} options={grupos} colabPath={cp("grupo_id")}
          onChange={(v) => patch({ grupo_id: v, categoria_id: null, subcategoria1_id: null, subcategoria2_id: null })} />
        <CatSelect label="Categoria" value={item.categoria_id} disabled={bloqueado} colabPath={cp("categoria_id")}
          options={item.grupo_id ? categorias.filter((c) => c.grupo_id === item.grupo_id) : categorias}
          onChange={(v) => patch({ categoria_id: v, subcategoria1_id: null, subcategoria2_id: null })} />
        {!acessorio && (
          <>
            <CatSelect label="Subcategoria 1" value={item.subcategoria1_id} disabled={bloqueado} colabPath={cp("subcategoria1_id")}
              options={subcats1.filter((s) => s.categoria_id === item.categoria_id)} onChange={(v) => patch({ subcategoria1_id: v })} />
            <CatSelect label="Subcategoria 2" value={item.subcategoria2_id} disabled={bloqueado} colabPath={cp("subcategoria2_id")}
              options={subcats2.filter((s) => s.categoria_id === item.categoria_id)} onChange={(v) => patch({ subcategoria2_id: v })} />
          </>
        )}
        <div className="grid gap-1">
          <Label>REF Fornecedor</Label>
          <Input value={item.ref_fornecedor} disabled={bloqueado} data-colab-path={cp("ref_fornecedor")} onChange={(e) => patch({ ref_fornecedor: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label>Composição</Label>
          <Input value={item.composicao} disabled={bloqueado} data-colab-path={cp("composicao")} onChange={(e) => patch({ composicao: e.target.value })} />
        </div>
      </div>

      {valoresTravados && !pendente && recebido && (
        <p className="text-xs text-muted-foreground">
          Produto recebido — qtd total, valor unitário, desconto e a grade pedida ficam travados (desfaça o recebimento da OC pra alterar).
        </p>
      )}

      {!acessorio && (
        <div className="space-y-1.5">
          <Label className="text-sm">Proporção de grade (peso)</Label>
          <div className="flex flex-wrap gap-2">
            {tamanhos.map((t) => {
              const peso = item.grade_proporcao[t] ?? 0;
              return (
                <div key={t} className={peso > 0 ? "rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] p-1.5" : "rounded-md border p-1.5"}>
                  <div className="text-center text-[10px] font-medium text-muted-foreground">{t}</div>
                  <NumberInput
                    integer disabled={bloqueado} className="h-8 w-14 border-0 bg-transparent text-center" value={peso}
                    data-colab-path={cp(`peso:${t}`)}
                    onChange={(e) => setPeso(t, Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Variantes</Label>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={valoresTravados} onClick={redistribuirTudo}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Redistribuir por peso
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={bloqueado} onClick={addVariante}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar variante
            </Button>
          </div>
        </div>
        {item.variantes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma variante ainda.</p>
        ) : (
          <div className="space-y-2">
            {item.variantes.map((v) => (
              <div key={v.ordem} className="flex flex-wrap items-center gap-2 rounded-md border p-2 max-md:flex-col max-md:items-start">
                <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground max-md:hidden">{v.ordem}</span>
                <Select value={v.cor_id ?? ""} onValueChange={(cid) => setVariante(v.ordem, { cor_id: cid || null, cor_apelido_id: null })} disabled={bloqueado}>
                  <SelectTrigger className="w-40 max-md:w-full" data-colab-path={cp(`variante:${v.ordem}:cor`)}><SelectValue placeholder="Cor base" /></SelectTrigger>
                  <SelectContent>{cores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={v.cor_apelido_id ?? ""} onValueChange={(aid) => setVariante(v.ordem, { cor_apelido_id: aid || null })} disabled={bloqueado}>
                  <SelectTrigger className="w-40 max-md:w-full" data-colab-path={cp(`variante:${v.ordem}:apelido`)}><SelectValue placeholder="Cor apelido" /></SelectTrigger>
                  <SelectContent>
                    {coresApelido.filter((a) => !v.cor_id || a.cor_base_id === v.cor_id).map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="ml-auto flex items-center gap-2 max-md:ml-0 max-md:w-full">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">peso</span>
                    <NumberInput integer disabled={bloqueado} className="h-8 w-16 text-center" value={v.peso}
                      data-colab-path={cp(`variante:${v.ordem}:peso`)}
                      onChange={(e) => setVariante(v.ordem, { peso: Math.max(0, Number(e.target.value) || 0) })} />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">qtd</span>
                    <NumberInput integer disabled={bloqueado} className="h-8 w-20 text-center" value={v.qtd}
                      data-colab-path={cp(`variante:${v.ordem}:qtd`)}
                      onChange={(e) => setVariante(v.ordem, { qtd: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} />
                  </div>
                  {!bloqueado && (
                    <Button type="button" size="iconSm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" aria-label="Remover variante" onClick={() => removeVariante(v.ordem)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bloco de valores — EMPILHADO 1 campo/linha, rótulo ~150px (§N: formato da planilha de referência do dono). */}
      <div className="max-w-sm space-y-2 rounded-md border p-3">
        <div className="flex items-center gap-3">
          <Label className="w-[150px] shrink-0 text-sm">Qtd total</Label>
          <NumberInput integer disabled={valoresTravados} className="flex-1" value={item.qtd_total} data-colab-path={cp("qtd_total")}
            onChange={(e) => patch({ qtd_total: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} />
        </div>
        <div className="flex items-center gap-3">
          <Label className="w-[150px] shrink-0 text-sm">Valor unitário</Label>
          <MoneyInput disabled={valoresTravados} className="flex-1" value={item.valor_unitario} placeholder="0,00" data-colab-path={cp("valor_unitario")}
            onChange={(e) => patch({ valor_unitario: Number(e.target.value) || 0 })} />
        </div>
        <div className="flex items-center gap-3">
          <Label className="w-[150px] shrink-0 text-sm">Desconto (%)</Label>
          <NumberInput disabled={valoresTravados} className="flex-1" value={item.desconto_pct} data-colab-path={cp("desconto_pct")}
            onChange={(e) => patch({ desconto_pct: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
      </div>

      <InfoStrip
        itens={[
          { label: "Bruto", valor: fmtMoney(bruto) },
          { label: "Desconto", valor: fmtMoney(desconto) },
          { label: "Total c/ desconto", valor: fmtMoney(total) },
          { label: "V. unit. real", valor: fmtMoney(unitReal), hi: true },
        ]}
      />

      {!pendente && (
        <div className="space-y-1.5">
          <Label className="text-sm">Grade pedida (destrinchada — auto + editável)</Label>
          <GradeDestrinchada
            variantes={item.variantes} tamanhos={tamanhosAtivos} grade={item.grade} campo="pedida" onChange={setGrade}
            labelFor={(ordem) => labelVariante(item.variantes.find((v) => v.ordem === ordem)!)}
            disabled={valoresTravados} pathPrefix={prefixo}
          />
        </div>
      )}

      {isEdit && item.id && !pendente && (
        <OcPaRecebimento
          valor={{ data_entrega: item.data_entrega, nota_fiscal: item.nota_fiscal, responsavel_recebimento_id: item.responsavel_recebimento_id, devolucao: item.devolucao, revisao: item.revisao }}
          onChange={(p) => patch(p)}
          variantes={item.variantes}
          tamanhos={tamanhosAtivos}
          grade={item.grade}
          onGradeChange={setGrade}
          labelVariante={labelVariante}
          colaboradores={colaboradores}
          readOnly={somenteLeitura || recebido}
          pathPrefix={prefixo}
          mostrarAvisoGravaAoSalvar={!recebido}
          rodape={
            recebido ? (
              <span className="text-xs text-muted-foreground">Entrada registrada. CQ e Direcionamento liberados para este produto.</span>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={somenteLeitura || recebendo || !!motivoNaoRecebe} onClick={onReceber} title={motivoNaoRecebe ?? undefined}>
                  Marcar este produto como recebido
                </Button>
                {motivoNaoRecebe && <span className="text-xs text-muted-foreground">{motivoNaoRecebe}</span>}
              </>
            )
          }
        />
      )}
    </>
  );
}
