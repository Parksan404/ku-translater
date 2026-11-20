import { test, expect } from '@playwright/test'

const names=['Solaris Universal','Federation','Ragunna Decorated','Rinascita Ribbon','Septimont Digital','Lahai-Roi Regular','Old Font','Digital Tube']
for(const [index,name] of names.entries()){
  test(`detects ${name} and decodes its image`,async({page})=>{
    await page.goto('/')
    const actual=await page.evaluate(async(index)=>{
      const{createSample}=await import('/src/fonts.js')
      const{recognize}=await import('/src/recognition.js')
      const text=index===7?'0123456789':'HELLO WORLD'
      const result=await recognize(await createSample(`font-${index}`,text),{fontId:'auto',polarity:'auto',threshold:0,spacing:.42})
      return{fontId:result.fontId,text:result.text}
    },index)
    expect(actual).toEqual({fontId:`font-${index}`,text:index===7?'0123456789':'HELLO WORLD'})
  })
}

test('reads light text, multiple lines and varied letter sizes',async({page})=>{
  await page.goto('/')
  const values=await page.evaluate(async()=>{
    const{loadFont}=await import('/src/fonts.js')
    const{recognize}=await import('/src/recognition.js')
    await loadFont('font-0')
    const values=[]
    for(const size of [28,48,85]){
      const c=document.createElement('canvas');c.width=1400;c.height=360
      const ctx=c.getContext('2d');ctx.fillStyle='#13231c';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#f4f1da';ctx.font=`${size}px font-0`;ctx.fillText('SOLARIS 2026',35,110);ctx.fillText('HELLO WORLD',35,250)
      const r=await recognize(c,{fontId:'font-0',polarity:'auto',threshold:0,spacing:.42});values.push(r.text)
    }
    return values
  })
  expect(values).toEqual(Array(3).fill('SOLARIS 2026\nHELLO WORLD'))
})

test('blank image gives a useful error',async({page})=>{
  await page.goto('/')
  const message=await page.evaluate(async()=>{
    const{recognize}=await import('/src/recognition.js')
    const c=document.createElement('canvas');c.width=300;c.height=100
    const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,300,100)
    try{await recognize(c,{fontId:'auto',polarity:'auto',threshold:0,spacing:.42})}catch(e){return e.message}
  })
  expect(message).toContain('ไม่พบตัวอักษร')
})

test('sample flow, manual edits, copy, download and alphabet navigation',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await context.grantPermissions(['clipboard-read','clipboard-write'])
  await page.goto('/')
  await page.getByRole('button',{name:'ลองภาพตัวอย่าง'}).click()
  await page.locator('main').getByRole('button',{name:'ถอดข้อความจากภาพ',exact:true}).click()
  await expect(page.locator('#output')).toHaveValue('HELLO WORLD\nSOLARIS 2026')
  await page.locator('#output').fill('HELLO EDITED')
  await page.getByRole('button',{name:'คัดลอก',exact:true}).click()
  await expect(page.getByRole('button',{name:'คัดลอกแล้ว'})).toBeVisible()
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('HELLO EDITED')
  const pending=page.waitForEvent('download')
  await page.getByRole('button',{name:'ดาวน์โหลดข้อความ'}).click()
  const download=await pending
  expect(download.suggestedFilename()).toContain('-decoded.txt')
  const stream=await download.createReadStream();let text='';for await(const part of stream)text+=part.toString()
  expect(text).toBe('HELLO EDITED')
  await page.getByRole('navigation').getByRole('button',{name:'ตารางตัวอักษร'}).click()
  await expect(page.locator('.alphabet-cell')).toHaveCount(36)
  await page.locator('.alphabet-controls select').selectOption('font-7')
  await expect(page.locator('.alphabet-cell.unsupported')).toHaveCount(26)
  expect(errors).toEqual([])
})

test('uploads an image and crops a region',async({page})=>{
  await page.goto('/')
  const image=await page.evaluate(async()=>{const{createSample}=await import('/src/fonts.js');return(await createSample('font-0')).toDataURL()})
  await page.getByLabel('อัปโหลดรูปภาพ').setInputFiles({name:'upload.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')})
  const original=page.locator('.image-wrap img');await expect(original).toBeVisible()
  await page.getByRole('button',{name:'ครอปข้อความ',exact:true}).click()
  const b=await original.boundingBox()
  await page.mouse.move(b.x+5,b.y+5);await page.mouse.down();await page.mouse.move(b.x+b.width-5,b.y+b.height/2);await page.mouse.up()
  await expect(page.locator('.crop-box')).toBeVisible()
  await page.locator('main').getByRole('button',{name:'ถอดข้อความจากภาพ',exact:true}).click()
  await expect(page.locator('#output')).toHaveValue('HELLO WORLD')
})

test('mobile fits viewport and preserves all navigation',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByRole('button',{name:'ลองภาพตัวอย่าง'}).click()
  await page.locator('main').getByRole('button',{name:'ถอดข้อความจากภาพ',exact:true}).click()
  await expect(page.locator('#output')).toHaveValue('HELLO WORLD\nSOLARIS 2026')
  await page.getByRole('button',{name:'วิธีใช้งาน',exact:true}).click()
  await expect(page.getByText('เริ่มถอดตัวอักษรได้ใน 3 ขั้นตอน')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
