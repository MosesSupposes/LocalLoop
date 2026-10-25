import { useEffect, useState } from 'react'
import type { Order } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { countdown, money } from '../lib/format'
import { useConfirmBitcoinPayment } from '../lib/queries'
import { errorMessage } from '../lib/api'
import { Banner, Button, Card, Pill } from './ui'

/**
 * The bitcoin pay panel on an order: the address (or the BTCPay checkout link), the locked
 * amount and rate, and the countdown. With a BTCPay store configured the button asks the
 * provider; without one the sandbox invoice settles on the spot.
 */
export function BitcoinPayPanel({ order }: { order: Order }) {
  const { t } = useI18n()
  const confirm = useConfirmBitcoinPayment()
  const invoice = order.bitcoin
  const [now, setNow] = useState(Date.now())
  const [copied, setCopied] = useState<'address' | 'uri' | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!invoice) return null

  const expired = !invoice.paid && new Date(invoice.expiresAt).getTime() <= now
  const address = invoice.address
  const uri = invoice.uri

  async function copy(value: string, which: 'address' | 'uri') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
    } catch {
      // Clipboard blocked: the value stays on screen to select by hand.
      setCopied(null)
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold">₿ {t('bitcoin.title')}</h2>
        <Pill tone={invoice.paid ? 'open' : expired ? 'closed' : 'sunset'}>
          {invoice.paid ? `✓ ${t('bitcoin.paid')}` : expired ? t('bitcoin.expiredShort') : t('bitcoin.waiting')}
        </Pill>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-muted">{t('bitcoin.amountDue')}</p>
        <p className="font-mono text-2xl font-bold text-sunset">{invoice.amountBtc} BTC</p>
        <p className="font-mono text-xs text-muted">
          {invoice.amountSats.toLocaleString()} {t('bitcoin.sats')} · {t('bitcoin.rate')} {money(invoice.rateCents)}
        </p>
      </div>

      {address ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">{t('bitcoin.address')}</p>
          <p className="break-all rounded-2xl border border-line bg-surface-raised p-3 font-mono text-xs">
            {address}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="surface" onClick={() => copy(address, 'address')}>
              {copied === 'address' ? t('bitcoin.copied') : t('bitcoin.copy')}
            </Button>
            {uri ? (
              <Button size="sm" variant="surface" onClick={() => copy(uri, 'uri')}>
                {copied === 'uri' ? t('bitcoin.copied') : t('bitcoin.copyUri')}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted">{t('bitcoin.sendExactly')}</p>
        </div>
      ) : null}

      {invoice.checkoutUrl ? (
        <a href={invoice.checkoutUrl} target="_blank" rel="noreferrer" className="inline-flex">
          <Button size="sm" variant="sunset">
            {t('bitcoin.openCheckout')}
          </Button>
        </a>
      ) : null}

      {!invoice.paid && !expired ? (
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone="sky">
            {t('bitcoin.expiresIn')} <span className="font-mono">{countdown(invoice.expiresAt, now)}</span>
          </Pill>
          <Button size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate(order.id)}>
            {invoice.simulated ? t('bitcoin.simulate') : t('bitcoin.check')}
          </Button>
        </div>
      ) : null}

      {expired ? <Banner tone="muted">{t('bitcoin.expired')}</Banner> : null}
      {invoice.simulated && !invoice.paid ? <Banner tone="sky">{t('bitcoin.sandboxNote')}</Banner> : null}
      {confirm.error ? <Banner tone="sunset">{errorMessage(confirm.error)}</Banner> : null}
    </Card>
  )
}
