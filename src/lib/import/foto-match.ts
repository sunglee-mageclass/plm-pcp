// Casamento de FOTO por NOME do produto (não REF — a REF de revenda só existe após criar).
//
// O usuário sobe imagens SOLTAS (multi-select, sem ZIP) nomeadas `<nome>_Modelo`,
// `<nome>_Referencia`, `<nome>_Desenho`. Casamos o nome do arquivo (sem extensão, sem
// sufixo, normalizado) com o nome do produto (normalizado). Puro/testável.
//
// ⚠️ `normalizeCat` só remove acento/caixa e faz trim das PONTAS — NÃO remove espaços
// internos. "Malha Fiore" → "malha fiore" nos DOIS lados (nome do produto e nome do
// arquivo), então o casamento é consistente; o arquivo tem de repetir o nome do produto
// com os mesmos espaços (ex.: "Malha Fiore_Modelo.jpg", não "MalhaFiore_Modelo.jpg").

import { normalizeCat } from "@/lib/fornecedor-categoria";
import type { EntidadeAgregada, EntityImportDescriptor } from "./types";

export type FotoTipo = "modelo" | "referencia" | "desenho" | "outro";

// Sufixos reconhecidos (sem acento/caixa). "modelo" = foto principal.
const SUFIXOS: Record<string, FotoTipo> = {
  modelo: "modelo",
  referencia: "referencia",
  desenho: "desenho",
};

export type FotoParse = {
  arquivo: string; // nome original do arquivo
  nomeNorm: string; // nome do produto normalizado (sem extensão/sufixo)
  tipo: FotoTipo;
};

/** Remove a extensão (.png/.jpeg/...) do fim do nome. */
function tirarExtensao(nome: string): string {
  return nome.replace(/\.[a-z0-9]{1,5}$/i, "");
}

/**
 * Extrai (nomeNorm, tipo) de um nome de arquivo.
 * "Malha Fiore_Referencia.jpg" → { nomeNorm: "malhafiore", tipo: "referencia" }
 * "Vestal.png"                 → { nomeNorm: "vestal",     tipo: "modelo" }  (sem sufixo = principal)
 */
export function parseNomeFoto(arquivo: string): FotoParse {
  const semExt = tirarExtensao(arquivo);
  // separa o último "_sufixo" se ele for um sufixo conhecido.
  const idx = semExt.lastIndexOf("_");
  let base = semExt;
  let tipo: FotoTipo = "modelo"; // sem sufixo = foto principal
  if (idx >= 0) {
    const sufixoNorm = normalizeCat(semExt.slice(idx + 1));
    const conhecido = SUFIXOS[sufixoNorm];
    if (conhecido) {
      base = semExt.slice(0, idx);
      tipo = conhecido;
    }
  }
  return { arquivo, nomeNorm: normalizeCat(base), tipo };
}

export type MatchFoto = {
  chave: string; // chave natural do produto (nome normalizado)
  nomeProduto: string; // nome exibido
  fotos: FotoParse[]; // fotos que casaram por nome (pode ter modelo/referencia/desenho)
  principal: FotoParse | null; // a foto tipo "modelo" (ou a 1ª), usada como foto_url
};

// Um "alvo" de foto = a coisa que recebe UMA foto. No modo "entidade" é o registro inteiro
// (chave = nome do produto); no modo "variante" é cada cor (chave = Nome_CorApelido). O `ref`
// diz ao engine ONDE gravar: entidade (entChave) e, se variante, o índice da variante.
export type AlvoFoto = {
  chave: string; // chave de casamento (normalizada) com o nome do arquivo
  rotulo: string; // texto exibido no match visual (ex.: "Malha Fiore · Azul/Petróleo")
  entChave: string; // chave natural da entidade dona
  varIdx: number | null; // índice da variante (modo variante) ou null (modo entidade)
};

/**
 * Casa a lista de fotos com a lista de ALVOS (por nome normalizado). Devolve, por alvo, as fotos
 * que bateram + a principal escolhida. `orfas` = fotos que não casaram com nenhum alvo (aviso).
 * Aceita alvos {chave, nome} (entidade) OU AlvoFoto (variante) — usa `chave`/`nome`||`rotulo`.
 */
export function casarFotos(
  produtos: { chave: string; nome?: string; rotulo?: string }[],
  arquivos: string[],
): { matches: MatchFoto[]; orfas: FotoParse[] } {
  const parsed = arquivos.map(parseNomeFoto);
  const porNome = new Map<string, FotoParse[]>();
  for (const p of parsed) {
    const arr = porNome.get(p.nomeNorm) ?? [];
    arr.push(p);
    porNome.set(p.nomeNorm, arr);
  }
  const usados = new Set<string>();
  const matches: MatchFoto[] = produtos.map((prod) => {
    const fotos = porNome.get(prod.chave) ?? [];
    fotos.forEach((f) => usados.add(f.arquivo));
    const principal = fotos.find((f) => f.tipo === "modelo") ?? fotos[0] ?? null;
    return { chave: prod.chave, nomeProduto: prod.rotulo ?? prod.nome ?? prod.chave, fotos, principal };
  });
  const orfas = parsed.filter((f) => !usados.has(f.arquivo));
  return { matches, orfas };
}

/** Rótulo humano de uma variante p/ o match visual (cor / apelido crus do resolve). */
function rotuloVariante(nome: string, v: Record<string, unknown>): string {
  const cor = String(v._corNome ?? "").trim();
  const ap = String(v._apelidoNome ?? "").trim();
  const corTxt = ap ? `${cor}/${ap}` : cor || "cor";
  return `${nome} · ${corTxt}`;
}

/**
 * Monta os ALVOS de foto conforme o fotoModo do descritor:
 *  - "variante": 1 alvo por variante de cada entidade (chave = descriptor.chaveFotoVariante).
 *  - "entidade" (default): 1 alvo por entidade (chave = chave natural / nome).
 */
export function alvosDeFoto(desc: EntityImportDescriptor, entidades: EntidadeAgregada[]): AlvoFoto[] {
  const alvos: AlvoFoto[] = [];
  const modo = desc.fotoModo ?? "entidade";
  for (const ent of entidades) {
    const nome = String(ent.cabecalho.nome ?? ent.chave);
    if (modo === "variante" && desc.chaveFotoVariante) {
      ent.variantes.forEach((v, i) => {
        alvos.push({
          chave: desc.chaveFotoVariante!(ent, i),
          rotulo: rotuloVariante(nome, v as Record<string, unknown>),
          entChave: ent.chave,
          varIdx: i,
        });
      });
    } else {
      alvos.push({ chave: ent.chave, rotulo: nome, entChave: ent.chave, varIdx: null });
    }
  }
  return alvos;
}
