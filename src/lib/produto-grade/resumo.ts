// Resumo (toast) do Salvar da grade "Lista" do Planejamento de Produto (PURO): junta o resultado de CADA linha — salvou, conflito (P0409,
// outra pessoa salvou antes), erro — e os campos que a Integração travou e NÃO foram enviados. Resultado PARCIAL é normal: uma linha
// com problema nunca derruba as outras.
import type { OmissaoProduto } from "./salvar";

/** Como terminou o Salvar de UMA linha. */
export type ResultadoLinha = {
  id: string;
  nome: string;
  tipo: "ok" | "conflito" | "erro";
  /** `ok` + `enviou:false` = tudo o que a pessoa mexeu estava travado/sem permissão: nada foi ao servidor. */
  enviou?: boolean;
  omitidas?: OmissaoProduto[];
};

export type ResumoSalvar = { tom: "sucesso" | "aviso" | "erro"; texto: string; detalhe?: string };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Até 3 nomes; o resto vira "e mais N". */
function listar(itens: readonly string[]): string {
  if (itens.length <= 3) return itens.join("; ");
  return `${itens.slice(0, 3).join("; ")} e mais ${itens.length - 3}`;
}

export function resumoSalvar(rs: readonly ResultadoLinha[]): ResumoSalvar {
  const salvos = rs.filter((r) => r.tipo === "ok" && r.enviou !== false).length;
  const conflitos = rs.filter((r) => r.tipo === "conflito").length;
  const erros = rs.filter((r) => r.tipo === "erro").length;
  const falhas = conflitos + erros;
  const travadas = rs.flatMap((r) =>
    (r.omitidas ?? []).filter((o) => o.motivo === "travada").map((o) => `${r.nome} (${o.rotulo})`),
  );

  const partes: string[] = [];
  if (conflitos > 0) {
    partes.push(
      `${plural(conflitos, "produto foi salvo", "produtos foram salvos")} por outra pessoa antes: a linha foi atualizada — confira as suas alterações e salve de novo.`,
    );
  }
  if (erros > 0)
    partes.push(
      `${plural(erros, "linha não salvou", "linhas não salvaram")} — veja o aviso vermelho na própria linha.`,
    );
  if (travadas.length > 0) {
    partes.push(`Travado pela Integração (não enviado): ${listar(travadas)}.`);
  }
  const detalhe = partes.length > 0 ? partes.join(" ") : undefined;

  if (falhas > 0) {
    const texto =
      salvos > 0
        ? `${plural(salvos, "produto salvo", "produtos salvos")}; ${plural(falhas, "não salvou", "não salvaram")}.`
        : falhas === 1
          ? "O produto não foi salvo."
          : `${falhas} produtos não foram salvos.`;
    return { tom: salvos > 0 ? "aviso" : "erro", texto, detalhe };
  }
  if (salvos > 0) {
    return {
      tom: travadas.length > 0 ? "aviso" : "sucesso",
      texto: salvos === 1 ? "1 produto salvo." : `${salvos} produtos salvos.`,
      detalhe,
    };
  }
  return { tom: "aviso", texto: "Nada foi enviado ao servidor.", detalhe };
}
