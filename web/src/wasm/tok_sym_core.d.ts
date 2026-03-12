/* tslint:disable */
/* eslint-disable */

/**
 * Opaque handle to a running simulation, held by the JS side.
 */
export class SimHandle {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create from a device id + preset name ("hmode", "lmode", "density_limit").
     */
    static from_preset(device_id: string, preset: string): SimHandle;
    /**
     * Whether the simulation is still running.
     */
    is_running(): boolean;
    /**
     * Create a new simulation from a device id and a JSON discharge program.
     * Returns `None` (throws in JS) if inputs are invalid.
     */
    constructor(device_id: string, program_json: string);
    /**
     * Reset the simulation to t = 0.
     */
    reset(): void;
    /**
     * Get the current status as a string.
     */
    status(): string;
    /**
     * Advance the simulation by `dt` seconds and return the snapshot as JSON.
     * Automatically transitions from Ready → Running on the first step.
     */
    step(dt: number): string;
    /**
     * Current simulation time in seconds.
     */
    time(): number;
    /**
     * Get the device wall outline as JSON array of [r, z] points.
     */
    wall_outline_json(): string;
}

/**
 * Return a single device as JSON, or empty string if not found.
 */
export function get_device_json(id: string): string;

/**
 * Return a JSON array of all available devices.
 */
export function get_devices_json(): string;

/**
 * Return the density-limit scenario as JSON.
 */
export function preset_density_limit_json(device_id: string): string;

/**
 * Return the standard H-mode discharge program as JSON.
 */
export function preset_hmode_json(device_id: string): string;

/**
 * Return the L-mode discharge program as JSON.
 */
export function preset_lmode_json(device_id: string): string;

/**
 * Parse a snapshot JSON string and return just the disruption risk (0..1).
 * Useful for the disruption gauge without parsing the full object in JS.
 */
export function snapshot_disruption_risk(json: string): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_simhandle_free: (a: number, b: number) => void;
    readonly get_device_json: (a: number, b: number) => [number, number];
    readonly get_devices_json: () => [number, number];
    readonly preset_density_limit_json: (a: number, b: number) => [number, number];
    readonly preset_hmode_json: (a: number, b: number) => [number, number];
    readonly preset_lmode_json: (a: number, b: number) => [number, number];
    readonly simhandle_from_preset: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly simhandle_is_running: (a: number) => number;
    readonly simhandle_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly simhandle_reset: (a: number) => void;
    readonly simhandle_status: (a: number) => [number, number];
    readonly simhandle_step: (a: number, b: number) => [number, number];
    readonly simhandle_time: (a: number) => number;
    readonly simhandle_wall_outline_json: (a: number) => [number, number];
    readonly snapshot_disruption_risk: (a: number, b: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
