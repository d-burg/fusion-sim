import type { ControlRoomContext } from '../types'

/** The one plain key row: text keys with a hard inverse for the active state. */
export default function Console({ ctx }: { ctx: ControlRoomContext }) {
  const speeds = [2, 1, 0.75, 0.5]
  return (
    <div className="dc-console">
      <button className="dc-key dc-key-run" data-on={ctx.running} onClick={() => (ctx.running ? ctx.controls.pause() : ctx.controls.start())}>
        {ctx.running ? 'PAUSE' : 'START'}
      </button>
      <button className="dc-key" onClick={() => ctx.controls.reset()}>RESET</button>
      <span className="dc-sep" />
      <span className="dc-label">SPEED</span>
      {speeds.map((s) => (
        <button key={s} className="dc-key" data-on={ctx.activeSpeed === s} onClick={() => ctx.onSpeedChange(s)}>
          {s === 1 ? '1' : s === 2 ? '2' : s.toFixed(2).replace(/^0/, '')}×
        </button>
      ))}
      <span className="dc-sep" />
      <button className="dc-key" data-on={ctx.showPlanner} onClick={ctx.togglePlanner}>EDIT{ctx.hasCustomProgram ? '*' : ''}</button>
      <span className="dc-sep" />
      <span className="dc-label">DEV</span>
      <select className="dc-sel" value={ctx.activeDevice} onChange={(e) => ctx.onDeviceChange(e.target.value)}>
        {ctx.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <span className="dc-label">SCN</span>
      <select className="dc-sel" value={ctx.activePreset} onChange={(e) => ctx.onPresetChange(e.target.value as typeof ctx.activePreset)}>
        {ctx.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {ctx.showsFuelToggle && (
        <>
          <span className="dc-label">FUEL</span>
          {(['DD', 'DT'] as const).map((f) => (
            <button key={f} className="dc-key" data-on={ctx.fuelType === f} onClick={() => ctx.onFuelChange(f)}>{f}</button>
          ))}
        </>
      )}
      <span className="dc-fill" />
      <span className="dc-settings">{ctx.settingsNode}</span>
    </div>
  )
}
