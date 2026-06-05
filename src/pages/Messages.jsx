import { useState, useEffect, useRef } from 'react'
import { useClient } from '../lib/ClientContext'
import { supabase } from '../lib/supabase'
import styles from './Admin.module.css'

export default function Messages() {
  const { client, role, allClients } = useClient()
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState(null)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef()

  const activeClientId = role === 'admin' ? selectedClientId : client?.id

  useEffect(() => {
    if (role === 'admin' && allClients.length > 0 && !selectedClientId) {
      setSelectedClientId(allClients[0].id)
    }
  }, [role, allClients])

  useEffect(() => {
    if (activeClientId) loadMessages()
  }, [activeClientId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadMessages() {
    setLoading(true)
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('client_id', activeClientId)
      .order('created_at', { ascending: true })
    setMessages(data || [])
    setLoading(false)

    if (role === 'member') {
      await supabase.from('messages')
        .update({ read: true })
        .eq('client_id', activeClientId)
        .eq('sender_role', 'admin')
    } else {
      await supabase.from('messages')
        .update({ read: true })
        .eq('client_id', activeClientId)
        .eq('sender_role', 'member')
    }
  }

  async function sendMessage() {
    if (!newMessage.trim() || !activeClientId) return
    setSending(true)
    await supabase.from('messages').insert({
      client_id: activeClientId,
      sender_role: role === 'admin' ? 'admin' : 'member',
      content: newMessage.trim(),
      read: false
    })
    setNewMessage('')
    await loadMessages()
    setSending(false)
  }

  function timeAgo(str) {
    const diff = Date.now() - new Date(str).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  const activeClient = role === 'admin'
    ? allClients.find(c => c.id === selectedClientId)
    : client

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Messages</h1>
        <p className={styles.sub}>
          {role === 'admin' ? 'Direct line to your clients' : 'Direct line to the Glowing Moon Media team'}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: role === 'admin' ? '220px 1fr' : '1fr', gap: '16px', height: 'calc(100vh - 200px)' }}>

        {role === 'admin' && (
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: '10px', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text3)' }}>
              Clients
            </div>
            {allClients.filter(c => c.slug !== 'glowing-moon-media').map(c => (
              <div
                key={c.id}
                onClick={() => setSelectedClientId(c.id)}
                style={{
                  padding: '12px 16px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  background: selectedClientId === c.id ? c.primary_color + '18' : 'transparent',
                  borderLeft: selectedClientId === c.id ? `2px solid ${c.primary_color}` : '2px solid transparent',
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: c.primary_color, flexShrink: 0 }} />
                  <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text)' }}>{c.name}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {activeClient && (
              <>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: (activeClient.primary_color || '#c9a84c') + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '600', color: activeClient.primary_color || '#c9a84c' }}>
                  {activeClient.name?.split(' ').map(w => w[0]).join('').slice(0,2)}
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text)' }}>{activeClient.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text3)' }}>
                    {role === 'admin' ? 'Client thread' : 'Glowing Moon Media'}
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {loading && <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '13px', padding: '24px' }}>Loading...</div>}
            {!loading && messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '13px', padding: '24px' }}>
                No messages yet. Say hello!
              </div>
            )}
            {messages.map((m, i) => {
              const isMe = (role === 'admin' && m.sender_role === 'admin') || (role === 'member' && m.sender_role === 'member')
              return (
                <div key={i} style={{ display: 'flex', gap: '10px', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                  {!isMe && (
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--gold-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '600', color: 'var(--gold-light)', flexShrink: 0 }}>
                      {m.sender_role === 'admin' ? 'GM' : activeClient?.name?.split(' ').map(w => w[0]).join('').slice(0,2)}
                    </div>
                  )}
                  <div style={{ maxWidth: '70%' }}>
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: isMe ? 'var(--radius) 0 var(--radius) var(--radius)' : '0 var(--radius) var(--radius) var(--radius)',
                      background: isMe ? 'var(--gold-bg)' : 'var(--surface3)',
                      border: `1px solid ${isMe ? 'var(--gold-border)' : 'var(--border)'}`,
                      fontSize: '13px',
                      color: 'var(--text)',
                      lineHeight: '1.5'
                    }}>
                      {m.content}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '4px', textAlign: isMe ? 'right' : 'left', paddingInline: '4px' }}>
                      {timeAgo(m.created_at)}
                    </div>
                  </div>
                  {isMe && (
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: (activeClient?.primary_color || '#c9a84c') + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '600', color: activeClient?.primary_color || '#c9a84c', flexShrink: 0 }}>
                      {isMe && role === 'admin' ? 'GM' : activeClient?.name?.split(' ').map(w => w[0]).join('').slice(0,2)}
                    </div>
                  )}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              className={styles.input}
              style={{ flex: 1 }}
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Type a message..."
              disabled={sending}
            />
            <button
              className="btn btn-gold"
              onClick={sendMessage}
              disabled={sending || !newMessage.trim()}
            >
              <i className="ti ti-send" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
