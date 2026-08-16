#!/usr/bin/env python3
"""Extract deterministic audio features for Analyze Music.

This is intentionally a command-line boundary: the Node application can use
Essentia in deployments where it is installed, while this portable fallback
uses librosa and emits the same JSON shape for local macOS development.
"""

import argparse
import json
import sys

import librosa
import numpy as np


KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def estimate_key(chroma):
    if chroma.size == 0 or not np.isfinite(chroma).all():
        return None, None
    pitch_classes = chroma.mean(axis=1)
    if float(pitch_classes.sum()) <= 0:
        return None, None
    normalized = (pitch_classes - pitch_classes.mean()) / (pitch_classes.std() + 1e-8)
    candidates = []
    for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
        standardized = (profile - profile.mean()) / (profile.std() + 1e-8)
        for pitch in range(12):
            candidates.append((float(np.dot(normalized, np.roll(standardized, pitch))), pitch, mode))
    _, pitch, mode = max(candidates)
    return KEY_NAMES[pitch], mode


def compact_curve(values, point_count=120):
    if values.size == 0:
        return []
    source = np.linspace(0, values.size - 1, num=values.size)
    target = np.linspace(0, values.size - 1, num=min(point_count, values.size))
    normalized = values / max(float(np.percentile(values, 95)), 1e-8)
    return [round(float(value), 4) for value in np.clip(np.interp(target, source, normalized), 0, 1)]


def analyze(path):
    samples, sample_rate = librosa.load(path, mono=True, sr=22050)
    if samples.size == 0:
        raise ValueError("Audio stream contains no samples")

    hop_length = 512
    rms = librosa.feature.rms(y=samples, hop_length=hop_length)[0]
    rms_db = librosa.amplitude_to_db(np.maximum(rms, 1e-8), ref=1.0)
    tempo, beat_frames = librosa.beat.beat_track(y=samples, sr=sample_rate, hop_length=hop_length)
    beat_positions = librosa.frames_to_time(beat_frames, sr=sample_rate, hop_length=hop_length)
    chroma = librosa.feature.chroma_cqt(y=samples, sr=sample_rate, hop_length=hop_length)
    musical_key, musical_mode = estimate_key(chroma)

    return {
        "bpm": round(float(np.asarray(tempo).reshape(-1)[0]), 2) if np.asarray(tempo).size else 0.0,
        "key": musical_key,
        "mode": musical_mode,
        "loudness": round(float(np.mean(rms_db)), 2),
        "dynamicRange": round(float(np.percentile(rms_db, 95) - np.percentile(rms_db, 5)), 2),
        "beatPositions": [round(float(value), 3) for value in beat_positions[:500]],
        "energyCurve": compact_curve(rms),
        "extractor": "librosa"
    }


def main():
    parser = argparse.ArgumentParser(description="Extract deterministic music features")
    parser.add_argument("--input", required=True, help="Audio file to analyze")
    parser.add_argument("--output", choices=["json"], default="json")
    args = parser.parse_args()
    json.dump(analyze(args.input), sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
