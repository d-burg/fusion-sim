//! # tok-sym-core
//!
//! Real-time tokamak physics engine for the Tok-Sym simulator.
//!
//! This crate provides the core physics models for simulating tokamak plasma
//! behavior in real time. It is designed to compile to WebAssembly for
//! browser-based use, but also works as a native Rust library.
//!
//! ## Architecture
//!
//! The physics engine is organized into independent modules that are
//! orchestrated by the [`simulation::Simulation`] struct:
//!
//! - **[`equilibrium`]** — Cerfon-Freidberg analytic Grad-Shafranov solver
//!   for MHD equilibrium reconstruction
//! - **[`transport`]** — Zero-dimensional power balance model with IPB98(y,2)
//!   confinement scaling, L-H transition, and ELM dynamics
//! - **[`profiles`]** — OMFIT tanh-pedestal parameterization for radial
//!   electron temperature and density profiles
//! - **[`devices`]** — Tokamak device definitions (DIII-D, JET, ITER) with
//!   engineering parameters and wall geometry
//! - **[`disruption`]** — Disruption risk assessment and multi-phase
//!   disruption dynamics (precursor → thermal quench → current quench)
//! - **[`diagnostics`]** — Synthetic diagnostic signal generation with
//!   realistic measurement noise
//! - **[`contour`]** — Marching squares algorithm for flux surface extraction
//!   from 2D psi grids
//! - **[`simulation`]** — Top-level orchestrator tying all modules together,
//!   plus discharge program definitions and preset constructors
//!
//! ## WASM API
//!
//! When compiled with the `wasm` feature, the `wasm_api` module exposes
//! a JSON-based API through `wasm-bindgen`. All complex data crosses the
//! WASM boundary as serialized JSON strings.
//!
//! ## Usage (Native)
//!
//! ```rust
//! use tok_sym_core::devices;
//! use tok_sym_core::simulation::{Simulation, DischargeProgram};
//!
//! let device = devices::diiid();
//! let program = DischargeProgram::standard_hmode(&device);
//! let mut sim = Simulation::new(device, program);
//! sim.start();
//!
//! // Run 100 timesteps at 5ms each (0.5s of plasma time)
//! for _ in 0..100 {
//!     let snapshot = sim.step(0.005);
//!     // snapshot contains the full plasma state after each step
//! }
//! ```

/// Tokamak device definitions (DIII-D, JET, ITER).
pub mod devices;

/// Cerfon-Freidberg analytic Grad-Shafranov equilibrium solver.
pub mod equilibrium;

/// Marching squares contour extraction for flux surfaces and separatrix.
pub mod contour;

/// OMFIT tanh-pedestal radial profile model (Te, ne, pressure).
pub mod profiles;

/// Zero-dimensional power balance transport model.
pub mod transport;

/// Disruption risk assessment and multi-phase disruption dynamics.
pub mod disruption;

/// Top-level simulation orchestrator and discharge program definitions.
pub mod simulation;

/// Synthetic diagnostic signal generation.
pub mod diagnostics;

/// WASM-bindgen API surface (JSON-based, feature-gated).
#[cfg(feature = "wasm")]
mod wasm_api;
