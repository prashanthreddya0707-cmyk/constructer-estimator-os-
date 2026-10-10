import { describe, expect, it } from 'vitest'
import { makeLayout, mm, parseLayout, planSignature, roomSignature } from './layoutStore'
import { room } from './testFixtures'

describe('plan signature (shared with the Python estimator)', () => {
  it('matches the golden value asserted in backend/tests/test_layout_api.py', () => {
    const r = room({ id: 'a', pos_x: 1.0625, pos_y: null, length: 4, width: 3.5, floor_number: 1, doors: 1, windows: 2, room_type: 'bedroom' })
    expect(planSignature({ length: 10, width: 8, floors: 1, height: 3, wall_thickness: 0.23 }, [r])).toBe('10000|8000|1|3000|230|a:1063:na:4000:3500:1:1:2:bedroom')
  })
  it('rounds half up like the Python side and is order independent', () => {
    expect(mm(0.0625)).toBe(63)
    expect(mm(2.0005)).toBe(2001)
    const a = room({ id: 'a' }), b = room({ id: 'b' })
    const p = { length: 10, width: 8, floors: 1, height: 3, wall_thickness: 0.23 }
    expect(planSignature(p, [a, b])).toBe(planSignature(p, [b, a]))
  })
  it('changes whenever geometry, openings counts or room types change', () => {
    const p = { length: 10, width: 8, floors: 1, height: 3, wall_thickness: 0.23 }
    const r = room({ id: 'a', pos_x: 0, pos_y: 0 })
    const base = planSignature(p, [r])
    expect(planSignature({ ...p, length: 10.5 }, [r])).not.toBe(base)
    expect(planSignature(p, [{ ...r, length: 4.5 }])).not.toBe(base)
    expect(planSignature(p, [{ ...r, doors: 2 }])).not.toBe(base)
    expect(planSignature(p, [{ ...r, room_type: 'living' }])).not.toBe(base)
  })
  it('room signature ignores doors/windows (furniture only depends on the room shape)', () => {
    const r = room({ id: 'a', pos_x: 0, pos_y: 0 })
    expect(roomSignature(room({ ...r, doors: 3 }))).toBe(roomSignature(r))
    expect(roomSignature({ ...r, width: 3.5 })).not.toBe(roomSignature(r))
  })
})

describe('layout (de)serialisation', () => {
  it('round-trips a saved layout through JSON', () => {
    const l = makeLayout({
      signature: 'x', settings: { autoFurnish: true }, openings: [{ id: 'o1', kind: 'door', floor: 1, orientation: 'x', line: 4, center: 2, width: 0.9, height: 2.1, sill: 0, room_id: 'r', into: 1 }],
      furniture: { items: [{ id: 'f', room_id: 'r', type: 'sofa', cx: 1, cz: 1, w: 2, d: 0.9, facing: 'N' }], room_sigs: { r: 's' } }, summary: { doors: [{ w: 0.9, h: 2.1, exterior: false }], windows: [] },
    })
    expect(parseLayout(JSON.parse(JSON.stringify(l)))).toEqual(l)
  })
  it('rejects junk and tolerates automatic (null) parts', () => {
    expect(parseLayout(null)).toBeNull()
    expect(parseLayout({ version: 2, signature: 'x' })).toBeNull()
    expect(parseLayout({ version: 1, signature: 'x' })).toMatchObject({ openings: null, furniture: null })
  })
})
