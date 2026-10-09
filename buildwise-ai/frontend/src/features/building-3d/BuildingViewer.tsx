import { Edges, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { Label } from './Label'
import type { FloorModel, Model3D, RoomBox } from './model'

export type ViewMode = 'exterior' | 'top'
export interface ViewerOptions {
  view: ViewMode
  floor: 'all' | number
  showLabels: boolean
  showRoof: boolean
  wireframe: boolean
  resetNonce: number
}

const TYPE_COLOR: Record<string, string> = {
  living: '#60a5fa', bedroom: '#a78bfa', kitchen: '#fbbf24', bathroom: '#2dd4bf', dining: '#fb7185', study: '#34d399',
  store: '#94a3b8', balcony: '#a3e635', corridor: '#cbd5e1', staircase: '#f472b6', office: '#38bdf8', other: '#94a3b8',
}

function CameraRig({ model, view, nonce }: { model: Model3D; view: ViewMode; nonce: number }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null
  useEffect(() => {
    const size = Math.max(model.length, model.width, model.totalHeight)
    const cy = model.totalHeight / 2
    if (view === 'top') camera.position.set(0, Math.max(size * 1.7, model.totalHeight + 6), 0.001)
    else camera.position.set(size * 1.15, cy + size * 0.8, size * 1.35)
    controls?.target.set(0, view === 'top' ? 0 : cy, 0)
    camera.lookAt(0, view === 'top' ? 0 : cy, 0)
    controls?.update()
  }, [camera, controls, model.length, model.width, model.totalHeight, view, nonce])
  return null
}

function Floor({ f, model, opts, selectedId, hoverId, onSelect, onHover }: {
  f: FloorModel; model: Model3D; opts: ViewerOptions; selectedId: string | null; hoverId: string | null
  onSelect: (id: string | null) => void; onHover: (id: string | null) => void
}) {
  const { length: L, width: W, slab } = model
  const wf = opts.wireframe
  return (
    <group>
      {/* slab */}
      <mesh position={[0, f.slabY, 0]}>
        <boxGeometry args={[L + model.wallT, slab, W + model.wallT]} />
        <meshStandardMaterial color="#94a3b8" wireframe={wf} />
      </mesh>
      {/* walls */}
      {f.walls.map((w, i) => {
        const dx = w.x2 - w.x1, dz = w.z2 - w.z1
        const len = Math.hypot(dx, dz)
        const alongX = Math.abs(dz) < 1e-6
        return (
          <mesh key={i} position={[(w.x1 + w.x2) / 2, w.y + w.h / 2, (w.z1 + w.z2) / 2]}>
            <boxGeometry args={alongX ? [len + (w.exterior ? w.t : 0), w.h, w.t] : [w.t, w.h, len + (w.exterior ? w.t : 0)]} />
            <meshStandardMaterial color={w.exterior ? '#eef2f7' : '#d5dde8'} wireframe={wf} />
          </mesh>
        )
      })}
      {/* doors & windows (markers over the wall surface) */}
      {f.openings.map((o, i) => (
        <mesh key={`o${i}`} position={[o.x, o.y + o.h / 2, o.z]}>
          <boxGeometry args={o.alongX ? [o.w, o.h, o.t] : [o.t, o.h, o.w]} />
          <meshStandardMaterial color={o.kind === 'door' ? '#8b5a2b' : '#7dd3fc'} transparent={o.kind === 'window'} opacity={o.kind === 'window' ? 0.7 : 1} wireframe={wf} />
        </mesh>
      ))}
      {/* room volumes: clickable, highlighted when selected */}
      {f.rooms.map((r: RoomBox) => {
        const sel = r.id === selectedId, hov = r.id === hoverId
        return (
          <group key={r.id}>
            <mesh position={[r.cx, r.y + r.h / 2, r.cz]}
              onClick={(e) => { e.stopPropagation(); onSelect(sel ? null : r.id) }}
              onPointerOver={(e) => { e.stopPropagation(); onHover(r.id); document.body.style.cursor = 'pointer' }}
              onPointerOut={() => { onHover(null); document.body.style.cursor = '' }}>
              <boxGeometry args={[r.sx - 0.06, r.h - 0.02, r.sz - 0.06]} />
              <meshStandardMaterial color={sel ? '#f97316' : TYPE_COLOR[r.type] ?? '#94a3b8'} transparent opacity={sel ? 0.5 : hov ? 0.3 : 0.14} depthWrite={false} />
              {sel && <Edges color="#c2410c" />}
            </mesh>
            {opts.showLabels && (
              <Label text={r.name} sub={`${r.area.toFixed(1)} m²`} active={sel} size={model.labelSize}
                position={[r.cx, r.y + (opts.view === 'top' ? 0.2 : Math.min(r.h * 0.5, 1.5)), r.cz]} />
            )}
          </group>
        )
      })}
      {/* ground-level dimension helpers drawn once, on the lowest visible floor */}
      {f.index === 1 && <Dimensions L={L} W={W} size={model.labelSize * 0.75} />}
    </group>
  )
}

function Dimensions({ L, W, size }: { L: number; W: number; size: number }) {
  return (
    <>
      <Label dark text={`Length ${L} m`} position={[0, 0.05, W / 2 + 1.1 + size]} size={size} />
      <Label dark text={`Width ${W} m`} position={[L / 2 + 1.6 + size, 0.05, 0]} size={size} />
    </>
  )
}

export function BuildingViewer({ model, opts, selectedId, onSelect }: {
  model: Model3D; opts: ViewerOptions; selectedId: string | null; onSelect: (id: string | null) => void
}) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const topIndex = model.floors.length
  const visible = useMemo(() => {
    if (opts.view === 'top' && opts.floor === 'all') return model.floors.filter((f) => f.index === 1)
    if (opts.floor === 'all') return model.floors
    return model.floors.filter((f) => f.index === opts.floor)
  }, [model.floors, opts.floor, opts.view])
  const roofVisible = opts.showRoof && opts.view !== 'top' && (opts.floor === 'all' || opts.floor === topIndex)
  const size = Math.max(model.length, model.width)

  return (
    <Canvas dpr={[1, 2]} camera={{ fov: 45, near: 0.1, far: 2000, position: [20, 15, 20] }} onPointerMissed={() => onSelect(null)}
      gl={{ antialias: true }} style={{ background: 'linear-gradient(#e8eef6,#f8fafc)' }}>
      <hemisphereLight args={['#ffffff', '#94a3b8', 0.9]} />
      <directionalLight position={[size, size * 1.5, size * 0.8]} intensity={1.1} />
      <directionalLight position={[-size, size, -size]} intensity={0.35} />
      <gridHelper args={[Math.max(60, size * 3), Math.max(60, size * 3) / 2, '#94a3b8', '#cbd5e1']} position={[0, -model.slab - 0.01, 0]} />
      {visible.map((f) => (
        <Floor key={f.index} f={f} model={model} opts={opts} selectedId={selectedId} hoverId={hoverId} onSelect={onSelect} onHover={setHoverId} />
      ))}
      {roofVisible && (
        <mesh position={[0, model.roofY, 0]}>
          <boxGeometry args={[model.length + model.wallT + 0.2, model.slab, model.width + model.wallT + 0.2]} />
          <meshStandardMaterial color="#475569" wireframe={opts.wireframe} />
        </mesh>
      )}
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={2} maxDistance={400} maxPolarAngle={Math.PI / 2 - 0.02} />
      <CameraRig model={model} view={opts.view} nonce={opts.resetNonce} />
    </Canvas>
  )
}
