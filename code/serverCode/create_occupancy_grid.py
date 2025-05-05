"""
2D Occupancy Mapping (Dynamic, Unbounded) with Floor Alignment
================================================================

Maintains an unbounded occupancy grid in a Python `dict`, keyed by cell indices, and ensures the floor plane is aligned to the XY grid.

Features:
- **Sparse storage**: Only stores observed cells, enabling unbounded maps.
- **Floor alignment**: Rotates incoming point clouds so the dominant floor plane is horizontal.
- **Log-odds fusion**: Incremental updates for occupied/free evidence.
- **Bresenham ray-casting**: Carves free and occupied cells along sensor beams.
- **Occupancy export**: Returns a dict mapping cells to occupancy values {1=occupied, 0=free, -1=unknown}.

Usage:
```python
# On each sensor update:
# 1) update_map with raw point cloud and sensor origin
update_map(point_cloud, sensor_origin)
# 2) retrieve occupancy
occ_dict = get_occupancy_dict()
# 3) optional: get bounding box for visualization
bbox = get_bounding_box()
```
"""

import math
import numpy as np
from collections import defaultdict

# Grid parameters (metric conversion)
RESOLUTION = 0.05    # meters per cell
ORIGIN_X = 0.0       # world x-coordinate of cell (0,0)
ORIGIN_Y = 0.0       # world y-coordinate of cell (0,0)

# Log-odds update values
LO_OCC   = 0.85      # occupied increment
LO_FREE  = -0.40     # free-space decrement
LO_MIN   = -5.0      # minimum clamp
LO_MAX   = 5.0       # maximum clamp

# Sparse log-odds storage: (cx,cy) -> log-odds value
log_odds = {}


def to_cell(x, y):
    """Convert world (x,y) to grid cell indices."""
    cx = int((x - ORIGIN_X) / RESOLUTION)
    cy = int((y - ORIGIN_Y) / RESOLUTION)
    return cx, cy


def bresenham(start, end):
    """Yield grid cells along the line from start to end using Bresenham's algorithm."""
    x0, y0 = start
    x1, y1 = end
    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    x, y = x0, y0
    sx = 1 if x1 > x0 else -1
    sy = 1 if y1 > y0 else -1
    if dx > dy:
        err = dx / 2.0
        while x != x1:
            yield x, y
            err -= dy
            if err < 0:
                y += sy
                err += dx
            x += sx
    else:
        err = dy / 2.0
        while y != y1:
            yield x, y
            err -= dx
            if err < 0:
                x += sx
                err += dy
            y += sy
    yield x1, y1


def align_floor(point_cloud, floor_z_max=0.1):
    """
    Rotate the point cloud so that the dominant floor plane is horizontal.

    Args:
        point_cloud: Nx3 numpy array of (x,y,z).
        floor_z_max: max |z| to select floor points.
    Returns:
        rotated: Nx3 numpy array of aligned points.
    """
    pts = np.asarray(point_cloud)
    # Select candidate floor points
    mask = np.abs(pts[:,2]) < floor_z_max
    floor_pts = pts[mask]
    if floor_pts.shape[0] < 3:
        return pts  # insufficient points to fit
    # Fit plane via SVD
    centroid = floor_pts.mean(axis=0)
    _, _, vh = np.linalg.svd(floor_pts - centroid)
    normal = vh[-1]
    # Ensure normal points upward
    if normal[2] < 0:
        normal = -normal
    target = np.array([0, 0, 1.0])
    # Compute rotation axis and angle
    axis = np.cross(normal, target)
    axis_norm = np.linalg.norm(axis)
    if axis_norm < 1e-6:
        return pts  # already aligned
    axis /= axis_norm
    angle = np.arccos(np.dot(normal, target))
    # Rodrigues' rotation formula
    K = np.array([[    0, -axis[2],  axis[1]],
                  [ axis[2],     0, -axis[0]],
                  [-axis[1], axis[0],     0]])
    R = np.eye(3) + math.sin(angle)*K + (1-math.cos(angle))*(K @ K)
    # Rotate about centroid
    return ((R @ (pts - centroid).T).T + centroid)


def update_map(point_cloud, sensor_origin, height_threshold=1.0):
    """
    Fuse a 3D point cloud into the sparse occupancy grid.
    Automatically aligns the floor before projection.

    Args:
        point_cloud: Iterable of (x, y, z).
        sensor_origin: Tuple (sx, sy) of sensor location.
        height_threshold: Max |z| to include in map after alignment.
    """
    # Convert to numpy array and align floor
    pts = np.asarray(point_cloud)
    aligned = align_floor(pts)
    # Project points within height threshold
    hits = [(x, y) for x, y, z in aligned if abs(z) < height_threshold]
    sensor_cell = to_cell(*sensor_origin)
    for hx, hy in hits:
        hit_cell = to_cell(hx, hy)
        for cell in bresenham(sensor_cell, hit_cell):
            prev = log_odds.get(cell, 0.0)
            delta = LO_OCC if cell == hit_cell else LO_FREE
            lo = prev + delta
            # Clamp
            log_odds[cell] = max(LO_MIN, min(LO_MAX, lo))


def get_occupancy_dict():
    """
    Convert log-odds to occupancy values.

    Returns:
        dict[(cx,cy)]->int {1=occupied, 0=free, -1=unknown}
    """
    occ = {}
    for cell, lo in log_odds.items():
        p = 1 - 1/(1 + math.exp(lo))
        if p > 0.65:
            occ[cell] = 1
        elif p < 0.35:
            occ[cell] = 0
        else:
            occ[cell] = -1
    return occ


def get_bounding_box():
    """Return (min_cx, max_cx, min_cy, max_cy) of observed cells."""
    if not log_odds:
        return 0, 0, 0, 0
    xs, ys = zip(*log_odds.keys())
    return min(xs), max(xs), min(ys), max(ys)


if __name__ == '__main__':
    # Example:
    # raw_pc = [(x,y,z), ...]
    # update_map(raw_pc, (0,0))
    # occ = get_occupancy_dict()
    pass
