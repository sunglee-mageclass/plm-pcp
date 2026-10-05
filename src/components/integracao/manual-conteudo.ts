// Integração — Manual da API (P-81 A; mockup 7f): os 9 tópicos como DADOS (a tela só desenha). Linguagem simples, para o
// dono E para o dev; sem segredos (chave fictícia). Os JSONs de exemplo são montados pela MESMA função da rota
// (montarResposta) — o manual nunca diverge do formato real.
// Release A2 (P-222 B/P-223 A/P-224 B+, dono 03/out): resposta em OBJETOS chave-valor com as variantes aninhadas no produto
// (saem `colunas`/`linhas`) e `loja=<código da loja>` obrigatório em toda chamada — comandos, parâmetros, resposta, códigos,
// FAQ e checklist atualizados; os comandos usam o código da loja ATIVA quando a tela o passa (senão um marcador).
import { CAMPOS } from "@/lib/integracao/campos";
import { tituloSublinha } from "@/lib/integracao/titulo-sublinha";
import { CAMINHO_FOTO_EXEMPLO, montarResposta, type RespostaApi, type RespostaLer } from "@/lib/integracao/api/resposta";

export type Bloco =
  | { tipo: "p"; texto: string }
  | { tipo: "passos"; itens: string[] }
  | { tipo: "lista"; itens: string[] }
  | { tipo: "codigo"; titulo: string; codigo: string }
  | { tipo: "tabela"; cabecalho: string[]; linhas: string[][] }
  | { tipo: "faq"; itens: { p: string; r: string }[] }
  | { tipo: "exemplo" };
export type SecaoManual = { id: string; titulo: string; blocos: Bloco[] };
export const CHAVE_FICTICIA = "wish_live_EXEMPLO1234567890";
/** P-89 A (dono 27/set): "isso pode mudar depois … como fazer no manual/guia?" — vai em Parâmetros, Boas práticas e FAQ. */
export const TEXTO_PAGINA_PODE_MUDAR =
  "O número de produtos por página pode mudar (é uma configuração da loja). Seu programa nunca deve contar com um tamanho fixo de página: siga o proximo_cursor até ele vir vazio e, se quiser, leia pagina.maximo para pedir páginas maiores.";
// Fix round 1 T16 (revisão I1–I8): decisões do dono que faltavam no Manual (carry.md:42-45 "T16 (Manual)" +
// dispatch progress.md:171). Cada uma tem teste em integracao-resposta.test.ts checando a frase-chave dentro de
// montarManual — para não sumir em silêncio numa próxima edição.
/** I1: identificação de produto/variante — NUNCA por nome/título; a mesma REF/SKU pode repetir em 2 réplicas. */
export const TEXTO_IDENTIFICACAO =
  "Identifique o PRODUTO pelo produto_id (código fixo, nunca muda) e a VARIANTE pelo SKU (campo ref_sku dentro de variantes) desse produto — nunca pelo nome ou pelo título. A mesma REF/SKU pode aparecer em dois produtos diferentes (réplicas, por desenho): a chave de ligação é sempre produto_id + SKU. Por isso, mantenha o campo REF / SKU marcado em Campos da API.";
/** I2 (P-93 A): colunas de uma página são a UNIÃO dos retratos; campo fora do retrato de um produto vem null. */
export const TEXTO_UNIAO_COLUNAS =
  "Se a loja mudar os Campos da API, os produtos que ficaram Integráveis ANTES da mudança continuam com os campos daquela época: num campo novo, eles vêm com o valor vazio (null). Os campos (chaves) de uma página são a união dos campos dos produtos dela — todo produto e toda variante da página trazem as mesmas chaves; leia as chaves de CADA resposta, nunca conte com uma lista fixa.";
/** I3: cada produto é entregue UMA vez. */
export const TEXTO_ENTREGUE_UMA_VEZ =
  "Cada produto é entregue UMA vez: quando a API confirma a entrega, ele vira Integrado e não vem mais nas consultas normais (só relendo com incluir_integrados=1). Depois de integrado, a REF/SKU e os demais campos enviados ficam travados — só o super admin pode desfazer a integração.";
/** I4: modelo PULL — o ERP busca, o sistema nunca envia sozinho (sem webhook). */
export const TEXTO_SEM_WEBHOOK =
  "Quem busca é o seu programa: o sistema NUNCA envia nada sozinho (não há webhook nem aviso automático). Para pegar produtos novos, o ERP consulta a API de tempos em tempos, respeitando o limite de consultas por minuto.";
/** I5: loja_id/loja_nome em toda linha; uma chave pertence a UMA loja só. */
export const TEXTO_UMA_LOJA_POR_CHAVE =
  "Todo produto e toda variante trazem loja_id e loja_nome (a EMPRESA dona do produto). Cada chave pertence a UMA loja só e só enxerga os produtos dessa loja; para outra loja, crie outra chave dentro dela (e use o código daquela loja no parâmetro loja).";
/** m4/m4-R: loja_nome é o retrato tirado ao marcar; pode divergir do loja.nome ATUAL no topo (renomeada depois). */
export const TEXTO_LOJA_NOME_RETRATO =
  "loja_nome de um produto/variante é o nome da loja no momento em que o produto foi marcado Integrável (um retrato); se a loja for renomeada depois, o loja.nome no topo da resposta (o nome ATUAL) pode ficar diferente do loja_nome de produtos antigos.";
/** I6 (P-99 A): produto reprovado não é entregue enquanto reprovado. */
export const TEXTO_REPROVADO_NAO_ENTREGA =
  "Produto Integrável que estiver reprovado (no Planejamento ou no Desenvolvimento) NÃO é entregue pela API enquanto estiver reprovado; quando deixar de ser reprovado, volta a ser levado normalmente. Um produto que já estava Integrado continua aparecendo quando você relê com incluir_integrados=1.";
/** I7 (P-100 A): só o preço DIGITADO conta, nunca o sugerido. */
export const TEXTO_PRECO_DIGITADO =
  "O Preço de venda enviado é SEMPRE o preço digitado no produto — o preço sugerido pelo sistema não conta. Com o campo Preço de venda marcado, produto sem preço de venda digitado não fica Integrável.";
/** I8: limite por chave por minuto (padrão 60); modo teste também conta. */
export const TEXTO_LIMITE_POR_CHAVE =
  "Cada chave pode fazer até N consultas por minuto (configuração da loja; padrão 60) — o modo teste também conta. Passou disso: 429; espere o tempo indicado em Retry-After. Chave errada: depois de N tentativas erradas em 10 minutos vindas do mesmo IP (padrão 10), esse IP fica bloqueado para chaves erradas (429) — a chave certa continua funcionando.";
/** m1: modo teste ignora `limite` — é sempre 2 produtos por página, 2 páginas (D22). */
export const TEXTO_TESTE_IGNORA_LIMITE =
  "No modo teste o limite é ignorado: sempre 2 produtos por página, em 2 páginas (4 produtos de exemplo).";
/** I9 (P-126, dono 29/set): o nome de cada sublinha (variante × tamanho) leva Nome do produto + cor + tamanho.
 *  Sem aspas retas no texto de propósito — elas viram `\"` dentro do JSON de exemplo (montarManual embute o
 *  exemplo inteiro como texto), e o teste do Manual busca esta constante DENTRO do JSON.stringify da seção toda. */
export const TEXTO_NOME_SUBLINHA =
  "O nome de cada variante (sublinha cor × tamanho) é Nome do produto + cor + tamanho (ex.: Saia Marola Preto P). A cor é a Cor base ou o Apelido, conforme a escolha da loja em Config da Loja › Formato do SKU › Cor no nome da sublinha (Integração); variante sem apelido usa a cor base, e sem cor fica só o nome + tamanho.";

/** R8 (P-301 B): o título de cada sublinha é o do produto com a cor inserida antes do último " | ". Sem aspas retas (mesma razão do
 *  TEXTO_NOME_SUBLINHA: o teste busca a constante dentro do JSON.stringify do Manual). */
export const TEXTO_TITULO_SUBLINHA =
  "O título de cada variante (campo titulo) é o título do produto com a cor inserida antes do último separador de barra vertical (ex.: Vestido Suelen | Ave Rara vira Vestido Suelen Preto | Ave Rara); título sem barra vertical recebe a cor no fim, e variante sem cor traz o mesmo título do produto. É calculado pelo sistema — não se edita na variante.";

/** Release I3: Coleção, Categoria do Tecido Principal e Linha (colunas 19–21) são informativas e NÃO obrigatórias. */
export const TEXTO_COLUNAS_INFORMATIVAS =
  "Os campos colecao (Coleção), categoria_tecido (Categoria do Tecido Principal) e linha (Linha) são INFORMATIVOS e não obrigatórios: podem vir vazios (null) quando o produto não tem esse dado. Os produtos integrados antes dessa mudança não têm o retrato reescrito: numa página só com produtos integrados antes da mudança, esses campos podem nem aparecer. Em revenda/importado, a Categoria do Tecido Principal vem do campo \"Categoria do tecido\" (ou \"Material do aviamento\", em Acessórios) do card do produto.";

/** Release A2 (P-224 B+): `loja` obrigatório em toda chamada (normal e teste). */
export const TEXTO_LOJA_OBRIGATORIA =
  "Toda chamada (normal E teste) precisa do parâmetro loja com o código da loja dona da chave (o super admin vê e copia em Integração › API › Chaves › Código da loja). Sem ele, ou fora do formato: 400. Com o código de OUTRA loja: 403 loja_nao_autorizada — nada é entregue nem confirmado, e a chamada fica registrada em Acessos recentes.";
/** Release A2 (P-222 B/P-223 A): o formato em objetos chave-valor, variantes dentro do produto. Sem aspas retas de propósito
 *  (mesma razão do TEXTO_NOME_SUBLINHA: o teste busca a constante dentro do JSON.stringify do Manual). */
export const TEXTO_FORMATO_OBJETOS =
  "Cada item de produtos é UM produto, com os campos em chave-valor (ex.: nome → Saia Marola, ref_sku → SAMA0019) e TODAS as suas variantes dentro de variantes (uma por cor × tamanho, no mesmo formato chave-valor). Um produto nunca é dividido entre páginas; produto sem variantes vem com variantes vazio ([]). As chaves são fixas do sistema (minúsculas, sem acento) — veja a tabela de chaves abaixo.";
/** Release A2: marcador do código da loja nos comandos quando a tela não tem a loja ativa. */
export const LOJA_FICTICIA = "<codigo-da-loja>";

const CHAVES = CAMPOS.map((c) => c.key);
const linhaDe = (tipo: "produto" | "variante", v: Record<string, unknown>) => ({ tipo, valores: CHAVES.map((k) => (k in v ? v[k] : null)) });

/** Resposta de exemplo no formato REAL (objetos chave-valor com as 21 chaves — 17 do layout + Foto + Coleção, Categoria do Tecido
 *  Principal e Linha — e a variante dentro do produto, Release A2). Normal = Saia Marola (a única "Integrado em" do mockup);
 *  teste = produtos FICTÍCIOS "Produto Exemplo N" (P-82 A), foto = endereço público de exemplo (n3). */
export function respostaExemplo(modo: "normal" | "teste", origem: string): RespostaApi {
  const loja = { id: "a91f0c2d-0000-4000-8000-000000000001", nome: "WISH360 Demo" };
  const base = modo === "normal"
    ? { nome: "Saia Marola", ref_sku: "SAMA0019", preco_anterior: "199.90", preco_venda: "179.90", peso: "0.310", ncm: "6204.52.00",
        preco_custo: "71.30", titulo: "Saia Marola Godê", descricao: "Saia godê em crepe, comprimento midi.", keywords: "moda feminina, roupas",
        metatag: "Saia godê em crepe, comprimento midi.", comprimento: "90", largura: "36", altura: "2",
        colecao: "Verão 2027", categoria_tecido: "Crepe", linha: "Feminina" }
    : { nome: "Produto Exemplo 1", ref_sku: "EXPL0001", preco_anterior: "109.90", preco_venda: "99.90", peso: "0.300", ncm: "6109.10.00",
        preco_custo: "42.00", titulo: "Produto Exemplo 1 - exemplo", descricao: "Descrição de exemplo do produto 1.", keywords: "exemplo, teste",
        metatag: "Descrição de exemplo do produto 1.", comprimento: "60", largura: "40", altura: "2",
        colecao: "Coleção Exemplo", categoria_tecido: "Malha", linha: "Casual" };
  // P-126: o nome da sublinha leva a COR (Nome do produto + cor + tamanho) — normal usa a Cor base "Preto";
  // teste usa a Cor base "Cor Exemplo" (mesmo texto do exemplo do modo teste, `_integracao_exemplo`).
  // R8: o título da sublinha = título do produto com a cor (espelho TS `tituloSublinha`, o mesmo da fixture anti-drift) — nunca à mão.
  const variante = modo === "normal"
    ? { ...base, nome: "Saia Marola Preto P", titulo: tituloSublinha(base.titulo, "Preto", null, "cor_base"), ref_sku: "SAMA0019-PRT-P", cor_base: "Preto", cor_apelido: null, tamanho: "P", foto: [] }
    : { ...base, nome: "Produto Exemplo 1 Cor Exemplo P", titulo: tituloSublinha(base.titulo, "Cor Exemplo", "Apelido Exemplo", "cor_base"), ref_sku: "EXPL0001-COR-P", cor_base: "Cor Exemplo", cor_apelido: "Apelido Exemplo", tamanho: "P", foto: [] };
  const r: RespostaLer = {
    status: "ok", modo, tenant_id: loja.id, loja, colunas: CAMPOS.map((c) => c.rotulo), chaves_colunas: CHAVES,
    proximo_cursor: modo === "teste" ? "eyJleGVtcGxvIjogMn0=" : null,
    pagina: modo === "teste" ? { limite: 2, maximo: 50 } : { limite: 50, maximo: 50 },
    produtos: [{
      modelo_id: modo === "normal" ? "c3a1e2b4-0000-4000-8000-000000000001" : "exemplo-0001", estado: modo === "normal" ? "integrado" : "teste",
      assinatura: null, integrado_em: modo === "normal" ? "2026-09-26T17:35:00.000Z" : null,
      linhas: [linhaDe("produto", { ...base, foto: modo === "normal" ? ["saia-marola.jpg"] : ["exemplo"] }), linhaDe("variante", variante)],
    }],
  };
  return montarResposta(r, {
    geradoEm: "2026-09-26T23:48:00.000Z",
    foto: (c) => c.map((p) => (modo === "teste" ? `${origem}${CAMINHO_FOTO_EXEMPLO}` : `https://…/fotos/${p}?token=…`)),
  });
}

export function montarManual(origem: string, lojaId: string | null = null): SecaoManual[] {
  const url = `${origem}/api/integracao/v1/produtos`;
  const lj = `loja=${lojaId || LOJA_FICTICIA}`;
  const h = `-H "Authorization: Bearer ${CHAVE_FICTICIA}"`;
  return [
    { id: "s1", titulo: "O que é e como funciona", blocos: [
      { tipo: "p", texto: "A Integração organiza os produtos da loja para serem LIDOS por um programa externo (ERP ou e-commerce) através de uma API própria do sistema. Em 3 passos:" },
      { tipo: "passos", itens: ["Integrável — produto completo, marcado à mão.", "A API leva — o dev consulta com a chave.", "Integrado — travado; só o super admin desfaz."] },
      { tipo: "p", texto: 'O que foi levado fica travado no banco (nome, preço, SKU, fotos…). Um erro depois de enviado é responsabilidade de quem confirmou — não existe "corrigir depois" pelo sistema.' },
      { tipo: "p", texto: TEXTO_ENTREGUE_UMA_VEZ },
      { tipo: "p", texto: TEXTO_SEM_WEBHOOK },
      { tipo: "p", texto: TEXTO_REPROVADO_NAO_ENTREGA },
    ] },
    { id: "s2", titulo: "Passo a passo para integrar", blocos: [
      { tipo: "passos", itens: [
        "Criar uma chave em API › Chaves (super admin).",
        "Entregar a chave ao dev por um canal SEGURO (nunca por e-mail aberto ou chat público), junto do Código da loja (API › Chaves) — o parâmetro loja é obrigatório em toda chamada.",
        'O dev testa em modo teste (modo=teste) — no mesmo formato, com produtos de EXEMPLO fictícios; nada vira integrado. Serve para montar o programa sem "gastar" produtos.',
        "Quando estiver funcionando, o dev liga de verdade (sem modo=teste).",
        'Conferir no Log e na aba Produtos se os produtos certos ficaram "Integrado".',
      ] },
    ] },
    { id: "s3", titulo: "Endereço e comandos", blocos: [
      { tipo: "p", texto: "Endereço: GET /api/integracao/v1/produtos — exemplos prontos (chave fictícia abaixo — troque pela sua):" },
      { tipo: "codigo", titulo: "Terminal (curl)", codigo: `# Consulta normal\ncurl "${url}?${lj}&limite=50" \\\n  ${h}` },
      { tipo: "codigo", titulo: "JavaScript", codigo: `// Consulta normal\nconst r = await fetch(\n  "${url}?${lj}&limite=50",\n  { headers: { Authorization: "Bearer ${CHAVE_FICTICIA}" } }\n);\nconst dados = await r.json();\nfor (const produto of dados.produtos) {\n  console.log(produto.produto_id, produto.nome);\n  for (const variante of produto.variantes) console.log("  ", variante.ref_sku, variante.tamanho);\n}` },
      { tipo: "codigo", titulo: "Python", codigo: `import requests\nr = requests.get(\n    "${url}",\n    params={"loja": "${lojaId || LOJA_FICTICIA}", "limite": 50},\n    headers={"Authorization": "Bearer ${CHAVE_FICTICIA}"},\n)\ndados = r.json()\nfor produto in dados["produtos"]:\n    print(produto["produto_id"], produto.get("nome"))\n    for variante in produto["variantes"]:\n        print("  ", variante.get("ref_sku"), variante.get("tamanho"))` },
      { tipo: "codigo", titulo: "Modo teste — produtos de EXEMPLO (fictícios) no formato real; nada vira integrado (limite é ignorado — ver abaixo)", codigo: `curl "${url}?${lj}&modo=teste" \\\n  ${h}` },
      { tipo: "codigo", titulo: "Próxima página (cursor)", codigo: `curl "${url}?${lj}&limite=50&cursor=<proximo_cursor da resposta anterior>" \\\n  ${h}` },
      { tipo: "codigo", titulo: "Reler produtos já integrados (ex.: a resposta anterior se perdeu)", codigo: `curl "${url}?${lj}&incluir_integrados=1&limite=50" \\\n  ${h}` },
    ] },
    { id: "s4", titulo: "Parâmetros", blocos: [
      { tipo: "tabela", cabecalho: ["Parâmetro", "O que faz", "Padrão", "Exemplo"], linhas: [
        ["loja", "OBRIGATÓRIO — o código da loja dona da chave (Integração › API › Chaves › Código da loja). Ausente ou fora do formato = 400; de outra loja = 403 loja_nao_autorizada (nada é entregue)", "— (obrigatório)", `loja=${lojaId || LOJA_FICTICIA}`],
        ["modo", "normal ou teste — teste devolve produtos de EXEMPLO fictícios no formato real, nunca dados reais; nada vira integrado", "normal", "modo=teste"],
        ["incluir_integrados", "0 = só integráveis; 1 = inclui os já integrados também", "0", "incluir_integrados=1"],
        ["limite", "nº de produtos por página, até o máximo configurado da loja (hoje, padrão 50); sem limite = o máximo; um produto nunca é partido entre páginas; IGNORADO em modo=teste (sempre 2)", "o máximo da loja", "limite=50"],
        ["cursor", "devolvido em proximo_cursor da resposta anterior — envie de volta para pedir a próxima página", "vazio (1ª página)", "cursor=…"],
      ] },
      { tipo: "p", texto: TEXTO_LOJA_OBRIGATORIA },
      { tipo: "p", texto: TEXTO_PAGINA_PODE_MUDAR },
      { tipo: "p", texto: TEXTO_TESTE_IGNORA_LIMITE },
    ] },
    { id: "s5", titulo: "A resposta explicada", blocos: [
      { tipo: "tabela", cabecalho: ["Campo", "O que é"], linhas: [
        ["versao", "versão do formato da resposta"],
        ["modo", '"normal" ou "teste" (espelha o parâmetro pedido)'],
        ["loja", "{id, nome} — a EMPRESA (não as lojas do Direcionamento)"],
        ["gerado_em", "data/hora em que esta resposta foi gerada"],
        ["pagina", "{limite, maximo} — limite = quantos produtos por página ESTA resposta usou; maximo = o máximo que a loja permite HOJE (pode mudar). Para páginas maiores, peça limite até pagina.maximo"],
        ["produtos[]", "UM objeto por produto: produto_id, loja_id, loja_nome, integrado_em + os campos em chave-valor (tabela de chaves abaixo) + variantes"],
        ["produtos[].variantes[]", "as variantes do produto (uma por cor × tamanho), no MESMO formato: produto_id, loja_id, loja_nome, integrado_em + os campos em chave-valor; [] quando o produto não tem variantes"],
        ["produto_id", "id FIXO do produto (nunca muda; o mesmo no produto e em todas as variantes dele) — é a chave de ligação com o seu sistema"],
        ["loja_id / loja_nome", "a EMPRESA (não as lojas do Direcionamento) — todo produto e toda variante trazem os dois; loja_nome é o retrato de quando o produto foi marcado (pode divergir do nome atual, se a loja for renomeada depois)"],
        ["integrado_em", "data/hora em que a API confirmou a entrega (vazio em modo teste — nada é integrado nesse modo)"],
        ["foto", "no produto, a LISTA de links (Foto 1..N) — os links expiram; nas variantes, [] (null quando o campo Foto não estava no retrato daquele produto)"],
        ["proximo_cursor", "passe em cursor na próxima chamada; vazio = não há mais páginas"],
      ] },
      { tipo: "p", texto: TEXTO_FORMATO_OBJETOS },
      { tipo: "tabela", cabecalho: ["Chave", "Campo"], linhas: CAMPOS.map((c) => [c.key, c.rotulo]) },
      { tipo: "p", texto: TEXTO_UNIAO_COLUNAS },
      { tipo: "p", texto: TEXTO_LOJA_NOME_RETRATO },
      { tipo: "p", texto: TEXTO_PRECO_DIGITADO },
      { tipo: "p", texto: TEXTO_NOME_SUBLINHA },
      { tipo: "p", texto: TEXTO_TITULO_SUBLINHA },
      { tipo: "p", texto: TEXTO_COLUNAS_INFORMATIVAS },
      { tipo: "exemplo" },
      { tipo: "codigo", titulo: "JSON de exemplo — modo NORMAL (dados reais da loja; só produtos JÁ INTEGRÁVEIS são levados)", codigo: JSON.stringify(respostaExemplo("normal", origem), null, 2) },
      { tipo: "codigo", titulo: "JSON de exemplo — modo TESTE (resumido: 1 produto de exemplo; a chamada de verdade sempre traz 2 por página)", codigo: JSON.stringify(respostaExemplo("teste", origem), null, 2) },
      { tipo: "p", texto: 'Nunca dados reais no modo teste — nomes/REFs sempre "Exemplo"/"EXPL..." mesmo que sua loja tenha produtos de verdade. O link da foto também é de exemplo (público).' },
    ] },
    { id: "s6", titulo: "Códigos de resposta", blocos: [
      { tipo: "tabela", cabecalho: ["Código", "O que fazer"], linhas: [
        ["200", "Ok — a resposta veio normal, use os dados."],
        ["400", "Parâmetro inválido — confira loja (obrigatório, o código da loja), modo, incluir_integrados, limite e cursor (ou cursor do outro modo: um cursor de modo=teste usado em modo=normal, e vice-versa, também dá 400). Qualquer parâmetro fora desses cinco (ou repetido) também dá 400."],
        ["401", "Chave errada ou revogada — confira a chave; se foi revogada, peça uma nova ao super admin."],
        ["403", "loja_nao_autorizada — o código em loja não é o da loja desta chave (confira em Integração › API › Chaves › Código da loja); nada é entregue. loja_inativa — a loja está inativa: fale com o super admin."],
        ["405", "Método não permitido — a API só aceita GET."],
        ["429", "Limite excedido (ou IP bloqueado por chaves erradas) — espere o tempo indicado em Retry-After e tente de novo."],
        ["500", "Erro do site — tente de novo; se repetir, avise o suporte."],
      ] },
      { tipo: "p", texto: TEXTO_LIMITE_POR_CHAVE },
    ] },
    { id: "s7", titulo: "Boas práticas", blocos: [
      { tipo: "lista", itens: [
        TEXTO_PAGINA_PODE_MUDAR,
        TEXTO_IDENTIFICACAO,
        "Se a resposta se perder no meio do caminho, releia com incluir_integrados=1.",
        "Nunca coloque a chave no código do site/app (client-side) — ela é para o servidor do ERP, nunca aparece no navegador.",
        "As fotos expiram em N dias (configuração da loja; padrão 7) — baixe/guarde a foto no seu lado, não dependa do link para sempre.",
      ] },
    ] },
    { id: "s8", titulo: "Perguntas frequentes", blocos: [
      { tipo: "faq", itens: [
        { p: "Posso testar sem afetar os produtos de verdade?", r: "Sim — use modo=teste. A resposta traz produtos de EXEMPLO (fictícios) no mesmo formato da sua loja, nunca dados reais, e nada vira integrado." },
        { p: "Um produto integrado pode ser editado depois?", r: 'Não — os campos que foram para a API ficam travados. Só o super admin pode "Desfazer integração" (com motivo), e aí o produto volta a ser editável.' },
        { p: "Perdi a resposta de uma consulta — e agora?", r: "Releia com incluir_integrados=1: os produtos já confirmados aparecem de novo, sem duplicar nada no banco." },
        { p: "Quantos produtos vêm por página?", r: 'Até o "Máximo de produtos por página" configurado da loja (hoje, padrão 50). A própria resposta diz: pagina.limite (usado nesta resposta) e pagina.maximo (o máximo de hoje). Um produto nunca é dividido entre duas páginas.' },
        { p: "O tamanho da página pode mudar?", r: TEXTO_PAGINA_PODE_MUDAR },
        { p: "Os campos (chaves) são sempre os mesmos em toda resposta?", r: TEXTO_UNIAO_COLUNAS },
        { p: "Por que recebo 403 loja_nao_autorizada?", r: TEXTO_LOJA_OBRIGATORIA },
        { p: "O que acontece se eu errar a chave várias vezes?", r: "Depois de N tentativas erradas em 10 minutos (configurável), chaves erradas vindas desse IP ficam bloqueadas por um tempo — a chave certa continua funcionando." },
        { p: "Quantas consultas por minuto uma chave pode fazer?", r: TEXTO_LIMITE_POR_CHAVE },
        { p: "Posso ter mais de uma chave?", r: `Sim — crie uma por integração/ambiente (ex.: uma para o ERP, outra para testes) e revogue a que não usa mais. ${TEXTO_UMA_LOJA_POR_CHAVE}` },
      ] },
    ] },
    { id: "s9", titulo: "Checklist antes de ligar de verdade", blocos: [
      { tipo: "lista", itens: [
        "Mando loja=<código da loja> em TODA chamada (normal e teste).",
        "Testei em modo=teste e a resposta trouxe os campos que eu esperava (produtos com as variantes dentro).",
        "Sei paginar até proximo_cursor vazio.",
        "Guardo o produto_id no meu sistema.",
        "A chave está guardada com segurança (nunca no código do site/app).",
        "Leio os produtos por chave (nome, ref_sku…) e as variantes dentro de cada produto — nunca por posição.",
        "Sei o que fazer em cada código de erro (400/401/403/429/500).",
        'Combinei com o time quando os produtos vão passar de "Integrável" para "Integrado" de verdade.',
      ] },
    ] },
  ];
}
