import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Label } from './Label'
import { floorKind, getTextures, PALETTE } from './materials'
import { itemRect } from './furniture'
import type { Box, FloorModel, Model3D, Opening, RoomBox, Side } from './model'

export type ViewMode = 'exterior' | 'top'
export interface ViewerOptions {
  view: ViewMode
  floor: 'all' | number
  showLabels: boolean
  showRoof: boolean
  showFurniture: boolean
  showWalls: boolean
  showOpenings: boolean
  doorsOpen: boolean
  wireframe: boolean
  resetNonce: number
}

/** Merge axis-aligned boxes into one geometry (one draw call, no per-box overhead). */
function boxesGeometry(boxes: Box[]): THREE.BufferGeometry | null {
  if (!boxes.length) return null
  const geos = boxes.map((b) => {
    const g = new THREE.BoxGeometry(b.sx, b.sy, b.sz)
    g.translate(b.cx, b.cy, b.cz)
    return g
  })
  const merged = mergeGeometries(geos, false)
  geos.forEach((g) => g.dispose())
  return merged
}

function useBoxesGeometry(boxes: Box[]) {
  const geo = useMemo(() => boxesGeometry(boxes), [boxes])
  useEffect(() => () => { geo?.dispose() }, [geo])
  return geo
}

// ---------------------------------------------------------------------------------------------------------------
// camera

const AZIMUTH = (40 * Math.PI) / 180
const ELEVATION = (36 * Math.PI) / 180

/** Frames the whole building: isometric architectural view, or straight-down plan view. Never crops walls. */
function CameraRig({ model, view, nonce }: { model: Model3D; view: ViewMode; nonce: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null

  useEffect(() => {
    if (!size.width || !size.height) return
    const { length: L, width: W, totalHeight: Ht, slab } = model
    const top = view === 'top'
    const target = new THREE.Vector3(0, top ? 0 : Ht * 0.4, 0)
    const dir = top
      ? new THREE.Vector3(0, 1, 0.0001).normalize()
      : new THREE.Vector3(Math.sin(AZIMUTH) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(AZIMUTH) * Math.cos(ELEVATION))
    const pad = 0.5
    const corners: THREE.Vector3[] = []
    for (const x of [-L / 2 - pad, L / 2 + pad]) for (const y of [-slab, top ? 0.2 : Ht + 0.2]) for (const z of [-W / 2 - pad, W / 2 + pad]) corners.push(new THREE.Vector3(x, y, z))
    camera.aspect = size.width / size.height
    camera.updateProjectionMatrix()
    let dist = Math.max(L, W, Ht) * 2.2
    for (let i = 0; i < 8; i++) {
      camera.position.copy(target).addScaledVector(dir, dist)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      let m = 0
      for (const c of corners) { const v = c.clone().project(camera); m = Math.max(m, Math.abs(v.x), Math.abs(v.y)) }
      dist *= Math.max(0.2, m / 0.88)
    }
    controls?.target.copy(target)
    controls?.update()
  }, [camera, controls, size.width, size.height, model.length, model.width, model.totalHeight, model.slab, view, nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** Dollhouse cutaway: the exterior walls facing the camera are lowered so the interior stays visible. */
function CutawayTracker({ onChange }: { onChange: (sides: Side[]) => void }) {
  const state = useRef({ x: 1, z: 1 })
  const last = useRef('')
  useFrame(({ camera }) => {
    if (Math.abs(camera.position.x) > 0.5) state.current.x = Math.sign(camera.position.x)
    if (Math.abs(camera.position.z) > 0.5) state.current.z = Math.sign(camera.position.z)
    const key = `${state.current.x > 0 ? 'E' : 'W'}${state.current.z > 0 ? 'S' : 'N'}`
    if (key !== last.current) { last.current = key; onChange([key[0] as Side, key[1] as Side]) }
  })
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// floor

function floorGeometry(sx: number, sz: number, unit: number) {
  const g = new THREE.PlaneGeometry(sx, sz)
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * sx) / unit, (uv.getY(i) * sz) / unit)
  return g
}

function RoomFloor({ r, mat, geo }: { r: RoomBox; mat: THREE.Material; geo: THREE.BufferGeometry }) {
  return <mesh geometry={geo} material={mat} position={[r.cx, r.y + 0.012, r.cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow />
}

function DoorLeaf({ o, y, wireframe, open }: { o: Opening; y: number; wireframe: boolean; open: boolean }) {
  const hinge = o.center - o.width / 2
  const angle = open ? ((o.orientation === 'x' ? -o.into : o.into) * 75 * Math.PI) / 180 : 0
  const pos: [number, number, number] = o.orientation === 'x' ? [hinge, y, o.line] : [o.line, y, hinge]
  const size: [number, number, number] = o.orientation === 'x' ? [o.width - 0.04, o.height - 0.03, 0.04] : [0.04, o.height - 0.03, o.width - 0.04]
  const offset: [number, number, number] = o.orientation === 'x' ? [(o.width - 0.04) / 2, (o.height - 0.03) / 2, 0] : [0, (o.height - 0.03) / 2, (o.width - 0.04) / 2]
  return (
    <group position={pos} rotation={[0, angle, 0]}>
      <mesh position={offset} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={PALETTE.door} roughness={0.6} wireframe={wireframe} />
      </mesh>
    </group>
  )
}

/** Frames (doors + windows) as merged boxes, glass as one thin translucent pane per window. */
function openingParts(openings: Opening[], y: number): { frames: Box[]; glass: Box[] } {
  const frames: Box[] = [], glass: Box[] = []
  const fw = 0.05
  for (const o of openings) {
    const th = Math.min(o.thickness, 0.3) + 0.02
    const y0 = y + o.sill, y1 = y0 + o.height
    const at = (a0: number, a1: number, ya: number, yb: number, t: number): Box =>
      o.orientation === 'x'
        ? { cx: (a0 + a1) / 2, cy: (ya + yb) / 2, cz: o.line, sx: a1 - a0, sy: yb - ya, sz: t }
        : { cx: o.line, cy: (ya + yb) / 2, cz: (a0 + a1) / 2, sx: t, sy: yb - ya, sz: a1 - a0 }
    const s = o.center - o.width / 2, e = o.center + o.width / 2
    frames.push(at(s, s + fw, y0, y1, th), at(e - fw, e, y0, y1, th), at(s, e, y1 - fw, y1, th))
    if (o.kind === 'window') {
      frames.push(at(s, e, y0, y0 + fw, th))
      glass.push(at(s + fw, e - fw, y0 + fw, y1 - fw, 0.02))
    }
  }
  return { frames, glass }
}

function Floor({ f, model, opts, cut, selectedId, selectedFurnitureId, selectedOpeningId, hoverId, onSelect, onHover, labelsOn }: {
  f: FloorModel; model: Model3D; opts: ViewerOptions; cut: Side[] | null
  selectedId: string | null; selectedFurnitureId: string | null; selectedOpeningId: string | null; hoverId: string | null; onSelect: (id: string | null) => void; onHover: (id: string | null) => void; labelsOn: boolean
}) {
  const wf = opts.wireframe
  const { slab, length: L, width: W, wallT } = model
  const tex = useMemo(() => getTextures(), [])

  const wallBoxes = useMemo(() => f.walls.flatMap((w) => (w.exterior && cut && w.side && cut.includes(w.side) ? w.cutPieces : w.pieces)), [f.walls, cut])
  const wallGeo = useBoxesGeometry(wallBoxes)
  const { frames, glass } = useMemo(() => {
    // when a side is cut away its openings are not built, so skip their frames/glass too
    const visible = f.openings.filter((o) => {
      const w = f.walls.find((x) => x.id === o.wallId)
      return !(w && w.exterior && cut && w.side && cut.includes(w.side))
    })
    return openingParts(visible, f.y)
  }, [f.openings, f.walls, f.y, cut])
  const frameGeo = useBoxesGeometry(frames)
  const glassGeo = useBoxesGeometry(glass)
  const doors = useMemo(() => f.openings.filter((o) => o.kind === 'door'), [f.openings])

  const furnitureGeos = useMemo(() => {
    const groups = new Map<string, Box[]>()
    for (const p of f.furniture) {
      const arr = groups.get(p.color) ?? []
      arr.push(p)
      groups.set(p.color, arr)
    }
    return [...groups].map(([color, boxes]) => ({ color, geo: boxesGeometry(boxes) }))
  }, [f.furniture])
  useEffect(() => () => furnitureGeos.forEach((g) => g.geo?.dispose()), [furnitureGeos])

  const floorGeos = useMemo(() => f.rooms.map((r) => ({ id: r.id, geo: floorGeometry(r.sx, r.sz, floorKind(r.type) === 'tile' ? 0.6 : floorKind(r.type) === 'wood' ? 1.0 : 1.2) })), [f.rooms])
  useEffect(() => () => floorGeos.forEach((g) => g.geo.dispose()), [floorGeos])

  const mats = useMemo(() => ({
    wood: new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.7, wireframe: wf }),
    tile: new THREE.MeshStandardMaterial({ map: tex.tile, roughness: 0.35, wireframe: wf }),
    concrete: new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.9, wireframe: wf }),
  }), [tex, wf])
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])

  return (
    <group>
      <mesh position={[0, f.slabY, 0]} castShadow receiveShadow>
        <boxGeometry args={[L + wallT, slab, W + wallT]} />
        <meshStandardMaterial color={PALETTE.slab} roughness={0.95} wireframe={wf} />
      </mesh>

      {f.rooms.map((r) => { const g = floorGeos.find((x) => x.id === r.id)!; return <RoomFloor key={r.id} r={r} mat={mats[floorKind(r.type)]} geo={g.geo} /> })}

      {wallGeo && opts.showWalls && (
        <mesh geometry={wallGeo} castShadow receiveShadow>
          <meshStandardMaterial color={PALETTE.wall} roughness={0.92} wireframe={wf} />
        </mesh>
      )}
      {opts.showOpenings && frameGeo && <mesh geometry={frameGeo} castShadow><meshStandardMaterial color={PALETTE.frame} roughness={0.6} wireframe={wf} /></mesh>}
      {opts.showOpenings && glassGeo && <mesh geometry={glassGeo}><meshStandardMaterial color={PALETTE.glass} transparent opacity={wf ? 1 : 0.35} roughness={0.05} metalness={0.2} depthWrite={false} wireframe={wf} /></mesh>}
      {opts.showOpenings && doors.filter((o) => {
        const w = f.walls.find((x) => x.id === o.wallId)
        return !(w && w.exterior && cut && w.side && cut.includes(w.side))
      }).map((o) => <DoorLeaf key={o.id} o={o} y={f.y} wireframe={wf} open={opts.doorsOpen} />)}
      <Highlights f={f} furnitureId={selectedFurnitureId} openingId={selectedOpeningId} />

      {opts.showFurniture && furnitureGeos.map(({ color, geo }) => geo && (
        <mesh key={color} geometry={geo} castShadow receiveShadow><meshStandardMaterial color={color} roughness={0.75} wireframe={wf} /></mesh>
      ))}

      {f.rooms.map((r: RoomBox) => {
        const sel = r.id === selectedId, hov = r.id === hoverId
        const outline: [number, number, number][] = [[r.x0, r.y + 0.05, r.z0], [r.x1, r.y + 0.05, r.z0], [r.x1, r.y + 0.05, r.z1], [r.x0, r.y + 0.05, r.z1], [r.x0, r.y + 0.05, r.z0]]
        return (
          <group key={r.id}>
            {/* invisible pick volume: clicking anywhere in the room selects it */}
            <mesh position={[r.cx, r.y + r.h / 2, r.cz]}
              onClick={(e) => { e.stopPropagation(); onSelect(sel ? null : r.id) }}
              onPointerOver={(e) => { e.stopPropagation(); onHover(r.id); document.body.style.cursor = 'pointer' }}
              onPointerOut={() => { onHover(null); document.body.style.cursor = '' }}>
              <boxGeometry args={[Math.max(r.sx - 0.1, 0.1), r.h - 0.05, Math.max(r.sz - 0.1, 0.1)]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {(sel || hov) && (
              <mesh position={[r.cx, r.y + 0.03, r.cz]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[r.sx, r.sz]} />
                <meshBasicMaterial color={sel ? PALETTE.highlight : PALETTE.hover} transparent opacity={sel ? 0.4 : 0.18} depthWrite={false} />
              </mesh>
            )}
            {sel && <Line points={outline} color="#c2410c" lineWidth={3} />}
            {(labelsOn || sel) && (
              <Label text={r.name} sub={r.sx >= 2.6 ? `${r.area.toFixed(1)} m²` : undefined} active={sel} size={model.labelSize}
                maxWidth={r.sx * 0.92} position={[r.cx, r.y + (opts.view === 'top' ? 0.2 : 0.5), r.cz]} />
            )}
          </group>
        )
      })}
      {f.index === 1 && <Dimensions L={L} W={W} size={model.labelSize * 0.75} />}
    </group>
  )
}

/** Orange outlines around the selected furniture piece / opening (works for pieces that are merged into one mesh). */
function Highlights({ f, furnitureId, openingId }: { f: FloorModel; furnitureId: string | null; openingId: string | null }) {
  const out: React.ReactNode[] = []
  const box = (key: string, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
    const pts: [number, number, number][] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [x0, y1, z0]]
    out.push(<Line key={key} points={pts} color="#ea580c" lineWidth={3} />)
    out.push(<Line key={key + 'a'} points={[[x1, y0, z0], [x1, y1, z0]]} color="#ea580c" lineWidth={3} />, <Line key={key + 'b'} points={[[x1, y0, z1], [x1, y1, z1]]} color="#ea580c" lineWidth={3} />, <Line key={key + 'c'} points={[[x0, y0, z1], [x0, y1, z1]]} color="#ea580c" lineWidth={3} />)
  }
  const it = furnitureId ? f.furnitureItems.find((i) => i.id === furnitureId) : null
  if (it) {
    const r = itemRect(it)
    const parts = f.furniture.filter((p) => p.itemId === it.id)
    const top = parts.reduce((m, p) => Math.max(m, p.cy + p.sy / 2), f.y + 0.1) - f.y
    box('fi', r.x0, r.x1, r.z0, r.z1, f.y + 0.02, f.y + Math.max(top, 0.1))
  }
  const o = openingId ? f.openings.find((x) => x.id === openingId) : null
  if (o) {
    const lo = o.center - o.width / 2, hi = o.center + o.width / 2, t = o.thickness / 2 + 0.03
    if (o.orientation === 'x') box('op', lo, hi, o.line - t, o.line + t, f.y + o.sill, f.y + o.sill + o.height)
    else box('op', o.line - t, o.line + t, lo, hi, f.y + o.sill, f.y + o.sill + o.height)
  }
  return <>{out}</>
}

function Dimensions({ L, W, size }: { L: number; W: number; size: number }) {
  return (
    <>
      <Label dark text={`Length ${L} m`} position={[0, 0.05, W / 2 + 1.1 + size]} size={size} />
      <Label dark text={`Width ${W} m`} position={[L / 2 + 1.6 + size, 0.05, 0]} size={size} />
    </>
  )
}

/** Gable roof (flat ceiling slab + pitched roof). Optional: hidden in the dollhouse / plan views. */
function Roof({ model, wireframe }: { model: Model3D; wireframe: boolean }) {
  const { length: L, width: W, totalHeight, slab, roof } = model
  const o = roof.overhang
  const alongX = roof.ridge === 'x'
  const base = alongX ? W + 2 * o : L + 2 * o
  const depth = alongX ? L + 2 * o : W + 2 * o
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-base / 2, 0); s.lineTo(base / 2, 0); s.lineTo(0, roof.height); s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false })
    g.translate(0, 0, -depth / 2)
    return g
  }, [base, depth, roof.height])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <group>
      <mesh position={[0, model.roofY, 0]} castShadow receiveShadow>
        <boxGeometry args={[L + model.wallT + 2 * o, slab, W + model.wallT + 2 * o]} />
        <meshStandardMaterial color={PALETTE.slab} roughness={0.95} wireframe={wireframe} />
      </mesh>
      <mesh geometry={geo} position={[0, totalHeight + slab, 0]} rotation={[0, alongX ? Math.PI / 2 : 0, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={PALETTE.roof} roughness={0.85} wireframe={wireframe} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------------

export function BuildingViewer({ model, opts, selectedId, selectedFurnitureId = null, selectedOpeningId = null, onSelect }: {
  model: Model3D; opts: ViewerOptions; selectedId: string | null; selectedFurnitureId?: string | null; selectedOpeningId?: string | null; onSelect: (id: string | null) => void
}) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [cutSides, setCutSides] = useState<Side[]>(['E', 'S'])
  const topIndex = model.floors.length
  const visible = useMemo(() => {
    if (opts.view === 'top' && opts.floor === 'all') return model.floors.filter((f) => f.index === 1)
    if (opts.floor === 'all') return model.floors
    return model.floors.filter((f) => f.index === opts.floor)
  }, [model.floors, opts.floor, opts.view])
  const roofVisible = opts.showRoof && opts.view !== 'top' && (opts.floor === 'all' || opts.floor === topIndex)
  const cutaway = opts.view === 'exterior' && !roofVisible
  const labelFloor = Math.max(...visible.map((f) => f.index))
  const size = Math.max(model.length, model.width, model.totalHeight)
  const shadowR = Math.hypot(model.length, model.width) * 0.75 + 2

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 35, near: 0.1, far: 3000, position: [20, 15, 20] }} onPointerMissed={() => onSelect(null)}
      gl={{ antialias: true }} style={{ background: 'linear-gradient(#e9eff6,#f8fafc)' }}>
      <hemisphereLight args={['#ffffff', '#cfc9bf', 0.7]} />
      <ambientLight intensity={0.2} />
      <directionalLight castShadow position={[size * 0.9, size * 1.5, size * 0.6]} intensity={1.7}
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-shadowR} shadow-camera-right={shadowR} shadow-camera-top={shadowR} shadow-camera-bottom={-shadowR}
        shadow-camera-near={0.5} shadow-camera-far={size * 6} />
      <directionalLight position={[-size, size * 0.8, -size * 0.6]} intensity={0.35} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -model.slab - 0.03, 0]} receiveShadow>
        <planeGeometry args={[size * 8, size * 8]} />
        <meshStandardMaterial color={PALETTE.ground} roughness={1} />
      </mesh>
      <gridHelper args={[Math.max(60, size * 3), Math.max(60, size * 3), '#c4ccd6', '#d7dde5']} position={[0, -model.slab - 0.02, 0]} />

      {visible.map((f) => (
        <Floor key={f.index} f={f} model={model} opts={opts} cut={cutaway ? cutSides : null} selectedId={selectedId} selectedFurnitureId={selectedFurnitureId} selectedOpeningId={selectedOpeningId} hoverId={hoverId}
          onSelect={onSelect} onHover={setHoverId} labelsOn={opts.showLabels && !roofVisible && f.index === labelFloor} />
      ))}
      {roofVisible && <Roof model={model} wireframe={opts.wireframe} />}

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} minDistance={2} maxDistance={size * 10} maxPolarAngle={Math.PI / 2 - 0.02} />
      <CameraRig model={model} view={opts.view} nonce={opts.resetNonce} />
      <CutawayTracker onChange={setCutSides} />
    </Canvas>
  )
}
