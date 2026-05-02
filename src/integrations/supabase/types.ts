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
      alert_history: {
        Row: {
          alert_type: string
          date: string
          description: string
          id: string
          metadata: Json | null
          severity: string
          theme_name: string
          threshold: number | null
          ticker_symbol: string | null
          title: string
          triggered_at: string | null
          value_after: number | null
          value_before: number | null
        }
        Insert: {
          alert_type: string
          date: string
          description: string
          id?: string
          metadata?: Json | null
          severity: string
          theme_name: string
          threshold?: number | null
          ticker_symbol?: string | null
          title: string
          triggered_at?: string | null
          value_after?: number | null
          value_before?: number | null
        }
        Update: {
          alert_type?: string
          date?: string
          description?: string
          id?: string
          metadata?: Json | null
          severity?: string
          theme_name?: string
          threshold?: number | null
          ticker_symbol?: string | null
          title?: string
          triggered_at?: string | null
          value_after?: number | null
          value_before?: number | null
        }
        Relationships: []
      }
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
          dispersion_score: number | null
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
          dispersion_score?: number | null
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
          dispersion_score?: number | null
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
      fundamentals_cache: {
        Row: {
          ai_summary: string | null
          analyst_rating: string | null
          cash_per_share: number | null
          current_ratio: number | null
          debt_to_equity: number | null
          eps_growth_1y: number | null
          eps_growth_3y: number | null
          ev_ebitda: number | null
          forward_pe: number | null
          free_cash_flow: number | null
          fundamental_score: number | null
          gross_margin: number | null
          insider_sentiment_label: string | null
          insider_sentiment_score: number | null
          institutional_change: number | null
          institutional_ownership_pct: number | null
          last_updated: string | null
          market_cap: number | null
          net_margin: number | null
          pb_ratio: number | null
          pe_ratio: number | null
          peg_ratio: number | null
          ps_ratio: number | null
          recent_insider_buys: number | null
          recent_insider_sells: number | null
          revenue_growth_1y: number | null
          revenue_growth_3y: number | null
          roa: number | null
          roe: number | null
          sector: string | null
          smart_money_label: string | null
          smart_money_score: number | null
          stock_type: string | null
          symbol: string
          target_high: number | null
          target_low: number | null
          target_mean: number | null
          top_institutions: Json | null
          valuation_label: string | null
          valuation_score: number | null
        }
        Insert: {
          ai_summary?: string | null
          analyst_rating?: string | null
          cash_per_share?: number | null
          current_ratio?: number | null
          debt_to_equity?: number | null
          eps_growth_1y?: number | null
          eps_growth_3y?: number | null
          ev_ebitda?: number | null
          forward_pe?: number | null
          free_cash_flow?: number | null
          fundamental_score?: number | null
          gross_margin?: number | null
          insider_sentiment_label?: string | null
          insider_sentiment_score?: number | null
          institutional_change?: number | null
          institutional_ownership_pct?: number | null
          last_updated?: string | null
          market_cap?: number | null
          net_margin?: number | null
          pb_ratio?: number | null
          pe_ratio?: number | null
          peg_ratio?: number | null
          ps_ratio?: number | null
          recent_insider_buys?: number | null
          recent_insider_sells?: number | null
          revenue_growth_1y?: number | null
          revenue_growth_3y?: number | null
          roa?: number | null
          roe?: number | null
          sector?: string | null
          smart_money_label?: string | null
          smart_money_score?: number | null
          stock_type?: string | null
          symbol: string
          target_high?: number | null
          target_low?: number | null
          target_mean?: number | null
          top_institutions?: Json | null
          valuation_label?: string | null
          valuation_score?: number | null
        }
        Update: {
          ai_summary?: string | null
          analyst_rating?: string | null
          cash_per_share?: number | null
          current_ratio?: number | null
          debt_to_equity?: number | null
          eps_growth_1y?: number | null
          eps_growth_3y?: number | null
          ev_ebitda?: number | null
          forward_pe?: number | null
          free_cash_flow?: number | null
          fundamental_score?: number | null
          gross_margin?: number | null
          insider_sentiment_label?: string | null
          insider_sentiment_score?: number | null
          institutional_change?: number | null
          institutional_ownership_pct?: number | null
          last_updated?: string | null
          market_cap?: number | null
          net_margin?: number | null
          pb_ratio?: number | null
          pe_ratio?: number | null
          peg_ratio?: number | null
          ps_ratio?: number | null
          recent_insider_buys?: number | null
          recent_insider_sells?: number | null
          revenue_growth_1y?: number | null
          revenue_growth_3y?: number | null
          roa?: number | null
          roe?: number | null
          sector?: string | null
          smart_money_label?: string | null
          smart_money_score?: number | null
          stock_type?: string | null
          symbol?: string
          target_high?: number | null
          target_low?: number | null
          target_mean?: number | null
          top_institutions?: Json | null
          valuation_label?: string | null
          valuation_score?: number | null
        }
        Relationships: []
      }
      fundamentals_scan_progress: {
        Row: {
          failed: number
          id: number
          last_updated: string
          processed: number
          started_at: string | null
          status: string
          succeeded: number
          total_queued: number
        }
        Insert: {
          failed?: number
          id?: number
          last_updated?: string
          processed?: number
          started_at?: string | null
          status?: string
          succeeded?: number
          total_queued?: number
        }
        Update: {
          failed?: number
          id?: number
          last_updated?: string
          processed?: number
          started_at?: string | null
          status?: string
          succeeded?: number
          total_queued?: number
        }
        Relationships: []
      }
      fundamentals_scan_queue: {
        Row: {
          attempts: number
          enqueued_at: string
          last_error: string | null
          processed_at: string | null
          status: string
          symbol: string
        }
        Insert: {
          attempts?: number
          enqueued_at?: string
          last_error?: string | null
          processed_at?: string | null
          status?: string
          symbol: string
        }
        Update: {
          attempts?: number
          enqueued_at?: string
          last_error?: string | null
          processed_at?: string | null
          status?: string
          symbol?: string
        }
        Relationships: []
      }
      last_scan_cache: {
        Row: {
          id: number
          scanned_at: string
          symbols_fetched: number | null
          themes_data: Json
          timeframe: string
        }
        Insert: {
          id?: number
          scanned_at?: string
          symbols_fetched?: number | null
          themes_data?: Json
          timeframe?: string
        }
        Update: {
          id?: number
          scanned_at?: string
          symbols_fetched?: number | null
          themes_data?: Json
          timeframe?: string
        }
        Relationships: []
      }
      news_cache: {
        Row: {
          ai_summary: string | null
          ai_summary_generated_at: string | null
          ai_summary_theme: string | null
          category: string | null
          fetched_at: string | null
          headline: string
          id: string
          published_at: string | null
          source: string | null
          summary: string | null
          symbol: string | null
          url: string | null
        }
        Insert: {
          ai_summary?: string | null
          ai_summary_generated_at?: string | null
          ai_summary_theme?: string | null
          category?: string | null
          fetched_at?: string | null
          headline: string
          id?: string
          published_at?: string | null
          source?: string | null
          summary?: string | null
          symbol?: string | null
          url?: string | null
        }
        Update: {
          ai_summary?: string | null
          ai_summary_generated_at?: string | null
          ai_summary_theme?: string | null
          category?: string | null
          fetched_at?: string | null
          headline?: string
          id?: string
          published_at?: string | null
          source?: string | null
          summary?: string | null
          symbol?: string | null
          url?: string | null
        }
        Relationships: []
      }
      qualified_rs_universe: {
        Row: {
          adr_percent: number | null
          adr_source: string | null
          avg_dollar_volume: number | null
          company_name: string | null
          current_price: number | null
          market_cap: number | null
          qualified_at: string
          return_1d: number | null
          return_1m: number | null
          return_1w: number | null
          return_3m: number | null
          return_6m: number | null
          rs_1d: number | null
          rs_1m: number | null
          rs_1w: number | null
          rs_3m: number | null
          rs_6m: number | null
          rs_calculated_at: string | null
          rs_overall: number | null
          sector: string | null
          spy_return_1d: number | null
          spy_return_1m: number | null
          spy_return_1w: number | null
          spy_return_3m: number | null
          spy_return_6m: number | null
          symbol: string
        }
        Insert: {
          adr_percent?: number | null
          adr_source?: string | null
          avg_dollar_volume?: number | null
          company_name?: string | null
          current_price?: number | null
          market_cap?: number | null
          qualified_at?: string
          return_1d?: number | null
          return_1m?: number | null
          return_1w?: number | null
          return_3m?: number | null
          return_6m?: number | null
          rs_1d?: number | null
          rs_1m?: number | null
          rs_1w?: number | null
          rs_3m?: number | null
          rs_6m?: number | null
          rs_calculated_at?: string | null
          rs_overall?: number | null
          sector?: string | null
          spy_return_1d?: number | null
          spy_return_1m?: number | null
          spy_return_1w?: number | null
          spy_return_3m?: number | null
          spy_return_6m?: number | null
          symbol: string
        }
        Update: {
          adr_percent?: number | null
          adr_source?: string | null
          avg_dollar_volume?: number | null
          company_name?: string | null
          current_price?: number | null
          market_cap?: number | null
          qualified_at?: string
          return_1d?: number | null
          return_1m?: number | null
          return_1w?: number | null
          return_3m?: number | null
          return_6m?: number | null
          rs_1d?: number | null
          rs_1m?: number | null
          rs_1w?: number | null
          rs_3m?: number | null
          rs_6m?: number | null
          rs_calculated_at?: string | null
          rs_overall?: number | null
          sector?: string | null
          spy_return_1d?: number | null
          spy_return_1m?: number | null
          spy_return_1w?: number | null
          spy_return_3m?: number | null
          spy_return_6m?: number | null
          symbol?: string
        }
        Relationships: []
      }
      qualified_rs_universe_staging: {
        Row: {
          adr_percent: number | null
          adr_source: string | null
          avg_dollar_volume: number | null
          company_name: string | null
          current_price: number | null
          market_cap: number | null
          qualified_at: string
          return_1d: number | null
          return_1m: number | null
          return_1w: number | null
          return_3m: number | null
          return_6m: number | null
          rs_1d: number | null
          rs_1m: number | null
          rs_1w: number | null
          rs_3m: number | null
          rs_6m: number | null
          rs_calculated_at: string | null
          rs_overall: number | null
          sector: string | null
          spy_return_1d: number | null
          spy_return_1m: number | null
          spy_return_1w: number | null
          spy_return_3m: number | null
          spy_return_6m: number | null
          symbol: string
        }
        Insert: {
          adr_percent?: number | null
          adr_source?: string | null
          avg_dollar_volume?: number | null
          company_name?: string | null
          current_price?: number | null
          market_cap?: number | null
          qualified_at?: string
          return_1d?: number | null
          return_1m?: number | null
          return_1w?: number | null
          return_3m?: number | null
          return_6m?: number | null
          rs_1d?: number | null
          rs_1m?: number | null
          rs_1w?: number | null
          rs_3m?: number | null
          rs_6m?: number | null
          rs_calculated_at?: string | null
          rs_overall?: number | null
          sector?: string | null
          spy_return_1d?: number | null
          spy_return_1m?: number | null
          spy_return_1w?: number | null
          spy_return_3m?: number | null
          spy_return_6m?: number | null
          symbol: string
        }
        Update: {
          adr_percent?: number | null
          adr_source?: string | null
          avg_dollar_volume?: number | null
          company_name?: string | null
          current_price?: number | null
          market_cap?: number | null
          qualified_at?: string
          return_1d?: number | null
          return_1m?: number | null
          return_1w?: number | null
          return_3m?: number | null
          return_6m?: number | null
          rs_1d?: number | null
          rs_1m?: number | null
          rs_1w?: number | null
          rs_3m?: number | null
          rs_6m?: number | null
          rs_calculated_at?: string | null
          rs_overall?: number | null
          sector?: string | null
          spy_return_1d?: number | null
          spy_return_1m?: number | null
          spy_return_1w?: number | null
          spy_return_3m?: number | null
          spy_return_6m?: number | null
          symbol?: string
        }
        Relationships: []
      }
      rs_scan_progress: {
        Row: {
          failed: number
          id: number
          last_updated: string
          processed: number
          qualified: number
          started_at: string | null
          status: string
          total_queued: number
        }
        Insert: {
          failed?: number
          id?: number
          last_updated?: string
          processed?: number
          qualified?: number
          started_at?: string | null
          status?: string
          total_queued?: number
        }
        Update: {
          failed?: number
          id?: number
          last_updated?: string
          processed?: number
          qualified?: number
          started_at?: string | null
          status?: string
          total_queued?: number
        }
        Relationships: []
      }
      stock_fundamentals: {
        Row: {
          company_name: string | null
          current_ratio: number | null
          debt_to_equity: number | null
          eps_annual_yoy: number | null
          eps_quarterly_qoq: number | null
          eps_quarterly_yoy: number | null
          eps_ttm_yoy: number | null
          fetched_at: string
          forward_pe: number | null
          gross_margin: number | null
          market_cap: number | null
          net_margin: number | null
          operating_margin: number | null
          pb_ratio: number | null
          pe_ratio: number | null
          peg_ratio: number | null
          price: number | null
          ps_ratio: number | null
          raw_finnhub: Json | null
          raw_yahoo: Json | null
          revenue_annual_yoy: number | null
          revenue_quarterly_qoq: number | null
          revenue_quarterly_yoy: number | null
          revenue_ttm_yoy: number | null
          roa: number | null
          roe: number | null
          sector: string | null
          source_eps: string | null
          source_revenue: string | null
          source_valuation: string | null
          symbol: string
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          current_ratio?: number | null
          debt_to_equity?: number | null
          eps_annual_yoy?: number | null
          eps_quarterly_qoq?: number | null
          eps_quarterly_yoy?: number | null
          eps_ttm_yoy?: number | null
          fetched_at?: string
          forward_pe?: number | null
          gross_margin?: number | null
          market_cap?: number | null
          net_margin?: number | null
          operating_margin?: number | null
          pb_ratio?: number | null
          pe_ratio?: number | null
          peg_ratio?: number | null
          price?: number | null
          ps_ratio?: number | null
          raw_finnhub?: Json | null
          raw_yahoo?: Json | null
          revenue_annual_yoy?: number | null
          revenue_quarterly_qoq?: number | null
          revenue_quarterly_yoy?: number | null
          revenue_ttm_yoy?: number | null
          roa?: number | null
          roe?: number | null
          sector?: string | null
          source_eps?: string | null
          source_revenue?: string | null
          source_valuation?: string | null
          symbol: string
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          current_ratio?: number | null
          debt_to_equity?: number | null
          eps_annual_yoy?: number | null
          eps_quarterly_qoq?: number | null
          eps_quarterly_yoy?: number | null
          eps_ttm_yoy?: number | null
          fetched_at?: string
          forward_pe?: number | null
          gross_margin?: number | null
          market_cap?: number | null
          net_margin?: number | null
          operating_margin?: number | null
          pb_ratio?: number | null
          pe_ratio?: number | null
          peg_ratio?: number | null
          price?: number | null
          ps_ratio?: number | null
          raw_finnhub?: Json | null
          raw_yahoo?: Json | null
          revenue_annual_yoy?: number | null
          revenue_quarterly_qoq?: number | null
          revenue_quarterly_yoy?: number | null
          revenue_ttm_yoy?: number | null
          roa?: number | null
          roe?: number | null
          sector?: string | null
          source_eps?: string | null
          source_revenue?: string | null
          source_valuation?: string | null
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_scan_queue: {
        Row: {
          attempts: number
          enqueued_at: string
          last_error: string | null
          processed_at: string | null
          status: string
          symbol: string
        }
        Insert: {
          attempts?: number
          enqueued_at?: string
          last_error?: string | null
          processed_at?: string | null
          status?: string
          symbol: string
        }
        Update: {
          attempts?: number
          enqueued_at?: string
          last_error?: string | null
          processed_at?: string | null
          status?: string
          symbol?: string
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
      yahoo_history_cache: {
        Row: {
          data_points: number | null
          end_price: number | null
          fetched_at: string
          id: string
          ohlc: Json | null
          period: string
          return_pct: number | null
          start_price: number | null
          symbol: string
        }
        Insert: {
          data_points?: number | null
          end_price?: number | null
          fetched_at?: string
          id?: string
          ohlc?: Json | null
          period: string
          return_pct?: number | null
          start_price?: number | null
          symbol: string
        }
        Update: {
          data_points?: number | null
          end_price?: number | null
          fetched_at?: string
          id?: string
          ohlc?: Json | null
          period?: string
          return_pct?: number | null
          start_price?: number | null
          symbol?: string
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
      set_fundamentals_cron_active: {
        Args: { p_active: boolean }
        Returns: undefined
      }
      set_universe_cron_active: {
        Args: { p_active: boolean }
        Returns: undefined
      }
      swap_qualified_rs_universe: { Args: never; Returns: number }
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
