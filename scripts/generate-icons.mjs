import sharp from 'sharp'
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await sharp('public/icon.svg').resize(size, size).png().toFile(`public/${name}`)
}
await sharp('public/icon.svg')
  .resize(360, 360)
  .extend({ top: 76, bottom: 76, left: 76, right: 76, background: '#255544' })
  .png()
  .toFile('public/icon-maskable.png')
