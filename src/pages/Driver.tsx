import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Empty, Pill, btnGhost, btnPrimary, card } from '../components/ui'
import { STORE, telHref } from '../lib/config'
import { hasRestricted, money } from '../lib/orders'
import { useStore } from '../lib/store'
import { OrderCard } from './Admin'

export function Driver() {
  const { me, meLoaded, staffData, logout, act } = useStore()
  const [err, setErr] = useState('')

  if (!meLoaded) return null
  if (!me || me.role !== 'employee') return <Navigate to="/staff" />
  const mine = staffData?.orders ?? []
  const onShift = staffData?.staff.find((s) => s.id === me.id)?.onShift ?? me.onShift
  const batches = [...new Set(mine.map((o) => o.batchId ?? 'manual'))]
  const run = async (path: string, body?: unknown) => setErr((await act(path, body)) ?? '')

  return (
    <div className="mx-auto min-h-dvh max-w-xl px-4 pb-10">
      <header className="safe-top flex items-center justify-between py-3">
        <h1 className="font-display text-xl font-extrabold sm:text-2xl">{STORE.name} <span className="text-sky">Driver</span></h1>
        <button className={`${btnGhost} !px-4 text-sm`} onClick={logout}>Sign out</button>
      </header>
      <div className={`${card} mb-4 flex items-center justify-between`}>
        <div><p className="font-semibold">{me.name}</p><p className="text-sm text-muted">{mine.length} active stops</p></div>
        <button className={onShift ? btnPrimary : btnGhost} aria-pressed={onShift} onClick={() => run(`/staff/${me.id}/shift`)}>{onShift ? 'On shift' : 'Off shift'}</button>
      </div>
      {err && <p role="alert" className="mb-2 text-destructive">{err}</p>}
      {mine.length === 0 ? <Empty emoji="🛵" title="No stops assigned">Dispatch will batch orders to you.</Empty> : batches.map((b) => (
        <section key={b} className="mb-5 space-y-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">Batch <Pill tone="sky">{b}</Pill></h2>
          <ul className="space-y-3">
            {mine.filter((o) => (o.batchId ?? 'manual') === b).map((o) => (
              <OrderCard key={o.id} o={o}>
                {hasRestricted(o.items) && o.status === 'out_for_delivery' && (
                  <label className="flex items-center gap-3 rounded-2xl bg-sunset/10 p-3 text-sm">
                    <input type="checkbox" className="!h-6 !w-6 !min-h-0" checked={!!o.idChecked} onChange={(e) => run(`/orders/${o.id}/idcheck`, { checked: e.target.checked })} />
                    I checked a valid 21+ ID and the registry card {o.medCard}.
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  {o.status === 'ready' && <button className={btnPrimary} onClick={() => run(`/orders/${o.id}/status`, { to: 'out_for_delivery' })}>Start delivery</button>}
                  {o.status === 'out_for_delivery' && (
                    <>
                      {o.payment === 'cash' && o.paymentStatus === 'unpaid' && <button className={btnGhost} onClick={() => run(`/orders/${o.id}/paid`)}>Cash collected {money(o.totalCents)}</button>}
                      <button className={btnPrimary} onClick={() => run(`/orders/${o.id}/status`, { to: 'delivered' })}>Delivered</button>
                    </>
                  )}
                  <a className={btnGhost} href={telHref(o.phone)}>Call customer</a>
                </div>
                {o.status === 'accepted' && <p className="text-xs text-muted">Waiting for the shop to pack this order.</p>}
              </OrderCard>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
