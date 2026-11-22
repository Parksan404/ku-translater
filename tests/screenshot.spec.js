import {test,expect} from '@playwright/test'
import {fileURLToPath} from 'node:url'

test('reads the real red screenshot directly from the glyph outlines',async({page})=>{
  await page.goto('/')
  await page.getByLabel('อัปโหลดรูปภาพ').setInputFiles(fileURLToPath(new URL('./fixtures/red-game-text.png',import.meta.url)))
  await page.locator('.translate-button').click()
  await expect(page.locator('#output')).toHaveValue('IDENTITY ???\nRESONANCE ???',{timeout:20000})
  await expect(page.locator('.result-metrics')).toContainText('Federation')
  await expect(page.locator('.game-notice')).toBeVisible()
  await expect(page.locator('.word-suggestions')).toHaveCount(0)
})

test('does not auto-correct unknown names or replace raw recognition',async({page})=>{
  await page.goto('/')
  const suggestions=await page.evaluate(async()=>{
    const{suggestWords}=await import('/src/wordSuggestions.js')
    return{valid:await suggestWords('IDENTITY ???\nRESONANCE ???'),unknown:await suggestWords('QZXVJKL ???')}
  })
  expect(suggestions).toEqual({valid:[],unknown:[]})
})

test('reads both text sizes inside a dark sign frame',async({page})=>{
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(fileURLToPath(new URL('./fixtures/framed-sign.png',import.meta.url)))
  await page.locator('.translate-button').click()
  await expect(page.locator('#output')).toHaveValue('HELLO WORLD\nTEST',{timeout:30000})
})

test('reads both words from the same blurry Federation sign crop', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('อัปโหลดรูปภาพ').setInputFiles(fileURLToPath(new URL('./fixtures/blurry-highway-crop.png', import.meta.url)))
  await page.locator('#font').selectOption('font-1')
  await page.locator('.translate-button').click()
  await expect(page.locator('#output')).toHaveValue('HIGHWAY TUNNEL', { timeout: 20000 })
})

test('previews and applies word suggestions while keeping the original OCR text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByLabel('อัปโหลดรูปภาพ').setInputFiles(fileURLToPath(new URL('./fixtures/blurry-highway-crop.png', import.meta.url)))
  await page.locator('#font').selectOption('font-1')
  await page.locator('.translate-button').click()
  const output = page.locator('#output')
  await expect(output).toHaveValue('HIGHWAY TUNNEL', { timeout: 20000 })
  await output.fill('GIGHWAY TRNNEL')
  await page.getByRole('button', { name: 'เดาคำจากผลอ่าน' }).click()
  await expect(page.locator('.suggested-text')).toHaveText('HIGHWAY TUNNEL')
  await expect(output).toHaveValue('GIGHWAY TRNNEL')
  await page.getByRole('button', { name: 'ใช้คำแนะนำทั้งหมด' }).click()
  await expect(output).toHaveValue('HIGHWAY TUNNEL')
})
