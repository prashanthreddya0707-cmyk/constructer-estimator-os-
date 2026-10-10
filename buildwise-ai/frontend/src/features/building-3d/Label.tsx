import { useEffect, useMemo } from 'react'
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'

/** Draws a rounded text pill into a canvas. Pure 2D canvas: no network fonts, no nested React roots. */
function makeTexture(text: string, sub: string | undefined, active: boolean, dark: boolean) {
  const dpr = 2
  const font = `600 ${13 * dpr}px Inter, system-ui, sans-serif`
  const subFont = `500 ${12 * dpr}px Inter, system-ui, sans-serif`
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const w1 = measure.measureText(text).width
  measure.font = subFont
  const w2 = sub ? measure.measureText(` · ${sub}`).width : 0
  const padX = 8 * dpr, h = 24 * dpr
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w1 + w2 + padX * 2)
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = active ? '#f97316' : dark ? 'rgba(11,31,58,0.88)' : 'rgba(255,255,255,0.94)'
  ctx.beginPath()
  ctx.roundRect(0, 0, canvas.width, h, 6 * dpr)
  ctx.fill()
  ctx.strokeStyle = active ? '#c2410c' : 'rgba(11,31,58,0.25)'
  ctx.lineWidth = dpr
  ctx.stroke()
  ctx.textBaseline = 'middle'
  ctx.fillStyle = active || dark ? '#ffffff' : '#0b1f3a'
  ctx.font = font
  ctx.fillText(text, padX, h / 2 + dpr * 0.5)
  if (sub) {
    ctx.globalAlpha = 0.7
    ctx.font = subFont
    ctx.fillText(` · ${sub}`, padX + w1, h / 2 + dpr * 0.5)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.generateMipmaps = false
  return { tex, aspect: canvas.width / canvas.height }
}

/**
 * Billboard label. `maxWidth` (world units) keeps the label inside its room so neighbouring labels never overlap;
 * returns nothing when the room is too small for a readable label.
 */
export function Label({ text, sub, position, active = false, dark = false, size, maxWidth }: {
  text: string; sub?: string; position: [number, number, number]; active?: boolean; dark?: boolean; size: number; maxWidth?: number
}) {
  const { tex, aspect } = useMemo(() => makeTexture(text, sub, active, dark), [text, sub, active, dark])
  useEffect(() => () => tex.dispose(), [tex])
  const fit = maxWidth ? Math.min(1, maxWidth / (size * aspect)) : 1
  if (fit < 0.5 && !active) return null
  const h = size * (active ? Math.max(fit, 0.6) : fit)
  return (
    <sprite position={position} scale={[h * aspect, h, 1]} renderOrder={active ? 20 : 10}>
      <spriteMaterial map={tex} transparent depthTest={false} toneMapped={false} />
    </sprite>
  )
}
