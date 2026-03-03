# Plan: 3D Tokamak Port View

## Goal
Replace the simple radial-gradient `PlasmaGlow` with a realistic Canvas 2D-based 3D port view showing the plasma LCFS (last closed flux surface) as a glowing translucent torus, viewed through a diagnostic port.

## Approach: Canvas 2D + Manual 3D Projection (No Three.js)

We'll create a new `PortView` component that uses the HTML5 Canvas 2D API with manual perspective projection math to render a 3D toroidal surface from the LCFS contour data.

### Architecture

**New file:** `web/src/components/PortView.tsx`
- Canvas-based component receiving `Snapshot` (or `null`)
- Takes the `separatrix.points` (R,Z) array and sweeps it toroidally
- Projects into 2D with perspective, renders with glow effects

**Modified file:** `web/src/pages/ControlRoom.tsx`
- Replace `<PlasmaGlow>` with `<PortView>`
- Pass `snapshot` (or `null` when scrubbing, keeping current behavior)

### 3D Geometry & Projection

**Coordinate system:**
- Tokamak coordinates: (R, φ, Z) where R = major radius direction, φ = toroidal angle, Z = vertical
- Cartesian: X = R·cos(φ), Y = R·sin(φ), Z = Z
- Camera is outside the torus, looking roughly tangentially through a port

**Toroidal sweep:**
1. Take the LCFS contour (100-300 (R,Z) points in meters)
2. Sweep through ~20-30 toroidal slices over φ ∈ [-45°, +45°] (one quarter-sector)
3. For each slice, compute 3D coordinates of every LCFS point
4. Apply perspective projection from camera position

**Camera setup:**
- Camera at (R_cam, φ_cam, Z_cam) ≈ (3.5m, 0°, 0m) — outside torus looking inward
- Look-at: torus center (0, 0, 0) or slightly offset
- FOV ~60°, standard pinhole camera model

**Projection math (per-point):**
```
// World → Camera transform
dx = x - cam.x, dy = y - cam.y, dz = z - cam.z
// Rotate into camera frame (pre-compute rotation matrix from camera orientation)
cx = dot(right, [dx,dy,dz])
cy = dot(up, [dx,dy,dz])
cz = dot(forward, [dx,dy,dz])
// Perspective divide
sx = focal * cx / cz
sy = focal * cy / cz
```

### Rendering Strategy

**Per frame:**
1. Clear canvas (dark background #0a0e17)
2. Draw the **central solenoid** column (dark gray trapezoid/cylinder on the left) — simple 2D shape projected from two circles at Z=±1.5m, R≈0.3m
3. Draw the **toroidal LCFS surface** as a series of glowing polyline slices:
   - For each toroidal angle φ, draw the LCFS cross-section projected to screen
   - Farther slices are dimmer (depth-based alpha)
   - Use `globalCompositeOperation: 'lighter'` for additive glow blending
   - Line color: warm cyan-white (#aaeeff) at moderate alpha
   - Multiple passes at slightly different line widths for bloom effect
4. Draw the **X-point / divertor legs** more brightly (they emit strongly in visible light)
5. If **ELM active**: boost all alpha values and add a bright flash overlay (white bloom)
6. If **disrupted**: red flash, then fade to dark

**Depth sorting:**
- Render toroidal slices back-to-front (painter's algorithm)
- Far slices: thinner lines, lower alpha
- Near slices: thicker lines, higher alpha

**Glow effect (no WebGL needed):**
- Draw each slice polyline 3 times:
  1. Wide (4-6px), very low alpha — outer glow
  2. Medium (2-3px), medium alpha — core glow
  3. Thin (1px), high alpha — bright center
- Use `globalCompositeOperation: 'lighter'` so overlapping slices brighten naturally
- Optional: apply `ctx.filter = 'blur(2px)'` for first pass

### Data Flow

```
Snapshot.separatrix.points → [(R₁,Z₁), (R₂,Z₂), ...]
  ↓ toroidal sweep (φ = -45° to +45°, ~25 slices)
  ↓ 3D coordinates: (R·cosφ, R·sinφ, Z) per point per slice
  ↓ camera transform + perspective projection → screen (sx, sy) per point
  ↓ depth-based alpha + line width
  ↓ canvas 2D stroke calls with additive blending
```

### Performance Considerations

- **LCFS points**: ~200 points × 25 slices = 5,000 projected points per frame
- **Projection**: Simple matrix multiply — trivially fast
- **Canvas draw calls**: 25 slices × 3 glow passes = 75 `stroke()` calls
- Pre-compute camera rotation matrix once (static camera)
- **Target**: <2ms per frame — well within 60fps budget

### ELM Flashing

When `snapshot.elm_active === true`:
- Multiply all line alpha values by 2-3x (clamped)
- Add a bright white/cyan overlay pulse
- Slightly increase line widths
- This creates the characteristic "flash" seen in real tokamak cameras during ELMs

### Central Solenoid

- Simple dark column on the left side of the port view
- Project two circles (top/bottom of solenoid) at R≈0.3m, Z=±1.2m
- Fill with dark gray (#1a1a2e) — partially occluding the far-side plasma

### "No Plasma" State

When `snapshot === null`:
- Draw the port frame (dark circle border)
- Draw the solenoid column
- Show "No plasma" text
- This provides the "empty vessel" look

### Implementation Steps

1. **Create `PortView.tsx`** with canvas setup, resize handling, and the core rendering loop
2. **Implement 3D projection** — camera class with `project(x,y,z) → (sx,sy,depth)`
3. **Implement toroidal sweep** — generate 3D points from LCFS contour
4. **Render glowing LCFS slices** with depth-sorted additive blending
5. **Add central solenoid** rendering
6. **Add X-point/divertor brightness** enhancement
7. **Add ELM flash** effect
8. **Integrate into ControlRoom.tsx** — replace `<PlasmaGlow>` with `<PortView>`
9. **Test and tune** — adjust camera position, glow parameters, ELM flash intensity
