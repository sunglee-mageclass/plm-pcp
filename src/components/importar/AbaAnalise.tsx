// Conteúdo de UMA aba de tipo na tela de Importar Dados (multi-tipo).
// Isola o bloco de análise de um único tipo (Tecido/Aviamento/Insumo): resumo por estado
// do upsert + tabela de análise editável + aviso de fotos órfãs. Toda a interação (patch,
// ignorar, trocar foto, cadastrar) sobe pra página, que guarda o estado POR TIPO.

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { TabelaAnalise } from "@/components/importar/TabelaAnalise";
import { alvosDeFoto, casarFotos } from "@/lib/import/foto-match";
import type { OpcoesLookup } from "@/lib/import/lookup";
import type { EntidadeAgregada, EntityImportDescriptor } from "@/lib/import/types";

type Props = {
  descriptor: EntityImportDescriptor;
  entidades: EntidadeAgregada[];
  opcoes: OpcoesLookup;
  fotos: File[];
  ignoradas: Set<string>;
  onToggleIgnorar: (chave: string) => void;
  onPatch: (chave: string, patch: Partial<EntidadeAgregada>) => void;
  onCadastrar: (tipo: "fornecedor" | "cor" | "categoria" | "apelido", nome: string, chave: string) => void;
  fotosManuais: Map<string, File>;
  onTrocarFoto: (chaveAlvo: string, file: File | null) => void;
};

/** Conta as pendências abertas (campo obrigatório não resolvido ou conflito sem decisão). */
export function contarPendencias(entidades: EntidadeAgregada[], ignoradas: Set<string>): number {
  return entidades.filter((e) => {
    if (ignoradas.has(e.chave)) return false;
    const semForn = e.raw.fornecedor?.trim() && !e.cabecalho.empresa_id;
    const conflito = e.estado === "conflito_fornecedor" && e.mesmoTecidoConfirmado == null;
    // Cor pendente = cor DIGITADA que não casou (erro nos problemas), NÃO "variante sem cor":
    // insumo/aviamento sem cor têm `cor_id: null` LEGÍTIMO (variante só por tamanho). Cada
    // descriptor marca cor não resolvida como problema `erro`/cor_base (tecido: cor obrigatória).
    const corPend = e.problemas.some((p) => p.nivel === "erro" && (p.campo === "cor_base" || p.campo === "cor_apelido"));
    return semForn || conflito || corPend;
  }).length;
}

export function AbaAnalise({
  descriptor,
  entidades,
  opcoes,
  fotos,
  ignoradas,
  onToggleIgnorar,
  onPatch,
  onCadastrar,
  fotosManuais,
  onTrocarFoto,
}: Props) {
  // fotos que não casaram com nenhuma cor (aviso; a foto agora é inline na tabela).
  const fotosOrfas = useMemo<string[]>(() => {
    if (!descriptor.temFoto || fotos.length === 0) return [];
    const alvos = alvosDeFoto(descriptor, entidades);
    const { orfas } = casarFotos(alvos.map((a) => ({ chave: a.chave, rotulo: a.rotulo })), fotos.map((f) => f.name));
    return orfas.map((o) => o.arquivo);
  }, [descriptor, entidades, fotos]);

  const pendencias = useMemo(() => contarPendencias(entidades, ignoradas), [entidades, ignoradas]);

  return (
    <div className="space-y-4">
      {/* resumo por estado do upsert */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{entidades.length} item(ns)</Badge>
        {(() => {
          const cont = { novo: 0, complementar: 0, so_foto: 0, conflito_fornecedor: 0 } as Record<string, number>;
          entidades.forEach((e) => { if (!ignoradas.has(e.chave)) cont[e.estado ?? "novo"] = (cont[e.estado ?? "novo"] ?? 0) + 1; });
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
        descriptor={descriptor}
        entidades={entidades}
        opcoes={opcoes}
        arquivos={fotos}
        ignoradas={ignoradas}
        onToggleIgnorar={onToggleIgnorar}
        onPatch={onPatch}
        onCadastrar={onCadastrar}
        fotosManuais={fotosManuais}
        onTrocarFoto={onTrocarFoto}
      />

      {descriptor.temFoto && fotosOrfas.length > 0 && (
        <p className="text-xs text-amber-600">
          {fotosOrfas.length} foto(s) não casaram com nenhuma cor: {fotosOrfas.slice(0, 5).join(", ")}{fotosOrfas.length > 5 ? "…" : ""}
        </p>
      )}
    </div>
  );
}
