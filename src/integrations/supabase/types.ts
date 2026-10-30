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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      operator_invitations: {
        Row: {
          created_at: string | null
          email: string
          id: string
          queue_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          queue_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          queue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_invitations_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "queues"
            referencedColumns: ["id"]
          },
        ]
      }
      operators: {
        Row: {
          counter_name: string
          created_at: string | null
          email: string
          id: string
          queue_id: string | null
          role: string
        }
        Insert: {
          counter_name?: string
          created_at?: string | null
          email: string
          id: string
          queue_id?: string | null
          role?: string
        }
        Update: {
          counter_name?: string
          created_at?: string | null
          email?: string
          id?: string
          queue_id?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "operators_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "queues"
            referencedColumns: ["id"]
          },
        ]
      }
      queues: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          last_activity_at: string | null
          owner_id: string | null
          status: string
          title: string
          venue_name: string
          version: number
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_activity_at?: string | null
          owner_id?: string | null
          status?: string
          title: string
          venue_name: string
          version?: number
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_activity_at?: string | null
          owner_id?: string | null
          status?: string
          title?: string
          venue_name?: string
          version?: number
        }
        Relationships: []
      }
      tickets: {
        Row: {
          client_uuid: string
          created_at: string | null
          full_name: string
          id: string
          phone_number: string | null
          push_subscription: Json | null
          queue_id: string
          served_at: string | null
          serving_operator_id: string | null
          sort_order: number
          status: string
          strikes: number
          ticket_number: number
          updated_at: string | null
        }
        Insert: {
          client_uuid: string
          created_at?: string | null
          full_name: string
          id?: string
          phone_number?: string | null
          push_subscription?: Json | null
          queue_id: string
          served_at?: string | null
          serving_operator_id?: string | null
          sort_order: number
          status?: string
          strikes?: number
          ticket_number: number
          updated_at?: string | null
        }
        Update: {
          client_uuid?: string
          created_at?: string | null
          full_name?: string
          id?: string
          phone_number?: string | null
          push_subscription?: Json | null
          queue_id?: string
          served_at?: string | null
          serving_operator_id?: string | null
          sort_order?: number
          status?: string
          strikes?: number
          ticket_number?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "queues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_serving_operator_id_fkey"
            columns: ["serving_operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _lock_ticket: {
        Args: { p_ticket_id: string }
        Returns: {
          client_uuid: string
          created_at: string | null
          full_name: string
          id: string
          phone_number: string | null
          push_subscription: Json | null
          queue_id: string
          served_at: string | null
          serving_operator_id: string | null
          sort_order: number
          status: string
          strikes: number
          ticket_number: number
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _require_operator: { Args: { _queue: string }; Returns: undefined }
      _sort_behind_buffer: {
        Args: { _exclude: string; _queue: string }
        Returns: number
      }
      cancel_ticket: {
        Args: { p_client_uuid: string; p_ticket_id: string }
        Returns: undefined
      }
      clerk_call_next: { Args: { p_queue_id: string }; Returns: string }
      clerk_hold_ticket: { Args: { p_ticket_id: string }; Returns: string }
      clerk_mark_absent: { Args: { p_ticket_id: string }; Returns: string }
      clerk_mark_done: { Args: { p_ticket_id: string }; Returns: string }
      clerk_revoke_ticket: { Args: { p_ticket_id: string }; Returns: string }
      clerk_set_queue_status: {
        Args: { p_queue_id: string; p_status: string }
        Returns: undefined
      }
      get_ticket_status: {
        Args: { p_ticket_id: string }
        Returns: {
          counter_name: string
          full_name: string
          id: string
          queue_id: string
          queue_position: number
          queue_status: string
          status: string
          strikes: number
          ticket_number: number
          title: string
          venue_name: string
        }[]
      }
      is_queue_operator: { Args: { _queue: string }; Returns: boolean }
      join_queue: {
        Args: {
          p_client_uuid: string
          p_full_name: string
          p_phone_number: string
          p_push_subscription?: Json
          p_queue_id: string
        }
        Returns: string
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
