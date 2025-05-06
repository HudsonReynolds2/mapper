import React from 'react';

// Accept props for data and actions, including buttonStyle
const LiveFeed = ({ 
    imgUrl, 
    fps, 
    recording, 
    paused, 
    toggleRecording, 
    togglePause, 
    buttonStyle 
}) => {

  // Fallback image function
  const handleImageError = (e) => {
    // Prevent infinite loop if placeholder also fails
    if (e.target.src !== '/placeholder.jpg') {
        e.target.src = '/placeholder.jpg';
        console.warn("Live feed image failed to load, using placeholder.");
    }
  };

  return (
    <section style={{ textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
      <h2 style={{ fontSize: '32px', margin: '0 0 10px 0' }}>Live Camera Feed</h2>
      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
        <img
          src={imgUrl}
          alt="Live Feed"
          style={{
            display: 'block',
            maxWidth: '100%',
            maxHeight: '30vh',
            height: 'auto',
            background: '#333',
            borderRadius: '10px',
            objectFit: 'contain',
            border: '2px solid #555'
          }}
          onError={handleImageError} // Use the error handler
        />
        <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            backgroundColor: 'rgba(0,0,0,0.7)',
            padding: '4px 10px',
            borderRadius: '5px',
            color: fps > 0 ? '#00ff00' : '#ffcc00',
            fontSize: '14px',
            fontFamily: 'monospace'
        }}>
          FPS: {fps}
        </div>
      </div>
      <div style={{ marginTop: '15px' }}>
        <button onClick={toggleRecording} style={buttonStyle}>
          {recording ? 'Stop Recording' : 'Start Recording'}
        </button>
        <button onClick={togglePause} style={buttonStyle} disabled={!recording}>
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
    </section>
  );
};

export default LiveFeed;