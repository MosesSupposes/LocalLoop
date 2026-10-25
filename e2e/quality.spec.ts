import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { DRIVER, OWNER, newPage, openChat, placeOrderApi, restock, seedCustomer, staffLoginUi } from './helpers'

test.beforeAll(restock)

const noHorizontalScroll = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1)
}

async function seedCart(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('smokology-store-v2', JSON.stringify({ version: 0, state: { ageOk: true, cart: [{ productId: 'c1', qty: 2 }] } }))
  })
}

test.describe('layout', () => {
  for (const path of ['/', '/cart', '/checkout', '/orders']) {
    test(`no horizontal overflow on ${path}`, async ({ page }) => {
      await seedCart(page)
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await noHorizontalScroll(page)
    })
  }

  test('order page, chat, admin and driver screens fit the viewport', async ({ browser, request }) => {
    const { id, token } = await placeOrderApi(request)
    const customer = await newPage(browser)
    await seedCustomer(customer, { orders: { [id]: token } })
    await customer.goto(`/order/${id}`)
    await expect(customer.getByRole('heading', { name: new RegExp(id) })).toBeVisible()
    await noHorizontalScroll(customer)
    await openChat(customer)
    await noHorizontalScroll(customer)

    const admin = await newPage(browser)
    await staffLoginUi(admin, OWNER)
    await expect(admin.getByRole('tab', { name: /Orders/ })).toBeVisible()
    await noHorizontalScroll(admin)
    for (const tab of ['Tickets', 'Dispatch', 'Catalog']) {
      await admin.getByRole('tab', { name: new RegExp(tab) }).click()
      await noHorizontalScroll(admin)
    }

    const driver = await newPage(browser)
    await staffLoginUi(driver, DRIVER)
    await expect(driver.getByText('active stops')).toBeVisible()
    await noHorizontalScroll(driver)
  })

  test('header keeps the logo, open status and call button on one line', async ({ page }) => {
    await seedCustomer(page)
    await page.goto('/')
    const header = page.locator('header').first()
    const box = await header.boundingBox()
    expect(box!.height).toBeLessThan(80)
  })

  test('cart badge stays on the tab icon instead of wrapping', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'bottom tab bar is mobile only')
    await seedCart(page)
    await page.goto('/')
    const tab = page.getByRole('link', { name: /2\s*Cart/ })
    const box = await tab.boundingBox()
    expect(box!.height).toBeLessThanOrEqual(70)
  })

  test('chat button never covers the primary checkout action', async ({ page }) => {
    await seedCart(page)
    await page.goto('/checkout')
    const place = page.getByRole('button', { name: /Place order/ })
    await place.scrollIntoViewIfNeeded()
    const fab = await page.getByRole('button', { name: 'Open chat' }).boundingBox()
    const target = await place.boundingBox()
    const overlaps = fab!.x < target!.x + target!.width && fab!.x + fab!.width > target!.x && fab!.y < target!.y + target!.height && fab!.y + fab!.height > target!.y
    expect(overlaps).toBe(false)
  })
})

test.describe('touch targets', () => {
  test('interactive controls on the storefront are at least 44px tall', async ({ page }) => {
    await seedCart(page)
    for (const path of ['/', '/cart', '/checkout']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=radio]):not([type=checkbox]), select, textarea')]
          .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
          .filter((el) => el.getBoundingClientRect().height < 43.5 && !el.closest('.sr-only'))
          .map((el) => `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`),
      )
      expect(small, `${path}`).toEqual([])
    }
  })
})

test.describe('accessibility (axe, WCAG A/AA)', () => {
  const audit = async (page: Page, label: string) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), label).toEqual([])
  }

  test('age gate', async ({ page }) => {
    await page.goto('/')
    await audit(page, 'age gate')
  })

  test('storefront, cart and checkout', async ({ page }) => {
    await seedCart(page)
    for (const path of ['/', '/cart', '/checkout', '/orders']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await audit(page, path)
    }
  })

  test('chat dialog', async ({ page }) => {
    await seedCustomer(page)
    await page.goto('/')
    await openChat(page)
    await audit(page, 'chat')
  })

  test('order tracker', async ({ page, request }) => {
    const { id, token } = await placeOrderApi(request)
    await seedCustomer(page, { orders: { [id]: token } })
    await page.goto(`/order/${id}`)
    await expect(page.getByRole('heading', { name: new RegExp(id) })).toBeVisible()
    await audit(page, 'order')
  })

  test('staff sign-in, admin and driver', async ({ browser }) => {
    const login = await newPage(browser)
    await seedCustomer(login)
    await login.goto('/staff')
    await audit(login, 'staff login')

    const admin = await newPage(browser)
    await staffLoginUi(admin, OWNER)
    await expect(admin.getByRole('tab', { name: /Orders/ })).toBeVisible()
    await audit(admin, 'admin orders')
    const driver = await newPage(browser)
    await staffLoginUi(driver, DRIVER)
    await expect(driver.getByText('active stops')).toBeVisible()
    await audit(driver, 'driver')
  })

  test('reduced motion is respected', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await seedCustomer(page)
    await page.goto('/')
    const d = await page.evaluate(() => getComputedStyle(document.querySelector('button')!).transitionDuration)
    expect(parseFloat(d)).toBeLessThan(0.01)
  })
})
