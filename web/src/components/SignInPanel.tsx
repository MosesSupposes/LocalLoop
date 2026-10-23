import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { useRequestOtp, useVerifyOtp } from '../lib/queries'
import { errorMessage } from '../lib/api'
import { Banner, Button, Field } from './ui'

export function SignInPanel({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const requestOtp = useRequestOtp()
  const verifyOtp = useVerifyOtp()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)

  const error = requestOtp.error ?? verifyOtp.error

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {t('auth.email')} → {t('auth.code')}
      </p>
      <Field
        label={t('auth.email')}
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      {!devCode ? (
        <Button
          full
          disabled={!email.includes('@') || requestOtp.isPending}
          onClick={() =>
            requestOtp.mutate(email.trim().toLowerCase(), {
              onSuccess: (data) => setDevCode(data.devCode ?? 'sms'),
            })
          }
        >
          {t('auth.sendCode')}
        </Button>
      ) : (
        <>
          <Banner tone="sky">
            {t('auth.sentTo')} <strong>{email}</strong>
          </Banner>
          {devCode && devCode !== 'sms' ? (
            <Banner>
              {t('auth.devHint')} <span className="font-mono text-base font-bold">{devCode}</span>
            </Banner>
          ) : null}
          <Field
            label={t('auth.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <Button
            full
            disabled={code.length < 4 || verifyOtp.isPending}
            onClick={() => verifyOtp.mutate({ email: email.trim().toLowerCase(), code }, { onSuccess: onDone })}
          >
            {t('auth.verify')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            full
            onClick={() => {
              setDevCode(null)
              setCode('')
            }}
          >
            {t('auth.changeEmail')}
          </Button>
        </>
      )}

      {error ? <Banner tone="sunset">{errorMessage(error)}</Banner> : null}
    </div>
  )
}
