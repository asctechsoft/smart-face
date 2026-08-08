"""Quản lý chỉ mục 1:N trong RAM (`/v1/index/*`).

Không có trong docs/08. Cần thiết vì hợp đồng `/v1/identify` nhận `scope_ids`
(chỉ có định danh, không có vector) — muốn so khớp thì AI Server phải giữ sẵn
embedding của những người trong phạm vi đó.

Đây là bản sao đọc. Nguồn sự thật vẫn là bảng `face_profile` ở Postgres. Backend
đồng bộ lên khi có người đăng ký/huỷ khuôn mặt, và nạp lại toàn bộ khi AI Server
khởi động lại.

Backend hiện chưa dùng đường này — `biometric.service.ts` gửi thẳng `candidates`
cho `/v1/identify`. Chỉ mục dành cho giai đoạn kiosk khi tập ứng viên lớn.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..core.index import INDEX
from ..schemas import IndexRemoveRequest, IndexStatsResponse, IndexUpsertRequest
from ..security import require_internal_key

router = APIRouter(dependencies=[Depends(require_internal_key)])


@router.post("/v1/index/upsert")
async def upsert(payload: IndexUpsertRequest) -> dict[str, int | str]:
    for entry in payload.entries:
        INDEX.upsert(payload.namespace, entry.employee_id, entry.embeddings)
    return {"namespace": payload.namespace, "upserted": len(payload.entries)}


@router.post("/v1/index/remove")
async def remove(payload: IndexRemoveRequest) -> dict[str, int | str]:
    removed = INDEX.remove(payload.namespace, payload.employee_ids)
    return {"namespace": payload.namespace, "removed": removed}


@router.get("/v1/index/stats", response_model=IndexStatsResponse)
async def stats() -> IndexStatsResponse:
    per_namespace, employees, vectors = INDEX.stats()
    return IndexStatsResponse(
        namespaces=per_namespace,
        total_employees=employees,
        total_vectors=vectors,
    )
