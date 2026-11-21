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
  <div class="page-heading"><div><h1>เดาคำภาษาอังกฤษ</h1></div></div>
  <section class="panel word-check">
    <label for="word-check-input">ข้อความที่ถอดได้</label>
    <textarea id="word-check-input" v-model="input" rows="7" maxlength="4000"
      placeholder="เช่น IDENITTY หรือ RES?NANCE" spellcheck="false" @input="reset"/>
    <button type="button" class="button primary" :disabled="busy || !input.trim()" @click="check">
      {{ busy ? 'กำลังค้นคำ' : 'เดาคำ' }}
    </button>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
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

