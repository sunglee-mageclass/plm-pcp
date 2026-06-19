export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      anos: {
        Row: {
          ano: string
          created_at: string | null
          id: string
          tenant_id: string | null
        }
        Insert: {
          ano: string
          created_at?: string | null
          id?: string
          tenant_id?: string | null
        }
        Update: {
          ano?: string
          created_at?: string | null
          id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "anos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      artigo_categorias_tecido: {
        Row: {
          artigo_id: string
          categoria_tecido_id: string
          created_at: string
          id: string
          tenant_id: string | null
        }
        Insert: {
          artigo_id: string
          categoria_tecido_id: string
          created_at?: string
          id?: string
          tenant_id?: string | null
        }
        Update: {
          artigo_id?: string
          categoria_tecido_id?: string
          created_at?: string
          id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artigo_categorias_tecido_artigo_id_fkey"
            columns: ["artigo_id"]
            isOneToOne: false
            referencedRelation: "artigos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artigo_categorias_tecido_categoria_tecido_id_fkey"
            columns: ["categoria_tecido_id"]
            isOneToOne: false
            referencedRelation: "categorias_tecido"
            referencedColumns: ["id"]
          },
        ]
      }
      artigos: {
        Row: {
          ano_id: string | null
          categoria_tecido_id: string | null
          composicao: string | null
          created_at: string | null
          empresa_id: string | null
          etiqueta_lavagem_urls: string[]
          historico_precos: Json | null
          id: string
          largura_estimada: number | null
          mes_id: string | null
          nome: string
          preco: number | null
          preco_por_metro: number | null
          rendimento: number | null
          tenant_id: string | null
          unidade_medida: string
        }
        Insert: {
          ano_id?: string | null
          categoria_tecido_id?: string | null
          composicao?: string | null
          created_at?: string | null
          empresa_id?: string | null
          etiqueta_lavagem_urls?: string[]
          historico_precos?: Json | null
          id?: string
          largura_estimada?: number | null
          mes_id?: string | null
          nome: string
          preco?: number | null
          preco_por_metro?: number | null
          rendimento?: number | null
          tenant_id?: string | null
          unidade_medida?: string
        }
        Update: {
          ano_id?: string | null
          categoria_tecido_id?: string | null
          composicao?: string | null
          created_at?: string | null
          empresa_id?: string | null
          etiqueta_lavagem_urls?: string[]
          historico_precos?: Json | null
          id?: string
          largura_estimada?: number | null
          mes_id?: string | null
          nome?: string
          preco?: number | null
          preco_por_metro?: number | null
          rendimento?: number | null
          tenant_id?: string | null
          unidade_medida?: string
        }
        Relationships: [
          {
            foreignKeyName: "artigos_ano_id_fkey"
            columns: ["ano_id"]
            isOneToOne: false
            referencedRelation: "anos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artigos_categoria_tecido_id_fkey"
            columns: ["categoria_tecido_id"]
            isOneToOne: false
            referencedRelation: "categorias_tecido"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artigos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artigos_mes_id_fkey"
            columns: ["mes_id"]
            isOneToOne: false
            referencedRelation: "meses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artigos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      aviamentos: {
        Row: {
          categoria_aviamento_id: string | null
          codigo_nome: string
          composicao: string | null
          created_at: string | null
          empresa_id: string | null
          foto_url: string | null
          id: string
          intervalo_largura_id: string | null
          intervalo_vazado_id: string | null
          largura_exata: number | null
          largura_exata_vazado: number | null
          material_aviamento_id: string | null
          observacoes: string | null
          preco: number | null
          subcategoria_aviamento_id: string | null
          tenant_id: string | null
        }
        Insert: {
          categoria_aviamento_id?: string | null
          codigo_nome: string
          composicao?: string | null
          created_at?: string | null
          empresa_id?: string | null
          foto_url?: string | null
          id?: string
          intervalo_largura_id?: string | null
          intervalo_vazado_id?: string | null
          largura_exata?: number | null
          largura_exata_vazado?: number | null
          material_aviamento_id?: string | null
          observacoes?: string | null
          preco?: number | null
          subcategoria_aviamento_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          categoria_aviamento_id?: string | null
          codigo_nome?: string
          composicao?: string | null
          created_at?: string | null
          empresa_id?: string | null
          foto_url?: string | null
          id?: string
          intervalo_largura_id?: string | null
          intervalo_vazado_id?: string | null
          largura_exata?: number | null
          largura_exata_vazado?: number | null
          material_aviamento_id?: string | null
          observacoes?: string | null
          preco?: number | null
          subcategoria_aviamento_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aviamentos_categoria_aviamento_id_fkey"
            columns: ["categoria_aviamento_id"]
            isOneToOne: false
            referencedRelation: "categorias_aviamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aviamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aviamentos_intervalo_largura_id_fkey"
            columns: ["intervalo_largura_id"]
            isOneToOne: false
            referencedRelation: "intervalos_largura"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aviamentos_intervalo_vazado_id_fkey"
            columns: ["intervalo_vazado_id"]
            isOneToOne: false
            referencedRelation: "intervalos_largura"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aviamentos_material_aviamento_id_fkey"
            columns: ["material_aviamento_id"]
            isOneToOne: false
            referencedRelation: "materiais_aviamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aviamentos_subcategoria_aviamento_id_fkey"
            columns: ["subcategoria_aviamento_id"]
            isOneToOne: false
            referencedRelation: "subcategorias_aviamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aviamentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cad: {
        Row: {
          created_at: string | null
          data_corte_pronto: string | null
          data_enviado_corte: string | null
          data_previsao_corte: string | null
          direcionamento_confirmado_at: string | null
          direcionamento_status: string
          enviado_corte: boolean | null
          ficha_medida_url: string | null
          id: string
          modelo_id: string | null
          observacoes_molde: string | null
          observacoes_tecnicas: string | null
          proporcoes_replanejadas: Json | null
          status_corte: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          data_corte_pronto?: string | null
          data_enviado_corte?: string | null
          data_previsao_corte?: string | null
          direcionamento_confirmado_at?: string | null
          direcionamento_status?: string
          enviado_corte?: boolean | null
          ficha_medida_url?: string | null
          id?: string
          modelo_id?: string | null
          observacoes_molde?: string | null
          observacoes_tecnicas?: string | null
          proporcoes_replanejadas?: Json | null
          status_corte?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          data_corte_pronto?: string | null
          data_enviado_corte?: string | null
          data_previsao_corte?: string | null
          direcionamento_confirmado_at?: string | null
          direcionamento_status?: string
          enviado_corte?: boolean | null
          ficha_medida_url?: string | null
          id?: string
          modelo_id?: string | null
          observacoes_molde?: string | null
          observacoes_tecnicas?: string | null
          proporcoes_replanejadas?: Json | null
          status_corte?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cad_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cad_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cad_aviamentos: {
        Row: {
          aviamento_id: string | null
          cad_id: string | null
          consumo: number | null
          created_at: string | null
          id: string
          numero: number
          quantidade_enviar: number | null
          quantidade_separar: number | null
        }
        Insert: {
          aviamento_id?: string | null
          cad_id?: string | null
          consumo?: number | null
          created_at?: string | null
          id?: string
          numero: number
          quantidade_enviar?: number | null
          quantidade_separar?: number | null
        }
        Update: {
          aviamento_id?: string | null
          cad_id?: string | null
          consumo?: number | null
          created_at?: string | null
          id?: string
          numero?: number
          quantidade_enviar?: number | null
          quantidade_separar?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cad_aviamentos_aviamento_id_fkey"
            columns: ["aviamento_id"]
            isOneToOne: false
            referencedRelation: "aviamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cad_aviamentos_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
        ]
      }
      cad_etiquetas: {
        Row: {
          cad_id: string | null
          consumo: number | null
          created_at: string | null
          etiqueta_id: string | null
          id: string
          quantidade_enviar: number | null
          quantidade_planejada: number | null
        }
        Insert: {
          cad_id?: string | null
          consumo?: number | null
          created_at?: string | null
          etiqueta_id?: string | null
          id?: string
          quantidade_enviar?: number | null
          quantidade_planejada?: number | null
        }
        Update: {
          cad_id?: string | null
          consumo?: number | null
          created_at?: string | null
          etiqueta_id?: string | null
          id?: string
          quantidade_enviar?: number | null
          quantidade_planejada?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cad_etiquetas_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cad_etiquetas_etiqueta_id_fkey"
            columns: ["etiqueta_id"]
            isOneToOne: false
            referencedRelation: "etiquetas"
            referencedColumns: ["id"]
          },
        ]
      }
      cad_grades: {
        Row: {
          cad_id: string | null
          created_at: string | null
          grade_total_planejada: number | null
          grade_total_real: number | null
          grades_planejadas: Json
          grades_reais: Json | null
          id: string
          variante_numero: number
        }
        Insert: {
          cad_id?: string | null
          created_at?: string | null
          grade_total_planejada?: number | null
          grade_total_real?: number | null
          grades_planejadas: Json
          grades_reais?: Json | null
          id?: string
          variante_numero: number
        }
        Update: {
          cad_id?: string | null
          created_at?: string | null
          grade_total_planejada?: number | null
          grade_total_real?: number | null
          grades_planejadas?: Json
          grades_reais?: Json | null
          id?: string
          variante_numero?: number
        }
        Relationships: [
          {
            foreignKeyName: "cad_grades_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
        ]
      }
      cad_tecido_variantes: {
        Row: {
          cad_tecido_id: string | null
          created_at: string | null
          id: string
          metragem_enviada: number | null
          metragem_planejada: number | null
          multiplicador: number
          ordem: number
          quantidade_folhas: number | null
          variante_tecido_id: string | null
        }
        Insert: {
          cad_tecido_id?: string | null
          created_at?: string | null
          id?: string
          metragem_enviada?: number | null
          metragem_planejada?: number | null
          multiplicador?: number
          ordem: number
          quantidade_folhas?: number | null
          variante_tecido_id?: string | null
        }
        Update: {
          cad_tecido_id?: string | null
          created_at?: string | null
          id?: string
          metragem_enviada?: number | null
          metragem_planejada?: number | null
          multiplicador?: number
          ordem?: number
          quantidade_folhas?: number | null
          variante_tecido_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cad_tecido_variantes_cad_tecido_id_fkey"
            columns: ["cad_tecido_id"]
            isOneToOne: false
            referencedRelation: "cad_tecidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cad_tecido_variantes_variante_tecido_id_fkey"
            columns: ["variante_tecido_id"]
            isOneToOne: false
            referencedRelation: "variantes_tecido"
            referencedColumns: ["id"]
          },
        ]
      }
      cad_tecidos: {
        Row: {
          artigo_id: string | null
          cad_id: string | null
          consumo_cad: number | null
          created_at: string | null
          custo_cad: number | null
          id: string
          loss_percent_cad: number | null
          numero: number
          tamanho_folha: number | null
          tipo: string
        }
        Insert: {
          artigo_id?: string | null
          cad_id?: string | null
          consumo_cad?: number | null
          created_at?: string | null
          custo_cad?: number | null
          id?: string
          loss_percent_cad?: number | null
          numero: number
          tamanho_folha?: number | null
          tipo?: string
        }
        Update: {
          artigo_id?: string | null
          cad_id?: string | null
          consumo_cad?: number | null
          created_at?: string | null
          custo_cad?: number | null
          id?: string
          loss_percent_cad?: number | null
          numero?: number
          tamanho_folha?: number | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cad_tecidos_artigo_id_fkey"
            columns: ["artigo_id"]
            isOneToOne: false
            referencedRelation: "artigos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cad_tecidos_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_aviamento: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categorias_aviamento_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_fornecedor: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categorias_fornecedor_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_produto: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categorias_produto_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_tecido: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categorias_tecido_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_terceirizado: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          ordem: number
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          ordem?: number
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          ordem?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categorias_terceirizado_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      colaboradores: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
          tipo: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
          tipo: string
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "colaboradores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      controle_qualidade: {
        Row: {
          cad_id: string | null
          confirmado_at: string | null
          created_at: string | null
          data_conserto_entregue: string | null
          data_conserto_enviado: string | null
          data_conserto_prevista: string | null
          data_lavagem_entregue: string | null
          data_lavagem_enviado: string | null
          data_recebimento_entregue: string | null
          data_recebimento_enviado_oficina: string | null
          data_recebimento_prevista: string | null
          fotografado_variantes: Json
          id: string
          observacoes_cq: string | null
          pecas_faltantes: number | null
          pecas_incompletas: number | null
          pecas_sem_etiqueta: number | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          cad_id?: string | null
          confirmado_at?: string | null
          created_at?: string | null
          data_conserto_entregue?: string | null
          data_conserto_enviado?: string | null
          data_conserto_prevista?: string | null
          data_lavagem_entregue?: string | null
          data_lavagem_enviado?: string | null
          data_recebimento_entregue?: string | null
          data_recebimento_enviado_oficina?: string | null
          data_recebimento_prevista?: string | null
          fotografado_variantes?: Json
          id?: string
          observacoes_cq?: string | null
          pecas_faltantes?: number | null
          pecas_incompletas?: number | null
          pecas_sem_etiqueta?: number | null
          status?: string
          tenant_id?: string | null
        }
        Update: {
          cad_id?: string | null
          confirmado_at?: string | null
          created_at?: string | null
          data_conserto_entregue?: string | null
          data_conserto_enviado?: string | null
          data_conserto_prevista?: string | null
          data_lavagem_entregue?: string | null
          data_lavagem_enviado?: string | null
          data_recebimento_entregue?: string | null
          data_recebimento_enviado_oficina?: string | null
          data_recebimento_prevista?: string | null
          fotografado_variantes?: Json
          id?: string
          observacoes_cq?: string | null
          pecas_faltantes?: number | null
          pecas_incompletas?: number | null
          pecas_sem_etiqueta?: number | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "controle_qualidade_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "controle_qualidade_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cores: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cq_variantes: {
        Row: {
          controle_qualidade_id: string | null
          created_at: string | null
          destino_defeito: string | null
          etapa: string
          grade_total: number | null
          grades: Json
          id: string
          variante_numero: number
        }
        Insert: {
          controle_qualidade_id?: string | null
          created_at?: string | null
          destino_defeito?: string | null
          etapa: string
          grade_total?: number | null
          grades: Json
          id?: string
          variante_numero: number
        }
        Update: {
          controle_qualidade_id?: string | null
          created_at?: string | null
          destino_defeito?: string | null
          etapa?: string
          grade_total?: number | null
          grades?: Json
          id?: string
          variante_numero?: number
        }
        Relationships: [
          {
            foreignKeyName: "cq_variantes_controle_qualidade_id_fkey"
            columns: ["controle_qualidade_id"]
            isOneToOne: false
            referencedRelation: "controle_qualidade"
            referencedColumns: ["id"]
          },
        ]
      }
      destinos_saida: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "destinos_saida_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      direcionamento: {
        Row: {
          cad_id: string | null
          created_at: string | null
          ecommerce: Json | null
          ecommerce_total: number | null
          id: string
          loja_fisica: Json | null
          loja_fisica_total: number | null
          tenant_id: string | null
          variante_numero: number
        }
        Insert: {
          cad_id?: string | null
          created_at?: string | null
          ecommerce?: Json | null
          ecommerce_total?: number | null
          id?: string
          loja_fisica?: Json | null
          loja_fisica_total?: number | null
          tenant_id?: string | null
          variante_numero: number
        }
        Update: {
          cad_id?: string | null
          created_at?: string | null
          ecommerce?: Json | null
          ecommerce_total?: number | null
          id?: string
          loja_fisica?: Json | null
          loja_fisica_total?: number | null
          tenant_id?: string | null
          variante_numero?: number
        }
        Relationships: [
          {
            foreignKeyName: "direcionamento_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direcionamento_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_categorias_fornecedor: {
        Row: {
          categoria_fornecedor_id: string
          created_at: string
          empresa_id: string
          tenant_id: string | null
        }
        Insert: {
          categoria_fornecedor_id: string
          created_at?: string
          empresa_id: string
          tenant_id?: string | null
        }
        Update: {
          categoria_fornecedor_id?: string
          created_at?: string
          empresa_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empresa_categorias_fornecedor_categoria_fornecedor_id_fkey"
            columns: ["categoria_fornecedor_id"]
            isOneToOne: false
            referencedRelation: "categorias_fornecedor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_categorias_fornecedor_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          categoria_fornecedor_id: string | null
          created_at: string | null
          id: string
          nome_fantasia: string
          tenant_id: string | null
        }
        Insert: {
          categoria_fornecedor_id?: string | null
          created_at?: string | null
          id?: string
          nome_fantasia: string
          tenant_id?: string | null
        }
        Update: {
          categoria_fornecedor_id?: string | null
          created_at?: string | null
          id?: string
          nome_fantasia?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empresas_categoria_fornecedor_id_fkey"
            columns: ["categoria_fornecedor_id"]
            isOneToOne: false
            referencedRelation: "categorias_fornecedor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_tecido_baixas: {
        Row: {
          cad_id: string
          created_at: string
          id: string
          oc_tecido_item_id: string
          origem: string
          quantidade: number
          tenant_id: string
          variante_tecido_id: string
        }
        Insert: {
          cad_id: string
          created_at?: string
          id?: string
          oc_tecido_item_id: string
          origem: string
          quantidade: number
          tenant_id: string
          variante_tecido_id: string
        }
        Update: {
          cad_id?: string
          created_at?: string
          id?: string
          oc_tecido_item_id?: string
          origem?: string
          quantidade?: number
          tenant_id?: string
          variante_tecido_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "estoque_tecido_baixas_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_tecido_baixas_oc_tecido_item_id_fkey"
            columns: ["oc_tecido_item_id"]
            isOneToOne: false
            referencedRelation: "ocs_tecido_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_tecido_baixas_variante_tecido_id_fkey"
            columns: ["variante_tecido_id"]
            isOneToOne: false
            referencedRelation: "variantes_tecido"
            referencedColumns: ["id"]
          },
        ]
      }
      etiquetas: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tamanho: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tamanho?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tamanho?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "etiquetas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      intervalos_largura: {
        Row: {
          created_at: string | null
          id: string
          intervalo: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          intervalo: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          intervalo?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intervalos_largura_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lancamentos: {
        Row: {
          ano_lancamento: string | null
          cad_id: string | null
          created_at: string | null
          data_lancamento: string | null
          foto_peca_amostra: string | null
          id: string
          mes_lancamento: string | null
          modelo_id: string | null
          semana_lancamento: string | null
          tenant_id: string | null
          verificado: boolean | null
        }
        Insert: {
          ano_lancamento?: string | null
          cad_id?: string | null
          created_at?: string | null
          data_lancamento?: string | null
          foto_peca_amostra?: string | null
          id?: string
          mes_lancamento?: string | null
          modelo_id?: string | null
          semana_lancamento?: string | null
          tenant_id?: string | null
          verificado?: boolean | null
        }
        Update: {
          ano_lancamento?: string | null
          cad_id?: string | null
          created_at?: string | null
          data_lancamento?: string | null
          foto_peca_amostra?: string | null
          id?: string
          mes_lancamento?: string | null
          modelo_id?: string | null
          semana_lancamento?: string | null
          tenant_id?: string | null
          verificado?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "lancamentos_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      linhas: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linhas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      materiais_aviamento: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materiais_aviamento_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      meses: {
        Row: {
          created_at: string | null
          id: string
          mes: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          mes: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          mes?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      modelo_aviamentos: {
        Row: {
          aviamento_id: string | null
          consumo: number | null
          created_at: string | null
          custo_previsto: number | null
          id: string
          loss_percent: number | null
          modelo_id: string | null
          numero: number
        }
        Insert: {
          aviamento_id?: string | null
          consumo?: number | null
          created_at?: string | null
          custo_previsto?: number | null
          id?: string
          loss_percent?: number | null
          modelo_id?: string | null
          numero: number
        }
        Update: {
          aviamento_id?: string | null
          consumo?: number | null
          created_at?: string | null
          custo_previsto?: number | null
          id?: string
          loss_percent?: number | null
          modelo_id?: string | null
          numero?: number
        }
        Relationships: [
          {
            foreignKeyName: "modelo_aviamentos_aviamento_id_fkey"
            columns: ["aviamento_id"]
            isOneToOne: false
            referencedRelation: "aviamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelo_aviamentos_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos"
            referencedColumns: ["id"]
          },
        ]
      }
      modelo_grades: {
        Row: {
          created_at: string | null
          grade_total: number | null
          grades: Json
          id: string
          modelo_id: string | null
          variante_numero: number
        }
        Insert: {
          created_at?: string | null
          grade_total?: number | null
          grades: Json
          id?: string
          modelo_id?: string | null
          variante_numero: number
        }
        Update: {
          created_at?: string | null
          grade_total?: number | null
          grades?: Json
          id?: string
          modelo_id?: string | null
          variante_numero?: number
        }
        Relationships: [
          {
            foreignKeyName: "modelo_grades_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos"
            referencedColumns: ["id"]
          },
        ]
      }
      modelo_observacoes: {
        Row: {
          created_at: string | null
          descricao: string | null
          id: string
          modelo_id: string
          observacao: string | null
          ordem: number | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          id?: string
          modelo_id: string
          observacao?: string | null
          ordem?: number | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          id?: string
          modelo_id?: string
          observacao?: string | null
          ordem?: number | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "modelo_observacoes_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelo_observacoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      modelo_tecido_oc_links: {
        Row: {
          created_at: string
          id: string
          modelo_id: string
          numero: number
          oc_tecido_item_id: string
          ordem: number
          prioridade: number
          quantidade_m: number
          tenant_id: string
          tipo: string
          updated_at: string
          variante_tecido_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          modelo_id: string
          numero: number
          oc_tecido_item_id: string
          ordem: number
          prioridade?: number
          quantidade_m?: number
          tenant_id: string
          tipo: string
          updated_at?: string
          variante_tecido_id: string
        }
        Update: {
          created_at?: string
          id?: string
          modelo_id?: string
          numero?: number
          oc_tecido_item_id?: string
          ordem?: number
          prioridade?: number
          quantidade_m?: number
          tenant_id?: string
          tipo?: string
          updated_at?: string
          variante_tecido_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "modelo_tecido_oc_links_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelo_tecido_oc_links_oc_tecido_item_id_fkey"
            columns: ["oc_tecido_item_id"]
            isOneToOne: false
            referencedRelation: "ocs_tecido_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelo_tecido_oc_links_variante_tecido_id_fkey"
            columns: ["variante_tecido_id"]
            isOneToOne: false
            referencedRelation: "variantes_tecido"
            referencedColumns: ["id"]
          },
        ]
      }
      modelo_tecido_variantes: {
        Row: {
          created_at: string | null
          id: string
          modelo_tecido_id: string | null
          multiplicador: number
          ordem: number
          variante_tecido_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          modelo_tecido_id?: string | null
          multiplicador?: number
          ordem: number
          variante_tecido_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          modelo_tecido_id?: string | null
          multiplicador?: number
          ordem?: number
          variante_tecido_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "modelo_tecido_variantes_modelo_tecido_id_fkey"
            columns: ["modelo_tecido_id"]
            isOneToOne: false
            referencedRelation: "modelo_tecidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelo_tecido_variantes_variante_tecido_id_fkey"
            columns: ["variante_tecido_id"]
            isOneToOne: false
            referencedRelation: "variantes_tecido"
            referencedColumns: ["id"]
          },
        ]
      }
      modelo_tecidos: {
        Row: {
          artigo_id: string | null
          consumo: number | null
          created_at: string | null
          custo_previsto: number | null
          id: string
          loss_percent: number | null
          modelo_id: string | null
          numero: number
          tipo: string
        }
        Insert: {
          artigo_id?: string | null
          consumo?: number | null
          created_at?: string | null
          custo_previsto?: number | null
          id?: string
          loss_percent?: number | null
          modelo_id?: string | null
          numero: number
          tipo?: string
        }
        Update: {
          artigo_id?: string | null
          consumo?: number | null
          created_at?: string | null
          custo_previsto?: number | null
          id?: string
          loss_percent?: number | null
          modelo_id?: string | null
          numero?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "modelo_tecidos_artigo_id_fkey"
            columns: ["artigo_id"]
            isOneToOne: false
            referencedRelation: "artigos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelo_tecidos_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos"
            referencedColumns: ["id"]
          },
        ]
      }
      modelos: {
        Row: {
          ajustes_prova: string | null
          ano_id: string | null
          categoria_principal_id: string | null
          categoria_secundaria_id: string | null
          colecao: string | null
          created_at: string | null
          custo_aviamento_total: number | null
          custo_entretela_total: number | null
          custo_forro_total: number | null
          custo_peca_previsto: number | null
          custo_tecido_total: number | null
          custo_terceirizados_previsto: number | null
          data_aprovacao: string | null
          data_desenho_tecnico: string | null
          data_piloto1: string | null
          data_piloto2: string | null
          data_piloto3: string | null
          desenho_tecnico_url: string | null
          enviado_cad: boolean | null
          estilista_id: string | null
          ficha_medida_url: string | null
          fotos_modelo: string[] | null
          fotos_referencia: string[] | null
          id: string
          linha_id: string | null
          mes_id: string | null
          modelista_id: string | null
          modelo_base_id: string | null
          motivo_cancelamento: string | null
          nome: string
          observacoes_gerais: string | null
          observacoes_tecnicas: string | null
          piloteiro1_id: string | null
          piloteiro2_id: string | null
          piloteiro3_id: string | null
          proporcoes: Json | null
          ref: string | null
          semana: string | null
          status_desenvolvimento: string | null
          status_planejamento: string | null
          tecidos_planejados: string[]
          tenant_id: string | null
          versao: number
        }
        Insert: {
          ajustes_prova?: string | null
          ano_id?: string | null
          categoria_principal_id?: string | null
          categoria_secundaria_id?: string | null
          colecao?: string | null
          created_at?: string | null
          custo_aviamento_total?: number | null
          custo_entretela_total?: number | null
          custo_forro_total?: number | null
          custo_peca_previsto?: number | null
          custo_tecido_total?: number | null
          custo_terceirizados_previsto?: number | null
          data_aprovacao?: string | null
          data_desenho_tecnico?: string | null
          data_piloto1?: string | null
          data_piloto2?: string | null
          data_piloto3?: string | null
          desenho_tecnico_url?: string | null
          enviado_cad?: boolean | null
          estilista_id?: string | null
          ficha_medida_url?: string | null
          fotos_modelo?: string[] | null
          fotos_referencia?: string[] | null
          id?: string
          linha_id?: string | null
          mes_id?: string | null
          modelista_id?: string | null
          modelo_base_id?: string | null
          motivo_cancelamento?: string | null
          nome: string
          observacoes_gerais?: string | null
          observacoes_tecnicas?: string | null
          piloteiro1_id?: string | null
          piloteiro2_id?: string | null
          piloteiro3_id?: string | null
          proporcoes?: Json | null
          ref?: string | null
          semana?: string | null
          status_desenvolvimento?: string | null
          status_planejamento?: string | null
          tecidos_planejados?: string[]
          tenant_id?: string | null
          versao?: number
        }
        Update: {
          ajustes_prova?: string | null
          ano_id?: string | null
          categoria_principal_id?: string | null
          categoria_secundaria_id?: string | null
          colecao?: string | null
          created_at?: string | null
          custo_aviamento_total?: number | null
          custo_entretela_total?: number | null
          custo_forro_total?: number | null
          custo_peca_previsto?: number | null
          custo_tecido_total?: number | null
          custo_terceirizados_previsto?: number | null
          data_aprovacao?: string | null
          data_desenho_tecnico?: string | null
          data_piloto1?: string | null
          data_piloto2?: string | null
          data_piloto3?: string | null
          desenho_tecnico_url?: string | null
          enviado_cad?: boolean | null
          estilista_id?: string | null
          ficha_medida_url?: string | null
          fotos_modelo?: string[] | null
          fotos_referencia?: string[] | null
          id?: string
          linha_id?: string | null
          mes_id?: string | null
          modelista_id?: string | null
          modelo_base_id?: string | null
          motivo_cancelamento?: string | null
          nome?: string
          observacoes_gerais?: string | null
          observacoes_tecnicas?: string | null
          piloteiro1_id?: string | null
          piloteiro2_id?: string | null
          piloteiro3_id?: string | null
          proporcoes?: Json | null
          ref?: string | null
          semana?: string | null
          status_desenvolvimento?: string | null
          status_planejamento?: string | null
          tecidos_planejados?: string[]
          tenant_id?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "modelos_ano_id_fkey"
            columns: ["ano_id"]
            isOneToOne: false
            referencedRelation: "anos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_categoria_principal_id_fkey"
            columns: ["categoria_principal_id"]
            isOneToOne: false
            referencedRelation: "categorias_produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_categoria_secundaria_id_fkey"
            columns: ["categoria_secundaria_id"]
            isOneToOne: false
            referencedRelation: "categorias_produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_estilista_id_fkey"
            columns: ["estilista_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_linha_id_fkey"
            columns: ["linha_id"]
            isOneToOne: false
            referencedRelation: "linhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_mes_id_fkey"
            columns: ["mes_id"]
            isOneToOne: false
            referencedRelation: "meses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_modelista_id_fkey"
            columns: ["modelista_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_modelo_base_id_fkey"
            columns: ["modelo_base_id"]
            isOneToOne: false
            referencedRelation: "modelos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_piloteiro1_id_fkey"
            columns: ["piloteiro1_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_piloteiro2_id_fkey"
            columns: ["piloteiro2_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_piloteiro3_id_fkey"
            columns: ["piloteiro3_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ocs_aviamento: {
        Row: {
          created_at: string | null
          data_entrega: string | null
          data_pedido: string | null
          data_prevista_entrega: string | null
          empresa_id: string | null
          id: string
          nf_url: string | null
          numero_pedido: string | null
          parcelas_recebimento: Json
          prazo_pagamento: string | null
          quantidade_prazos: number | null
          responsavel_nome: string | null
          status: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          data_entrega?: string | null
          data_pedido?: string | null
          data_prevista_entrega?: string | null
          empresa_id?: string | null
          id?: string
          nf_url?: string | null
          numero_pedido?: string | null
          parcelas_recebimento?: Json
          prazo_pagamento?: string | null
          quantidade_prazos?: number | null
          responsavel_nome?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          data_entrega?: string | null
          data_pedido?: string | null
          data_prevista_entrega?: string | null
          empresa_id?: string | null
          id?: string
          nf_url?: string | null
          numero_pedido?: string | null
          parcelas_recebimento?: Json
          prazo_pagamento?: string | null
          quantidade_prazos?: number | null
          responsavel_nome?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ocs_aviamento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocs_aviamento_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ocs_aviamento_itens: {
        Row: {
          aviamento_id: string | null
          cancelado: boolean
          created_at: string | null
          id: string
          oc_aviamento_id: string | null
          quantidade_pedida: number | null
          quantidade_recebida: number | null
        }
        Insert: {
          aviamento_id?: string | null
          cancelado?: boolean
          created_at?: string | null
          id?: string
          oc_aviamento_id?: string | null
          quantidade_pedida?: number | null
          quantidade_recebida?: number | null
        }
        Update: {
          aviamento_id?: string | null
          cancelado?: boolean
          created_at?: string | null
          id?: string
          oc_aviamento_id?: string | null
          quantidade_pedida?: number | null
          quantidade_recebida?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ocs_aviamento_itens_aviamento_id_fkey"
            columns: ["aviamento_id"]
            isOneToOne: false
            referencedRelation: "aviamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocs_aviamento_itens_oc_aviamento_id_fkey"
            columns: ["oc_aviamento_id"]
            isOneToOne: false
            referencedRelation: "ocs_aviamento"
            referencedColumns: ["id"]
          },
        ]
      }
      ocs_tecido: {
        Row: {
          anexo_pedido_url: string | null
          created_at: string | null
          is_rolo: boolean
          rolo_codigo: string | null
          rolo_origem_item_id: string | null
          rolo_rua: string | null
          rolo_prateleira: string | null
          data_entrega: string | null
          data_pedido: string | null
          data_prevista_entrega: string | null
          empresa_id: string | null
          etiqueta_lavagem_url_1: string | null
          etiqueta_lavagem_url_2: string | null
          etiqueta_lavagem_urls: string[] | null
          id: string
          modelo_sugerido_url: string | null
          nf_url: string | null
          numero_pedido: string | null
          observacoes_defeitos: string | null
          observacoes_entrega: string | null
          parcelas_recebimento: Json
          prazo_pagamento: string | null
          quantidade_prazos: number | null
          responsavel_id: string | null
          responsavel_nome: string | null
          status: string | null
          tenant_id: string | null
          valor_previsto_total: number | null
          valor_real_total: number | null
        }
        Insert: {
          anexo_pedido_url?: string | null
          created_at?: string | null
          is_rolo?: boolean
          rolo_codigo?: string | null
          rolo_origem_item_id?: string | null
          rolo_rua?: string | null
          rolo_prateleira?: string | null
          data_entrega?: string | null
          data_pedido?: string | null
          data_prevista_entrega?: string | null
          empresa_id?: string | null
          etiqueta_lavagem_url_1?: string | null
          etiqueta_lavagem_url_2?: string | null
          etiqueta_lavagem_urls?: string[] | null
          id?: string
          modelo_sugerido_url?: string | null
          nf_url?: string | null
          numero_pedido?: string | null
          observacoes_defeitos?: string | null
          observacoes_entrega?: string | null
          parcelas_recebimento?: Json
          prazo_pagamento?: string | null
          quantidade_prazos?: number | null
          responsavel_id?: string | null
          responsavel_nome?: string | null
          status?: string | null
          tenant_id?: string | null
          valor_previsto_total?: number | null
          valor_real_total?: number | null
        }
        Update: {
          anexo_pedido_url?: string | null
          created_at?: string | null
          is_rolo?: boolean
          rolo_codigo?: string | null
          rolo_origem_item_id?: string | null
          rolo_rua?: string | null
          rolo_prateleira?: string | null
          data_entrega?: string | null
          data_pedido?: string | null
          data_prevista_entrega?: string | null
          empresa_id?: string | null
          etiqueta_lavagem_url_1?: string | null
          etiqueta_lavagem_url_2?: string | null
          etiqueta_lavagem_urls?: string[] | null
          id?: string
          modelo_sugerido_url?: string | null
          nf_url?: string | null
          numero_pedido?: string | null
          observacoes_defeitos?: string | null
          observacoes_entrega?: string | null
          parcelas_recebimento?: Json
          prazo_pagamento?: string | null
          quantidade_prazos?: number | null
          responsavel_id?: string | null
          responsavel_nome?: string | null
          status?: string | null
          tenant_id?: string | null
          valor_previsto_total?: number | null
          valor_real_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ocs_tecido_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocs_tecido_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocs_tecido_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ocs_tecido_itens: {
        Row: {
          artigo_id: string | null
          artigo_numero: number | null
          cancelado: boolean
          cq_alertar_estilo: boolean
          cq_estilo_ok: boolean
          cq_observacao: string | null
          cq_ok: boolean
          created_at: string | null
          estoque_zerado: boolean
          id: string
          oc_tecido_id: string | null
          quantidade_pedida: number | null
          quantidade_recebida: number | null
          rendimento: number | null
          variante_tecido_id: string | null
        }
        Insert: {
          artigo_id?: string | null
          artigo_numero?: number | null
          cancelado?: boolean
          cq_alertar_estilo?: boolean
          cq_estilo_ok?: boolean
          cq_observacao?: string | null
          cq_ok?: boolean
          created_at?: string | null
          estoque_zerado?: boolean
          id?: string
          oc_tecido_id?: string | null
          quantidade_pedida?: number | null
          quantidade_recebida?: number | null
          rendimento?: number | null
          variante_tecido_id?: string | null
        }
        Update: {
          artigo_id?: string | null
          artigo_numero?: number | null
          cancelado?: boolean
          cq_alertar_estilo?: boolean
          cq_estilo_ok?: boolean
          cq_observacao?: string | null
          cq_ok?: boolean
          created_at?: string | null
          estoque_zerado?: boolean
          id?: string
          oc_tecido_id?: string | null
          quantidade_pedida?: number | null
          quantidade_recebida?: number | null
          rendimento?: number | null
          variante_tecido_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ocs_tecido_itens_artigo_id_fkey"
            columns: ["artigo_id"]
            isOneToOne: false
            referencedRelation: "artigos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocs_tecido_itens_oc_tecido_id_fkey"
            columns: ["oc_tecido_id"]
            isOneToOne: false
            referencedRelation: "ocs_tecido"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocs_tecido_itens_variante_tecido_id_fkey"
            columns: ["variante_tecido_id"]
            isOneToOne: false
            referencedRelation: "variantes_tecido"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_saida_aviamento: {
        Row: {
          baixado: boolean
          created_at: string | null
          created_by: string | null
          data_corte: string | null
          data_solicitacao: string | null
          destino_id: string | null
          id: string
          numero: number | null
          observacao: string | null
          responsavel: string | null
          tenant_id: string | null
        }
        Insert: {
          baixado?: boolean
          created_at?: string | null
          created_by?: string | null
          data_corte?: string | null
          data_solicitacao?: string | null
          destino_id?: string | null
          id?: string
          numero?: number | null
          observacao?: string | null
          responsavel?: string | null
          tenant_id?: string | null
        }
        Update: {
          baixado?: boolean
          created_at?: string | null
          created_by?: string | null
          data_corte?: string | null
          data_solicitacao?: string | null
          destino_id?: string | null
          id?: string
          numero?: number | null
          observacao?: string | null
          responsavel?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordens_saida_aviamento_destino_id_fkey"
            columns: ["destino_id"]
            isOneToOne: false
            referencedRelation: "destinos_saida"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_saida_aviamento_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_saida_aviamento_itens: {
        Row: {
          aviamento_id: string | null
          baixa: number | null
          created_at: string | null
          id: string
          ordem_saida_id: string
          reserva: number | null
          tenant_id: string | null
        }
        Insert: {
          aviamento_id?: string | null
          baixa?: number | null
          created_at?: string | null
          id?: string
          ordem_saida_id: string
          reserva?: number | null
          tenant_id?: string | null
        }
        Update: {
          aviamento_id?: string | null
          baixa?: number | null
          created_at?: string | null
          id?: string
          ordem_saida_id?: string
          reserva?: number | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordens_saida_aviamento_itens_aviamento_id_fkey"
            columns: ["aviamento_id"]
            isOneToOne: false
            referencedRelation: "aviamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_saida_aviamento_itens_ordem_saida_id_fkey"
            columns: ["ordem_saida_id"]
            isOneToOne: false
            referencedRelation: "ordens_saida_aviamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_saida_aviamento_itens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_saida_tecido: {
        Row: {
          baixado: boolean
          created_at: string | null
          created_by: string | null
          data_corte: string | null
          data_solicitacao: string | null
          destino_id: string | null
          id: string
          numero: number | null
          observacao: string | null
          responsavel: string | null
          tenant_id: string | null
        }
        Insert: {
          baixado?: boolean
          created_at?: string | null
          created_by?: string | null
          data_corte?: string | null
          data_solicitacao?: string | null
          destino_id?: string | null
          id?: string
          numero?: number | null
          observacao?: string | null
          responsavel?: string | null
          tenant_id?: string | null
        }
        Update: {
          baixado?: boolean
          created_at?: string | null
          created_by?: string | null
          data_corte?: string | null
          data_solicitacao?: string | null
          destino_id?: string | null
          id?: string
          numero?: number | null
          observacao?: string | null
          responsavel?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordens_saida_tecido_destino_id_fkey"
            columns: ["destino_id"]
            isOneToOne: false
            referencedRelation: "destinos_saida"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_saida_tecido_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_saida_tecido_itens: {
        Row: {
          baixa: number | null
          created_at: string | null
          id: string
          ordem_saida_id: string
          reserva: number | null
          tenant_id: string | null
          variante_tecido_id: string | null
        }
        Insert: {
          baixa?: number | null
          created_at?: string | null
          id?: string
          ordem_saida_id: string
          reserva?: number | null
          tenant_id?: string | null
          variante_tecido_id?: string | null
        }
        Update: {
          baixa?: number | null
          created_at?: string | null
          id?: string
          ordem_saida_id?: string
          reserva?: number | null
          tenant_id?: string | null
          variante_tecido_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordens_saida_tecido_itens_ordem_saida_id_fkey"
            columns: ["ordem_saida_id"]
            isOneToOne: false
            referencedRelation: "ordens_saida_tecido"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_saida_tecido_itens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_saida_tecido_itens_variante_tecido_id_fkey"
            columns: ["variante_tecido_id"]
            isOneToOne: false
            referencedRelation: "variantes_tecido"
            referencedColumns: ["id"]
          },
        ]
      }
      parcelas: {
        Row: {
          comprovante_url: string | null
          created_at: string | null
          data_pagamento: string | null
          data_vencimento: string
          empresa_id: string | null
          id: string
          numero_parcela: number
          oc_aviamento_id: string | null
          oc_tecido_id: string | null
          status: string | null
          tenant_id: string | null
          tipo_oc: string
          valor: number
        }
        Insert: {
          comprovante_url?: string | null
          created_at?: string | null
          data_pagamento?: string | null
          data_vencimento: string
          empresa_id?: string | null
          id?: string
          numero_parcela: number
          oc_aviamento_id?: string | null
          oc_tecido_id?: string | null
          status?: string | null
          tenant_id?: string | null
          tipo_oc: string
          valor: number
        }
        Update: {
          comprovante_url?: string | null
          created_at?: string | null
          data_pagamento?: string | null
          data_vencimento?: string
          empresa_id?: string | null
          id?: string
          numero_parcela?: number
          oc_aviamento_id?: string | null
          oc_tecido_id?: string | null
          status?: string | null
          tenant_id?: string | null
          tipo_oc?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "parcelas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcelas_oc_aviamento_id_fkey"
            columns: ["oc_aviamento_id"]
            isOneToOne: false
            referencedRelation: "ocs_aviamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcelas_oc_tecido_id_fkey"
            columns: ["oc_tecido_id"]
            isOneToOne: false
            referencedRelation: "ocs_tecido"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcelas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      print_templates: {
        Row: {
          created_at: string | null
          doc_type: string
          id: string
          layout: Json
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          doc_type: string
          id?: string
          layout?: Json
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          doc_type?: string
          id?: string
          layout?: Json
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "print_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      producao_acabamento: {
        Row: {
          ativo: boolean | null
          aviamentos_utilizados: Json | null
          cad_id: string | null
          created_at: string | null
          data_entregue: string | null
          data_enviado: string | null
          data_prevista: string | null
          id: string
          observacao: string | null
          preco_por_peca: number | null
          quantidade_defeito: number | null
          quantidade_enviada: number | null
          quantidade_recebida: number | null
          status: string | null
          tenant_id: string | null
          terceirizado_id: string | null
          tipo: string
        }
        Insert: {
          ativo?: boolean | null
          aviamentos_utilizados?: Json | null
          cad_id?: string | null
          created_at?: string | null
          data_entregue?: string | null
          data_enviado?: string | null
          data_prevista?: string | null
          id?: string
          observacao?: string | null
          preco_por_peca?: number | null
          quantidade_defeito?: number | null
          quantidade_enviada?: number | null
          quantidade_recebida?: number | null
          status?: string | null
          tenant_id?: string | null
          terceirizado_id?: string | null
          tipo: string
        }
        Update: {
          ativo?: boolean | null
          aviamentos_utilizados?: Json | null
          cad_id?: string | null
          created_at?: string | null
          data_entregue?: string | null
          data_enviado?: string | null
          data_prevista?: string | null
          id?: string
          observacao?: string | null
          preco_por_peca?: number | null
          quantidade_defeito?: number | null
          quantidade_enviada?: number | null
          quantidade_recebida?: number | null
          status?: string | null
          tenant_id?: string | null
          terceirizado_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "producao_acabamento_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_acabamento_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_acabamento_terceirizado_id_fkey"
            columns: ["terceirizado_id"]
            isOneToOne: false
            referencedRelation: "terceirizados"
            referencedColumns: ["id"]
          },
        ]
      }
      producao_oficina: {
        Row: {
          cad_id: string | null
          colaborador_id: string | null
          created_at: string | null
          data_entregue: string | null
          data_enviado: string | null
          data_prevista: string | null
          id: string
          interno: boolean
          observacao: string | null
          observacoes_molde: string | null
          preco_por_peca: number | null
          quantidade_defeito: number | null
          quantidade_enviada: number | null
          quantidade_recebida: number | null
          status: string | null
          tenant_id: string | null
          terceirizado_id: string | null
        }
        Insert: {
          cad_id?: string | null
          colaborador_id?: string | null
          created_at?: string | null
          data_entregue?: string | null
          data_enviado?: string | null
          data_prevista?: string | null
          id?: string
          interno?: boolean
          observacao?: string | null
          observacoes_molde?: string | null
          preco_por_peca?: number | null
          quantidade_defeito?: number | null
          quantidade_enviada?: number | null
          quantidade_recebida?: number | null
          status?: string | null
          tenant_id?: string | null
          terceirizado_id?: string | null
        }
        Update: {
          cad_id?: string | null
          colaborador_id?: string | null
          created_at?: string | null
          data_entregue?: string | null
          data_enviado?: string | null
          data_prevista?: string | null
          id?: string
          interno?: boolean
          observacao?: string | null
          observacoes_molde?: string | null
          preco_por_peca?: number | null
          quantidade_defeito?: number | null
          quantidade_enviada?: number | null
          quantidade_recebida?: number | null
          status?: string | null
          tenant_id?: string | null
          terceirizado_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "producao_oficina_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_oficina_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_oficina_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_oficina_terceirizado_id_fkey"
            columns: ["terceirizado_id"]
            isOneToOne: false
            referencedRelation: "terceirizados"
            referencedColumns: ["id"]
          },
        ]
      }
      producao_terceirizados: {
        Row: {
          ativo: boolean | null
          aviamentos_enviados: Json | null
          cad_id: string | null
          categoria_terceirizado_id: string | null
          colaborador_id: string | null
          created_at: string | null
          data_entregue: string | null
          data_enviado: string | null
          data_prevista: string | null
          id: string
          interno: boolean
          observacao: string | null
          preco_metro_unidade: number | null
          quantidade_defeito: number | null
          quantidade_enviada: number | null
          quantidade_recebida: number | null
          status: string | null
          tecidos_enviados: Json | null
          tenant_id: string | null
          terceirizado_id: string | null
        }
        Insert: {
          ativo?: boolean | null
          aviamentos_enviados?: Json | null
          cad_id?: string | null
          categoria_terceirizado_id?: string | null
          colaborador_id?: string | null
          created_at?: string | null
          data_entregue?: string | null
          data_enviado?: string | null
          data_prevista?: string | null
          id?: string
          interno?: boolean
          observacao?: string | null
          preco_metro_unidade?: number | null
          quantidade_defeito?: number | null
          quantidade_enviada?: number | null
          quantidade_recebida?: number | null
          status?: string | null
          tecidos_enviados?: Json | null
          tenant_id?: string | null
          terceirizado_id?: string | null
        }
        Update: {
          ativo?: boolean | null
          aviamentos_enviados?: Json | null
          cad_id?: string | null
          categoria_terceirizado_id?: string | null
          colaborador_id?: string | null
          created_at?: string | null
          data_entregue?: string | null
          data_enviado?: string | null
          data_prevista?: string | null
          id?: string
          interno?: boolean
          observacao?: string | null
          preco_metro_unidade?: number | null
          quantidade_defeito?: number | null
          quantidade_enviada?: number | null
          quantidade_recebida?: number | null
          status?: string | null
          tecidos_enviados?: Json | null
          tenant_id?: string | null
          terceirizado_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "producao_terceirizados_cad_id_fkey"
            columns: ["cad_id"]
            isOneToOne: false
            referencedRelation: "cad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_terceirizados_categoria_terceirizado_id_fkey"
            columns: ["categoria_terceirizado_id"]
            isOneToOne: false
            referencedRelation: "categorias_terceirizado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_terceirizados_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_terceirizados_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_terceirizados_terceirizado_id_fkey"
            columns: ["terceirizado_id"]
            isOneToOne: false
            referencedRelation: "terceirizados"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      representantes: {
        Row: {
          cnpj: string | null
          contato: string | null
          created_at: string | null
          empresa_id: string | null
          id: string
          logradouro: string | null
          nome: string | null
          observacoes: string | null
          razao_social: string | null
          tenant_id: string | null
        }
        Insert: {
          cnpj?: string | null
          contato?: string | null
          created_at?: string | null
          empresa_id?: string | null
          id?: string
          logradouro?: string | null
          nome?: string | null
          observacoes?: string | null
          razao_social?: string | null
          tenant_id?: string | null
        }
        Update: {
          cnpj?: string | null
          contato?: string | null
          created_at?: string | null
          empresa_id?: string | null
          id?: string
          logradouro?: string | null
          nome?: string | null
          observacoes?: string | null
          razao_social?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "representantes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "representantes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subcategorias_aviamento: {
        Row: {
          categoria_aviamento_id: string | null
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
        }
        Insert: {
          categoria_aviamento_id?: string | null
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
        }
        Update: {
          categoria_aviamento_id?: string | null
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subcategorias_aviamento_categoria_aviamento_id_fkey"
            columns: ["categoria_aviamento_id"]
            isOneToOne: false
            referencedRelation: "categorias_aviamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcategorias_aviamento_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          created_at: string
          favicon_url: string | null
          id: string
          logo_url: string | null
          nome_sistema: string
          singleton: boolean
          subtitulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          nome_sistema?: string
          singleton?: boolean
          subtitulo?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          nome_sistema?: string
          singleton?: boolean
          subtitulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_config: {
        Row: {
          campos_editaveis: Json | null
          corte_interno: boolean | null
          created_at: string | null
          estoque_critico_aviamento: number | null
          estoque_critico_threshold: number
          etapas_acabamento: Json | null
          formato_mes: string | null
          id: string
          modo_baixa_estoque: string
          modules: Json
          oficina_interna: boolean | null
          oficina_posicao: string | null
          status_kanban: Json | null
          tab_labels: Json
          tamanhos_grade: Json | null
          tenant_id: string | null
          timezone: string
          usa_pl: boolean | null
        }
        Insert: {
          campos_editaveis?: Json | null
          corte_interno?: boolean | null
          created_at?: string | null
          estoque_critico_aviamento?: number | null
          estoque_critico_threshold?: number
          etapas_acabamento?: Json | null
          formato_mes?: string | null
          id?: string
          modo_baixa_estoque?: string
          modules?: Json
          oficina_interna?: boolean | null
          oficina_posicao?: string | null
          status_kanban?: Json | null
          tab_labels?: Json
          tamanhos_grade?: Json | null
          tenant_id?: string | null
          timezone?: string
          usa_pl?: boolean | null
        }
        Update: {
          campos_editaveis?: Json | null
          corte_interno?: boolean | null
          created_at?: string | null
          estoque_critico_aviamento?: number | null
          estoque_critico_threshold?: number
          etapas_acabamento?: Json | null
          formato_mes?: string | null
          id?: string
          modo_baixa_estoque?: string
          modules?: Json
          oficina_interna?: boolean | null
          oficina_posicao?: string | null
          status_kanban?: Json | null
          tab_labels?: Json
          tamanhos_grade?: Json | null
          tenant_id?: string | null
          timezone?: string
          usa_pl?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ativo: boolean | null
          cnpj: string | null
          contato: string | null
          created_at: string | null
          id: string
          logo_url: string | null
          nome: string
        }
        Insert: {
          ativo?: boolean | null
          cnpj?: string | null
          contato?: string | null
          created_at?: string | null
          id?: string
          logo_url?: string | null
          nome: string
        }
        Update: {
          ativo?: boolean | null
          cnpj?: string | null
          contato?: string | null
          created_at?: string | null
          id?: string
          logo_url?: string | null
          nome?: string
        }
        Relationships: []
      }
      terceirizado_categorias: {
        Row: {
          categoria_terceirizado_id: string
          created_at: string
          id: string
          tenant_id: string | null
          terceirizado_id: string
        }
        Insert: {
          categoria_terceirizado_id: string
          created_at?: string
          id?: string
          tenant_id?: string | null
          terceirizado_id: string
        }
        Update: {
          categoria_terceirizado_id?: string
          created_at?: string
          id?: string
          tenant_id?: string | null
          terceirizado_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "terceirizado_categorias_categoria_terceirizado_id_fkey"
            columns: ["categoria_terceirizado_id"]
            isOneToOne: false
            referencedRelation: "categorias_terceirizado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terceirizado_categorias_terceirizado_id_fkey"
            columns: ["terceirizado_id"]
            isOneToOne: false
            referencedRelation: "terceirizados"
            referencedColumns: ["id"]
          },
        ]
      }
      terceirizados: {
        Row: {
          categoria_terceirizado_id: string | null
          created_at: string | null
          id: string
          nome_responsavel: string
          tenant_id: string | null
        }
        Insert: {
          categoria_terceirizado_id?: string | null
          created_at?: string | null
          id?: string
          nome_responsavel: string
          tenant_id?: string | null
        }
        Update: {
          categoria_terceirizado_id?: string | null
          created_at?: string | null
          id?: string
          nome_responsavel?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "terceirizados_categoria_terceirizado_id_fkey"
            columns: ["categoria_terceirizado_id"]
            isOneToOne: false
            referencedRelation: "categorias_terceirizado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terceirizados_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tipos_colaborador: {
        Row: {
          categoria_terceirizado_id: string | null
          created_at: string | null
          id: string
          nome: string
          tenant_id: string | null
        }
        Insert: {
          categoria_terceirizado_id?: string | null
          created_at?: string | null
          id?: string
          nome: string
          tenant_id?: string | null
        }
        Update: {
          categoria_terceirizado_id?: string | null
          created_at?: string | null
          id?: string
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tipos_colaborador_categoria_terceirizado_id_fkey"
            columns: ["categoria_terceirizado_id"]
            isOneToOne: false
            referencedRelation: "categorias_terceirizado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tipos_colaborador_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string | null
          id: string
          pagina: string
          pode_editar: boolean | null
          pode_ver: boolean | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          pagina: string
          pode_editar?: boolean | null
          pode_ver?: boolean | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          pagina?: string
          pode_editar?: boolean | null
          pode_ver?: boolean | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          email: string
          id: string
          nome: string
          role: string
          tenant_id: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          email: string
          id: string
          nome: string
          role?: string
          tenant_id?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          email?: string
          id?: string
          nome?: string
          role?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      variantes_tecido: {
        Row: {
          artigo_id: string | null
          codigo_variante: string | null
          cor_id: string | null
          created_at: string | null
          enderecos: Json
          foto_url: string | null
          id: string
          nome_variante: string | null
          prateleira: string | null
          rua: string | null
          tenant_id: string | null
        }
        Insert: {
          artigo_id?: string | null
          codigo_variante?: string | null
          cor_id?: string | null
          created_at?: string | null
          enderecos?: Json
          foto_url?: string | null
          id?: string
          nome_variante?: string | null
          prateleira?: string | null
          rua?: string | null
          tenant_id?: string | null
        }
        Update: {
          artigo_id?: string | null
          codigo_variante?: string | null
          cor_id?: string | null
          created_at?: string | null
          enderecos?: Json
          foto_url?: string | null
          id?: string
          nome_variante?: string | null
          prateleira?: string | null
          rua?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "variantes_tecido_artigo_id_fkey"
            columns: ["artigo_id"]
            isOneToOne: false
            referencedRelation: "artigos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variantes_tecido_cor_id_fkey"
            columns: ["cor_id"]
            isOneToOne: false
            referencedRelation: "cores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variantes_tecido_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      baixar_estoque_tecido_corte: { Args: { _cad_id: string }; Returns: Json }
      consumo_por_oc: { Args: never; Returns: Json }
      dashboard_colecao: {
        Args: {
          p_inicio?: string
          p_fim?: string
          p_colecao?: string
          p_estilista?: string
          p_linha?: string
        }
        Returns: Json
      }
      dashboard_custos: {
        Args: { p_inicio?: string; p_fim?: string; p_colecao?: string; p_categoria?: string; p_linha?: string }
        Returns: Json
      }
      dashboard_estoque: { Args: never; Returns: Json }
      dashboard_financeiro: {
        Args: { p_inicio?: string; p_fim?: string }
        Returns: Json
      }
      dashboard_producao: {
        Args: { p_inicio?: string; p_fim?: string; p_colecao?: string; p_linha?: string }
        Returns: Json
      }
      detalhe_estoque_variante: {
        Args: { _variante_id: string }
        Returns: Json
      }
      enviar_modelo_para_cad: {
        Args: {
          _ficha_medida_url?: string
          _modelo_id: string
          _observacoes_tecnicas?: string
        }
        Returns: string
      }
      estoque_tecido_por_artigo: { Args: never; Returns: Json }
      get_user_tenant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: never; Returns: boolean }
      ocs_disponiveis_variante: {
        Args: { _modelo_id?: string; _variante_id: string }
        Returns: Json
      }
      recalcular_parcelas: {
        Args: { _oc_id: string; _tipo: string }
        Returns: Json
      }
      saldo_oc_item_m: {
        Args: { _item_id: string }
        Returns: {
          saldo_m: number
        }[]
      }
      salvar_cad_completo: {
        Args: {
          _aviamentos: Json
          _data_previsao_corte: string
          _etiquetas: Json
          _grades: Json
          _modelo_id: string
          _observacoes_molde: string
          _proporcoes: Json
          _tecidos: Json
        }
        Returns: string
      }
      salvar_modelo_bom: {
        Args: {
          _aviamentos: Json
          _grades: Json
          _modelo_id: string
          _tecidos: Json
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user" | "super_admin" | "tenant_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "super_admin", "tenant_admin"],
    },
  },
} as const

