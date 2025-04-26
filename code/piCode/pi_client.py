#!/usr/bin/env python3
"""Interactive, pause‑resumable Pi streaming client
===================================================
Adds **live commands** accepted *both* from the server (over the existing
return channel) *and* from the Pi’s own terminal (stdin):

* `pause`   – stop capturing new frames but finish sending queue.
* `resume`  – resume capturing.
* `stop`    – orderly shutdown of all threads and exit.

This prevents loss of trailing frames when you want to momentarily halt the
camera: issue `pause`, wait a moment until `frame_q` drains on the server, then
`resume` to continue.
"""

from __future__ import annotations

import io, os, socket, struct, threading, queue, time, select, sys
from picamera2 import Picamera2

# ───────────────────────── USER CONFIG ──────────────────────────────
SERVER_HOST = os.getenv("STREAM_SERVER", "10.0.0.111")
SERVER_PORT = 6000
FRAME_RATE  = 30
SHUTTER_US  = 16_667           # 1/60 s
RESOLUTION  = (1280, 720)
QUEUE_MAX   = 240
RETRY_DELAY = 1.0

# ────────────────────────── GLOBAL STATE ────────────────────────────
connected_evt  = threading.Event()
capture_evt    = threading.Event(); capture_evt.set()   # toggled by pause/resume
shutdown_evt   = threading.Event()                      # set on stop
frame_q: "queue.Queue[tuple[int,float,bytes]]" = queue.Queue(maxsize=QUEUE_MAX)
frame_id = 0
picam2: Picamera2 | None = None

# ─────────────────────—— COMMAND DISPATCH ————————————————

def dispatch_command(cmd: str) -> None:
    """Execute a command (from stdin or server)."""
    cmd = cmd.strip().lower()
    if cmd == "pause":
        if capture_evt.is_set():
            capture_evt.clear()
            print("[Pi] Capture paused")
    elif cmd == "resume":
        if not capture_evt.is_set():
            capture_evt.set()
            print("[Pi] Capture resumed")
    elif cmd == "stop":
        print("[Pi] Stopping…")
        shutdown_evt.set()
    else:
        print(f"[Pi] Unknown cmd: {cmd!r}")

# ───────────────────────── CAPTURE THREAD ───────────────────────────

def capture_loop() -> None:
    global frame_id
    buf = io.BytesIO()
    while not shutdown_evt.is_set():
        if not (connected_evt.is_set() and capture_evt.is_set()):
            time.sleep(0.02)
            continue
        t0 = time.time()
        buf.seek(0); buf.truncate(0)
        picam2.capture_file(buf, format="jpeg")
        jpeg = buf.getvalue()
        frame_id += 1
        frame_q.put((frame_id, t0, jpeg))

# ───────────────────────── NETWORK THREAD ───────────────────────────

def network_loop() -> None:
    recv_buf = bytearray()
    while not shutdown_evt.is_set():
        connected_evt.clear()
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4 << 20)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            sock.connect((SERVER_HOST, SERVER_PORT))
            print(f"[Pi] Connected → {SERVER_HOST}:{SERVER_PORT}")
            connected_evt.set()

            while not shutdown_evt.is_set():
                try:
                    fid, ts, jpeg = frame_q.get(timeout=0.05)
                except queue.Empty:
                    # Still poll for commands even if no frames to send
                    fid = None
                if fid is not None:
                    header = struct.pack("!IqI", fid, int(ts * 1_000_000), len(jpeg))
                    sock.sendall(header + jpeg)

                # Poll for inbound commands
                r_ready, _, _ = select.select([sock], [], [], 0)
                if r_ready:
                    data = sock.recv(4096)
                    if not data:
                        raise ConnectionError("Server closed socket")
                    recv_buf.extend(data)
                    while b"\n" in recv_buf:
                        line, _, recv_buf = recv_buf.partition(b"\n")
                        dispatch_command(line.decode("utf-8", "ignore"))
        except Exception as e:
            if not shutdown_evt.is_set():
                print(f"[Pi] link error: {e} – retrying in {RETRY_DELAY}s")
                try:
                    sock.close()
                except Exception:
                    pass
                time.sleep(RETRY_DELAY)

# ───────────────────────── STDIN THREAD ─────────────────────────────

def stdin_loop() -> None:
    """Read commands from local terminal (non‑blocking)."""
    for line in sys.stdin:
        dispatch_command(line)
        if shutdown_evt.is_set():
            break

# ───────────────────────── CAMERA SETUP ─────────────────────────────

def init_camera() -> None:
    global picam2
    picam2 = Picamera2()
    cfg = picam2.create_video_configuration(main={"format": "RGB888", "size": RESOLUTION})
    cfg["controls"] = {"FrameRate": float(FRAME_RATE), "ExposureTime": SHUTTER_US}
    picam2.configure(cfg)
    picam2.start()

# ───────────────────────── MAIN ─────────────────────────────────────

def main() -> None:
    try:
        init_camera()
        threading.Thread(target=capture_loop, daemon=True).start()
        threading.Thread(target=network_loop, daemon=True).start()
        threading.Thread(target=stdin_loop,   daemon=True).start()
        print("[Pi] Streaming – type 'pause', 'resume', or 'stop' + Enter")
        while not shutdown_evt.is_set():
            time.sleep(0.2)
    except KeyboardInterrupt:
        print("[Pi] Interrupted – exiting.")
    finally:
        shutdown_evt.set()
        if picam2:
            picam2.close()

if __name__ == "__main__":
    main()
