import { createContext, useContext, useEffect, useState, useCallback, ReactNode, useMemo } from 'react'
import { supabase, Product, Capture } from '../lib/supabase'
import { useAuth } from './AuthContext'

interface DataState {
  products: Product[]
  captures: Map<string, Capture> // keyed by product_id
  loadingData: boolean
  refresh: () => Promise<void>
  exportManagersOnly: boolean
  setExportManagersOnly: (v: boolean) => Promise<void>
}

const DataContext = createContext<DataState>(null as unknown as DataState)

export function DataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [captures, setCaptures] = useState<Map<string, Capture>>(new Map())
  const [loadingData, setLoadingData] = useState(true)
  const [exportManagersOnly, setExportOnly] = useState(false)

  const refresh = useCallback(async () => {
    if (!session) return
    const [p, c, s] = await Promise.all([
      supabase.from('products').select('*').order('supplier').order('product_name'),
      supabase.from('captures').select('*'),
      supabase.from('app_settings').select('*').eq('key', 'export_managers_only').maybeSingle()
    ])
    if (p.data) setProducts(p.data as Product[])
    if (c.data) {
      const m = new Map<string, Capture>()
      for (const row of c.data as Capture[]) m.set(row.product_id, row)
      setCaptures(m)
    }
    if (s.data) setExportOnly(Boolean(s.data.value === true || s.data.value === 'true'))
    setLoadingData(false)
  }, [session])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Live progress: any user's save updates every device automatically.
  useEffect(() => {
    if (!session) return
    const channel = supabase
      .channel('captures-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'captures' },
        (payload) => {
          const row = payload.new as Capture
          if (!row?.product_id) return
          setCaptures((prev) => {
            const next = new Map(prev)
            next.set(row.product_id, row)
            return next
          })
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [session])

  const setExportManagersOnly = useCallback(async (v: boolean) => {
    setExportOnly(v)
    await supabase.from('app_settings').update({ value: v }).eq('key', 'export_managers_only')
  }, [])

  const value = useMemo(
    () => ({ products, captures, loadingData, refresh, exportManagersOnly, setExportManagersOnly }),
    [products, captures, loadingData, refresh, exportManagersOnly, setExportManagersOnly]
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export const useData = () => useContext(DataContext)
