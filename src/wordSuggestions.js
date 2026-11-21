const similarShapes = ['O0QD', 'I1L', 'S5', 'Z2', 'B8', 'G6', 'UV', 'MN', 'CG', 'EF']
let dictionaryPromise

function loadDictionary() {
  dictionaryPromise ??= import('an-array-of-english-words', { with: { type: 'json' } }).then(({ default: words }) => {
    const byLength = new Map()
    const known = new Set()
    for (const entry of words) {
      const word = entry.toUpperCase()
      if (!/^[A-Z]+$/.test(word) || known.has(word)) continue
      known.add(word)
      if (!byLength.has(word.length)) byLength.set(word.length, [])
      byLength.get(word.length).push(word)
    }
    return { byLength, known }
  }).catch(error => {
    dictionaryPromise = undefined
    throw error
  })
  return dictionaryPromise
}

function glyphsByIndex(lines) {
  const glyphs = new Map()
  let index = 0
  for (const line of lines) {
    for (const glyph of line) {
      if (glyph.space) index++
      glyphs.set(index, glyph)
      index += glyph.character.length
    }
    index++
  }
  return glyphs
}

function substitutions(word, glyphs, index) {
  return Array.from(word, (original, position) => {
    const glyph = glyphs.get(index + position)
    const candidates = new Map()
    for (const candidate of glyph?.candidates ?? []) {
      const letter = candidate.character.toUpperCase()
      if (glyph.character.toUpperCase() !== original || letter === original) continue
      const gap = candidate.error - (glyph.candidates[0]?.error ?? 0)
      candidates.set(letter, Math.min(.85, .28 + Math.max(0, gap) * 1.8))
    }
    return Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter => {
      if (letter === original) return 0
      if (candidates.has(letter)) return candidates.get(letter)
      if ('?*'.includes(original)) return .45
      return similarShapes.some(group => group.includes(original) && group.includes(letter)) ? .68 : 1
    })
  })
}

function editCost(source, target, costs, rows) {
  for (let j = 0; j <= target.length; j++) rows[0][j] = j * 1.05
  for (let i = 1; i <= source.length; i++) {
    const duplicate = i > 1 && source[i-1] === source[i-2]
    const deletion = duplicate ? .8 : 1.05
    rows[i][0] = rows[i-1][0] + deletion
    for (let j = 1; j <= target.length; j++) {
      rows[i][j] = Math.min(
        rows[i-1][j] + deletion,
        rows[i][j-1] + 1.05,
        rows[i-1][j-1] + costs[i-1][target.charCodeAt(j-1)-65],
      )
      if (i > 1 && j > 1 && source[i-1] === target[j-2] && source[i-2] === target[j-1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i-2][j-2] + .85)
      }
    }
  }
  return rows[source.length][target.length]
}

function matchCase(word, original) {
  if (original === original.toUpperCase()) return word
  const lower = word.toLowerCase()
  return /^[A-Z]/.test(original) ? lower[0].toUpperCase() + lower.slice(1) : lower
}

function splitCandidates(word, costs, glyphs, offset, known, candidates) {
  if (word.length < 6) return
  let variants = [{ spelling: '', score: 0 }]
  for (const letters of costs) {
    variants = variants.flatMap(({ spelling, score }) => letters.flatMap((cost, letter) =>
      cost <= .6 && score + cost <= .95
        ? [{ spelling: spelling + String.fromCharCode(65 + letter), score: score + cost }]
        : [],
    )).sort((a, b) => a.score-b.score).slice(0, 32)
  }
  for (const { spelling, score } of variants) {
    for (let split = 3; split <= spelling.length - 3; split++) {
      const first = spelling.slice(0, split), second = spelling.slice(split)
      if (!known.has(first) || !known.has(second)) continue
      const previous = glyphs.get(offset + split - 1), next = glyphs.get(offset + split)
      const gap = previous && next ? (next.left - previous.left - previous.width) / Math.max(1, next.height) : 0
      candidates.push({ candidate: first + ' ' + second, score: score + (gap > .18 ? .2 : .65) })
    }
  }
}

export async function suggestWords(text, lines = []) {
  const { byLength, known } = await loadDictionary()
  const glyphs = glyphsByIndex(lines)
  const suggestions = []
  const cached = new Map()
  let searched = 0
  // Keep trailing sentence punctuation. Treat ? and * inside words as unknown letters.
  for (const match of text.matchAll(/[A-Z0-9]+(?:[?*]+[A-Z0-9]+)*/gi)) {
    const original = match[0], word = original.toUpperCase(), index = match.index
    const letters = word.match(/[A-Z]/g)?.length ?? 0
    if (word.length < 3 || word.length > 30 || letters < 2 || known.has(word)) continue
    let replacements = lines.length ? undefined : cached.get(original)
    if (!replacements) {
      if (++searched % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0))
      const costs = substitutions(word, glyphs, index)
      const rows = Array.from({ length: word.length + 1 }, () => new Float64Array(word.length + 3))
      const limit = word.length >= 8 ? 1.9 : word.length >= 5 ? 1.45 : 1.05
      const candidates = []
      splitCandidates(word, costs, glyphs, index, known, candidates)
      for (let length = word.length - 1; length <= word.length + 1; length++) {
        for (const candidate of byLength.get(length) ?? []) {
          const score = editCost(word, candidate, costs, rows)
          if (score <= limit) candidates.push({ candidate, score })
        }
      }
      candidates.sort((a,b) => a.score-b.score || a.candidate.localeCompare(b.candidate))
      replacements = candidates.slice(0, 5).map(({ candidate }) => matchCase(candidate, original))
      if (!lines.length) cached.set(original, replacements)
    }
    if (replacements.length) suggestions.push({ original, index, replacements })
  }
  return suggestions
}
