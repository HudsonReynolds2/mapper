import React from 'react';

// Accept gradioUrl as a prop for flexibility
const SlamApp = ({ gradioUrl = "http://localhost:7860" }) => {
  return (
    <section style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <h2 style={{ fontSize: '32px', margin: '0 0 10px 0', flexShrink: 0 }}>SLAM App</h2>
      <div style={{
          flexGrow: 1, // Allow div to fill space
          width: '100%', // Use full width of grid cell
          backgroundColor: '#2a2a33',
          borderRadius: '10px',
          border: '1px solid #444',
          overflow: 'hidden', // Ensure iframe doesn't overflow
          minHeight: '150px' /* Adjust min-height */
      }}>
        <iframe
          src={gradioUrl} // Use the prop here
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          title="SLAM App" // Add title for accessibility
        />
      </div>
    </section>
  );
};

export default SlamApp;