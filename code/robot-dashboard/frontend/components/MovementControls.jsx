import React from 'react';

// Accept buttonStyle as a prop
const MovementControls = ({ buttonStyle }) => {
  // In the future, you would pass functions here to handle button clicks
  // e.g., const MovementControls = ({ buttonStyle, moveForward, turnLeft, ... }) => { ... }

  // Placeholder functions for button clicks (replace with actual logic)
  const handleMove = (direction) => {
      console.log(`Move: ${direction}`);
      // Add WebSocket send logic here later
  };

  return (
    <section style={{ textAlign: 'center', overflow: 'hidden' }}>
      <h2 style={{ fontSize: '32px', margin: '0 0 10px 0' }}>Movement Controls</h2>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
          <button style={buttonStyle} title="Turn Left" onClick={() => handleMove('turn-left')}>
            <img src="/icons/turn-left.svg" alt="Turn Left" width="24" height="24" />
          </button>
          <button style={buttonStyle} title="Forward" onClick={() => handleMove('forward')}>
            <img src="/icons/forward.svg" alt="Forward" width="24" height="24" />
          </button>
          <button style={buttonStyle} title="Turn Right" onClick={() => handleMove('turn-right')}>
            <img src="/icons/turn-right.svg" alt="Turn Right" width="24" height="24" />
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
          <button style={buttonStyle} title="Strafe Left" onClick={() => handleMove('strafe-left')}>
            <img src="/icons/left.svg" alt="Left" width="24" height="24" />
          </button>
          {/* Placeholder or Stop Button */}
          <button style={{ ...buttonStyle, visibility: 'hidden' }}>Hidden</button>
          <button style={buttonStyle} title="Strafe Right" onClick={() => handleMove('strafe-right')}>
            <img src="/icons/right.svg" alt="Right" width="24" height="24" />
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
          <button style={buttonStyle} title="Backward" onClick={() => handleMove('backward')}>
            <img src="/icons/backward.svg" alt="Backward" width="24" height="24" />
          </button>
        </div>
      </div>
    </section>
  );
};

export default MovementControls;