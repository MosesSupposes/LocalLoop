export const STORE = {
  name: 'Smokology',
  phone: import.meta.env?.VITE_STORE_PHONE ?? '+13024072104',
  phoneDisplay: '(302) 407-2104',
  address: { street: '5 W 4th St', city: 'Wilmington', state: 'DE', zip: '19801' },
  timeZone: 'America/New_York',
  btcAddress: import.meta.env?.VITE_BTC_ADDRESS ?? '',
  stripeKey: import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY ?? '',
  minAge: 21,
  deliveryZips: ['19801'],
  minOrderCents: 2000,
  deliveryFeeCents: 399,
  freeDeliveryOverCents: 6000,
  serviceFeeCents: 99,
  maxBatchSize: 4,
} as const

// Minutes since midnight, indexed Sun..Sat. Fri/Sat close at midnight (1440).
const WEEK = [[660, 1350], [660, 1350], [660, 1350], [660, 1350], [660, 1350], [660, 1440], [660, 1440]] as const
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function storeClock(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: STORE.timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return { day: DAY.indexOf(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

export function isOpenNow(now = new Date()): boolean {
  const { day, minutes } = storeClock(now)
  const [open, close] = WEEK[day]
  return minutes >= open && minutes < close
}

export const HOURS_SUMMARY = 'Sun-Thu 11am-10:30pm, Fri-Sat 11am-12am (Eastern)'
export const addressLine = () => `${STORE.address.street}, ${STORE.address.city}, ${STORE.address.state} ${STORE.address.zip}`

export const telHref = (p: string) => `tel:${p}`
export const smsHref = (p: string) => `sms:${p}`
