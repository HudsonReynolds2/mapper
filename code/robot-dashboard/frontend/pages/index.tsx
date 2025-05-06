import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';

// --- Import the components ---
import LiveFeed from '../components/LiveFeed';
import MovementControls from '../components/MovementControls';
import TerminalDisplay from '../components/TerminalDisplay';
import SlamApp from '../components/SlamApp';



export default function Home() {
  const [imgUrl, setImgUrl] = useState('/placeholder.jpg');
  const [showLogin, setShowLogin] = useState(false); 
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  const [username, setUsername] = useState('');
  const [host, setHost] = useState('');
  const [password, setPassword] = useState('');
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const liveSocketRef = useRef<WebSocket | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  // useEffect for liveSocket (Feed) - No changes needed here
  useEffect(() => {
    const liveWsUrl = process.env.NEXT_PUBLIC_LIVE_WS_URL || 'ws://localhost:5001';
    console.log(`Connecting Live WebSocket to: ${liveWsUrl}`);
    const liveSocket = new WebSocket(liveWsUrl);
    liveSocketRef.current = liveSocket;

    liveSocket.onopen = () => {
      console.log("Live WebSocket opened.");
      liveSocket.send(JSON.stringify({ type: 'register', client: 'dashboard' }));
    };

    liveSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'frame') {
          setImgUrl(msg.data); // msg.data is the base64 string or URL

          const now = Date.now();
          if (lastFrameTimeRef.current) {
            const delta = now - lastFrameTimeRef.current;
            const currentFps = delta > 0 ? Math.round(1000 / delta) : 0; 
            setFps(currentFps);
          }
          lastFrameTimeRef.current = now;
        } else {
          // console.log("Received non-frame message on live socket:", msg);
        }
      } catch (error) {
        console.error("Failed to parse Live WebSocket message:", event.data, error);
      }
    };
    
    liveSocket.onerror = (error) => {
        console.error("Live WebSocket error:", error);
        setFps(0); // Reset FPS on error
        setImgUrl('/placeholder.jpg'); // Reset image on error
        lastFrameTimeRef.current = null;
    };

    liveSocket.onclose = (event) => {
        console.log(`Live WebSocket closed. Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
        setFps(0); 
        setImgUrl('/placeholder.jpg'); // Reset image on close
        lastFrameTimeRef.current = null;
    }

    return () => {
      if (liveSocketRef.current) {
         console.log("Closing Live WebSocket.");
         liveSocketRef.current.close();
         liveSocketRef.current = null;
      }
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  // connectToSSH function - No changes needed here
  const connectToSSH = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log("Already connected or connecting.");
      return;
    }
    if (!username || !host || !password) {
        console.warn("Username, host, and password are required.");
        setStatus('error'); 
        return;
    }

    const sshWsUrl = process.env.NEXT_PUBLIC_SSH_WS_URL || 'ws://localhost:5001';
    console.log(`Connecting SSH WebSocket to: ${sshWsUrl}`);

    // Close existing socket if attempting to reconnect
    if (socketRef.current) {
        socketRef.current.close();
    }


    const socket = new WebSocket(sshWsUrl);
    socketRef.current = socket;
    setStatus('disconnected'); // Indicate attempting connection

    socket.onopen = () => {
      console.log("SSH WebSocket opened. Sending auth...");
      socket.send(JSON.stringify({ type: 'auth', username, host, password }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("SSH WS msg:", msg);

        if (msg.type === 'status') {
          setStatus(msg.connected ? 'connected' : 'disconnected');
          if (msg.connected) {
            setShowLogin(false); 
          } else {
             setStatus('error'); 
             console.error("Connection failed or refused by backend.");
          }
        } else if (msg.type === 'error') {
          console.error("SSH Error from backend:", msg.message);
          setStatus('error');
          // Don't close the socket here, backend might still be usable or send more info
        } else if (msg.type === 'data') {
            // TerminalShell component handles this directly via its props
        }
      } catch (error) {
         console.error("Failed to parse SSH WebSocket message:", event.data, error);
      }
    };

    socket.onerror = (error) => {
        console.error("SSH WebSocket error:", error);
        setStatus('error');
        socketRef.current = null; // Clear ref on error
    };

    socket.onclose = (event) => {
      console.log(`SSH WebSocket closed. Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
      // Only update status if it wasn't already explicitly set to connected/error
      // This prevents the status flickering to 'disconnected' right after connection success/failure
      setStatus(prevStatus => (prevStatus === 'connected' || prevStatus === 'error') ? prevStatus : 'disconnected');

      socketRef.current = null; // Clear ref on close
      // Optionally: setShowLogin(true); // Re-show login on disconnect?
    };
  };

  // sendCommand function - No changes needed here
  const sendCommand = (type: string) => {
    if (liveSocketRef.current && liveSocketRef.current.readyState === WebSocket.OPEN) {
      console.log(`Sending command: ${type}`);
      liveSocketRef.current.send(JSON.stringify({ type }));
    } else {
      console.warn("Cannot send command, live socket not open.");
    }
  };

  // toggleRecording function - No changes needed here
  const toggleRecording = () => {
    if (!recording) {
      sendCommand('record');
      setRecording(true);
      setPaused(false);
    } else {
      sendCommand('stop');
      setRecording(false);
      setPaused(false);
    }
  };

  // togglePause function - No changes needed here
  const togglePause = () => {
    if (!recording) return; 
    if (!paused) {
      sendCommand('pause');
      setPaused(true);
    } else {
      sendCommand('resume');
      setPaused(false);
    }
  };

  // Base Button Style - Remains here as it's passed down
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
    display: 'inline-flex', // Helps align icon and text if needed later
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px', // Space between icon and text if you add text later
    lineHeight: 1, // Prevent extra height from line height
  };

  // Style for the Connect Pi button in the header - Remains here
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

  // Style for the close button ('X') on the modal - Remains here
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
      zIndex: 1 // Ensure it's above other modal content
  };

  // Gradio App URL (can be moved to env variables later)
  const gradioUrl = process.env.NEXT_PUBLIC_GRADIO_URL || "http://localhost:7860";

  return (
    <>
      <Head>
        <title>Robot Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Teko&display=swap" rel="stylesheet" />
      </Head>
      <style jsx global>{`
        /* Global styles remain unchanged */
        html, body {
          margin: 0;
          padding: 0;
          background-color: #1e1e25;
          color: #e0e0e0;
          font-family: 'Teko', sans-serif;
          height: 100vh; /* Full viewport height */
          width: 100vw; /* Full viewport width */
          overflow: hidden; /* Prevent body scrollbars */
        }
        /* Ensure the root element also takes full height */
        #__next {
            height: 100%;
        }
        button:active {
          /* Note: transform property might be overridden by specific button styles */
          /* Consider applying this in a more specific way if needed */
        }
        button:disabled {
            background-color: #555 !important; /* Use important if base style interferes */
            cursor: not-allowed;
            color: #aaa;
            transform: none !important; /* Prevent active scale on disabled */
        }
        input {
            background-color: #333;
            color: #eee;
            border: 1px solid #555;
            border-radius: 4px;
            font-family: sans-serif;
            font-size: 14px;
        }
        /* Style for the main layout container */
        .dashboard-layout {
            height: 100vh; /* Full height */
            display: flex;
            flex-direction: column; /* Stack header and grid */
        }
        .main-grid {
            flex-grow: 1; /* Grid takes remaining space */
            padding: 20px;
            display: grid;
            gridTemplateColumns: 1fr 1fr;
            gridTemplateRows: auto 1fr; /* Top row auto, bottom row flexible */
            gap: 20px;
            overflow: hidden; /* Hide overflow for the grid itself */
             /* Diagnostic border: */
            /* border: 2px solid red;  */
        }
         /* Style adjustments for sections to prevent content overflow */
        .grid-section {
            /* background-color: rgba(255, 255, 255, 0.05); */ /* Optional: Visual aid */
            border-radius: 8px;
            padding: 15px; /* Add padding inside sections */
            overflow: hidden; /* Crucial: Prevent content from breaking grid */
            display: flex; /* Use flexbox for internal layout */
            flex-direction: column; /* Stack title and content vertically */
            /* Diagnostic border: */
            /* border: 1px solid blue; */
        }
        .grid-section h2 {
             flex-shrink: 0; /* Prevent titles from shrinking */
             margin-bottom: 15px; /* Space below title */
        }
        .grid-section-content {
             flex-grow: 1; /* Allow content area to fill space */
             overflow: auto; /* Add scrollbars IF content overflows its area */
              /* Diagnostic border: */
             /* border: 1px solid lightgreen; */
        }

      `}</style>

      {/* --- Use a flex container for overall layout --- */}
      <div className="dashboard-layout">

        {/* Top Banner - No changes needed here */}
        <div style={{
          width: '100%',
          backgroundColor: '#2a2a33',
          padding: '10px 0',
          textAlign: 'center',
          fontSize: '28px',
          fontWeight: 'bold',
          color: '#ffab40',
          position: 'relative', // For Connect button
          flexShrink: 0 // Prevent banner from shrinking
        }}>
          Robot Dashboard
          <button
              onClick={() => setShowLogin(true)}
              style={connectButtonStyle}
              title="Connect to Raspberry Pi"
          >
            Connect Pi
          </button>
        </div>

        {/* Login Modal - No changes needed here */}
        {showLogin && (
          <div style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(30, 30, 37, 0.85)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1000
          }}>
            <div style={{
              backgroundColor: '#2a2a33', padding: '40px', paddingTop: '50px',
              borderRadius: '10px', boxShadow: '0 5px 15px rgba(0, 0, 0, 0.4)',
              position: 'relative', width: '350px'
            }}>
              <button
                  onClick={() => setShowLogin(false)}
                  style={closeButtonStyle}
                  aria-label="Close login"
              > X </button>
              <h2 style={{ marginTop: 0, marginBottom: '25px', textAlign: 'center' }}>Connect to Raspberry Pi</h2>
              <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} style={{ marginBottom: '15px', width: '100%', padding: '12px', boxSizing: 'border-box' }} />
              <input placeholder="Host (e.g., pi.local or IP)" value={host} onChange={(e) => setHost(e.target.value)} style={{ marginBottom: '15px', width: '100%', padding: '12px', boxSizing: 'border-box' }} />
              <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: '25px', width: '100%', padding: '12px', boxSizing: 'border-box' }} />
              <button
                  onClick={connectToSSH}
                  style={{...buttonStyle, width: '100%', fontSize: '18px'}}
                  // Disable button logic can be more refined based on status
                  disabled={status === 'connected' || (socketRef.current && socketRef.current.readyState === WebSocket.CONNECTING)}
              >
                {(socketRef.current && socketRef.current.readyState === WebSocket.CONNECTING) ? 'Connecting...' : (status === 'connected' ? 'Connected' : 'Connect')}
              </button>
              {status === 'error' && (
                  <p style={{ color: '#ff6b6b', textAlign: 'center', marginTop: '15px', fontSize: '14px', fontFamily: 'sans-serif' }}>Connection failed. Check details or server.</p>
              )}
            </div>
          </div>
        )}

        {/* Main Grid Layout using the new components --- */}
        <div className="main-grid">

          {/* Top Left - Live Feed */}
          <div className="grid-section" style={{ gridColumn: '1 / 2', gridRow: '1 / 2' }}>
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

          {/* Top Right - Movement Controls */}
          <div className="grid-section" style={{ gridColumn: '2 / 3', gridRow: '1 / 2' }}>
             <MovementControls buttonStyle={buttonStyle} />
          </div>

          {/* Bottom Left - Terminal */}
           {/* Ensure this grid cell itself can handle potential overflow if needed */}
          <div className="grid-section" style={{ gridColumn: '1 / 2', gridRow: '2 / 3' }}>
             {/* Pass the CURRENT socket instance */}
             <TerminalDisplay socket={socketRef.current} status={status} />
          </div>


          {/* Bottom Right - Gradio */}
           <div className="grid-section" style={{ gridColumn: '2 / 3', gridRow: '2 / 3' }}>
             <SlamApp gradioUrl={gradioUrl} />
           </div>

        </div>

      </div>
    </>
  );
}