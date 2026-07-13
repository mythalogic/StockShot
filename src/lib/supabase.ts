import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing')

export type Role = 'member' | 'manager'
export type CaptureStatus = 'not_started' | 'partial' | 'done' | 'no_image'

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

/** Make a string safe for filenames: letters/numbers/dashes, trimmed. */
export function slugify(s: string, max = 40): string {
  const out = s
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return out || 'item'
}

/** Timestamp for filenames, local time: 2026-07-13_19-43 */
export function fileStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`
}

/** Filename base: SKU_ProductName_date-time */
export function photoFileBase(sku: string, name: string, when: Date = new Date()): string {
  return `${slugify(sku, 24)}_${slugify(name)}_${fileStamp(when)}`
}
