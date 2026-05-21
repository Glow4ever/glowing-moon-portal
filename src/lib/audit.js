import { supabase } from './supabase'

export async function logAction(action, resource = null, details = null) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return

    await supabase.from('audit_logs').insert({
      user_id: session.user.id,
      user_email: session.user.email,
      action,
      resource,
      details
    })
  } catch (err) {
    console.error('Audit log error:', err)
  }
}
