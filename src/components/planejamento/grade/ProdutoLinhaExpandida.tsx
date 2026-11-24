// Conteúdo da linha EXPANDIDA do produto na Lista tipo Excel: as CORES do modelo + a matriz cor × tamanho (quantidades).
//  - PR-GRADE-1: leitura (carregamento sob demanda — este componente só é MONTADO quando a linha é expandida; o hook só consulta o banco aí).
//  - PR-GRADE-2: a REVENDA EDITA aqui (rascunho + Salvar da Lista → RPC dedicada `salvar_grade_revenda`, a do Sheet). INTERNO e IMPORTADO
//    ficam SÓ-LEITURA + botão "abrir no Sheet na seção da grade": gravam pelo `salvar_modelo_bom`, que APAGA e reinsere o BOM inteiro —
//    editar só a grade pela lista reconstruiria a ficha (frágil, pode apagar o BOM). As CORES do produto também se mexem só no Sheet.
import { useMemo } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/shared/NumberInput";
import { useTenantModules } from "@/hooks/useTenantModules";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";
import { ehOrigemComprada, normalizarOrigem } from "@/lib/origem";
import type { ModeloGradeEntrada } from "@/lib/produto-grade/linhas";
import {
  gradeEditavelNaLista,
  motivoGradeRevendaSomenteLeitura,
  secaoGradeDaOrigem,
  TEXTO_ABRIR_SHEET_GRADE,
} from "@/lib/produto-grade/grade-revenda";
import type { SalvarCtx } from "./ProdutosGradeTabela";
import { useProdutoGradeTamanhos, type GradeTamanhosProduto } from "./useProdutoGradeTamanhos";
import { useRascunhoGradeRevenda } from "./useRascunhoGradeRevenda";

const MODULO_POR_ORIGEM = { revenda: "produto_acabado", importado: "produto_importado" } as const;
const TELA_POR_ORIGEM = { revenda: "Produto Acabado", importado: "Produto Importado" } as const;

export function ProdutoLinhaExpandida({
  modelo,
  acessorio,
  salvar,
  readOnly,
  canEdit,
  abrirNoSheet,
  onSujoChange,
}: {
  modelo: ModeloGradeEntrada;
  /** Grupo do produto (SALVO) = Acessórios → grade única "UN". */
  acessorio: boolean;
  /** Contexto do Salvar da Aba (o Salvar da grade da revenda reporta e relê por ele). */
  salvar: SalvarCtx;
  /** A tela inteira está só-leitura (sem permissão de editar). */
  readOnly: boolean;
  canEdit: (chave: string) => boolean;
  /** Abre o Sheet do produto já na seção pedida (`undefined` = sem o botão). */
  abrirNoSheet?: (modeloId: string, secao: string) => void;
  /** Rascunho da grade (revenda) em edição? A linha-mãe usa para não deixar recolher com alterações não salvas. */
  onSujoChange?: (sujo: boolean) => void;
}) {
  const origem = normalizarOrigem(modelo.origem);
  const comprado = ehOrigemComprada(origem);
  const { isModuleEnabled } = useTenantModules();
  // Comprado sem o módulo da origem: a RLS esconde o produto SEM erro ("vazio" não prova nada) — não consulta e avisa.
  const moduloOn =
    !comprado || isModuleEnabled(MODULO_POR_ORIGEM[origem as "revenda" | "importado"]);
  const g = useProdutoGradeTamanhos({
    modeloId: modelo.id,
    origem: modelo.origem,
    tamanhoTipo: modelo.tamanho_tipo,
    acessorio,
    enviadoCad: modelo.enviado_cad,
    ativo: moduloOn,
  });
  const tela = comprado ? TELA_POR_ORIGEM[origem as "revenda" | "importado"] : null;
  const editavelNaLista = gradeEditavelNaLista(origem);
  // Revenda: por que NÃO edita (permissão/tela só-leitura/enviado à Explosão). `null` = edita.
  const motivoRevenda = editavelNaLista
    ? motivoGradeRevendaSomenteLeitura({ readOnly, enviadoCad: modelo.enviado_cad, canEdit })
    : null;
  const nomeModelo = modelo.nome?.trim() || "(sem nome)";

  let corpo;
  if (!moduloOn) {
    corpo = (
      <p className="text-sm text-muted-foreground">
        O módulo {tela} está desligado nesta loja — a grade deste produto não é lida aqui.
      </p>
    );
  } else if (g.erro) {
    corpo = (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
        <span>Não foi possível carregar a grade deste produto.</span>
        <button type="button" className="underline" onClick={() => void g.recarregar()}>
          Tentar de novo
        </button>
      </div>
    );
  } else if (g.carregando) {
    corpo = <p className="text-sm text-muted-foreground">Carregando a grade…</p>;
  } else if (g.semProduto) {
    corpo = (
      <p className="text-sm text-muted-foreground">
        Este card ainda não tem produto vinculado no {tela} — salve o card (com Grupo e Categoria)
        para o sistema criá-lo.
      </p>
    );
  } else if (g.cores.length === 0) {
    corpo = (
      <p className="text-sm text-muted-foreground">
        {comprado
          ? `O produto vinculado ainda não tem variantes de cor — cadastre-as no ${tela}.`
          : "Este produto ainda não tem cores: escolha as variantes do Tecido 1 no card."}
      </p>
    );
  } else if (g.tamanhos.length === 0) {
    corpo = (
      <p className="text-sm text-muted-foreground">
        {comprado
          ? `Defina a proporção de tamanhos deste produto no ${tela} antes de preencher a grade.`
          : "Nenhum tamanho configurado para a grade desta loja."}
      </p>
    );
  } else {
    corpo = editavelNaLista ? (
      <MatrizGradeRevenda
        modelo={modelo}
        nome={nomeModelo}
        g={g}
        salvar={salvar}
        motivo={motivoRevenda}
        onSujoChange={onSujoChange}
      />
    ) : (
      <MatrizSomenteLeitura g={g} />
    );
  }

  // Aviso do estado da grade: revenda editável = instrução; o resto = o motivo (ou o padrão) de ser só-leitura.
  const nota = editavelNaLista
    ? (motivoRevenda ??
      "Edite as quantidades e use Salvar (barra de baixo) — nada grava antes disso.")
    : (g.motivoSomenteLeitura ??
      "Somente leitura na lista — para alterar a grade, abra o produto no Sheet.");
  const mostraBotao = !!abrirNoSheet && moduloOn;

  return (
    <div className="space-y-2 p-3" data-testid="produto-linha-expandida" data-origem={origem}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">
          Grade de tamanhos
          <span className="ml-2 font-normal text-muted-foreground">
            {comprado ? `cores do ${tela}` : "cores = variantes do Tecido 1"}
          </span>
        </p>
        {mostraBotao && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto h-7 gap-1.5 px-2 text-xs"
            data-abrir-sheet-grade
            onClick={() => abrirNoSheet?.(modelo.id, secaoGradeDaOrigem(modelo.origem))}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {editavelNaLista ? "Abrir no Sheet (cores e demais dados)" : TEXTO_ABRIR_SHEET_GRADE}
          </Button>
        )}
      </div>
      <p
        className="text-xs text-muted-foreground"
        data-testid={editavelNaLista && !motivoRevenda ? "grade-editavel" : "grade-somente-leitura"}
      >
        {nota}
      </p>
      {corpo}
    </div>
  );
}

/** Rótulos/colunas esmaecidas do hook → props da matriz (a mesma tradução para a leitura e para a edição). */
function propsColunas(g: GradeTamanhosProduto) {
  const rotulos = new Map(g.colunas.map((c) => [c.chave, c.rotulo]));
  const esmaecidos = new Set(g.colunas.filter((c) => c.esmaecido).map((c) => c.chave));
  return {
    variantes: g.cores.map((c) => ({ num: c.num, label: c.label })),
    rotuloTamanho: (t: string) => rotulos.get(t) ?? t,
    cellClass: (_num: number, t: string) => (esmaecidos.has(t) ? "opacity-50" : ""),
  };
}

/** Interno/importado (e o fallback): leitura pura. */
function MatrizSomenteLeitura({ g }: { g: GradeTamanhosProduto }) {
  return (
    <MatrizGradeResponsiva
      tamanhos={g.tamanhos}
      {...propsColunas(g)}
      renderCell={(num, t) => {
        const qtd = g.gradePorCor[num]?.[t] ?? 0;
        return (
          <span
            className={`block px-2 py-1 text-center tabular-nums ${qtd > 0 ? "" : "text-muted-foreground"}`}
            data-qtd={`${num}:${t}`}
          >
            {qtd}
          </span>
        );
      }}
      total={(num) =>
        g.gradeTotal[num] ?? Object.values(g.gradePorCor[num] ?? {}).reduce((s, v) => s + v, 0)
      }
      emptyLabel="Sem cores."
    />
  );
}

/** REVENDA: matriz EDITÁVEL (rascunho + selo âmbar; o Salvar é o da Lista). Travada (`motivo`) = leitura com o motivo na célula. */
function MatrizGradeRevenda({
  modelo,
  nome,
  g,
  salvar,
  motivo,
  onSujoChange,
}: {
  modelo: ModeloGradeEntrada;
  nome: string;
  g: GradeTamanhosProduto;
  salvar: SalvarCtx;
  motivo: string | null;
  onSujoChange?: (sujo: boolean) => void;
}) {
  const nums = useMemo(() => g.cores.map((c) => c.num), [g.cores]);
  const r = useRascunhoGradeRevenda({
    modeloId: modelo.id,
    nome,
    origem: g.origem,
    rev: g.rev,
    grades: g.gradePorCor,
    nums,
    tamanhos: g.tamanhos,
    sc: salvar,
    onSujoChange,
  });
  const rotuloDe = new Map(g.colunas.map((c) => [c.chave, c.rotulo]));
  const corDe = new Map(g.cores.map((c) => [c.num, c.label]));
  return (
    <div className="space-y-2">
      {r.dirty && (
        <p
          role="status"
          data-testid="grade-nao-salva"
          className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          Alterações não salvas na grade — use Salvar na barra de baixo.
        </p>
      )}
      {r.erro && (
        <div
          role="alert"
          data-erro-grade
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>{r.erro}</span>
        </div>
      )}
      <MatrizGradeResponsiva
        tamanhos={g.tamanhos}
        {...propsColunas(g)}
        renderCell={(num, t) => {
          const qtd = r.valorDe(num, t);
          if (motivo) {
            return (
              <span
                className={`block px-2 py-1 text-center tabular-nums ${qtd > 0 ? "" : "text-muted-foreground"}`}
                title={motivo}
                data-qtd={`${num}:${t}`}
              >
                {qtd}
              </span>
            );
          }
          const editada = r.celulaEditada(num, t);
          return (
            <NumberInput
              integer
              blankZero
              placeholder="0"
              aria-label={`Quantidade de ${corDe.get(num) ?? `variante ${num}`} no tamanho ${rotuloDe.get(t) ?? t} de ${nome}`}
              data-qtd-celula={`${num}:${t}`}
              data-editada={editada ? "" : undefined}
              className={`h-8 w-full min-w-14 border-0 text-center ${editada ? "bg-amber-100 ring-1 ring-amber-400 dark:bg-amber-950/40" : ""}`}
              value={qtd}
              onChange={(e) => r.editar(num, t, Number(e.target.value) || 0)}
            />
          );
        }}
        total={(num) => r.totalDe(num)}
        emptyLabel="Sem cores."
      />
    </div>
  );
}
