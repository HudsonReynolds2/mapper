#!/usr/bin/env python3
"""
Demo: Convert PLY point cloud to 2D occupancy map and visualize
===============================================================

Usage:
    python demo.py room0_gpu0/Replica_demo_room0_recon.ply \
        --sensor-x 0.0 --sensor-y 0.0 --height-th 1.5 --show

This demo:
 1. Loads a PLY point cloud using Open3D.
 2. Aligns the floor, fuses points into a sparse log-odds grid.
 3. Extracts a 2D occupancy dict, converts to an array.
 4. Plots the occupancy map with world-coordinate axes.
"""
import argparse
import numpy as np
import open3d as o3d

from occupancy_mapping import (
    update_map,
    get_occupancy_dict,
    get_bounding_box,
    RESOLUTION,
    ORIGIN_X,
    ORIGIN_Y,
)
from occupancy_visualizer import (
    occupancy_dict_to_array,
    plot_occupancy_map,
)

def main():
    parser = argparse.ArgumentParser(
        description="Demo: PLY to 2D occupancy map"
    )
    parser.add_argument(
        "ply_file",
        help="Path to input PLY point cloud",
    )
    parser.add_argument(
        "--sensor-x", type=float, default=0.0,
        help="Sensor X origin in world frame",
    )
    parser.add_argument(
        "--sensor-y", type=float, default=0.0,
        help="Sensor Y origin in world frame",
    )
    parser.add_argument(
        "--height-th", type=float, default=1.5,
        help="Max |z| to include in occupancy map",
    )
    parser.add_argument(
        "--resolution", type=float, default=RESOLUTION,
        help="Meters per grid cell",
    )
    parser.add_argument(
        "--show", action="store_true",
        help="Show plot interactively",
    )
    parser.add_argument(
        "--save", help="Path to save occupancy image",
    )
    args = parser.parse_args()

    # Load PLY point cloud
    print(f"Loading point cloud: {args.ply_file}")
    pcd = o3d.io.read_point_cloud(args.ply_file)
    pts = np.asarray(pcd.points)
    print(f"Point cloud contains {pts.shape[0]} points")

    # Fuse into occupancy map
    sensor_origin = (args.sensor_x, args.sensor_y)
    update_map(pts, sensor_origin, height_threshold=args.height_th)

    # Extract occupancy and array
    occ = get_occupancy_dict()
    bbox = get_bounding_box()
    arr, bbox = occupancy_dict_to_array(occ, bbox=bbox)

    # Compute world origin for array
    origin_x = ORIGIN_X + bbox[0] * args.resolution
    origin_y = ORIGIN_Y + bbox[2] * args.resolution
    origin = (origin_x, origin_y)

    # Visualize
    plot_occupancy_map(
        arr,
        origin=origin,
        resolution=args.resolution,
        show=args.show,
        save_path=args.save,
    )

if __name__ == '__main__':
    main()
