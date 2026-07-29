"""review_service 调度算法测试 — SM-2 简化间隔重复（纯函数，不依赖数据库）"""
import pytest

from services.review_service import (
    ReviewService,
    review_service,
    GRADUATE_STREAK,
    DAILY_CAP,
    MIN_EASE,
    DEFAULT_EASE,
)


class TestNextSchedule:
    """next_schedule：由当前状态与答题质量计算下一次调度"""

    def test_new_item_first_correct(self):
        """新题（interval=0）首次答对：间隔进入阶梯第一档 1 天"""
        s = ReviewService.next_schedule(0, DEFAULT_EASE, 0, quality=4)
        assert s["interval_days"] == 1
        assert s["success_streak"] == 1
        assert s["graduated"] is False
        assert s["due_delta_days"] == 1

    def test_ladder_progression(self):
        """间隔阶梯 1 -> 3 -> 7"""
        s1 = ReviewService.next_schedule(1, DEFAULT_EASE, 1, quality=4)
        assert s1["interval_days"] == 3
        s2 = ReviewService.next_schedule(3, DEFAULT_EASE, 1, quality=4)
        assert s2["interval_days"] == 7

    def test_beyond_ladder_multiplies_by_ease(self):
        """走完阶梯后按 ease_factor 倍增"""
        s = ReviewService.next_schedule(7, 2.5, 1, quality=4)
        assert s["interval_days"] == round(7 * 2.5)

    def test_failure_resets(self):
        """答错：间隔回到 1 天、连对清零、难度系数下降"""
        s = ReviewService.next_schedule(7, 2.5, 2, quality=1)
        assert s["interval_days"] == 1
        assert s["success_streak"] == 0
        assert s["ease_factor"] == pytest.approx(2.3)
        assert s["graduated"] is False

    def test_ease_floor(self):
        """难度系数不低于下限"""
        s = ReviewService.next_schedule(1, MIN_EASE, 0, quality=1)
        assert s["ease_factor"] == MIN_EASE

    def test_graduation_on_streak(self):
        """连续答对达到阈值即毕业"""
        s = ReviewService.next_schedule(3, DEFAULT_EASE, GRADUATE_STREAK - 1, quality=4)
        assert s["graduated"] is True
        assert s["success_streak"] == GRADUATE_STREAK

    def test_flashcard_quality_three_counts_as_pass(self):
        """闪卡自评"模糊"（quality=3）计为通过但不加速"""
        s = ReviewService.next_schedule(1, DEFAULT_EASE, 0, quality=3)
        assert s["success_streak"] == 1
        assert s["graduated"] is False
        # quality=3 时 EF 下降（标准 SM-2 行为），但仍在下限之上
        assert MIN_EASE <= s["ease_factor"] < DEFAULT_EASE

    def test_quality_five_raises_ease(self):
        """轻松答对提高难度系数"""
        s = ReviewService.next_schedule(1, DEFAULT_EASE, 0, quality=5)
        assert s["ease_factor"] > DEFAULT_EASE


class TestDedupKey:
    """build_dedup_key：题库题按 lab_id，动态题按内容哈希"""

    def test_lab_id_key(self):
        assert ReviewService.build_dedup_key("abc-123", "标题", {}) == "lab:abc-123"

    def test_hash_key_stable(self):
        k1 = ReviewService.build_dedup_key(None, "标题", {"a": 1, "b": 2})
        k2 = ReviewService.build_dedup_key(None, "标题", {"b": 2, "a": 1})
        assert k1 == k2  # 键序无关
        assert k1.startswith("hash:")

    def test_hash_key_differs_by_content(self):
        k1 = ReviewService.build_dedup_key(None, "标题", {"a": 1})
        k2 = ReviewService.build_dedup_key(None, "标题", {"a": 2})
        assert k1 != k2


class TestConstants:
    def test_daily_cap_default(self):
        assert DAILY_CAP == 30

    def test_global_instance(self):
        assert isinstance(review_service, ReviewService)


class TestAnswerIdempotency:
    """当日重复作答/已毕业条目短路 — 防止一天内重复推进 SM-2 调度"""

    def _fake_item(self, **overrides):
        from datetime import datetime, timedelta
        from types import SimpleNamespace
        from uuid import uuid4

        defaults = dict(
            id=uuid4(), state="review", interval_days=3, ease_factor=2.5,
            success_streak=1, wrong_count=1,
            due_at=datetime.utcnow() + timedelta(days=3),
            last_reviewed_at=None,
        )
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    @pytest.mark.asyncio
    async def test_same_day_repeat_short_circuits(self):
        from datetime import datetime
        from unittest.mock import AsyncMock, MagicMock, patch
        from uuid import uuid4

        item = self._fake_item(last_reviewed_at=datetime.utcnow())
        session = MagicMock()
        session.commit = AsyncMock()
        with patch.object(review_service, "_get_owned_item", AsyncMock(return_value=item)):
            result = await review_service.answer_item(
                session, str(uuid4()), str(item.id), correct=True
            )

        assert result["already_reviewed"] is True
        assert result["success_streak"] == 1
        assert item.success_streak == 1
        session.add.assert_not_called()
        session.commit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_graduated_item_short_circuits(self):
        from unittest.mock import AsyncMock, MagicMock, patch
        from uuid import uuid4

        item = self._fake_item(state="graduated", success_streak=3)
        session = MagicMock()
        session.commit = AsyncMock()
        with patch.object(review_service, "_get_owned_item", AsyncMock(return_value=item)):
            result = await review_service.answer_item(
                session, str(uuid4()), str(item.id), correct=False
            )

        assert result["already_reviewed"] is True
        assert result["graduated"] is True
        session.add.assert_not_called()

    @pytest.mark.asyncio
    async def test_yesterday_review_proceeds(self):
        from datetime import datetime, timedelta
        from unittest.mock import AsyncMock, MagicMock, patch
        from uuid import uuid4

        item = self._fake_item(last_reviewed_at=datetime.utcnow() - timedelta(days=1))
        session = MagicMock()
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        with patch.object(review_service, "_get_owned_item", AsyncMock(return_value=item)):
            result = await review_service.answer_item(
                session, str(uuid4()), str(item.id), correct=True
            )

        assert "already_reviewed" not in result
        assert result["success_streak"] == 2
        session.add.assert_called_once()
        session.commit.assert_awaited()
