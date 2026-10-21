'use strict'

const { SerialPort } = require('serialport')
const { ReadlineParser } = require('@serialport/parser-readline')
const { WebSocketServer } = require('ws')

const SERIAL_PORT_PATH = process.env.SERIAL_PORT || 'COM4'
const BAUD_RATE = Number(process.env.BAUD_RATE || 115200)
const WEBSOCKET_PORT = Number(process.env.WS_PORT || 8081)

const clients = new Set()

let serialPort = null
let serialParser = null
let reconnectTimer = null
let stopping = false

let packetsReceived = 0
let validPackets = 0
let invalidPackets = 0

let pendingPacket = null
let pendingPacketTimer = null

const webSocketServer = new WebSocketServer({
  port: WEBSOCKET_PORT,
})

console.log(`WebSocket server: ws://localhost:${WEBSOCKET_PORT}`)
console.log(`Configured serial port: ${SERIAL_PORT_PATH}`)
console.log(`Configured baud rate: ${BAUD_RATE}`)

webSocketServer.on('connection', (socket) => {
  clients.add(socket)
  console.log('Dashboard WebSocket client connected')

  send(socket, {
    type: 'bridge_status',
    status: serialPort?.isOpen ? 'connected' : 'disconnected',
    serialPort: SERIAL_PORT_PATH,
    baudRate: BAUD_RATE,
    packetsReceived,
    validPackets,
    invalidPackets,
  })

  socket.on('close', () => {
    clients.delete(socket)
    console.log('Dashboard WebSocket client disconnected')
  })

  socket.on('error', () => {
    clients.delete(socket)
  })
})

function send(socket, message) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message))
  }
}

function broadcast(message) {
  const serializedMessage = JSON.stringify(message)

  for (const socket of clients) {
    if (socket.readyState === 1) {
      socket.send(serializedMessage)
    }
  }
}

function sendBridgeStatus(status, extra = {}) {
  broadcast({
    type: 'bridge_status',
    status,
    serialPort: SERIAL_PORT_PATH,
    baudRate: BAUD_RATE,
    packetsReceived,
    validPackets,
    invalidPackets,
    ...extra,
  })
}

/**
 * Parses the exact payload produced by the Heltec receiver:
 *
 * CS1;ID=TX01;N=0;A=23.45;O=24.10;B=76;S=98;IR=84231;RED=73102;F=1
 */
function parseLoRaPayload(payload) {
  const text = payload.trim()

  const match = text.match(
    /^CS1;ID=([^;]+);N=(\d+);A=(-?\d+(?:\.\d+)?);O=(-?\d+(?:\.\d+)?);B=(-?\d+);S=(-?\d+);IR=(\d+);RED=(\d+);F=(0|1)$/,
  )

  if (!match) {
    return null
  }

  const [
    ,
    deviceId,
    packetNumber,
    ambientTemperature,
    objectTemperature,
    bpm,
    spo2,
    infrared,
    red,
    finger,
  ] = match

  const parsed = {
    deviceId,
    packetNumber: Number(packetNumber),
    ambientTemperature: Number(ambientTemperature),
    objectTemperature: Number(objectTemperature),
    bpm: Number(bpm),
    spo2: Number(spo2),
    infrared: Number(infrared),
    red: Number(red),
    fingerDetected: finger === '1',
    rawPayload: text,
  }

  if (!Number.isFinite(parsed.ambientTemperature) || parsed.ambientTemperature < -40 || parsed.ambientTemperature > 125) {
    return null
  }

  if (!Number.isFinite(parsed.objectTemperature) || parsed.objectTemperature < -70 || parsed.objectTemperature > 380) {
    return null
  }

  if (parsed.bpm !== -1 && (parsed.bpm < 30 || parsed.bpm > 240)) {
    return null
  }

  if (parsed.spo2 !== -1 && (parsed.spo2 < 70 || parsed.spo2 > 100)) {
    return null
  }

  return parsed
}

/**
 * Parses the receiver's radio statistics line:
 *
 * Size: 62, RSSI: -48 dBm, SNR: 9 dB
 */
function parseRadioStats(line) {
  const match = line.match(
    /^Size:\s*(\d+),\s*RSSI:\s*(-?\d+)\s*dBm,\s*SNR:\s*(-?\d+(?:\.\d+)?)\s*dB\s*$/,
  )

  if (!match) {
    return null
  }

  return {
    packetSize: Number(match[1]),
    rssi: Number(match[2]),
    snr: Number(match[3]),
  }
}

function emitInvalidPacket(rawLine, reason) {
  invalidPackets += 1

  broadcast({
    type: 'invalid_packet',
    receivedAt: new Date().toISOString(),
    raw: rawLine,
    reason,
    packetsReceived,
    validPackets,
    invalidPackets,
  })
}

function emitPacket(payload, radioStats = null) {
  packetsReceived += 1

  const parsedPayload = parseLoRaPayload(payload)

  if (!parsedPayload) {
    emitInvalidPacket(payload, 'Unrecognized or invalid LoRa payload')
    return
  }

  validPackets += 1

  const packet = {
    ...parsedPayload,
    ...(radioStats || {}),
  }

  const message = {
    type: 'packet',
    receivedAt: new Date().toISOString(),
    packetsReceived,
    validPackets,
    invalidPackets,
    packet,
  }

  console.log('Valid packet:', JSON.stringify(packet))
  broadcast(message)
}

function flushPendingPacket() {
  if (!pendingPacket) {
    return
  }

  const payload = pendingPacket
  pendingPacket = null

  if (pendingPacketTimer) {
    clearTimeout(pendingPacketTimer)
    pendingPacketTimer = null
  }

  emitPacket(payload, null)
}

function handleSerialLine(line) {
  const trimmedLine = line.trim()

  if (!trimmedLine) {
    return
  }

  console.log(`[SERIAL] ${trimmedLine}`)

  if (trimmedLine.startsWith('Packet:')) {
    if (pendingPacket) {
      flushPendingPacket()
    }

    pendingPacket = trimmedLine.slice('Packet:'.length).trim()

    pendingPacketTimer = setTimeout(() => {
      flushPendingPacket()
    }, 500)

    return
  }

  const radioStats = parseRadioStats(trimmedLine)

  if (radioStats && pendingPacket) {
    const payload = pendingPacket
    pendingPacket = null

    if (pendingPacketTimer) {
      clearTimeout(pendingPacketTimer)
      pendingPacketTimer = null
    }

    emitPacket(payload, radioStats)
    return
  }

  if (trimmedLine.includes('Ignored malformed or invalid packet.')) {
    packetsReceived += 1
    emitInvalidPacket(trimmedLine, 'Receiver rejected the packet')
  }

  if (trimmedLine.startsWith('RX ignored: packet too long')) {
    packetsReceived += 1
    emitInvalidPacket(trimmedLine, 'Receiver reported a packet that was too long')
  }

  broadcast({
    type: 'serial_log',
    receivedAt: new Date().toISOString(),
    line: trimmedLine,
  })
}

function scheduleReconnect() {
  if (stopping || reconnectTimer) {
    return
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    openSerialPort()
  }, 3000)

  console.log('Retrying serial connection in 3 seconds...')
}

function openSerialPort() {
  if (stopping || serialPort?.isOpen) {
    return
  }

  console.log(`Opening serial port ${SERIAL_PORT_PATH}...`)

  serialPort = new SerialPort({
    path: SERIAL_PORT_PATH,
    baudRate: BAUD_RATE,
    autoOpen: false,
  })

  serialParser = serialPort.pipe(
    new ReadlineParser({
      delimiter: '\n',
    }),
  )

  serialParser.on('data', handleSerialLine)

  serialPort.on('open', () => {
    console.log(`Serial connection established: ${SERIAL_PORT_PATH} at ${BAUD_RATE} baud`)
    sendBridgeStatus('connected')
  })

  serialPort.on('error', (error) => {
    console.error(`Serial error: ${error.message}`)
    sendBridgeStatus('error', { message: error.message })
  })

  serialPort.on('close', () => {
    console.log('Serial connection closed')
    sendBridgeStatus('disconnected')
    scheduleReconnect()
  })

  serialPort.open((error) => {
    if (error) {
      console.error(`Unable to open serial port: ${error.message}`)
      sendBridgeStatus('error', { message: error.message })
      scheduleReconnect()
    }
  })
}

function shutdown() {
  if (stopping) {
    return
  }

  stopping = true

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (pendingPacketTimer) {
    clearTimeout(pendingPacketTimer)
    pendingPacketTimer = null
  }

  const closeWebSocketServer = () => {
    webSocketServer.close(() => process.exit(0))
  }

  if (serialPort?.isOpen) {
    serialPort.close(closeWebSocketServer)
  } else {
    closeWebSocketServer()
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

openSerialPort()
