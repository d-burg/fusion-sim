"""Coronal-equilibrium cooling curves L_z(T_e) from OpenADAS adf11 files.

Reads scd (ionisation), acd (recombination), plt (line power) and prb
(recombination+bremsstrahlung power) for one element, solves the coronal
ionisation balance at a reference density, and prints L_z on the adf11
temperature grid in W m^3.
Usage: python3 -I coronal.py <dir> <element> [log10 ne_cm3]
"""
import sys, math

def read_adf11(path):
    with open(path) as fh:
        lines = fh.read().splitlines()
    head = lines[0].split()
    izmax, nd, nt = int(head[0]), int(head[1]), int(head[2])
    # numbers follow after the first dashed line
    i = 1
    while not lines[i].lstrip().startswith('-'):
        i += 1
    i += 1
    nums = []
    def take(n):
        nonlocal i, nums
        while len(nums) < n:
            nums.extend(float(x) for x in lines[i].split())
            i += 1
        out, nums = nums[:n], nums[n:]
        return out
    dens = take(nd)      # log10 ne [cm^-3]
    temps = take(nt)     # log10 Te [eV]
    blocks = []
    while i < len(lines):
        if lines[i].lstrip().startswith('-'):
            i += 1
            nums = []
            if i >= len(lines) or not lines[i].strip():
                break
            vals = take(nt * nd)
            # stored temperature-major? adf11: for each temperature, nd densities
            blocks.append([vals[t * nd:(t + 1) * nd] for t in range(nt)])
        else:
            i += 1
    return izmax, dens, temps, blocks

def interp_dens(block_t, dens, logne):
    # linear interpolation in log10 ne over the density grid
    if logne <= dens[0]:
        return block_t[0]
    if logne >= dens[-1]:
        return block_t[-1]
    for k in range(len(dens) - 1):
        if dens[k] <= logne <= dens[k + 1]:
            w = (logne - dens[k]) / (dens[k + 1] - dens[k])
            return block_t[k] + w * (block_t[k + 1] - block_t[k])

def main():
    d, el = sys.argv[1], sys.argv[2]
    logne = float(sys.argv[3]) if len(sys.argv) > 3 else 14.0   # 1e20 m^-3
    yr = '89' if el in ('ar','kr','xe') else '96'
    Z, dens, temps, scd = read_adf11(f'{d}/scd{yr}_{el}.dat')
    _, _, _, acd = read_adf11(f'{d}/acd{yr}_{el}.dat')
    _, _, _, plt = read_adf11(f'{d}/plt{yr}_{el}.dat')
    _, _, _, prb = read_adf11(f'{d}/prb{yr}_{el}.dat')
    assert len(scd) == Z and len(acd) == Z and len(plt) == Z and len(prb) == Z, (len(scd), len(acd), len(plt), len(prb), Z)
    print(f'# {el.upper()} Z={Z}  coronal balance at log10(ne/cm^-3)={logne}')
    print('# Te[eV]  Lz[W m^3]  <Z>  Zeff_contrib(Z^2 avg)')
    for t, logT in enumerate(temps):
        # ratios n_{z+1}/n_z = S_z / alpha_{z+1}; adf11 index z = stage z -> z+1 for scd,
        # and acd index z = recombination from z+1 -> z
        ratios = []
        for z in range(Z):
            S = 10 ** interp_dens(scd[z][t], dens, logne)
            A = 10 ** interp_dens(acd[z][t], dens, logne)
            ratios.append(S / A if A > 0 else 1e30)
        frac = [1.0]
        for z in range(Z):
            frac.append(frac[-1] * ratios[z])
        tot = sum(frac)
        frac = [f / tot for f in frac]          # stages 0..Z
        Lz = 0.0
        for z in range(Z):
            P_line = 10 ** interp_dens(plt[z][t], dens, logne)   # W cm^3, from stage z
            P_rec = 10 ** interp_dens(prb[z][t], dens, logne)    # W cm^3, recombining stage z+1
            Lz += frac[z] * P_line + frac[z + 1] * P_rec
        Lz *= 1e-6   # W cm^3 -> W m^3
        zbar = sum(z * frac[z] for z in range(Z + 1))
        z2 = sum(z * z * frac[z] for z in range(Z + 1))
        print(f'{10**logT:12.4g} {Lz:12.4e} {zbar:8.3f} {z2:8.3f}')

main()
