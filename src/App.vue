<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ScanLine, Languages, Grid2X2, Upload, ArrowUpRight, ArrowRight, ImagePlus, Crop, RotateCcw, Copy, Download, Check, Sparkles, ChevronDown, X, LoaderCircle, ShieldCheck, CircleHelp, FileImage, SlidersHorizontal, Moon, Sun } from 'lucide-vue-next'
import { fonts, loadFont, createSample } from './fonts'
import { recognize } from './recognition'
import { suggestWords } from './wordSuggestions'
import WordCheck from './WordCheck.vue'

const page = ref('translate'), fontId = ref('auto'), polarity = ref('auto'), threshold = ref(0), spacing = ref(.42)
const imageUrl = ref(''), imageName = ref(''), source = ref(null), imageElement = ref(null), upload = ref(null)
const result = ref(null), output = ref(''), busy = ref(false), progress = ref(0), error = ref(''), copied = ref(false)
const dragOver = ref(false), cropMode = ref(false), crop = ref(null), dragStart = ref(null), fontReady = ref(false), settings = ref(false)
const alphabetFont = ref(fonts[0].id), sampleText = ref('HELLO SOLARIS'), selectedGlyph = ref(null), notice = ref('')
const supported = ref({})
const cleanup = ref('auto'), wordSuggestions = ref([]), rawOutput = ref('')
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const theme = ref(document.documentElement.dataset.theme)
let selectedTheme = document.documentElement.dataset.themePreference
const pages = {
  translate: { label: 'ถอดข้อความจากภาพ', icon: ScanLine },
  alphabet: { label: 'ตารางตัวอักษร', icon: Grid2X2 },
  words: { label: 'เดาคำ', icon: Sparkles },
  guide: { label: 'วิธีใช้งาน', icon: CircleHelp },
}
let generation = 0
const alphabet = computed(()=> 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''))
const chosenFont = computed(()=> fonts.find(f=>f.id === (result.value?.fontId || alphabetFont.value)))
const cropStyle = computed(()=> crop.value && source.value ? { left:`${crop.value.x/source.value.width*100}%`,top:`${crop.value.y/source.value.height*100}%`,width:`${crop.value.w/source.value.width*100}%`,height:`${crop.value.h/source.value.height*100}%` } : {})
const lowConfidence = computed(()=> result.value?.lines.flat().filter(c=>c.confidence<75).length || 0)
const structuredText = computed(()=>result.value?.lines.map(line=>line.map(c=>(c.space?' ':'')+c.character).join('')).join('\n') || '')
const manuallyEdited = computed(()=>!!result.value && output.value!==structuredText.value)
const hasGlyph = char => supported.value[alphabetFont.value]?.includes(char)

onMounted(async()=> {
  window.addEventListener('paste', paste)
  systemTheme.addEventListener('change', syncSystemTheme)
  syncSystemTheme(systemTheme)
  try { const loaded=await Promise.all(fonts.map(f=>loadFont(f.id)));supported.value=Object.fromEntries(loaded.map(f=>[f.id,f.characters]));fontReady.value = true } catch(e) { error.value=e.message }
})
onBeforeUnmount(()=>{
  window.removeEventListener('paste', paste)
  systemTheme.removeEventListener('change', syncSystemTheme)
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})

function applyTheme(value) {
  theme.value = value
  document.documentElement.dataset.theme = value
  document.querySelector('meta[name="theme-color"]').content =
    getComputedStyle(document.documentElement).getPropertyValue('--page').trim()
}

function syncSystemTheme(event) {
  if (!selectedTheme) applyTheme(event.matches ? 'dark' : 'light')
}

function toggleTheme() {
  selectedTheme = theme.value === 'dark' ? 'light' : 'dark'
  applyTheme(selectedTheme)
  try { localStorage.setItem('ku-translate-theme', selectedTheme) } catch { /* Keep the theme for this session. */ }
}

function clearResult() { generation++; result.value=null; output.value=''; selectedGlyph.value=null; error.value='';wordSuggestions.value=[];rawOutput.value='' }
async function setImage(blob, name) {
  if (busy.value) return
  if (!blob.type.startsWith('image/')) { error.value='เลือกไฟล์รูปภาพ PNG, JPG หรือ WebP'; return }
  if (blob.size > 20*1024*1024) {error.value='รูปภาพต้องมีขนาดไม่เกิน 20 MB';return}
  clearResult()
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image(); img.src=url; await img.decode()
    if (img.width*img.height>40_000_000) throw new Error('ภาพมีความละเอียดสูงเกินไป กรุณาย่อให้ไม่เกิน 40 ล้านพิกเซล')
    if(imageUrl.value) URL.revokeObjectURL(imageUrl.value)
    source.value=img; imageUrl.value=url;imageName.value=name;crop.value=null;cropMode.value=false
  } catch(e) {URL.revokeObjectURL(url);error.value=e.message || 'เปิดรูปภาพไม่ได้'}
}
function picked(event) { const file=event.target.files?.[0]; if(file) setImage(file,file.name);event.target.value='' }
function drop(event) {dragOver.value=false;const file=event.dataTransfer.files[0];if(file)setImage(file,file.name)}
function paste(event) {
  if(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  const item=Array.from(event.clipboardData?.items || []).find(i=>i.type.startsWith('image/'))
  if(item){event.preventDefault();setImage(item.getAsFile(),'ภาพจากคลิปบอร์ด.png')}
}
async function sample() {
  try {
    const id=fontId.value==='auto'? fonts[0].id:fontId.value
    const font=await loadFont(id)
    const text=font.characters.includes('H') ? (font.characters.includes('2')?'HELLO WORLD\nSOLARIS 2026':'HELLO WORLD\nSOLARIS') : '0123456789'
    const canvas=await createSample(id,text)
    const blob=await new Promise(resolve=>canvas.toBlob(resolve))
    await setImage(blob,`ตัวอย่าง ${fonts.find(f=>f.id===id).name}.png`)
  }catch(e){error.value=e.message}
}
function pointerPosition(e) {
  const rect=imageElement.value.getBoundingClientRect()
  return {x:Math.max(0,Math.min(source.value.width,(e.clientX-rect.left)/rect.width*source.value.width)),y:Math.max(0,Math.min(source.value.height,(e.clientY-rect.top)/rect.height*source.value.height))}
}
function startCrop(e) {if(!cropMode.value||busy.value)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);dragStart.value=pointerPosition(e);crop.value=null;clearResult()}
function moveCrop(e) {if(!dragStart.value)return;const p=pointerPosition(e),s=dragStart.value;crop.value={x:Math.min(p.x,s.x),y:Math.min(p.y,s.y),w:Math.abs(p.x-s.x),h:Math.abs(p.y-s.y)}}
function endCrop() {dragStart.value=null;if(crop.value&&(crop.value.w<5||crop.value.h<5))crop.value=null;cropMode.value=false}
function resetCrop() {if(busy.value)return;crop.value=null;cropMode.value=false;clearResult()}
async function run() {
  if(!source.value||busy.value)return
  busy.value=true;error.value='';progress.value=0;result.value=null;output.value='';selectedGlyph.value=null;wordSuggestions.value=[];rawOutput.value=''
  const current=++generation
  try {
    await new Promise(resolve=>setTimeout(resolve,20))
    const r=crop.value || {x:0,y:0,w:source.value.width,h:source.value.height}
    const scale=Math.min(1,1800/r.w,1400/r.h)
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(r.w*scale));canvas.height=Math.max(1,Math.round(r.h*scale))
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source.value,r.x,r.y,r.w,r.h,0,0,canvas.width,canvas.height)
    const value=await recognize(canvas,{fontId:fontId.value,polarity:polarity.value,threshold:Number(threshold.value),spacing:Number(spacing.value),cleanup:cleanup.value},v=>progress.value=v)
    if (current !== generation) return
    result.value=value;output.value=value.text;rawOutput.value=value.text
    await refreshWordSuggestions()
  }catch(e){if(current===generation)error.value=e.message}finally{busy.value=false}
}
async function refreshWordSuggestions() {
  const current = generation
  const text = output.value
  try {
    const suggestions = await suggestWords(text, result.value?.lines)
    if (current === generation && output.value === text) wordSuggestions.value = suggestions
  } catch { /* The decoded text remains available if the dictionary fails to load. */ }
}
function applySuggestion(suggestion, replacement) {
  if(output.value.slice(suggestion.index,suggestion.index+suggestion.original.length)!==suggestion.original){wordSuggestions.value=[];return}
  output.value=output.value.slice(0,suggestion.index)+replacement+output.value.slice(suggestion.index+suggestion.original.length)
  selectedGlyph.value=null
  const change = replacement.length - suggestion.original.length
  wordSuggestions.value = wordSuggestions.value.filter(item => item !== suggestion).map(item =>
    item.index > suggestion.index ? { ...item, index: item.index + change } : item,
  )
}
async function copy() {try{await navigator.clipboard.writeText(output.value);copied.value=true;setTimeout(()=>copied.value=false,2000)}catch{notice.value='คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วกด Ctrl+C'}}
function download() {
  const url=URL.createObjectURL(new Blob([output.value],{type:'text/plain;charset=utf-8'}))
  const a=document.createElement('a');a.href=url;a.download=`${imageName.value.replace(/\.[^.]+$/,'')}-decoded.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
function replaceGlyph(character) {
  const cell=selectedGlyph.value;if(!cell)return
  cell.character=character
  output.value=result.value.lines.map(line=>line.map(c=>(c.space?' ':'')+c.character).join('')).join('\n')
  selectedGlyph.value=null
  wordSuggestions.value=[]
  refreshWordSuggestions()
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" aria-label="KU Translate" @click.prevent="page='translate'"><span class="brand-mark"><Languages :size="22" /></span><span>KU <span class="brand-light">Translate</span></span></a>
      <nav aria-label="เมนูหลัก">
        <button v-for="(item, key) in pages" :key="key" :class="{active:page===key}" :aria-current="page===key ? 'page' : undefined"
          :aria-label="item.label" :title="item.label" @click="page=key">
          <component :is="item.icon" :size="19" aria-hidden="true"/><span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="privacy-note"><ShieldCheck :size="19"/><div><strong>ประมวลผลในเครื่อง</strong><p>รูปภาพอยู่ในเบราว์เซอร์ของคุณ</p></div></div>
    </aside>
    <main>
      <header class="topbar">
        <div class="breadcrumb"><span>พื้นที่ทำงาน</span><span aria-hidden="true">/</span><strong>{{ pages[page].label }}</strong></div>
        <button class="button theme-toggle" type="button" aria-label="โหมดมืด" :aria-pressed="theme==='dark'"
          :title="theme==='dark' ? 'เปิดโหมดสว่าง' : 'เปิดโหมดมืด'" @click="toggleTheme">
          <Sun v-if="theme==='dark'" :size="17" aria-hidden="true"/><Moon v-else :size="17" aria-hidden="true"/>
          <span>โหมดมืด</span>
        </button>
      </header>
      <div class="workspace">
        <template v-if="page==='translate'">
          <div class="page-heading"><div><h1>ถอดข้อความจากภาพ</h1><p>อ่านสัญลักษณ์จากโลก Solaris เป็นตัวอักษร A–Z และตัวเลข</p></div><button class="button sample-button" @click="sample" :disabled="busy"><Sparkles :size="17"/> ลองภาพตัวอย่าง <ArrowUpRight :size="15"/></button></div>
          <div class="error" v-if="error" role="alert">{{error}}<button aria-label="ปิดข้อความ" @click="error=''"> <X :size="16"/></button></div>
          <div class="editor-grid">
            <section class="panel source-panel">
              <div class="panel-heading"><div><span class="section-icon"><FileImage :size="19"/></span><h2>รูปภาพต้นฉบับ</h2></div></div>
              <div class="image-stage" :class="{dragover:dragOver,loaded:imageUrl}" @dragover.prevent="dragOver=true" @dragleave.prevent="dragOver=false" @drop.prevent="drop">
                <div v-if="!imageUrl" class="empty-upload" role="button" tabindex="0" @click="upload.click()" @keydown.enter="upload.click()" @keydown.space.prevent="upload.click()">
                  <span class="upload-illustration" aria-hidden="true"><ImagePlus :size="29" :stroke-width="1.6"/></span>
                  <h3>วางภาพที่อยากอ่านตรงนี้</h3><p>ลากไฟล์มาวาง หรือ <strong>เลือกจากเครื่อง</strong></p><span class="file-formats">PNG, JPG, WebP · สูงสุด 20 MB</span><span class="paste-hint">หรือวางภาพด้วย <kbd>Ctrl</kbd> + <kbd>V</kbd></span>
                </div>
                <div v-else class="image-wrap" :class="{cropping:cropMode}" @pointerdown="startCrop" @pointermove="moveCrop" @pointerup="endCrop" @pointercancel="endCrop"><img ref="imageElement" :src="imageUrl" :alt="imageName" draggable="false"/><div v-if="crop" class="crop-box" :style="cropStyle"><span></span><span></span><span></span><span></span></div><span class="crop-instruction" v-if="cropMode">ลากเพื่อเลือกบริเวณข้อความ</span></div>
              </div>
              <div class="image-toolbar"><span class="image-meta">{{source ? `${source.width} × ${source.height} px` : 'ยังไม่ได้เลือกรูปภาพ'}} <span v-if="crop">· ครอปแล้ว</span></span><div><button class="icon-button" title="ครอปข้อความ" aria-label="ครอปข้อความ" :class="{selected:cropMode}" :disabled="!source||busy" @click="cropMode=!cropMode"><Crop :size="17"/></button><button class="icon-button" title="ยกเลิกครอป" aria-label="ยกเลิกครอป" :disabled="!crop||busy" @click="resetCrop"><RotateCcw :size="17"/></button><span class="toolbar-divider"></span><button class="text-button" @click="upload.click()" :disabled="busy"><Upload :size="15"/> {{source?'เปลี่ยนภาพ':'เลือกภาพ'}}</button></div></div>
              <input ref="upload" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/bmp" @change="picked" aria-label="อัปโหลดรูปภาพ"/>
              <div class="font-settings"><label for="font">ฟอนต์ในรูปภาพ</label><div class="select-wrap"><Languages :size="18"/><select id="font" v-model="fontId" :disabled="busy" @change="clearResult"><option value="auto">ตรวจจับฟอนต์อัตโนมัติ</option><option v-for="font in fonts" :key="font.id" :value="font.id">{{font.name}}</option></select><ChevronDown :size="16"/></div><div class="font-setting-foot"><span>รองรับ {{ fonts.length }} ฟอนต์</span><button class="text-button" :aria-expanded="settings" @click="settings=!settings"><SlidersHorizontal :size="15"/> ปรับแต่ง</button></div>
                <div v-if="settings" class="advanced"><label>การแยกพื้นหลัง<select v-model="cleanup" :disabled="busy" @change="clearResult"><option value="auto">อัตโนมัติ (รวมพื้นหลังสีแดง)</option><option value="game">ข้อความสว่างบนพื้นแดง / มีแสงเรือง</option><option value="plain">ภาพข้อความทั่วไป</option></select></label><label>สีตัวอักษร<select v-model="polarity" :disabled="busy" @change="clearResult"><option value="auto">อัตโนมัติ</option><option value="dark">สีเข้มบนพื้นสว่าง</option><option value="light">สีสว่างบนพื้นเข้ม</option></select></label><label>ปรับแยกสี: {{threshold}}<input v-model="threshold" :disabled="busy" type="range" min="-80" max="80" @change="clearResult"/></label><label>ระยะเว้นวรรค: {{spacing}}<input v-model="spacing" :disabled="busy" type="range" min="0.15" max="1" step="0.05" @change="clearResult"/></label></div>
                <button class="button primary translate-button" :disabled="!source||busy" @click="run"><LoaderCircle v-if="busy" :size="18" class="spin"/><ScanLine v-else :size="18"/> {{busy?`กำลังอ่านภาพ ${progress}%`:'ถอดข้อความจากภาพ'}}<ArrowRight v-if="!busy" :size="17"/></button>
              </div>
            </section>
            <section class="panel result-panel">
              <div class="panel-heading"><div><span class="section-icon"><Languages :size="18"/></span><h2>ข้อความที่อ่านได้</h2></div><span class="result-tag" :class="{ready:result}"><span></span>{{result?'ถอดข้อความแล้ว':'รอการถอดข้อความ'}}</span></div>
              <div v-if="!result" class="result-empty"><div class="result-illustration" aria-hidden="true"><span :style="{fontFamily:`'${fonts[0].id}'`}">A</span><ArrowRight :size="23"/><span>A</span></div><h3>{{busy?'กำลังเทียบรูปทรงตัวอักษร…':'ผลลัพธ์จะแสดงที่นี่'}}</h3><p>{{busy?'ประมวลผลจากฟอนต์ในเครื่องของคุณ':'เพิ่มรูปภาพแล้วกดถอดข้อความจากภาพ'}}</p><div v-if="busy" class="progress-track"><div :style="{width:`${progress}%`}"></div></div></div>
              <div v-else class="result-content"><div v-if="result.cleanup==='game'" class="game-notice">แยกพื้นหลังสีแล้ว · ภาพเบลออาจอ่านผิด โปรดตรวจตัวอักษรสีส้ม</div><div class="result-metrics"><span><i></i>{{chosenFont?.name}}</span><span :class="{warning:result.confidence<75}">ตรงกับต้นแบบ {{result.confidence}}%</span></div><label class="sr-only" for="output">ข้อความที่ถอดได้ แก้ไขได้</label><textarea id="output" v-model="output" @input="selectedGlyph=null;wordSuggestions=[]" spellcheck="false" placeholder="ข้อความที่อ่านได้"/><div v-if="wordSuggestions.length" class="word-suggestions"><strong>คำที่อาจเป็นไปได้ — เป็นการคาดเดา ไม่ใช่ผลอ่านยืนยัน</strong><div v-for="suggestion in wordSuggestions" :key="suggestion.index"><span>{{suggestion.original}}</span><button v-for="replacement in suggestion.replacements" :key="replacement" class="button" :disabled="busy" @click="applySuggestion(suggestion, replacement)">{{replacement}}</button></div></div><details v-if="output!==rawOutput" class="raw-output"><summary>ดูข้อความดิบก่อนแก้ไข</summary><pre>{{rawOutput}}</pre></details><div class="review-info">แก้ไขข้อความได้ · {{result.count}} ตัวอักษร <span v-if="lowConfidence">· {{lowConfidence}} ตัวควรตรวจสอบ</span></div><details class="review"><summary>ตรวจสอบตัวอักษรทีละตัว</summary><p>{{manuallyEdited?'แก้ไขข้อความด้วยมือแล้ว ใช้ช่องข้อความด้านบนเพื่อแก้ไขต่อ':'แตะตัวอักษรเพื่อเลือกคำตอบอื่น สีส้ม = ความตรงต่ำกว่า 75%'}}</p><div v-for="(line,index) in result.lines" :key="index" class="glyph-line"><button v-for="(cell,i) in line" :key="i" :disabled="manuallyEdited" :class="{uncertain:cell.confidence<75,spaced:cell.space}" :title="`ความตรง ${cell.confidence}%${cell.equivalent.length>1?' · รูปทรงเหมือนกัน: '+cell.equivalent.join('/'):''}`" @click="selectedGlyph=cell">{{cell.character}}</button></div><div v-if="selectedGlyph" class="candidate-list"><span>เลือกตัวอักษร</span><button v-for="candidate in selectedGlyph.candidates" :key="candidate.character" @click="replaceGlyph(candidate.character)">{{candidate.character}} <small>{{Math.round((1-candidate.error)*100)}}%</small></button><button aria-label="ปิดตัวเลือก" @click="selectedGlyph=null"><X :size="13"/></button></div></details><p class="accuracy-note">เปอร์เซ็นต์คือความตรงกับรูปทรงต้นแบบ ไม่ใช่การรับประกันความถูกต้อง ฟอนต์บางแบบใช้รูปเดียวกันสำหรับ A/a</p></div>
              <div class="result-toolbar"><span>{{output.length}} อักขระ <span v-if="result">· {{output.split('\n').length}} บรรทัด</span></span><div><button class="icon-button" :disabled="!output" aria-label="ดาวน์โหลดข้อความ" title="ดาวน์โหลด .txt" @click="download"><Download :size="17"/></button><button class="button copy-button" :disabled="!output" @click="copy"><Check v-if="copied" :size="15"/><Copy v-else :size="15"/>{{copied?'คัดลอกแล้ว':'คัดลอก'}}</button></div></div>
              <div class="tip-box"><span class="tip-icon"><Sparkles :size="17"/></span><div><strong>ภาพชัดขึ้น อ่านได้แม่นขึ้น</strong><p>ครอปให้เหลือเฉพาะข้อความ ใช้ภาพตรง และสีตัดกับพื้นหลัง</p></div></div>
            </section>
          </div>
          <section class="font-strip"><div class="strip-heading"><h2>ตัวอย่างฟอนต์</h2><button class="text-button" @click="page='alphabet'">ดูตารางตัวอักษรทั้งหมด <ArrowUpRight :size="15"/></button></div><div class="font-preview-grid"><button v-for="font in fonts.slice(0,4)" :key="font.id" class="font-preview" @click="alphabetFont=font.id;page='alphabet'"><span aria-hidden="true" :style="{fontFamily:`'${font.id}'`}">{{fontReady?'SOLARIS':'···'}}</span><div>{{font.name}}<ArrowUpRight :size="13"/></div></button></div></section>
        </template>
        <WordCheck v-else-if="page==='words'" />
        <template v-else-if="page==='alphabet'">
          <div class="page-heading"><div><h1>ตารางตัวอักษร</h1><p>เทียบรูปทรงจากไฟล์ฟอนต์กับ A–Z และตัวเลขโดยตรง</p></div></div>
          <section class="panel alphabet-panel"><div class="alphabet-controls"><label>เลือกฟอนต์<select v-model="alphabetFont"><option v-for="font in fonts" :key="font.id" :value="font.id">{{font.name}}</option></select></label><label>ทดลองพิมพ์<input v-model="sampleText" maxlength="100" placeholder="HELLO SOLARIS"/></label></div><div class="live-preview" :style="{fontFamily:`'${alphabetFont}'`}">{{sampleText}}</div><p class="alphabet-note">ช่องสีจางคืออักขระที่ไม่มีในฟอนต์ที่เลือก · ตารางแสดงตามรหัสตัวอักษรในไฟล์</p><div class="alphabet-grid"><div v-for="char in alphabet" :key="char" class="alphabet-cell" :class="{unsupported:!hasGlyph(char)}"><span :style="{fontFamily:`'${alphabetFont}'`}">{{!hasGlyph(char)?'—':char}}</span><strong>{{char}}</strong></div></div></section>
        </template>
        <template v-else>
          <div class="page-heading"><div><h1>วิธีใช้งาน</h1><p>เริ่มถอดตัวอักษรได้ใน 3 ขั้นตอน</p></div></div>
          <section class="panel guide-panel"><article><b>01</b><div><h2>อัปโหลดหรือวางรูป</h2><p>เลือก PNG, JPG หรือ WebP ลากรูปมาวาง หรือกด Ctrl+V ครอปเฉพาะข้อความด้วยปุ่มครอป แล้วลากบนภาพ</p></div></article><article><b>02</b><div><h2>เลือกฟอนต์ แล้วถอดข้อความ</h2><p>ใช้ตรวจจับอัตโนมัติเพื่อเทียบทั้ง 8 ฟอนต์ หรือเลือกฟอนต์ที่ทราบ ปรับสีตัวอักษรและระยะเว้นวรรคในเมนูปรับแต่งได้</p></div></article><article><b>03</b><div><h2>ตรวจสอบ แก้ไข และนำไปใช้</h2><p>แก้ข้อความในช่องผลลัพธ์ได้โดยตรง หรือเปิดตรวจสอบทีละตัว แล้วคัดลอกหรือดาวน์โหลดเป็น .txt</p></div></article><div class="guide-note"><strong>สิ่งที่เว็บนี้ทำได้</strong><p>ถอดสัญลักษณ์ในฟอนต์ที่ให้มาเป็น A–Z/ตัวเลข โดยเทียบรูปทรง ไม่แปลความหมายเป็นภาษาไทย ภาพเอียง ตัวอักษรติดกัน ข้อความซ้อนฉากหลัง และฟอนต์อื่นอาจอ่านผิดได้ ตัวพิมพ์เล็ก/ใหญ่ที่รูปทรงเหมือนกันจะแยกจากภาพไม่ได้</p></div><button class="button primary" @click="page='translate'">เริ่มถอดข้อความ <ArrowRight :size="17"/></button></section>
        </template>
      </div>
    </main>
    <div v-if="notice" class="toast" role="status">{{notice}}<button aria-label="ปิด" @click="notice=''"><X :size="14"/></button></div>
  </div>
</template>
