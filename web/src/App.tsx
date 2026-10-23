import { Link, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { EmptyState } from './components/ui'
import { useI18n } from './lib/i18n'
import { AdminPage } from './routes/AdminPage'
import { CheckoutPage } from './routes/CheckoutPage'
import { ExplorePage } from './routes/ExplorePage'
import { HomePage } from './routes/HomePage'
import { MerchantDashboardPage } from './routes/MerchantDashboardPage'
import { OnboardingPage } from './routes/OnboardingPage'
import { OrderDetailPage } from './routes/OrderDetailPage'
import { OrdersPage } from './routes/OrdersPage'
import { ProfilePage } from './routes/ProfilePage'
import { StorefrontPage } from './routes/StorefrontPage'

export function App() {
  const { t } = useI18n()

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/m/:slug" element={<StorefrontPage />} />
        <Route path="/checkout/:merchantId" element={<CheckoutPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/merchant" element={<MerchantDashboardPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route
          path="*"
          element={
            <EmptyState
              glyph="🧭"
              title={t('common.notFound')}
              action={
                <Link to="/" className="mt-2 text-sm font-semibold text-primary">
                  LocalLoop
                </Link>
              }
            />
          }
        />
      </Routes>
    </AppShell>
  )
}
