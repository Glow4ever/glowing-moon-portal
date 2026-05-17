import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { ClientProvider } from './lib/ClientContext'
import Login from './pages/Login'
import Portal from './pages/Portal'

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
        <Routes>
          <Route path="/login" element={<Login />} />
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
