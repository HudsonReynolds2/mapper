// server.js
require('dotenv').config(); // Keep dotenv for config

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client } = require('ssh2'); // Keep ssh2
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Use new environment variable setup ---
const PORT = process.env.PORT; // Use env var or default
const framesDir = path.join('./frames'); // Use env var or default

// --- Keep new directory creation (with error handling) ---
try {
  if (!fs.existsSync(framesDir)) {
    console.log(`Attempting to create frames directory at: ${framesDir}`);
    fs.mkdirSync(framesDir, { recursive: true }); // Use recursive just in case parent doesn't exist
    console.log(`✅ Frames directory created at ${framesDir}`);
  } else {
    console.log(`Frames directory already exists at ${framesDir}`);
  }
} catch (err) {
  console.error(`❌ Critical error creating frames directory at ${framesDir}:`, err);
  console.error("Ensure the parent directory exists and you have write permissions.");
  process.exit(1); // Exit if we can't create the essential directory
}

app.get('/', (req, res) => { res.send('Backend is running'); }); // Keep simple root route

// --- Keep new potentially malicious command filter ---
const commandBlacklist = [
    'rm', 'mv', 'cp', 'chmod', 'chown', 'shutdown', 'reboot', 'halt',
    ':(){:|:&};:', // fork bomb
    '>', '<', '|', '&&', '||', ';', // Avoid complex shell redirection/chaining unless explicitly needed & sanitized
    'sudo', 'su' // Generally avoid privilege escalation commands via web interface
];
function isCommandPotentiallyMalicious(command) {
    const lowerCaseCommand = command.toLowerCase().trim();
    const firstWord = lowerCaseCommand.split(' ')[0];
    // Check against blacklist and look for potentially harmful patterns
    return commandBlacklist.some(blocked => firstWord.includes(blocked)) ||
           lowerCaseCommand.includes('..') || // Directory traversal
           lowerCaseCommand.includes('wget ') || lowerCaseCommand.includes('curl '); // Unintended downloads
}

// --- Keep new client management using Maps ---
const dashboardSockets = new Map();
const piClientSockets = new Map();
const sshConnections = new Map();

// --- Restore OLD recording state variables ---
let recordingState = 'off'; // 'off' | 'on' | 'paused'
let currentSessionDir = null;
let frameCounter = 0;
// --- End recording state variables ---

wss.on('connection', (ws, req) => {
  // --- Keep new connection ID and logging ---
  const connectionId = Date.now().toString(36) + Math.random().toString(36).substring(2);
  console.log(`🟢 [${connectionId}] WebSocket connection established from ${req.socket.remoteAddress}`);
  ws.connectionId = connectionId; // Attach ID to ws object
  ws.send(JSON.stringify({ type: 'status', connected: false, connectionId: connectionId }));

  ws.on('message', async (msg) => {
    const str = msg.toString();

    try {
      const data = JSON.parse(str);

      // --- Authentication (Keep New SSH Logic) ---
      if (data.type === 'auth') {
        const { username, host, password } = data;
        console.log(`[${ws.connectionId}] 🔐 Attempting SSH to ${username}@${host}...`);
        if (sshConnections.has(ws)) {
            console.log(`[${ws.connectionId}] Closing existing SSH connection before creating new one.`);
            const oldConnData = sshConnections.get(ws);
            if (oldConnData && oldConnData.ssh) {
                oldConnData.ssh.end();
            }
            sshConnections.delete(ws);
        }
        const ssh = new Client();
        sshConnections.set(ws, { ssh: ssh, stream: null, host: host, username: username }); // Store host/user for context

        ssh.on('ready', () => {
          console.log(`[${ws.connectionId}] ✅ SSH connection established to ${username}@${host}.`);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'status', connected: true }));
          else { console.log(`[${ws.connectionId}] WebSocket closed before SSH shell could open.`); ssh.end(); return; }

          ssh.shell({ term: 'xterm-color' }, (err, stream) => {
            if (err) {
              console.error(`[${ws.connectionId}] ❌ SSH shell error: ${err.message}`);
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: `Failed to open SSH shell: ${err.message}` }));
              ssh.end(); // Ensure SSH connection is closed on shell error
              sshConnections.delete(ws); // Clean up map entry
              return;
            }
            console.log(`[${ws.connectionId}]🐚 SSH shell opened.`);
            const connData = sshConnections.get(ws);
            if (connData) {
                connData.stream = stream; // Store the stream
            } else {
                 console.error(`[${ws.connectionId}] SSH connection data missing after shell opened. Closing stream.`);
                 stream.end();
                 ssh.end();
                 return;
            }

            // --- Stream Handlers ---
            stream.on('data', (chunk) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'output', data: chunk.toString() }));
              } else {
                console.log(`[${ws.connectionId}] WebSocket closed during SSH stream. Ending stream.`);
                stream.end(); // Close the stream if WS is gone
              }
            });
            stream.stderr.on('data', (chunk) => { // Handle stderr separately for potential coloring/logging
                const errorOutput = chunk.toString();
                console.warn(`[${ws.connectionId}] SSH STDERR: ${errorOutput.substring(0,100)}`); // Log stderr
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'output', data: `\x1b[31m${errorOutput}\x1b[0m` })); // Send stderr (optionally colored red)
                }
            });
            stream.on('close', () => {
              console.log(`[${ws.connectionId}] 🔌 SSH shell stream closed.`);
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'info', message: 'SSH shell closed.' }));
              const currentConnData = sshConnections.get(ws);
              if (currentConnData) {
                  currentConnData.stream = null; // Clear the stream reference
                  // Don't necessarily end the whole SSH connection here unless intended
              }
            });
            stream.on('error', (streamErr) => { // Handle stream-specific errors
               console.error(`[${ws.connectionId}] ❌ SSH stream error: ${streamErr.message}`);
               if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: `SSH stream error: ${streamErr.message}` }));
            });

          }); // End ssh.shell
        }).on('error', (err) => {
          console.error(`[${ws.connectionId}] ❌ SSH connection error: ${err.message}`);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'status', connected: false }));
            ws.send(JSON.stringify({ type: 'error', message: `SSH connection failed: ${err.message}` }));
          }
          sshConnections.delete(ws); // Clean up on error
        }).on('close', (hadError) => {
          console.log(`[${ws.connectionId}] 🔌 SSH connection closed${hadError ? ' due to error' : ''}.`);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'status', connected: false }));
           // Only delete if it hasn't been replaced by a new auth attempt already
          const currentConnData = sshConnections.get(ws);
          if (currentConnData && currentConnData.ssh === ssh) { // Check if it's the *same* ssh object
              sshConnections.delete(ws);
          }
        }).connect({
            host,
            port: 22,
            username,
            password,
            readyTimeout: 20000, // Increased timeout
            keepaliveInterval: 30000, // Send keepalive every 30s
            keepaliveCountMax: 3 // Disconnect after 3 missed keepalives (~90s)
        });
      // --- End Authentication ---

      // --- Terminal Input (Keep New Logic) ---
      } else if (data.type === 'input') {
          const connData = sshConnections.get(ws);
          if (connData && connData.stream) {
              // console.log(`[${ws.connectionId}] Writing input to SSH: ${data.command.substring(0,50)}`); // Optional debug log
              connData.stream.write(data.command);
          } else {
              console.warn(`[${ws.connectionId}] Received input command but SSH stream is not available.`);
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'output', data: 'SSH not connected or shell not ready.\r\n' }));
          }
      // --- End Terminal Input ---

      // --- Execute Command ---
      } else if (data.type === 'execute_command') {
          const rawCommand = data.command;
          console.log(`[${ws.connectionId}] Received execute_command request for: "${rawCommand}"`);
          if (!rawCommand || typeof rawCommand !== 'string') {
              console.warn(`[${ws.connectionId}] Invalid execute_command payload.`);
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: 'Invalid command provided.' }));
              return;
          }
          const commandToExecute = rawCommand.trim();
          const commandForCheck = commandToExecute.split(' ')[0].toLowerCase(); // Check only the command itself

          if (isCommandPotentiallyMalicious(commandForCheck)) {
              console.warn(`[${ws.connectionId}] Blocked potentially malicious command: ${commandToExecute}`);
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: `Command blocked: ${commandForCheck}` }));
          } else {
              const connData = sshConnections.get(ws);
              if (connData && connData.stream) {
                  console.log(`[${ws.connectionId}] Executing command via SSH stream: ${commandToExecute}`);
                  const commandToSend = commandToExecute.endsWith('\n') ? commandToExecute : commandToExecute + '\n'; // Ensure newline
                  connData.stream.write(commandToSend);
                   if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'info', message: `Sent command: ${commandToExecute}` }));
              } else {
                  console.warn(`[${ws.connectionId}] Cannot execute command, SSH stream not available.`);
                   if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: 'SSH not connected or shell not ready to execute command.' }));
              }
          }
      // --- End Execute Command ---

      // --- Client Registration ---
      } else if (data.type === 'register') {
        console.log(`[REGISTRATION] [${ws.connectionId}] Registration message received:`, data); // Log registration attempt
        if (data.client === 'dashboard') {
          // Remove from Pi clients if it was registered there before
          if (piClientSockets.has(ws)) {
              console.log(`[REGISTRATION] [${ws.connectionId}] Client was previously registered as Pi, removing.`);
              piClientSockets.delete(ws);
          }
          dashboardSockets.set(ws, { id: ws.connectionId });
          console.log(`[${ws.connectionId}] 📺 Dashboard registered. Total dashboards: ${dashboardSockets.size}`);
           if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'registered', client: 'dashboard' })); // Acknowledge registration
        } else if (data.client === 'pi') {
          // Remove from Dashboard clients if it was registered there before
          if (dashboardSockets.has(ws)) {
              console.log(`[REGISTRATION] [${ws.connectionId}] Client was previously registered as Dashboard, removing.`);
              dashboardSockets.delete(ws);
          }
          piClientSockets.set(ws, { id: ws.connectionId });
          console.log(`[${ws.connectionId}] 📷 Pi Client registered. Total Pi clients: ${piClientSockets.size}`);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'registered', client: 'pi' })); // Acknowledge registration
        } else {
            console.warn(`[${ws.connectionId}] Unknown client type registration attempted: ${data.client}`);
             if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: `Unknown client type: ${data.client}` }));
        }
      // --- End Client Registration ---

      // --- Frame Handling  ---
      } else if (data.type === 'frame') {
        // Check if the sender is a registered Pi client (Keep this check)
        if (!piClientSockets.has(ws)) {
             console.warn(`[${ws.connectionId}] Frame ignored. Sender is NOT registered as a Pi client.`);
             return; // Ignore frames not from registered Pi clients
        }

        const base64 = data.data; // Expecting data:image/jpeg;base64,....

        // --- Recording Logic ---
        if (recordingState === 'on' && currentSessionDir) {
          const buffer = Buffer.from(base64.split(',')[1], 'base64');
          const filename = `frame_${String(frameCounter).padStart(4, '0')}.jpg`;
          fs.writeFileSync(path.join(currentSessionDir, filename), buffer);
          frameCounter++;
        }

        
        // Broadcast frame to ALL registered dashboards (Keep New Broadcast Logic)
        let broadcastCount = 0;
        dashboardSockets.forEach((dashInfo, dashWS) => {
          if (dashWS.readyState === WebSocket.OPEN) {
            // Check if dashboard actually wants frames? Could add a flag in dashInfo
            dashWS.send(JSON.stringify({ type: 'frame', data: base64 }));
            broadcastCount++;
          } else {
             console.log(`[${dashInfo.id}] Dashboard socket closed during broadcast, removing.`);
             dashboardSockets.delete(dashWS); // Clean up closed dashboard sockets proactively
          }
        });
        // Optional logging for broadcast success/failure
        // if(broadcastCount === 0 && dashboardSockets.size > 0) console.warn(`[${ws.connectionId}] Frame received, but no OPEN dashboard sockets found to broadcast to!`);
        // else if (broadcastCount > 0) console.log(`[${ws.connectionId}] Frame broadcasted to ${broadcastCount} dashboards.`);

      // --- End Frame Handling ---

      // --- Recording Controls ---
      } else if (['record', 'pause', 'resume', 'stop'].includes(data.type)) {
          // Optional: Check if the message comes from a dashboard?
          // if (!dashboardSockets.has(ws)) {
          //     console.warn(`[${ws.connectionId}] Received recording command from non-dashboard client. Ignoring.`);
          //     return;
          // }

          switch (data.type) {
            case 'record':
              if (recordingState !== 'on') { // Prevent starting if already recording
                 const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                 currentSessionDir = path.join(framesDir, `session-${timestamp}`);
                 try {
                    fs.mkdirSync(currentSessionDir);
                    frameCounter = 0;
                    recordingState = 'on';
                    console.log(`[${ws.connectionId}] 📹 Recording started. Saving to: ${currentSessionDir}`);
                    // Notify dashboards
                     dashboardSockets.forEach((dashInfo, dashWS) => {
                         if (dashWS.readyState === WebSocket.OPEN) {
                             dashWS.send(JSON.stringify({ type: 'recording_status', status: 'on', session: currentSessionDir }));
                         }
                     });
                 } catch(mkdirErr) {
                     console.error(`[${ws.connectionId}] ❌ Failed to create session directory: ${mkdirErr.message}`);
                     currentSessionDir = null; // Reset if creation failed
                      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: `Failed to start recording: ${mkdirErr.message}` }));
                 }
              } else {
                  console.warn(`[${ws.connectionId}] Received 'record' command but already recording.`);
              }
              break;
            case 'pause':
              if (recordingState === 'on') {
                recordingState = 'paused';
                console.log(`[${ws.connectionId}] ⏸️ Recording paused.`);
                 // Notify dashboards
                 dashboardSockets.forEach((dashInfo, dashWS) => {
                     if (dashWS.readyState === WebSocket.OPEN) {
                         dashWS.send(JSON.stringify({ type: 'recording_status', status: 'paused' }));
                     }
                 });
              }
              break;
            case 'resume':
              if (recordingState === 'paused') {
                recordingState = 'on';
                console.log(`[${ws.connectionId}] ▶️ Recording resumed.`);
                 // Notify dashboards
                 dashboardSockets.forEach((dashInfo, dashWS) => {
                     if (dashWS.readyState === WebSocket.OPEN) {
                         dashWS.send(JSON.stringify({ type: 'recording_status', status: 'on', session: currentSessionDir })); // Send session dir again on resume
                     }
                 });
              }
              break;
            case 'stop':
              if (recordingState !== 'off') {
                const stoppedSession = currentSessionDir; // Keep track of which session was stopped
                recordingState = 'off';
                currentSessionDir = null;
                frameCounter = 0; // Reset counter
                console.log(`[${ws.connectionId}] ⏹️ Recording stopped. Session was: ${stoppedSession}`);
                 // Notify dashboards
                 dashboardSockets.forEach((dashInfo, dashWS) => {
                     if (dashWS.readyState === WebSocket.OPEN) {
                         dashWS.send(JSON.stringify({ type: 'recording_status', status: 'off' }));
                     }
                 });
              }
              break;
          }
          // --- End Recording Controls ---

      // --- Unknown type ---
      } else {
        console.warn(`[${ws.connectionId}] Received unknown message type: ${data.type}`);
         if (ws.readyState === WebSocket.OPEN) {
             ws.send(JSON.stringify({ type: 'error', message: `Unknown command type: ${data.type}` }));
         }
      }

    } catch (e) { // Error parsing message
        console.error(`[${ws.connectionId}] ❌ Error processing message: ${e.message}. Raw msg: ${str.substring(0,200)}`);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: `Failed to process message: ${e.message}` }));
        }
    }
  }); // End ws.on('message')

  // --- Keep New Close Handler with Cleanup ---
  ws.on('close', (code, reason) => {
      const reasonStr = reason ? reason.toString() : 'No reason provided';
      console.log(`🔴 [${ws.connectionId}] WebSocket closed. Code: ${code}, Reason: ${reasonStr.substring(0, 100)}`);
      // Clean up SSH connection if it exists for this ws
      const connData = sshConnections.get(ws);
      if (connData && connData.ssh) {
          console.log(`[${ws.connectionId}] Closing associated SSH connection.`);
          connData.ssh.end(); // Gracefully close SSH
      }
      // Remove from all maps
      const wasSsh = sshConnections.delete(ws);
      const wasDash = dashboardSockets.delete(ws);
      const wasPi = piClientSockets.delete(ws);
       if(wasSsh) console.log(`[CLEANUP] [${ws.connectionId}] Removed from sshConnections map on close.`);
       if(wasDash) console.log(`[CLEANUP] [${ws.connectionId}] Removed from dashboardSockets map on close. Remaining: ${dashboardSockets.size}`);
       if(wasPi) console.log(`[CLEANUP] [${ws.connectionId}] Removed from piClientSockets map on close. Remaining: ${piClientSockets.size}`);
  });
  // --- End Close Handler ---

  // --- Keep New Error Handler with Cleanup ---
  ws.on('error', (error) => {
      console.error(`[${ws.connectionId}]  WebSocket error: `, error);
       // Clean up SSH connection if it exists for this ws
      const connData = sshConnections.get(ws);
      if (connData && connData.ssh) {
          console.log(`[${ws.connectionId}] Closing associated SSH connection due to WebSocket error.`);
          connData.ssh.end();
      }
       // Remove from all maps
      const wasSsh = sshConnections.delete(ws);
      const wasDash = dashboardSockets.delete(ws);
      const wasPi = piClientSockets.delete(ws);
      if(wasSsh) console.log(`[CLEANUP] [${ws.connectionId}] Removed from sshConnections map on error.`);
      if(wasDash) console.log(`[CLEANUP] [${ws.connectionId}] Removed from dashboardSockets map on error. Remaining: ${dashboardSockets.size}`);
      if(wasPi) console.log(`[CLEANUP] [${ws.connectionId}] Removed from piClientSockets map on error. Remaining: ${piClientSockets.size}`);

      // Terminate the socket if it's not already closed
      if (ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) {
          console.log(`[${ws.connectionId}] Terminating WebSocket due to error.`);
          ws.terminate();
      }
  });
  // --- End Error Handler ---

}); // End wss.on('connection')

server.listen(PORT, () => {
  // Keep new server start log
  console.log(`🚀 WebSocket Server listening on ws://localhost:${PORT}`);
  console.log(`📂 Frames will be saved in directory: ${path.resolve(framesDir)}`); // Log resolved path
});

// --- Keep new Graceful Shutdown ---
process.on('SIGINT', () => {
    console.log('\n🚦 Received SIGINT (Ctrl+C), shutting down gracefully...');
    wss.clients.forEach(client => {
        console.log(`[Shutdown] Terminating client ${client.connectionId || 'unknown'}`);
        const connData = sshConnections.get(client);
        if (connData && connData.ssh) {
            console.log(`[Shutdown] Closing SSH for client ${client.connectionId || 'unknown'}`);
            connData.ssh.end();
        }
        client.terminate(); // Force close WebSocket connections
    });

    server.close((err) => {
        if (err) {
            console.error("❌ Error closing HTTP server:", err);
            process.exit(1);
        } else {
            console.log('✅ HTTP Server closed.');
            process.exit(0);
        }
    });

    // Force exit after a timeout if server doesn't close gracefully
    setTimeout(() => {
        console.error('⏰ Server close timed out. Forcing exit.');
        process.exit(1);
    }, 5000); // 5 second timeout
});
// --- End Graceful Shutdown ---