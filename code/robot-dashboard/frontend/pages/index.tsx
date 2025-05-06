import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';

// --- Import Components ---
import LiveFeed from '../components/LiveFeed'; // Assuming LiveFeed.jsx 
import MovementControls from '../components/MovementControls'; // Assuming MovementControls.jsx 
import TerminalDisplay from '../components/TerminalDisplay'; // Assuming TerminalDisplay.jsx 
import SlamApp from '../components/SlamApp'; // Assuming SlamApp.jsx 
import PiActions from '../components/PiActions'; // Assuming PiActions.jsx 

// Define status type
type Status = 'connected' | 'disconnected' | 'error' | 'connecting'; // Added 'connecting'

// Define Pi Action Button structure
interface PiActionButton {
  id: string;
  label: string;
  title?: string;
  icon?: string; // Optional icon path
}

export default function Home() {
  // --- State Variables ---
  const [imgUrl, setImgUrl] = useState<string>('/placeholder.jpg');
  const [showLogin, setShowLogin] = useState<boolean>(false);
  const [status, setStatus] = useState<Status>('disconnected');
  const [username, setUsername] = useState<string>('');
  const [host, setHost] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [recording, setRecording] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(0);
  const [lastInfoMessage, setLastInfoMessage] = useState<string>('');
  const [lastErrorMessage, setLastErrorMessage] = useState<string>('');
  const [connectionId, setConnectionId] = useState<string | null>(null);

  // --- Refs ---
  const socketRef = useRef<WebSocket | null>(null);
  const liveSocketRef = useRef<WebSocket | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  // --- Configuration ---
  const piActionButtons: PiActionButton[] = [
    { id: 'launch_pi_client', label: 'Start Pi Cam Client', title: 'Run python3 pi_client.py &' },
    { id: 'kill_pi_client', label: 'Stop Pi Cam Client', title: 'pkill -f pi_client.py' },
    { id: 'list_home', label: 'List Home Dir', title: 'Run ls -la ~/' },
    // Add more buttons here matching backend allowedCommands keys
  ];

  const backendWsUrl = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
  // Assuming live feed uses the same WS server for now
  const liveWsUrl = backendWsUrl;
  const gradioUrl = process.env.NEXT_PUBLIC_GRADIO_URL;
  // Use backendWsUrl when creating WebSockets
  const sshWsUrl = backendWsUrl;

  // --- Effects ---

  // Effect for Live Camera Feed WebSocket
  useEffect(() => {
    console.log(`Connecting Live WebSocket to: ${liveWsUrl}`);
    let isMounted = true; // Flag to prevent state updates on unmounted component
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectLiveSocket = () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout); // Clear any pending reconnect
      if (liveSocketRef.current && liveSocketRef.current.readyState !== WebSocket.CLOSED) {
          console.log("Live WebSocket already exists and is not closed.");
          return; // Don't reconnect if already open or connecting
      }

      const liveSocket = new WebSocket(liveWsUrl);
      liveSocketRef.current = liveSocket;

      liveSocket.onopen = () => {
        if (!isMounted) return;
        console.log("Live WebSocket opened.");
        liveSocket.send(JSON.stringify({ type: 'register', client: 'dashboard' }));
        // Reset FPS or other state if needed on successful reconnect
        setFps(0);
        lastFrameTimeRef.current = null;
      };

      liveSocket.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'frame') {
            setImgUrl(msg.data); // Assuming msg.data is the base64 string or URL

            const now = Date.now();
            if (lastFrameTimeRef.current) {
              const delta = now - lastFrameTimeRef.current;
              const currentFps = delta > 0 ? Math.round(1000 / delta) : 0;
              setFps(currentFps);
            }
            lastFrameTimeRef.current = now;
          } else if (msg.type === 'recording_status') {
              // Update recording state based on backend confirmation
              console.log("Recording status update:", msg.status);
              setRecording(msg.status === 'on' || msg.status === 'paused');
              setPaused(msg.status === 'paused');
          } else {
            // console.log("Received non-frame message on live socket:", msg);
          }
        } catch (error) {
          console.error("Failed to parse Live WebSocket message:", event.data, error);
        }
      };

      liveSocket.onerror = (error) => {
        if (!isMounted) return;
        console.error("Live WebSocket error:", error);
        setFps(0);
        setImgUrl('/placeholder.jpg');
        lastFrameTimeRef.current = null;
        // Attempt to reconnect after a delay
        scheduleReconnect();
      };

      liveSocket.onclose = (event) => {
        if (!isMounted) return;
        console.log(`Live WebSocket closed. Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
        setFps(0);
        setImgUrl('/placeholder.jpg');
        lastFrameTimeRef.current = null;
        liveSocketRef.current = null; // Clear the ref
        // Attempt to reconnect if closure was not intentional or clean
        if (!event.wasClean) {
            scheduleReconnect();
        }
      };
    };

    const scheduleReconnect = () => {
        // Avoid scheduling multiple reconnects
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
            if (isMounted) { // Check if still mounted before reconnecting
                console.log("Attempting to reconnect Live WebSocket...");
                connectLiveSocket();
            }
        }, 5000); // Reconnect after 5 seconds
    }

    connectLiveSocket(); // Initial connection attempt

    // Cleanup function
    return () => {
      isMounted = false; // Set flag on unmount
      if (reconnectTimeout) clearTimeout(reconnectTimeout); // Clear any scheduled reconnect
      if (liveSocketRef.current) {
         console.log("Closing Live WebSocket on component unmount.");
         // Prevent triggering reconnect logic on intentional close
         liveSocketRef.current.onerror = null;
         liveSocketRef.current.onclose = null;
         liveSocketRef.current.close();
         liveSocketRef.current = null;
      }
    };
  }, [liveWsUrl]); // Re-run effect if URL changes

  // --- Handlers ---

  // Connect to SSH WebSocket
  const connectToSSH = () => {
    if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
      console.log("SSH connection attempt already in progress or established.");
      return;
    }
    if (!username || !host || !password) {
      console.warn("Username, host, and password are required.");
      setStatus('error');
      setLastErrorMessage('Username, host, and password are required.');
      return;
    }

    console.log(`Connecting SSH WebSocket to: ${sshWsUrl}`);
    // Close existing socket before creating a new one
    if (socketRef.current) {
        console.log("Closing previous SSH WebSocket before new connection.");
        // Temporarily nullify handlers to prevent close logic firing incorrectly
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.close();
        socketRef.current = null;
    }

    const socket = new WebSocket(sshWsUrl);
    socketRef.current = socket;
    setStatus('connecting'); // Indicate attempting connection
    setLastInfoMessage('Connecting to SSH...');
    setLastErrorMessage('');
    setConnectionId(null); // Reset connection ID

    socket.onopen = () => {
      console.log("SSH WebSocket opened. Sending auth...");
      socket.send(JSON.stringify({ type: 'auth', username, host, password }));
      // Note: Status remains 'connecting' until backend confirms via 'status' message
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        // Optional: Log non-output messages
        if (msg.type !== 'output') {
          console.log("SSH WS msg:", msg);
        }

        if (msg.type === 'status') {
            // Update connection ID if provided
            if (msg.connectionId) setConnectionId(msg.connectionId);

            const newStatus = msg.connected ? 'connected' : 'disconnected';
            setStatus(newStatus);
            if (newStatus === 'connected') {
                setShowLogin(false);
                setLastErrorMessage('');
                setLastInfoMessage('SSH Connected.');
            } else {
                 // If status explicitly says disconnected without an error message preceding it
                 if (status !== 'error') {
                     setLastErrorMessage('SSH Disconnected.');
                     setLastInfoMessage('');
                 }
                 // Optionally, clear the socket ref if disconnected? Depends on desired reconnect behavior.
                 // socketRef.current = null;
            }
        } else if (msg.type === 'error') {
            console.error("SSH Error from backend:", msg.message);
            setStatus('error');
            setLastErrorMessage(msg.message || 'An unknown SSH error occurred.');
            setLastInfoMessage('');
             // Keep login modal open on auth error?
             // setShowLogin(true);
        } else if (msg.type === 'info') {
            console.log("SSH Info:", msg.message);
            setLastInfoMessage(msg.message || 'Received info.');
            setLastErrorMessage(''); // Clear error message on new info
        } else if (msg.type === 'output') {
            // TerminalShell component should handle this via its props/internal logic
            // We don't need to process it directly here anymore.
        }
      } catch (error: any) {
         console.error("Failed to parse SSH WebSocket message:", event.data, error);
         // Avoid setting status to error for simple parsing issues unless needed
         // setStatus('error');
         // setLastErrorMessage(`Error parsing message: ${error.message}`);
      }
    };

    socket.onerror = (error) => {
      console.error("SSH WebSocket error:", error);
      setStatus('error');
      setLastErrorMessage('SSH WebSocket connection error. Is the backend running?');
      setLastInfoMessage('');
      socketRef.current = null; // Clear ref on error
      // setShowLogin(true); // Show login on connection error?
    };

    socket.onclose = (event) => {
      console.log(`SSH WebSocket closed. Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
      // Only update status if it wasn't already explicitly set to error
      // Avoid setting to 'disconnected' if it's already 'error'
      setStatus(prevStatus => (prevStatus === 'error') ? 'error' : 'disconnected');

       if (status !== 'error') { // Avoid overwriting specific error messages
           setLastErrorMessage(event.wasClean ? '' : `SSH connection closed unexpectedly (Code: ${event.code})`);
           setLastInfoMessage(event.wasClean ? 'SSH Disconnected.' : '');
       }

      socketRef.current = null; // Clear ref on close
      // setShowLogin(true); // Re-show login on disconnect?
    };
  }; // --- End connectToSSH ---

  // Send Command (Used for Recording Controls)
  const sendCommand = (type: string) => {
    if (liveSocketRef.current && liveSocketRef.current.readyState === WebSocket.OPEN) {
      console.log(`Sending command via Live WS: ${type}`);
      liveSocketRef.current.send(JSON.stringify({ type }));
      // Optimistically update UI for recording - backend confirmation will follow
       if (type === 'record') { setRecording(true); setPaused(false); }
       if (type === 'stop') { setRecording(false); setPaused(false); }
       if (type === 'pause') { setPaused(true); }
       if (type === 'resume') { setPaused(false); }
    } else {
      console.warn("Cannot send command, live socket not open.");
      // TODO: Add user feedback (e.g., toast notification)
    }
  };

  // Toggle Recording
  const toggleRecording = () => {
    // Current state determines action
    if (!recording) {
      sendCommand('record');
    } else {
      sendCommand('stop');
    }
  };

  // Toggle Pause
  const togglePause = () => {
    if (!recording) return; // Can only pause/resume if recording
    if (!paused) {
      sendCommand('pause');
    } else {
      sendCommand('resume');
    }
  };

  // Execute Pi Command via SSH WebSocket
  const executePiCommand = (commandId: string) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && status === 'connected') {
       console.log(`Requesting execution of command ID: ${commandId}`);
       setLastInfoMessage(`Executing '${commandId}'...`); // Immediate feedback
       setLastErrorMessage('');
       socketRef.current.send(JSON.stringify({
           type: 'execute_command',
           command_id: commandId
       }));
    } else {
       console.warn("Cannot execute command: SSH WebSocket not open or not connected.");
       setLastErrorMessage('Cannot execute command: Not connected.');
       setLastInfoMessage('');
       // TODO: Add user feedback (e.g., toast notification)
    }
  };

  // --- Styles --- (Using React.CSSProperties for type safety)
  const buttonStyle: React.CSSProperties = {
    padding: '10px 18px',
    margin: '5px',
    backgroundColor: '#ffab40',
    color: '#1e1e25',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontFamily: 'Teko, sans-serif',
    cursor: 'pointer',
    minWidth: '140px',
    transition: 'transform 0.1s ease-in-out, background-color 0.2s ease',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    lineHeight: 1,
  };

  const connectButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    position: 'absolute',
    top: '50%',
    right: '20px',
    transform: 'translateY(-50%)',
    padding: '8px 15px',
    fontSize: '18px',
    minWidth: 'auto',
  };

  const closeButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: '10px',
    right: '10px',
    background: '#555',
    color: '#eee',
    border: 'none',
    borderRadius: '50%',
    width: '30px',
    height: '30px',
    fontSize: '18px',
    lineHeight: '30px',
    textAlign: 'center',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontFamily: 'sans-serif',
    zIndex: 1,
  };

  // --- Render ---
  return (
    <>
      <Head>
        <title>Robot Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Teko&display=swap" rel="stylesheet" />
        {/* Add meta tags, icons, etc. here */}
        <meta name="description" content="Dashboard for controlling a Raspberry Pi Robot" />
        <link rel="icon" href="/favicon.ico" /> {/* Example favicon */}
      </Head>
      {/* Global Styles */}
      <style jsx global>{`
        html, body {
          margin: 0;
          padding: 0;
          background-color: #1e1e25;
          color: #e0e0e0;
          font-family: 'Teko', sans-serif;
          height: 100vh;
          width: 100vw;
          overflow: hidden;
        }
        #__next { /* Next.js root element */
            height: 100%;
        }
        /* General Button Styling */
        button {
           transition: transform 0.1s ease-in-out, background-color 0.2s ease;
        }
        button:active:not(:disabled) {
            /* Adjust transform based on specific button type if needed */
            transform: scale(0.96) translateY(0); /* Reset potential translateY */
        }
        button:disabled {
            background-color: #555 !important;
            cursor: not-allowed;
            color: #aaa;
            transform: none !important;
            opacity: 0.7;
        }
        /* Input Styling */
        input {
            background-color: #333;
            color: #eee;
            border: 1px solid #555;
            border-radius: 4px;
            font-family: sans-serif;
            font-size: 14px;
            padding: 10px; /* Consistent padding */
        }
        input:focus {
            outline: none;
            border-color: #ffab40;
            box-shadow: 0 0 0 2px rgba(255, 171, 64, 0.5);
        }
        /* Layout Styling */
        .dashboard-layout {
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .top-banner {
            width: 100%;
            background-color: #2a2a33;
            padding: 10px 0;
            text-align: center;
            font-size: 28px;
            font-weight: bold;
            color: #ffab40;
            position: relative;
            flex-shrink: 0; /* Prevent banner shrinking */
            z-index: 10; /* Ensure banner is above grid content */
        }
        .main-grid {
            flex-grow: 1;
            padding: 20px;
            display: grid;
            gridTemplateColumns: repeat(auto-fit, minmax(400px, 1fr)); /* Responsive columns */
            gridTemplateRows: auto 1fr;
            gap: 20px;
            overflow: hidden;
             /* background-color: #111; */ /* Optional bg for grid area */
        }
        /* Style for individual grid sections */
        .grid-section {
            background-color: rgba(42, 42, 51, 0.5); /* Slightly transparent section bg */
            border-radius: 8px;
            padding: 15px 20px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            border: 1px solid #3a3a45; /* Subtle border */
        }
        .grid-section h2 {
             flex-shrink: 0;
             margin: 0 0 15px 0; /* Standard margin */
             font-size: 1.8em; /* Relative font size */
             color: #e0e0e0;
             text-align: center;
        }
        .grid-section-content {
             flex-grow: 1;
             overflow: auto; /* Add scrollbars ONLY if content overflows */
             /* padding: 5px; */ /* Optional inner padding */
        }

        /* Login Modal Styling */
        .login-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(30, 30, 37, 0.85); display: flex;
            align-items: center; justify-content: center; z-index: 1000;
            backdrop-filter: blur(3px); /* Optional blur effect */
        }
        .login-modal-box {
            background-color: #2a2a33; padding: 40px; paddingTop: 50px;
            border-radius: 10px; boxShadow: 0 5px 15px rgba(0, 0, 0, 0.4);
            position: relative; width: 90%; max-width: 400px; /* Responsive width */
            border: 1px solid #444;
        }
        .login-modal-box h2 {
             margin: 0 0 25px 0; /* Adjusted margin */
             text-align: center;
             color: #ffab40;
        }
        .login-modal-box input {
            margin-bottom: 15px;
            width: 100%;
            box-sizing: border-box; /* Include padding in width */
        }
        .login-modal-box button[type="submit"] { /* Style the main connect button */
             width: 100%;
             font-size: 18px;
             margin-top: 10px; /* Space above button */
        }
        .login-modal-error {
             color: #ff6b6b;
             text-align: center;
             margin-top: 15px;
             font-size: 14px;
             font-family: sans-serif;
             min-height: 1.2em; /* Prevent layout jump */
        }

        /* Feedback Message Styling */
        .feedback-message {
             padding: 8px 15px;
             margin-top: 15px; /* Space above feedback */
             border-radius: 5px;
             text-align: center;
             font-family: sans-serif;
             font-size: 14px;
             min-height: 1.5em; /* Prevent layout shift */
             transition: opacity 0.3s ease;
             opacity: 1;
         }
         .feedback-message:empty {
             opacity: 0;
         }
         .info-message {
             background-color: rgba(42, 74, 106, 0.7); /* Blueish */
             color: #e0f0ff;
             border: 1px solid rgba(60, 100, 150, 0.8);
         }
         .error-message {
             background-color: rgba(106, 42, 42, 0.7); /* Reddish */
             color: #ffe0e0;
             font-weight: bold;
             border: 1px solid rgba(150, 60, 60, 0.8);
         }
      `}</style>

      {/* Main Layout Container */}
      <div className="dashboard-layout">

        {/* Top Banner */}
        <div className="top-banner">
          Robot Dashboard
          <button
              onClick={() => setShowLogin(true)}
              style={connectButtonStyle}
              title="Connect to Raspberry Pi"
              disabled={status === 'connected' || status === 'connecting'} // Disable if connected or connecting
          >
            {status === 'connected' ? 'Connected' : (status === 'connecting' ? 'Connecting...' : 'Connect Pi')}
          </button>
        </div>

        {/* Login Modal */}
        {showLogin && (
           <div className="login-modal-overlay">
               <form className="login-modal-box" onSubmit={(e) => { e.preventDefault(); connectToSSH(); }}>
                   <button
                       type="button" // Important: prevent form submission
                       onClick={() => setShowLogin(false)}
                       style={closeButtonStyle}
                       aria-label="Close login"
                   > X </button>
                   <h2>Connect to Raspberry Pi</h2>
                   <input
                       placeholder="Username"
                       value={username}
                       onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                       required // Basic validation
                   />
                   <input
                       placeholder="Host (e.g., pi.local or IP)"
                       value={host}
                       onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHost(e.target.value)}
                       required
                   />
                   <input
                       type="password"
                       placeholder="Password"
                       value={password}
                       onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                       required
                   />
                   <button
                       type="submit" // Submit button for the form
                       style={{...buttonStyle}}
                       disabled={status === 'connecting'} // Disable only while connecting
                   >
                       {status === 'connecting' ? 'Connecting...' : 'Connect'}
                   </button>
                   {/* Display Login Specific Errors */}
                   <div className="login-modal-error">
                       {status === 'error' ? lastErrorMessage : ''}
                   </div>
               </form>
           </div>
        )}

        {/* Main Content Grid */}
        <div className="main-grid">

          {/* --- Quadrant 1: Live Feed --- */}
          <div className="grid-section" style={{ gridColumn: '1 / span 1', gridRow: '1 / span 1' }}>
             <LiveFeed
               imgUrl={imgUrl}
               fps={fps}
               recording={recording}
               paused={paused}
               toggleRecording={toggleRecording}
               togglePause={togglePause}
               buttonStyle={buttonStyle}
             />
          </div>

          {/* --- Quadrant 2: Controls & Actions --- */}
          <div className="grid-section" style={{ gridColumn: '2 / span 1', gridRow: '1 / span 1' }}>
            {/* Content wrapper for potential scrolling */}
            <div className="grid-section-content">
                 <MovementControls buttonStyle={buttonStyle} />

                 {/* Pi Actions Section */}
                 <div style={{marginTop: '25px', borderTop: '1px solid #444', paddingTop: '15px'}}>
                    <PiActions
                        actions={piActionButtons}
                        onExecute={executePiCommand}
                        buttonStyle={buttonStyle}
                        disabled={status !== 'connected'} // Disable if not connected
                     />
                 </div>

                 {/* Feedback Messages */}
                 <div className={`feedback-message ${lastInfoMessage ? 'info-message' : ''} ${lastErrorMessage && status !== 'error' ? 'error-message' : ''}`}>
                      {/* Display general errors/info here, login errors are in modal */}
                      {status !== 'error' ? (lastErrorMessage || lastInfoMessage || '') : ''}
                 </div>
            </div>
          </div>

          {/* --- Quadrant 3: Terminal --- */}
          <div className="grid-section" style={{ gridColumn: '1 / span 1', gridRow: '2 / span 1' }}>
             <TerminalDisplay
                socket={socketRef.current} // Pass the current socket instance
                status={status}
             />
          </div>

          {/* --- Quadrant 4: SLAM App --- */}
          <div className="grid-section" style={{ gridColumn: '2 / span 1', gridRow: '2 / span 1' }}>
             <SlamApp gradioUrl={gradioUrl} />
          </div>

        </div> {/* End Main Grid */}
      </div> {/* End Dashboard Layout */}
    </>
  );
}