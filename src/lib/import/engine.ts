// Motor de gravação: SÓ roda na confirmação. Por entidade gravável:
//  1) sobe a foto (se houver, casada+confirmada no match visual) via uploadToBucket
//  2) chama a RPC transacional do descritor (cabeçalho + variantes atômico)
//  3) isola o erro POR ENTIDADE — uma falha não derruba as outras
// Acumula o ImportReport (criados / pulados / erro).

import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadToBucket } from "@/lib/storage-tenant";
import { mensagemErro } from "@/lib/erro-mensagem";
import type {
  EntidadeAgregada,
  EntityImportDescriptor,
  ImportReport,
  ImportReportItem,
} from "./types";
import { ehDuplicata, gravaveis, temErroBloqueante } from "./aggregate";
import { alvosDeFoto, type AlvoFoto } from "./foto-match";

// Foto confirmada pelo usuário no match visual: chave do ALVO (entidade ou variante) → File.
export type FotosConfirmadas = Map<string, File>;

export type ProgressoCb = (feito: number, total: number, nomeAtual: string) => void;

const nomeDe = (e: EntidadeAgregada) => String(e.cabecalho.nome ?? e.chave);

/**
 * Executa a importação. Grava só as entidades sem erro e não-duplicata; as demais
 * entram no relatório como "pulado" (duplicata) — erros bloqueantes NÃO são enviados
 * (já foram sinalizados na análise) e também contam como pulados com o motivo.
 */
export async function importar(
  sb: SupabaseClient,
  desc: EntityImportDescriptor,
  entidades: EntidadeAgregada[],
  fotos: FotosConfirmadas,
  onProgress?: ProgressoCb,
): Promise<ImportReport> {
  const itens: ImportReportItem[] = [];
  let criados = 0;
  let pulados = 0;
  let erros = 0;

  const paraGravar = gravaveis(entidades);
  const total = paraGravar.length;

  // registra os pulados (duplicata / erro bloqueante) sem tentar gravar
  for (const e of entidades) {
    if (temErroBloqueante(e)) {
      const motivo = e.problemas.find((p) => p.nivel === "erro")?.mensagem ?? "Dados inválidos";
      itens.push({ chave: e.chave, nome: nomeDe(e), status: "pulado", motivo });
      pulados++;
    } else if (ehDuplicata(e)) {
      itens.push({ chave: e.chave, nome: nomeDe(e), status: "pulado", motivo: "Duplicata" });
      pulados++;
    }
  }

  // alvos por entidade (modo variante = 1 por cor; modo entidade = 1 por registro).
  const alvosPorEnt = new Map<string, AlvoFoto[]>();
  for (const a of alvosDeFoto(desc, paraGravar)) {
    const arr = alvosPorEnt.get(a.entChave) ?? [];
    arr.push(a);
    alvosPorEnt.set(a.entChave, arr);
  }
  const modoVariante = (desc.fotoModo ?? "entidade") === "variante";

  let feito = 0;
  for (const e of paraGravar) {
    onProgress?.(feito, total, nomeDe(e));
    try {
      // 1) foto(s) — SÓ na confirmação (sem lixo no storage se o usuário cancelar antes).
      let fotoPath: string | null = null;
      let fotoPathVariante: (string | null)[] | undefined;
      if (desc.temFoto && desc.bucket) {
        const alvos = alvosPorEnt.get(e.chave) ?? [];
        if (modoVariante) {
          fotoPathVariante = new Array(e.variantes.length).fill(null);
          for (const a of alvos) {
            const file = fotos.get(a.chave);
            if (file && a.varIdx != null) {
              fotoPathVariante[a.varIdx] = await uploadToBucket(desc.bucket, desc.fotoPrefix ?? "importacao", file);
            }
          }
        } else {
          const file = fotos.get(e.chave);
          if (file) fotoPath = await uploadToBucket(desc.bucket, desc.fotoPrefix ?? "importacao", file);
        }
      }
      // 2) RPC transacional
      await desc.rpc(sb, { ...e, fotoPath, fotoPathVariante });
      itens.push({ chave: e.chave, nome: nomeDe(e), status: "criado" });
      criados++;
    } catch (err) {
      // duplicata do banco (23505) vira "pulado"; o resto é "erro".
      const msg = mensagemErro(err, "Erro ao importar.");
      const dup = /duplicat|já exist|23505/i.test(String((err as { code?: string })?.code ?? "") + msg);
      if (dup) {
        itens.push({ chave: e.chave, nome: nomeDe(e), status: "pulado", motivo: "Duplicata" });
        pulados++;
      } else {
        itens.push({ chave: e.chave, nome: nomeDe(e), status: "erro", motivo: msg });
        erros++;
      }
    }
    feito++;
  }
  onProgress?.(feito, total, "");

  return { entidade: desc.entidade, criados, pulados, erros, itens };
}
