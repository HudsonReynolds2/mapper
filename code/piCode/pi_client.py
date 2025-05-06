import asyncio
import websockets
import cv2
import base64
import json
# Import Picamera2 and libcamera for transforms
from picamera2 import Picamera2
# Import libcamera specifically for the Transform class
import libcamera
import time

WEBSOCKET_SERVER = 'ws://10.0.0.69:5001'

async def send_frames():
    # Initialize Picamera2
    picam2 = Picamera2()

    # --- MODIFICATION START ---
    # Create a transform object to flip vertically
    transform = libcamera.Transform(vflip=True, hflip=True)

    # Configure for preview/video, adding the transform
    # Adjust resolution (size) if needed
    config = picam2.create_preview_configuration(
        main={"size": (640, 480)},
        transform=transform # Apply the transform here
    )
    # --- MODIFICATION END ---

    picam2.configure(config)

    # Start the camera
    picam2.start()

    # Allow time for camera to initialise/warm-up
    time.sleep(2)
    print("📷 Camera started (Image Vertically Flipped)")


    async with websockets.connect(WEBSOCKET_SERVER) as websocket:
        print("🔌 Connected to server")
        await websocket.send(json.dumps({ "type": "register", "client": "pi" }))

        recording = False # recording variable remains

        while True:
            try:
                # Capture frame as a NumPy array (it will already be flipped)
                frame = picam2.capture_array()

                # Convert color space if necessary (RGB to BGR for OpenCV)
                frame_bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

                # Encode the frame to JPEG format
                ret, buffer = cv2.imencode('.jpg', frame_bgr)
                if not ret:
                    print("⚠️ Failed to encode frame")
                    continue

                b64 = base64.b64encode(buffer).decode('utf-8')
                data_url = f'data:image/jpeg;base64,{b64}'

                # Send frame to server
                await websocket.send(json.dumps({ "type": "frame", "data": data_url }))

                # Listen for commands (same as before)
                # ... (rest of the command handling logic) ...

                await asyncio.sleep(0.01)

            except websockets.exceptions.ConnectionClosed:
                print("❌ Disconnected from server")
                break
            except Exception as e:
                print(f"An error occurred: {e}")
                break

        # Stop the camera
        picam2.stop()
        print("📷 Camera stopped")

if __name__ == '__main__':
    asyncio.run(send_frames())