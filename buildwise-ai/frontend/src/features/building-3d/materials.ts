import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

/** Small procedural textures (no network assets). Created lazily, once, in the browser. */
let cache: { wood: Texture; tile: Texture; concrete: Texture } | null = null

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): Texture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

export function getTextures() {
  if (cache) return cache
  const wood = canvasTexture(256, (g, s) => {
    const planks = 4, ph = s / planks
    const tones = ['#b58b62', '#ab8158', '#bd946b', '#b08660']
    for (let i = 0; i < planks; i++) {
      g.fillStyle = tones[i % tones.length]
      g.fillRect(0, i * ph, s, ph)
      g.strokeStyle = 'rgba(90,60,35,0.18)'
      g.lineWidth = 1
      for (let k = 0; k < 6; k++) { g.beginPath(); const y = i * ph + ((k + 1) * ph) / 7; g.moveTo(0, y); g.lineTo(s, y + ((k % 2) * 2 - 1)); g.stroke() }
      g.fillStyle = 'rgba(60,40,25,0.55)'
      g.fillRect(0, i * ph, s, 1.5)
      g.fillRect(((i * 97) % s) | 0, i * ph, 1.5, ph)
    }
  })
  const tile = canvasTexture(128, (g, s) => {
    g.fillStyle = '#c3c0b9'; g.fillRect(0, 0, s, s)
    g.fillStyle = '#dedcd6'; g.fillRect(2, 2, s - 4, s - 4)
  })
  const concrete = canvasTexture(128, (g, s) => {
    g.fillStyle = '#cfccc5'; g.fillRect(0, 0, s, s)
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${120 + (i % 40)},${118 + (i % 40)},${112 + (i % 40)},0.12)`; g.fillRect((i * 37) % s, (i * 53) % s, 2, 2) }
  })
  cache = { wood, tile, concrete }
  return cache
}

export const PALETTE = {
  wall: '#f2eee7',
  slab: '#b7b3ab',
  frame: '#fbfaf7',
  door: '#8a5d3c',
  glass: '#a9d0e8',
  roof: '#4f5a66',
  ground: '#e6eaef',
  highlight: '#f97316',
  hover: '#3c6194',
}

export function floorKind(type: string): 'wood' | 'tile' | 'concrete' {
  if (type === 'bathroom' || type === 'kitchen' || type === 'balcony') return 'tile'
  if (['bedroom', 'living', 'dining', 'study', 'office'].includes(type)) return 'wood'
  return 'concrete'
}
