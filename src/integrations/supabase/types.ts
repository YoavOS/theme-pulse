export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      eod_prices: {
        Row: {
          close_price: number
          created_at: string | null
          date: string
          high_price: number | null
          id: string
          is_backfill: boolean | null
          low_price: number | null
          open_price: number | null
          source: string | null
          symbol: string
          theme_name: string
          volume: number | null
        }
        Insert: {
          close_price: number
          created_at?: string | null
          date: string
          high_price?: number | null
          id?: string
          is_backfill?: boolean | null
          low_price?: number | null
          open_price?: number | null
          source?: string | null
          symbol: string
          theme_name: string
          volume?: number | null
        }
        Update: {
          close_price?: number
          created_at?: string | null
          date?: string
          high_price?: number | null
          id?: string
          is_backfill?: boolean | null
          low_price?: number | null
          open_price?: number | null
          source?: string | null
          symbol?: string
          theme_name?: string
          volume?: number | null
        }
        Relationships: []
      }
      eod_save_sessions: {
        Row: {
          completed_at: string | null
          date: string
          failed_count: number | null
          failed_symbols: string[] | null
          id: string
          saved_count: number | null
          started_at: string | null
          status: string | null
          total_tickers: number | null
        }
        Insert: {
          completed_at?: string | null
          date: string
          failed_count?: number | null
          failed_symbols?: string[] | null
          id?: string
          saved_count?: number | null
          started_at?: string | null
          status?: string | null
          total_tickers?: number | null
        }
        Update: {
          completed_at?: string | null
          date?: string
          failed_count?: number | null
          failed_symbols?: string[] | null
          id?: string
          saved_count?: number | null
          started_at?: string | null
          status?: string | null
          total_tickers?: number | null
        }
        Relationships: []
      }
      full_update_progress: {
        Row: {
          id: string
          last_theme_index: number
          last_updated: string
          status: string
          total_themes: number
        }
        Insert: {
          id?: string
          last_theme_index?: number
          last_updated?: string
          status?: string
          total_themes?: number
        }
        Update: {
          id?: string
          last_theme_index?: number
          last_updated?: string
          status?: string
          total_themes?: number
        }
        Relationships: []
      }
      theme_breadth_history: {
        Row: {
          advancing: number | null
          breadth_pct: number | null
          date: string
          declining: number | null
          id: string
          theme_name: string
          total: number | null
        }
        Insert: {
          advancing?: number | null
          breadth_pct?: number | null
          date: string
          declining?: number | null
          id?: string
          theme_name: string
          total?: number | null
        }
        Update: {
          advancing?: number | null
          breadth_pct?: number | null
          date?: string
          declining?: number | null
          id?: string
          theme_name?: string
          total?: number | null
        }
        Relationships: []
      }
      theme_tickers: {
        Row: {
          added_at: string
          id: string
          theme_id: string
          ticker_symbol: string
        }
        Insert: {
          added_at?: string
          id?: string
          theme_id: string
          ticker_symbol: string
        }
        Update: {
          added_at?: string
          id?: string
          theme_id?: string
          ticker_symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_tickers_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      themes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      ticker_performance: {
        Row: {
          last_scanned: string | null
          perf_1d: number | null
          perf_1m: number | null
          perf_1w: number | null
          perf_3m: number | null
          perf_ytd: number | null
          price: number | null
          status: string
          symbol: string
        }
        Insert: {
          last_scanned?: string | null
          perf_1d?: number | null
          perf_1m?: number | null
          perf_1w?: number | null
          perf_3m?: number | null
          perf_ytd?: number | null
          price?: number | null
          status?: string
          symbol: string
        }
        Update: {
          last_scanned?: string | null
          perf_1d?: number | null
          perf_1m?: number | null
          perf_1w?: number | null
          perf_3m?: number | null
          perf_ytd?: number | null
          price?: number | null
          status?: string
          symbol?: string
        }
        Relationships: []
      }
      ticker_volume_cache: {
        Row: {
          avg_10d: number | null
          avg_20d: number | null
          avg_3m: number | null
          last_updated: string | null
          symbol: string
          today_vol: number | null
        }
        Insert: {
          avg_10d?: number | null
          avg_20d?: number | null
          avg_3m?: number | null
          last_updated?: string | null
          symbol: string
          today_vol?: number | null
        }
        Update: {
          avg_10d?: number | null
          avg_20d?: number | null
          avg_3m?: number | null
          last_updated?: string | null
          symbol?: string
          today_vol?: number | null
        }
        Relationships: []
      }
      volume_history: {
        Row: {
          avg_rel_vol: number | null
          id: string
          sustained_vol_pct: number | null
          theme_name: string
          week_ending: string
        }
        Insert: {
          avg_rel_vol?: number | null
          id?: string
          sustained_vol_pct?: number | null
          theme_name: string
          week_ending: string
        }
        Update: {
          avg_rel_vol?: number | null
          id?: string
          sustained_vol_pct?: number | null
          theme_name?: string
          week_ending?: string
        }
        Relationships: []
      }
      weekly_reports: {
        Row: {
          biggest_reversals: Json | null
          bottom_themes: Json | null
          generated_at: string | null
          id: string
          narrative: string
          top_themes: Json | null
          volume_anomalies: Json | null
          week_ending: string
        }
        Insert: {
          biggest_reversals?: Json | null
          bottom_themes?: Json | null
          generated_at?: string | null
          id?: string
          narrative: string
          top_themes?: Json | null
          volume_anomalies?: Json | null
          week_ending: string
        }
        Update: {
          biggest_reversals?: Json | null
          bottom_themes?: Json | null
          generated_at?: string | null
          id?: string
          narrative?: string
          top_themes?: Json | null
          volume_anomalies?: Json | null
          week_ending?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_eod_baselines: {
        Args: {
          p_date_1m: string
          p_date_1w: string
          p_date_3m: string
          p_date_ytd: string
          p_symbols: string[]
        }
        Returns: {
          baseline_date: string
          close_price: number
          symbol: string
          timeframe: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
