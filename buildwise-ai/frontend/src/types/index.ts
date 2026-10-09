export interface User { id: string; email: string; full_name: string }

export type EstimateKey =
  | 'cement' | 'sand' | 'aggregates' | 'steel' | 'concrete' | 'bricks' | 'blocks'
  | 'mortar' | 'plaster' | 'tiles' | 'paint'

export interface Room {
  id: string
  project_id: string
  name: string
  room_type: string
  length: number
  width: number
  height: number
  floor_number: number
  wall_thickness: number | null
  doors: number
  windows: number
  area_override: number | null
  pos_x: number | null
  pos_y: number | null
  area: number
}
export type RoomInput = Omit<Room, 'id' | 'project_id' | 'area'>

export interface FloorPlan {
  id: string
  project_id: string
  original_name: string
  content_type: string
  size_bytes: number
  width_px: number | null
  height_px: number | null
  scale_m_per_px: number | null
  calibration: Record<string, number> | null
  created_at: string
}

export interface ProjectBase {
  name: string
  description: string
  owner_name: string
  building_type: string
  location: string
  floors: number
  currency: string
  budget: number | null
  length: number
  width: number
  height: number
  wall_thickness: number
  slab_thickness: number
  built_up_area: number | null
}
export interface Project extends ProjectBase {
  id: string
  is_demo: boolean
  created_at: string
  updated_at: string
  assumptions: Record<string, unknown>
  wastage: Record<string, number>
  material_selections: Record<string, string>
  extra_costs: Record<string, ExtraCostConfig>
  purchase_quantities: Record<string, number>
  room_count: number
  floor_area: number
  total_built_up_area: number
  latest_total_cost: number | null
  has_estimate: boolean
}
export interface ProjectDetail extends Project { rooms: Room[]; floorplans: FloorPlan[] }
export interface ProjectCreate extends ProjectBase { rooms: RoomInput[] }

export interface ExtraCostConfig { enabled: boolean; mode: 'fixed' | 'percent'; value: number }

export interface Material {
  id: string
  estimate_key: EstimateKey
  name: string
  category: string
  brand: string
  grade: string
  specification: string
  durability_notes: string
  unit: string
  is_sample: boolean
  owner_id: string | null
  editable: boolean
  unit_price: number | null
  currency: string | null
  supplier: string
  location: string
  price_is_sample: boolean
  price_id: string | null
  last_updated: string | null
  created_at: string
}

export interface EstimateItem {
  key: EstimateKey
  name: string
  category: string
  unit: string
  net_quantity: number
  wastage_pct: number
  gross_quantity: number
  formula: string
  assumptions: string[]
  unit_price: number | null
  cost: number | null
  counts_toward_cost: boolean
  note: string
  material_id: string | null
  material_label: string | null
  price_is_sample: boolean
}
export interface ExtraCostResult { key: string; enabled: boolean; mode: string; value: number; amount: number; included: boolean }
export interface CostSummary {
  material_total: number
  by_category: { category: string; cost: number }[]
  extras: ExtraCostResult[]
  extras_total: number
  project_total: number
  cost_per_sqm: number | null
  cost_per_sqft: number | null
  budget: number | null
  budget_variance: number | null
  budget_used_pct: number | null
  missing_price_keys: string[]
  complete: boolean
}
export interface Recommendation {
  id: string
  title: string
  explanation: string
  material: string | null
  reason: string
  suggested_action: string
  potential_benefit: string
  potential_savings: number | null
  severity: 'info' | 'warning' | 'critical'
}
export interface Alternative { id: string; label: string; unit_price: number | null; is_sample: boolean }
export interface Estimate {
  id?: string
  project_id: string
  currency: string
  created_at?: string
  stale?: boolean
  persisted: boolean
  geometry: { floor_area: number; total_built_up_area: number; external_perimeter: number; internal_wall_length_per_floor: number }
  summary: CostSummary
  assumptions: Record<string, unknown>
  warnings: string[]
  items: EstimateItem[]
  recommendations: Recommendation[]
  alternatives?: Record<string, Alternative[]>
}
export interface Report { id: string; project_id: string; file_name: string; size_bytes: number; total_cost: number; currency: string; created_at: string }

export interface Dashboard {
  total_projects: number
  saved_estimates: number
  total_estimated_cost: number
  avg_cost_per_sqft: number | null
  has_demo_data: boolean
  recent_projects: Project[]
  recent_reports: Report[]
  cost_distribution: { category: string; cost: number }[]
  material_quantities: { name: string; unit: string; quantity: number }[]
}
