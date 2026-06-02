import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import styles from './Admin.module.css'

export default function Settings() {
  const { user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
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

      {toast && (
        <div className={styles.toast}>
          <i className="ti ti-check" aria-hidden="true" /> {toast}
        </div>
      )}
    </div>
  )
}
