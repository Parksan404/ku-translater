<script setup>
import { ref } from 'vue'
import { suggestWords } from './wordSuggestions'

const input = ref('')
const suggestions = ref([])
const checked = ref(false)
const busy = ref(false)
const error = ref('')
let revision = 0

function reset() {
  revision++
  suggestions.value = []
  checked.value = false
  error.value = ''
  busy.value = false
}

async function check() {
  if (busy.value || !input.value.trim()) return
  const current = ++revision
  busy.value = true
  error.value = ''
  try {
    const matches = await suggestWords(input.value)
    if (revision === current) {
      suggestions.value = matches
      checked.value = true
    }
  } catch {
    if (revision === current) error.value = 'เปิดพจนานุกรมไม่สำเร็จ ลองอีกครั้ง'
  } finally {
    if (revision === current) busy.value = false
  }
}

function apply(suggestion, replacement) {
  const { original, index } = suggestion
  input.value = input.value.slice(0, index) + replacement + input.value.slice(index + original.length)
  const change = replacement.length - original.length
  suggestions.value = suggestions.value.filter(item => item !== suggestion).map(item =>
    item.index > index ? { ...item, index: item.index + change } : item,
  )
}
</script>

<template>
  <section class="word-check">
    <h1>เดาคำภาษาอังกฤษ</h1>
    <label for="word-check-input">ข้อความที่ถอดได้</label>
    <textarea id="word-check-input" v-model="input" rows="7" maxlength="4000"
      placeholder="เช่น IDENITTY หรือ RES?NANCE" spellcheck="false" @input="reset"/>
    <button type="button" class="button" :disabled="busy || !input.trim()" @click="check">
      {{ busy ? 'กำลังค้นคำ' : 'เดาคำ' }}
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="checked && suggestions.length" class="word-suggestions">
      <strong>คำที่เป็นไปได้ · กดเพื่อแทนที่</strong>
      <div v-for="suggestion in suggestions" :key="suggestion.index">
        <span>{{ suggestion.original }}</span>
        <button v-for="replacement in suggestion.replacements" :key="replacement" type="button"
          class="button" :disabled="busy" @click="apply(suggestion, replacement)">{{ replacement }}</button>
      </div>
    </div>
    <p v-else-if="checked" role="status">ไม่มีคำแนะนำเพิ่มเติม</p>
  </section>
</template>

<style scoped>
.word-check { max-width: 760px; margin: 0 auto; padding: 24px; }
.word-check h1 { margin: 0 0 20px; }
.word-check label { display: block; margin-bottom: 8px; }
.word-check textarea { display: block; width: 100%; padding: 12px; margin-bottom: 12px; border: 1px solid #cbd5bf; border-radius: 5px; font: inherit; resize: vertical; }
.word-check .word-suggestions { font-size: 14px; }
.word-check .word-suggestions > div { justify-content: flex-start; }
</style>
