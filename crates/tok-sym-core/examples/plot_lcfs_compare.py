#!/usr/bin/env python3
"""Compare the plasma boundary before and after the Cerfon-Freidberg basis
corrections (github issue #2).

Consumes JSON files produced by the `lcfs_export` example, one run per state
of the code, and overlays them:

    python3 plot_lcfs_compare.py out_prefix label=file.json [label=file.json ...]

e.g.

    python3 plot_lcfs_compare.py out \
        baseline=state_a.json "basis fix=state_b.json" "+N1/N2=state_c.json"

The LAST state given is treated as the reference for displacement metrics.

Two figures are written:

  <prefix>.png/pdf       ψ = 0 separatrix (legs included) plus the closed
                         ψ_N = 0.995 surface, before vs after, per device
  <prefix>_deviation     radial displacement of the closed surface as a
                         function of poloidal angle — how far the boundary
                         actually moved

Diagnostic figures, not publication figures.
"""
import json
import sys

import matplotlib.pyplot as plt
import numpy as np

# Wong colourblind-safe palette
PALETTE = ["#D55E00", "#009E73", "#0072B2", "#CC79A7", "#E69F00"]
STYLES = ["--", "-.", "-", ":", "-"]
WALL = "#999999"

# Marching-squares chains are concatenated with jumps between them; split the
# polyline wherever consecutive points are further apart than this (metres),
# matching the renderer's convention, so divertor legs are not joined by
# spurious straight lines.
JUMP = 0.15


def chains(points):
    """Split a concatenated contour point list into continuous chains."""
    pts = np.asarray(points, dtype=float)
    if len(pts) < 2:
        return []
    d = np.hypot(np.diff(pts[:, 0]), np.diff(pts[:, 1]))
    breaks = np.flatnonzero(d > JUMP) + 1
    return [c for c in np.split(pts, breaks) if len(c) > 1]


def closed_surface(points, axis):
    """Return the chain that encircles the magnetic axis, as (r, z) arrays."""
    best, best_wind = None, 0.0
    for c in chains(points):
        ang = np.unwrap(np.arctan2(c[:, 1] - axis[1], c[:, 0] - axis[0]))
        wind = abs(ang[-1] - ang[0]) / (2 * np.pi)
        if wind > best_wind:
            best, best_wind = c, wind
    return best, best_wind


def shape_metrics(surface, axis):
    """κ, δ and extrema measured on a closed boundary."""
    r, z = surface[:, 0], surface[:, 1]
    r_in, r_out = r.min(), r.max()
    i_top, i_bot = int(np.argmax(z)), int(np.argmin(z))
    a = 0.5 * (r_out - r_in)
    r_geo = 0.5 * (r_out + r_in)
    return {
        "r_in": r_in,
        "r_out": r_out,
        "z_top": z[i_top],
        "z_bot": z[i_bot],
        "a": a,
        "r_geo": r_geo,
        "kappa": 0.5 * (z[i_top] - z[i_bot]) / a,
        "delta_upper": (r_geo - r[i_top]) / a,
        "delta_lower": (r_geo - r[i_bot]) / a,
    }


def separation(a, b):
    """Distance from every point of `a` to the polyline `b`.

    A radius-at-fixed-poloidal-angle comparison exaggerates the displacement
    wherever the boundary runs nearly radially from the axis (the crown of a
    negative-triangularity double null, for instance), so the true
    point-to-segment distance is used instead.
    """
    p0, p1 = b[:-1], b[1:]
    seg = p1 - p0
    seg_len2 = np.einsum("ij,ij->i", seg, seg)
    seg_len2[seg_len2 == 0] = 1e-30
    # (n_a, n_seg) projection parameter, clamped to the segment
    d = a[:, None, :] - p0[None, :, :]
    t = np.clip(np.einsum("nij,ij->ni", d, seg) / seg_len2, 0.0, 1.0)
    closest = p0[None, :, :] + t[:, :, None] * seg[None, :, :]
    return np.min(np.hypot(*(a[:, None, :] - closest).transpose(2, 0, 1)), axis=1)


def poloidal_angle(surface, axis):
    """Poloidal angle of each boundary point about the magnetic axis (deg)."""
    return np.degrees(
        np.mod(
            np.arctan2(surface[:, 1] - axis[1], surface[:, 0] - axis[0]),
            2 * np.pi,
        )
    )


def target_boundary(d, n=1441):
    """The analytic Cerfon-Freidberg boundary the solver is asked to hit:

        R = R₀(1 + ε cos(τ + arcsin(δ) sin τ)),  Z = z₀ + R₀ εκ sin τ

    R₀ and z₀ of the *equilibrium* (including any r0 shift) are recovered
    from the exported grid bounds, which are symmetric about them.
    """
    b = d["bounds"]
    r0, z0 = (b[0] + b[1]) / 2.0, (b[2] + b[3]) / 2.0
    eps, kap, dl = d["epsilon_input"], d["kappa_input"], d["delta_input"]
    t = np.linspace(0, 2 * np.pi, n)
    a = np.arcsin(dl)
    return np.column_stack(
        [r0 * (1.0 + eps * np.cos(t + a * np.sin(t))), z0 + r0 * eps * kap * np.sin(t)]
    )


def plot_contour(ax, points, colour, label, **kw):
    first = True
    for chain in chains(points):
        ax.plot(
            chain[:, 0],
            chain[:, 1],
            color=colour,
            label=label if first else None,
            **kw,
        )
        first = False


def main():
    prefix = sys.argv[1]
    states = []
    for arg in sys.argv[2:]:
        label, _, path = arg.partition("=")
        states.append((label, {d["id"]: d for d in json.load(open(path))["devices"]}))

    ref_label, ref = states[-1]
    ids = list(ref.keys())
    ncols = 3
    nrows = int(np.ceil(len(ids) / ncols))

    fig, axes = plt.subplots(nrows, ncols, figsize=(4.4 * ncols, 5.4 * nrows))
    axes = np.atleast_1d(axes).ravel()

    summary = []

    for ax, did in zip(axes, ids):
        r = ref[did]

        wall = np.asarray(r["wall"], dtype=float)
        if len(wall) > 2:
            ax.plot(
                np.append(wall[:, 0], wall[0, 0]),
                np.append(wall[:, 1], wall[0, 1]),
                color=WALL,
                lw=1.0,
                zorder=1,
            )

        # The shape actually requested, as a reference for "better or worse".
        tgt = target_boundary(r)
        ax.plot(tgt[:, 0], tgt[:, 1], color="k", lw=1.4, ls=(0, (1, 1.5)),
                zorder=30, label="requested shape")

        lvl = r["core_level"]
        surfaces = {}
        for i, (label, state) in enumerate(states):
            d = state[did]
            colour, style = PALETTE[i % len(PALETTE)], STYLES[i % len(STYLES)]
            last = i == len(states) - 1
            # ψ = 0 (legs and, for DN, split branches) as faint context.
            plot_contour(ax, d["separatrix"], colour, None, lw=1.2, alpha=0.55,
                         zorder=2 + i)
            surf, _ = closed_surface(d["core_surface"], d["axis"])
            surfaces[label] = (surf, d)
            ax.plot(surf[:, 0], surf[:, 1], color=colour, lw=2.2 if last else 1.7,
                    ls=style, zorder=10 + i, label=label)
            ax.plot(*d["axis"], marker="x" if last else "+", color=colour,
                    ms=8, mew=1.5, zorder=20 + i)

        base_label = states[0][0]
        sb = surfaces[base_label][0]
        sr = surfaces[ref_label][0]
        mb = shape_metrics(sb, surfaces[base_label][1]["axis"])
        ma = shape_metrics(sr, r["axis"])
        sep_dist = separation(sb, sr)
        summary.append(
            (did, r["name"], mb, ma, poloidal_angle(sb, surfaces[base_label][1]["axis"]),
             sep_dist, r.get("min_wall_clearance_mm", -1.0),
             r.get("points_outside_wall", 0))
        )

        # Title from the FIRST state: the reference state's kappa_input carries
        # its own kappa_scale, which would misreport the device's target.
        first = states[0][1][did]
        ax.set_title(
            f"{r['name']}  ({r['config']})\n"
            rf"$\kappa$={first['kappa_input']:.2f}, $\delta$={first['delta_input']:.2f}"
            f"  ({states[0][0]})",
            fontsize=10,
        )
        ax.text(
            0.03,
            0.02,
            rf"$\psi_N$={lvl}, {base_label} $\to$ {ref_label}:"
            "\n"
            rf"$\kappa$ {mb['kappa']:.3f}$\to${ma['kappa']:.3f},  "
            rf"$\delta_u$ {mb['delta_upper']:.3f}$\to${ma['delta_upper']:.3f}"
            "\n"
            rf"max shift {sep_dist.max() * 1e3:.0f} mm,  "
            rf"wall gap {r.get('min_wall_clearance_mm', -1):.0f} mm"
            "\n"
            + "RMS vs requested: "
            + ", ".join(
                f"{lab} {np.sqrt((separation(target_boundary(state[did]), surfaces[lab][0]) ** 2).mean()) * 1e3:.0f}"
                for lab, state in states
            )
            + " mm",
            transform=ax.transAxes,
            fontsize=7.5,
            va="bottom",
            ha="left",
            bbox=dict(boxstyle="round,pad=0.35", fc="white", ec="0.8", alpha=0.9),
        )

        ax.set_aspect("equal")
        ax.set_xlabel("R (m)")
        ax.set_ylabel("Z (m)")
        ax.grid(True, ls=":", lw=0.5, alpha=0.6)
        ax.legend(loc="upper right", fontsize=7, framealpha=0.9)
        # Frame the whole vessel, not just the equilibrium grid, so the
        # divertor legs and their strike points are actually visible.
        if len(wall) > 2:
            pad = 0.04 * max(
                wall[:, 0].max() - wall[:, 0].min(),
                wall[:, 1].max() - wall[:, 1].min(),
            )
            # 'datalim' lets the equal-aspect constraint widen the limits to
            # fit the box; the default 'box' shrinks the box instead and
            # silently clips the vessel.
            ax.set_adjustable("datalim")
            ax.set_xlim(wall[:, 0].min() - pad, wall[:, 0].max() + pad)
            ax.set_ylim(wall[:, 1].min() - pad, wall[:, 1].max() + pad)

    for ax in axes[len(ids):]:
        ax.axis("off")

    fig.suptitle(
        "Plasma boundary at shipped defaults (issue #2)\n"
        "bold = closed $\\psi_N$ surface, faint = full $\\psi$=0 separatrix",
        fontsize=12,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    fig.savefig(f"{prefix}.png", dpi=150)
    fig.savefig(f"{prefix}.pdf")

    # ── deviation figure ───────────────────────────────────────────────────
    fig2, ax2 = plt.subplots(figsize=(9, 4.6))
    for _, name, _, _, ang, dev, _, _ in summary:
        order = np.argsort(ang)
        ax2.plot(ang[order], dev[order] * 1e3, lw=1.8, label=name)
    ax2.axvspan(60, 120, color="0.9", zorder=0)
    ax2.axvspan(240, 300, color="0.9", zorder=0)
    ax2.text(90, ax2.get_ylim()[1] * 0.96, "crown", ha="center", va="top", fontsize=8, color="0.4")
    ax2.text(270, ax2.get_ylim()[1] * 0.96, "crown", ha="center", va="top", fontsize=8, color="0.4")
    ax2.set_xlabel("poloidal angle about the magnetic axis (deg)")
    ax2.set_ylabel("boundary displacement (mm)")
    ax2.set_title(
        rf"How far the closed $\psi_N$={lvl} surface moved, "
        f"{states[0][0]} $\\to$ {ref_label}"
        "\n(point-to-curve distance; 0° = outboard midplane, 90° = top)",
        fontsize=11,
    )
    ax2.set_xlim(0, 360)
    ax2.set_xticks(range(0, 361, 45))
    ax2.grid(True, ls=":", lw=0.5, alpha=0.6)
    ax2.legend(fontsize=9)
    fig2.tight_layout()
    fig2.savefig(f"{prefix}_deviation.png", dpi=150)
    fig2.savefig(f"{prefix}_deviation.pdf")

    # ── console summary ────────────────────────────────────────────────────
    hdr = (
        f"{'device':9s} {'kappa 1st':>10s} {'last':>8s} {'d_up 1st':>10s} "
        f"{'last':>8s} {'d_lo 1st':>10s} {'last':>8s} {'max shift':>10s} "
        f"{'wall gap':>9s} {'outside':>8s}"
    )
    print(f"states: {' -> '.join(l for l, _ in states)}")
    print(hdr)
    print("-" * len(hdr))
    for did, _, mb, ma, _, dev, clear, n_out in summary:
        print(
            f"{did:9s} {mb['kappa']:10.4f} {ma['kappa']:8.4f} "
            f"{mb['delta_upper']:10.4f} {ma['delta_upper']:8.4f} "
            f"{mb['delta_lower']:10.4f} {ma['delta_lower']:8.4f} "
            f"{dev.max() * 1e3:8.1f}mm {clear:7.1f}mm {n_out:8d}"
        )
    print(f"\nwrote {prefix}.png/.pdf and {prefix}_deviation.png/.pdf")


if __name__ == "__main__":
    main()
