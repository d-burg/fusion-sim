// Wall tile fragment shader
// Grid lines, Fresnel highlights, per-tile variation, depth shading, region coloring.

precision highp float;

uniform vec3 u_tileColor;
uniform vec2 u_gridSpacing;       // poloidal, toroidal
uniform vec2 u_inboardGridSpacing;
uniform vec2 u_limiterGridSpacing;
uniform vec2 u_divertorGridSpacing;
uniform float u_tileGridDarken;
uniform float u_fresnelStrength;
uniform float u_borderWidth;
uniform float u_totalArc;         // total poloidal arc length in metres
uniform float u_nSlices;          // number of toroidal slices
uniform float u_maxDepth;         // depth range for shading
uniform vec3 u_divertorColor;
uniform float u_hasDivertor;      // 0 or 1
uniform float u_inboardStyle;     // 0 = tiles, 1 = bands
uniform float u_bandWidth;

// Strike point illumination
uniform vec4 u_strikePoints[8];   // (x, y, z, intensity) — up to 8
uniform int u_nStrikePoints;
uniform vec3 u_strikeColor;       // per-device glow color for wall illumination

varying vec2 v_uv;
varying vec3 v_normal;
varying vec3 v_viewDir;
varying vec3 v_worldPos;
varying float v_region;
varying float v_tileHash;
varying float v_depth;

float gridProximity(vec2 pos, vec2 spacing) {
  vec2 cell = pos / spacing;
  vec2 f = fract(cell);
  vec2 dist = min(f, 1.0 - f) * spacing;
  float minDist = min(dist.x, dist.y);
  return smoothstep(0.0, u_borderWidth, minDist);
}

void main() {
  vec3 N = normalize(v_normal);
  vec3 V = normalize(v_viewDir);

  // Region-based grid spacing
  int region = int(v_region + 0.5);
  vec2 spacing = u_gridSpacing;
  vec3 baseColor = u_tileColor;

  if (region == 1) { // Inboard
    spacing = u_inboardGridSpacing;
  } else if (region == 2) { // Limiter
    spacing = u_limiterGridSpacing;
  } else if (region == 5 && u_hasDivertor > 0.5) { // Divertor
    spacing = u_divertorGridSpacing;
    baseColor = u_divertorColor;
  } else if (region == 4) { // Antenna — metallic Faraday screen look
    baseColor = vec3(52.0, 50.0, 48.0);
    spacing = u_gridSpacing * 0.6;
  }

  // Poloidal/toroidal position in metres
  vec2 worldUV = vec2(v_uv.x * u_totalArc, v_uv.y * u_nSlices * spacing.y);

  // Grid proximity (0 at grid line, 1 between lines)
  float gp;
  if (region == 1 && u_inboardStyle > 0.5) {
    // JET-style horizontal bands
    float bandPos = v_uv.x * u_totalArc;
    float bandCell = bandPos / u_bandWidth;
    float bandF = fract(bandCell);
    float bandDist = min(bandF, 1.0 - bandF) * u_bandWidth;
    gp = smoothstep(0.0, u_borderWidth, bandDist);
  } else {
    gp = gridProximity(vec2(v_uv.x * u_totalArc, v_uv.y * u_nSlices * spacing.y), spacing);
  }

  // Per-tile brightness variation
  float tileVar = 0.92 + v_tileHash * 0.16; // range 0.92 — 1.08

  // Depth-based ambient (darker tiles further from camera)
  // Much darker interior — divertor glow should be the primary light source
  float df = clamp(v_depth / u_maxDepth, 0.0, 1.0);
  float depthMod = 0.04 + (1.0 - df) * 0.36;

  // Fresnel (grazing angle brightening)
  // Use abs() so both normal orientations work correctly
  float NdotV = abs(dot(N, V));
  float fresnel = pow(1.0 - NdotV, 4.0) * u_fresnelStrength * 0.4;

  // Combine tile color
  vec3 color = baseColor / 255.0;
  color *= tileVar * depthMod;

  // Grid line darkening
  color *= mix(1.0 - u_tileGridDarken, 1.0, gp);

  // Fresnel highlight
  color += vec3(fresnel);

  // Strike point wall illumination — localized glow near divertor targets
  for (int i = 0; i < 8; i++) {
    if (i >= u_nStrikePoints) break;
    vec3 sp = u_strikePoints[i].xyz;
    float intensity = u_strikePoints[i].w;
    float dist = length(v_worldPos - sp);
    float falloff = intensity / (1.0 + dist * dist * 12.0);
    color += u_strikeColor * falloff * 0.35;
  }

  gl_FragColor = vec4(color, 1.0);
}
