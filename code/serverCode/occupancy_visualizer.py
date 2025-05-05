"""
Occupancy Map Visualizer Module
================================

Provides functions to convert a sparse occupancy dictionary into a 2D array
and visualize it using matplotlib.

Functions:
- `occupancy_dict_to_array(occ_dict, bbox=None)`: Transforms occupancy dict into NumPy array with optional bounding box.
- `plot_occupancy_map(arr, origin=None, resolution=None, ax=None, show=True, save_path=None)`: Renders the occupancy grid.

Usage:
```python
from occupancy_visualizer import occupancy_dict_to_array, plot_occupancy_map
from occupancy_mapping import get_occupancy_dict, get_bounding_box, RESOLUTION, ORIGIN_X, ORIGIN_Y

occ_dict = get_occupancy_dict()
arr, bbox = occupancy_dict_to_array(occ_dict, bbox=get_bounding_box())
plot_occupancy_map(arr, origin=(ORIGIN_X + bbox[0]*RESOLUTION,
                                 ORIGIN_Y + bbox[2]*RESOLUTION),
                   resolution=RESOLUTION)
```  
"""

import numpy as np
import matplotlib.pyplot as plt
from serverCode.create_occupancy_grid import get_bounding_box, RESOLUTION, ORIGIN_X, ORIGIN_Y


def occupancy_dict_to_array(occ_dict, bbox=None):
    """
    Convert sparse occupancy dict to a dense 2D NumPy array.

    Args:
        occ_dict: dict mapping (cx,cy) to occupancy {-1, 0, 1}
        bbox: Optional bounding box tuple (min_cx, max_cx, min_cy, max_cy).
              If None, computed from occ_dict keys.

    Returns:
        arr: 2D NumPy array of shape (height, width) with values -1,0,1.
        bbox: bounding box used (min_cx, max_cx, min_cy, max_cy).
    """
    if bbox is None:
        bbox = get_bounding_box()
    min_cx, max_cx, min_cy, max_cy = bbox
    width = max_cx - min_cx + 1
    height = max_cy - min_cy + 1
    arr = np.full((height, width), -1, dtype=int)
    for (cx, cy), val in occ_dict.items():
        x = cx - min_cx
        y = cy - min_cy
        arr[y, x] = val
    return arr, bbox


def plot_occupancy_map(arr, origin=None, resolution=None, ax=None, show=True, save_path=None):
    """
    Plot a 2D occupancy grid array.

    Args:
        arr: 2D array with values {-1,0,1} for unknown, free, occupied.
        origin: (x_world, y_world) of the array's (0,0) cell in meters.
        resolution: size of each cell in meters.
        ax: Optional matplotlib Axes to draw on.
        show: If True, call plt.show().
        save_path: If given, save figure to this path.
    """
    # Map values to colors: occupied=0, free=1, unknown=0.5
    cmap = plt.cm.gray
    display = np.zeros_like(arr, dtype=float)
    display[arr == 1] = 1.0    # occupied white
    display[arr == 0] = 0.0    # free black
    display[arr == -1] = 0.5   # unknown gray

    if ax is None:
        fig, ax = plt.subplots(figsize=(6, 6))
    im = ax.imshow(display, origin='lower', interpolation='nearest', cmap=cmap)
    ax.set_aspect('equal')

    if origin is not None and resolution is not None:
        min_x, min_y = origin
        h, w = arr.shape
        ax.set_xlim(-0.5, w - 0.5)
        ax.set_ylim(-0.5, h - 0.5)
        xticks = np.arange(0, w, max(1, w // 5))
        yticks = np.arange(0, h, max(1, h // 5))
        ax.set_xticks(xticks)
        ax.set_yticks(yticks)
        ax.set_xticklabels((min_x + xticks * resolution).round(2))
        ax.set_yticklabels((min_y + yticks * resolution).round(2))
        ax.set_xlabel('X (m)')
        ax.set_ylabel('Y (m)')

    if save_path:
        plt.savefig(save_path, bbox_inches='tight')
    if show:
        plt.show()

    return ax
