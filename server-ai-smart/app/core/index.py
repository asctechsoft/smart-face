"""Chỉ mục embedding trong RAM phục vụ so khớp 1:N theo `scope_ids`.

Dành cho kiosk (giai đoạn sau, docs/02 mục 6.2): khi tập ứng viên lớn, đẩy hàng
nghìn vector 512 chiều qua mạng mỗi lượt chấm công là lãng phí.

⚠ ADR-05 — CÁCH LY TENANT: chỉ mục chia theo `namespace`, và namespace PHẢI là
`company_id`. Trộn hai công ty vào một namespace nghĩa là nhân viên công ty A có
thể được nhận diện thành nhân viên công ty B. Đây là dạng rò rỉ dữ liệu chéo
khách hàng nghiêm trọng nhất mà hệ thống có thể mắc phải.

Đây là **bản sao đọc**, không phải nguồn sự thật. Nguồn sự thật là bảng
`face_profile` trong Postgres. Mất chỉ mục thì nạp lại, không mất dữ liệu.
"""

from __future__ import annotations

import threading

import numpy as np

from ..metrics import INDEX_SIZE


class EmbeddingIndex:
    def __init__(self) -> None:
        # namespace → employee_id → ma trận (n_vectors × dim)
        self._data: dict[str, dict[str, np.ndarray]] = {}
        self._lock = threading.RLock()

    def upsert(self, namespace: str, employee_id: str, embeddings: list[list[float]]) -> None:
        matrix = np.asarray(embeddings, dtype=np.float32)
        if matrix.ndim == 1:
            matrix = matrix[np.newaxis, :]

        with self._lock:
            self._data.setdefault(namespace, {})[employee_id] = matrix
            self._publish_size(namespace)

    def remove(self, namespace: str, employee_ids: list[str]) -> int:
        with self._lock:
            bucket = self._data.get(namespace)
            if not bucket:
                return 0
            removed = sum(1 for key in employee_ids if bucket.pop(key, None) is not None)
            self._publish_size(namespace)
            return removed

    def gather(self, namespace: str, scope_ids: list[str]) -> tuple[np.ndarray, list[str]]:
        """Gom vector của các nhân viên trong phạm vi thành một ma trận.

        `owners` song song từng dòng của ma trận: dòng thứ i thuộc về
        `owners[i]`. `identify_1toN` cần thông tin này để tính `margin` cho đúng
        — nếu không nó sẽ so hai góc chụp của cùng một người với nhau.
        """
        with self._lock:
            bucket = self._data.get(namespace, {})
            selected = [(key, bucket[key]) for key in scope_ids if key in bucket]

        if not selected:
            return np.empty((0, 0), dtype=np.float32), []

        owners: list[str] = []
        blocks: list[np.ndarray] = []
        for employee_id, matrix in selected:
            owners.extend([employee_id] * matrix.shape[0])
            blocks.append(matrix)

        return np.vstack(blocks), owners

    def stats(self) -> tuple[dict[str, int], int, int]:
        with self._lock:
            per_namespace = {
                namespace: sum(matrix.shape[0] for matrix in bucket.values())
                for namespace, bucket in self._data.items()
            }
            employees = sum(len(bucket) for bucket in self._data.values())
        return per_namespace, employees, sum(per_namespace.values())

    def _publish_size(self, namespace: str) -> None:
        bucket = self._data.get(namespace, {})
        INDEX_SIZE.labels(namespace=namespace).set(
            sum(matrix.shape[0] for matrix in bucket.values())
        )


INDEX = EmbeddingIndex()
