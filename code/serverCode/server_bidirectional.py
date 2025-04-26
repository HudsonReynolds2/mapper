#!/usr/bin/env python3
"""Bidirectional frame server (no Picamera2 dependency)
=======================================================
Receives JPEG frames from a Raspberry Pi client and can send UTF‑8
newline‑terminated commands back on the **same socket**.

* **Frame protocol** – 16‑byte header `!IqI` (frame_id:uint32,
  ts_us:int64, jpeg_len:uint32) + payload.
* **Command protocol** – any UTF‑8 text ending with `\n`.

Adjust `decide_command()` to integrate your own SLAM/navigation logic.
"""

from __future__ import annotations

import os, socket, struct, time, threading
from datetime import datetime
from typing import Optional

# ───────────────────────── USER CONFIG ──────────────────────────────
HOST         = "0.0.0.0"
PORT         = 6000
SAVE_DIR     = os.path.expanduser("~/frames")
LOG_EVERY_N  = 60          # print every N frames
CMD_INTERVAL = 0.2         # seconds between command generations (min)

_last_cmd_time = 0.0

def decide_command(frame_id: int, filepath: str) -> Optional[str]:
    """Return command string (must end with `\n`) or None.
    Replace with real SLAM decision logic.
    """
    global _last_cmd_time
    now = time.time()
    if frame_id % 150 == 0 and now - _last_cmd_time > CMD_INTERVAL:
        _last_cmd_time = now
        return "NOP\n"
    return None

# ───────────────────────── FRAME HANDLER ────────────────────────────

def handle_client(conn: socket.socket, addr):
    print(f"[Server] Client {addr} connected")
    conn.settimeout(5.0)
    try:
        while True:
            # 1. Read header (exactly 16 bytes)
            header = b''
            while len(header) < 16:
                chunk = conn.recv(16 - len(header))
                if not chunk:
                    raise ConnectionError("Client disconnected during header")
                header += chunk
            frame_id, ts_us, jpeg_len = struct.unpack('!IqI', header)

            # 2. Read JPEG payload
            remaining = jpeg_len
            data = bytearray()
            while remaining:
                chunk = conn.recv(min(65536, remaining))
                if not chunk:
                    raise ConnectionError("Client disconnected during JPEG")
                data.extend(chunk)
                remaining -= len(chunk)

            # 3. Save frame
            dt = datetime.fromtimestamp(ts_us / 1_000_000.0)
            fname = f"frame_{frame_id:06d}_{dt.strftime('%Y%m%d-%H%M%S-%f')}.jpg"
            path = os.path.join(SAVE_DIR, fname)
            with open(path, 'wb') as f:
                f.write(data)
            if frame_id % LOG_EVERY_N == 0:
                print(f"[Server] Saved {fname}")

            # 4. Optionally send command
            cmd = decide_command(frame_id, path)
            if cmd:
                conn.sendall(cmd.encode('utf-8'))
    except Exception as e:
        print(f"[Server] Connection {addr} closed: {e}")
    finally:
        conn.close()

# ───────────────────────── MAIN LISTENER ───────────────────────────

if __name__ == "__main__":
    os.makedirs(SAVE_DIR, exist_ok=True)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as srv:
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((HOST, PORT))
        srv.listen(5)
        print(f"[Server] Listening on {HOST}:{PORT} – writing to {SAVE_DIR}")
        while True:
            conn, addr = srv.accept()
            # spawn a thread so server can accept new connections while processing
            threading.Thread(target=handle_client, args=(conn, addr), daemon=True).start()
