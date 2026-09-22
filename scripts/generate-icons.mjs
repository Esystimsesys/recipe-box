import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const source = await readFile('public/icon.svg', 'utf8')
if (!source.includes(' rx="112"') || !source.includes('<g id="artwork">')) {
  throw new Error('icon.svg is missing its rounded background or artwork group')
}
const tile = Buffer.from(source)
const maskableSource = source
  .replace(' rx="112"', '')
  .replace(
    '<g id="artwork">',
    '<g id="artwork" transform="translate(256 256) scale(.9) translate(-256 -256)">',
  )
const maskable = Buffer.from(maskableSource)

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['favicon-32.png', 32],
]) {
  await sharp(tile).resize(size, size).png().toFile(`public/${name}`)
}

await sharp(maskable).resize(180, 180).png().toFile('public/apple-touch-icon.png')
await sharp(maskable).resize(512, 512).png().toFile('public/icon-maskable.png')

// PNG-compressed frames inside an ICO keep the small favicon crisp in older browsers.
const faviconSizes = [16, 32, 48]
const frames = await Promise.all(
  faviconSizes.map((size) => sharp(tile).resize(size, size).png().toBuffer()),
)
const header = Buffer.alloc(6 + frames.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(frames.length, 4)
let offset = header.length
for (const [index, frame] of frames.entries()) {
  const entry = 6 + index * 16
  header.writeUInt8(faviconSizes[index], entry)
  header.writeUInt8(faviconSizes[index], entry + 1)
  header.writeUInt8(0, entry + 2)
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(frame.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += frame.length
}
await writeFile('public/favicon.ico', Buffer.concat([header, ...frames]))
