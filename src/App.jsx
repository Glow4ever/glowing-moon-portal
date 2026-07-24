import ResetPassword from './pages/ResetPassword.jsx'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { ClientProvider, useClient } from './lib/ClientContext'
import { useEffect } from 'react'
import Login from './pages/Login'
import Portal from './pages/Portal'
import { useIdleTimer } from './lib/useIdleTimer.jsx'

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
      document.documentElement.style.setProperty('--brand-secondary-18', client.secondary_color + '18')
      document.documentElement.style.setProperty('--brand-secondary-40', client.secondary_color + '40')
    }
  }, [client])
  return null
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const { showWarning, stayActive } = useIdleTimer()
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#080807' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:'22px', color:'#f0ede6', marginBottom:'8px' }}>Glowing Moon Media</div>
        <div style={{ fontSize:'12px', color:'#4a4740' }}>Loading your portal...</div>
      </div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return (
    <>
      {children}
      {showWarning && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: '#151517', border: '1px solid #2B2B2E', borderRadius: '12px',
            padding: '28px 32px', maxWidth: '360px', width: '90%', textAlign: 'center'
          }}>
            <i className="ti ti-clock-pause" style={{ fontSize: '28px', color: 'var(--gold-light, #D3C9A7)', marginBottom: '12px', display: 'block' }} />
            <div style={{ fontSize: '15px', color: '#F4EEE2', fontWeight: '600', marginBottom: '8px' }}>Still there?</div>
            <div style={{ fontSize: '13px', color: '#8a8880', marginBottom: '20px', lineHeight: '1.5' }}>
              You'll be signed out in 5 minutes due to inactivity.
            </div>
            <button
              onClick={stayActive}
              style={{
                background: 'var(--gold-light, #D3C9A7)', color: '#0E0E0F', border: 'none',
                borderRadius: '7px', padding: '10px 24px', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
              }}
            >
              Stay signed in
            </button>
          </div>
        </div>
      )}
    </>
  )
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

