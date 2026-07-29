"""错题复习服务 — SM-2 简化间隔重复调度

设计要点（对应 PRD §5.3）：
- 入队来源：题库提交 / 动态题评测的未通过结果（后续会话内出题、闪卡沿用同一入口）
- 去重：同一用户同一题（dedup_key）未毕业时唯一，重复答错仅累计 wrong_count 并重置调度；
  已毕业的题再次答错视为遗忘复发，重新入队
- 快照：入队时保存题目完整快照，原题删除或修改不影响复习
- 调度：答题质量隐式映射（答对=4，答错=1，闪卡自评保留 5/3/1 入口）；
  间隔阶梯 0 -> 1 -> 3 -> 7 天，其后按 ease_factor 倍增；连续 3 次答对毕业出队
- 每日上限：默认 30 题，超出顺延（DAILY_CAP）
"""

import hashlib
import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import UserReviewItem, UserReviewLog, KnowledgeNode

# 连续答对多少次毕业出队
GRADUATE_STREAK = 3
# 每日复习上限（超出顺延到次日）
DAILY_CAP = 30
# 间隔阶梯（天）：新题 -> 首次答对 -> 第二次 -> 第三次；其后 interval * ease_factor
INTERVAL_LADDER = [1, 3, 7]
MIN_EASE = 1.3
DEFAULT_EASE = 2.5


class ReviewService:

    # ── 调度算法（纯函数，便于测试） ──────────────────────────────

    @staticmethod
    def next_schedule(
        interval_days: int,
        ease_factor: float,
        success_streak: int,
        quality: int,
    ) -> Dict[str, Any]:
        """SM-2 简化：由当前调度状态与答题质量计算下一次调度。

        quality: 5 轻松答对 / 4 答对 / 3 勉强 / 1 答错（<3 视为失败）

        Returns:
            {interval_days, ease_factor, success_streak, graduated, due_delta_days}
        """
        if quality < 3:
            # 失败：回到 1 天，降低难度系数
            return {
                "interval_days": 1,
                "ease_factor": max(MIN_EASE, ease_factor - 0.2),
                "success_streak": 0,
                "graduated": False,
                "due_delta_days": 1,
            }

        streak = success_streak + 1
        if streak >= GRADUATE_STREAK:
            return {
                "interval_days": interval_days,
                "ease_factor": ease_factor,
                "success_streak": streak,
                "graduated": True,
                "due_delta_days": 0,
            }

        # 间隔阶梯，走完阶梯后按 ease_factor 倍增
        if interval_days < INTERVAL_LADDER[0]:
            next_interval = INTERVAL_LADDER[0]
        else:
            next_interval = None
            for step in INTERVAL_LADDER:
                if interval_days < step:
                    next_interval = step
                    break
            if next_interval is None:
                next_interval = max(interval_days + 1, round(interval_days * ease_factor))

        # 标准 SM-2 的 EF 更新（quality>=3 时）
        new_ease = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
        return {
            "interval_days": next_interval,
            "ease_factor": max(MIN_EASE, new_ease),
            "success_streak": streak,
            "graduated": False,
            "due_delta_days": next_interval,
        }

    @staticmethod
    def build_dedup_key(
        lab_id: Optional[str],
        title: str,
        content: Any,
    ) -> str:
        """题库题按 lab_id 去重；动态题按标题+内容哈希去重"""
        if lab_id:
            return f"lab:{lab_id}"
        payload = json.dumps({"t": title, "c": content}, ensure_ascii=False, sort_keys=True)
        return "hash:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:48]

    # ── 入队 ─────────────────────────────────────────────────────

    async def enqueue_wrong_answer(
        self,
        session: AsyncSession,
        user_id: str,
        title: str,
        exercise_type: str,
        content: Any,
        answer: Any = None,
        explanation: Optional[str] = None,
        source_type: str = "lab",
        lab_id: Optional[str] = None,
        node_id: Optional[str] = None,
    ) -> UserReviewItem:
        """答错入队：不存在则建新条目（当日到期）；未毕业存在则累计错次并重置调度；
        已毕业存在则视为遗忘复发重新激活。快照保持首次入队内容。"""
        uid = UUID(user_id) if isinstance(user_id, str) else user_id
        dedup_key = self.build_dedup_key(lab_id, title, content)

        stmt = select(UserReviewItem).where(
            UserReviewItem.user_id == uid,
            UserReviewItem.dedup_key == dedup_key,
        )
        existing = (await session.execute(stmt)).scalars().first()
        now = datetime.utcnow()

        if existing:
            existing.wrong_count = (existing.wrong_count or 0) + 1
            existing.success_streak = 0
            existing.interval_days = 0
            existing.due_at = now
            existing.state = "learning"
            await session.commit()
            await session.refresh(existing)
            return existing

        item = UserReviewItem(
            user_id=uid,
            source_type=source_type,
            lab_id=UUID(lab_id) if isinstance(lab_id, str) else lab_id,
            node_id=UUID(node_id) if isinstance(node_id, str) else node_id,
            dedup_key=dedup_key,
            title=title[:255],
            exercise_type=exercise_type or "quiz",
            content=content if content is not None else {},
            answer=answer,
            explanation=explanation,
            wrong_count=1,
            success_streak=0,
            ease_factor=DEFAULT_EASE,
            interval_days=0,
            due_at=now,
            state="learning",
        )
        session.add(item)
        await session.commit()
        await session.refresh(item)
        return item

    # ── 队列与作答 ────────────────────────────────────────────────

    async def get_today_queue(
        self, session: AsyncSession, user_id: str, cap: int = DAILY_CAP
    ) -> Dict[str, Any]:
        """今日队列：到期（due_at <= 今日 23:59）且未毕业、今天还没复习过的条目，
        按到期时间升序，上限 cap 题。"""
        uid = UUID(user_id) if isinstance(user_id, str) else user_id
        now = datetime.utcnow()
        end_of_today = now.replace(hour=23, minute=59, second=59, microsecond=999999)
        start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)

        base_due = and_(
            UserReviewItem.user_id == uid,
            UserReviewItem.state != "graduated",
            UserReviewItem.due_at <= end_of_today,
        )

        total_due = (
            await session.execute(select(func.count()).select_from(UserReviewItem).where(base_due))
        ).scalar() or 0

        completed_today = (
            await session.execute(
                select(func.count()).select_from(UserReviewLog).where(
                    UserReviewLog.user_id == uid,
                    UserReviewLog.reviewed_at >= start_of_today,
                )
            )
        ).scalar() or 0

        remaining_cap = max(0, cap - completed_today)
        stmt = (
            select(UserReviewItem)
            .where(
                base_due,
                (UserReviewItem.last_reviewed_at.is_(None))
                | (UserReviewItem.last_reviewed_at < start_of_today),
            )
            .order_by(UserReviewItem.due_at.asc())
            .limit(remaining_cap)
        )
        items = (await session.execute(stmt)).scalars().all()

        # 下次最近到期（队列清空时展示"下次复习 X 天后"）
        next_due = (
            await session.execute(
                select(func.min(UserReviewItem.due_at)).where(
                    UserReviewItem.user_id == uid,
                    UserReviewItem.state != "graduated",
                    UserReviewItem.due_at > end_of_today,
                )
            )
        ).scalar()

        return {
            "items": items,
            "total_due": int(total_due),
            "completed_today": int(completed_today),
            "cap": cap,
            "next_due_at": next_due,
        }

    async def answer_item(
        self,
        session: AsyncSession,
        user_id: str,
        item_id: str,
        correct: bool,
        quality: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """提交复习作答：更新调度、写复习流水。quality 显式传入时（闪卡自评）优先。

        同一条目当日已计分或已毕业时幂等短路：返回当前调度且不再推进
        （防止前端"重新作答"重复刷 streak 一天内毕业）。
        """
        uid = UUID(user_id) if isinstance(user_id, str) else user_id
        item = await self._get_owned_item(session, uid, item_id)
        if item is None:
            return None

        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        already_scored_today = (
            item.last_reviewed_at is not None and item.last_reviewed_at >= today_start
        )
        if item.state == "graduated" or already_scored_today:
            return {
                "item_id": str(item.id),
                "correct": bool(correct),
                "graduated": item.state == "graduated",
                "next_interval_days": item.interval_days or 0,
                "due_at": item.due_at.isoformat() if item.due_at else None,
                "success_streak": item.success_streak or 0,
                "state": item.state,
                "already_reviewed": True,
            }

        q = quality if quality is not None else (4 if correct else 1)
        sched = self.next_schedule(
            item.interval_days or 0,
            item.ease_factor or DEFAULT_EASE,
            item.success_streak or 0,
            q,
        )

        item.interval_days = sched["interval_days"]
        item.ease_factor = sched["ease_factor"]
        item.success_streak = sched["success_streak"]
        item.last_reviewed_at = now
        if not correct:
            item.wrong_count = (item.wrong_count or 0) + 1
        if sched["graduated"]:
            item.state = "graduated"
        else:
            item.state = "review" if correct else "learning"
            item.due_at = now + timedelta(days=sched["due_delta_days"])

        session.add(UserReviewLog(user_id=uid, item_id=item.id, correct=1 if q >= 3 else 0))
        await session.commit()
        await session.refresh(item)

        return {
            "item_id": str(item.id),
            "correct": bool(q >= 3),
            "graduated": sched["graduated"],
            "next_interval_days": sched["due_delta_days"],
            "due_at": item.due_at.isoformat() if item.due_at else None,
            "success_streak": item.success_streak,
            "state": item.state,
        }

    async def graduate_item(
        self, session: AsyncSession, user_id: str, item_id: str
    ) -> bool:
        """手动"我已掌握"：直接毕业出队"""
        uid = UUID(user_id) if isinstance(user_id, str) else user_id
        item = await self._get_owned_item(session, uid, item_id)
        if item is None:
            return False
        item.state = "graduated"
        item.last_reviewed_at = datetime.utcnow()
        await session.commit()
        return True

    async def delete_item(
        self, session: AsyncSession, user_id: str, item_id: str
    ) -> bool:
        uid = UUID(user_id) if isinstance(user_id, str) else user_id
        item = await self._get_owned_item(session, uid, item_id)
        if item is None:
            return False
        await session.delete(item)
        await session.commit()
        return True

    async def list_items(
        self,
        session: AsyncSession,
        user_id: str,
        state: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 200,
    ) -> List[UserReviewItem]:
        """错题本全量列表（复习页侧栏），可按状态/领域筛选"""
        uid = UUID(user_id) if isinstance(user_id, str) else user_id
        stmt = select(UserReviewItem).where(UserReviewItem.user_id == uid)
        if state:
            stmt = stmt.where(UserReviewItem.state == state)
        if category:
            node_ids = select(KnowledgeNode.id).where(KnowledgeNode.category == category)
            stmt = stmt.where(UserReviewItem.node_id.in_(node_ids))
        stmt = stmt.order_by(UserReviewItem.due_at.asc()).limit(limit)
        return (await session.execute(stmt)).scalars().all()

    async def get_stats(self, session: AsyncSession, user_id: str) -> Dict[str, Any]:
        """复习统计：活跃/毕业条目数、今日到期与完成、近 7/30 日完成量与正确率"""
        uid = UUID(user_id) if isinstance(user_id, str) else user_id
        now = datetime.utcnow()
        end_of_today = now.replace(hour=23, minute=59, second=59, microsecond=999999)
        start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)

        async def _count(stmt) -> int:
            return (await session.execute(stmt)).scalar() or 0

        active = await _count(
            select(func.count()).select_from(UserReviewItem).where(
                UserReviewItem.user_id == uid, UserReviewItem.state != "graduated"
            )
        )
        graduated = await _count(
            select(func.count()).select_from(UserReviewItem).where(
                UserReviewItem.user_id == uid, UserReviewItem.state == "graduated"
            )
        )
        due_today = await _count(
            select(func.count()).select_from(UserReviewItem).where(
                UserReviewItem.user_id == uid,
                UserReviewItem.state != "graduated",
                UserReviewItem.due_at <= end_of_today,
            )
        )
        completed_today = await _count(
            select(func.count()).select_from(UserReviewLog).where(
                UserReviewLog.user_id == uid,
                UserReviewLog.reviewed_at >= start_of_today,
            )
        )

        async def _window(days: int) -> Dict[str, int]:
            since = now - timedelta(days=days)
            total = await _count(
                select(func.count()).select_from(UserReviewLog).where(
                    UserReviewLog.user_id == uid, UserReviewLog.reviewed_at >= since
                )
            )
            correct = await _count(
                select(func.count()).select_from(UserReviewLog).where(
                    UserReviewLog.user_id == uid,
                    UserReviewLog.reviewed_at >= since,
                    UserReviewLog.correct == 1,
                )
            )
            return {"reviewed": total, "correct": correct}

        return {
            "active_items": active,
            "graduated_items": graduated,
            "due_today": due_today,
            "completed_today": completed_today,
            "last_7_days": await _window(7),
            "last_30_days": await _window(30),
        }

    # ── 内部 ─────────────────────────────────────────────────────

    @staticmethod
    async def _get_owned_item(
        session: AsyncSession, uid: UUID, item_id: str
    ) -> Optional[UserReviewItem]:
        try:
            iid = UUID(item_id) if isinstance(item_id, str) else item_id
        except ValueError:
            return None
        stmt = select(UserReviewItem).where(
            UserReviewItem.id == iid, UserReviewItem.user_id == uid
        )
        return (await session.execute(stmt)).scalars().first()


review_service = ReviewService()
