const cache = new WeakMap()

// Rasterize the actual outline, including holes, onto a small common grid.
function outline(glyph) {
  const bounds = glyph.getBoundingBox()
  const width = bounds.x2 - bounds.x1, height = bounds.y2 - bounds.y1
  if (!width || !height) return null
  const rows = 24, cols = Math.max(5, Math.round(rows * width / height))
  const crossings = Array.from({ length: rows }, () => [])
  let x, y, start
  function edge(nx, ny) {
    for (let j = 0; j < rows; j++) {
      const scan = bounds.y2 - (j + .5) / rows * height
      if ((y > scan) !== (ny > scan)) crossings[j].push(x + (nx-x)*(scan-y)/(ny-y))
    }
    x=nx; y=ny
  }
  for (const cmd of glyph.path.commands) {
    if(cmd.type==='M'){x=cmd.x;y=cmd.y;start=[x,y]}
    else if(cmd.type==='L')edge(cmd.x,cmd.y)
    else if(cmd.type==='Z')edge(...start)
    else {
      const ox=x,oy=y
      for(let k=1;k<=12;k++){
        const t=k/12,s=1-t
        if(cmd.type==='Q')edge(s*s*ox+2*s*t*cmd.x1+t*t*cmd.x,s*s*oy+2*s*t*cmd.y1+t*t*cmd.y)
        else edge(s**3*ox+3*s*s*t*cmd.x1+3*s*t*t*cmd.x2+t**3*cmd.x,s**3*oy+3*s*s*t*cmd.y1+3*s*t*t*cmd.y2+t**3*cmd.y)
      }
    }
  }
  const mask=Array(cols+6).fill(0)
  for(const points of crossings){
    mask.push(0,0,0)
    points.sort((a,b)=>a-b)
    for(let i=0;i<cols;i++){
      const coordinate=bounds.x1+(i+.5)/cols*width
      mask.push(points.filter(p=>p<=coordinate).length%2)
    }
    mask.push(0,0,0)
  }
  mask.push(...Array(cols+6).fill(0))
  const mean=mask.reduce((a,b)=>a+b,0)/mask.length
  const norm=Math.sqrt(mask.length*mean*(1-mean))
  if(!norm)return null
  return {rows,cols,ratio:width/height,weights:Float32Array.from(mask,v=>(v-mean)/norm)}
}

export function refineLines(lines, font, image, polarity = 1) {
  if(!cache.has(font)){
    const shapes=[]
    for(const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'){
      if(!font.charToGlyphIndex(ch))continue
      const shape=outline(font.charToGlyph(ch))
      if(shape)shapes.push({...shape,ch})
    }
    cache.set(font,shapes)
  }
  for(const line of lines)for(const cell of line){
    if(!/[A-Z0-9]/.test(cell.character))continue
    const matches=[]
    for(const shape of cache.get(font)){
      let best=-1
      for(const scale of [.88,.96,1.04]){
        const h=cell.height*scale,w=h*shape.ratio
        if(w<cell.width*.35||w>cell.width*1.5)continue
        const shifts = polarity < 0 && cell.height < 10 ? [-1,0,1] : [-4,-3,-2,-1,0,1,2,3,4]
        for(const dx of shifts)for(const dy of [-1,0,1]){
          const left=cell.left+(cell.width-w)/2+dx,top=cell.top+(cell.height-h)/2+dy
          let dot=0,sum=0,squares=0,k=0
          for(let j=-1;j<shape.rows+1;j++){
            const y=Math.max(0,Math.min(image.height-1,Math.floor(top+(j+.5)*h/shape.rows)))
            for(let i=-3;i<shape.cols+3;i++,k++){
              const x=Math.max(0,Math.min(image.width-1,Math.floor(left+(i+.5)*w/shape.cols)))
              const value=image.data[4*(y*image.width+x)+1]
              dot+=value*shape.weights[k];sum+=value;squares+=value*value
            }
          }
          const score=polarity*dot/Math.sqrt(Math.max(1,squares-sum*sum/k))-.12*Math.abs(Math.log(w/cell.width))
          best=Math.max(best,score)
        }
      }
      matches.push({character:shape.ch,score:best})
    }
    matches.sort((a,b)=>b.score-a.score)
    if(matches[0]?.score>.32){
      cell.character=matches[0].character
      cell.candidates=matches.slice(0,5).map(m=>({character:m.character,error:1-m.score}))
      cell.confidence=Math.round(100*matches[0].score)
      cell.equivalent=[cell.character]
    }
  }
}
