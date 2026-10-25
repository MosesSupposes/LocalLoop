import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AgeGate } from './components/AgeGate'
import { Shell } from './components/Shell'
import { useStore } from './lib/store'
import { Admin } from './pages/Admin'
import { Cart, Checkout } from './pages/Cart'
import { Driver } from './pages/Driver'
import { Home } from './pages/Home'
import { OrderPage, Orders } from './pages/Orders'
import { StaffLogin } from './pages/StaffLogin'

export default function App() {
  const ageOk = useStore((s) => s.ageOk)
  const sync = useStore((s) => s.sync)

  useEffect(() => {
    void sync()
    const t = setInterval(() => { if (!document.hidden) void sync() }, 5000)
    return () => clearInterval(t)
  }, [sync])

  if (!ageOk) return <AgeGate />
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="cart" element={<Cart />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="orders" element={<Orders />} />
          <Route path="order/:id" element={<OrderPage />} />
        </Route>
        <Route path="staff" element={<StaffLogin />} />
        <Route path="admin" element={<Admin />} />
        <Route path="driver" element={<Driver />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}
