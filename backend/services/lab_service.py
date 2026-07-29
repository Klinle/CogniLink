"""实验服务 — Lab CRUD 与提交记录管理"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from typing import Optional
from uuid import UUID
from datetime import datetime

from models.database import Lab, UserLabSubmission


class LabService:
    """Lab 数据操作与提交管理"""

    async def list_labs(
        self,
        session: AsyncSession,
        lab_type: Optional[str] = None,
        node_id: Optional[str] = None,
        difficulty: Optional[str] = None,
        include_diagnostic: bool = False,
    ) -> list:
        """获取 Lab 列表（可按类型/节点/难度筛选）

        默认排除 tag='diagnostic' 的诊断题，避免污染练习题库列表。
        """
        stmt = select(Lab)
        if not include_diagnostic:
            stmt = stmt.where(or_(Lab.tag.is_(None), Lab.tag != "diagnostic"))
        if lab_type:
            stmt = stmt.where(Lab.lab_type == lab_type)
        if node_id:
            try:
                stmt = stmt.where(Lab.node_id == UUID(node_id))
            except ValueError:
                pass
        if difficulty:
            stmt = stmt.where(Lab.difficulty == difficulty)
        stmt = stmt.order_by(Lab.created_at.desc())

        result = await session.execute(stmt)
        labs = result.scalars().all()

        return [
            {
                "id": str(lab.id),
                "title": lab.title,
                "description": lab.description or "",
                "difficulty": lab.difficulty,
                "lab_type": lab.lab_type,
                "node_id": str(lab.node_id) if lab.node_id else None,
                "test_cases": lab.test_cases,
            }
            for lab in labs
        ]

    async def get_lab(self, session: AsyncSession, lab_id: UUID) -> Optional[dict]:
        """获取 Lab 详情（含 starter_code、test_cases）"""
        lab = await session.get(Lab, lab_id)
        if not lab:
            return None

        return {
            "id": str(lab.id),
            "title": lab.title,
            "description": lab.description or "",
            "starter_code": lab.starter_code or "",
            "test_cases": lab.test_cases or {},
            "difficulty": lab.difficulty,
            "lab_type": lab.lab_type,
            "node_id": str(lab.node_id) if lab.node_id else None,
            "detailed_explanation": lab.detailed_explanation,
            "tag": lab.tag,
        }

    async def create_submission(
        self,
        session: AsyncSession,
        user_id: UUID,
        lab_id: UUID,
        submitted_code: str,
    ) -> UserLabSubmission:
        """创建提交记录"""
        submission = UserLabSubmission(
            user_id=user_id,
            lab_id=lab_id,
            submitted_code=submitted_code,
            status="pending",
            score=0,
        )
        session.add(submission)
        await session.commit()
        await session.refresh(submission)
        return submission

    async def update_submission_result(
        self,
        session: AsyncSession,
        submission_id: UUID,
        status: str,
        score: int,
        evaluation_result: dict,
        ai_feedback: Optional[str] = None,
    ):
        """更新评测结果"""
        submission = await session.get(UserLabSubmission, submission_id)
        if submission:
            submission.status = status
            submission.score = score
            submission.evaluation_result = evaluation_result
            submission.ai_feedback = ai_feedback
            await session.commit()

    async def get_submissions(
        self,
        session: AsyncSession,
        user_id: UUID,
        lab_id: UUID,
    ) -> list:
        """获取用户提交历史"""
        stmt = (
            select(UserLabSubmission)
            .where(
                and_(
                    UserLabSubmission.user_id == user_id,
                    UserLabSubmission.lab_id == lab_id,
                )
            )
            .order_by(UserLabSubmission.created_at.desc())
        )
        result = await session.execute(stmt)
        submissions = result.scalars().all()

        return [
            {
                "id": str(s.id),
                "submitted_code": s.submitted_code,
                "status": s.status,
                "score": s.score,
                "evaluation_result": s.evaluation_result or {},
                "ai_feedback": s.ai_feedback or "",
                "created_at": s.created_at.isoformat(),
            }
            for s in submissions
        ]


lab_service = LabService()
