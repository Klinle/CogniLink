"""诊断式 Onboarding API — 状态查询 / 跳过 / 诊断题拉取 / 答卷提交与画像初始化

onboarding_completed 语义：0 未完成（首登重定向向导）；1 已跳过（引导闭合，
dashboard 常驻补做入口）；2 已完成诊断。诊断可重复，重测 proficiency 取新值，
is_lighted 只升不降（避免一次失误熄灭已掌握节点）。
"""
from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_session
from core.dependencies import get_current_user
from models.database import KnowledgeNode, Lab, User, UserKnowledgeState
from models.schemas import OnboardingCompleteRequest, OnboardingDiagnoseRequest

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

VALID_DOMAINS = {"programming", "dsa", "organization", "os", "network", "database"}
# 节点点亮阈值（正确率）
LIGHT_THRESHOLD = 0.8
# 每次诊断题量上限（防御异常长答卷）
MAX_DIAGNOSE_RESULTS = 20


@router.get("/status")
async def get_onboarding_status(
    current_user: User = Depends(get_current_user),
):
    return {
        "onboarding_completed": current_user.onboarding_completed or 0,
        "has_diagnosed": (current_user.onboarding_completed or 0) == 2,
    }


@router.post("/complete")
async def complete_onboarding(
    request: OnboardingCompleteRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """跳过引导：置 1 关闭首登重定向；已诊断（=2）不降级"""
    user = await session.get(User, current_user.id)
    if (user.onboarding_completed or 0) < 1:
        user.onboarding_completed = 1
        await session.commit()
    return {"onboarding_completed": user.onboarding_completed}


@router.get("/questions")
async def get_diagnostic_questions(
    domain: str = Query(..., description="六大领域之一"),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """按领域拉取预置诊断题（labs.tag = diagnostic，客观题）"""
    if domain not in VALID_DOMAINS:
        raise HTTPException(400, f"无效领域: {domain}")

    stmt = (
        select(Lab, KnowledgeNode)
        .join(KnowledgeNode, Lab.node_id == KnowledgeNode.id)
        .where(Lab.tag == "diagnostic", KnowledgeNode.category == domain)
        .order_by(Lab.created_at.asc())
        .limit(10)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(lab.id),
            "title": lab.title,
            "description": lab.description,
            "lab_type": lab.lab_type,
            "difficulty": lab.difficulty,
            "test_cases": lab.test_cases,
            "detailed_explanation": lab.detailed_explanation,
            "node_id": str(lab.node_id),
            "node_name": node.name,
            "node_code": node.code,
        }
        for lab, node in rows
    ]


@router.post("/diagnose")
async def submit_diagnosis(
    request: OnboardingDiagnoseRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """诊断答卷：按节点聚合正确率写入画像初值，正确率 >= 0.8 的节点直接点亮"""
    if request.domain not in VALID_DOMAINS:
        raise HTTPException(400, f"无效领域: {request.domain}")
    if not request.results:
        raise HTTPException(400, "答卷为空")

    results = request.results[:MAX_DIAGNOSE_RESULTS]

    # 只认可预置诊断题，防止用任意 lab_id 刷画像
    lab_ids = []
    for r in results:
        try:
            lab_ids.append(UUID(r.lab_id))
        except ValueError:
            raise HTTPException(400, f"非法题目 ID: {r.lab_id}")

    stmt = select(Lab).where(Lab.id.in_(lab_ids), Lab.tag == "diagnostic")
    labs = {str(lab.id): lab for lab in (await session.execute(stmt)).scalars().all()}
    if not labs:
        raise HTTPException(400, "答卷中不包含有效诊断题")

    # 按节点聚合正确率
    per_node = defaultdict(lambda: {"total": 0, "correct": 0})
    for r in results:
        lab = labs.get(r.lab_id)
        if lab is None or lab.node_id is None:
            continue
        agg = per_node[lab.node_id]
        agg["total"] += 1
        agg["correct"] += 1 if r.correct else 0

    if not per_node:
        raise HTTPException(400, "答卷未关联任何知识节点")

    # 写入用户知识状态：proficiency 取本次值，is_lighted 只升不降
    existing_stmt = select(UserKnowledgeState).where(
        UserKnowledgeState.user_id == current_user.id,
        UserKnowledgeState.node_id.in_(list(per_node.keys())),
    )
    existing = {
        s.node_id: s
        for s in (await session.execute(existing_stmt)).scalars().all()
    }

    node_names_stmt = select(KnowledgeNode.id, KnowledgeNode.name).where(
        KnowledgeNode.id.in_(list(per_node.keys()))
    )
    node_names = {row[0]: row[1] for row in (await session.execute(node_names_stmt)).all()}

    summary = []
    lighted = []
    for node_id, agg in per_node.items():
        rate = agg["correct"] / agg["total"] if agg["total"] else 0.0
        state = existing.get(node_id)
        if state is None:
            state = UserKnowledgeState(
                user_id=current_user.id, node_id=node_id,
                proficiency=rate, is_lighted=0,
            )
            session.add(state)
        else:
            state.proficiency = rate
        if rate >= LIGHT_THRESHOLD and not state.is_lighted:
            state.is_lighted = 1
        if state.is_lighted:
            lighted.append(node_names.get(node_id, ""))
        summary.append({
            "node_id": str(node_id),
            "node_name": node_names.get(node_id, ""),
            "total": agg["total"],
            "correct": agg["correct"],
            "proficiency": round(rate, 2),
            "is_lighted": bool(state.is_lighted),
        })

    user = await session.get(User, current_user.id)
    user.onboarding_completed = 2
    await session.commit()

    return {
        "domain": request.domain,
        "answered": len(results),
        "nodes": summary,
        "lighted_names": [n for n in lighted if n],
    }
