"""错题复习 API — 今日队列 / 作答 / 手动毕业 / 删除 / 统计 / 全量列表

静态路由（/today、/stats）注册在 /{item_id} 动态路由之前，避免被遮蔽。
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_session
from core.dependencies import get_current_user
from models.database import User
from models.schemas import ReviewAnswerRequest, ReviewItemResponse
from services.review_service import review_service, DAILY_CAP

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


@router.get("/today")
async def get_today_queue(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """今日复习队列：到期未毕业条目，每日上限内、今天未复习过的部分"""
    queue = await review_service.get_today_queue(
        session, str(current_user.id), cap=DAILY_CAP
    )
    return {
        "items": [ReviewItemResponse.model_validate(i) for i in queue["items"]],
        "total_due": queue["total_due"],
        "completed_today": queue["completed_today"],
        "cap": queue["cap"],
        "next_due_at": queue["next_due_at"].isoformat() if queue["next_due_at"] else None,
    }


@router.get("/stats")
async def get_review_stats(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """复习统计：活跃/毕业条目、今日进度、近 7/30 日完成量与正确率"""
    return await review_service.get_stats(session, str(current_user.id))


@router.get("")
async def list_review_items(
    state: Optional[str] = Query(None, description="learning/review/graduated"),
    category: Optional[str] = Query(None, description="六大领域筛选"),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """错题本全量列表（复习页侧栏）"""
    items = await review_service.list_items(
        session, str(current_user.id), state=state, category=category
    )
    return [ReviewItemResponse.model_validate(i) for i in items]


@router.post("/{item_id}/answer")
async def answer_review_item(
    item_id: str,
    request: ReviewAnswerRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """提交复习作答：更新 SM-2 调度并返回下次复习信息（含用户可读的 message）"""
    result = await review_service.answer_item(
        session, str(current_user.id), item_id,
        correct=request.correct, quality=request.quality,
    )
    if result is None:
        raise HTTPException(404, "复习条目不存在")

    if result.get("already_reviewed"):
        result["message"] = "这道题今天已经复习过了，明天再见"
    elif result.get("graduated"):
        result["message"] = "已掌握，这道题从复习队列毕业了"
    elif result.get("correct"):
        days = result.get("next_interval_days", 1)
        result["message"] = f"回答正确，下次复习：{days} 天后"
    else:
        result["message"] = "回答有误，明天再巩固一次"
    return result


@router.post("/{item_id}/graduate")
async def graduate_review_item(
    item_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """手动"我已掌握"：直接毕业出队"""
    ok = await review_service.graduate_item(session, str(current_user.id), item_id)
    if not ok:
        raise HTTPException(404, "复习条目不存在")
    return {"success": True}


@router.delete("/{item_id}")
async def delete_review_item(
    item_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """移出错题本"""
    ok = await review_service.delete_item(session, str(current_user.id), item_id)
    if not ok:
        raise HTTPException(404, "复习条目不存在")
    return {"success": True}
