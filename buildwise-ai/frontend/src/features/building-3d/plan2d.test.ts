import { describe, expect, it } from 'vitest'
import { buildModel } from './model'
import { buildPlanShapes } from './plan2d'
import { generatedProject } from './testFixtures'

describe('2D plan and 3D model come from the same geometry', () => {
  const { p } = generatedProject({ floors: 2, length: 12, width: 9 })
  const m = buildModel(p)

  for (const floor of m.floors) {
    const plan = buildPlanShapes(floor, m)
    const tag = `floor ${floor.index}`

    it(`${tag}: room rectangles and dimensions are identical`, () => {
      expect(plan.rooms).toHaveLength(floor.rooms.length)
      for (const r of plan.rooms) {
        const b = floor.rooms.find((x) => x.id === r.id)!
        expect(r.rect.x).toBeCloseTo(b.x0, 9)
        expect(r.rect.y).toBeCloseTo(b.z0, 9)
        expect(r.rect.w).toBeCloseTo(b.sx, 9)
        expect(r.rect.h).toBeCloseTo(b.sz, 9)
        expect(r.dims).toBe(`${b.sx.toFixed(2)} × ${b.sz.toFixed(2)} m`)
      }
    })

    it(`${tag}: walls leave a gap exactly as wide as each opening`, () => {
      for (const w of floor.walls) {
        const rects = plan.walls.filter((r) => r.wallId === w.id)
        const built = rects.reduce((a, r) => a + (w.orientation === 'x' ? r.w : r.h), 0)
        const gaps = w.openings.reduce((a, o) => a + o.width, 0)
        expect(built + gaps).toBeCloseTo(w.a1 - w.a0, 6)
        for (const o of w.openings) { // no plan wall covers an opening
          for (const r of rects) {
            const lo = w.orientation === 'x' ? r.x : r.y, hi = lo + (w.orientation === 'x' ? r.w : r.h)
            expect(hi <= o.center - o.width / 2 + 1e-6 || lo >= o.center + o.width / 2 - 1e-6).toBe(true)
          }
        }
      }
    })

    it(`${tag}: every door and window of the model is drawn once, with the same size and position`, () => {
      expect(plan.doors.length).toBe(floor.openings.filter((o) => o.kind === 'door').length)
      expect(plan.windows.length).toBe(floor.openings.filter((o) => o.kind === 'window').length)
      for (const d of plan.doors) {
        const leaf = Math.hypot(d.openEnd[0] - d.hinge[0], d.openEnd[1] - d.hinge[1])
        expect(leaf).toBeCloseTo(d.opening.width, 9)
        expect(Math.hypot(d.closedEnd[0] - d.hinge[0], d.closedEnd[1] - d.hinge[1])).toBeCloseTo(d.opening.width, 9)
      }
    })

    it(`${tag}: furniture in the plan is the furniture in 3D`, () => {
      expect(plan.furniture.map((f) => f.id).sort()).toEqual(floor.furnitureItems.map((i) => i.id).sort())
      const parts = new Set(floor.furniture.map((x) => x.itemId))
      for (const f of plan.furniture) expect(parts.has(f.id)).toBe(true)
    })

    it(`${tag}: the drawing frames the whole building`, () => {
      expect(plan.view.x).toBeLessThan(plan.footprint.x)
      expect(plan.view.x + plan.view.w).toBeGreaterThan(plan.footprint.x + plan.footprint.w)
      expect(plan.footprint.w).toBeCloseTo(m.length)
      expect(plan.footprint.h).toBeCloseTo(m.width)
    })
  }
})
