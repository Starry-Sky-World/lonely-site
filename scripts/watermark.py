#!/usr/bin/env python3
"""
隐形水印工具：DWT-DCT-SVD + StegaStamp 双层水印

DWT-DCT-SVD（本脚本内置）：
  DWT 一级分解 → LL 子带 → 8×8 分块 → 每块 DCT → SVD
  → 对每块最大奇异值做 QIM 嵌入 magic 比特
  每个 magic bit 重复嵌入多块，检测时多数投票 → 盲检测（无需原图）。

StegaStamp（可选，需预训练模型）：
  从 HuggingFace Hub 下载官方 saved_model，用 TF1 推理嵌入唯一 payload。
  模型不可用时自动跳过，不影响 DWT-DCT-SVD 流程。

用法：
  python watermark.py detect  <image>               # 检测是否已有水印
  python watermark.py embed   <image> [image2 ...]   # 嵌入水印（原地覆盖）
  python watermark.py process <dir>                  # 批量处理目录内所有图片
"""

import argparse
import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
import pywt

# ─── DWT-DCT-SVD QIM 参数 ────────────────────────────────────────
MAGIC = 0xDEADBEEF  # 32-bit 魔数，用于盲检测识别
MAGIC_BITS = np.array([int(b) for b in format(MAGIC, "032b")], dtype=np.float64)
DELTA = 16.0      # QIM 量化步长（分块 SV[1] 量级 ~15-30，Δ=16 不可见且抗量化）
BLOCK_SIZE = 8    # DCT 分块大小
REDUNDANCY = 64   # 每个 magic bit 重复嵌入的块数（检测时多数投票）
SV_INDEX = 1      # 嵌入的奇异值索引（0=DC 会被 uint8 还原，用 1=非 DC）
WAVELET = "haar"

# ─── 图像工具 ────────────────────────────────────────────────────
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}


def read_image_y(path):
    """读取图片，返回 Y 通道（亮度，float64）+ 原图 BGR 副本。"""
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"无法读取图片: {path}")
    ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
    y = ycrcb[:, :, 0].astype(np.float64)
    return y, img


def write_image_y(path, y, img_template):
    """将修改后的 Y 通道写回，保持 CrCb 不变，保存为原格式。"""
    ycrcb = cv2.cvtColor(img_template, cv2.COLOR_BGR2YCrCb).astype(np.float64)
    ycrcb[:, :, 0] = y
    ycrcb = np.clip(ycrcb, 0, 255).astype(np.uint8)
    bgr = cv2.cvtColor(ycrcb, cv2.COLOR_YCrCb2BGR)
    ext = Path(path).suffix.lower()
    if ext in (".jpg", ".jpeg"):
        cv2.imwrite(str(path), bgr, [cv2.IMWRITE_JPEG_QUALITY, 98])
    else:
        cv2.imwrite(str(path), bgr)


# ─── DWT-DCT-SVD 分块核心 ───────────────────────────────────────
def _get_blocks(ll):
    """将 LL 子带切成 8×8 块的生成器，yield (row, col, block)。"""
    h, w = ll.shape
    for by in range(0, h - BLOCK_SIZE + 1, BLOCK_SIZE):
        for bx in range(0, w - BLOCK_SIZE + 1, BLOCK_SIZE):
            yield by, bx, ll[by : by + BLOCK_SIZE, bx : bx + BLOCK_SIZE]


def embed_dwt_dct_svd(y):
    """在 Y 通道嵌入 magic 比特（分块 DWT-DCT-SVD + QIM），返回水印后的 Y。"""
    # DWT 一级分解
    ll, detail = pywt.dwt2(y, WAVELET)
    ll = ll.copy()  # 可写副本

    bit_pattern = []  # 展开的比特序列（每个 magic bit 重复 REDUNDANCY 次）
    for bit in MAGIC_BITS:
        bit_pattern.extend([bit] * REDUNDANCY)
    total_needed = len(bit_pattern)

    idx = 0
    for by, bx, block in _get_blocks(ll):
        if idx >= total_needed:
            break

        block = np.ascontiguousarray(block, dtype=np.float64)
        dct_block = cv2.dct(block)
        u, s, vt = np.linalg.svd(dct_block, full_matrices=False)

        # QIM 嵌入非 DC 奇异值（SV_INDEX=1）
        bit = bit_pattern[idx]
        s[SV_INDEX] = np.round(s[SV_INDEX] / DELTA) * DELTA + bit * (DELTA / 2)

        dct_new = u @ np.diag(s) @ vt
        ll[by : by + BLOCK_SIZE, bx : bx + BLOCK_SIZE] = cv2.idct(dct_new)
        idx += 1

    return pywt.idwt2((ll, detail), WAVELET)


def detect_dwt_dct_svd(y):
    """盲检测：从 Y 通道提取 QIM 比特，多数投票检查 magic。返回 (detected, matched_bits)。"""
    ll, _ = pywt.dwt2(y, WAVELET)

    bit_pattern = []
    for bit in MAGIC_BITS:
        bit_pattern.extend([bit] * REDUNDANCY)
    total_needed = len(bit_pattern)

    idx = 0
    votes = np.zeros(len(MAGIC_BITS))  # 每个 magic bit 的得票
    counts = np.zeros(len(MAGIC_BITS))

    for by, bx, block in _get_blocks(ll):
        if idx >= total_needed:
            break

        block = np.ascontiguousarray(block, dtype=np.float64)
        dct_block = cv2.dct(block)
        _, s, _ = np.linalg.svd(dct_block, full_matrices=False)

        # QIM 检测
        frac = (s[SV_INDEX] / DELTA) - np.floor(s[SV_INDEX] / DELTA)
        bit = 1.0 if 0.25 < frac < 0.75 else 0.0

        magic_idx = idx // REDUNDANCY
        votes[magic_idx] += bit
        counts[magic_idx] += 1
        idx += 1

    # 多数投票
    detected_bits = (votes > counts / 2).astype(int)
    matched = int(np.sum(detected_bits == MAGIC_BITS.astype(int)))
    detected = matched >= len(MAGIC_BITS) * 0.85  # 85% 匹配即认为已水印
    return detected, matched


# ─── StegaStamp 集成（可选）─────────────────────────────────────
def stegastamp_available():
    """检查 StegaStamp 模型是否可用。"""
    repo = os.environ.get("STEGASTAMP_HF_REPO", "")
    if not repo:
        return False
    try:
        import huggingface_hub  # noqa: F401
        return True
    except ImportError:
        return False


def stegastamp_encode(image_path, payload_id):
    """用 StegaStamp 嵌入唯一 payload。需要 STEGASTAMP_HF_REPO 环境变量。"""
    repo = os.environ.get("STEGASTAMP_HF_REPO", "")
    if not repo:
        print("  [StegaStamp] 跳过：未设置 STEGASTAMP_HF_REPO")
        return False

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("  [StegaStamp] 跳过：未安装 huggingface_hub")
        return False

    model_dir = snapshot_download(repo_id=repo, repo_type="model")
    secret = payload_id[:7].ljust(7, "0")

    with tempfile.TemporaryDirectory() as tmpdir:
        encode_script = Path(model_dir) / "encode_image.py"
        if not encode_script.exists():
            print(f"  [StegaStamp] 跳过：未找到 encode_image.py（模型目录: {model_dir}）")
            return False

        result = subprocess.run(
            [
                sys.executable, str(encode_script),
                str(model_dir),
                "--image", str(image_path),
                "--save_dir", tmpdir,
                "--secret", secret,
            ],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"  [StegaStamp] 编码失败: {result.stderr[:200]}")
            return False

        stem = Path(image_path).stem
        hidden = Path(tmpdir) / f"{stem}_hidden.png"
        if hidden.exists():
            wm_img = cv2.imread(str(hidden), cv2.IMREAD_COLOR)
            if wm_img is not None:
                ext = Path(image_path).suffix.lower()
                if ext in (".jpg", ".jpeg"):
                    cv2.imwrite(str(image_path), wm_img, [cv2.IMWRITE_JPEG_QUALITY, 98])
                else:
                    cv2.imwrite(str(image_path), wm_img)
                return True
        return False


def stegastamp_decode(image_path):
    """尝试从图片解码 StegaStamp payload。成功返回 payload 字符串，否则 None。"""
    repo = os.environ.get("STEGASTAMP_HF_REPO", "")
    if not repo:
        return None
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        return None

    model_dir = snapshot_download(repo_id=repo, repo_type="model")
    decode_script = Path(model_dir) / "decode_image.py"
    if not decode_script.exists():
        return None

    result = subprocess.run(
        [
            sys.executable, str(decode_script),
            str(model_dir),
            "--image", str(image_path),
        ],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        output = result.stdout.strip()
        if output:
            return output
    return None


# ─── 主流程 ──────────────────────────────────────────────────────
def process_image(path):
    """处理单张图片：检测→嵌入。返回 (was_watermarked, embedded)。"""
    path = Path(path)
    print(f"\n处理: {path.name}")

    try:
        y, img = read_image_y(path)
    except ValueError as e:
        print(f"  跳过: {e}")
        return False, False

    # 1. 盲检测 DWT-DCT-SVD
    dwt_detected, matched = detect_dwt_dct_svd(y)
    # 2. 检测 StegaStamp（如果可用）
    ss_payload = stegastamp_decode(path) if stegastamp_available() else None

    if dwt_detected and (ss_payload is not None or not stegastamp_available()):
        reason = "DWT-DCT-SVD"
        if ss_payload:
            reason += f" + StegaStamp({ss_payload})"
        print(f"  已有水印（{reason}），跳过")
        return True, False

    if dwt_detected and ss_payload is None and stegastamp_available():
        print("  DWT-DCT-SVD 已有，StegaStamp 缺失，补打 StegaStamp")
    else:
        print(f"  未检测到水印（DWT 匹配 {matched}/{len(MAGIC_BITS)}），开始嵌入")

    # 嵌入 DWT-DCT-SVD（如果还没有）
    if not dwt_detected:
        y_wm = embed_dwt_dct_svd(y)
        write_image_y(path, y_wm, img)
        print("  [DWT-DCT-SVD] 已嵌入")

    # 嵌入 StegaStamp（如果可用）
    if stegastamp_available():
        file_hash = hashlib.sha256(path.read_bytes()).hexdigest()[:7]
        if stegastamp_encode(path, file_hash):
            print(f"  [StegaStamp] 已嵌入 payload={file_hash}")
        else:
            print("  [StegaStamp] 嵌入失败或跳过")

    return False, True


def process_directory(directory):
    """批量处理目录内所有图片。"""
    directory = Path(directory)
    images = sorted(
        f for f in directory.rglob("*") if f.suffix.lower() in IMAGE_EXTS
    )
    if not images:
        print(f"目录 {directory} 中未找到图片")
        return 0

    print(f"找到 {len(images)} 张图片")
    processed = 0
    skipped = 0
    for img in images:
        _, embedded = process_image(img)
        if embedded:
            processed += 1
        else:
            skipped += 1

    print(f"\n完成：嵌入 {processed}，跳过 {skipped}")
    return processed


def cmd_detect(args):
    path = Path(args.image)
    y, _ = read_image_y(path)
    dwt_detected, matched = detect_dwt_dct_svd(y)
    print(f"DWT-DCT-SVD: {'已检测' if dwt_detected else '未检测'} ({matched}/{len(MAGIC_BITS)} bits)")
    if stegastamp_available():
        payload = stegastamp_decode(path)
        print(f"StegaStamp: {payload or '未检测'}")
    return 0 if dwt_detected else 1


def cmd_embed(args):
    for image_path in args.images:
        process_image(image_path)
    return 0


def cmd_process(args):
    process_directory(args.directory)
    return 0


def main():
    parser = argparse.ArgumentParser(description="隐形水印工具 (DWT-DCT-SVD + StegaStamp)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_detect = sub.add_parser("detect", help="检测图片是否已有水印")
    p_detect.add_argument("image", type=str)
    p_detect.set_defaults(func=cmd_detect)

    p_embed = sub.add_parser("embed", help="为图片嵌入水印（原地覆盖）")
    p_embed.add_argument("images", type=str, nargs="+")
    p_embed.set_defaults(func=cmd_embed)

    p_process = sub.add_parser("process", help="批量处理目录内所有图片")
    p_process.add_argument("directory", type=str)
    p_process.set_defaults(func=cmd_process)

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
