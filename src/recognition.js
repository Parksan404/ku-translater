import { refineLines } from './outlineMatch.js'
import { fonts, loadFont, renderGlyph } from './fonts.js'

export function otsu(gray) {
  const histogram = new Uint32Array(256)
  for (const g of gray) histogram[g]++
  let total = 0
  for (let i = 0; i < 256; i++) total += i * histogram[i]
  let weight = 0, sum = 0, best = -1, threshold = 127
  for (let i = 0; i < 255; i++) {
    weight += histogram[i]; sum += i * histogram[i]
    if (!weight || weight === gray.length) continue
    const variance = weight * (gray.length - weight) * (sum / weight - (total - sum) / (gray.length - weight)) ** 2
    if (variance > best) { best = variance; threshold = i }
  }
  return threshold
}

// A bevel can be darker than both the lettering and the face of a sign.
// Find a lighter inset bounded on all four sides before estimating ink contrast.
function insetSign(gray, width, height, offset) {
  if (width < 48 || height < 24 || width < height * 1.5) return null
  function profile(length, span, sample) {
    return Array.from({length}, (_, i) => {
      const values = []
      for (let k = 0; k < 25; k++) values.push(sample(i, Math.floor(span * (k + .5) / 25)))
      return values.sort((a,b) => a-b)[18]
    })
  }
  function bounds(values) {
    const n = values.length
    const center = values.slice(Math.floor(n*.3), Math.ceil(n*.7)).sort((a,b) => a-b)
    const face = center[Math.floor(center.length*.65)]
    function edge(step) {
      let outer = face
      for (let i = 0; i < n*.34; i++) {
        const at = j => values[step === 1 ? j : n-1-j]
        outer = Math.min(outer, at(i))
        if (i >= 2 && [0,1,2].every(j => at(i+j) >= face-12 && at(i+j)-outer >= 18)) return i
      }
      return -1
    }
    const a = edge(1), b = edge(-1)
    return a < 0 || b < 0 ? null : [a+1,n-b-1]
  }
  const vertical = bounds(profile(height, width, (y,x) => gray[y*width+x]))
  if (!vertical) return null
  const [top,bottom] = vertical
  const horizontal = bounds(profile(width, bottom-top, (x,y) => gray[(top+y)*width+x]))
  if (!horizontal) return null
  const [left,right] = horizontal
  const face = new Uint8Array((right-left)*(bottom-top))
  for (let y=top; y<bottom; y++) face.set(gray.subarray(y*width+left,y*width+right),(y-top)*(right-left))
  const threshold = otsu(face)+offset
  const pixels = new Uint8Array(gray.length)
  let ink = 0
  for (let y=top; y<bottom; y++) for (let x=left; x<right; x++) {
    if (gray[y*width+x] <= threshold) { pixels[y*width+x]=1; ink++ }
  }
  if (ink < face.length*.02 || ink > face.length*.45) return null
  return {width,height,pixels,cleanup:'plain', framed:true}
}

export function binarize(image, mode = 'auto', offset = 0, cleanup = 'auto') {
  const { width, height, data } = image
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i++) {
    const a = data[i * 4 + 3] / 255
    gray[i] = Math.round((data[i * 4] * .299 + data[i * 4 + 1] * .587 + data[i * 4 + 2] * .114) * a + 255 * (1 - a))
  }
  let colorBackground = 0
  for(let i=0;i<gray.length;i++) if(data[i*4]>data[i*4+1]+45 && data[i*4]>data[i*4+2]+25)colorBackground++
  const suppressRed = cleanup === 'game' || (cleanup === 'auto' && colorBackground > gray.length*.3)
  if (cleanup === 'auto' && mode !== 'light' && !suppressRed) {
    const sign = insetSign(gray,width,height,offset)
    if (sign) return sign
  }
  if(suppressRed) for(let i=0;i<gray.length;i++)gray[i]=Math.round((data[i*4+1]+data[i*4+2])*.5)
  const threshold = Math.min(254, Math.max(0, otsu(gray) + offset + (suppressRed?39:0)))
  let borderDark = 0, count = 0
  for (let x = 0; x < width; x++) { borderDark += gray[x] <= threshold; borderDark += gray[(height - 1) * width + x] <= threshold; count += 2 }
  for (let y = 0; y < height; y++) { borderDark += gray[y * width] <= threshold; borderDark += gray[y * width + width - 1] <= threshold; count += 2 }
  const light = mode === 'light' || (mode === 'auto' && borderDark > count / 2)
  const pixels = Uint8Array.from(gray, g => light ? +(g > threshold) : +(g <= threshold))
  if(suppressRed) {
    // Interface borders and isolated compression pixels are not text.
    const visited=new Uint8Array(pixels.length)
    for(let i=0;i<pixels.length;i++)if(pixels[i]&&!visited[i]){
      const stack=[i],component=[];visited[i]=1
      let minX=width,maxX=0,minY=height,maxY=0
      while(stack.length){const p=stack.pop(),x=p%width,y=Math.floor(p/width);component.push(p);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)
        for(const q of [x>0?p-1:-1,x<width-1?p+1:-1,y>0?p-width:-1,y<height-1?p+width:-1])if(q>=0&&pixels[q]&&!visited[q]){visited[q]=1;stack.push(q)}
      }
      if((maxX-minX>width*.25 && maxY-minY<5) || (minY===0 && maxY<5))component.forEach(p=>pixels[p]=0)
    }
  }
  return { width, height, pixels, cleanup:suppressRed?'game':'plain' }
}

export function runs(values, minimum = 1) {
  const result = []
  let start = -1
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i] >= minimum) { if (start < 0) start = i }
    else if (start >= 0) { result.push([start, i]); start = -1 }
  }
  return result
}

export function segment(binary, spacing = .42) {
  const { width, height, pixels } = binary
  const rows = new Uint32Array(height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows[y] += pixels[y * width + x]
  const raw = runs(rows)
  // Merge small separated marks above/below a line, e.g. dots and accents.
  const bands = []
  for (const band of raw) {
    const previous = bands.at(-1)
    if (previous && band[0] - previous[1] <= Math.max(2, Math.max(band[1] - band[0], previous[1] - previous[0]) * .16)) previous[1] = band[1]
    else bands.push([...band])
  }
  return bands.filter(([a,b]) => b-a >= 3).map(([top, bottom]) => {
    const columns = new Uint32Array(width)
    for (let x = 0; x < width; x++) for (let y = top; y < bottom; y++) columns[x] += pixels[y * width + x]
    const boxes = runs(columns).map(([left, right]) => ({ left, top, width: right-left, height: bottom-top }))
    return boxes.filter(b => b.width * b.height >= 5).map((box, i) => ({ ...box, space: i > 0 && box.left - (boxes[i-1].left + boxes[i-1].width) > box.height * spacing }))
  }).filter(line => line.length)
}

export function normalize(binary, box, size = 32) {
  const { width, pixels } = binary
  let left = box.left + box.width, right = box.left, top = box.top + box.height, bottom = box.top
  for (let y = box.top; y < box.top + box.height; y++) for (let x = box.left; x < box.left + box.width; x++) if (pixels[y * width + x]) { left = Math.min(left,x); right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1) }
  const w = Math.max(1,right-left), h = Math.max(1,bottom-top)
  const output = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Supersampling keeps narrow strokes when shrinking glyphs.
    let value = 0
    for (const dy of [.25,.75]) for (const dx of [.25,.75]) value += pixels[Math.min(bottom-1,Math.floor(top+(y+dy)*h/size))*width+Math.min(right-1,Math.floor(left+(x+dx)*w/size))] || 0
    output[y*size+x] = value/4
  }
  const expanded=new Float32Array(output.length)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let value=0
    for(let yy=Math.max(0,y-2);yy<=Math.min(size-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(size-1,x+2);xx++)value=Math.max(value,output[yy*size+xx])
    expanded[y*size+x]=value
  }
  return { pixels: output, expanded, ratio: w/h, inkWidth:w, inkHeight:h }
}

export function distance(a, b) {
  let mismatch = 0, ink = 0
  for (let i = 0; i < a.pixels.length; i++) { mismatch += Math.abs(a.pixels[i]-b.pixels[i]); ink += Math.max(a.pixels[i],b.pixels[i]) }
  return mismatch / Math.max(1,ink) * .72 + Math.min(1,Math.abs(Math.log(a.ratio/b.ratio))) * .28
}
function fuzzyDistance(a,b){
  let mismatch=0,ink=0
  for(let i=0;i<a.pixels.length;i++){
    mismatch+=Math.max(0,a.pixels[i]-b.expanded[i])+Math.max(0,b.pixels[i]-a.expanded[i])
    ink+=a.pixels[i]+b.pixels[i]
  }
  return mismatch/Math.max(1,ink)*.8+Math.min(1,Math.abs(Math.log(a.ratio/b.ratio)))*.2
}

const templates = new Map()
function splitTouching(binary, line, references) {
  const fit = box => {
    const sample=normalize(binary,box)
    return Math.min(...references.map(t=>distance(sample,t)))
  }
  function split(box, depth=0) {
    if(depth>=3 || box.width<box.height*1.25 || fit(box)<.4) return [box]
    let best=null
    for(let cut=Math.ceil(box.width*.23);cut<box.width*.77;cut++){
      const a={...box,width:cut},b={...box,left:box.left+cut,width:box.width-cut}
      const ea=fit(a),eb=fit(b),score=(ea*a.width+eb*b.width)/box.width
      if(ea<.4&&eb<.4&&(!best||score<best.score))best={a,b,score}
    }
    if(!best || best.score+.07>=fit(box))return[box]
    return [...split(best.a,depth+1),...split(best.b,depth+1)]
  }
  return line.flatMap(box=>split(box))
}
function splitGameLine(binary, rawLine, references, cache) {
  const first=rawLine[0],last=rawLine.at(-1),left=first.left,right=last.left+last.width,h=first.height
  if(h<6)return []
  const columns=new Uint16Array(binary.width)
  for(let x=left;x<right;x++)for(let y=first.top;y<first.top+h;y++)columns[x]+=binary.pixels[y*binary.width+x]
  const refs=references.filter(t=>/[A-Z0-9?!]/.test(t.character))
  const capHeight=Math.max(...refs.filter(t=>/[A-Z0-9]/.test(t.character)).map(t=>t.bounds.y2-t.bounds.y1))
  const dp=Array(right+1).fill(null);dp[left]={cost:0,cells:[]}
  for(let x=left;x<right;x++){
    if(!dp[x])continue
    if(!columns[x]){if(!dp[x+1]||dp[x].cost<dp[x+1].cost)dp[x+1]=dp[x];continue}
    for(let end=x+Math.max(3,Math.round(h*.18));end<=Math.min(right,x+Math.ceil(h*1.65));end++){
      if(end<right&&columns[end]&&columns[end-1]&&end%2)continue
      const key=`${first.top}:${x}:${end}`
      let sample=cache.get(key)
      const box={left:x,top:first.top,width:end-x,height:h}
      if(!sample){sample=normalize(binary,box);if(cache.size>6000)cache.clear();cache.set(key,sample)}
      if(sample.inkHeight<h*.6)continue
      const ranked=[]
      for(const t of refs){
        if(Math.abs(Math.log(sample.ratio/t.ratio))>.65)continue
        const heightPenalty=Math.abs(sample.inkHeight/h-(t.bounds.y2-t.bounds.y1)/capHeight)*.32
        ranked.push({character:t.character,error:fuzzyDistance(sample,t)+heightPenalty,template:t})
      }
      ranked.sort((a,b)=>a.error-b.error)
      if(!ranked.length)continue
      const best=ranked[0],cost=dp[x].cost+(best.error+.10)*(end-x)
      if(!dp[end]||cost<dp[end].cost){
        const margin=(ranked[1]?.error??1)-best.error
        const confidence=Math.round(Math.max(0,1-best.error*1.8)*90*(.7+.3*Math.min(1,margin/.15)))
        const cell={...box,inkHeight:sample.inkHeight,character:best.character,confidence,candidates:ranked.slice(0,5).map(({character,error})=>({character,error})),equivalent:[best.character],template:best.template,error:best.error}
        dp[end]={cost,cells:[...dp[x].cells,cell]}
      }
    }
  }
  return dp[right]?.cells||[]
}
async function getTemplates(id) {
  if (templates.has(id)) return templates.get(id)
  const font = await loadFont(id)
  const result = []
  for (const character of font.characters) {
    const canvas = renderGlyph(font, character)
    if (!canvas) continue
    const binary = binarize(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height), 'dark')
    const glyph = font.parsed.charToGlyph(character), bounds = glyph.getBoundingBox()
    result.push({ character, bounds, advance:glyph.advanceWidth, ...normalize(binary, {left:0,top:0,width:canvas.width,height:canvas.height}) })
  }
  for(const character of ['?','!']){
    if(font.characters.includes(character))continue
    const c=document.createElement('canvas');c.width=100;c.height=110
    const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,100,110);ctx.fillStyle='#000';ctx.font='90px Arial';ctx.fillText(character,10,90)
    const m=ctx.measureText(character),b=binarize(ctx.getImageData(0,0,100,110),'dark')
    const scale=font.parsed.unitsPerEm/90
    result.push({character,bounds:{x1:-m.actualBoundingBoxLeft*scale,y1:-m.actualBoundingBoxDescent*scale,x2:m.actualBoundingBoxRight*scale,y2:m.actualBoundingBoxAscent*scale},advance:m.width*scale,...normalize(b,{left:0,top:0,width:100,height:110})})
  }
  templates.set(id,result)
  return result
}

export async function recognize(canvas, options, onProgress = () => {}) {
  const image = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height)
  const binary = binarize(image, options.polarity, options.threshold, options.cleanup)
  const lines = segment(binary, options.spacing)
  const count = lines.reduce((n,line)=>n+line.length,0)
  if (!count) throw new Error('ไม่พบตัวอักษร ลองครอปให้ชิดข้อความหรือเปลี่ยนสีข้อความ')
  if (count > 1500) throw new Error('พบรายละเอียดในภาพมากเกินไป กรุณาครอปเฉพาะข้อความ')
  const fontIds = options.fontId === 'auto' ? fonts.map(f=>f.id) : [options.fontId]
  const results = []
  const gameCache=new Map()
  for (let f = 0; f < fontIds.length; f++) {
    const id = fontIds[f], references = await getTemplates(id)
    let sum = 0, matchedCount = 0
    const referenceHeight = Math.max(...references.filter(t=>/[A-Z0-9]/.test(t.character)).map(t=>t.bounds.y2-t.bounds.y1))
    const matched = lines.map(rawLine => {
      const line=binary.cleanup==='game'?rawLine:splitTouching(binary,rawLine,references)
      // Dynamic programming groups disconnected pieces into complete glyphs.
      // A glyph may contain several separate vertical runs (e.g. digital 0 or R).
      const dp = Array(line.length+1).fill(null)
      dp[0] = {cost:0,cells:[]}
      const lineHeight = line[0].height
      if(binary.cleanup!=='game') for (let start = 0; start < line.length; start++) {
        if (!dp[start]) continue
        for (let end = start; end < Math.min(line.length,start+7); end++) {
          const first=line[start], last=line[end]
          if (end>start && last.left-(line[end-1].left+line[end-1].width)>lineHeight*.55) break
          const box={left:first.left,top:first.top,width:last.left+last.width-first.left,height:first.height}
          if (box.width>lineHeight*2.5 && end>start) break
          const sample=normalize(binary,box)
          const ranked=references.map(t=>{
            const heightPenalty=Math.min(1,Math.abs(sample.inkHeight/lineHeight-(t.bounds.y2-t.bounds.y1)/referenceHeight))*.22
            return {character:t.character,error:distance(sample,t)+heightPenalty,template:t}
          }).sort((a,b)=>a.error-b.error)
          // Identical upper/lowercase outlines cannot be distinguished in an image.
          // Prefer uppercase if both shapes have almost the same score.
          const best=ranked[0]
          const upper=ranked.find(c=>c.character===best.character.toUpperCase())
          if(upper && upper.error-best.error<.055 && upper!==best){ranked.splice(ranked.indexOf(upper),1);ranked.unshift(upper)}
          const cell={...box,inkHeight:sample.inkHeight,character:ranked[0].character,confidence:Math.max(0,Math.round((1-ranked[0].error)*100)),candidates:ranked.slice(0,5).map(({character,error})=>({character,error})),equivalent:ranked.filter(c=>Math.abs(c.error-ranked[0].error)<.025).map(c=>c.character),template:ranked[0].template,error:ranked[0].error}
          const cost=dp[start].cost+(ranked[0].error+.025)*box.width+(binary.framed ? lineHeight*.065 : 0)
          if(!dp[end+1] || cost<dp[end+1].cost) dp[end+1]={cost,cells:[...dp[start].cells,cell]}
        }
      }
      const cells=binary.cleanup==='game'?splitGameLine(binary,rawLine,references,gameCache):(dp[line.length]?.cells || [])
      if(binary.cleanup==='game')for(let i=0;i<cells.length;i++){
        const cell=cells[i],question=cell.candidates.find(c=>c.character==='?')
        const nearby=cells.filter((c,j)=>j!==i&&Math.abs(j-i)<=2&&c.character==='?'&&Math.abs(c.inkHeight-cell.inkHeight)<3&&Math.abs(c.width-cell.width)<5)
        if(cell.character!=='?'&&question&&question.error-cell.error<.12&&nearby.length>=2){
          cell.character='?';cell.confidence=Math.min(cell.confidence,65)
          const reference=references.find(t=>t.character==='?');cell.template=reference;cell.error=question.error
        }
      }
      cells.forEach((cell,i)=>{
        if(i){
          const previous=cells[i-1], a=previous.template, b=cell.template
          const scale=(previous.inkHeight/(a.bounds.y2-a.bounds.y1)+cell.inkHeight/(b.bounds.y2-b.bounds.y1))/2
          const expectedGap=(a.advance-a.bounds.x2+b.bounds.x1)*scale
          cell.space=cell.left-previous.left-previous.width>expectedGap+lineHeight*options.spacing*.5
        } else cell.space=false
        sum+=cell.error;matchedCount++
      })
      cells.forEach(cell=>{delete cell.template;delete cell.error})
      return cells
    })
    results.push({fontId:id,lines:matched.filter(line=>line.length),error:matchedCount?sum/matchedCount:1})
    onProgress(Math.round((f+1)/fontIds.length*100))
    await new Promise(resolve=>setTimeout(resolve,0))
  }
  results.sort((a,b)=>a.error-b.error)
  const best = results[0]
  if(!best.lines.flat().length)throw new Error('แยกตัวอักษรไม่ได้ ลองครอปเฉพาะข้อความหรือปรับแยกสี')
  if(binary.cleanup==='game' || binary.framed){
    const font=await loadFont(best.fontId)
    refineLines(best.lines,font.parsed,image,binary.framed ? -1 : 1)
  }
  const confidence=binary.cleanup==='game'?Math.round(best.lines.flat().reduce((sum,c)=>sum+c.confidence,0)/best.lines.flat().length):Math.round((1-best.error)*100)
  return { ...best, cleanup:binary.cleanup, confidence, text:best.lines.map(line=>line.map(c=>(c.space?' ':'')+c.character).join('')).join('\n'), count:best.lines.flat().length, alternatives:results.map(r=>({fontId:r.fontId,confidence:Math.round((1-r.error)*100)})) }
}
