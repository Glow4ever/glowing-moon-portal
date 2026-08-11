import { Routes, Route, Navigate } from 'react-router-dom'
import { useClient } from '../lib/ClientContext'
import Topbar from '../components/Topbar'
import Sidebar from '../components/Sidebar'
import Overview from './Overview'
import Assets from './Assets'
import Content from './Content'
import Calendar from './Calendar'
import Metrics from './Metrics'
import Admin from './Admin'
import Settings from './Settings.jsx'
import Messages from './Messages.jsx'
import styles from './Portal.module.css'

function AdminRoute({ children }) {
  const { role, loading } = useClient()
  if (loading) return null
  if (role !== 'admin') return <Navigate to="/" replace />
  return children
}

function MetricsRoute({ children }) {
  const { role, loading } = useClient()
  if (loading) return null
  if (!['admin', 'member', 'viewer'].includes(role)) return <Navigate to="/" replace />
  return children
}

export default function Portal() {
  const { loading, client } = useClient()
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#080807' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:'Cormorant Garamond, serif', fontSize:'22px', color:'#f0ede6', marginBottom:'8px' }}>Glowing Moon Media</div>
        <div style={{ fontSize:'12px', color:'#4a4740' }}>Loading your portal...</div>
      </div>
    </div>
  )
  return (
    <div className={styles.portal}>
      <Topbar />
      <div className={styles.layout}>
        <Sidebar />
        <main className={styles.main}>
          <Routes>
            <Route path="/"         element={<Overview />} />
            <Route path="/assets"   element={<Assets />} />
            <Route path="/content"  element={<Content />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/metrics"  element={<MetricsRoute><Metrics /></MetricsRoute>} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/admin"    element={<AdminRoute><Admin /></AdminRoute>} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
