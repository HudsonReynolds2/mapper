#!/usr/bin/env python3
import socket
import struct
import os
import time

# ── CONFIG ──────────────────────────────────────────────────────────
HOST = '0.0.0.0'
PORT = 6000
# Directory to store incoming frames (will be created if missing)
FRAMES_DIR = os.path.expanduser('~/roboServer/frames')
# ───────────────────────────────────────────────────────────────────

def handle_client(conn, addr):
    print(f"[Server] Client connected: {addr}")
    try:
        # Ensure frames directory exists
        os.makedirs(FRAMES_DIR, exist_ok=True)

        while True:
            # 1) Read 4-byte length prefix
            raw = conn.recv(4)
            if not raw:
                print("[Server] Connection closed by client")
                break
            img_len = struct.unpack('!I', raw)[0]

            # 2) Read image payload
            data = b''
            while len(data) < img_len:
                packet = conn.recv(img_len - len(data))
                if not packet:
                    break
                data += packet
            if len(data) != img_len:
                print(f"[Server] Incomplete image: expected {img_len}, got {len(data)}")
                break

            # 3) Save each frame with a timestamped filename
            ts = time.strftime("%Y%m%d-%H%M%S")
            fname = f"frame_{ts}.jpg"
            path = os.path.join(FRAMES_DIR, fname)
            with open(path, 'wb') as f:
                f.write(data)
            print(f"[Server] Saved {fname}")

            # 4) Send per-frame acknowledgment
            conn.sendall(b"Image received by server\n")

    except Exception as e:
        print(f"[Server] Error: {e}")
    finally:
        conn.close()


def main():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        # Allow quick restarts
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((HOST, PORT))
        s.listen(1)
        print(f"[Server] Listening on {HOST}:{PORT}")
        while True:
            conn, addr = s.accept()
            handle_client(conn, addr)


if __name__ == "__main__":
    main()
