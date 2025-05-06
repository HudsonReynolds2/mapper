# eval/session_statistics.py
# (You can also name it calculate_fps.py or similar)

import os
import argparse
import datetime
import re # Import regular expressions module
from pathlib import Path
import math # For isnan, isinf
import statistics # For mean, stdev if numpy is not available for basic stdev

# Attempt to import numpy for advanced statistics, provide fallback if not available
try:
    import numpy
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
    print("Warning: numpy library not found. Some advanced statistics (percentiles, precise stdev) will be unavailable or less precise.")
    print("Please install numpy for full functionality (e.g., 'pip install numpy').")


# Define the specific image file extension to count as frames
TARGET_IMAGE_EXTENSION = '.jpg'
DEFAULT_LAG_SPIKE_THRESHOLD_MS = 70.0 # Shooting for ~15fps -- can change if desired

def generate_frame_timing_csv(processed_frames, session_dir_path, output_dir="."):
    """
    Writes frame timing data to a CSV named after the session directory.
    """
    import csv
    import os

    lag_threshold_ms = 70.0
    session_name = os.path.basename(os.path.normpath(session_dir_path))
    output_path = os.path.join(output_dir, f"{session_name}_frame_timings.csv")

    rows = [("FrameNumber", "Timestamp", "FrameTime_ms", "InstantaneousFPS", "LagSpike")]
    for i in range(len(processed_frames)):
        num = processed_frames[i]["number"]
        ts = datetime.datetime.fromtimestamp(processed_frames[i]["mtime"]).isoformat()
        if i == 0:
            rows.append((num, ts, "", "", ""))
        else:
            time_diff = (processed_frames[i]["mtime"] - processed_frames[i - 1]["mtime"]) * 1000
            fps = 1000.0 / time_diff if time_diff > 0 else 0
            lag_spike = time_diff > lag_threshold_ms
            rows.append((num, ts, round(time_diff, 2), round(fps, 2), lag_spike))

    with open(output_path, "w", newline="") as csvfile:
        writer = csv.writer(csvfile)
        writer.writerows(rows)

    print(f"\nCSV written to: {output_path}")


def extract_frame_number(filename: Path, prefix: str = "frame_") -> int:
    """
    Extracts the numerical part of a filename.
    Assumes filename format like 'prefix_NUMBER.jpg'.
    Handles cases where prefix might be empty if filenames are just numbers.
    """
    name_no_ext = filename.stem # Filename without extension
    num_str_to_parse = name_no_ext

    if prefix and name_no_ext.startswith(prefix):
        num_str_to_parse = name_no_ext[len(prefix):]

    if num_str_to_parse.isdigit():
        return int(num_str_to_parse)

    # Fallback for more complex cases or if the primary extraction fails
    # Tries to find any sequence of digits in the filename stem
    match = re.search(r'\d+', name_no_ext)
    if match:
        # Try to convert the first found sequence of digits
        try:
            return int(match.group(0))
        except ValueError:
            pass # Continue to error if conversion fails

    # If no number can be reliably extracted, print a warning and return -1.
    print(f"Warning: Could not extract a valid frame number from '{filename.name}' with prefix '{prefix}'. Returning -1.")
    return -1


def calculate_performance_metrics(session_dir_path: str, filename_prefix: str = "frame_", lag_threshold_ms: float = DEFAULT_LAG_SPIKE_THRESHOLD_MS) -> None:
    """
    Calculates and prints comprehensive performance metrics for a given recording session directory.
    Metrics include FPS, frame time statistics, lag spike detection, frame pacing,
    frame integrity, and file size information.

    Args:
        session_dir_path (str): Path to the session directory containing frame files.
        filename_prefix (str): The prefix expected in frame filenames before the number.
        lag_threshold_ms (float): The threshold in milliseconds to define a lag spike.
    """
    session_path = Path(session_dir_path)
    lag_threshold_s = lag_threshold_ms / 1000.0  # Convert threshold to seconds

    # Validate session directory
    if not session_path.is_dir():
        print(f"Error: Session directory not found: {session_path}")
        return

    print(f"--- Analyzing Session: {session_path.resolve()} ---")
    print(f"Parameters: Filename Prefix='{filename_prefix}', Lag Spike Threshold={lag_threshold_ms:.2f} ms")

    # Get all files, then filter for the target image extension
    try:
        all_files_in_dir = [
            f for f in session_path.iterdir()
            if f.is_file() and f.suffix.lower() == TARGET_IMAGE_EXTENSION
        ]
    except Exception as e:
        print(f"Error listing files in {session_path}: {e}")
        return

    # Prepare list of frames with their extracted numbers, mtimes, and sizes
    frame_data_list = []
    for f_path in all_files_in_dir:
        num = extract_frame_number(f_path, filename_prefix)
        if num != -1: # Successfully extracted number
            try:
                mtime = os.path.getmtime(f_path)
                size = os.path.getsize(f_path)
                frame_data_list.append({'path': f_path, 'number': num, 'mtime': mtime, 'size': size})
            except FileNotFoundError:
                print(f"Error: File {f_path} not found during mtime/size retrieval. Skipping.")
            except Exception as e:
                print(f"Error getting mtime/size for {f_path}: {e}. Skipping.")
        else:
            print(f"Skipping file due to number extraction issue: {f_path.name}")

    # Sort by extracted frame number
    frame_data_list.sort(key=lambda x: x['number'])

    processed_frames = frame_data_list # All frames in frame_data_list are considered processed at this point
    num_total_frames_found = len(all_files_in_dir) # Original count from directory listing
    num_processed_frames = len(processed_frames)

    print(f"\nFound {num_total_frames_found} '{TARGET_IMAGE_EXTENSION}' file(s) initially.")
    if num_processed_frames != num_total_frames_found:
        print(f"Successfully processed {num_processed_frames} frames for analysis (issues with number extraction or file access for others).")
    else:
        print(f"Successfully processed all {num_processed_frames} found frames for analysis.")


    if num_processed_frames == 0:
        print("No frames processed. Cannot calculate metrics.")
        return

    # --- I. Overall Session Metrics ---
    print("\n--- I. Overall Session Metrics ---")
    first_frame_info = processed_frames[0]
    last_frame_info = processed_frames[-1]

    total_duration_mod_times = 0
    overall_avg_fps = 0
    if num_processed_frames > 1:
        total_duration_mod_times = last_frame_info['mtime'] - first_frame_info['mtime']
        if total_duration_mod_times > 0:
            # Use num_processed_frames - 1 for intervals
            overall_avg_fps = (num_processed_frames - 1) / total_duration_mod_times
        else:
            overall_avg_fps = 0
            print("Warning: Total duration based on modification times is zero or negative. Overall Avg FPS might be misleading or N/A.")
    elif num_processed_frames == 1:
         print("Only one frame processed. Overall Avg FPS is not applicable.")


    print(f"Total Processed Frames: {num_processed_frames}")
    print(f"First Frame: '{first_frame_info['path'].name}' (Num: {first_frame_info['number']}, Time: {datetime.datetime.fromtimestamp(first_frame_info['mtime'])})")
    print(f"Last Frame: '{last_frame_info['path'].name}' (Num: {last_frame_info['number']}, Time: {datetime.datetime.fromtimestamp(last_frame_info['mtime'])})")
    if num_processed_frames > 1 :
        print(f"Total Recording Duration (mod times): {total_duration_mod_times:.3f} seconds")
        print(f"Overall Average FPS (mod times): {overall_avg_fps:.2f} FPS")


    # --- II. Frame Integrity (Sequential Numbering) ---
    print("\n--- II. Frame Integrity (Sequential Numbering) ---")
    detected_missing_frames = 0
    if num_processed_frames > 1:
        for i in range(num_processed_frames - 1):
            # Ensure both numbers are valid before diffing (already filtered by num != -1)
            diff = processed_frames[i+1]['number'] - processed_frames[i]['number']
            if diff > 1:
                missing_count_instance = diff - 1
                detected_missing_frames += missing_count_instance
                print(f"  Gap detected: {missing_count_instance} missing frame(s) between frame num {processed_frames[i]['number']} ('{processed_frames[i]['path'].name}') and {processed_frames[i+1]['number']} ('{processed_frames[i+1]['path'].name}')")
    print(f"Total Detected Missing/Skipped Frames (by number): {detected_missing_frames}")


    # --- Inter-Frame Time Calculations (Basis for many metrics) ---
    inter_frame_times_s = [] # List to store time between consecutive frames in seconds
    if num_processed_frames > 1:
        for i in range(num_processed_frames - 1):
            time_diff = processed_frames[i+1]['mtime'] - processed_frames[i]['mtime']
            if time_diff < 0:
                print(f"Warning: Negative time difference ({time_diff:.4f}s) detected between frame {processed_frames[i]['number']} and {processed_frames[i+1]['number']}. Using 0 for this interval.")
                time_diff = 0.0
            inter_frame_times_s.append(time_diff)

    if not inter_frame_times_s:
        print("\nNot enough frames (need at least 2) to calculate detailed frame time statistics.")
        # --- VII. File Size Metrics (can still be calculated even for 1 frame) ---
        print("\n--- VII. File Size Metrics ---")
        all_frame_sizes = [f['size'] for f in processed_frames if 'size' in f and f['size'] > 0]
        total_data_size_bytes = sum(all_frame_sizes)
        avg_frame_file_size_bytes = total_data_size_bytes / num_processed_frames if num_processed_frames > 0 and total_data_size_bytes > 0 else 0
        print(f"Total Data Size for Session: {total_data_size_bytes / (1024*1024):.2f} MB ({total_data_size_bytes} bytes)")
        print(f"Average Frame File Size: {avg_frame_file_size_bytes / 1024:.2f} KB ({avg_frame_file_size_bytes:.0f} bytes)")
        print("\n--- Analysis Complete ---")
        return

    # --- III. Frame Time Statistics (Based on inter-frame times) ---
    print("\n--- III. Frame Time Statistics (ms) ---")
    inter_frame_times_ms = [t * 1000 for t in inter_frame_times_s]

    avg_frame_time_ms = statistics.mean(inter_frame_times_ms) if inter_frame_times_ms else 0
    min_frame_time_ms = min(inter_frame_times_ms) if inter_frame_times_ms else 0
    max_frame_time_ms = max(inter_frame_times_ms) if inter_frame_times_ms else 0

    print(f"Number of Frame Intervals Analyzed: {len(inter_frame_times_ms)}")
    print(f"Average Frame Time: {avg_frame_time_ms:.2f} ms")
    print(f"Minimum Frame Time: {min_frame_time_ms:.2f} ms")
    print(f"Maximum Frame Time (Worst Stutter): {max_frame_time_ms:.2f} ms")

    if NUMPY_AVAILABLE and inter_frame_times_ms:
        std_dev_frame_time_ms = numpy.std(inter_frame_times_ms)
        percentiles_to_calc = [90, 95, 99, 99.9]
        # Ensure array is not empty before calling percentile
        if len(inter_frame_times_ms) > 0:
            frame_time_percentiles_ms = numpy.percentile(inter_frame_times_ms, percentiles_to_calc)
            print(f"Standard Deviation of Frame Times: {std_dev_frame_time_ms:.2f} ms")
            for p, val in zip(percentiles_to_calc, frame_time_percentiles_ms):
                print(f"  {p}th Percentile Frame Time: {val:.2f} ms")
        else:
            print("Standard Deviation of Frame Times: N/A (no intervals)")
            print("  (Numpy percentile calculations skipped due to no intervals)")

    elif inter_frame_times_ms: # Fallback for standard deviation if numpy not available
        std_dev_frame_time_ms = statistics.stdev(inter_frame_times_ms) if len(inter_frame_times_ms) > 1 else 0
        print(f"Standard Deviation of Frame Times (statistics module): {std_dev_frame_time_ms:.2f} ms")
        print("  (Numpy not available for percentile calculations)")
    else:
        print("Standard Deviation of Frame Times: N/A (no intervals)")


    # --- IV. Lag Spike / Stutter Detection ---
    print(f"\n--- IV. Lag Spike / Stutter Detection (Threshold: {lag_threshold_ms:.2f} ms) ---")
    lag_spikes = [t for t in inter_frame_times_ms if t > lag_threshold_ms]
    num_lag_spikes = len(lag_spikes)
    total_duration_of_lag_spikes_ms = sum(lag_spikes)

    print(f"Number of Lag Spikes (frames > {lag_threshold_ms:.2f} ms): {num_lag_spikes}")
    print(f"Total Duration of Lag Spikes: {total_duration_of_lag_spikes_ms:.2f} ms ({total_duration_of_lag_spikes_ms/1000:.3f} s)")

    longest_continuous_lag_duration_ms = 0
    current_continuous_lag_duration_ms = 0
    if inter_frame_times_ms:
        for t_ms in inter_frame_times_ms:
            if t_ms > lag_threshold_ms:
                current_continuous_lag_duration_ms += t_ms
            else:
                if current_continuous_lag_duration_ms > longest_continuous_lag_duration_ms:
                    longest_continuous_lag_duration_ms = current_continuous_lag_duration_ms
                current_continuous_lag_duration_ms = 0
        if current_continuous_lag_duration_ms > longest_continuous_lag_duration_ms: # Check after loop
            longest_continuous_lag_duration_ms = current_continuous_lag_duration_ms
    print(f"Longest Continuous Lag Duration: {longest_continuous_lag_duration_ms:.2f} ms ({longest_continuous_lag_duration_ms/1000:.3f} s)")


    # --- V. Frame Pacing & Smoothness ---
    print("\n--- V. Frame Pacing & Smoothness ---")
    if len(inter_frame_times_ms) >= 2:
        jitters_ms = [abs(inter_frame_times_ms[i+1] - inter_frame_times_ms[i]) for i in range(len(inter_frame_times_ms)-1)]
        avg_jitter_ms = statistics.mean(jitters_ms) if jitters_ms else 0
        print(f"Average Frame Time Jitter: {avg_jitter_ms:.2f} ms")
    else:
        print("Not enough frame intervals (need at least 2 distinct intervals) to calculate jitter.")

    # --- VI. Instantaneous FPS Metrics ---
    print("\n--- VI. Instantaneous FPS Metrics ---")
    if max_frame_time_ms > 0:
        min_instantaneous_fps = 1000.0 / max_frame_time_ms
        print(f"Minimum Instantaneous FPS (1000ms / Max Frame Time): {min_instantaneous_fps:.2f} FPS")
    else:
        print("Cannot calculate Minimum Instantaneous FPS (Max Frame Time is zero or invalid).")

    # --- VII. File Size Metrics ---
    print("\n--- VII. File Size Metrics ---")
    all_frame_sizes = [f['size'] for f in processed_frames if 'size' in f and f['size'] > 0]
    total_data_size_bytes = sum(all_frame_sizes)
    avg_frame_file_size_bytes = total_data_size_bytes / num_processed_frames if num_processed_frames > 0 and total_data_size_bytes > 0 else 0

    print(f"Total Data Size for Session: {total_data_size_bytes / (1024*1024):.2f} MB ({total_data_size_bytes} bytes)")
    print(f"Average Frame File Size: {avg_frame_file_size_bytes / 1024:.2f} KB ({avg_frame_file_size_bytes:.0f} bytes)")

    print("\n--- Analysis Complete ---")
    generate_frame_timing_csv(processed_frames, session_dir_path)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=f"Calculate comprehensive performance metrics from '{TARGET_IMAGE_EXTENSION}' frames in a session directory.",
        formatter_class=argparse.RawTextHelpFormatter,
        epilog=f"""
Example usage:
  python session_statistics.py ../robot-dashboard/frames/session-2025-05-06T07-14-50-912Z
  python session_statistics.py ../robot-dashboard/frames/another_session --prefix image_ --lag-threshold 75

Assumptions:
  - Frame files are '{TARGET_IMAGE_EXTENSION}'.
  - Frame filenames are sortable numerically after removing a prefix (e.g., frame_1.jpg, frame_0001.jpg).
  - File modification timestamps accurately reflect the capture time of the frames.
  - The 'numpy' library is recommended for full statistical analysis (pip install numpy).
"""
    )
    parser.add_argument(
        "session_dir",
        type=str,
        help="Path to the directory containing the recorded frames."
    )
    parser.add_argument(
        "--prefix",
        type=str,
        default="frame_",
        help="The prefix in frame filenames before the number (e.g., 'frame_' for 'frame_1.jpg'). Default is 'frame_'."
    )
    parser.add_argument(
        "--lag-threshold",
        type=float,
        default=DEFAULT_LAG_SPIKE_THRESHOLD_MS,
        help=f"Threshold in milliseconds to define a lag spike or long frame. Default is {DEFAULT_LAG_SPIKE_THRESHOLD_MS} ms."
    )
    args = parser.parse_args()

    calculate_performance_metrics(args.session_dir, args.prefix, args.lag_threshold)
