# Tok-Sym Architecture Guide

A comprehensive reference for the Tok-Sym fusion simulator codebase. This document
covers every directory, file, module, and major function in the project.

**Codebase size:** ~5,500 lines Rust + ~11,600 lines TypeScript/React

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Repository Structure](#repository-structure)
3. [Build System](#build-system)
4. [Rust Physics Engine](#rust-physics-engine)
   - [equilibrium.rs — Grad-Shafranov Solver](#equilibriumrs--grad-shafranov-solver)
   - [transport.rs — 0D Power Balance](#transportrs--0d-power-balance)
   - [profiles.rs — Radial Profile Model](#profilesrs--radial-profile-model)
   - [devices.rs — Tokamak Definitions](#devicesrs--tokamak-definitions)
   - [disruption.rs — Disruption Model](#disruptionrs--disruption-model)
   - [diagnostics.rs — Synthetic Diagnostics](#diagnosticsrs--synthetic-diagnostics)
   - [contour.rs — Flux Surface Extraction](#contourrs--flux-surface-extraction)
   - [simulation.rs — Orchestrator](#simulationrs--orchestrator)
   - [wasm_api.rs — WASM Boundary](#wasm_apirs--wasm-boundary)
5. [WASM Boundary Layer](#wasm-boundary-layer)
6. [TypeScript Library Layer](#typescript-library-layer)
   - [wasm.ts — WASM Initialization](#wasmts--wasm-initialization)
   - [types.ts — Interface Definitions](#typests--interface-definitions)
   - [useSimulation.ts — Core React Hook](#usesimulationts--core-react-hook)
   - [fusionPhysics.ts — Client-Side Physics](#fusionphysicsts--client-side-physics)
   - [profileUtils.ts — Profile Post-Processing](#profileutilsts--profile-post-processing)
   - [targetTraces.ts — Target Trace Computation](#targettracests--target-trace-computation)
   - [settingsContext.tsx — App Settings](#settingscontexttsx--app-settings)
7. [React Components](#react-components)
   - [EquilibriumCanvas — 2D Cross-Section](#equilibriumcanvas--2d-cross-section)
   - [StatusPanel — Parameter Dashboard](#statuspanel--parameter-dashboard)
   - [UnifiedTracePanel — Time Traces](#unifiedtracepanel--time-traces)
   - [ShotPlanner — Discharge Editor](#shotplanner--discharge-editor)
   - [ProfilePanel — Radial Profiles](#profilepanel--radial-profiles)
   - [PortView (3D) — Tokamak Visualization](#portview-3d--tokamak-visualization)
   - [Supporting Components](#supporting-components)
8. [Pages and Routing](#pages-and-routing)
9. [Data Flow](#data-flow)
10. [Physics Models Reference](#physics-models-reference)

---

## Project Overview

Tok-Sym is an interactive, real-time tokamak plasma simulator that runs entirely in
the browser. A Rust physics engine compiled to WebAssembly computes plasma equilibrium,
transport, profiles, and disruption physics. A React/TypeScript frontend renders
2D cross-sections, time traces, radial profiles, 3D port views, and a full control
room interface.

Three tokamak devices are modeled: **DIII-D**, **JET**, and **ITER**, each with
device-specific geometry, heating limits, and wall outlines. Three discharge presets
are available per device: **H-mode**, **L-mode**, and **Density Limit**.

The simulator uses 0D (volume-averaged) power balance with analytic equilibrium
reconstruction, making it fast enough to run at 200 physics steps per second in the
browser while capturing the essential physics of tokamak operation.

---

## Repository Structure

```
fusion-sim/
├── Cargo.toml                  # Workspace root (members: crates/tok-sym-core)
├── Cargo.lock
├── build.sh                    # Full build script (WASM + frontend)
├── README.md                   # Project README
├── ARCHITECTURE.md             # This file
├── LICENSE                     # MIT license
├── PLAN.md                     # Original development plan
│
├── crates/
│   └── tok-sym-core/           # Rust physics engine crate
│       ├── Cargo.toml          # Crate config (cdylib + rlib, wasm feature)
│       └── src/
│           ├── lib.rs          # Module declarations
│           ├── equilibrium.rs  # Cerfon-Freidberg Grad-Shafranov solver
│           ├── transport.rs    # 0D power balance model
│           ├── profiles.rs     # Tanh-pedestal radial profiles
│           ├── devices.rs      # DIII-D, JET, ITER definitions
│           ├── disruption.rs   # Disruption risk & dynamics
│           ├── diagnostics.rs  # Synthetic diagnostic signals
│           ├── contour.rs      # Marching squares contour extraction
│           ├── simulation.rs   # Top-level orchestrator + DischargeProgram
│           └── wasm_api.rs     # wasm-bindgen API surface
│
└── web/                        # Frontend application
    ├── package.json            # Dependencies (React 19, Three.js, Vite 7)
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    │
    └── src/
        ├── main.tsx            # Entry point (WASM init → React mount)
        ├── App.tsx             # Router (4 routes)
        ├── index.css           # Tailwind CSS 4.2 imports
        │
        ├── lib/                # Shared TypeScript libraries
        │   ├── wasm.ts         # WASM singleton + device/preset wrappers
        │   ├── types.ts        # TypeScript interfaces (Snapshot, TracePoint, etc.)
        │   ├── useSimulation.ts # Core simulation React hook
        │   ├── fusionPhysics.ts # Bosch-Hale reactivity, fusion Q, divertor heat flux
        │   ├── profileUtils.ts  # Thomson scatter noise, profile post-processing
        │   ├── targetTraces.ts  # Target trace overlay computation
        │   ├── settingsContext.tsx # Theme + units context provider
        │   ├── diiid-geometry.ts  # DIII-D CAD limiter polygon (~400 points)
        │   ├── jet-geometry.ts    # JET CAD limiter polygon
        │   └── iter-geometry.ts   # ITER CAD limiter polygon
        │
        ├── components/         # React UI components
        │   ├── EquilibriumCanvas.tsx  # 2D poloidal cross-section (Canvas API)
        │   ├── StatusPanel.tsx        # Parameter dashboard + sub-panels
        │   ├── UnifiedTracePanel.tsx  # Time trace viewer (19 channels)
        │   ├── ShotPlanner.tsx        # Discharge parameter editor
        │   ├── ProfilePanel.tsx       # Te/ne/pressure profile viewer
        │   ├── DisruptionGauge.tsx    # Vertical disruption risk gauge
        │   ├── InfoPopup.tsx          # Reusable info popup
        │   ├── infoContent.tsx        # Physics explanation content
        │   ├── SettingsDropdown.tsx    # Settings menu (theme, units)
        │   ├── TutorialOverlay.tsx    # Interactive tutorial system
        │   ├── TimeTraces.tsx         # Legacy trace component
        │   ├── PortView.old.tsx       # Legacy 3D view
        │   │
        │   └── portview/             # 3D tokamak visualization (Three.js)
        │       ├── index.tsx         # Main PortView component
        │       ├── camera.ts         # Camera setup + animation
        │       ├── config.ts         # Per-device 3D configuration
        │       ├── geometry.ts       # Wall + port mesh generation
        │       ├── wallMaterial.ts    # Custom wall shader material
        │       ├── plasma.ts         # Plasma volume rendering
        │       ├── glow.ts           # Divertor strike point glow
        │       ├── postprocessing.ts  # Bloom + tone mapping pipeline
        │       ├── types.ts          # 3D utility types + toroidal transform
        │       └── shaders/          # GLSL shader files
        │
        ├── pages/              # Route-level page components
        │   ├── DeviceSelect.tsx       # Landing page — device cards
        │   ├── ProgramDischarge.tsx   # Pre-run waveform review
        │   ├── ControlRoom.tsx        # Main simulation control room
        │   └── Bibliography.tsx       # Physics bibliography + citations
        │
        └── wasm/               # WASM build output (generated by wasm-pack)
            ├── tok_sym_core.js
            ├── tok_sym_core_bg.wasm
            └── tok_sym_core.d.ts
```

---

## Build System

### Prerequisites

- **Rust** (stable) with `wasm-pack` installed
- **Node.js** (18+) with npm

### Build Commands

```bash
# Full build (WASM + frontend)
./build.sh

# WASM only
wasm-pack build crates/tok-sym-core \
  --target web \
  --out-dir ../../web/src/wasm \
  --features wasm \
  -- --no-default-features

# Frontend dev server
cd web && npm run dev

# Frontend production build
cd web && npm run build

# Run Rust tests
cargo test -p tok-sym-core

# Generate Rust API docs
cargo doc -p tok-sym-core --no-deps --open
```

### Build Pipeline

1. `wasm-pack` compiles `tok-sym-core` to WASM with the `wasm` feature flag
2. Output lands in `web/src/wasm/` (JS bindings + `.wasm` binary)
3. Vite bundles the frontend, importing the WASM module as an ES module
4. The WASM module is initialized asynchronously before React mounts

### Cargo Workspace

The root `Cargo.toml` defines a workspace with one member crate. The `tok-sym-core`
crate builds as both `cdylib` (for WASM) and `rlib` (for native tests). Release
profile uses `opt-level = 3` and LTO for maximum WASM performance.

---

## Rust Physics Engine

### lib.rs — Module Declarations

```
crates/tok-sym-core/src/lib.rs (11 lines)
```

Declares all physics modules. The `wasm_api` module is conditionally compiled
with `#[cfg(feature = "wasm")]` so the crate can be used in native Rust contexts
without wasm-bindgen dependencies.

Modules: `devices`, `equilibrium`, `contour`, `profiles`, `transport`,
`disruption`, `simulation`, `diagnostics`, `wasm_api` (feature-gated).

---

### equilibrium.rs — Grad-Shafranov Solver

```
crates/tok-sym-core/src/equilibrium.rs (1,060 lines)
```

Implements the **Cerfon-Freidberg analytic Grad-Shafranov equilibrium solver**
([A. Cerfon & J. Freidberg, PoP 17, 032502, 2010](https://doi.org/10.1063/1.3328818)).

#### Key Types

| Type | Description |
|------|-------------|
| `ShapeParams` | Plasma shape parameters: epsilon (inverse aspect ratio), kappa (elongation), delta (triangularity), a_param, config, x_point_alpha, squareness |
| `MagneticConfig` | Enum: `LowerSingleNull`, `UpperSingleNull`, `DoubleNull` |
| `CerfonEquilibrium` | Solution state: 12 coefficients, axis position, psi values at axis/boundary |

#### Physics

The solver expands the poloidal flux function as:

```
psi(R,Z) = psi_particular + sum(c_i * psi_i, i=1..12)
```

where `psi_particular` is a particular solution and `psi_i` are 12 homogeneous
basis functions satisfying the Grad-Shafranov equation. The basis functions are
polynomial/trigonometric combinations in normalized coordinates `(x, y)` where
`x = (R - R0) / (epsilon * R0)` and `y = Z / (epsilon * R0)`.

The 12 coefficients are determined by boundary conditions:
- **Lower Single Null (LSN):** X-point below midplane, 12 constraints from
  plasma boundary shape and null conditions
- **Upper Single Null (USN):** Mirror of LSN
- **Double Null (DN):** Two X-points, symmetric constraints

A 12x12 linear system is assembled and solved via Gaussian elimination with
partial pivoting.

#### Key Functions

| Function | Description |
|----------|-------------|
| `psi_1()` .. `psi_12()` | The 12 basis functions of the Cerfon-Freidberg expansion |
| `assemble_lsn()` | Builds the 12x12 constraint matrix for Lower Single Null |
| `assemble_usn()` | Builds the constraint matrix for Upper Single Null |
| `assemble_dn()` | Builds the constraint matrix for Double Null |
| `gauss_solve()` | 12x12 Gaussian elimination with partial pivoting |
| `CerfonEquilibrium::solve()` | Main solver entry point |
| `CerfonEquilibrium::from_device()` | Constructs from a `Device` struct |
| `CerfonEquilibrium::psi()` | Evaluates psi at any (R, Z) |
| `CerfonEquilibrium::psi_normalized()` | Returns psi normalized to [0, 1] (axis to boundary) |
| `CerfonEquilibrium::psi_grid()` | Computes psi on a 2D grid for contour extraction |
| `CerfonEquilibrium::update()` | Re-solves with new shape parameters |
| `CerfonEquilibrium::axis_physical()` | Returns magnetic axis position in meters |
| `CerfonEquilibrium::x_point_physical()` | Returns X-point position(s) in meters |
| `CerfonEquilibrium::grid_bounds()` | Returns the (R, Z) grid bounds for visualization |

#### Tests (7 tests)

Validates axis location, psi normalization, grid computation, and
configuration-specific behavior for all three magnetic configs.

---

### transport.rs — 0D Power Balance

```
crates/tok-sym-core/src/transport.rs (591 lines)
```

Implements a **zero-dimensional (volume-averaged) power balance transport model**
with L-H transition, ELM dynamics, and disruption coupling.

#### Key Types

| Type | Description |
|------|-------------|
| `TransportModel` | Full transport state: Ip, ne, Te, Wth, tau_e, q95, beta_n, f_gw, h98, li, vloop, radiation, confinement mode, impurity fraction, ELM state |
| `ProgramValues` | Current actuator values interpolated from discharge program waveforms |

#### Physics Model

Each `step(dt)` call advances the plasma state:

1. **Density evolution:** Relaxes ne toward target with ~50ms time constant
2. **Impurity tracking:** Neon fraction evolves from gas puffing with ELM flushing
3. **Safety factor q95:** Computed from Ip, Bt, R0, a, kappa with shape correction
4. **Greenwald fraction:** f_GW = ne / n_GW where n_GW = Ip / (pi * a^2)
5. **Ohmic heating:** Spitzer resistivity with Zeff correction
6. **Radiation losses:** Bremsstrahlung + line radiation + neon impurity radiation
7. **L-H transition:** Martin 2008 power threshold scaling P_LH ~ ne^0.78 * Bt^0.77 * S^0.98
8. **Energy confinement:** IPB98(y,2) scaling tau_E ~ Ip^0.93 * Bt^0.15 * ne^0.41 * ...
9. **Power balance:** dW/dt = P_heat - W/tau_E - P_rad, with implicit/explicit split
10. **ELM model:** Type I (large, periodic), Type II (grassy, high shaping),
    QCE (quasi-continuous exhaust) with stochastic timing via xorshift PRNG
11. **Temperature:** Derived from W_th = (3/2) * ne * V * Te
12. **Beta limits:** beta_N clamped to Troyon limit (beta_N,max = 2.8 * I_N)

#### Key Functions

| Function | Description |
|----------|-------------|
| `TransportModel::new()` | Initializes cold plasma state |
| `TransportModel::step()` | Advances state by dt seconds |
| `ipb98y2()` | IPB98(y,2) confinement scaling law |
| `martin_lh_power()` | Martin 2008 L-H power threshold |
| `spitzer_resistivity()` | Spitzer resistivity with neoclassical correction |

#### Tests (5 tests)

Validates H-mode transition, ELM triggering, Greenwald limit behavior,
energy confinement scaling, and power balance conservation.

---

### profiles.rs — Radial Profile Model

```
crates/tok-sym-core/src/profiles.rs (700 lines)
```

Implements the **OMFIT tanh-pedestal radial profile parameterization** for
electron temperature Te(rho), electron density ne(rho), and derived pressure.

#### Key Types

| Type | Description |
|------|-------------|
| `ProfileParams` | 7-parameter tanh pedestal: edge, ped, core, expin, expout, widthp, xphalf |
| `Profiles` | Contains Te and ne profiles as fixed arrays of `PROFILE_NPTS=51` points |

#### Physics

Radial profiles use the modified tanh parameterization from OMFIT:

```
f(x) = (edge + ped)/2 + (ped - edge)/2 * mtanh(alpha, x)
```

where `mtanh` includes the polynomial core contribution (expin, expout terms).
This captures the sharp pedestal structure characteristic of H-mode plasmas.

Profiles are updated from the 0D transport state with physically motivated
smoothing:
- **Pedestal:** 200ms smoothing time constant
- **Core:** 150ms smoothing time constant
- **ELM crash:** Pedestal drops to 60% of pre-ELM value on ELM onset

#### Key Functions

| Function | Description |
|----------|-------------|
| `tanh_profile()` | Evaluates the modified tanh profile at 51 radial points |
| `diiid_te_params()`, `iter_te_params()`, `jet_te_params()` | Device-specific Te profile shapes |
| `diiid_ne_params()`, `iter_ne_params()`, `jet_ne_params()` | Device-specific ne profile shapes |
| `Profiles::new()` | Creates flat (cold) profiles |
| `Profiles::update_from_0d()` | Maps 0D transport state to radial profiles |
| `compute_li()` | Computes internal inductance li from Spitzer conductivity profile |

#### Tests (10 tests)

Validates profile shape, pedestal width, ELM crash response, li computation,
and device-specific parameter loading.

---

### devices.rs — Tokamak Definitions

```
crates/tok-sym-core/src/devices.rs (356 lines)
```

Defines the three supported tokamak devices with their engineering parameters
and wall geometry.

#### Key Types

| Type | Description |
|------|-------------|
| `Device` | Full device spec: R0, a, bt_max, ip_max, kappa, delta, volume, surface_area, z0, wall_outline, config, impurity_elm, p_lh_factor |
| `MagneticConfig` | Re-exported from equilibrium: LSN, USN, DN |
| `ImpurityElmParams` | ELM-flushing parameters: base_fraction, flush_rate, recovery_rate |

#### Devices

| Device | R0 (m) | a (m) | Bt,max (T) | Ip,max (MA) | Notes |
|--------|--------|-------|------------|-------------|-------|
| DIII-D | 1.67 | 0.56 | 2.2 | 2.0 | Hand-crafted wall outline, LSN default |
| JET | 2.85 | 0.80 | 3.86 | 4.8 | Hand-crafted wall outline, LSN default |
| ITER | 6.0 | 1.7 | 5.3 | 15.0 | Parametric wall (z0=0.35m offset), p_lh_factor=0.35 |

Each device includes a `wall_outline` — a polygon of (R, Z) points defining the
first wall / limiter geometry for visualization and strike point detection.

#### Key Functions

| Function | Description |
|----------|-------------|
| `Device::diiid()` | DIII-D device constructor |
| `Device::jet()` | JET device constructor |
| `Device::iter()` | ITER device constructor |
| `Device::iter_wall()` | Generates ITER wall from parametric formula |
| `Device::by_id()` | Lookup device by string ID |

---

### disruption.rs — Disruption Model

```
crates/tok-sym-core/src/disruption.rs (439 lines)
```

Models **disruption risk assessment and multi-phase disruption dynamics**.

#### Key Types

| Type | Description |
|------|-------------|
| `DisruptionPhase` | Enum: `Precursor`, `ThermalQuench`, `CurrentQuench`, `Complete` |
| `DisruptionModel` | State machine tracking disruption phase, timing, and risk factors |

#### Physics

**Risk Assessment** uses sigmoid functions on four stability metrics:
- **Greenwald fraction** f_GW: density limit (risk rises above f_GW ~ 0.85)
- **Normalized beta** beta_N: Troyon limit (risk rises as beta_N approaches limit)
- **Safety factor** q95: kink limit (risk rises as q95 drops below ~2)
- **Radiation fraction** P_rad/P_in: radiation collapse (risk rises above ~0.8)

The combined risk triggers stochastic disruption onset via xorshift PRNG.

**Disruption Dynamics** proceed through four phases:
1. **Precursor** (50-100ms): Growing MHD oscillations
2. **Thermal quench** (1-2ms): Rapid energy loss, Te crashes to ~10-50 eV
3. **Current quench** (5-50ms): Ip decays via L/R time constant with
   current spike (Hiro current) at onset
4. **Complete**: Terminal state

#### Key Functions

| Function | Description |
|----------|-------------|
| `DisruptionModel::new()` | Creates model in stable state |
| `DisruptionModel::step()` | Advances disruption state by dt |
| `DisruptionModel::risk()` | Returns combined disruption risk [0, 1] |
| `DisruptionModel::risk_factors()` | Returns individual risk components |
| `sigmoid()` | Smooth sigmoid for risk mapping |
| `xorshift()` | Fast pseudo-random number generator |

---

### diagnostics.rs — Synthetic Diagnostics

```
crates/tok-sym-core/src/diagnostics.rs (218 lines)
```

Generates **synthetic diagnostic signals** mimicking real tokamak measurements.

#### Key Types

| Type | Description |
|------|-------------|
| `DiagnosticSignals` | 14 simulated diagnostic channels |
| `NoiseGen` | Box-Muller Gaussian noise generator with xorshift PRNG |

#### Diagnostic Channels

Ip_measured, ne_line, te_ece, d_alpha, neutron_rate, bolometer, mirnov,
soft_xray, brem_vis, interferometer, mse_angle, ece_2nd, reflectometer,
z_eff_vis.

Each channel applies measurement noise at physically realistic levels (1-10%
depending on diagnostic type) using Box-Muller transform for Gaussian noise.

---

### contour.rs — Flux Surface Extraction

```
crates/tok-sym-core/src/contour.rs (637 lines)
```

Implements the **marching squares algorithm** for extracting iso-contours from
the 2D psi grid computed by the equilibrium solver.

#### Key Functions

| Function | Description |
|----------|-------------|
| `extract_contours()` | Generic marching squares on a 2D grid |
| `extract_flux_surfaces()` | Extracts N evenly-spaced flux surfaces from psi grid |
| `extract_separatrix()` | Extracts the separatrix contour (psi = psi_boundary), with special handling for double-null topology (returns all chain segments for divertor legs) |
| `ContourPoint` | (R, Z) point on a contour |
| `Contour` | Collection of points forming one flux surface |

The marching squares implementation handles all 16 cell cases including the
ambiguous saddle-point case (case 5/10) using center-value disambiguation.
Contour chains are linked across cell boundaries to produce continuous curves.

---

### simulation.rs — Orchestrator

```
crates/tok-sym-core/src/simulation.rs (1,266 lines)
```

The **top-level orchestrator** that ties all physics modules together into a
coherent time-stepping simulation.

#### Key Types

| Type | Description |
|------|-------------|
| `DischargeProgram` | Complete discharge specification: 10 waveform channels (Ip, Bt, ne_target, P_NBI, P_ECH, P_ICH, kappa, delta, d2_puff, neon_puff) + duration + config_override |
| `WaveformPoint` | `[f64; 2]` — (time, value) pair |
| `SimulationSnapshot` | Complete state dump: all transport variables, equilibrium geometry (separatrix, flux surfaces, axis, X-points), profiles, diagnostics, disruption state |
| `Simulation` | Main simulation struct: Device + TransportModel + Profiles + CerfonEquilibrium + DisruptionModel + DiagnosticSignals + DischargeProgram |

#### Discharge Presets

Three built-in presets per device, constructed by `DischargeProgram` factory methods:

| Preset | Description |
|--------|-------------|
| `hmode_preset()` | Standard H-mode: Ip ramp → NBI → L-H transition → H-mode flat-top → rampdown |
| `lmode_preset()` | L-mode: Ohmic + modest NBI, stays in L-mode confinement |
| `density_limit_preset()` | Over-fuelled shot pushing past the Greenwald limit |

Presets scale their waveforms to each device's engineering limits (Ip_max, Bt_max, etc.).

#### Key Functions

| Function | Description |
|----------|-------------|
| `Simulation::new()` | Creates simulation from device ID and preset |
| `Simulation::from_program()` | Creates simulation from custom program JSON |
| `Simulation::step()` | Advances one time step: interpolates waveforms → transport step → equilibrium update → profile update → contour extraction → diagnostics |
| `Simulation::snapshot()` | Returns complete state as `SimulationSnapshot` |
| `Simulation::is_finished()` | Returns true when simulation time exceeds program duration |
| `interp_waveform()` | Linear interpolation of waveform at time t |
| `DischargeProgram::to_json()` | Serializes program for WASM boundary |

---

### wasm_api.rs — WASM Boundary

```
crates/tok-sym-core/src/wasm_api.rs (186 lines)
```

Defines the **wasm-bindgen API surface** that the JavaScript/TypeScript frontend calls.

#### Exported Types

| Type | Description |
|------|-------------|
| `SimHandle` | Opaque wrapper around `Simulation`, exposed to JS |

#### Exported Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `SimHandle::new()` | `(device_id: &str, preset: &str) -> SimHandle` | Create simulation from preset |
| `SimHandle::from_program()` | `(device_id: &str, json: &str) -> SimHandle` | Create from custom program JSON |
| `SimHandle::step()` | `(dt: f64)` | Advance one time step |
| `SimHandle::snapshot_json()` | `() -> String` | Returns full snapshot as JSON string |
| `SimHandle::wall_json()` | `() -> String` | Returns wall geometry as JSON |
| `SimHandle::program_json()` | `() -> String` | Returns discharge program as JSON |
| `SimHandle::is_finished()` | `() -> bool` | Check if simulation is complete |
| `get_devices_json()` | `() -> String` | List all devices as JSON array |
| `get_preset_json()` | `(device_id: &str, preset: &str) -> String` | Get preset waveforms as JSON |

**Important design decision:** All complex data crosses the WASM boundary as
JSON strings. This avoids the complexity of shared memory / typed arrays for
structured data and keeps the API simple. The JSON serialization overhead is
negligible compared to the physics computation (~0.1ms serialize vs ~2ms physics).

---

## WASM Boundary Layer

The WASM boundary is the critical interface between Rust and TypeScript. Data
flows exclusively through JSON strings:

```
┌─────────────────────────────────┐
│     TypeScript (browser)        │
│                                 │
│  SimHandle.step(dt)             │  ← void call, no data
│  SimHandle.snapshot_json()      │  → JSON string (~5KB per snapshot)
│  get_devices_json()             │  → JSON string (device list)
│  get_preset_json(dev, preset)   │  → JSON string (waveforms)
│                                 │
└──────────┬──────────────────────┘
           │  wasm-bindgen (JSON strings)
┌──────────┴──────────────────────┐
│     Rust / WASM                 │
│                                 │
│  Simulation::step()             │  physics computation
│  serde_json::to_string()        │  serialize snapshot
│                                 │
└─────────────────────────────────┘
```

The `SimHandle` is created once per discharge and reused. Each animation frame,
the TypeScript side calls `step()` multiple times (typically 3 sub-steps per
frame at DT=0.005s) and then `snapshot_json()` once to get the display state.

---

## TypeScript Library Layer

### wasm.ts — WASM Initialization

```
web/src/lib/wasm.ts (99 lines)
```

Manages WASM module lifecycle with a **singleton initialization pattern**.

| Function | Description |
|----------|-------------|
| `initWasm()` | Loads and initializes the WASM module (called once at startup) |
| `isWasmReady()` | Returns true after successful initialization |
| `getDevices()` | Returns array of `Device` objects from WASM |
| `getDevice(id)` | Returns a single device by ID |
| `getPreset(deviceId, presetId)` | Returns a `DischargeProgram` with all waveforms |

Also re-exports `SimHandle` from the WASM module for direct use.

### types.ts — Interface Definitions

```
web/src/lib/types.ts (136 lines)
```

TypeScript interfaces that mirror the Rust structs crossing the WASM boundary.

| Interface | Fields | Description |
|-----------|--------|-------------|
| `Contour` | points, is_closed | Flux surface contour |
| `DiagnosticSignals` | 14 channels | Synthetic diagnostic measurements |
| `SimStatus` | finished, time, duration | Simulation progress |
| `Snapshot` | ~92 fields | Complete plasma state (transport, equilibrium, profiles, diagnostics, disruption) |
| `TracePoint` | ~21 fields | Single time-series data point for history plots |
| `ProfileFrame` | time, te, ne, pressure | Radial profiles at one instant |
| `ProcessedProfile` | points[], rho[], thomson[] | Post-processed profile with synthetic Thomson scatter |

### useSimulation.ts — Core React Hook

```
web/src/lib/useSimulation.ts (376 lines)
```

The **central simulation management hook** used by the ControlRoom page.

#### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `DT` | 0.005 | Physics timestep (5ms) |
| `MAX_TRACE_HISTORY` | 30,000 | Max stored trace points |
| `MAX_SNAPSHOT_HISTORY` | 2,000 | Max stored full snapshots (for scrubbing) |

#### State (`SimState`)

Tracks: `snapshot` (latest), `displaySnapshot` (current display — live or scrubbed),
`history` (trace points array), `snapshotHistory` (full snapshots for time scrubbing),
`running`, `wallJson`, `programJson`, `scrubTime`, `finished`, `processedProfiles`,
`profileTeMax/profileNeMax/profilePMax` (global axis limits).

#### Controls (`SimControls`)

| Control | Description |
|---------|-------------|
| `start()` | Begin/resume animation loop |
| `pause()` | Stop animation loop |
| `reset()` | Recreate SimHandle from current preset |
| `switchPreset(device, preset)` | Switch device and/or preset |
| `runProgram(device, json)` | Run custom program from Shot Planner |
| `setScrubTime(t \| null)` | Scrub to historical time (or null to return to live) |
| `setSpeed(multiplier)` | Adjust simulation speed (0.5x to 4x) |

#### Animation Loop

Each `requestAnimationFrame` tick:
1. Computes `BASE_STEPS * speed` sub-steps per frame
2. Calls `simHandle.step(DT)` for each sub-step
3. Tracks peak D-alpha across sub-steps (for ELM capture)
4. Captures snapshot JSON and parses it
5. Appends trace point to history
6. Stores full snapshot every ~50ms for scrubbing
7. When finished: processes profiles (Thomson scatter), freezes display

### fusionPhysics.ts — Client-Side Physics

```
web/src/lib/fusionPhysics.ts (369 lines)
```

**Client-side fusion physics computations** that run in TypeScript rather than WASM,
primarily for display-only derived quantities.

#### Bosch-Hale Reactivity

Implements the Bosch-Hale parameterization (Table IV from NF 32, 611, 1992) for
DT and DD fusion reactivities. Uses the 7-coefficient rational function fit
with Gamow energy.

| Function | Description |
|----------|-------------|
| `boschHaleReactivity(T_keV, 'DT')` | DT reactivity <sigma*v> in m^3/s |
| `boschHaleReactivity(T_keV, 'DD_he3')` | DD→He3 branch reactivity |
| `boschHaleReactivity(T_keV, 'DD_T')` | DD→T branch reactivity |

#### Fusion Power & Q

| Function | Description |
|----------|-------------|
| `computeFusion(profiles, R0, a, kappa)` | Volume-weighted integration over 51-point profiles. Returns P_fus, P_alpha, neutron_rate, Q_plasma |

Uses cylindrical shell volume elements dV = 2*pi*R * 2*pi*r*dr * kappa with
proper Jacobian for toroidal geometry.

#### Divertor Heat Flux

| Function | Description |
|----------|-------------|
| `computeDivertorHeatFlux(Psol, Bt, Ip, R0, ...)` | Eich scaling for SOL power width + 1D thermal model |

Computes: lambda_q (Eich scaling ~ 1.35/B_pol^0.9 mm), flux expansion (f_x=8),
peak heat flux, detachment factor (sigmoid on f_GW), surface temperature for
tungsten or carbon (1D steady-state thermal model).

### profileUtils.ts — Profile Post-Processing

```
web/src/lib/profileUtils.ts (124 lines)
```

Post-processes radial profiles to add **synthetic Thomson scattering** diagnostic
visualization.

| Constant | Value | Description |
|----------|-------|-------------|
| `THOMSON_POINTS` | 45 | Number of synthetic Thomson scatter channels |

| Function | Description |
|----------|-------------|
| `processProfileFrames()` | Generates Thomson scatter points for each profile frame with non-uniform radial distribution (edge-weighted via r^0.6), profile-dependent noise |

Uses xorshift PRNG with Box-Muller transform for reproducible Gaussian noise.

### targetTraces.ts — Target Trace Computation

```
web/src/lib/targetTraces.ts (134 lines)
```

Computes **target/reference traces** overlaid on time trace plots, showing what
the discharge program commands.

| Function | Description |
|----------|-------------|
| `interpWaveform(waveform, t)` | Linear interpolation of waveform at time t |
| `ipb98y2(Ip, Bt, ne, ...)` | IPB98(y,2) scaling law for target beta_N estimation |
| `computeTargetTraces(program, device)` | Computes Ip target + beta_N target at 100 time points |

### settingsContext.tsx — App Settings

```
web/src/lib/settingsContext.tsx (54 lines)
```

React context providing **theme** (`classic` | `modern`) and **units**
(`metric` | `imperial`) settings with localStorage persistence.

---

## React Components

### EquilibriumCanvas — 2D Cross-Section

```
web/src/components/EquilibriumCanvas.tsx (382 lines)
```

Canvas API-based renderer for the poloidal cross-section of the tokamak.

**Draws:**
- Wall outline (from device geometry or CAD limiter data)
- Flux surfaces (color-mapped from warm core to cool edge)
- Separatrix (yellow with glow effect)
- Magnetic axis (orange crosshair marker)
- X-point(s) (red X markers)
- R/Z coordinate axes with adaptive tick spacing

Handles disconnected contour loops (e.g., double-null SOL legs) with jump
detection. Uses `ResizeObserver` for responsive canvas sizing.

---

### StatusPanel — Parameter Dashboard

```
web/src/components/StatusPanel.tsx (620 lines)
```

The main **plasma parameter display panel** in the control room, containing
multiple sub-panels.

#### Sub-panels

| Sub-panel | Description |
|-----------|-------------|
| Mode badge | Shows L-mode / H-mode / DISRUPTED with color coding |
| Parameter grid | 12 key parameters (Ip, Te0, ne, Wth, q95, beta_N, f_GW, H98, li, Vloop, Bt, tau_E) with warning/danger color thresholds |
| `PowerBalance` | Input vs output power columns with proportional bar charts |
| `QDisplay` | Fusion Q factor with EMA smoothing for stable display |
| `NeutronDiagnostic` | 8-segment signal bar with log-scale mapping |
| `DivertorLoading` | Heat flux bar + surface temperature for tungsten, recrystallization warning |
| `DisruptionRisk` | Risk bar referencing `DisruptionGauge` |
| Profile toggle | Switches to `ProfilePanel` after discharge completes |

---

### UnifiedTracePanel — Time Traces

```
web/src/components/UnifiedTracePanel.tsx
```

Displays **19 configurable time trace channels** with canvas-based rendering.

#### Available Traces

Ip, beta_N, li, D_alpha, q95, H98, f_GW, ne_bar, ne_ped, Te0, Te_ped,
ne_line, Wth, Pin, Prad, Ploss, Vloop, f_imp, disruption_risk.

**Default set:** Ip, beta_N, li, D_alpha.

Features:
- User-selectable trace channels via dropdown
- Target trace overlay (from discharge program)
- Time scrubbing (click/drag to scrub through history)
- ELM markers on D-alpha trace
- Auto-scaling Y axes
- Synchronized time cursor across all traces

---

### ShotPlanner — Discharge Editor

```
web/src/components/ShotPlanner.tsx (394 lines)
```

A **slide-out drawer** for editing discharge parameters before or during a run.

#### Editable Parameters

| Parameter | Unit | Range |
|-----------|------|-------|
| Ip flat-top | MA | 0.1 - 20 |
| NBI power | MW | 0 - 40 |
| ECH power | MW | 0 - 20 |
| Density target | 10^20 m^-3 | 0.1 - 3.0 |
| D2 gas puff | 10^20/s | 0 - 10 |
| Neon seeding | 10^20/s | 0 - 2.0 |
| Elongation kappa | - | 1.0 - 2.2 |
| Triangularity delta | - | 0.0 - 0.8 |

Each parameter shows a **sparkline waveform** preview. The planner scales the
base preset's waveform shape to match the user's target value, preserving the
ramp/flat-top/rampdown structure.

Also supports: duration override (with per-device limits), magnetic configuration
selector (DIII-D only: LSN, DN, USN), and base preset switching.

State is **lifted to ControlRoom** so it persists across open/close of the drawer.

---

### ProfilePanel — Radial Profiles

```
web/src/components/ProfilePanel.tsx (274 lines)
```

Displays **side-by-side canvas tiles** for electron temperature Te(rho),
electron density ne(rho), and pressure P(rho) radial profiles.

Features:
- Grid lines with labeled axes
- Profile curve rendering
- Thomson scatter overlay (synthetic measurement points with error bars)
- H-mode / L-mode badge
- Global axis maxima for consistent scaling across time

---

### PortView (3D) — Tokamak Visualization

```
web/src/components/portview/ (8 files + shaders)
```

A **Three.js-based 3D visualization** of the tokamak as seen through a
diagnostic port window.

#### Sub-modules

| File | Description |
|------|-------------|
| `index.tsx` | Main React component, Three.js scene lifecycle, snapshot-driven updates |
| `camera.ts` | Camera positioning with device-specific FOV and angles |
| `config.ts` | Per-device configuration (port geometry, opacity/power/glow scaling) |
| `geometry.ts` | Procedural wall mesh + port cylinder from limiter polygon (toroidal revolution) |
| `wallMaterial.ts` | Custom GLSL shader: metallic wall with strike point illumination |
| `plasma.ts` | Plasma volume rendering (translucent toroidal shell from separatrix) |
| `glow.ts` | Divertor strike point glow effect (billboard sprites with additive blending) |
| `postprocessing.ts` | Bloom pass + tone mapping pipeline |
| `types.ts` | `toroidal(R, Z, phi)` coordinate transform + utility types |

The 3D view shows:
- Toroidal wall section (from limiter geometry revolved around the torus)
- Translucent plasma volume (from separatrix shape)
- Divertor strike point glow (computed from separatrix-wall intersections)
- H-mode glow fades in/out smoothly with frozen strike positions during fade-out
- ELM flash (brief clear-color change)
- Port window frame

---

### Supporting Components

| Component | File | Description |
|-----------|------|-------------|
| `DisruptionGauge` | `DisruptionGauge.tsx` (100 lines) | Vertical bar gauge with tick marks, color-coded risk, individual risk factor rows |
| `InfoPopup` | `InfoPopup.tsx` (131 lines) | Reusable popup with viewport clamping, click-outside-close, Escape key, resize handling |
| `infoContent` | `infoContent.tsx` | Physics explanation content for info popups throughout the UI |
| `SettingsDropdown` | `SettingsDropdown.tsx` | Settings gear menu: theme toggle, unit toggle, tutorial launch, bibliography link |
| `TutorialOverlay` | `TutorialOverlay.tsx` | Multi-step interactive tutorial highlighting UI sections |

---

## Pages and Routing

```
App.tsx routes:
  /                    → DeviceSelect
  /program/:deviceId   → ProgramDischarge
  /run/:deviceId       → ControlRoom
  /bibliography        → Bibliography
```

### DeviceSelect

Landing page with cards for DIII-D, JET, and ITER. Each card shows device
parameters (R0, a, Bt, Ip) and links to the ProgramDischarge page.

### ProgramDischarge

Pre-run page for reviewing discharge waveforms. Offers three preset scenarios
per device with sparkline visualization of all waveform channels. "Run Discharge"
button navigates to ControlRoom.

### ControlRoom

The main simulation page. Features:
- **Top bar:** Device selector, preset selector (button group), playback controls
  (Start/Pause/Reset), speed selector (0.5x-4x), Shot Planner toggle
- **Main grid:** 2x3 CSS grid with EquilibriumCanvas (top-left), UnifiedTracePanel
  (top-right, spanning 2 columns), StatusPanel (bottom-left, spanning 2 columns),
  PortView (bottom-right)
- **Progress bar:** Bottom bar showing simulation time progress
- **Shot Planner:** Slide-out drawer (fixed right panel, z-50)
- **Tutorial:** Optional overlay triggered by URL param or settings

### Bibliography

Comprehensive physics reference page with 23 categorized physics sections and
12 peer-reviewed references. Includes DOI links, a disclaimer about 0D
approximations, and attribution to the Columbia Fusion Research Center.

---

## Data Flow

```
                           ┌──────────────────────────┐
                           │     DischargeProgram      │
                           │  (10 waveforms + duration)│
                           └────────────┬─────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────┐
│                    Simulation::step(dt)                       │
│                                                              │
│  1. interp_waveform() → ProgramValues                        │
│  2. TransportModel::step(dt, program_values)                 │
│     ├── density evolution                                    │
│     ├── power balance (ohmic + NBI + ECH - rad - transport)  │
│     ├── L-H transition check                                 │
│     ├── ELM model                                            │
│     └── beta, q95, H98 computation                           │
│  3. Profiles::update_from_0d(transport_state)                │
│  4. CerfonEquilibrium::update(kappa, delta, config)          │
│  5. extract_flux_surfaces(psi_grid)                          │
│  6. extract_separatrix(psi_grid)                             │
│  7. DisruptionModel::step(risk_factors)                      │
│  8. DiagnosticSignals::update(state)                         │
│                                                              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼ snapshot_json()
              ┌────────────────┐
              │  JSON string   │  (~5KB per snapshot)
              │  across WASM   │
              └───────┬────────┘
                      │
                      ▼ JSON.parse()
              ┌────────────────────────────────────────────┐
              │          useSimulation hook                  │
              │                                            │
              │  • Stores snapshot in React state           │
              │  • Appends TracePoint to history[]          │
              │  • Stores full snapshot for scrubbing       │
              │  • Runs fusionPhysics.ts (Q, divertor)     │
              │  • Post-processes profiles (Thomson)        │
              │                                            │
              └───────┬────────────────────────────────────┘
                      │
          ┌───────────┼──────────────┬──────────────┐
          ▼           ▼              ▼              ▼
   EquilibriumCanvas  StatusPanel  UnifiedTrace   PortView
   (flux surfaces,    (parameters, (time traces,  (3D wall,
    separatrix,        power,       scrubbing)     plasma,
    wall, axis)        Q, divertor)                glow)
```

---

## Physics Models Reference

For complete citations and equations, see the [Bibliography](/bibliography) page
in the application.

| Model | Reference | Used In |
|-------|-----------|---------|
| Grad-Shafranov equilibrium | Cerfon & Freidberg, PoP 17, 2010 | `equilibrium.rs` |
| IPB98(y,2) confinement scaling | ITER Physics Basis, NF 39, 1999 | `transport.rs`, `targetTraces.ts` |
| Martin L-H power threshold | Martin et al., J. Phys. Conf. Ser. 123, 2008 | `transport.rs` |
| Troyon beta limit | Troyon et al., PPCF 26, 1984 | `transport.rs` |
| Greenwald density limit | Greenwald, PPCF 44, 2002 | `transport.rs`, `disruption.rs` |
| Tanh-pedestal profiles | OMFIT framework | `profiles.rs` |
| Bosch-Hale fusion reactivity | Bosch & Hale, NF 32, 1992 | `fusionPhysics.ts` |
| Eich divertor heat flux | Eich et al., NF 53, 2013 | `fusionPhysics.ts` |
| Spitzer resistivity | Spitzer, Physics of Fully Ionized Gases, 1962 | `transport.rs`, `profiles.rs` |
| ELM classification | Zohm, PPCF 38, 1996 | `transport.rs` |
| Hiro current (disruptions) | Boozer, PoP 19, 2012 | `disruption.rs` |
| Divertor design | Pitts et al., NME 12, 2017 | `fusionPhysics.ts` |

---

*This document is maintained alongside the codebase. Last updated: March 2026.*

*Tok-Sym is developed by Daniel Burgess and the Columbia Fusion Research Center.*
