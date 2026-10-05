// Backend B5 (P-258 A, migration 20261103148000_bk_otb_pagina): gravar o OTB exige EDITAR a página OTB também no servidor (gatilho
// das 12 tabelas do OTB + as 9 RPCs DEFINER). Na tela, quem só VÊ o OTB não tem botão de gravar ativo: os botões da página
// (Importar, Nova coleção — desktop E barra do celular) ficam desabilitados por `useReadOnly()`, e os Sheets/diálogos do OTB já
// travam pelo ReadOnlyContext (fieldset do SheetContent/DialogContent; AlertDialogAction desabilitado). Anti-drift por fonte:
// (1) os botões levam `readOnly`; (2) as gravações do OTB moram DENTRO de Sheet/diálogo (sem portal/Popover que escape do
// fieldset); (3) toda RPC que a tela do OTB chama é de LEITURA conhecida ou está na lista que o servidor tranca (bk-5-dados);
// (4) a recusa do servidor vira texto PT.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mensagemErro } from "@/lib/erro-mensagem";
import { BK5_RPCS, BK5_INVOKER } from "../integration/bk-5-dados";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (p: string) => readFileSync(ROOT + p, "utf8");
const PAGINA = "src/routes/_authenticated/otb.index.tsx";
const SHEETS = [
  "src/components/otb/ColecaoSheet.tsx",
  "src/components/otb/ColecaoPVSheet.tsx",
  "src/components/otb/PadraoMixSheet.tsx",
];
const DIALOGO_EXCLUIR = "src/components/otb/ExcluirColecaoDialog.tsx";
/** RPCs de LEITURA que a tela do OTB chama (sem portão de página no servidor, de propósito). */
const LEITURAS = new Set(["custo_unitario_modelos", "otb_orcamento"]);
const nome = (sig: string) => sig.replace(/^public\./, "").replace(/\(.*$/, "");

describe("OTB — modo só leitura (Backend B5, P-258 A)", () => {
  it("a página fica atrás de RequirePermission page='otb' e os 4 botões que gravam (desktop + celular) levam readOnly", () => {
    const src = ler(PAGINA);
    expect(src).toMatch(/<RequirePermission page="otb">/);
    expect(src).toMatch(/const readOnly = useReadOnly\(\);/);
    // Importar coleções existentes (desktop e MobileActionBar) e Nova coleção (desktop e MobileActionBar)
    expect(
      src.split(
        "onClick={() => setConfirmImportar(true)} disabled={readOnly || importar.isPending}",
      ).length - 1,
    ).toBe(2);
    expect(src.split("onClick={() => setTipoOpen(true)} disabled={readOnly}").length - 1).toBe(2);
    // nenhum outro gatilho de gravação solto na página
    expect(src.split("setConfirmImportar(true)").length - 1).toBe(2);
    expect(src.split("setTipoOpen(true)").length - 1).toBe(2);
    // o "Importar" do AlertDialog é AlertDialogAction (desabilitado pelo ReadOnlyContext)
    expect(src).toMatch(
      /<AlertDialogAction onClick=\{\(\) => importar\.mutate\(\)\}>Importar<\/AlertDialogAction>/,
    );
  });

  it("os Sheets do OTB gravam só DENTRO do SheetContent (fieldset do ReadOnlyContext): sem portal/Popover/MobileActionBar", () => {
    expect(ler("src/components/ui/sheet.tsx")).toMatch(
      /<fieldset disabled=\{readOnly\} className="contents">/,
    );
    expect(ler("src/components/ui/dialog.tsx")).toMatch(
      /<fieldset disabled=\{readOnly\} className="contents">/,
    );
    expect(ler("src/components/ui/alert-dialog.tsx")).toMatch(
      /disabled=\{disabled \|\| readOnly\}/,
    );
    for (const f of SHEETS) {
      const src = ler(f);
      expect(src, f).toMatch(/<SheetContent/);
      expect(src, f).not.toMatch(
        /createPortal|<Popover|<MobileActionBar|<PageActionBar|<DropdownMenu/,
      );
    }
    // excluir coleção: confirmação pelo AlertDialogAction (desabilitado para quem só vê)
    expect(ler(DIALOGO_EXCLUIR)).toMatch(/<AlertDialogAction\s+variant="destructive"/);
  });

  it("anti-drift: toda RPC da tela do OTB é leitura conhecida ou está trancada pelo servidor (B5: 9 DEFINER + 6 INVOKER pelo gatilho)", () => {
    const trancadas = new Set([...BK5_RPCS, ...BK5_INVOKER].map(nome));
    const chamadas = new Set<string>();
    for (const f of [PAGINA, ...SHEETS, DIALOGO_EXCLUIR]) {
      for (const m of ler(f).matchAll(/\.rpc\("([a-z_]+)"/g)) chamadas.add(m[1]);
    }
    expect(chamadas.size).toBeGreaterThan(0);
    for (const r of chamadas)
      expect(LEITURAS.has(r) || trancadas.has(r), `RPC ${r} sem portão de página no servidor`).toBe(
        true,
      );
    // e a tela não grava tabela direto (só lê): nenhuma cadeia supabase.from(...) até o ';' tem insert/update/delete/upsert
    for (const f of [PAGINA, ...SHEETS]) {
      const cadeias = [...ler(f).matchAll(/supabase\s*\.from\(([^)]*)\)([^;]*)/g)];
      expect(cadeias.length, f).toBeGreaterThan(0);
      for (const m of cadeias)
        expect(m[2], `${f}: ${m[1]}`).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    }
  });

  it("a recusa do servidor (42501 sem_permissao_pagina: otb) vira texto PT", () => {
    expect(mensagemErro({ code: "42501", message: "sem_permissao_pagina: otb" }, "fb")).toBe(
      "Você não tem permissão para editar OTB › OTB. Peça ao administrador da loja.",
    );
  });
});
