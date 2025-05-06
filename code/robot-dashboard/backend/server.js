// server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT; // Use environment variable or default
const framesDir = path.join(__dirname, '../frames'); // Adjust path if needed

// Create frames directory if it doesn't exist
try {
    if (!fs.existsSync(framesDir)) {
        fs.mkdirSync(framesDir, { recursive: true }); // Use recursive true
        console.log(`Created frames directory: ${framesDir}`);
    }
} catch (err) {
    console.error(`Error creating frames directory: ${err.message}`);
    // Decide if you want to exit or continue without frame saving
    // process.exit(1); 
}


app.get('/', (req, res) => {
  res.send('Backend is running');
});

// --- BEGIN NEW: Define allowed commands ---
const allowedCommands = {
  'launch_pi_client': {
    command: 'python3 pi_client.py &\n', // Add newline! Run in background.
    description: 'Starts the Python client on the Pi for camera feed.'
  },
  'get_ip': {
    command: 'hostname -I\n',
    description: 'Gets the local IP address of the Pi.'
  },
  // --- Add more commands here ---
  // 'reboot_pi': {
  //    command: 'sudo reboot\n', // Needs passwordless sudo setup on Pi
  //    description: 'Reboots the Raspberry Pi.'
  // },
  'list_home': {
      command: 'ls -la ~/\n',
      description: 'Lists contents of the home directory.'
  }
};
console.log("ℹ️ Allowed Commands Registered:", Object.keys(allowedCommands));
// --- END NEW ---

// Use Maps to associate sockets with their state/streams for better multi-client handling
const dashboardSockets = new Map(); // Map<WebSocket, { id: string }>
const piClientSockets = new Map(); // Map<WebSocket, { id: string }>
const sshConnections = new Map(); // Map<WebSocket, { ssh: Client, stream: ssh2.Channel | null }>

// --- Shared Recording State ---
let recordingState = 'off'; // 'off' | 'on' | 'paused'
let currentSessionDir = null;
let frameCounter = 0;

wss.on('connection', (ws, req) => {
  // Assign a unique ID to each connection for easier tracking
  const connectionId = Date.now().toString(36) + Math.random().toString(36).substring(2);
  console.log(`🟢 [${connectionId}] WebSocket connection established from ${req.socket.remoteAddress}`);
  ws.connectionId = connectionId; // Attach ID to ws object

  // Send initial disconnected status
  ws.send(JSON.stringify({ type: 'status', connected: false, connectionId: connectionId }));

  ws.on('message', async (msg) => {
    const str = msg.toString();
    // Avoid logging frame data flood
    if (!str.includes('"type":"frame"')) {
        console.log(`[${ws.connectionId}] 📨 Received:`, str.substring(0, 200)); // Log truncated message
    }

    try {
      const data = JSON.parse(str);

      // --- Authentication ---
      if (data.type === 'auth') {
        const { username, host, password } = data;
        console.log(`[${ws.connectionId}] 🔐 Attempting SSH to ${username}@${host}...`);

        // Close previous connection if any for this ws
        if (sshConnections.has(ws)) {
            console.log(`[${ws.connectionId}] Closing existing SSH connection before new auth attempt.`);
            sshConnections.get(ws)?.ssh.end();
            sshConnections.delete(ws);
        }


        const ssh = new Client();
        sshConnections.set(ws, { ssh: ssh, stream: null }); // Store connection attempt

        ssh.on('ready', () => {
          console.log(`[${ws.connectionId}] ✅ SSH connection established.`);
          ws.send(JSON.stringify({ type: 'status', connected: true }));

          ssh.shell({ term: 'xterm-color' }, (err, stream) => { // Request a pseudo-terminal
            if (err) {
              console.error(`[${ws.connectionId}] ❌ SSH shell error:`, err);
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to open SSH shell' }));
              ssh.end(); // Clean up SSH connection
              sshConnections.delete(ws); // Remove from map
              ws.send(JSON.stringify({ type: 'status', connected: false })); // Update status
              return;
            }
            console.log(`[${ws.connectionId}] 🐚 SSH shell opened.`);
            // Store the stream associated with this ws connection
            const connData = sshConnections.get(ws);
            if (connData) {
                connData.stream = stream;
            } else {
                 console.error(`[${ws.connectionId}] SSH connection data not found after shell opened!`);
                 stream.end();
                 ssh.end();
                 return;
            }

            // --- Forward data from Shell to WebSocket ---
            stream.on('data', (chunk) => {
              // Check if ws is still open before sending
              if (ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify({ type: 'output', data: chunk.toString() }));
              } else {
                 console.log(`[${ws.connectionId}] Attempted to send shell data to closed WebSocket.`);
                 stream.end(); // Close stream if WebSocket is gone
              }
            });

            // --- Handle Shell Closure ---
            stream.on('close', () => {
              console.log(`[${ws.connectionId}] 🔌 SSH shell closed`);
              // Only send disconnect status if WS is still open
              if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'status', connected: false }));
                  ws.send(JSON.stringify({ type: 'output', data: '\r\nShell disconnected.\r\n' }));
              }
              const connData = sshConnections.get(ws);
              if (connData) {
                 connData.stream = null; // Clear the stream reference
                 connData.ssh.end(); // End the SSH connection itself
                 sshConnections.delete(ws); // Remove from map
              }
            });

             stream.stderr.on('data', (chunk) => {
                console.error(`[${ws.connectionId}] SSH Shell Stderr: ${chunk.toString()}`);
                // Forward stderr as output too, maybe prefixed
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'output', data: `\x1b[31m${chunk.toString()}\x1b[0m` })); // Send stderr in red
                }
            });

          }); // End ssh.shell
        })
        .on('error', (err) => {
          console.error(`[${ws.connectionId}] ❌ SSH connection error:`, err.message);
           if (ws.readyState === WebSocket.OPEN) {
               ws.send(JSON.stringify({ type: 'status', connected: false }));
               ws.send(JSON.stringify({ type: 'error', message: `SSH connection failed: ${err.message}` }));
           }
          sshConnections.delete(ws); // Clean up map entry on error
        })
        .on('close', () => {
             console.log(`[${ws.connectionId}] SSH main connection closed.`);
             // If status wasn't already set to false by stream close or error, set it now
             if (ws.readyState === WebSocket.OPEN && sshConnections.has(ws)) {
                 ws.send(JSON.stringify({ type: 'status', connected: false }));
             }
             sshConnections.delete(ws); // Ensure cleanup
        })
        .connect({
            host,
            port: 22,
            username,
            password,
            // Keepalive settings can be useful for long sessions
            keepaliveInterval: 30000, // Send keepalive every 30 seconds
            keepaliveCountMax: 3 // Disconnect after 3 failed keepalives
        });

      // --- Terminal Input ---
      } else if (data.type === 'input') {
         const connData = sshConnections.get(ws);
         if (connData && connData.stream) {
             connData.stream.write(data.command); // command should be the raw input string
         } else {
             if (ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify({ type: 'output', data: '\r\nSSH not connected.\r\n' }));
             }
         }
      }
      // --- Execute Command ---
      else if (data.type === 'execute_command') {
        const commandId = data.command_id;
        console.log(`[${ws.connectionId}] Received execute_command request for ID: ${commandId}`);
        const connData = sshConnections.get(ws);

        if (connData && connData.stream) {
            if (allowedCommands[commandId]) {
                const commandConfig = allowedCommands[commandId];
                console.log(`[${ws.connectionId}] Executing: ${commandConfig.command.trim()}`);
                connData.stream.write(commandConfig.command); // Write the mapped command
                // Optional: Send feedback to frontend
                if (ws.readyState === WebSocket.OPEN) {
                   ws.send(JSON.stringify({ type: 'info', message: `Executing: ${commandConfig.description}` }));
                }
            } else {
                console.warn(`[${ws.connectionId}] Denied execution: Unknown command ID '${commandId}'`);
                 if (ws.readyState === WebSocket.OPEN) {
                     ws.send(JSON.stringify({ type: 'error', message: `Command ID '${commandId}' not allowed.` }));
                 }
            }
        } else {
             console.warn(`[${ws.connectionId}] Cannot execute command: SSH stream not available.`);
             if (ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify({ type: 'error', message: 'Cannot execute command: SSH not connected.' }));
             }
        }
      }


      // --- Client Registration ---
      else if (data.type === 'register') {
        if (data.client === 'dashboard') {
          dashboardSockets.set(ws, { id: ws.connectionId });
          console.log(`[${ws.connectionId}] 📺 Dashboard registered.`);
           // Remove from piClientSockets if it was previously registered as such
           if (piClientSockets.has(ws)) piClientSockets.delete(ws);
        } else if (data.client === 'pi') {
          piClientSockets.set(ws, { id: ws.connectionId });
          console.log(`[${ws.connectionId}] 📷 Pi Client registered.`);
           // Remove from dashboardSockets if it was previously registered as such
           if (dashboardSockets.has(ws)) dashboardSockets.delete(ws);
        } else {
            console.warn(`[${ws.connectionId}] Unknown client type registration: ${data.client}`);
        }
      }

      // --- Frame Handling ---
      else if (data.type === 'frame') {
        // Assuming frame comes from a registered Pi client
        if (!piClientSockets.has(ws)) {
             // console.warn(`[${ws.connectionId}] Received frame from unregistered or non-Pi socket. Ignoring.`);
             return; // Ignore frames not from registered Pi clients
        }

        const base64 = data.data; // Expecting data:image/jpeg;base64,....

        // Save frame if recording is 'on'
        if (recordingState === 'on' && currentSessionDir) {
          try {
              const base64Data = base64.split(',')[1];
              if (!base64Data) throw new Error("Invalid base64 format in frame");
              const buffer = Buffer.from(base64Data, 'base64');
              const filename = `frame_${String(frameCounter).padStart(5, '0')}.jpg`; // Pad more if high FPS
              fs.writeFileSync(path.join(currentSessionDir, filename), buffer);
              frameCounter++;
          } catch (writeError) {
              console.error(`[${ws.connectionId}] Error saving frame: ${writeError.message}`);
              // Consider stopping recording or notifying dashboard on error
              recordingState = 'off'; // Stop recording on error?
              if (dashboardSockets.size > 0) {
                   const firstDashboard = dashboardSockets.keys().next().value;
                    if (firstDashboard?.readyState === WebSocket.OPEN) {
                         firstDashboard.send(JSON.stringify({ type: 'error', message: `Recording stopped due to file write error: ${writeError.message}` }));
                    }
              }
          }
        }

        // Broadcast frame to ALL registered dashboards
        dashboardSockets.forEach((dashInfo, dashWS) => {
          if (dashWS.readyState === WebSocket.OPEN) {
            dashWS.send(JSON.stringify({ type: 'frame', data: base64 }));
          } else {
             console.log(`[${dashInfo.id}] Dashboard socket closed, removing from broadcast list.`);
             dashboardSockets.delete(dashWS); // Clean up closed dashboard sockets
          }
        });
      }

      // --- Recording Controls (Assuming sent by a dashboard) ---
       else if (['record', 'pause', 'resume', 'stop'].includes(data.type)) {
           // Check if sender is likely a dashboard (or enforce specific sender)
           if (!dashboardSockets.has(ws) && !sshConnections.has(ws)) { // Allow commands from SSH connection source too maybe?
               console.warn(`[${ws.connectionId}] Received recording command from non-dashboard/non-SSH socket. Ignoring.`);
               return;
           }

           switch (data.type) {
               case 'record':
                   if (recordingState === 'off') {
                       try {
                           const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                           currentSessionDir = path.join(framesDir, `session-${timestamp}`);
                           fs.mkdirSync(currentSessionDir, { recursive: true });
                           frameCounter = 0;
                           recordingState = 'on';
                           console.log(`[${ws.connectionId}] 📹 Recording started. Session: ${currentSessionDir}`);
                           // Notify dashboards
                           dashboardSockets.forEach(sock => sock.send(JSON.stringify({ type: 'recording_status', status: 'on' })));
                       } catch (mkdirError) {
                            console.error(`[${ws.connectionId}] Error starting recording (mkdir): ${mkdirError.message}`);
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ type: 'error', message: `Failed to start recording: ${mkdirError.message}` }));
                            }
                       }
                   } else {
                       console.log(`[${ws.connectionId}] Ignoring 'record' command, already recording or paused.`);
                   }
                   break;
               case 'pause':
                   if (recordingState === 'on') {
                       recordingState = 'paused';
                       console.log(`[${ws.connectionId}] ⏸️ Recording paused`);
                       dashboardSockets.forEach(sock => sock.send(JSON.stringify({ type: 'recording_status', status: 'paused' })));
                   }
                   break;
               case 'resume':
                   if (recordingState === 'paused') {
                       recordingState = 'on';
                       console.log(`[${ws.connectionId}] ▶️ Recording resumed`);
                       dashboardSockets.forEach(sock => sock.send(JSON.stringify({ type: 'recording_status', status: 'on' })));
                   }
                   break;
               case 'stop':
                   if (recordingState !== 'off') {
                       recordingState = 'off';
                       const stoppedSession = currentSessionDir; // Keep track of which session was stopped
                       currentSessionDir = null;
                       frameCounter = 0;
                       console.log(`[${ws.connectionId}] ⏹️ Recording stopped. Session: ${stoppedSession}`);
                       dashboardSockets.forEach(sock => sock.send(JSON.stringify({ type: 'recording_status', status: 'off' })));
                   }
                   break;
           }
       }

      // --- Add other message types here ---
      else {
          console.warn(`[${ws.connectionId}] Received unknown message type: ${data.type}`);
           if (ws.readyState === WebSocket.OPEN) {
               ws.send(JSON.stringify({ type: 'error', message: `Unknown command type: ${data.type}` }));
           }
      }

    } catch (e) {
      console.error(`[${ws.connectionId}] ❌ Error processing message: ${e.message}. Raw msg: ${str.substring(0,200)}`);
       if (ws.readyState === WebSocket.OPEN) {
           ws.send(JSON.stringify({ type: 'error', message: `Failed to process message: ${e.message}` }));
       }
    }
  }); // End ws.on('message')

  ws.on('close', (code, reason) => {
    console.log(`🔴 [${ws.connectionId}] WebSocket closed. Code: ${code}, Reason: ${reason}`);
    // Clean up resources associated with this WebSocket connection
    dashboardSockets.delete(ws);
    piClientSockets.delete(ws);
    const connData = sshConnections.get(ws);
    if (connData) {
        console.log(`[${ws.connectionId}] Closing SSH connection due to WebSocket closure.`);
        connData.ssh.end(); // End the SSH connection
        sshConnections.delete(ws); // Remove from map
    }
  });

  ws.on('error', (error) => {
     console.error(`[${ws.connectionId}] WebSocket error: `, error);
     // Ensure cleanup happens on error too
     const connData = sshConnections.get(ws);
     if (connData && connData.ssh) {
         connData.ssh.end();
     }
     sshConnections.delete(ws);
     dashboardSockets.delete(ws);
     piClientSockets.delete(ws);
     // Attempt to close the WebSocket gracefully if possible
     if (ws.readyState !== WebSocket.CLOSED) {
         ws.terminate();
     }
  });

}); // End wss.on('connection')

server.listen(PORT, () => {
  console.log(`🚀 WebSocket Server listening on ws://localhost:${PORT}`);
});

// shutdown
process.on('SIGINT', () => {
    console.log('\n🚦 Received SIGINT, shutting down gracefully...');
    wss.clients.forEach(client => {
        // Close associated SSH connections first
         const connData = sshConnections.get(client);
         if (connData) {
            console.log(`[${client.connectionId}] Closing SSH connection during shutdown.`);
            connData.ssh.end();
         }
        client.terminate(); // Force close WebSocket connections
    });
    server.close(() => {
        console.log('✅ Server closed.');
        process.exit(0);
    });
});