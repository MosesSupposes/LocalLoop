import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Field, btnGhost, btnPrimary, card } from '../components/ui'
import { STORE } from '../lib/config'
import { useStore } from '../lib/store'

export function StaffLogin() {
  const nav = useNavigate()
  const { me, meLoaded, requestCode, verifyCode } = useStore()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (me) return <Navigate to={me.role === 'admin' ? '/admin' : '/driver'} />
  if (!meLoaded) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    if (!sent) {
      const r = await requestCode(phone)
      if (r.ok) setSent(true)
      else setErr(r.error)
    } else {
      const r = await verifyCode(phone, code)
      if (r.ok) nav(r.me.role === 'admin' ? '/admin' : '/driver')
      else setErr(r.error)
    }
    setBusy(false)
  }

  return (
    <div className="bg-hero flex min-h-dvh items-center justify-center p-6">
      <form className={`${card} w-full max-w-sm space-y-4`} onSubmit={submit}>
        <h1 className="font-display text-3xl font-extrabold">{STORE.name} staff</h1>
        <Field label="Mobile number"><input type="tel" required autoFocus disabled={sent} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="302-555-0123" autoComplete="tel" /></Field>
        {sent && (
          <Field label="6-digit code from your text">
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        {err && <p role="alert" className="text-destructive">{err}</p>}
        <button className={`${btnPrimary} w-full`} disabled={busy}>{sent ? 'Verify' : 'Text me a code'}</button>
        {sent && <button type="button" className={`${btnGhost} w-full`} onClick={() => { setSent(false); setCode('') }}>Use a different number</button>}
        <Link to="/" className="inline-flex items-center text-sm text-muted underline">Back to store</Link>
      </form>
    </div>
  )
}
