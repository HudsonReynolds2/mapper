#!/usr/bin/env python3
import socket, struct, io, time
from picamera2 import Picamera2

LAPTOP_IP = '10.0.0.111'   # your laptop’s LAN IP
PORT      = 6000
FPS       = 5             # desired stream rate

def main():
    # 1) Camera setup once
    picam2 = Picamera2()
    cfg = picam2.create_preview_configuration(
        main={"format":"XRGB8888","size":(640,480)}
    )
    picam2.configure(cfg)
    picam2.start()

    # 2) Open one persistent socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect((LAPTOP_IP, PORT))
    print("[Pi] Connected → streaming…")

    try:
        while True:
            t0 = time.time()

            # capture into in-memory JPEG
            stream = io.BytesIO()
            picam2.capture_file(stream, format="jpeg")
            img = stream.getvalue()

            # send length + payload
            s.sendall(struct.pack('!I', len(img)))
            s.sendall(img)

            # wait for ack (newline-terminated)
            ack = b''
            while not ack.endswith(b'\n'):
                part = s.recv(64)
                if not part:
                    raise RuntimeError("Server closed connection")
                ack += part
            print(f"[Pi] ACK: {ack.decode().strip()}")

            # throttle to ~FPS
            dt = time.time() - t0
            wait = max(0, 1.0/FPS - dt)
            time.sleep(wait)
    except Exception as e:
        print(f"[Pi] Stream error: {e}")
    finally:
        s.close()
        picam2.close()

if __name__ == "__main__":
    main()
