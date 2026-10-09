import { z } from 'zod'
import type { ProjectBase, RoomInput } from '@/types'

const num = (label: string) => z.number({ error: `${label}: enter a number` })
/** Blank optional number inputs arrive as NaN with valueAsNumber; treat as "not provided". */
export const blankToUndef = (v: unknown) => (v === '' || v == null || (typeof v === 'number' && Number.isNaN(v)) ? undefined : Number(v))

export const roomSchema = z.object({
  name: z.string().trim().min(1, 'Enter a room name').max(80),
  room_type: z.string().min(1),
  length: num('Length').positive('Must be greater than 0').max(100, 'Max 100 m'),
  width: num('Width').positive('Must be greater than 0').max(100, 'Max 100 m'),
  height: num('Height').min(2, 'Min 2 m').max(10, 'Max 10 m'),
  floor_number: num('Floor').int('Whole number').min(1, 'Floors start at 1').max(100),
  wall_thickness: z.number().positive('Must be greater than 0').max(1, 'Max 1 m').optional(),
  doors: num('Doors').int('Whole number').min(0).max(50),
  windows: num('Windows').int('Whole number').min(0).max(50),
  area_override: z.number().positive('Must be greater than 0').optional(),
  pos_x: z.number().min(0, 'Must be 0 or more').optional(),
  pos_y: z.number().min(0, 'Must be 0 or more').optional(),
})
export type RoomFormValues = z.infer<typeof roomSchema>

export const projectSchema = z.object({
  name: z.string().trim().min(1, 'Enter a project name').max(160),
  description: z.string().max(2000),
  owner_name: z.string().max(120),
  building_type: z.string().min(1),
  location: z.string().max(160),
  floors: num('Floors').int('Whole number').min(1, 'At least 1').max(50, 'Max 50'),
  currency: z.string().min(3, 'Select a currency'),
  budget: z.number().positive('Must be greater than 0').optional(),
  length: num('Length').positive('Must be greater than 0').max(500, 'Max 500 m'),
  width: num('Width').positive('Must be greater than 0').max(500, 'Max 500 m'),
  height: num('Floor height').min(2, 'Min 2 m').max(10, 'Max 10 m'),
  wall_thickness: num('Wall thickness').min(0.05, 'Min 0.05 m').max(1, 'Max 1 m'),
  slab_thickness: num('Slab thickness').min(0.08, 'Min 0.08 m').max(0.6, 'Max 0.6 m'),
  built_up_area: z.number().positive('Must be greater than 0').optional(),
})
export type ProjectFormValues = z.infer<typeof projectSchema>

export const projectDefaults: ProjectFormValues = {
  name: '', description: '', owner_name: '', building_type: 'residential', location: '', floors: 1, currency: 'INR',
  budget: undefined, length: 10, width: 8, height: 3, wall_thickness: 0.23, slab_thickness: 0.15, built_up_area: undefined,
}

export const roomDefaults: RoomFormValues = {
  name: '', room_type: 'bedroom', length: 4, width: 3, height: 3, floor_number: 1, wall_thickness: undefined, doors: 1, windows: 1,
  area_override: undefined, pos_x: undefined, pos_y: undefined,
}

export const toRoomInput = (v: RoomFormValues): RoomInput => ({
  name: v.name.trim(), room_type: v.room_type, length: v.length, width: v.width, height: v.height, floor_number: v.floor_number,
  wall_thickness: v.wall_thickness ?? null, doors: v.doors, windows: v.windows, area_override: v.area_override ?? null,
  pos_x: v.pos_x ?? null, pos_y: v.pos_y ?? null,
})
export const toProjectBase = (v: ProjectFormValues): ProjectBase => ({
  ...v, name: v.name.trim(), budget: v.budget ?? null, built_up_area: v.built_up_area ?? null,
})
