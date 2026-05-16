import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import styles from './Sidebar.module.css'

const navItems = [
  { to: '/',         icon: 'ti-layout-dashboard', label: 'Overview',        end: true },
  { to: '/assets',   icon: 'ti-folder',            label: 'Asset Library' },
  { to: '/content',  icon: 'ti-photo',             label: 'Content Library' },
  { to: '/calendar', icon: 'ti-calendar',          label: 'Calendar' },
]

export default function Sidebar() {
  const { signOut, user } = useAuth()

  return (
    <aside className={styles.sidebar}>
      <div className={styles.section}>Menu</div>
      {navItems.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
        >
          <i className={`ti ${item.icon}`} aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}
      <div style={{ flex: 1 }} />
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
