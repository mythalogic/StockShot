import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing')

export type Role = 'member' | 'manager'
export type CaptureStatus = 'not_started' | 'partial' | 'done'

export interface Product {
  id: string
  sku: string
  product_name: string
  supplier: string
}

export interface Capture {
  id: string
  product_id: string
  product_photo_url: string | null
  barcode_photo_url: string | null
  barcode_value: string | null
  captured_by: string | null
  captured_at: string
  status: CaptureStatus
}

export interface Profile {
  id: string
  email: string | null
  role: Role
}

export function statusOf(c: Capture | undefined): CaptureStatus {
  if (!c) return 'not_started'
  return c.status
}
