// GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao; rode o gerador de novo).
// Urgentes R11 (plan-r11) - contrato dos blocos de migration para urgd-helpers.ts: por bloco, URGD_SENTINELA (assinatura de funcao:
// bloco vivo = md5 dela = o "depois" de URGD_MD5 ou de URGD_NOVAS), URGD_MD5 (ANTES/DEPOIS das funcoes existentes redefinidas),
// URGD_ACL (proacl::text de antes = depois), URGD_NOVAS (funcoes criadas: md5 DEPOIS), URGD_NEUTRAS (funcoes criadas que o _down
// NEUTRALIZA: md5 do texto neutro), URGD_DEPS (funcoes FIXADAS: md5 exigido pela guarda), URGD_GATILHOS (md5 do pg_get_triggerdef;
// antes null = gatilho novo), URGD_TABELAS/URGD_COLUNAS (objetos novos; so o _down_drop apaga), URGD_DROP_GUC e os arquivos.
// Blocos escritos A MAO (ex.: r11b = 199100, ALTER de estoque_tecido_baixas) entram no MESMO JSON com URGD_ESTADO no lugar da
// funcao sentinela (vivo/pendente = SQL "AS ok"; downNoop = o _down nao muda nada) - o gerador PRESERVA os blocos que nao gera.
export type UrgdBloco = {
  mig: string;
  down: string;
  drop?: string;
  URGD_SENTINELA: string;
  URGD_MD5: Record<string, { antes: string; depois: string }>;
  URGD_ACL: Record<string, string>;
  URGD_NOVAS?: Record<string, string>;
  URGD_NEUTRAS?: Record<string, string>;
  URGD_DEPS?: Record<string, string>;
  URGD_WRAPPERS?: string[];
  URGD_GATILHOS?: { tabela: string; nome: string; antes: string | null; depois: string }[];
  URGD_TABELAS?: string[];
  URGD_COLUNAS?: string[];
  URGD_DROP_GUC?: string;
  URGD_DADOS?: { backups?: string[]; vivo: string; pendente: string };
  URGD_ESTADO?: { vivo: string; pendente: string; downNoop?: boolean };
};
export const URGD_BLOCOS: Record<string, UrgdBloco> = /* URGD_JSON_INICIO */
{
  "r11a": {
    "mig": "supabase/migrations/20261103199000_urg_r11_mini_tabelas.sql",
    "down": "supabase/rollback/20261103199000_urg_r11_mini_tabelas_down.sql",
    "drop": "supabase/rollback/20261103199000_urg_r11_mini_tabelas_down_drop.sql",
    "URGD_SENTINELA": "public.fn_estoque_peca_teste_imutavel()",
    "URGD_MD5": {},
    "URGD_ACL": {},
    "URGD_NOVAS": {
      "public.fn_estoque_peca_teste_imutavel()": "93911c1c230f910f74c93d3f917e9694"
    },
    "URGD_NEUTRAS": {
      "public.fn_estoque_peca_teste_imutavel()": "2ccebd01b91760521b76d04f299f97d2"
    },
    "URGD_DEPS": {
      "public.fn_kanban_fila_por_modelo()": "83b837afaaab012d00afc37cea9b3572",
      "public.fn_audit()": "63e5855f24d17914aef609e35ffc499b"
    },
    "URGD_GATILHOS": [
      {
        "tabela": "public.modelo_peca_teste_mini",
        "nome": "audit_modelo_peca_teste_mini",
        "antes": null,
        "depois": "dde0b197ba997c8aae0f7c99ae6ad14a"
      },
      {
        "tabela": "public.modelo_peca_teste_mini",
        "nome": "trg_peca_teste_mini_fila_ins",
        "antes": null,
        "depois": "6571dd0b65bfee002d21e55f417f8974"
      },
      {
        "tabela": "public.modelo_peca_teste_mini",
        "nome": "trg_peca_teste_mini_fila_upd",
        "antes": null,
        "depois": "8486b70e4f156a184a786bd72da70ec3"
      },
      {
        "tabela": "public.modelo_peca_teste_mini",
        "nome": "trg_peca_teste_mini_fila_del",
        "antes": null,
        "depois": "6d41064613f73fa0bcb40a32d45f605a"
      },
      {
        "tabela": "public.modelo_peca_teste_mini_linhas",
        "nome": "audit_modelo_peca_teste_mini_linhas",
        "antes": null,
        "depois": "df72813c8c6511550ffe04ce1dd1bf99"
      },
      {
        "tabela": "public.estoque_peca_teste_baixas",
        "nome": "audit_estoque_peca_teste_baixas",
        "antes": null,
        "depois": "6243dedd847c92ad0bb61953dee9e94e"
      },
      {
        "tabela": "public.estoque_peca_teste_baixas",
        "nome": "trg_estoque_peca_teste_imutavel",
        "antes": null,
        "depois": "f5d588d362b15927219c6ff5b794ca42"
      }
    ],
    "URGD_TABELAS": [
      "public.modelo_peca_teste_mini",
      "public.modelo_peca_teste_mini_linhas",
      "public.estoque_peca_teste_baixas"
    ],
    "URGD_DROP_GUC": "app.confirmo_apagar_baixas_peca_teste"
  },
  "r11b": {
    "mig": "supabase/migrations/20261103199100_urg_r11_ledger_tecido.sql",
    "down": "supabase/rollback/20261103199100_urg_r11_ledger_tecido_down.sql",
    "drop": "supabase/rollback/20261103199100_urg_r11_ledger_tecido_down_drop.sql",
    "URGD_SENTINELA": "",
    "URGD_MD5": {},
    "URGD_ACL": {},
    "URGD_COLUNAS": [
      "public.estoque_tecido_baixas.peca_teste_tentativa_id"
    ],
    "URGD_ESTADO": {
      "vivo": "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.estoque_tecido_baixas'::regclass AND attname = 'peca_teste_tentativa_id' AND NOT attisdropped) AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.estoque_tecido_baixas'::regclass AND conname = 'estoque_tecido_baixas_origem_check' AND pg_get_constraintdef(oid) = 'CHECK ((origem = ANY (ARRAY[''vinculo''::text, ''fifo''::text, ''separacao_rolo''::text, ''ajuste''::text, ''peca_teste''::text, ''peca_teste_estorno''::text])))') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.estoque_tecido_baixas'::regclass AND conname = 'etb_peca_teste_forma' AND pg_get_constraintdef(oid) = 'CHECK (((origem <> ALL (ARRAY[''peca_teste''::text, ''peca_teste_estorno''::text])) OR ((cad_id IS NULL) AND (rolo_id IS NULL) AND (((origem = ''peca_teste''::text) AND (quantidade > (0)::numeric)) OR ((origem = ''peca_teste_estorno''::text) AND (quantidade < (0)::numeric))))))') AS ok",
      "pendente": "SELECT NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.estoque_tecido_baixas'::regclass AND attname = 'peca_teste_tentativa_id' AND NOT attisdropped) AS ok",
      "downNoop": true
    }
  }
}
/* URGD_JSON_FIM */;
