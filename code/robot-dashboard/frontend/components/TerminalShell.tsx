'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';

interface TerminalShellProps {
  socket: WebSocket | null;
}

export default function TerminalShell({ socket }: TerminalShellProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (terminalRef.current && !xtermRef.current) {
      const term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        theme: {
          background: '#000000',
          foreground: '#00ff00',
        },
        fontSize: 14,
        fontFamily: 'monospace',
      });
      term.open(terminalRef.current);
      term.write('Connecting to Raspberry Pi...\r\n');
      xtermRef.current = term;
    }
  }, []);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term || !socket) return;

    const handleMessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        term.write(msg.data);
      }
    };

    const handleInput = (data: string) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', command: data }));
      }
    };

    socket.addEventListener('message', handleMessage);
    term.onData(handleInput);

    return () => {
      socket.removeEventListener('message', handleMessage);
    };
  }, [socket]);

  return (
    <div 
      ref={terminalRef} 
      style={{ 
        width: '100%', 
        height: '300px', 
        backgroundColor: '#000000', 
        borderRadius: '8px',
        textAlign: 'left',
        padding: '0',
        overflow: 'hidden',
      }} 
    />
  );
}
