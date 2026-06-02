import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useClient } from '../lib/ClientContext'
import styles from './Sidebar.module.css'

const navItems = [
  { to: '/',         icon: 'ti-layout-dashboard', label: 'Overview',        end: true },
  { to: '/assets',   icon: 'ti-folder',            label: 'Asset Library' },
  { to: '/content',  icon: 'ti-photo',             label: 'Content Library' },
  { to: '/calendar', icon: 'ti-calendar',          label: 'Calendar' },
  { to: '/settings', icon: 'ti-settings',          label: 'Settings' },
]

export default function Sidebar() {
  const { signOut, user } = useAuth()
  const { role, client } = useClient()
  const navigate = useNavigate()
  const primaryColor = client?.primary_color || '#c9a84c'

  return (
    <aside className={styles.sidebar}>
      <div className={styles.section}>Menu</div>
      {navItems.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
          style={({ isActive }) => isActive ? {
            background: primaryColor + '18',
            color: primaryColor,
            borderColor: primaryColor + '40'
          } : {}}
        >
          <i className={`ti ${item.icon}`} aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}

      {role === 'admin' && (
        <>
          <div className={styles.section} style={{ marginTop: '12px' }}>Admin</div>
          <NavLink
            to="/admin"
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
            style={({ isActive }) => isActive ? {
              background: primaryColor + '18',
              color: primaryColor,
              borderColor: primaryColor + '40'
            } : {}}
          >
            <i className="ti ti-settings" aria-hidden="true" />
            Admin Panel
          </NavLink>
        </>
      )}

      <div style={{ flex: 1 }} />

      <div className={styles.poweredBy}>
        Powered by <strong>Glowing Moon Media</strong>
      </div>

      <div className={styles.userBlock}>
        <div className={styles.userEmail}>{user?.email}</div>
        <button className={styles.signOut} onClick={signOut}>
          <i className="ti ti-logout" aria-hidden="true" /> Sign out
        </button>
      </div>

      <div className={styles.supportCard}>
        <div className={styles.supportTitle}>Support</div>
        Reach your account manager anytime.
      </div>
    </aside>
  )
}
