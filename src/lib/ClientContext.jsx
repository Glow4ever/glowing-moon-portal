import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

const ClientContext = createContext({})

export function ClientProvider({ children }) {
  const { user } = useAuth()
  const [role, setRole] = useState(null) // 'admin' or 'member'
  const [client, setClient] = useState(null) // current client object
  const [allClients, setAllClients] = useState([]) // admin only
  const [activeClientId, setActiveClientId] = useState(null) // admin viewing as client
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) loadUserContext()
    else { setRole(null); setClient(null); setLoading(false) }
  }, [user])

  async function loadUserContext() {
    setLoading(true)

    // Get user's role
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role, client_id, clients(*)')
      .eq('user_id', user.id)

    if (!roleData || roleData.length === 0) {
      setLoading(false)
      return
    }

    // Check if admin (has a role with null client_id)
    const adminRole = roleData.find(r => r.client_id === null && r.role === 'admin')

    if (adminRole) {
      setRole('admin')
      // Load all clients for admin
      const { data: clients } = await supabase
        .from('clients')
        .select('*')
        .eq('active', true)
        .order('name')
      setAllClients(clients || [])
      // Admin defaults to GMM client
      const gmm = clients?.find(c => c.slug === 'glowing-moon-media')
      setClient(gmm || clients?.[0] || null)
    } else {
      // Regular member — get their client
      setRole('member')
      const memberRole = roleData[0]
      setClient(memberRole.clients)
    }

    setLoading(false)
  }

  async function switchClient(clientId) {
    if (role !== 'admin') return
    const found = allClients.find(c => c.id === clientId)
    if (found) { setClient(found); setActiveClientId(clientId) }
  }

  async function updateClientBranding(clientId, updates) {
    const { data, error } = await supabase
      .from('clients')
      .update(updates)
      .eq('id', clientId)
      .select()
      .single()
    if (!error && data) {
      setClient(data)
      setAllClients(prev => prev.map(c => c.id === clientId ? data : c))
    }
    return { data, error }
  }

  return (
    <ClientContext.Provider value={{
      role, client, allClients, loading,
      switchClient, updateClientBranding, loadUserContext
    }}>
      {children}
    </ClientContext.Provider>
  )
}

export const useClient = () => useContext(ClientContext)
