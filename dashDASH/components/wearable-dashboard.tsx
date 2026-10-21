'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BatteryCharging,
  Cable,
  Check,
  Download,
  HeartPulse,
  Radio,
  RefreshCw,
  Thermometer,
  Usb,
  Wifi,
  XCircle,
} from 'lucide-react'

type ReceiverPacket = {
  deviceId: string
  packetNumber: number
  ambientTemperature: number
  objectTemperature: number
  bpm: number
  infrared: number
  red: number
  fingerDetected: boolean
  rawPayload: string
  packetSize?: number
  rssi?: number
  snr?: number
}

type BridgeMessage =
  | {
      type: 'bridge_status'
      status: 'connected' | 'disconnected' | 'error'
      serialPort?: string
      baudRate?: number
      packetsReceived?: number
      validPackets?: number
      invalidPackets?: number
      message?: string
    }
  | {
      type: 'packet'
      receivedAt: string
      packetsReceived: number
      validPackets: number
      invalidPackets: number
      packet: ReceiverPacket
    }
  | {
      type: 'invalid_packet'
      receivedAt: string
      raw: string
      reason: string
      packetsReceived: number
      validPackets: number
      invalidPackets: number
    }
  | {
      type: 'serial_log'
      receivedAt: string
      line: string
    }

type EventRecord = {
  receivedAt: string
  packet: ReceiverPacket
}

function formatTime(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString([], { hour12: false })
}

function formatValue(value: number | undefined, decimals = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : '—'
}

function StatusPill({ state }: { state: string }) {
  const styles = state === 'NORMAL'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : state === 'WARNING'
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : 'bg-slate-100 text-slate-600 ring-slate-200'

  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold tracking-wide ring-1 ${styles}`}><span className="size-1.5 rounded-full bg-current" />{state}</span>
}

function MiniChart({ values, color, min, max }: { values: number[]; color: string; min: number; max: number }) {
  const points = values.length > 1
    ? values.map((value, index) => {
        const x = (index / (values.length - 1)) * 308
        const y = 58 - ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 50
        return `${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')
    : '0,40 308,40'

  return <div className="relative h-24 overflow-hidden rounded-lg bg-slate-50/70"><svg viewBox="0 0 308 64" preserveAspectRatio="none" className="absolute inset-0 h-full w-full"><path d={`M ${points}`} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /><path d={`M 0,64 L ${points} L 308,64 Z`} fill={color} opacity=".08" /></svg><div className="absolute inset-x-3 bottom-2 flex justify-between text-[9px] text-slate-400"><span>Recent</span><span>Live</span></div></div>
}

export default function WearableDashboard() {
  const [bridgeConnected, setBridgeConnected] = useState(false)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [serialPort, setSerialPort] = useState('—')
  const [latestPacket, setLatestPacket] = useState<ReceiverPacket | null>(null)
  const [events, setEvents] = useState<EventRecord[]>([])
  const [packetCount, setPacketCount] = useState(0)
  const [validPacketCount, setValidPacketCount] = useState(0)
  const [invalidPacketCount, setInvalidPacketCount] = useState(0)
  const [lastReceivedAt, setLastReceivedAt] = useState<string | undefined>()
  const [filter, setFilter] = useState('All events')

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SERIAL_WS_URL || 'ws://localhost:8081'
    const socket = new WebSocket(url)

    socket.onopen = () => setBridgeError(null)

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as BridgeMessage

        if (message.type === 'bridge_status') {
          setBridgeConnected(message.status === 'connected')
          setSerialPort(message.serialPort || '—')
          setBridgeError(message.status === 'error' ? message.message || 'Serial bridge error' : null)
          if (typeof message.packetsReceived === 'number') setPacketCount(message.packetsReceived)
          if (typeof message.validPackets === 'number') setValidPacketCount(message.validPackets)
          if (typeof message.invalidPackets === 'number') setInvalidPacketCount(message.invalidPackets)
        }

        if (message.type === 'packet') {
          setBridgeConnected(true)
          setBridgeError(null)
          setLatestPacket(message.packet)
          setEvents((current) => [{ receivedAt: message.receivedAt, packet: message.packet }, ...current].slice(0, 100))
          setPacketCount(message.packetsReceived)
          setValidPacketCount(message.validPackets)
          setInvalidPacketCount(message.invalidPackets)
          setLastReceivedAt(message.receivedAt)
        }

        if (message.type === 'invalid_packet') {
          setPacketCount(message.packetsReceived)
          setValidPacketCount(message.validPackets)
          setInvalidPacketCount(message.invalidPackets)
          setBridgeError(message.reason)
        }
      } catch {
        setBridgeError('Received an unreadable message from the serial bridge')
      }
    }

    socket.onerror = () => {
      setBridgeConnected(false)
      setBridgeError(`Cannot connect to ${url}`)
    }

    socket.onclose = () => setBridgeConnected(false)
    return () => socket.close()
  }, [])

  const filteredEvents = useMemo(() => {
    if (filter === 'All events') return events
    if (filter === 'FINGER') return events.filter(({ packet }) => packet.fingerDetected)
    return events.filter(({ packet }) => packet.bpm >= 100)
  }, [events, filter])

  const bpmValues = events.slice(0, 24).reverse().map(({ packet }) => packet.bpm).filter(Number.isFinite)
  const tempValues = events.slice(0, 24).reverse().map(({ packet }) => packet.objectTemperature).filter(Number.isFinite)
  const latest = latestPacket
  const riskState = latest && latest.bpm >= 100 ? 'WARNING' : latest ? 'NORMAL' : 'UNKNOWN'
  const validRate = packetCount > 0 ? ((validPacketCount / packetCount) * 100).toFixed(1) : '—'

  function exportCsv() {
    const header = 'received_time,device_id,packet_number,ambient_temperature,object_temperature,bpm,infrared,red,finger_detected,packet_size,rssi,snr,raw_payload'
    const rows = events.map(({ receivedAt, packet }) => [
      receivedAt,
      packet.deviceId,
      packet.packetNumber,
      packet.ambientTemperature,
      packet.objectTemperature,
      packet.bpm,
      packet.infrared,
      packet.red,
      packet.fingerDetected,
      packet.packetSize ?? '',
      packet.rssi ?? '',
      packet.snr ?? '',
      JSON.stringify(packet.rawPayload),
    ].join(','))
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([[header, ...rows].join('\n')], { type: 'text/csv' }))
    link.download = 'lora-events.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return <main className="min-h-screen bg-[#f5f7f8] text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-7 py-4"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-[#123c4a] text-white"><Activity size={19} /></div><div><p className="text-[15px] font-bold tracking-tight">PulseGuard</p><p className="text-[11px] text-slate-500">Live Heltec LoRa monitor</p></div></div><div className="flex items-center gap-5 text-xs"><div className="flex items-center gap-2 text-slate-500"><span className={`size-2 rounded-full ${bridgeConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />Receiver {bridgeConnected ? 'connected' : 'disconnected'}</div><div className="hidden h-5 w-px bg-slate-200 sm:block" /><div className="text-slate-500">Serial <span className="font-mono text-slate-700">{serialPort}</span></div><button aria-label="Refresh dashboard" onClick={() => window.location.reload()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><RefreshCw size={16} /></button></div></div></header>
    <div className="mx-auto max-w-[1500px] px-7 py-7"><div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.18em] text-[#4b7280]"><span className={`size-2 rounded-full ${bridgeConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />{bridgeConnected ? 'Live monitoring' : 'Waiting for bridge'}</div><h1 className="text-2xl font-semibold tracking-tight">Wearable status overview</h1><p className="mt-1 text-sm text-slate-500">Live data from the Heltec SX1276 receiver via USB serial</p></div><div className="flex gap-2"><button onClick={exportCsv} disabled={!events.length} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><Download size={15} />Export CSV</button></div></div>
      {bridgeError && <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"><strong>Bridge message:</strong> {bridgeError}. Start the Node bridge and confirm the Heltec is connected on {serialPort === '—' ? 'the configured port' : serialPort}.</div>}
      <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr]"><div className={`rounded-xl border p-5 shadow-sm ${riskState === 'WARNING' ? 'border-amber-200 bg-[#fffaf0]' : 'border-emerald-200 bg-emerald-50/40'}`}><div className="flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.16em] text-slate-500">Current signal state</p><p className={`mt-3 text-4xl font-semibold tracking-tight ${riskState === 'WARNING' ? 'text-amber-700' : 'text-emerald-700'}`}>{riskState}</p><p className="mt-1 text-sm font-medium text-slate-700">{latest ? (latest.fingerDetected ? 'Finger detected' : 'No finger detected') : 'Waiting for packet'}</p></div><Radio className={riskState === 'WARNING' ? 'text-amber-500' : 'text-emerald-500'} size={24} /></div><div className="mt-5 border-t border-slate-200 pt-3 text-[11px] text-slate-600"><span className="font-semibold">Device</span><span className="ml-3 rounded bg-white/80 px-2 py-1 font-mono">{latest?.deviceId || '—'}</span></div></div><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-[11px] font-bold uppercase tracking-[.16em] text-slate-500">Device status</p><div className="mt-4 flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><Radio size={21} /></div><div><p className="text-xl font-semibold">{latest ? 'ACTIVE' : 'WAITING'}</p><p className="text-xs text-slate-500">{latest?.deviceId || 'No transmitter yet'}</p></div></div><div className="mt-5 flex items-center gap-2 text-[11px] text-emerald-700"><Check size={14} />{latest ? 'Packet received' : 'Awaiting LoRa packet'}</div></div><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-[11px] font-bold uppercase tracking-[.16em] text-slate-500">Latest vitals</p><div className="mt-4 grid grid-cols-2 gap-4"><div><div className="flex items-center gap-1.5 text-xs text-slate-500"><HeartPulse size={14} className="text-[#e05d4f]" />Heart rate</div><p className="mt-1 text-2xl font-semibold">{latest?.bpm >= 0 ? latest.bpm : '—'} <span className="text-xs font-normal text-slate-500">bpm</span></p></div><div><div className="flex items-center gap-1.5 text-xs text-slate-500"><Thermometer size={14} className="text-[#3b82a6]" />Object temp</div><p className="mt-1 text-2xl font-semibold">{formatValue(latest?.objectTemperature)} <span className="text-xs font-normal text-slate-500">°C</span></p></div></div><p className="mt-4 text-[11px] text-slate-500">Last event <span className="font-mono text-slate-700">{formatTime(lastReceivedAt)}</span></p></div></section>
      <section className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_1fr]"><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Live signal trends</h2><p className="mt-0.5 text-xs text-slate-500">Recent packets received from the bridge</p></div><span className="flex items-center gap-1.5 text-[10px] text-slate-500"><span className="size-2 rounded-full bg-[#e05d4f]" />BPM <span className="ml-2 size-2 rounded-full bg-[#3b82a6]" />Temp</span></div><div className="grid gap-5 sm:grid-cols-2"><div><div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium text-slate-600">Heart rate</span><span className="font-mono text-slate-400">BPM</span></div><MiniChart values={bpmValues} color="#e05d4f" min={40} max={180} /></div><div><div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium text-slate-600">Object temperature</span><span className="font-mono text-slate-400">°C</span></div><MiniChart values={tempValues} color="#3b82a6" min={0} max={100} /></div></div></div><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><h2 className="font-semibold">Receiver communication</h2><p className="mt-0.5 text-xs text-slate-500">USB serial input diagnostics</p></div><Wifi size={17} className={bridgeConnected ? 'text-emerald-600' : 'text-slate-400'} /></div><div className="mt-5 grid grid-cols-3 gap-4"><div><p className="text-[10px] uppercase tracking-wider text-slate-400">Packets</p><p className="mt-1 text-2xl font-semibold">{packetCount}</p></div><div><p className="text-[10px] uppercase tracking-wider text-slate-400">Valid</p><p className="mt-1 text-2xl font-semibold text-emerald-600">{validRate}%</p></div><div><p className="text-[10px] uppercase tracking-wider text-slate-400">Invalid</p><p className="mt-1 text-2xl font-semibold text-amber-600">{invalidPacketCount}</p></div></div><div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-xs"><div><span className="text-slate-400">Last packet</span><p className="mt-1 font-mono">{formatTime(lastReceivedAt)}</p></div><div><span className="text-slate-400">RSSI</span><p className="mt-1 font-mono">{latest?.rssi ?? '—'} dBm</p></div><div><span className="text-slate-400">SNR</span><p className="mt-1 font-mono">{latest?.snr ?? '—'} dB</p></div></div></div></section>
      <section className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 className="font-semibold">Event history</h2><p className="mt-0.5 text-xs text-slate-500">Live packets held in the browser session · {events.length} shown</p></div><div className="flex items-center gap-2"><select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none"><option>All events</option><option>FINGER</option><option>HIGH BPM</option></select></div></div><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400"><tr>{['Time', 'Device', 'Packet', 'Ambient', 'Object', 'BPM', 'Finger', 'RSSI', 'SNR'].map((head) => <th key={head} className="px-5 py-3 font-semibold">{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{filteredEvents.map(({ receivedAt, packet }) => <tr key={`${receivedAt}-${packet.packetNumber}`} className="hover:bg-slate-50/70"><td className="whitespace-nowrap px-5 py-3.5 font-mono text-[11px] text-slate-600">{formatTime(receivedAt)}</td><td className="whitespace-nowrap px-5 py-3.5 font-mono text-[11px] text-slate-600">{packet.deviceId}</td><td className="px-5 py-3.5 text-slate-600">{packet.packetNumber}</td><td className="px-5 py-3.5 text-slate-600">{formatValue(packet.ambientTemperature)}°C</td><td className="px-5 py-3.5 text-slate-600">{formatValue(packet.objectTemperature)}°C</td><td className="px-5 py-3.5 text-slate-600">{packet.bpm}</td><td className="px-5 py-3.5"><StatusPill state={packet.fingerDetected ? 'NORMAL' : 'UNKNOWN'} /></td><td className="px-5 py-3.5 text-slate-600">{packet.rssi ?? '—'}</td><td className="px-5 py-3.5 text-slate-600">{packet.snr ?? '—'}</td></tr>)}</tbody></table>{!filteredEvents.length && <p className="px-5 py-10 text-center text-xs text-slate-400">No packets received yet. Start the serial bridge and send a LoRa packet.</p>}</div></section>
      <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.35fr]"><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Connection setup</h2><p className="mt-0.5 text-xs text-slate-500">Configuration is controlled by the Node bridge</p></div><Cable size={17} className="text-slate-400" /></div><div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs"><p className="font-medium text-slate-700">Serial port</p><p className="mt-1 font-mono text-slate-500">{serialPort}</p><p className="mt-3 font-medium text-slate-700">WebSocket</p><p className="mt-1 break-all font-mono text-slate-500">{process.env.NEXT_PUBLIC_SERIAL_WS_URL || 'ws://localhost:8081'}</p></div><div className="mt-4 flex items-center gap-2 text-xs"><span className={`size-2 rounded-full ${bridgeConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />{bridgeConnected ? 'Bridge connected' : 'Bridge disconnected'}</div></div><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Latest raw packet</h2><p className="mt-0.5 text-xs text-slate-500">Data received from the Heltec firmware</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{latest ? 'RECEIVED' : 'NO DATA'}</span></div><div className="mt-5 rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-5 text-slate-300 break-all">{latest?.rawPayload || 'Waiting for a CS1 packet...'}</div><div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-2"><p><Check size={13} className="mr-1 inline text-emerald-500" />Packet format validated by bridge</p><p><Check size={13} className="mr-1 inline text-emerald-500" />WebSocket forwarding enabled</p></div></div></section>
      <footer className="flex flex-wrap items-center justify-between gap-2 py-6 text-[11px] text-slate-400"><span>PulseGuard · Heltec LoRa live monitor</span><span>Bridge: <strong className="font-medium text-slate-500">{bridgeConnected ? 'connected' : 'offline'}</strong></span></footer>
    </div>
  </main>
}
