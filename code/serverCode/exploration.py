# Constants
UNKNOWN  = 0
FREE     = 1
OCCUPIED = 2

# Helper: is this cell a frontier?
def is_frontier_cell(grid, x, y):
    if grid[x][y] != FREE:
        return False
    # check 4- or 8-neighbors for at least one UNKNOWN
    for dx, dy in [(1,0),(-1,0),(0,1),(0,-1)]:
        nx, ny = x+dx, y+dy
        if in_bounds(grid, nx, ny) and grid[nx][ny] == UNKNOWN:
            return True
    return False


# 1. Naïve Active Area (NaïveAA)
# Only examine the cells your last sensor scan touched.
def detect_frontiers_naiveAA(grid, last_scan_cells):
    frontiers = []
    for (x, y) in last_scan_cells:
        if is_frontier_cell(grid, x, y):
            frontiers.append((x, y))
    return frontiers


# 2. Expanding-Wavefront Frontier Detection (EWFD)
# Do a BFS from the robot through free space, but stop once
# you’ve visited all reachable free cells (no full-map scan).
from collections import deque

def detect_frontiers_EWFD(grid, robot_cell):
    frontiers = []
    visited   = set()
    queue     = deque([robot_cell])
    visited.add(robot_cell)

    while queue:
        x, y = queue.popleft()

        # If this free cell borders unknown, it’s a frontier
        if is_frontier_cell(grid, x, y):
            frontiers.append((x, y))
            # (Optionally) don’t expand beyond frontiers:
            # continue

        # Otherwise, expand to neighbors if they’re free
        for dx, dy in [(1,0),(-1,0),(0,1),(0,-1)]:
            nx, ny = x+dx, y+dy
            if not in_bounds(grid, nx, ny):
                continue
            if (nx, ny) in visited:
                continue
            if grid[nx][ny] == FREE:
                visited.add((nx, ny))
                queue.append((nx, ny))
    return frontiers


# Utility: check bounds
def in_bounds(grid, x, y):
    return 0 <= x < len(grid) and 0 <= y < len(grid[0])


# Example usage in your main loop:
#   1) Update `grid` and `last_scan_cells` from your sensor
#   2) Either:
#         frontiers = detect_frontiers_naiveAA(grid, last_scan_cells)
#      or
#         frontiers = detect_frontiers_EWFD(grid, robot_cell)
#   3) Cluster or rank `frontiers` for goal selection