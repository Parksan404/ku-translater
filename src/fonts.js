import opentype from 'opentype.js'

export const fonts = ['Solaris Universal', 'Federation', 'Ragunna Decorated', 'Rinascita Ribbon', 'Septimont Digital', 'Lahai-Roi Regular', 'Old Font', 'Digital Tube'].map((name, i) => ({ id: `font-${i}`, name, url: `${import.meta.env.BASE_URL}fonts/${encodeURIComponent(name)}.ttf` }))
const cache = new Map()

export async function loadFont(id) {
  if (cache.has(id)) return cache.get(id)
  const entry = fonts.find(f => f.id === id)
  if (!entry) throw new Error('ไม่พบฟอนต์ที่เลือก')
  const task = (async () => {
    const response = await fetch(entry.url)
    if (!response.ok) throw new Error(`โหลดฟอนต์ ${entry.name} ไม่สำเร็จ`)
    const data = await response.arrayBuffer()
    const parsed = opentype.parse(data)
    const face = new FontFace(id, data)
    await face.load()
    document.fonts.add(face)
    const characters = Object.keys(parsed.tables.cmap.glyphIndexMap).map(Number).filter(n => n >= 33 && n <= 126).map(n => String.fromCodePoint(n))
    return { ...entry, parsed, characters }
  })()
  cache.set(id, task)
  try { return await task } catch (error) { cache.delete(id); throw error }
}

export function renderGlyph(font, character, size = 90) {
  const canvas = document.createElement('canvas')
  const path = font.parsed.getPath(character, 0, 0, size)
  const box = path.getBoundingBox()
  if (!Number.isFinite(box.x1) || box.x2 <= box.x1 || box.y2 <= box.y1) return null
  canvas.width = Math.ceil(box.x2 - box.x1) + 12
  canvas.height = Math.ceil(box.y2 - box.y1) + 12
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.translate(6 - box.x1, 6 - box.y1)
  path.draw(context)
  return canvas
}

export async function createSample(id, text = 'HELLO WORLD\nSOLARIS 2026') {
  await loadFont(id)
  const canvas = document.createElement('canvas')
  canvas.width = 1100; canvas.height = 330
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#172a25'; ctx.font = `64px "${id}"`
  text.split('\n').forEach((line, i) => ctx.fillText(line, 55, 120 + i * 115))
  return canvas
}
