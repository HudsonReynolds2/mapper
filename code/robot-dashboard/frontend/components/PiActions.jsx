import React from 'react';

// Component to render action buttons
// Props:
// - actions: Array of action objects { id: string, label: string, title?: string }
// - onExecute: Function to call with action id (e.g., executePiCommand)
// - buttonStyle: Style object for buttons
// - disabled: Boolean indicating if buttons should be disabled (e.g., not connected)
const PiActions = ({ actions = [], onExecute, buttonStyle, disabled = false }) => {

  if (!actions || actions.length === 0) {
    return null; // Don't render anything if no actions are defined
  }

  return (
    <section style={{ textAlign: 'center', overflow: 'hidden' }}>
      <h2 style={{ fontSize: '32px', margin: '0 0 10px 0' }}>Pi Actions</h2>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
      {actions.map((action) => (
        <button
          key={action.id} // Use id for the key
          style={buttonStyle}
          title={action.title || action.label}
          // Pass the command string to the handler
          onClick={() => onExecute(action.command)}
          disabled={disabled}
        >
          {action.label}
          {/* Optional icon */}
        </button>
      ))}
      </div>
    </section>
  );
};

export default PiActions;