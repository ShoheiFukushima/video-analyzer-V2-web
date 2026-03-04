#!/usr/bin/env python3
"""
PySceneDetect ContentDetector + Dissolve Detector Runner

Pass 1: PySceneDetect ContentDetector for hard cuts
Pass 2: Laplacian Variance + Edge Count dual-signal dip detection for dissolves

Dissolve detection rationale:
  During a dissolve (cross-fade), two images are blended together.
  This blending causes:
    1. Reduced sharpness (Laplacian variance drops) - the overlapping edges cancel/blur
    2. Fewer distinct edges (Canny edge count drops) - blended regions lose edge definition
  Both signals show a characteristic V-shaped dip during the transition.
  Hard cuts do NOT show this pattern (they are 1-2 frame spikes, not sustained dips).

Usage:
    python3 pysceneRunner.py <video_path> <output_json> [--threshold 27.0] [--min-scene-len 15]
    python3 pysceneRunner.py <video_path> <output_json> --enable-dissolve --dissolve-dip-ratio 0.30

Output JSON format:
    [
        {"timestamp": 1.5, "confidence": 0.85, "type": "hard_cut"},
        {"timestamp": 5.2, "confidence": 0.72, "type": "dissolve"},
        ...
    ]
"""

import sys
import json
import os
import argparse
from typing import List, Dict, Any


def _compute_frame_signals(frame_bgr, cv2, np):
    """Compute Laplacian variance and edge count for full frame, center crop, and 4 ROI regions.

    Frame is resized to 160x120 for consistent and fast computation.
    Center crop = middle 70% (y=18..102), excluding top/bottom 15% where text overlays appear.

    4 ROI regions (on 160x120 grid):
      - bottom:      y=102..120 (下段15% - 字幕・テロップ)
      - center_text: y=51..69   (中央15% - メインテキスト)
      - top_left:    y=0..12, x=0..40   (左上10% - ロゴ)
      - top_right:   y=0..12, x=120..160 (右上10% - タイムスタンプ)

    Returns (lap_var_full, edge_count_full, lap_var_center, edge_count_center, roi_edge_counts).
    roi_edge_counts is a dict with keys: bottom, center_text, top_left, top_right.
    """
    gray = cv2.cvtColor(cv2.resize(frame_bgr, (160, 120)), cv2.COLOR_BGR2GRAY)
    # Full frame signals
    lap_var_full = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    edges_full = cv2.Canny(gray, 50, 150)
    edge_count_full = int(np.count_nonzero(edges_full))
    # Center 70% crop (exclude top 15% and bottom 15% where text/telop appears)
    center = gray[18:102, :]
    lap_var_center = float(cv2.Laplacian(center, cv2.CV_64F).var())
    edges_center = cv2.Canny(center, 50, 150)
    edge_count_center = int(np.count_nonzero(edges_center))
    # 4 ROI regions for telop animation detection
    roi_edge_counts = {
        "bottom": int(np.count_nonzero(cv2.Canny(gray[102:120, :], 50, 150))),
        "center_text": int(np.count_nonzero(cv2.Canny(gray[51:69, :], 50, 150))),
        "top_left": int(np.count_nonzero(cv2.Canny(gray[0:12, 0:40], 50, 150))),
        "top_right": int(np.count_nonzero(cv2.Canny(gray[0:12, 120:160], 50, 150))),
    }
    return lap_var_full, edge_count_full, lap_var_center, edge_count_center, roi_edge_counts


def detect_dissolves(
    video_path: str,
    fps: float,
    dip_threshold: float = 0.25,
    window_frames: int = 300,
    min_dip_frames: int = 8,
    max_dip_frames: int = 90,
    min_scene_len: int = 15,
    frame_step: int = 2,
) -> tuple:
    """
    Detect dissolve transitions using Laplacian Variance (primary) + Edge Count (secondary).

    Algorithm:
      1. Collect lap_var and edge_count for every frame_step-th frame
      2. Compute rolling median for each signal (window = window_frames, must be >> max dissolve)
      3. Primary detection: lap_var dips below (1 - dip_threshold) * rolling_median
      4. Secondary confirmation: edge_count dip boosts confidence (not required)
      5. Group consecutive dip frames into regions
      6. Filter by duration: min_dip_frames <= length <= max_dip_frames
      7. Report the midpoint of each valid dip region as the dissolve timestamp

    Args:
        video_path: Path to the video file
        fps: Video frame rate
        dip_threshold: Fraction below rolling median to qualify as "in dip". Default 0.25 (25%).
        window_frames: Rolling median window size in sampled frames. Default 300 (~20s at 30fps/step=2).
                       Must be much larger than max_dip_frames to avoid median tracking the dip.
        min_dip_frames: Minimum dip duration in sampled frames to qualify. Default 8 (~0.5s).
        max_dip_frames: Maximum dip duration in sampled frames. Default 90 (~6s).
        min_scene_len: Minimum sampled frames between detections (cooldown). Default 15.
        frame_step: Subsample every N-th frame for speed. Default 2.
    """
    import cv2
    import numpy as np

    print(f"[Dissolve] Starting dual-signal dissolve detection "
          f"(dip_threshold={dip_threshold}, window={window_frames}, "
          f"min_dip={min_dip_frames}, max_dip={max_dip_frames}, frame_step={frame_step})...",
          file=sys.stderr)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[Dissolve] Error: Cannot open video: {video_path}", file=sys.stderr)
        return []

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # ------------------------------------------------------------------
    # Pass 2a: Collect signals for all sampled frames
    # ------------------------------------------------------------------
    lap_vars: List[float] = []
    edge_counts: List[float] = []
    lap_vars_center: List[float] = []
    edge_counts_center: List[float] = []
    # ROI edge counts for telop animation detection (collected in same pass)
    roi_edge_series: Dict[str, List[int]] = {
        "bottom": [], "center_text": [], "top_left": [], "top_right": []
    }
    frame_indices: List[int] = []  # actual frame numbers
    frame_num = 0
    processed = 0
    log_interval = max(1, total_frames // 10)

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_num % frame_step != 0:
            frame_num += 1
            continue

        lv_full, ec_full, lv_center, ec_center, roi_ec = _compute_frame_signals(frame, cv2, np)
        lap_vars.append(lv_full)
        edge_counts.append(float(ec_full))
        lap_vars_center.append(lv_center)
        edge_counts_center.append(float(ec_center))
        for region_key in roi_edge_series:
            roi_edge_series[region_key].append(roi_ec[region_key])
        frame_indices.append(frame_num)

        # Progress logging
        if frame_num > 0 and frame_num % log_interval == 0:
            pct = int(frame_num / total_frames * 100)
            print(f"[Dissolve] Signal collection: {pct}% ({frame_num}/{total_frames} frames)",
                  file=sys.stderr)

        processed += 1
        frame_num += 1

    cap.release()

    n = len(lap_vars)
    print(f"[Dissolve] Collected signals for {n} sampled frames "
          f"(out of {frame_num} total, step={frame_step})", file=sys.stderr)

    if n < window_frames + 10:
        print(f"[Dissolve] Too few frames ({n}) for window size {window_frames}. "
              f"Skipping dissolve detection.", file=sys.stderr)
        return [], roi_edge_series, frame_indices, fps

    # ------------------------------------------------------------------
    # Pass 2b: Compute rolling median and detect dips
    # ------------------------------------------------------------------
    lap_arr = np.array(lap_vars, dtype=np.float64)
    edge_arr = np.array(edge_counts, dtype=np.float64)
    lap_center_arr = np.array(lap_vars_center, dtype=np.float64)

    # Rolling median using a simple sliding window approach
    half_w = window_frames // 2

    def rolling_median(arr, w_half):
        """Compute rolling median with edge handling (clamp)."""
        result = np.empty_like(arr)
        for i in range(len(arr)):
            lo = max(0, i - w_half)
            hi = min(len(arr), i + w_half + 1)
            result[i] = np.median(arr[lo:hi])
        return result

    lap_median = rolling_median(lap_arr, half_w)
    edge_median = rolling_median(edge_arr, half_w)
    lap_center_median = rolling_median(lap_center_arr, half_w)

    # Diagnostic: signal statistics
    print(f"[Dissolve] Signal stats:", file=sys.stderr)
    print(f"  lap_var(full):   min={lap_arr.min():.1f}, max={lap_arr.max():.1f}, "
          f"mean={lap_arr.mean():.1f}, median={np.median(lap_arr):.1f}", file=sys.stderr)
    print(f"  lap_var(center): min={lap_center_arr.min():.1f}, max={lap_center_arr.max():.1f}, "
          f"mean={lap_center_arr.mean():.1f}, median={np.median(lap_center_arr):.1f}", file=sys.stderr)
    print(f"  edge_count:      min={edge_arr.min():.0f}, max={edge_arr.max():.0f}, "
          f"mean={edge_arr.mean():.0f}, median={np.median(edge_arr):.0f}", file=sys.stderr)

    # Compute ratio = value / rolling_median (avoid division by zero)
    lap_ratio = np.where(lap_median > 0, lap_arr / lap_median, 1.0)
    edge_ratio = np.where(edge_median > 0, edge_arr / edge_median, 1.0)
    lap_center_ratio = np.where(lap_center_median > 0, lap_center_arr / lap_center_median, 1.0)

    # A frame is "in dip" when ratio < (1 - dip_threshold)
    dip_level = 1.0 - dip_threshold
    lap_in_dip = lap_ratio < dip_level
    edge_in_dip = edge_ratio < dip_level
    lap_center_in_dip = lap_center_ratio < dip_level

    # Primary detection: full-frame lap_var dip
    primary_in_dip = lap_in_dip

    # Count frames in dip for diagnostics
    lap_dip_count = int(np.sum(lap_in_dip))
    lap_center_dip_count = int(np.sum(lap_center_in_dip))
    edge_dip_count = int(np.sum(edge_in_dip))
    print(f"[Dissolve] Dip frame counts: lap_full={lap_dip_count}, "
          f"lap_center={lap_center_dip_count}, edge={edge_dip_count} "
          f"(out of {n} sampled frames)", file=sys.stderr)

    # Diagnostic: top-5 full-frame lap_var dips
    all_lap_depths = 1.0 - lap_ratio  # positive = below median
    all_center_depths = 1.0 - lap_center_ratio
    top5_indices = np.argsort(all_lap_depths)[-5:][::-1]
    print(f"[Dissolve] Top-5 deepest lap_var frames:", file=sys.stderr)
    for idx in top5_indices:
        t = frame_indices[idx] / fps
        center_tag = "center_dip" if lap_center_in_dip[idx] else "center_ok"
        print(f"    frame {frame_indices[idx]} ({t:.1f}s): "
              f"full_depth={all_lap_depths[idx]:.3f}, "
              f"center_depth={all_center_depths[idx]:.3f}, "
              f"[{center_tag}]",
              file=sys.stderr)

    # ------------------------------------------------------------------
    # Group consecutive primary_in_dip frames into dip regions
    # ------------------------------------------------------------------
    dip_regions: List[List[int]] = []  # list of [start_idx, end_idx] in sampled frame space
    in_region = False
    region_start = 0

    for i in range(n):
        if primary_in_dip[i]:
            if not in_region:
                region_start = i
                in_region = True
        else:
            if in_region:
                dip_regions.append([region_start, i - 1])
                in_region = False

    # Close final region if still open
    if in_region:
        dip_regions.append([region_start, n - 1])

    print(f"[Dissolve] Dip candidates: {len(dip_regions)} raw regions found", file=sys.stderr)

    # ------------------------------------------------------------------
    # Filter by duration and extract timestamps
    # ------------------------------------------------------------------
    cuts: List[Dict[str, Any]] = []
    last_cut_idx = -min_scene_len - 1  # allow first detection

    for region_start_idx, region_end_idx in dip_regions:
        length = region_end_idx - region_start_idx + 1

        if length < min_dip_frames:
            mid_frame = frame_indices[(region_start_idx + region_end_idx) // 2]
            t = mid_frame / fps
            print(f"    [filtered: too short ({length} < {min_dip_frames})] "
                  f"frames {frame_indices[region_start_idx]}-{frame_indices[region_end_idx]} ({t:.1f}s)",
                  file=sys.stderr)
            continue

        if length > max_dip_frames:
            mid_frame = frame_indices[(region_start_idx + region_end_idx) // 2]
            t = mid_frame / fps
            print(f"    [filtered: too long ({length} > {max_dip_frames})] "
                  f"frames {frame_indices[region_start_idx]}-{frame_indices[region_end_idx]} ({t:.1f}s)",
                  file=sys.stderr)
            continue

        # Cooldown check
        mid_idx = (region_start_idx + region_end_idx) // 2
        if mid_idx - last_cut_idx < min_scene_len:
            mid_frame = frame_indices[mid_idx]
            t = mid_frame / fps
            print(f"    [filtered: cooldown] "
                  f"frames {frame_indices[region_start_idx]}-{frame_indices[region_end_idx]} ({t:.1f}s)",
                  file=sys.stderr)
            continue

        # ----------------------------------------------------------
        # Compute depth metrics for all filters
        # ----------------------------------------------------------
        region_lap_dips = 1.0 - lap_ratio[region_start_idx:region_end_idx + 1]
        region_center_dips = 1.0 - lap_center_ratio[region_start_idx:region_end_idx + 1]
        max_full_depth = float(region_lap_dips.max())
        max_center_depth = float(region_center_dips.max())
        region_edge_dips = 1.0 - edge_ratio[region_start_idx:region_end_idx + 1]
        max_edge_depth = float(region_edge_dips.max())

        # ----------------------------------------------------------
        # Deep dip bypass: if the dip is very deep (>= 0.40), it's almost
        # certainly a real dissolve regardless of center/edge behavior.
        # Text overlays during dissolves can skew center/edge metrics,
        # but the overall sharpness loss is unmistakable.
        # ----------------------------------------------------------
        deep_dip_threshold = float(os.environ.get('DISSOLVE_DEEP_DIP_BYPASS', '0.40'))
        is_deep_dip = max_full_depth >= deep_dip_threshold

        if is_deep_dip:
            mid_frame_dbg = frame_indices[mid_idx]
            t_dbg = mid_frame_dbg / fps
            print(f"    [deep dip bypass] "
                  f"frames {frame_indices[region_start_idx]}-{frame_indices[region_end_idx]} ({t_dbg:.1f}s) "
                  f"full_depth={max_full_depth:.3f} >= {deep_dip_threshold:.3f} → skipping center/edge filters",
                  file=sys.stderr)
        else:
            # ----------------------------------------------------------
            # Filter: Center-crop confirmation
            # Full dissolve: center also dips (center_depth >= full_depth * 0.3)
            # Text animation: only edges dip, center stays stable
            # ----------------------------------------------------------
            if max_center_depth < max_full_depth * 0.3:
                mid_frame = frame_indices[mid_idx]
                t = mid_frame / fps
                print(f"    [filtered: text animation] "
                      f"frames {frame_indices[region_start_idx]}-{frame_indices[region_end_idx]} ({t:.1f}s) "
                      f"full_depth={max_full_depth:.3f}, center_depth={max_center_depth:.3f} "
                      f"(center < 30% of full → not a dissolve)",
                      file=sys.stderr)
                continue

            # ----------------------------------------------------------
            # Filter: Center-localized dip detection (relaxed)
            # ----------------------------------------------------------
            max_center_ratio = float(os.environ.get('DISSOLVE_MAX_CENTER_RATIO', '1.50'))
            if max_full_depth > 0 and max_center_depth / max_full_depth > max_center_ratio:
                mid_frame = frame_indices[mid_idx]
                t = mid_frame / fps
                print(f"    [filtered: center-localized dip] "
                      f"frames {frame_indices[region_start_idx]}-{frame_indices[region_end_idx]} ({t:.1f}s) "
                      f"center/full ratio={max_center_depth/max_full_depth:.3f} > max={max_center_ratio:.3f}",
                      file=sys.stderr)
                continue

            # ----------------------------------------------------------
            # Filter: Edge depth minimum (relaxed)
            # ----------------------------------------------------------
            min_edge_depth = float(os.environ.get('DISSOLVE_MIN_EDGE_DEPTH', '0.05'))
            if max_edge_depth < min_edge_depth:
                mid_frame = frame_indices[mid_idx]
                t = mid_frame / fps
                print(f"    [filtered: insufficient edge loss] "
                      f"frames {frame_indices[region_start_idx]}-{frame_indices[region_end_idx]} ({t:.1f}s) "
                      f"edge_depth={max_edge_depth:.3f} < min={min_edge_depth:.3f}",
                      file=sys.stderr)
                continue

        # ----------------------------------------------------------
        # Final filter: Before/after frame similarity (kept for all)
        # Text animations: same background before and after dip (high similarity).
        # Real dissolves: different scenes before and after (low similarity).
        # ----------------------------------------------------------
        max_similarity = float(os.environ.get('DISSOLVE_MAX_SIMILARITY', '0.90'))

        pre_sample_idx = max(0, region_start_idx - 5)
        post_sample_idx = min(n - 1, region_end_idx + 5)
        pre_frame_num = frame_indices[pre_sample_idx]
        post_frame_num = frame_indices[post_sample_idx]

        cap2 = cv2.VideoCapture(video_path)
        cap2.set(cv2.CAP_PROP_POS_FRAMES, pre_frame_num)
        ret_pre, frame_pre = cap2.read()
        cap2.set(cv2.CAP_PROP_POS_FRAMES, post_frame_num)
        ret_post, frame_post = cap2.read()
        cap2.release()

        if ret_pre and ret_post:
            gray_pre = cv2.cvtColor(cv2.resize(frame_pre, (160, 120)), cv2.COLOR_BGR2GRAY)
            gray_post = cv2.cvtColor(cv2.resize(frame_post, (160, 120)), cv2.COLOR_BGR2GRAY)

            # Use center 70% crop (y=18..102) to exclude text overlay regions
            center_pre = gray_pre[18:102, :].astype(np.float64)
            center_post = gray_post[18:102, :].astype(np.float64)

            # Normalized Cross-Correlation (NCC) on center crop only
            mean_pre = center_pre.mean()
            mean_post = center_post.mean()
            numer = float(np.sum((center_pre - mean_pre) * (center_post - mean_post)))
            denom = float(np.sqrt(np.sum((center_pre - mean_pre)**2) * np.sum((center_post - mean_post)**2)))
            similarity = numer / denom if denom > 0 else 0.0

            if similarity > max_similarity:
                mid_frame = frame_indices[mid_idx]
                t = mid_frame / fps
                print(f"    [filtered: same background] "
                      f"frames {frame_indices[region_start_idx]}-{frame_indices[region_end_idx]} ({t:.1f}s) "
                      f"before/after similarity={similarity:.3f} > max={max_similarity:.3f} "
                      f"(same background → not a dissolve)",
                      file=sys.stderr)
                continue

        last_cut_idx = mid_idx
        mid_frame = frame_indices[mid_idx]
        timestamp = mid_frame / fps

        # Dissolve start/end timestamps for blur avoidance
        dissolve_start_frame = frame_indices[region_start_idx]
        dissolve_end_frame = frame_indices[region_end_idx]
        dissolve_start_time = dissolve_start_frame / fps
        dissolve_end_time = dissolve_end_frame / fps

        # Confidence: lap_var dip depth as base, edge_count dip as bonus
        # (region_edge_dips and max_edge_depth already computed in Filter 1 above)
        # Base confidence from lap_var depth: 0.35 depth -> 0.5, 0.90+ depth -> 0.8
        base_conf = 0.5 + min(max_full_depth - dip_threshold, 0.55) / 0.55 * 0.3
        # Bonus if edge_count also dips: +0.1 max
        edge_bonus = 0.1 if max_edge_depth > dip_threshold * 0.5 else 0.0
        confidence = min(base_conf + edge_bonus, 0.9)

        cuts.append({
            "timestamp": round(timestamp, 3),
            "confidence": round(min(confidence, 0.9), 3),
            "type": "dissolve",
            "dissolve_start": round(dissolve_start_time, 3),
            "dissolve_end": round(dissolve_end_time, 3),
        })

        print(f"    [DETECTED] dissolve at {timestamp:.1f}s "
              f"(range={dissolve_start_time:.1f}-{dissolve_end_time:.1f}s, "
              f"duration={length} frames, full_depth={max_full_depth:.3f}, "
              f"center_depth={max_center_depth:.3f}, edge_depth={max_edge_depth:.3f}, "
              f"conf={confidence:.3f})",
              file=sys.stderr)

    print(f"[Dissolve] Completed: {len(cuts)} dissolve cuts detected "
          f"({processed} frames processed)", file=sys.stderr)
    return cuts, roi_edge_series, frame_indices, fps


def detect_telop_animations(
    roi_edge_series: Dict[str, List[int]],
    frame_indices: List[int],
    fps: float,
    velocity_threshold: float = 0.15,
    settling_frames: int = 5,
    frame_step: int = 2,
) -> List[Dict[str, Any]]:
    """
    Detect telop/subtitle animation periods from ROI edge count time series.

    Algorithm (run independently per ROI region):
      1. Compute frame-to-frame absolute difference of edge counts (velocity)
      2. Normalize velocity by mean edge count (to make threshold scale-invariant)
      3. Smooth with rolling mean (window=3) for noise reduction
      4. velocity > threshold → frame is "animating"
      5. velocity <= threshold for settling_frames consecutive frames → settled
      6. Output: [{region, start, settling}]
    """
    import numpy as np

    results: List[Dict[str, Any]] = []

    for region, edge_counts_list in roi_edge_series.items():
        if len(edge_counts_list) < 10:
            continue

        arr = np.array(edge_counts_list, dtype=np.float64)

        # Normalize: divide by mean edge count to make threshold scale-invariant
        mean_ec = arr.mean()
        if mean_ec < 1.0:
            continue  # Region has almost no edges, skip

        # Frame-to-frame absolute velocity (normalized)
        velocity = np.abs(np.diff(arr)) / mean_ec

        # Rolling mean smoothing (window=3)
        if len(velocity) >= 3:
            kernel = np.ones(3) / 3.0
            velocity = np.convolve(velocity, kernel, mode='same')

        # Detect animation periods
        is_animating = velocity > velocity_threshold
        in_animation = False
        anim_start_idx = 0
        stable_count = 0

        for i in range(len(is_animating)):
            if is_animating[i]:
                if not in_animation:
                    anim_start_idx = i
                    in_animation = True
                stable_count = 0
            else:
                if in_animation:
                    stable_count += 1
                    if stable_count >= settling_frames:
                        # Animation settled
                        settling_idx = i - settling_frames + 1
                        start_time = frame_indices[anim_start_idx] / fps
                        settling_time = frame_indices[min(settling_idx + 1, len(frame_indices) - 1)] / fps

                        # Only report animations longer than 0.1s
                        if settling_time - start_time > 0.1:
                            results.append({
                                "region": region,
                                "start": round(start_time, 3),
                                "settling": round(settling_time, 3),
                            })
                        in_animation = False
                        stable_count = 0

        # Close any open animation at end of video
        if in_animation:
            settling_idx = len(is_animating) - 1
            start_time = frame_indices[anim_start_idx] / fps
            settling_time = frame_indices[min(settling_idx + 1, len(frame_indices) - 1)] / fps
            if settling_time - start_time > 0.1:
                results.append({
                    "region": region,
                    "start": round(start_time, 3),
                    "settling": round(settling_time, 3),
                })

    # Sort by start time
    results.sort(key=lambda x: x["start"])

    if results:
        print(f"[Telop] Detected {len(results)} telop animation periods:", file=sys.stderr)
        for r in results[:10]:
            print(f"    {r['region']}: {r['start']:.2f}s → {r['settling']:.2f}s "
                  f"(duration={r['settling'] - r['start']:.2f}s)", file=sys.stderr)
        if len(results) > 10:
            print(f"    ... and {len(results) - 10} more", file=sys.stderr)
    else:
        print(f"[Telop] No telop animations detected", file=sys.stderr)

    return results


def merge_and_deduplicate(
    hard_cuts: List[Dict[str, Any]],
    dissolve_cuts: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Merge hard cut and dissolve results with type-aware deduplication.

    Deduplication rules:
      - Same type (hard_cut vs hard_cut): 0.5s window
      - Same type (dissolve vs dissolve): 1.0s window
      - Cross-type (hard_cut vs dissolve within dissolve zone): reclassify hard_cut as dissolve
      - Cross-type (hard_cut vs dissolve outside zone): keep both if > 0.15s apart
    """
    SAME_HARD_CUT_WINDOW = 0.5
    SAME_DISSOLVE_WINDOW = 1.0
    CROSS_TYPE_WINDOW = 0.15

    # Build dissolve zone lookup for reclassifying hard cuts
    # A hard cut within a dissolve zone is actually detecting the dissolve transition
    dissolve_zones = []
    for dc in dissolve_cuts:
        ds = dc.get("dissolve_start")
        de = dc.get("dissolve_end")
        if ds is not None and de is not None:
            dissolve_zones.append((ds, de, dc))

    # Reclassify hard cuts that fall within dissolve zones
    for hc in hard_cuts:
        hc.setdefault("type", "hard_cut")
        ts = hc["timestamp"]
        for ds, de, dc in dissolve_zones:
            if ds <= ts <= de:
                hc["type"] = "dissolve"
                hc["dissolve_start"] = dc.get("dissolve_start")
                hc["dissolve_end"] = dc.get("dissolve_end")
                print(f"    [reclassified] hard_cut at {ts:.1f}s → dissolve "
                      f"(within dissolve zone {ds:.1f}-{de:.1f}s)",
                      file=sys.stderr)
                break

    # Combine all cuts
    all_cuts = []
    for c in hard_cuts:
        all_cuts.append(c)
    for c in dissolve_cuts:
        c.setdefault("type", "dissolve")
        all_cuts.append(c)

    # Sort by timestamp
    all_cuts.sort(key=lambda x: x["timestamp"])

    if not all_cuts:
        return []

    merged: List[Dict[str, Any]] = [all_cuts[0]]
    for cut in all_cuts[1:]:
        prev = merged[-1]
        gap = cut["timestamp"] - prev["timestamp"]
        same_type = cut["type"] == prev["type"]

        if same_type:
            # Same-type dedup: use type-specific window
            window = SAME_HARD_CUT_WINDOW if cut["type"] == "hard_cut" else SAME_DISSOLVE_WINDOW
            if gap < window:
                # Keep higher confidence; for dissolves, prefer the one with range info
                if cut["confidence"] > prev["confidence"]:
                    merged[-1] = cut
                elif cut.get("dissolve_start") and not prev.get("dissolve_start"):
                    merged[-1] = cut
                continue
        else:
            # Cross-type: only merge if very close (0.15s)
            if gap < CROSS_TYPE_WINDOW:
                # Prefer dissolve (has range info for blur avoidance)
                if cut["type"] == "dissolve":
                    merged[-1] = cut
                continue

        merged.append(cut)

    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description="PySceneDetect ContentDetector + DissolveDetector runner")
    parser.add_argument("video_path", help="Path to input video file")
    parser.add_argument("output_json", help="Path to output JSON file")
    parser.add_argument("--threshold", type=float, default=27.0,
                        help="ContentDetector threshold (default: 27.0)")
    parser.add_argument("--min-scene-len", type=int, default=15,
                        help="Minimum scene length in frames (default: 15)")
    # Dissolve detection args (dual-signal dip detection)
    parser.add_argument("--enable-dissolve", action="store_true",
                        help="Enable dissolve (gradual transition) detection")
    parser.add_argument("--dissolve-dip-ratio", type=float, default=0.25,
                        help="Fraction below rolling median to qualify as dip (0.0-1.0). Default: 0.25")
    parser.add_argument("--dissolve-window", type=int, default=300,
                        help="Rolling median window size in sampled frames. Default: 300")
    parser.add_argument("--dissolve-min-dip", type=int, default=8,
                        help="Minimum dip duration in sampled frames. Default: 8")
    parser.add_argument("--dissolve-max-dip", type=int, default=90,
                        help="Maximum dip duration in sampled frames. Default: 90")
    parser.add_argument("--frame-step", type=int, default=2,
                        help="Subsample every N-th frame for dissolve detection speed. Default: 2")
    args = parser.parse_args()

    video_path = args.video_path
    output_json = args.output_json
    threshold = args.threshold
    min_scene_len = args.min_scene_len

    try:
        if not os.path.exists(video_path):
            print(f"Error: Video file not found: {video_path}", file=sys.stderr)
            return 1

        # ============================================================
        # Pass 1: ContentDetector (hard cuts)
        # ============================================================
        print(f"[PyScene] Loading scenedetect...", file=sys.stderr)
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import ContentDetector

        print(f"[PyScene] Opening video: {video_path}", file=sys.stderr)
        video = open_video(video_path)
        fps = video.frame_rate
        print(f"[PyScene] FPS: {fps:.2f}", file=sys.stderr)

        scene_manager = SceneManager()
        scene_manager.add_detector(
            ContentDetector(threshold=threshold, min_scene_len=min_scene_len)
        )

        print(f"[PyScene] Pass 1: Detecting hard cuts (threshold={threshold}, min_scene_len={min_scene_len})...", file=sys.stderr)
        scene_manager.detect_scenes(video, show_progress=False)

        scene_list = scene_manager.get_scene_list()
        print(f"[PyScene] Detected {len(scene_list)} scenes (hard cuts)", file=sys.stderr)

        # Convert to scene cut timestamps
        hard_cuts: List[Dict[str, Any]] = []
        for i, (start, end) in enumerate(scene_list):
            if i == 0:
                hard_cuts.append({
                    "timestamp": 0.0,
                    "confidence": 1.0,
                    "type": "hard_cut",
                })
                continue

            timestamp = start.get_seconds()
            hard_cuts.append({
                "timestamp": round(timestamp, 3),
                "confidence": 0.9,
                "type": "hard_cut",
            })

        print(f"[PyScene] {len(hard_cuts)} hard cuts extracted", file=sys.stderr)

        # ============================================================
        # Pass 2: Dissolve Detector (dual-signal dip detection) -- optional
        # Also collects ROI edge signals for telop animation detection
        # ============================================================
        telop_animations: List[Dict[str, Any]] = []
        roi_edge_series = None

        if args.enable_dissolve:
            dissolve_cuts, roi_edge_series, dissolve_frame_indices, dissolve_fps = detect_dissolves(
                video_path=video_path,
                fps=fps,
                dip_threshold=args.dissolve_dip_ratio,
                window_frames=args.dissolve_window,
                min_dip_frames=args.dissolve_min_dip,
                max_dip_frames=args.dissolve_max_dip,
                min_scene_len=min_scene_len,
                frame_step=args.frame_step,
            )

            # Merge and deduplicate (type-aware)
            results = merge_and_deduplicate(hard_cuts, dissolve_cuts)

            # Log summary
            hard_count = sum(1 for r in results if r.get("type") == "hard_cut")
            dissolve_count = sum(1 for r in results if r.get("type") == "dissolve")
            print(f"", file=sys.stderr)
            print(f"Detection Results Summary:", file=sys.stderr)
            print(f"   Total scene cuts: {len(results)}", file=sys.stderr)
            print(f"   Hard cuts (ContentDetector): {hard_count}", file=sys.stderr)
            print(f"   Dissolves (Dual-Signal Dip): {dissolve_count}", file=sys.stderr)
            if dissolve_count > 0:
                print(f"   First 5 dissolves:", file=sys.stderr)
                dissolve_only = [r for r in results if r.get("type") == "dissolve"]
                for d in dissolve_only[:5]:
                    print(f"     {d['timestamp']:.1f}s (conf={d['confidence']:.3f})", file=sys.stderr)
                if len(dissolve_only) > 5:
                    print(f"     ... and {len(dissolve_only) - 5} more", file=sys.stderr)

            # ============================================================
            # Pass 3: Telop Animation Detection (uses ROI signals from Pass 2)
            # ============================================================
            telop_enabled = os.environ.get('TELOP_DETECTION_ENABLED', 'true').lower() == 'true'
            if telop_enabled and roi_edge_series and dissolve_frame_indices:
                velocity_threshold = float(os.environ.get('TELOP_VELOCITY_THRESHOLD', '0.15'))
                settling_frames = int(os.environ.get('TELOP_SETTLING_FRAMES', '5'))
                telop_animations = detect_telop_animations(
                    roi_edge_series=roi_edge_series,
                    frame_indices=dissolve_frame_indices,
                    fps=dissolve_fps,
                    velocity_threshold=velocity_threshold,
                    settling_frames=settling_frames,
                    frame_step=args.frame_step,
                )
        else:
            results = hard_cuts

        print(f"[PyScene] {len(results)} total scene cuts", file=sys.stderr)

        # Output as object format (supports both cuts and telop_animations)
        output = {
            "cuts": results,
            "telop_animations": telop_animations,
        }

        with open(output_json, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2)

        print(f"[PyScene] Results saved to: {output_json}", file=sys.stderr)
        return 0

    except ImportError as e:
        print(f"Error: scenedetect not installed. Install with: pip install scenedetect[opencv]", file=sys.stderr)
        print(f"Details: {e}", file=sys.stderr)
        return 1

    except Exception as e:
        print(f"Error processing video: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
