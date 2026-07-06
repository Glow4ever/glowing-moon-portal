import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

const IDLE_TIMEOUT = 4 * 60 * 60 * 1000 // 4 hours

export function useIdleTimer() {
  const timer = useRef(null)

  const reset = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      await supabase.auth.signOut()
      window.location.href = '/login'
    }, IDLE_TIMEOUT)
  }

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(timer.current)
      events.forEach(e => window.removeEventListener(e, reset))
    }
  }, [])
}
