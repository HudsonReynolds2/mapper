import React from 'react';
import dynamic from 'next/dynamic';

// Dynamically import TerminalShell here as well if not already global
const TerminalShell = dynamic(() => import('./TerminalShell'), { ssr: false });

// Accept socket and status as props
const TerminalDisplay = ({ socket, status }) => {

  const getStatusText = () => {
    switch (status) {
      case 'connected': return 'Connected to Pi';
      case 'error': return 'Connection Error';
      case 'disconnected':
      default: return 'Disconnected';
    }
  };

  const getStatusColor = () => {
      switch (status) {
        case 'connected': return '#00ff00'; // Green
        case 'error': return 'red';         // Red
        case 'disconnected':
        default: return '#ffcc00';        // Yellow
      }
  };

  return (
    <section style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' /* Ensure section takes full height */ }}>
      <h2 style={{ fontSize: '32px', margin: '0 0 10px 0', flexShrink: 0 /* Prevent title from shrinking */ }}>Terminal</h2>
      <div style={{ 
          flexGrow: 1, // Allow terminal wrapper to grow
          backgroundColor: '#111', 
          borderRadius: '8px', 
          overflow: 'hidden', // Important for TerminalShell's own scrolling
          border: '1px solid #444', 
          minHeight: '150px', /* Adjust min-height as needed */
          display: 'flex' /* Make it a flex container for TerminalShell */
      }}>
        {/* Pass the socket prop to TerminalShell */}
        {/* Ensure TerminalShell itself fills this container */}
        <TerminalShell socket={socket} /> 
      </div>
      <p style={{
          color: getStatusColor(),
          marginTop: '10px',
          height: '20px', /* Reserve space */
          flexShrink: 0 /* Prevent status from shrinking */
      }}>
        Status: {getStatusText()}
      </p>
    </section>
  );
};

export default TerminalDisplay;