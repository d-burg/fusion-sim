/**
 * SPARC first-wall / limiter geometry.
 *
 * Compact high-field D-T tokamak (Commonwealth Fusion Systems).
 * R₀ = 1.85 m, a = 0.57 m, κ_sep = 1.97, δ_sep = 0.54, B₀ = 12.2 T, Iₚ = 8.7 MA.
 *
 * Contour in (R, Z) metres, reduced from the 555-point first-wall polygon
 * carried in the SPARC Primary Reference Discharge GEQDSK files published in
 * the MIT-licensed `cfs-energy/SPARCPublic` repository (generated with FreeGS).
 * Ramer–Douglas–Peucker reduction at a ~1 mm tolerance; the published contour
 * is exactly up-down symmetric and this reduction preserves that.
 *
 * Includes the tightly baffled upper and lower divertor structures — SPARC's
 * divertor is toroidally continuous, and the vessel is symmetric because
 * double-null operation is planned alongside the single-null baseline.
 *
 * CFS describe this as a *simplified* first wall, not engineering geometry.
 *
 * Acknowledgement, per the SPARCPublic README: "The information, data, or work
 * presented herein builds on the SPARC primary reference discharge and X-point
 * target discharge data provided by Commonwealth Fusion Systems."
 */
export const SPARC_LIMITER: [number, number][] = [
  [2.4295, 0.0000],
  [2.4284, 0.0469],
  [2.4250, 0.0938],
  [2.4193, 0.1406],
  [2.4113, 0.1875],
  [2.4010, 0.2344],
  [2.3883, 0.2812],
  [2.3733, 0.3281],
  [2.3557, 0.3750],
  [2.3357, 0.4219],
  [2.3047, 0.4845],
  [2.3047, 0.5090],
  [2.2516, 0.5972],
  [2.1984, 0.6721],
  [2.1187, 0.7679],
  [2.0656, 0.8243],
  [1.9063, 0.9813],
  [1.8536, 1.0275],
  [1.8039, 1.0658],
  [1.7567, 1.0979],
  [1.6941, 1.1354],
  [1.6719, 1.1510],
  [1.6541, 1.1665],
  [1.6450, 1.1818],
  [1.6418, 1.1980],
  [1.6450, 1.2168],
  // ─── Upper divertor (baffle + target plates) ───
  [1.7293, 1.4085],
  [1.7443, 1.4100],
  [1.8398, 1.4100],
  [1.8500, 1.4157],
  [1.8492, 1.5903],
  [1.8193, 1.5992],
  [1.7462, 1.5152],
  [1.4795, 1.1781],
  [1.4656, 1.1786],
  [1.2985, 1.2308],
  [1.2850, 1.2332],
  [1.2913, 1.2205],
  [1.4597, 1.1002],
  [1.2689, 0.5000],
  [1.2689, -0.5000],
  [1.4597, -1.1002],
  [1.2913, -1.2205],
  [1.2850, -1.2332],
  [1.2985, -1.2308],
  [1.4656, -1.1786],
  [1.4795, -1.1781],
  // ─── Lower divertor (mirror of the upper) ───
  [1.7462, -1.5152],
  [1.8193, -1.5992],
  [1.8492, -1.5903],
  [1.8500, -1.4157],
  [1.8398, -1.4100],
  [1.7443, -1.4100],
  [1.7293, -1.4085],
  [1.6450, -1.2168],
  [1.6418, -1.2006],
  [1.6450, -1.1818],
  [1.6541, -1.1665],
  [1.6719, -1.1510],
  [1.6941, -1.1354],
  [1.7567, -1.0979],
  [1.8039, -1.0658],
  [1.8536, -1.0275],
  [1.9063, -0.9813],
  [2.0656, -0.8243],
  [2.1187, -0.7679],
  [2.1984, -0.6721],
  [2.2516, -0.5972],
  [2.3047, -0.5090],
  [2.3047, -0.4845],
  [2.3357, -0.4219],
  [2.3557, -0.3750],
  [2.3733, -0.3281],
  [2.3883, -0.2812],
  [2.4010, -0.2344],
  [2.4113, -0.1875],
  [2.4193, -0.1406],
  [2.4250, -0.0938],
  [2.4284, -0.0469],
]
