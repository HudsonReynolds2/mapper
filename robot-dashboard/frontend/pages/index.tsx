import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';

const TerminalShell = dynamic(() => import('../components/TerminalShell'), { ssr: false });

export default function Home() {
  const [imgUrl, setImgUrl] = useState('/placeholder.jpg');
  const [showLogin, setShowLogin] = useState(true);
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

  useEffect(() => {
    const liveSocket = new WebSocket('ws://localhost:5001');
    liveSocketRef.current = liveSocket;

    liveSocket.onopen = () => {
      liveSocket.send(JSON.stringify({ type: 'register', client: 'dashboard' }));
    };

    liveSocket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'frame') {
        setImgUrl(msg.data);

        const now = Date.now();
        if (lastFrameTimeRef.current) {
          const delta = now - lastFrameTimeRef.current;
          const currentFps = Math.round(1000 / delta);
          setFps(currentFps);
        }
        lastFrameTimeRef.current = now;
      }
    };

    return () => liveSocket.close();
  }, []);

  const connectToSSH = () => {
    const socket = new WebSocket('ws://localhost:5001');
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', username, host, password }));
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'status') {
        setStatus(msg.connected ? 'connected' : 'disconnected');
        if (msg.connected) {
          setShowLogin(false);
        }
      }

      if (msg.type === 'error') {
        setStatus('error');
      }
    };

    socket.onclose = () => setStatus('disconnected');
  };

  const sendCommand = (type: string) => {
    if (liveSocketRef.current && liveSocketRef.current.readyState === WebSocket.OPEN) {
      liveSocketRef.current.send(JSON.stringify({ type }));
    }
  };

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

  const buttonStyle = {
    padding: '12px 20px',
    margin: '5px',
    backgroundColor: '#ffab40',
    color: '#1e1e25',
    border: 'none',
    borderRadius: '8px',
    fontSize: '18px',
    fontFamily: 'Teko, sans-serif',
    cursor: 'pointer',
    minWidth: '160px',
    transition: 'transform 0.1s ease-in-out',
  };

  return (
    <>
      <Head>
        <link href="https://fonts.googleapis.com/css2?family=Teko&display=swap" rel="stylesheet" />
      </Head>
      <style jsx global>{`
        html, body {
          margin: 0;
          padding: 0;
          background-color: #1e1e25;
          color: #e0e0e0;
          font-family: 'Teko', sans-serif;
          overflow: hidden;
        }
        button:active {
          transform: scale(0.96);
        }
      `}</style>

      {/* Top Banner */}
      <div style={{ width: '100%', backgroundColor: '#2a2a33', padding: '10px 0', textAlign: 'center', fontSize: '28px', fontWeight: 'bold', color: '#ffab40' }}>
        Robot Dashboard
      </div>

      {showLogin && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: '#1e1e25e0', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
          <div style={{ backgroundColor: '#2a2a33', padding: '30px', borderRadius: '10px', boxShadow: '0 0 10px #000' }}>
            <h2>Connect to Raspberry Pi</h2>
            <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} style={{ marginBottom: '10px', width: '100%', padding: '10px' }} />
            <input placeholder="Host (e.g., hudPi3.local)" value={host} onChange={(e) => setHost(e.target.value)} style={{ marginBottom: '10px', width: '100%', padding: '10px' }} />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: '20px', width: '100%', padding: '10px' }} />
            <button onClick={connectToSSH} style={buttonStyle}>Connect</button>
          </div>
        </div>
      )}

      <div style={{ 
        height: 'calc(100vh - 60px)',
        padding: '20px', 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gridTemplateRows: 'auto auto', 
        gap: '20px',
        overflowY: 'auto'
      }}>

        {/* Top Left - Live Feed */}
        <section style={{ gridColumn: '1 / 2', gridRow: '1 / 2', textAlign: 'center', position: 'relative' }}>
          <h2 style={{ fontSize: '36px' }}>Live Camera Feed</h2>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img 
              src={imgUrl} 
              alt="Live Feed" 
              style={{ 
                width: '75%', 
                height: 'auto', 
                maxHeight: '300px', 
                background: '#333', 
                borderRadius: '10px', 
                objectFit: 'cover',
                border: '2px solid #555'
              }} 
            />
            <div style={{ position: 'absolute', top: '10px', left: '10px', backgroundColor: 'rgba(0,0,0,0.6)', padding: '4px 10px', borderRadius: '5px', color: '#00ff00', fontSize: '16px' }}>
              FPS: {fps}
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            <button onClick={toggleRecording} style={buttonStyle}>
              {recording ? 'Stop Recording' : 'Start Recording'}
            </button>
            <button onClick={togglePause} style={buttonStyle} disabled={!recording}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </section>

        {/* Top Right - Movement Controls */}
        <section style={{ gridColumn: '2 / 3', gridRow: '1 / 2', textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px' }}>Movement Controls</h2>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div>
              <button style={buttonStyle}><img src="/icons/turn-left.svg" alt="Turn Left" width="32" /></button>
              <button style={buttonStyle}><img src="/icons/forward.svg" alt="Forward" width="32" /></button>
              <button style={buttonStyle}><img src="/icons/turn-right.svg" alt="Turn Right" width="32" /></button>
            </div>
            <div style={{ marginTop: '10px' }}>
              <button style={buttonStyle}><img src="/icons/left.svg" alt="Left" width="32" /></button>
              <button style={{ ...buttonStyle, visibility: 'hidden' }}>Hidden</button>
              <button style={buttonStyle}><img src="/icons/right.svg" alt="Right" width="32" /></button>
            </div>
            <div style={{ marginTop: '10px' }}>
              <button style={buttonStyle}><img src="/icons/backward.svg" alt="Backward" width="32" /></button>
            </div>
          </div>
        </section>

        {/* Bottom Left - Terminal */}
        <section style={{ gridColumn: '1 / 2', gridRow: '2 / 3', textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px' }}>Terminal</h2>
          <TerminalShell socket={socketRef.current} />
          <p style={{ color: status === 'connected' ? '#00ff00' : 'red' }}>
            {status === 'connected' ? 'Connected to Pi' : 'Disconnected'}
          </p>
        </section>

        {/* Bottom Right - Gradio Placeholder */}
        <section style={{ gridColumn: '2 / 3', gridRow: '2 / 3', textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px' }}>SLAM App (coming soon)</h2>
          <div style={{ 
            width: '90%', 
            height: '300px', 
            backgroundColor: '#2a2a33', 
            color: '#aaa', 
            padding: '20px', 
            borderRadius: '10px',
            border: '2px dashed #555'
          }}>
            <p>Future Gradio SLAM embed will go here.</p>
          </div>
        </section>

      </div>
    </>
  );
}