import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useClient } from '../lib/ClientContext'
import styles from './Admin.module.css'
export default function Settings() {
  const { user } = useAuth()
  const { client, updateClientBranding } = useClient()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [coverSaving, setCoverSaving] = useState(false)
  const [coverPreview, setCoverPreview] = useState(null)

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function handleCoverUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setCoverSaving(true)
    const ext = file.name.split('.').pop()
    const path = `covers/${client.slug}-cover.${ext}`
    const { error } = await supabase.storage
      .from('portal-assets')
      .upload(path, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from('portal-assets').getPublicUrl(path)
      await updateClientBranding(client.id, { cover_url: data.publicUrl })
      setCoverPreview(data.publicUrl)
      showToast('Cover photo updated!')
    }
    setCoverSaving(false)
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setError('Could not update password. Please try again.')
    } else {
      showToast('Password updated successfully!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
    setSaving(false)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Account Settings</h1>
        <p className={styles.sub}>Manage your account preferences</p>
      </div>

      <div className={styles.formCard}>
        <div className={styles.formTitle}>Account Info</div>
        <div className={styles.field}>
          <label className={styles.label}>Email</label>
          <div className={styles.input} style={{ color: 'var(--text2)', cursor: 'default' }}>
            {user?.email}
          </div>
        </div>
      </div>

      <div className={styles.formCard}>
        <div className={styles.formTitle}>Change Password</div>
        <form onSubmit={handlePasswordChange}>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.label}>New Password</label>
              <input
                type="password"
                className={styles.input}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Confirm New Password</label>
              <input
                type="password"
                className={styles.input}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          </div>
          {error && <div style={{ color: '#e0845a', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}
          <div className={styles.formActions}>
            <button type="submit" className="btn btn-gold" disabled={saving}>
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>

      <div className={styles.formCard}>
        <div className={styles.formTitle}>Cover Photo</div>
        <p style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '16px' }}>
          This photo appears as a banner on your portal overview. Use a wide landscape image for best results.
        </p>
        <div className={styles.field}>
          {coverPreview && (
            <img src={coverPreview} alt="cover preview" style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border2)', marginBottom: '12px' }} />
          )}
          <input
            type="file"
            accept="image/*"
            style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '12px' }}
            onChange={handleCoverUpload}
          />
          <div className={styles.field}>
            <label className={styles.label}>Photo Position</label>
            <select
              className={styles.input}
              value={client?.cover_position || 'center'}
              onChange={async e => {
                await updateClientBranding(client.id, { cover_position: e.target.value })
                showToast('Position updated!')
              }}
            >
              <option value="top">Top</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
          {coverSaving && <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '8px' }}>Uploading...</div>}
        </div>
      </div>
      
      {toast && (
        <div className={styles.toast}>
          <i className="ti ti-check" aria-hidden="true" /> {toast}
        </div>
      )}
    </div>
  )
}
