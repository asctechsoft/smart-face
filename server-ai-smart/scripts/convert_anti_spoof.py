"""Chuyển checkpoint MiniFASNet (PyTorch) sang ONNX cho AI Server.

    python scripts/convert_anti_spoof.py --repo <đường dẫn Silent-Face-Anti-Spoofing>

⚠ KHÔNG chạy được bằng venv của AI Server. Script cần `torch`, mà `torch` cố ý
không nằm trong `requirements.txt`: lúc chạy AI Server chỉ cần `onnxruntime`,
thêm torch vào là kéo theo ~1 GB cho một việc làm đúng một lần.

    python -m venv /tmp/conv
    /tmp/conv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cpu
    /tmp/conv/Scripts/pip install onnx onnxruntime numpy
    /tmp/conv/Scripts/python scripts/convert_anti_spoof.py --repo /tmp/Silent-Face-Anti-Spoofing

Lấy repo nguồn (Apache-2.0):

    git clone --depth 1 https://github.com/minivision-ai/Silent-Face-Anti-Spoofing

Vì sao tự chuyển đổi thay vì tải ONNX dựng sẵn: trên mạng có vài bản ONNX của
model này, nhưng không bản nào truy được về checkpoint gốc. Đây là bộ phận quyết
định ảnh in ra có chấm công được hay không — tin vào một file lạ ở đúng chỗ này
là bỏ trống tuyến phòng thủ mà vẫn tưởng đã dựng xong.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections import OrderedDict
from pathlib import Path

#: Checkpoint mặc định. Tên file mã hoá luôn tham số:
#:   2.7    tỷ lệ nới khung mặt lúc cắt — PHẢI khớp `_CROP_SCALE` ở core/liveness.py
#:   80x80  kích thước đầu vào
#:   V2     kiến trúc MiniFASNetV2
DEFAULT_CHECKPOINT = "resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth"

#: Băm của checkpoint đã dùng để sinh ra model đang chạy. Khác giá trị này nghĩa
#: là nguồn đã đổi — phải đo lại FAR/FRR trước khi thay.
KNOWN_CHECKPOINT_SHA256 = "a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0"

#: Ngưỡng lệch cho phép giữa ONNX và PyTorch.
MAX_DEVIATION = 1e-5


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path, help="Thư mục repo đã clone")
    parser.add_argument("--checkpoint", default=DEFAULT_CHECKPOINT)
    parser.add_argument(
        "--out",
        type=Path,
        default=(
            Path(__file__).resolve().parent.parent
            / "models"
            / "anti_spoof"
            / "MiniFASNetV2.onnx"
        ),
    )
    args = parser.parse_args()

    try:
        import numpy as np
        import onnx
        import onnxruntime as ort
        import torch
    except ImportError as error:
        print(f"Thiếu thư viện: {error.name}. Xem hướng dẫn dựng venv ở đầu file này.")
        return 1

    repo: Path = args.repo.resolve()
    checkpoint = repo / args.checkpoint
    if not checkpoint.is_file():
        print(f"Không thấy checkpoint: {checkpoint}")
        return 1

    sys.path.insert(0, str(repo))
    from src.model_lib.MiniFASNet import MiniFASNetV2
    from src.utility import get_kernel, parse_model_name

    digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    print(f"Checkpoint : {checkpoint.name}")
    print(f"  sha256   : {digest}")
    if digest != KNOWN_CHECKPOINT_SHA256:
        print(f"  ⚠ KHÁC bản đã kiểm chứng ({KNOWN_CHECKPOINT_SHA256[:16]}...).")
        print("    Model mới phải đo lại FAR/FRR trước khi đưa lên production.")

    h_input, w_input, model_type, scale = parse_model_name(checkpoint.name)
    kernel = get_kernel(h_input, w_input)
    print(f"  đầu vào  : {h_input}x{w_input} · {model_type} · crop scale {scale}")

    if scale != 2.7:
        print(f"  ⚠ crop scale {scale} KHÁC 2.7 — phải sửa `_CROP_SCALE`")
        print("    ở core/liveness.py cho khớp, nếu không model nhận sai khung ảnh.")

    model = MiniFASNetV2(conv6_kernel=kernel)

    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    # Checkpoint lưu từ DataParallel nên mọi khoá mang tiền tố "module.".
    if next(iter(state)).startswith("module."):
        state = OrderedDict((key[7:], value) for key, value in state.items())
    model.load_state_dict(state, strict=True)
    model.eval()
    print(f"Trọng số   : nạp OK ({sum(p.numel() for p in model.parameters()):,} tham số)")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    # Batch cố định 1: AI Server chấm từng ảnh, không gom lô.
    #
    # `dynamo=False` giữ đường xuất TorchScript cũ. Torch ≥ 2.9 mặc định dùng
    # exporter dựa trên torch.export, đòi thêm gói `onnxscript` và sinh ra đồ thị
    # khác. Model đang chạy sinh ra bằng đường cũ và đã đo FAR/FRR trên nó; đổi
    # đường xuất là đổi thứ đang chạy mà không ai chủ ý.
    export_kwargs = {
        "input_names": ["input"],
        "output_names": ["logits"],
        "opset_version": 13,
        "do_constant_folding": True,
    }
    dummy = torch.randn(1, 3, h_input, w_input)
    try:
        torch.onnx.export(model, dummy, str(args.out), dynamo=False, **export_kwargs)
    except TypeError:
        # Torch < 2.5 chưa có tham số `dynamo`; lúc đó đường cũ đã là mặc định.
        torch.onnx.export(model, dummy, str(args.out), **export_kwargs)
    onnx.checker.check_model(onnx.load(str(args.out)))
    print(f"Xuất ONNX  : {args.out} ({args.out.stat().st_size:,} bytes)")

    # Xuất thành công KHÔNG có nghĩa là đúng: một toán tử bị ánh xạ sai vẫn cho ra
    # file hợp lệ, chỉ khác số. Phải so số thật.
    #
    # Thử ở CẢ HAI thang giá trị. Model này ăn đầu vào 0..255 (repo gốc vô hiệu
    # hoá phép chia 255 trong ToTensor của chính nó); thử nhầm mỗi thang [0,1] thì
    # vẫn "đạt" mà không phát hiện được gì về vùng giá trị thật sự dùng.
    session = ort.InferenceSession(str(args.out), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    rng = np.random.default_rng(20260809)

    worst = 0.0
    for scale_factor in (1.0, 255.0):
        for _ in range(10):
            sample = (rng.random((1, 3, h_input, w_input), dtype=np.float32) * scale_factor)
            with torch.no_grad():
                expected = model(torch.from_numpy(sample)).numpy()
            actual = session.run(None, {input_name: sample})[0]
            worst = max(worst, float(np.abs(expected - actual).max()))

    print(f"Đối chiếu  : 20 mẫu, lệch lớn nhất {worst:.3e}")
    if worst >= MAX_DEVIATION:
        print(f"THẤT BẠI: lệch vượt {MAX_DEVIATION:.0e}. KHÔNG dùng file này.")
        args.out.unlink(missing_ok=True)
        return 1

    print(f"\nĐẠT. Trỏ LIVENESS_MODEL_PATH tới {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
