// PR-GRADE-1 — conteúdo da linha EXPANDIDA do produto na Lista tipo Excel: as CORES do modelo + a matriz cor × tamanho
// (quantidades), SÓ LEITURA. A edição vem na PR-GRADE-2 (depois de validar a hierarquia e as fontes).
// Este componente só é MONTADO quando a linha é expandida — o hook (`useProdutoGradeTamanhos`) só consulta o banco aí
// (carregamento sob demanda; nunca a grade de todos os modelos de uma vez).
import { useTenantModules } from "@/hooks/useTenantModules";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";
import { ehOrigemComprada, normalizarOrigem } from "@/lib/origem";
import type { ModeloGradeEntrada } from "@/lib/produto-grade/linhas";
import { useProdutoGradeTamanhos } from "./useProdutoGradeTamanhos";

const MODULO_POR_ORIGEM = { revenda: "produto_acabado", importado: "produto_importado" } as const;
const TELA_POR_ORIGEM = { revenda: "Produto Acabado", importado: "Produto Importado" } as const;

export function ProdutoLinhaExpandida({
  modelo,
  acessorio,
}: {
  modelo: ModeloGradeEntrada;
  /** Grupo do produto (SALVO) = Acessórios → grade única "UN". */
  acessorio: boolean;
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
    const rotulos = new Map(g.colunas.map((c) => [c.chave, c.rotulo]));
    const esmaecidos = new Set(g.colunas.filter((c) => c.esmaecido).map((c) => c.chave));
    corpo = (
      <MatrizGradeResponsiva
        tamanhos={g.tamanhos}
        variantes={g.cores.map((c) => ({ num: c.num, label: c.label }))}
        rotuloTamanho={(t) => rotulos.get(t) ?? t}
        cellClass={(_num, t) => (esmaecidos.has(t) ? "opacity-50" : "")}
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

  return (
    <div className="space-y-2 p-3" data-testid="produto-linha-expandida" data-origem={origem}>
      <p className="text-xs font-semibold">
        Grade de tamanhos
        <span className="ml-2 font-normal text-muted-foreground">
          {comprado ? `cores do ${tela}` : "cores = variantes do Tecido 1"}
        </span>
      </p>
      <p className="text-xs text-muted-foreground" data-testid="grade-somente-leitura">
        {g.motivoSomenteLeitura ?? "Somente leitura — para alterar a grade, abra o produto."}
      </p>
      {corpo}
    </div>
  );
}
