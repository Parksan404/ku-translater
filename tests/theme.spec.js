import { test, expect } from '@playwright/test'

test('follows the system theme until the user picks one', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const root = page.locator('html')
  const toggle = page.getByRole('button', { name: 'โหมดมืด' })

  await expect(root).toHaveCSS('color-scheme', 'dark')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(root).toHaveCSS('color-scheme', 'light')

  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(root).toHaveCSS('color-scheme', 'dark')
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'เดาคำ', exact: true }).click()
  await expect(page.getByRole('textbox')).toBeVisible()
  await expect(root).toHaveCSS('color-scheme', 'dark')

  await page.emulateMedia({ colorScheme: 'dark' })
  await toggle.click()
  await page.reload()
  await expect(root).toHaveCSS('color-scheme', 'light')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
})
