# Heltec LoRa Live Dashboard Bundle

This project connects the Heltec receiver to the Next.js dashboard:

```text
Heltec receiver -> USB serial COM port -> Node.js bridge -> WebSocket -> Next.js dashboard
```

The bridge is matched to the receiver firmware packet format:

```text
CS1;ID=TX01;N=0;A=23.45;O=24.10;B=76;S=98;IR=84231;RED=73102;F=1
```

## 1. Install the dashboard dependencies

From the `dashDASH` folder:

```powershell
npm install
```

## 2. Configure the dashboard WebSocket URL

Copy the environment template:

```powershell
Copy-Item .env.local.example .env.local
```

The default value is correct when the browser and bridge run on the same laptop:

```env
NEXT_PUBLIC_SERIAL_WS_URL=ws://localhost:8081
```

If the dashboard is opened from another computer, replace `localhost` with the IP address of the computer running the bridge, for example:

```env
NEXT_PUBLIC_SERIAL_WS_URL=ws://192.168.1.25:8081
```

Restart Next.js after changing `.env.local`.

## 3. Install the serial bridge dependencies

Open a second terminal:

```powershell
cd serial-bridge
npm install
```

Find the Heltec port:

```powershell
npm run list-ports
```

Your current port was reported as `COM12`.

## 4. Start the bridge

Close Arduino IDE's Serial Monitor first. Only one program can use the serial port at a time.

```powershell
$env:SERIAL_PORT="COM12"
$env:BAUD_RATE="115200"
$env:WS_PORT="8081"
npm start
```

The receiver firmware contains `Serial.begin(115200)`, so the baud rate must be `115200`.

Expected output:

```text
WebSocket server: ws://localhost:8081
Configured serial port: COM12
Configured baud rate: 115200
Opening serial port COM12...
Serial connection established: COM12 at 115200 baud
```

When a valid LoRa packet arrives, the bridge prints the packet and forwards it to the dashboard.

## 5. Start the dashboard

In a third terminal, from the `dashDASH` folder:

```powershell
npm run dev
```

Open:

```text
http://localhost:3000
```

The dashboard shows:

- Receiver and WebSocket connection status
- Live BPM
- Ambient temperature
- Object temperature
- SpO2
- Finger detection
- RSSI and SNR
- Packet counts and validation rate
- Live event history
- Latest raw packet
- CSV export of the current browser session

## Troubleshooting

### `Opening COM12: File not found`

Run `npm run list-ports` again. The COM number can change when the Heltec is reconnected. Also check Device Manager under **Ports (COM & LPT)**.

### Access denied / port already in use

Close Arduino IDE Serial Monitor, Arduino Serial Plotter, PuTTY, or any other serial application.

### No packets appear

Confirm that the transmitter uses the same LoRa frequency and settings as the receiver. The receiver must be receiving a payload that begins with `CS1;` and matches the complete field layout.

### Bridge is connected but dashboard says disconnected

Confirm that the bridge is running on port `8081`, that `.env.local` contains `NEXT_PUBLIC_SERIAL_WS_URL=ws://localhost:8081`, and restart the Next.js development server.

### Dashboard is opened on another computer

Use the bridge computer's LAN IP in `.env.local`, for example `ws://192.168.1.25:8081`. Allow Node.js through Windows Firewall and ensure both computers are on the same network.

### The Serial Monitor shows data but the bridge does not

Close the Serial Monitor before starting the bridge. Then restart the bridge with the actual COM port and baud rate `115200`.
