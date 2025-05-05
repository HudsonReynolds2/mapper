import asyncio
import websockets
import cv2
import base64
import json
from datetime import datetime

WEBSOCKET_SERVER = 'ws://10.0.0.69:5000'

async def send_frames():
    async with websockets.connect(WEBSOCKET_SERVER) as websocket:
        print("🔌 Connected to server")
        await websocket.send(json.dumps({ "type": "register", "client": "pi" }))

        cap = cv2.VideoCapture(0)
        recording = False

        while True:
            try:
                ret, frame = cap.read()
                if not ret:
                    continue

                _, buffer = cv2.imencode('.jpg', frame)
                b64 = base64.b64encode(buffer).decode('utf-8')
                data_url = f'data:image/jpeg;base64,{b64}'

                # Always send frame to server for live view
                await websocket.send(json.dumps({ "type": "frame", "data": data_url }))

                # Listen for commands
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=0.01)
                    command = json.loads(message)
                    if command.get("type") == "record":
                        print("📹 Start recording")
                        recording = True
                    elif command.get("type") == "stop":
                        print("⏹️ Stop recording")
                        recording = False
                except asyncio.TimeoutError:
                    pass

                await asyncio.sleep(0.03)  # approx 30 fps

            except websockets.exceptions.ConnectionClosed:
                print("❌ Disconnected from server")
                break

        cap.release()

if __name__ == '__main__':
    asyncio.run(send_frames())

