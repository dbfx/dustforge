import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useScheduledScan } from './hooks/useScheduledScan'
import { AppShell } from './components/layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { CleanerPage } from './pages/CleanerPage'
import { RegistryPage } from './pages/RegistryPage'
import { StartupPage } from './pages/StartupPage'
import { DebloaterPage } from './pages/DebloaterPage'
import { DiskAnalyzerPage } from './pages/DiskAnalyzerPage'
import { SettingsPage } from './pages/SettingsPage'
import { NetworkCleanupPage } from './pages/NetworkCleanupPage'
import { MalwareScannerPage } from './pages/MalwareScannerPage'
import { PrivacyShieldPage } from './pages/PrivacyShieldPage'
import { HistoryPage } from './pages/HistoryPage'
import { Onboarding } from './components/Onboarding'
import { useStatsStore } from './stores/stats-store'
import { useHistoryStore } from './stores/history-store'

export function App() {
  const loadHistory = useHistoryStore((s) => s.load)
  const historyLoaded = useHistoryStore((s) => s.loaded)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)

  useEffect(() => {
    window.dustforge?.onboardingGet?.().then((done) => {
      setShowOnboarding(!done)
      setOnboardingChecked(true)
    }).catch(() => setOnboardingChecked(true))
  }, [])

  const handleOnboardingComplete = () => {
    window.dustforge?.onboardingSet?.(true).catch(() => {})
    setShowOnboarding(false)
  }

  useEffect(() => {
    if (!historyLoaded) loadHistory()
  }, [historyLoaded, loadHistory])

  useEffect(() => {
    if (historyLoaded) recomputeStats()
  }, [historyLoaded, recomputeStats])

  useScheduledScan()

  if (!onboardingChecked) return null

  return (
    <HashRouter>
      {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/cleaner" element={<CleanerPage />} />
          <Route path="/registry" element={<RegistryPage />} />
          <Route path="/startup" element={<StartupPage />} />
          <Route path="/debloater" element={<DebloaterPage />} />
          <Route path="/disk" element={<DiskAnalyzerPage />} />
          <Route path="/network" element={<NetworkCleanupPage />} />
          <Route path="/malware" element={<MalwareScannerPage />} />
          <Route path="/privacy" element={<PrivacyShieldPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppShell>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#18181b',
            border: '1px solid #3f3f46',
            color: '#fafafa'
          }
        }}
      />
    </HashRouter>
  )
}
