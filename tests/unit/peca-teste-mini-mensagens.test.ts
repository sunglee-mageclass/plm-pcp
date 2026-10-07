// R11 T5 — toda recusa `peca_teste_mini_*:` do banco (migrations 20261103199000..199400) tem texto PT em `mensagemErro`; 23503 dos ledgers;
// o texto do diálogo de estorno (verbatim, mockup v4 aprovado + P-365 A do dono).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MENSAGENS_PECA_TESTE, MENSAGENS_PECA_TESTE_MINI, TEXTO_ITEM_COM_BAIXA_PECA_TESTE, mensagemErro, mensagemFkBaixaPecaTeste, mensagemPecaTeste,
} from "@/lib/erro-mensagem";
import { textoEstornarERefazerPecaTeste, textoEstornarPecaTeste } from "@/lib/confirmacoes-textos";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const err = (code: string, message: string) => ({ code, message });

describe("mensagemErro — mini explosão da Peça Teste (R11)", () => {
  // [prefixo, SQLSTATE, mensagem EXATA do RAISE, texto PT VERBATIM]
  const CASOS: [string, string, string, string][] = [
    ["peca_teste_mini_travada", "P0001", "peca_teste_mini_travada: peca teste aprovada trava a mini", "Baixa feita: a mini explosão está travada. Para mudar, apague a Data de saída e salve (a baixa é estornada)."],
    ["peca_teste_mini_desatualizada", "P0409", "peca_teste_mini_desatualizada: a mini mudou; recarregue", "O BOM ou a mini explosão mudou — conferimos as quantidades; confira e salve de novo."],
    ["peca_teste_mini_formato", "P0001", "peca_teste_mini_formato: chaves da mini invalidas", "Não foi possível salvar a mini explosão: os dados enviados estão incompletos. Recarregue o card e tente de novo."],
    ["peca_teste_mini_tamanho_invalido", "P0001", "peca_teste_mini_tamanho_invalido: tamanho fora da grade da loja", "O tamanho escolhido na mini explosão não está na grade da loja. Escolha outro tamanho."],
    ["peca_teste_mini_variante_invalida", "P0001", "peca_teste_mini_variante_invalida: variante nao e do Tecido 1 do BOM", "A cor ou a variante escolhida na mini explosão não é mais do BOM deste produto. Escolha de novo."],
    ["peca_teste_mini_fonte_invalida", "P0001", "peca_teste_mini_fonte_invalida: item de OC invalido", "A OC ou o rolo escolhido na mini explosão não está disponível. Escolha de novo."],
    ["peca_teste_mini_sem_estoque", "P0001", "peca_teste_mini_sem_estoque: loja sem Entrada e Saida nao faz a baixa da peca teste", "A mini explosão (baixa de estoque da peça teste) precisa do módulo Entrada e Saída, que esta loja não tem."],
    ["peca_teste_mini_baixa_imutavel", "P0001", "peca_teste_mini_baixa_imutavel: baixa de peca teste nao se altera (estorno = linha nova)", "A baixa de estoque da peça teste não se altera nem se apaga: para desfazer, apague a Data de saída e salve (o estorno entra como nova linha)."],
  ];
  for (const [prefixo, code, msg, pt] of CASOS) {
    it(`${prefixo} (${code}) → texto PT`, () => {
      expect(mensagemErro(err(code, msg))).toBe(pt);
      expect(mensagemPecaTeste(code, msg)).toBe(pt);
      expect(MENSAGENS_PECA_TESTE_MINI[prefixo as keyof typeof MENSAGENS_PECA_TESTE_MINI]).toBe(pt);
      expect(pt).not.toMatch(/peca_teste_/);
    });
  }

  it("o P0409 da mini ganha o texto próprio (não o genérico de P0409)", () => {
    expect(mensagemErro(err("P0409", "peca_teste_mini_desatualizada: x"))).not.toBe(mensagemErro(err("P0409", "conflito_versao: modelo")));
  });

  it("os textos da R9 seguem iguais (a mini não sobrescreve nenhum)", () => {
    expect(Object.keys(MENSAGENS_PECA_TESTE).filter((k) => k in MENSAGENS_PECA_TESTE_MINI)).toEqual([]);
    expect(mensagemErro(err("P0001", "peca_teste_historico: x"))).toBe("Tentativa reprovada é só leitura.");
  });

  it("prefixo da mini com SQLSTATE inesperado cai no caminho de sempre", () => {
    expect(mensagemPecaTeste("23505", "peca_teste_mini_travada: x")).toBeNull();
  });
});

describe("23503 dos ledgers de estoque (aviamento/variante/insumo/cor com baixa de peça teste)", () => {
  const FKS = ["aviamento_id", "variante_aviamento_id", "etiqueta_id", "cor_id"];
  for (const col of FKS) {
    const tabela = { aviamento_id: "aviamentos", variante_aviamento_id: "variantes_aviamento", etiqueta_id: "etiquetas", cor_id: "cores" }[col];
    it(`excluir ${tabela} (FK ${col}) → "Este item tem baixa de peça teste registrada…"`, () => {
      const msg = `update or delete on table "${tabela}" violates foreign key constraint "estoque_peca_teste_baixas_${col}_fkey" on table "estoque_peca_teste_baixas"`;
      expect(mensagemErro(err("23503", msg))).toBe("Este item tem baixa de peça teste registrada e não pode ser excluído.");
      expect(mensagemFkBaixaPecaTeste("23503", msg)).toBe(TEXTO_ITEM_COM_BAIXA_PECA_TESTE);
    });
  }
  it("INSERT que viola a FK do ledger NÃO diz que 'não pode ser excluído'; outro SQLSTATE ou outra FK segue o caminho de sempre", () => {
    const ins = 'insert or update on table "estoque_peca_teste_baixas" violates foreign key constraint "estoque_peca_teste_baixas_cor_id_fkey"';
    expect(mensagemFkBaixaPecaTeste("23503", ins)).toBeNull();
    expect(mensagemFkBaixaPecaTeste("23505", 'update or delete on table "cores" violates foreign key constraint "estoque_peca_teste_baixas_cor_id_fkey"')).toBeNull();
    expect(mensagemErro(err("23503", 'update or delete on table "cores" violates foreign key constraint "outra_fkey" on table "x"'))).toContain("em uso por outros dados");
  });
  it("as 4 FKs existem na migration 199000 com o nome que o Postgres gera (anti-drift do regex)", () => {
    const sql = readFileSync(ROOT + "supabase/migrations/20261103199000_urg_r11_mini_tabelas.sql", "utf8");
    for (const c of ["aviamento_id uuid REFERENCES public.aviamentos", "variante_aviamento_id uuid REFERENCES public.variantes_aviamento", "etiqueta_id uuid REFERENCES public.etiquetas", "cor_id uuid REFERENCES public.cores"]) {
      expect(sql).toContain(c);
    }
  });
});

describe("anti-drift: todo código peca_teste_mini_* do banco está traduzido", () => {
  const pasta = ROOT + "supabase/migrations/";
  const arquivos = readdirSync(pasta).filter((f) => /^202611031(99[0-4])00_.*\.sql$/.test(f));
  it("as 5 migrations da R11 (199000..199400) existem", () => {
    expect(arquivos.length).toBe(5);
  });
  it("cada `RAISE EXCEPTION 'peca_teste_mini_xxx:` das migrations tem entrada em MENSAGENS_PECA_TESTE_MINI (e vice-versa)", () => {
    const usados = new Set<string>();
    for (const f of arquivos) {
      const sql = readFileSync(pasta + f, "utf8");
      for (const m of sql.matchAll(/RAISE EXCEPTION\s+'(peca_teste_mini_[a-z_]+):/g)) usados.add(m[1]);
    }
    expect([...usados].sort()).toEqual(Object.keys(MENSAGENS_PECA_TESTE_MINI).sort());
  });
  it("todo outro `peca_teste_*` levantado nas 199xxx já está em MENSAGENS_PECA_TESTE (R9)", () => {
    for (const f of arquivos) {
      const sql = readFileSync(pasta + f, "utf8");
      for (const m of sql.matchAll(/RAISE EXCEPTION\s+'(peca_teste_(?!mini_)[a-z_]+):/g)) expect(Object.keys(MENSAGENS_PECA_TESTE)).toContain(m[1]);
    }
  });
});

describe("textos do diálogo de estorno (verbatim)", () => {
  it("textoEstornarPecaTeste — mockup v4 aprovado", () => {
    expect(textoEstornarPecaTeste(["PL · tentativa 2"])).toEqual({
      titulo: "Estornar a baixa da peça teste?",
      descricao: "Salvar vai estornar a baixa de estoque da peça teste (PL · tentativa 2): o material baixado volta ao estoque. Para fazer a baixa de novo, preencha a Data de saída e salve.",
      confirmar: "Estornar e salvar",
      cancelar: "Cancelar",
      destrutivo: true,
    });
  });
  it("vários itens se juntam com “; ” (como o mockup) e a lista vazia some o parêntese", () => {
    expect(textoEstornarPecaTeste(["PL · tentativa 1", "Costura · tentativa 3"]).descricao).toContain("peça teste (PL · tentativa 1; Costura · tentativa 3): o material");
    expect(textoEstornarPecaTeste([]).descricao).toBe("Salvar vai estornar a baixa de estoque da peça teste: o material baixado volta ao estoque. Para fazer a baixa de novo, preencha a Data de saída e salve.");
    expect(textoEstornarPecaTeste(["", "  "]).descricao).not.toContain("()");
  });
  it("textoEstornarERefazerPecaTeste — Q2 = A (P-365 A): mesmo título/botões, corpo do Q2", () => {
    expect(textoEstornarERefazerPecaTeste(["PL · tentativa 1"])).toEqual({
      titulo: "Estornar a baixa da peça teste?",
      descricao: "Salvar vai estornar a baixa de estoque da peça teste (PL · tentativa 1) e fazer a baixa de novo com as quantidades novas.",
      confirmar: "Estornar e salvar",
      cancelar: "Cancelar",
      destrutivo: true,
    });
  });
});
