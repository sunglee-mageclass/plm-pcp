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
  },
  "r11c": {
    "mig": "supabase/migrations/20261103199200_urg_r11_estoque_fonte_unica.sql",
    "down": "supabase/rollback/20261103199200_urg_r11_estoque_fonte_unica_down.sql",
    "URGD_SENTINELA": "public._estoque_aviamento_core(uuid)",
    "URGD_MD5": {
      "public._estoque_aviamento_core(uuid)": {
        "antes": "f6eea9360a5fee924824a323de47c53f",
        "depois": "439093c8501001c17e71f283b1dcef92"
      },
      "public._estoque_etiqueta_core(uuid)": {
        "antes": "e7681ebd0e2a32144ca41795735182fc",
        "depois": "de6eeb18e1e15cf8137a6560e451fa0f"
      },
      "public._estoque_extrato_tecido_core(uuid,uuid)": {
        "antes": "bccc3cb6423a88d4942921f2e72c03fb",
        "depois": "0c73603f23ad1d74022457d699f7d834"
      },
      "public._estoque_extrato_aviamento_core(uuid,uuid)": {
        "antes": "c86981af6abf8129f5142e3636083483",
        "depois": "00759c836dd9ee40a4dcf1db427c9276"
      },
      "public._estoque_extrato_insumo_core(uuid,uuid)": {
        "antes": "9f2013ad56ec77e0601d51b32b793708",
        "depois": "808b80ed2183c812533d3ee92978bddd"
      }
    },
    "URGD_ACL": {
      "public._estoque_aviamento_core(uuid)": "{postgres=X/postgres,service_role=X/postgres}",
      "public._estoque_etiqueta_core(uuid)": "{postgres=X/postgres,service_role=X/postgres}",
      "public._estoque_extrato_tecido_core(uuid,uuid)": "{postgres=X/postgres,service_role=X/postgres}",
      "public._estoque_extrato_aviamento_core(uuid,uuid)": "{postgres=X/postgres,service_role=X/postgres}",
      "public._estoque_extrato_insumo_core(uuid,uuid)": "{postgres=X/postgres,service_role=X/postgres}"
    },
    "URGD_DEPS": {
      "public._estoque_tecido_core(uuid)": "9140c253a8b62fa143de052d84a1c329",
      "public._insumo_pecas(text,jsonb,numeric)": "2e1b701be975366933e9ad704cb25c18",
      "public._insumo_tamanho_de(uuid)": "46fd6f65599f7de2d3ab12777fefa7d1"
    }
  },
  "r11d": {
    "mig": "supabase/migrations/20261103199300_urg_r11_regras_mini.sql",
    "down": "supabase/rollback/20261103199300_urg_r11_regras_mini_down.sql",
    "drop": "supabase/rollback/20261103199300_urg_r11_regras_mini_down_drop.sql",
    "URGD_SENTINELA": "public.peca_teste_mini_estoque(uuid)",
    "URGD_MD5": {},
    "URGD_ACL": {},
    "URGD_NOVAS": {
      "public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid)": "5dae1386c608628edcd6f8362ba996e7",
      "public._peca_teste_insumo_tam_bucket(uuid,text)": "cabea631702567f1e3a5199e8a272746",
      "public._peca_teste_mini_linhas(uuid,text,uuid,jsonb)": "3d73d0db8fc0902c5bd07edfbfa2fe70",
      "public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text)": "e03a4d616e7ae297386a5e0e6bb83ff7",
      "public._peca_teste_mini_baixar(uuid,jsonb)": "444861eae9b28bc09ec3bfd80bc01033",
      "public._peca_teste_mini_estornar(uuid)": "c8f160a73b3a30a6105c7a45aff9c89d",
      "public._peca_teste_mini_tem_historico(uuid)": "10c05fae5041077c6dc23436d66f7d44",
      "public._peca_teste_mini_feita(uuid,uuid)": "f81421e9b3aa27f34ab426f6b0783f96",
      "public._peca_teste_mini_estoque_core(uuid,uuid)": "2a3527c28b3486d5f86587d9af169f72",
      "public.peca_teste_mini_estoque(uuid)": "8a1d492a40993a582b7978080a1fff2d"
    },
    "URGD_NEUTRAS": {
      "public.peca_teste_mini_estoque(uuid)": "a94ba498dee379436f45577f790a5b8d"
    },
    "URGD_WRAPPERS": [
      "public.peca_teste_mini_estoque(uuid)"
    ],
    "URGD_DEPS": {
      "public._estoque_aviamento_core(uuid)": "439093c8501001c17e71f283b1dcef92",
      "public._estoque_etiqueta_core(uuid)": "de6eeb18e1e15cf8137a6560e451fa0f",
      "public._insumo_tamanho_de(uuid)": "46fd6f65599f7de2d3ab12777fefa7d1"
    }
  },
  "r11e": {
    "mig": "supabase/migrations/20261103199400_urg_r11_salvar_mini.sql",
    "down": "supabase/rollback/20261103199400_urg_r11_salvar_mini_down.sql",
    "drop": "supabase/rollback/20261103199400_urg_r11_salvar_mini_down_drop.sql",
    "URGD_SENTINELA": "public._peca_teste_mini_aplicar(uuid,uuid,jsonb)",
    "URGD_MD5": {
      "public._salvar_peca_teste_core(uuid,jsonb,jsonb)": {
        "antes": "eccde92e1c6687045f8f7c9ae61caf8f",
        "depois": "3e3b9db2d04dd176a4712898293f8545"
      },
      "public._peca_teste_trilhas_core(uuid,uuid)": {
        "antes": "5ae0f7025744d63508d7617e6e3a7487",
        "depois": "ef860a61e25750d2d12131062a23202d"
      }
    },
    "URGD_ACL": {
      "public._salvar_peca_teste_core(uuid,jsonb,jsonb)": "{postgres=X/postgres,service_role=X/postgres}",
      "public._peca_teste_trilhas_core(uuid,uuid)": "{postgres=X/postgres,service_role=X/postgres}"
    },
    "URGD_NOVAS": {
      "public._peca_teste_trilha_mini(uuid)": "348c7e9978e7f6c0a48812baccc65a5e",
      "public._peca_teste_mini_aplicar(uuid,uuid,jsonb)": "e6c43399f0a5c20c17c6255477947d2d"
    },
    "URGD_NEUTRAS": {
      "public._peca_teste_mini_aplicar(uuid,uuid,jsonb)": "2dbec37294d192919e72a0a9ae52ef7a"
    },
    "URGD_DEPS": {
      "public._peca_teste_mini_baixar(uuid,jsonb)": "444861eae9b28bc09ec3bfd80bc01033",
      "public._peca_teste_mini_estornar(uuid)": "c8f160a73b3a30a6105c7a45aff9c89d",
      "public._peca_teste_mini_linhas(uuid,text,uuid,jsonb)": "3d73d0db8fc0902c5bd07edfbfa2fe70",
      "public._peca_teste_mini_tem_historico(uuid)": "10c05fae5041077c6dc23436d66f7d44"
    }
  }
}
/* URGD_JSON_FIM */;
