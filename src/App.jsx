import ResetPassword from './pages/ResetPassword'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { ClientProvider, useClient } from './lib/ClientContext'
import { useEffect } from 'react'
import Login from './pages/Login'
import Portal from './pages/Portal'

function BrandingInjector() {
  const { client } = useClient()
  useEffect(() => {
    if (client?.primary_color) {
      document.documentElement.style.setProperty('--brand-primary', client.primary_color)
      document.documentElement.style.setProperty('--brand-primary-18', client.primary_color + '18')
      document.documentElement.style.setProperty('--brand-primary-40', client.primary_color + '40')
      document.documentElement.style.setProperty('--brand-primary-55', client.primary_color + '55')
    }
    if (client?.secondary_color) {
      document.documentElement.style.setProperty('--brand-secondary', client.secondary_color)
    }
  }, [client])
  return null
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#080807' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:'22px', color:'#f0ede6', marginBottom:'8px' }}>Glowing Moon Media</div>
        <div style={{ fontSize:'12px', color:'#4a4740' }}>Loading your portal...</div>
      </div>
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <ClientProvider>
        <BrandingInjector />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <Portal />
            </ProtectedRoute>
          } />
        </Routes>
      </ClientProvider>
    </AuthProvider>
  )
}
