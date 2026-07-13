import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import { BottomNav, ToastProvider } from './components/ui'
import SignIn from './pages/SignIn'
import Products from './pages/Products'
import CaptureScreen from './pages/Capture'
import Progress from './pages/Progress'
import ExportPage from './pages/Export'
import AdminImport from './pages/AdminImport'

function Shell() {
  const { session, loading, isManager } = useAuth()

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
        <Route path="/export" element={<ExportPage />} />
        <Route path="/admin" element={isManager ? <AdminImport /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav isManager={isManager} />
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
