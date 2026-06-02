import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import styles from './Login.module.css'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User is ready to reset
      }
    })
  }, [])

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError('Could not update password. Please try again.')
    } else {
      setDone(true)
      setTimeout(() => navigate('/'), 2000)
    }
    setLoading(false)
  }

  return (
    <div className={styles.page}>
      <div className={styles.glow} />
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <div className={styles.logoCircle}>
            <span className={styles.logoInitials}>GM</span>
          </div>
        </div>
        <h1 className={styles.title}>Glowing Moon Media</h1>
        <p className={styles.subtitle}>Reset Password</p>

        {done ? (
          <div className={styles.form}>
            <div className={styles.resetSuccess}>
              <i className="ti ti-circle-check" style={{ fontSize: '32px', color: 'var(--gold-light)', marginBottom: '12px' }} />
              <p>Password updated! Redirecting you to the portal...</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleReset} className={styles.form}>
            <p style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '16px' }}>
              Enter your new password below.
            </p>
            <div className={styles.field}>
              <label className={styles.label}>New Password</label>
              <input
                type="password"
                className={styles.input}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Confirm Password</label>
              <input
                type="password"
                className={styles.input}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <button type="submit" className={styles.btn} disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
