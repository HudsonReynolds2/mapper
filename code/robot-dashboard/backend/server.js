// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 5000;
const framesDir = path.join(__dirname, 'frames');
if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir);

app.get('/', (req, res) => {
  res.send('Backend is running');
});

let dashboardSockets = [];
let piSockets = [];
let recordingState = 'off'; // 'off' | 'on' | 'paused'
let currentSessionDir = null;
let frameCounter = 0;

wss.on('connection', (ws) => {
  console.log("🟢 WebSocket connection received");
  ws.send(JSON.stringify({ type: 'status', connected: false }));

  let sshStream = null;

  ws.on('message', async (msg) => {
    const str = msg.toString();
    console.log("📨 Received message:", str);

    try {
      const data = JSON.parse(str);

      if (data.type === 'auth') {
        const { username, host, password } = data;
        console.log(`🔐 Attempting SSH to ${username}@${host}...`);

        const ssh = new Client();
        ssh.on('ready', () => {
          console.log('✅ SSH connection established.');
          ws.send(JSON.stringify({ type: 'status', connected: true }));

          ssh.shell((err, stream) => {
            if (err) {
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to open shell' }));
              return;
            }

            sshStream = stream;
            stream.write('python3 pi_client.py &\n');

            stream.on('data', (chunk) => {
              ws.send(JSON.stringify({ type: 'output', data: chunk.toString() }));
            });

            stream.on('close', () => {
              console.log('🔌 SSH shell closed');
              ws.send(JSON.stringify({ type: 'status', connected: false }));
              ssh.end();
            });
          });
        })
        .on('error', (err) => {
          console.error('❌ SSH connection failed:', err.message);
          ws.send(JSON.stringify({ type: 'status', connected: false }));
          ws.send(JSON.stringify({ type: 'error', message: 'SSH connection failed' }));
        })
        .connect({ host, port: 22, username, password });

      } else if (data.type === 'input') {
        if (sshStream) {
          sshStream.write(data.command);
        } else {
          ws.send(JSON.stringify({ type: 'output', data: 'SSH not connected yet\r\n' }));
        }

      } else if (data.type === 'register' && data.client === 'dashboard') {
        dashboardSockets.push(ws);
        console.log("📺 Dashboard registered");

      } else if (data.type === 'register' && data.client === 'pi') {
        piSockets.push(ws);
        console.log("📷 Pi registered");

      } else if (data.type === 'frame') {
        const base64 = data.data;

        if (recordingState === 'on' && currentSessionDir) {
          const buffer = Buffer.from(base64.split(',')[1], 'base64');
          const filename = `frame_${String(frameCounter).padStart(4, '0')}.jpg`;
          fs.writeFileSync(path.join(currentSessionDir, filename), buffer);
          frameCounter++;
        }

        // Broadcast to dashboard
        dashboardSockets.forEach(sock => {
          if (sock.readyState === WebSocket.OPEN) {
            sock.send(JSON.stringify({ type: 'frame', data: base64 }));
          }
        });

      } else if (data.type === 'record') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        currentSessionDir = path.join(framesDir, `session-${timestamp}`);
        fs.mkdirSync(currentSessionDir);
        frameCounter = 0;
        recordingState = 'on';
        console.log('📹 Recording started');

      } else if (data.type === 'pause') {
        if (recordingState === 'on') {
          recordingState = 'paused';
          console.log('⏸️ Recording paused');
        }

      } else if (data.type === 'resume') {
        if (recordingState === 'paused') {
          recordingState = 'on';
          console.log('▶️ Recording resumed');
        }

      } else if (data.type === 'stop') {
        recordingState = 'off';
        currentSessionDir = null;
        frameCounter = 0;
        console.log('⏹️ Recording stopped');
      }

    } catch (e) {
      console.error('❌ Invalid message format:', e.message);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log("🔴 WebSocket closed");
    dashboardSockets = dashboardSockets.filter(sock => sock !== ws);
    piSockets = piSockets.filter(sock => sock !== ws);
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket SSH bridge running on port ${PORT}`);
});