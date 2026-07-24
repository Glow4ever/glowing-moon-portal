import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from './supabase'

const IDLE_TIMEOUT = 4 * 60 * 60 * 1000 // 4 hours
const WARNING_BEFORE = 5 * 60 * 1000 // warn 5 minutes before logout

export function useIdleTimer() {
  const logoutTimer = useRef(null)
  const warningTimer = useRef(null)
  const [showWarning, setShowWarning] = useState(false)

  const reset = useCallback(() => {
    clearTimeout(logoutTimer.current)
    clearTimeout(warningTimer.current)
    setShowWarning(false)
    warningTimer.current = setTimeout(() => {
      setShowWarning(true)
    }, IDLE_TIMEOUT - WARNING_BEFORE)
    logoutTimer.current = setTimeout(async () => {
      await supabase.auth.signOut()
      window.location.href = '/login'
    }, IDLE_TIMEOUT)
  }, [])

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(logoutTimer.current)
      clearTimeout(warningTimer.current)
      events.forEach(e => window.removeEventListener(e, reset))
    }
  }, [reset])

  return { showWarning, stayActive: reset }
}

