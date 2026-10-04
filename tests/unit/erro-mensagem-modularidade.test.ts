// [modularidade F1] Mensagens novas do servidor viram texto PT na tela: `modulo_desligado: a,b` (42501), o texto LEGADO
// "Módulo X não habilitado…" (T1 review M3), `colecao_com_cards: N` (P0001) e o 23503 da coleção ligada só por produto
// acabado/importado (T2 review m2). Os RAISE abaixo são os EXATOS do banco; a última asserção confere banco × tela.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mensagemErro } from "@/lib/erro-mensagem";

const FALE = "fale com o administrador do sistema.";

describe("erro-mensagem — Modularidade", () => {
  it("modulo_desligado: uma chave → 'precisa do módulo X'", () => {
    expect(mensagemErro({ code: "42501", message: "modulo_desligado: entrada_saida" }, "fb")).toBe(`Esta ação precisa do módulo Entrada e Saída — ${FALE}`);
    expect(mensagemErro({ code: "42501", message: "modulo_desligado: dashboard" }, "fb")).toBe(`Esta ação precisa do módulo Dashboard — ${FALE}`);
  });

  it("modulo_desligado: várias chaves → plural, na ordem do servidor", () => {
    expect(mensagemErro({ code: "42501", message: "modulo_desligado: criacao,producao" }, "fb")).toBe(`Esta ação precisa dos módulos Criação e Produção — ${FALE}`);
    expect(mensagemErro({ code: "42501", message: "modulo_desligado: criacao,entrada_saida,otb" }, "fb")).toBe(
      `Esta ação precisa dos módulos Criação, Entrada e Saída e OTB — ${FALE}`,
    );
  });

  it("modulo_desligado: chave desconhecida vira a própria chave; lista vazia cai no genérico de permissão", () => {
    expect(mensagemErro({ code: "42501", message: "modulo_desligado: modulo_novo" }, "fb")).toBe(`Esta ação precisa do módulo modulo_novo — ${FALE}`);
    expect(mensagemErro({ code: "42501", message: "modulo_desligado: " }, "fb")).toBe("Você não tem permissão para esta ação.");
  });

  it("texto LEGADO das checagens antigas (chave interna ou nome em PT)", () => {
    expect(mensagemErro({ code: "42501", message: "Módulo criacao não habilitado para esta loja" }, "fb")).toBe(`Esta ação precisa do módulo Criação — ${FALE}`);
    expect(mensagemErro({ code: "42501", message: "Módulo criação não habilitado" }, "fb")).toBe(`Esta ação precisa do módulo Criação — ${FALE}`);
    expect(mensagemErro({ code: "42501", message: "Módulo entrada_saida não habilitado" }, "fb")).toBe(`Esta ação precisa do módulo Entrada e Saída — ${FALE}`);
    expect(mensagemErro({ code: "42501", message: "Módulo otb não habilitado para esta loja" }, "fb")).toBe(`Esta ação precisa do módulo OTB — ${FALE}`);
    expect(mensagemErro({ code: "42501", message: "Módulo producao não habilitado para esta loja" }, "fb")).toBe(`Esta ação precisa do módulo Produção — ${FALE}`);
    expect(mensagemErro({ code: "42501", message: "Módulo Produto Acabado (Revenda) não habilitado para esta loja" }, "fb")).toBe(
      `Esta ação precisa do módulo Produto Acabado (Revenda) — ${FALE}`,
    );
  });

  it("o texto legado só vale em 42501 (outro código não é traduzido por aqui)", () => {
    expect(mensagemErro({ code: "P0001", message: "Módulo criacao não habilitado para esta loja" }, "fb")).toBe("Módulo criacao não habilitado para esta loja");
  });

  it("colecao_com_cards: N → quantos cards seguram a coleção", () => {
    expect(mensagemErro({ code: "P0001", message: "colecao_com_cards: 3" }, "fb")).toBe(
      "Esta coleção tem 3 cards no Planejamento — mova ou exclua os cards antes de excluir a coleção.",
    );
    expect(mensagemErro({ code: "P0001", message: "colecao_com_cards: 1" }, "fb")).toBe(
      "Esta coleção tem 1 card no Planejamento — mova ou exclua os cards antes de excluir a coleção.",
    );
    expect(mensagemErro({ code: "P0001", message: "colecao_com_cards: x" }, "fb")).toBe(
      "Esta coleção tem cards no Planejamento — mova ou exclua os cards antes de excluir a coleção.",
    );
  });

  it("23503 ao excluir coleção ligada só por produto acabado/importado → texto PT próprio", () => {
    const esperado = "Esta coleção está em uso por produto(s) acabado(s) ou importado(s) — mova ou exclua esses produtos antes de excluir a coleção.";
    expect(mensagemErro({ code: "23503", message: 'update or delete on table "colecoes" violates foreign key constraint "produtos_acabados_colecao_id_fkey" on table "produtos_acabados"' }, "fb")).toBe(esperado);
    expect(mensagemErro({ code: "23503", message: 'update or delete on table "colecoes" violates foreign key constraint "produtos_importados_colecao_id_fkey" on table "produtos_importados"' }, "fb")).toBe(esperado);
  });

  it("23503 da FK dos cards (corrida: card chegou depois da trava) → texto de cards; demais 23503 seguem o genérico", () => {
    expect(mensagemErro({ code: "23503", message: 'update or delete on table "colecoes" violates foreign key constraint "modelos_colecao_id_fkey" on table "modelos"' }, "fb")).toBe(
      "Esta coleção tem cards no Planejamento — mova ou exclua os cards antes de excluir a coleção.",
    );
    expect(mensagemErro({ code: "23503", message: 'insert or update on table "produtos_acabados" violates foreign key constraint "produtos_acabados_colecao_id_fkey"' }, "fb")).toBe(
      "Não é possível concluir: este registro está em uso por outros dados. Remova ou troque os vínculos antes.",
    );
    expect(mensagemErro({ code: "23503", message: 'update or delete on table "artigos" violates foreign key constraint "x_fkey" on table "y"' }, "fb")).toBe(
      "Não é possível concluir: este registro está em uso por outros dados. Remova ou troque os vínculos antes.",
    );
  });

  it("anti-drift banco × tela: os prefixos existem nas migrations da frente", () => {
    const t1 = readFileSync("supabase/migrations/20261103100000_mod_gates_rpcs.sql", "utf8");
    const t2 = readFileSync("supabase/migrations/20261103110000_mod_lancar_colecao.sql", "utf8");
    expect(t1).toContain("RAISE EXCEPTION 'modulo_desligado: %'");
    expect(t1).toContain("'Módulo criacao não habilitado para esta loja'");
    expect(t2).toContain("raise exception 'colecao_com_cards: %'");
    // e o nome das FKs que a tela reconhece é o do schema vivo (nomes padrão do Postgres: <tabela>_<coluna>_fkey)
    const src = readFileSync("src/lib/erro-mensagem.ts", "utf8");
    expect(src).toContain("(produtos_acabados|produtos_importados|modelos)_colecao_id_fkey");
  });
});
