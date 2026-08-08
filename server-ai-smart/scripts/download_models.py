"""Tải model về máy trước khi chạy AI Server.

    python scripts/download_models.py

Hai nhóm model:

1. **buffalo_l** (insightface) — phát hiện khuôn mặt, điểm mốc, ArcFace.
   Tải tự động qua insightface, có kiểm tra checksum sẵn.

2. **Chống giả mạo** (MiniFASNet) — KHÔNG có nguồn tải chính thức ổn định.
   Script chỉ hướng dẫn, không tự tải: kéo một model bảo mật từ URL bất kỳ
   trên mạng về rồi tin vào nó là cách làm sai. Đây là bộ phận quyết định
   ảnh in ra có chấm công được hay không.
"""

from __future__ import annotations

import sys
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
ANTI_SPOOF_DIR = MODELS_DIR / "anti_spoof"


def download_insightface(pack: str = "buffalo_l") -> bool:
    print(f"[1/2] Đang tải bộ model insightface '{pack}'...")
    try:
        from insightface.app import FaceAnalysis

        app = FaceAnalysis(
            name=pack,
            root=str(MODELS_DIR),
            providers=["CPUExecutionProvider"],
            allowed_modules=["detection", "landmark_3d_68", "recognition"],
        )
        app.prepare(ctx_id=-1, det_size=(640, 640))
    except Exception as error:
        print(f"      THẤT BẠI: {error}")
        print("      Kiểm tra kết nối mạng, hoặc tải thủ công từ")
        print("      https://github.com/deepinsight/insightface/tree/master/model_zoo")
        return False

    print(f"      Xong. Model nằm ở {MODELS_DIR / 'models' / pack}")
    return True


def check_anti_spoof() -> bool:
    print("[2/2] Kiểm tra model chống giả mạo...")
    ANTI_SPOOF_DIR.mkdir(parents=True, exist_ok=True)

    found = list(ANTI_SPOOF_DIR.glob("*.onnx"))
    if found:
        for path in found:
            print(f"      Đã có: {path.name} ({path.stat().st_size // 1024} KB)")
        return True

    print(f"      CHƯA CÓ model nào trong {ANTI_SPOOF_DIR}")
    print()
    print("      Model chống giả mạo là tuyến phòng thủ chính chống chấm công hộ")
    print("      (AF-05..AF-09). Không có nó, một tấm ảnh in cũng chấm công được.")
    print()
    print("      Cách lấy:")
    print("        1. Silent-Face-Anti-Spoofing (MiniFASNetV2), giấy phép Apache-2.0:")
    print("           https://github.com/minivision-ai/Silent-Face-Anti-Spoofing")
    print("           Tải checkpoint .pth rồi chuyển sang ONNX (đầu vào 1x3x80x80).")
    print("        2. Hoặc mua model thương mại đã đo FAR/FRR trên dữ liệu người Việt.")
    print()
    print(f"      Đặt file .onnx vào {ANTI_SPOOF_DIR} rồi trỏ LIVENESS_MODEL_PATH tới đó.")
    print()
    print("      Muốn chạy tạm khi đang phát triển: ALLOW_MISSING_LIVENESS_MODEL=true")
    print("      (bị chặn ở production).")
    return False


def main() -> int:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    recognition_ok = download_insightface()
    print()
    anti_spoof_ok = check_anti_spoof()
    print()

    if recognition_ok and anti_spoof_ok:
        print("Đủ model để chạy production.")
        return 0

    if recognition_ok:
        print("Đủ model để PHÁT TRIỂN, thiếu model chống giả mạo cho production.")
        return 0

    print("Thiếu model nhận diện — AI Server chưa chạy được.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
