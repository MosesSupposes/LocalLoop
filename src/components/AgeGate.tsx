import { useStore } from '../lib/store'
import { STORE } from '../lib/config'
import { btnGhost, btnPrimary } from './ui'

export function AgeGate() {
  const verify = useStore((s) => s.verifyAge)
  return (
    <div className="bg-hero fixed inset-0 z-[100] flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-labelledby="age-title">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border-4 border-primary shadow-glow">
          <div className="h-6 w-6 rounded-full bg-primary" />
        </div>
        <h1 id="age-title" className="font-display text-4xl font-extrabold">{STORE.name}</h1>
        <p className="mt-3 text-muted">You must be {STORE.minAge}+ to enter. Products include tobacco-adjacent gear and Delaware-compliant medicinal herbs.</p>
        <div className="mt-6 flex flex-col gap-3">
          <button className={btnPrimary} onClick={verify}>I am {STORE.minAge} or older</button>
          <a className={btnGhost} href="https://www.google.com">I am under {STORE.minAge}</a>
        </div>
        <p className="mt-4 text-xs text-muted">ID is checked again at delivery.</p>
      </div>
    </div>
  )
}
