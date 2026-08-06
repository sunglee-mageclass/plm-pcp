# Avaliação de UX/UI do sisTrama — metodologia

Diagnóstico **tela por tela**, **desktop + mobile**, por um time de 3 lentes + síntese.
Objetivo: dizer, com base em princípios (não opinião), se o uso é agradável/eficiente e onde melhora.

## Time (lentes)
| Agente | Lente | Ancoragem |
|---|---|---|
| `cognitive-ergonomist` | Ergonomia cognitiva / human factors | Cognitive Load, Miller 7±2, **Fitts**, **Hick**, Gestalt, reconhecimento>evocação |
| `ux-tester` | UX / interação / fluxo | **10 heurísticas de Nielsen**, prevenção/recuperação de erro, eficiência de uso repetido |
| `ui-ux-mobile` | UI visual + responsivo | hierarquia, tipografia, espaçamento (8pt), cor/**contraste WCAG**, alvo de toque ≥44px, affordance |

As 3 são **read-only** e recebem, por tela: **screenshots renderizados (desktop + mobile) + o arquivo da rota**.

## Dimensão objetiva ("dado")
- **WCAG/axe automático** (via Playwright + axe-core): contraste, alvos, foco, labels, roles → números, não achismo.
- (Complemento futuro, fora do agente) **3–5 usuários reais** da loja em teste moderado de tarefa (sucesso, tempo, travas). É o sinal mais alto; nenhum agente substitui.

## Captura (pré-requisito: Playwright MCP + `npm run dev`)
1. Subir dev: `npm run dev`. Login por convite (e-mail/senha; usuário de teste combinado).
2. Para cada tela: navegar, **screenshot desktop (1440×900)** e **mobile (390×844)** + snapshot do DOM.
3. Rodar o passe **axe** em cada viewport → relatório de violações.
4. Salvar em `/tmp/ux-audit/<tela>-{desktop,mobile}.png` (+ axe json).

## Evidência visual — contraste e pixels (não estimar, medir)

- **Contraste WCAG é COMPUTÁVEL**: quando a tela usa design tokens (oklch/hsl/hex), calcular
  os pares críticos com um script descartável no scratchpad (token→sRGB, luminância WCAG,
  composição de alpha para opacidades/tints) e comparar com 4.5:1 (texto) / 3.0:1 (non-text).
  Nunca estimar "no olho" a partir do screenshot — os casos que mais erram por estimativa são
  exatamente os marginais que importam (opacity <1 sobre fundo escuro, ícone tintado sobre chip
  tintado, `muted-foreground` nos dois temas).
- **Amostrar pixel do PNG antes de afirmar cor/tema**: a percepção do preview renderizado não é
  evidência. Decodificar o PNG (zlib+struct em Python puro, sem depender de PIL/ImageMagick no
  host) e ler o valor real das regiões citadas antes de qualquer afirmação de cor/contraste/tema
  não-adaptado.
- **Medir geometria por RUNS contíguos, nunca por "último pixel que casa"**: ao medir borda de um
  componente numa grade (ex.: altura de card), um predicado de cor solto casa qualquer componente
  da mesma cor no intervalo de varredura — inclusive a fileira vizinha — e produz falso
  desalinhamento. Delimitar por segmentos contíguos (start/end + comprimento mínimo pra ignorar
  texto) e validar contra um vizinho conhecido antes de reportar diferença de geometria.

## Inventário de telas (rotas em `src/routes/_authenticated/`)
- **otb** · **criacao**: planejamento, desenvolvimento · **cadastro**: atributos, colaboradores, serviço, tecidos, aviamentos
- **entrada-saida**: oc-tecido, oc-aviamento, rolos, estoque, alertas-tecido · **producao**: cad, cq, direcionamento, terceirizados, oficina, consumo-oc, lancamentos
- **financeiro**: calendário/lista/parcelas/serviços · **dashboard**: 5 abas · **admin**: lojas, usuarios, configuracoes
- **home** / **auth** (estado deslogado)

## Checklist — cards-contadores (landing/atenção)

Em telas com cards de KPI/atenção (contagens, badges), os defeitos cognitivos quase nunca
estão no visual — estão na correspondência entre número, rótulo, permissão e destino do
clique. Verificar ponta-a-ponta:
1. O rótulo cobre exatamente o escopo da query (ex.: "OCs atrasadas" conta tecido E aviamento,
   ou só um dos dois)?
2. O gate de visibilidade do card é o MESMO das outras superfícies (sidebar/permissão de
   usuário) — ou o card vaza um valor que a sidebar já esconde?
3. O clique aterrissa FILTRADO no que o número promete (mesmo quando a contagem soma fontes
   que moram em abas diferentes do destino)?
4. Estado zero é neutro (cor de alerta só quando há sinal real)?
5. Loading não mostra "0" falso antes do dado chegar?

## Checklist — responsividade entre breakpoints

Screenshots em 2 larguras (1440 + 390) deixam a faixa INTERMEDIÁRIA sem auditoria — e é
onde "ação sem resposta" se esconde. Sweep barato: grep dos prefixos de display responsivo
(`hidden`/`md:`/`lg:`) no componente avaliado e conferir os PARES gatilho→alvo no MESMO tier:
um gatilho visível em `md:flex` cujo alvo só renderiza em `lg:flex` significa que entre
768–1023px o clique acende o botão e nada abre. O mesmo grep revela superfícies 100% ausentes
num tier (ex.: um painel inteiro sem caminho no mobile).

## Checklist — formulários (controles e staging local)

- **Controles duplicados no mesmo campo**: grep pelo mesmo path de estado (ex.:
  `parcelas_recebimento`) em todos os componentes filhos do dialog/form. Dois ou mais controles
  editáveis ligados ao MESMO campo, visíveis simultaneamente, é achado de carga cognitiva — só
  aparece cruzando arquivos, nunca numa tela isolada.
- **Campo de staging local que só entra no draft via ação explícita** (ex.: "Aplicar a todos"):
  listar todo input cujo valor vive em `useState` local (não no draft salvo) e verificar se
  digitar + Salvar direto descarta o valor em silêncio. Se sim, o campo precisa de affordance
  distinta (estado "aplicado" visível, aplicar no blur, ou estilo de campo-ferramenta) — não pode
  parecer idêntico aos campos persistidos ao lado.

## Severidade
`bloqueia` (impede/erra a tarefa) · `atrapalha` (fricção/lentidão/confusão real) · `cosmético` (polimento).
Sempre marcar **desktop / mobile / ambos**.

## Verificação de achados antes de reportar

Todo achado candidato passa por esta checagem antes de virar item do laudo — reduz falso-positivo
mais do que qualquer heurística adicional:

1. **Rastrear proveniência do artefato até a camada de origem**: um texto/rótulo estranho pode
   nascer no código de formatação, no dado da loja ou no SEED default do sistema — a correção e o
   dono do fix mudam conforme a camada. Não classificar como "bug de UI" sem checar a origem.
2. **Delta "vs padrão X" só depois de abrir o padrão X no código real** e listar as classes/estilos
   efetivos (incluindo regras herdadas de camada base, tipo `h1-h6 { font }`) — nunca comparar
   contra a descrição de memória do padrão. Citar `arquivo:linha` dos DOIS lados comparados.
3. **Confirmar/refutar cada hipótese nascida de screenshot na CONFIG GLOBAL** antes de reportar:
   posição de toast (Toaster global, não o componente da rota), destino de redirects de guard,
   variantes responsivas dos primitivos de UI (`max-md:h-11` invisível no screenshot desktop).
   Screenshot mostra uma instância renderizada; comportamento vem de configuração global.
4. **Validar que o screenshot corresponde à superfície que o rótulo promete** antes de derivar
   qualquer achado dele: conferir título visível/breadcrumb/elementos esperados contra o nome do
   arquivo. Mismatch (capture errado, timing) = declarar a lacuna no laudo e avaliar aquela
   superfície só por código — nunca avaliar "de memória" ou fingir a comparação.
5. **Validar cobertura de qualquer referência citada no prompt de avaliação** (ex.: "compare com o
   mockup X"): grep do nome da tela no arquivo de referência ANTES de avaliar; se a tela-alvo não
   aparece nele, declarar no laudo que a avaliação é baseline (não um diff contra o mockup).

## Saída (laudo)
1. **Por tela**: matriz Achado × Lente, cada um com princípio/heurística, severidade, viewport, `arquivo:linha`, correção concreta.
2. **Síntese** (papel de `product-lead` ou main loop): dedup entre lentes, **top problemas priorizados** (severidade × frequência × esforço), padrões recorrentes (ex.: alvos pequenos no mobile em N telas).
3. **Quick wins** (barato + alto impacto) separados do **estrutural**.

## Como rodar
- **Piloto (recomendado 1º)**: 3 telas-âncora — **OTB**, **Planejamento**, **CQ (mobile denso)** — pra calibrar o formato antes da varredura.
- **Varredura completa**: só após o formato agradar. É cara (≈30 telas × 2 viewports × 3 lentes) → orquestrar via workflow (opt-in), pipeline por tela: captura → 3 lentes em paralelo → síntese.

## Regras
- Achado só se **REAL e verificável** (no render ou no código). Tela boa = "sem achados". Não inventar dado/estudo.
- Peso do produto: **ferramenta B2B densa, uso EXPERT/repetido** — otimizar eficiência e prevenção de erro, não "encantamento" de novato. Mobile importa muito (uso no chão de fábrica).

## Rito de CORREÇÃO por tela (o time acompanha — UI é PORTÃO, não etapa)

O time de 3 lentes (`cognitive-ergonomist`, `ux-tester`, `ui-ux-mobile`) não só diagnostica: **valida cada correção**. Toda tela que a gente conserta passa por:

1. **Achados** — puxa os 3 laudos da tela (`/tmp/ux-audit/sweep/{cog,ux,ui}-<mslug>.md` + laudo).
2. **Proposta** — proponho fixes priorizados; o dono **direciona** quais. Se ele apontar algo fora do diagnóstico, eu **avalio a validade** (render/código) antes de aceitar.
3. **Aplico** — edito + `tsc --noEmit` limpo + `vite build` verde.
4. **Re-captura que ESTRESSA o layout** (nunca só o zero-state, que esconde defeito): dado real (números, labels longos, muitos itens), **3 estados** (vazio/carregando/cheio), **2 breakpoints** (desktop 1440 + mobile 390), tema **claro e escuro**.
5. **GATE do time no RESULTADO** — disparo as 3 lentes no screenshot **DEPOIS**. Cada uma responde: (a) o achado foi resolvido? (b) **regrediu** algo? Retorno: **APROVADO** ou **FLAGS**.
6. **Corrijo flags → re-gate.** Só commito quando o time aprova (ou o dono aceita explicitamente).

**Checklist mínimo do gate de UI** (o que pegou o desalinhamento do Início): alinhamento e **alturas iguais por linha**; sem vão órfão; ritmo 8pt; contraste WCAG AA; alvos ≥44px no mobile; nada truncado/estourando; os 3 estados e 2 breakpoints acima.

**Por que:** um achado aponta o problema, mas **virar código bom** exige mão + conferência visual com dado que estressa. Sem o gate, a UI vira consequência da mudança de UX (foi o que gerou a regressão do Início). O gate faz a UI ser aprovação obrigatória.

**Blindagem automática (investimento futuro):** visual-regression Playwright (baseline por tela → diff pixel a pixel acusa regressão sozinho) + **componentizar** padrões repetidos (cards de atenção, tabelas, badges) p/ resolver alinhamento **uma vez** no componente em vez de reajustar flex/altura à mão em cada tela.
