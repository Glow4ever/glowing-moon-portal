import { Routes, Route } from 'react-router-dom'
import Topbar from '../components/Topbar'
import Sidebar from '../components/Sidebar'
import Overview from './Overview'
import Assets from './Assets'
import Content from './Content'
import Calendar from './Calendar'
import styles from './Portal.module.css'

export default function Portal() {
  return (
    <div className={styles.portal}>
      <Topbar />
      <div className={styles.layout}>
        <Sidebar />
        <main className={styles.main}>
          <Routes>
            <Route path="/"         element={<Overview />} />
            <Route path="/assets"   element={<Assets />} />
            <Route path="/content"  element={<Content />} />
            <Route path="/calendar" element={<Calendar />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
