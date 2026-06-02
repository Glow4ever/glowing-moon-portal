import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import styles from './Login.module.css'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('login') // 'login' or 'reset'
  const [resetSent, setResetSent] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) {
      setError('Invalid email or password.')
      setLoading(false)
    } else {
      navigate('/')
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })
    if (error) {
      setError('Could not send reset email. Please check your email address.')
    } else {
      setResetSent(true)
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
        <p className={styles.subtitle}>Client Portal</p>

        {mode === 'login' ? (
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>Email</label>
              <input
                type="email"
                className={styles.input}
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Password</label>
              <input
                type="password"
                className={styles.input}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <button type="submit" className={styles.btn} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
            <button
              type="button"
              className={styles.forgotBtn}
              onClick={() => { setMode('reset'); setError('') }}
            >
              Forgot password?
            </button>
          </form>
        ) : resetSent ? (
          <div className={styles.form}>
            <div className={styles.resetSuccess}>
              <i className="ti ti-mail-check" style={{ fontSize: '32px', color: 'var(--gold-light)', marginBottom: '12px' }} />
              <p>Password reset email sent! Check your inbox and follow the link to reset your password.</p>
            </div>
            <button
              type="button"
              className={styles.forgotBtn}
              onClick={() => { setMode('login'); setResetSent(false); setError('') }}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleReset} className={styles.form}>
            <p style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: '16px' }}>
              Enter your email and we'll send you a link to reset your password.
            </p>
            <div className={styles.field}>
              <label className={styles.label}>Email</label>
              <input
                type="email"
                className={styles.input}
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
              />
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <button type="submit" className={styles.btn} disabled={loading}>
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
            <button
              type="button"
              className={styles.forgotBtn}
              onClick={() => { setMode('login'); setError('') }}
            >
              Back to sign in
            </button>
          </form>
        )}

        <p className={styles.footer}>Access is by invitation only.<br />Contact your account manager for credentials.</p>
      </div>
    </div>
  )
}
