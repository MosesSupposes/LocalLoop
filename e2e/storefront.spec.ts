import { expect, test } from '@playwright/test'
import { placeOrderApi, restock, seedCustomer, visit } from './helpers'

test.beforeAll(restock)

async function addBurgers(page: import('@playwright/test').Page, n = 2) {
  for (let i = 0; i < n; i++) await page.getByRole('button', { name: /Add Smash Burger Combo to cart/ }).click()
}

async function fillCheckout(page: import('@playwright/test').Page, o: { name?: string; phone?: string; address?: string; zip?: string } = {}) {
  await page.getByLabel('Name', { exact: true }).fill(o.name ?? 'Pat Customer')
  await page.getByLabel('Mobile number').fill(o.phone ?? '302-555-0188')
  await page.getByLabel('Street address').fill(o.address ?? '12 Loop Lane')
  await page.getByLabel('ZIP').fill(o.zip ?? '19801')
}

test.describe('gate and catalog', () => {
  test('age gate blocks the shop until confirmed', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('dialog', { name: /Smokology/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /under 21/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /on speed dial/ })).toHaveCount(0)
    await page.getByRole('button', { name: /I am 21 or older/ }).click()
    await expect(page.getByRole('heading', { name: /on speed dial/ })).toBeVisible()
  })

  test('age confirmation survives a reload', async ({ page }) => {
    await visit(page, '/')
    await page.reload()
    await expect(page.getByRole('heading', { name: /on speed dial/ })).toBeVisible()
  })

  test('category filter and search narrow the catalog', async ({ page }) => {
    await visit(page, '/')
    await page.getByRole('tab', { name: /Drinks/ }).click()
    await expect(page.getByText('Cold Brew Can')).toBeVisible()
    await expect(page.getByText('Smash Burger Combo')).toHaveCount(0)
    await page.getByRole('tab', { name: /All/ }).click()
    await page.getByLabel('Search products').fill('hoodie')
    await expect(page.getByText('Smokology Hoodie')).toBeVisible()
    await expect(page.getByText('Cold Brew Can')).toHaveCount(0)
  })

  test('empty search shows a friendly empty state', async ({ page }) => {
    await visit(page, '/')
    await page.getByLabel('Search products').fill('zzzz-nothing')
    await expect(page.getByText('Nothing here yet')).toBeVisible()
  })

  test('herb products are flagged for registry-card holders', async ({ page }) => {
    await visit(page, '/')
    await page.getByRole('tab', { name: /Medicinal Herbs/ }).click()
    await expect(page.getByText('Med card')).toHaveCount(3)
  })

  test('shows the real store address and hours in the footer', async ({ page }) => {
    await visit(page, '/')
    await expect(page.getByText(/5 W 4th St, Wilmington, DE 19801/)).toBeVisible()
    await expect(page.getByText(/Fri-Sat 11am-12am/)).toBeVisible()
    await expect(page.getByRole('link', { name: /Call \(302\) 407-2104/ })).toHaveAttribute('href', 'tel:+13024072104')
  })
})

test.describe('cart', () => {
  test('quantity controls update totals and removal empties the cart', async ({ page }) => {
    await visit(page, '/')
    await addBurgers(page, 2)
    await page.goto('/cart')
    await expect(page.getByText('$25.98').first()).toBeVisible()
    await page.getByRole('button', { name: 'Add one Smash Burger Combo' }).click()
    await expect(page.getByText('$38.97').first()).toBeVisible()
    await page.getByRole('button', { name: 'Remove one Smash Burger Combo' }).click()
    await page.getByRole('button', { name: 'Remove one Smash Burger Combo' }).click()
    await page.getByRole('button', { name: 'Remove one Smash Burger Combo' }).click()
    await expect(page.getByText('Your cart is empty')).toBeVisible()
  })

  test('cart persists across reloads', async ({ page }) => {
    await visit(page, '/')
    await addBurgers(page, 2)
    await page.reload()
    await page.goto('/cart')
    await expect(page.getByText('Smash Burger Combo')).toBeVisible()
  })

  test('below the $20 minimum the checkout link is disabled', async ({ page }) => {
    await visit(page, '/')
    await page.getByRole('button', { name: 'Add Gummy Worms to cart' }).click()
    await page.goto('/cart')
    await expect(page.getByText('Minimum order is $20.00')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Checkout' })).toHaveAttribute('aria-disabled', 'true')
  })

  test('delivery is free at $60 and up', async ({ page }) => {
    await visit(page, '/')
    await page.getByRole('button', { name: 'Add Smokology Hoodie to cart' }).click()
    await page.getByRole('button', { name: 'Add Smokology Tee to cart' }).click()
    await page.goto('/cart')
    await expect(page.getByText('Delivery').locator('..').getByText('$0.00')).toBeVisible()
  })

  test('empty cart links back to the shop', async ({ page }) => {
    await visit(page, '/cart')
    await page.getByRole('link', { name: 'Browse the shop' }).click()
    await expect(page).toHaveURL(/\/$/)
  })
})

test.describe('checkout', () => {
  test('cash order goes to the tracker and appears under Orders', async ({ page }) => {
    await visit(page, '/')
    await addBurgers(page)
    await page.goto('/cart')
    await page.getByRole('link', { name: 'Checkout' }).click()
    await fillCheckout(page)
    await page.getByLabel(/Cash on delivery/).check()
    await page.getByRole('button', { name: /Place order/ }).click()

    await expect(page).toHaveURL(/\/order\/SM\d+/)
    await expect(page.getByText('Payment pending')).toBeVisible()
    await expect(page.getByText(/cash ready at the door/)).toBeVisible()
    await page.goto('/orders')
    await expect(page.getByRole('link', { name: /SM\d+/ })).toBeVisible()
  })

  test('tip changes the total', async ({ page }) => {
    await visit(page, '/')
    await addBurgers(page)
    await page.goto('/checkout')
    await page.getByRole('button', { name: '$5.00' }).click()
    await expect(page.getByRole('button', { name: /Place order · \$35\.96/ })).toBeVisible()
    await page.getByRole('button', { name: '$0.00' }).click()
    await expect(page.getByRole('button', { name: /Place order · \$30\.96/ })).toBeVisible()
  })

  test('card and Bitcoin explain the payment step', async ({ page }) => {
    await visit(page, '/')
    await addBurgers(page)
    await page.goto('/checkout')
    await expect(page.getByText(/secure Stripe payment link/).first()).toBeVisible()
    await page.getByLabel(/Bitcoin/).check()
    await expect(page.getByText(/Bitcoin wallet address/).first()).toBeVisible()
  })

  test('rejects an address outside Wilmington', async ({ page }) => {
    await visit(page, '/')
    await addBurgers(page)
    await page.goto('/checkout')
    await fillCheckout(page, { zip: '19901' })
    await page.getByRole('button', { name: /Place order/ }).click()
    await expect(page.getByRole('alert')).toContainText(/don't deliver/)
  })

  test('rejects a malformed phone number', async ({ page }) => {
    await visit(page, '/')
    await addBurgers(page)
    await page.goto('/checkout')
    await fillCheckout(page, { phone: '12345' })
    await page.getByRole('button', { name: /Place order/ }).click()
    await expect(page.getByRole('alert')).toContainText(/valid US phone/)
  })

  test('herbs require a registry card number', async ({ page }) => {
    await visit(page, '/')
    await page.getByRole('button', { name: 'Add Calm Flower 3.5g to cart' }).click()
    await page.getByRole('button', { name: 'Add Smash Burger Combo to cart' }).click()
    await page.goto('/checkout')
    await expect(page.getByLabel('Registry card number')).toBeVisible()
    await fillCheckout(page)
    await page.getByLabel(/Cash on delivery/).check()
    await page.getByLabel('Registry card number').fill('DE-5555')
    await page.getByRole('button', { name: /Place order/ }).click()
    await expect(page).toHaveURL(/\/order\/SM\d+/)
    await expect(page.getByText(/21\+ ID and registry card/)).toBeVisible()
  })

  test('checkout form remembers the last customer details', async ({ page }) => {
    await visit(page, '/')
    await addBurgers(page)
    await page.goto('/checkout')
    await fillCheckout(page, { name: 'Remember Me' })
    await page.getByLabel(/Cash on delivery/).check()
    await page.getByRole('button', { name: /Place order/ }).click()
    await expect(page).toHaveURL(/\/order\//)
    await page.goto('/')
    await addBurgers(page)
    await page.goto('/checkout')
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Remember Me')
  })
})

test.describe('order page and history', () => {
  test('opening an order link with a valid token adds it to Orders', async ({ page, request }) => {
    const { id, token } = await placeOrderApi(request)
    await visit(page, `/order/${id}?t=${token}`)
    await expect(page.getByRole('heading', { name: new RegExp(id) })).toBeVisible()
    await page.goto('/orders')
    await expect(page.getByRole('link', { name: new RegExp(id) })).toBeVisible()
  })

  test('an unknown order shows a not-found state', async ({ page }) => {
    await seedCustomer(page)
    await page.goto('/order/SM9999999')
    await expect(page.getByText('Order not found')).toBeVisible()
  })

  test('a wrong token never reveals the order', async ({ page, request }) => {
    const { id } = await placeOrderApi(request)
    await seedCustomer(page)
    await page.goto(`/order/${id}?t=${'a'.repeat(48)}`)
    await expect(page.getByText(/\$\d+\.\d\d/)).toHaveCount(0)
  })

  test('customer can report a problem and gets a ticket', async ({ page, request }) => {
    const { id, token } = await placeOrderApi(request)
    await visit(page, `/order/${id}?t=${token}`)
    await page.getByText('Report a problem').click()
    await page.getByLabel('What went wrong?').fill('Driver took the wrong turn')
    await page.getByRole('button', { name: 'Open ticket' }).click()
    await expect(page.getByText(/Ticket T\d+ opened/)).toBeVisible()
  })

  test('orders page shows an empty state without orders', async ({ page }) => {
    await seedCustomer(page)
    await page.goto('/orders')
    await expect(page.getByText('No orders yet')).toBeVisible()
  })
})
