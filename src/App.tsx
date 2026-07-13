import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import { BottomNav, ToastProvider } from './components/ui'
import SignIn from './pages/SignIn'
import Products from './pages/Products'
import CaptureScreen from './pages/Capture'
import Progress from './pages/Progress'
import SupplierDetail from './pages/SupplierDetail'
import ExportPage from './pages/Export'
import AdminImport from './pages/AdminImport'

function Shell() {
  const { session, loading, isManager } = useAuth()
  const location = useLocation()
  // Hide the bottom nav on the capture screen so the Save bar
  // is always fully visible and easy to press.
  const hideNav = location.pathname.startsWith('/capture/')

  if (loading) {
    return (
      <div className="min-h-dvh bg-paper flex items-center justify-center">
        <p className="font-mono text-sm text-ink/50">Loading…</p>
      </div>
    )
  }

  if (!session) return <SignIn />

  return (
    <DataProvider>
      <Routes>
        <Route path="/" element={<Products />} />
        <Route path="/capture/:productId" element={<CaptureScreen />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/progress/:supplier" element={<SupplierDetail />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/admin" element={isManager ? <AdminImport /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!hideNav && <BottomNav isManager={isManager} />}
    </DataProvider>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ToastProvider>
  )
}
