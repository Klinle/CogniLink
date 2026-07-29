"""实验 API — Lab 列表、详情、提交评测、提交历史"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from collections import defaultdict
from typing import Optional
from uuid import UUID, uuid4

from core.database import get_session
from core.dependencies import get_current_user
from models.database import User, KnowledgeNode, UserKnowledgeState, DocumentChunk, Document
from models.schemas import (
    LabSubmitRequest,
    GenerateExerciseRequest,
    EvaluateDynamicRequest,
)
from services.lab_service import lab_service
from services.evaluation_service import evaluation_service
from services.knowledge_service import knowledge_service
from services.review_service import review_service

router = APIRouter(prefix="/api/labs", tags=["labs"])


def _is_failed(lab_type: str, result: dict) -> bool:
    """未通过判定：客观题任一小题答错（score<100），code 题低于 60 分。

    LLM/接口异常（status=error）不算答错，不入复习队列。
    """
    if result.get("status") == "error":
        return False
    score = result.get("score", 0)
    return score < 60 if lab_type == "code" else score < 100


async def _enqueue_review_on_failure(
    session: AsyncSession,
    user_id: str,
    lab_type: str,
    result: dict,
    *,
    title: str,
    content: dict,
    answer=None,
    explanation=None,
    source_type: str,
    lab_id: str = None,
    node_id: str = None,
) -> bool:
    """答错自动入复习队列；异常静默（不影响评测主流程）。返回是否已入队。"""
    try:
        if _is_failed(lab_type, result):
            await review_service.enqueue_wrong_answer(
                session,
                user_id,
                title=title,
                exercise_type=lab_type,
                content=content,
                answer=answer,
                explanation=explanation,
                source_type=source_type,
                lab_id=lab_id,
                node_id=node_id,
            )
            return True
    except Exception as e:
        print(f"[Review Enqueue Error] {type(e).__name__}: {e}")
    return False


@router.get("")
async def list_labs(
    lab_type: Optional[str] = Query(None, description="Filter by lab_type: code/quiz"),
    node_id: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """获取 Lab 列表（可按类型/节点/难度筛选）"""
    return await lab_service.list_labs(session, lab_type, node_id, difficulty)


@router.post("/generate")
async def generate_exercise(
    request: GenerateExerciseRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """AI 动态生成针对性练习 — 基于用户薄弱知识点

    不传 node_id 时自动取推荐薄弱节点；生成的练习不持久化（虚拟 Lab），
    id 用 dynamic- 前缀标记，前端据此在提交时走 /evaluate-dynamic 即时评测。
    """
    node_id = request.node_id
    subject = request.subject

    # 未指定节点且指定了科目 → 在该科目下筛选出用户最薄弱或未开启的节点
    if not node_id and subject:
        stmt = select(KnowledgeNode).where(KnowledgeNode.category == subject)
        nodes = (await session.execute(stmt)).scalars().all()
        if not nodes:
            raise HTTPException(404, f"未找到科目【{subject}】下的任何知识节点")
        
        node_ids = [n.id for n in nodes]
        stmt_states = select(UserKnowledgeState).where(
            UserKnowledgeState.user_id == current_user.id,
            UserKnowledgeState.node_id.in_(node_ids)
        )
        states = (await session.execute(stmt_states)).scalars().all()
        state_map = {s.node_id: s for s in states}
        
        def get_sort_key(node):
            state = state_map.get(node.id)
            if not state:
                return (0, 0.0)
            return (1, state.proficiency)
            
        nodes_sorted = sorted(nodes, key=get_sort_key)
        selected_node = nodes_sorted[0]
        node_id = str(selected_node.id)

    # 未指定节点且未指定科目 → 自动取全局推荐薄弱节点
    elif not node_id:
        recommendations = await knowledge_service.recommend_learning_path(
            session, current_user.id, top_n=1
        )
        if not recommendations:
            raise HTTPException(404, "暂无可推荐的知识点，请先学习基础知识")
        node_id = recommendations[0]["id"]

    try:
        node_uuid = UUID(node_id)
    except ValueError:
        raise HTTPException(400, "Invalid node_id")

    node = await session.get(KnowledgeNode, node_uuid)
    if not node:
        raise HTTPException(404, "Knowledge node not found")

    # 查用户该节点认知状态，用于个性化难度
    stmt = select(UserKnowledgeState).where(
        UserKnowledgeState.user_id == current_user.id,
        UserKnowledgeState.node_id == node_uuid,
    )
    state = (await session.execute(stmt)).scalars().first()
    proficiency = state.proficiency if state else 0.0
    is_lighted = bool(state.is_lighted) if state else False

    # === 用户画像上下文聚合 ===
    # 目标节点三态分类：未学习（无记录）/ 薄弱（有记录但未点亮）/ 已掌握（已点亮）
    if state is None:
        learning_state = "unlearned"
    elif state.is_lighted:
        learning_state = "mastered"
    else:
        learning_state = "weak"

    # 科目维度：该科目下所有节点的三态分布
    effective_subject = subject or node.category
    stmt_subj_nodes = select(KnowledgeNode).where(KnowledgeNode.category == effective_subject)
    subj_nodes = (await session.execute(stmt_subj_nodes)).scalars().all()
    subj_node_ids = [n.id for n in subj_nodes]

    stmt_subj_states = select(UserKnowledgeState).where(
        UserKnowledgeState.user_id == current_user.id,
        UserKnowledgeState.node_id.in_(subj_node_ids),
    )
    subj_states = (await session.execute(stmt_subj_states)).scalars().all()
    subj_state_map = {s.node_id: s for s in subj_states}

    mastered_cnt = sum(1 for s in subj_states if s.is_lighted)
    weak_cnt = sum(1 for s in subj_states if not s.is_lighted)
    unlearned_cnt = len(subj_nodes) - len(subj_states)

    # 未学习节点名（取 pagerank 前 3，避免 prompt 过长）
    unlearned_nodes = [n for n in subj_nodes if n.id not in subj_state_map]
    unlearned_nodes.sort(key=lambda n: n.pagerank_weight or 0, reverse=True)
    unlearned_names = [n.name for n in unlearned_nodes[:3]]

    # 全局维度：六领域覆盖率摘要
    stmt_all_nodes = select(KnowledgeNode)
    all_nodes = (await session.execute(stmt_all_nodes)).scalars().all()

    stmt_lighted = select(UserKnowledgeState).where(
        UserKnowledgeState.user_id == current_user.id,
        UserKnowledgeState.is_lighted == 1,
    )
    lighted_states = (await session.execute(stmt_lighted)).scalars().all()
    lighted_ids = {s.node_id for s in lighted_states}

    cat_totals: dict[str, int] = defaultdict(int)
    cat_lighted: dict[str, int] = defaultdict(int)
    for n in all_nodes:
        cat_totals[n.category] += 1
        if n.id in lighted_ids:
            cat_lighted[n.category] += 1

    total_lighted = len(lighted_ids)
    total_nodes_count = len(all_nodes)
    coverage_pct = round(total_lighted / total_nodes_count * 100) if total_nodes_count > 0 else 0
    if coverage_pct < 20:
        stage = "入门期"
    elif coverage_pct < 60:
        stage = "成长期"
    else:
        stage = "冲刺期"

    # 薄弱领域（覆盖率 < 20%）
    category_mapping = {
        "programming": "编程开发基础",
        "dsa": "数据结构与高级特性",
        "organization": "面向对象与系统架构",
        "os": "并发编程与操作系统",
        "network": "网络编程与联机服务",
        "database": "数据工程与持久化",
    }
    weak_domains: list[str] = []
    for eng_cat, chn_name in category_mapping.items():
        total = cat_totals.get(eng_cat, 0)
        lighted = cat_lighted.get(eng_cat, 0)
        cat_cov = round(lighted / total * 100) if total > 0 else 0
        if cat_cov < 20:
            weak_domains.append(f"{chn_name}({cat_cov}%)")

    # 组装画像上下文字符串
    subject_chn = category_mapping.get(effective_subject, effective_subject)
    profile_lines = [
        f"- 学习阶段: {stage}（已点亮 {total_lighted}/{total_nodes_count} 节点，覆盖率 {coverage_pct}%）",
        f"- 选中科目【{subject_chn}】状态: 已掌握 {mastered_cnt} / 薄弱 {weak_cnt} / 未学习 {unlearned_cnt}",
    ]
    if unlearned_names:
        profile_lines.append(f"- 未学习节点: {', '.join(unlearned_names)}")
    if weak_domains:
        profile_lines.append(f"- 全局薄弱领域: {', '.join(weak_domains)}")
    profile_context = "\n".join(profile_lines)

    # 4. 获取与该节点关联的电子书分块参考资料（RAG 检索：局限于该知识库下所有文档）
    stmt_chunks = select(DocumentChunk).where(
        and_(
            DocumentChunk.node_id == node_uuid,
            DocumentChunk.document_id.in_(
                select(Document.id).where(
                    Document.knowledge_base_id == node.knowledge_base_id
                )
            )
        )
    ).limit(3)
    result_chunks = await session.execute(stmt_chunks)
    node_chunks = result_chunks.scalars().all()
    
    knowledge_context = ""
    if node_chunks:
        knowledge_context = "\n\n---\n\n".join(
            f"[参考来源分块{idx+1}]\n{c.content}" for idx, c in enumerate(node_chunks)
        )

    exercise = await evaluation_service.generate_targeted_exercise(
        node_name=node.name,
        node_description=node.description or "",
        node_category=node.category or "",
        proficiency=proficiency,
        is_lighted=is_lighted,
        exercise_type=request.exercise_type,
        difficulty=request.difficulty or "medium",
        api_key=request.api_key,
        model=request.model,
        base_url=request.base_url,
        learning_state=learning_state,
        profile_context=profile_context,
        knowledge_context=knowledge_context,
    )

    if "error" in exercise:
        raise HTTPException(500, exercise["error"])

    # 组装虚拟 Lab（与 Lab 结构兼容，前端可直接渲染）
    return {
        "id": f"dynamic-{uuid4()}",
        "title": exercise.get("title", f"{node.name} · 针对性练习"),
        "description": exercise.get("description", ""),
        "starter_code": exercise.get("starter_code", ""),
        "test_cases": exercise.get("test_cases", {}),
        "difficulty": exercise.get("difficulty", request.difficulty or "medium"),
        "lab_type": exercise.get("lab_type", request.exercise_type),
        "node_id": node_id,
        "node_name": node.name,
        "is_dynamic": True,
    }


@router.post("/evaluate-dynamic")
async def evaluate_dynamic(
    request: EvaluateDynamicRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """动态生成练习的即时评测 — 不创建 submission 记录，但仍联动知识图谱

    quiz 走程序判分，code 走 LLM 评测；评测后调用 apply_evaluation_result
    点亮薄弱节点或记录薄弱状态。
    """
    exercise = request.exercise
    lab_type = exercise.get("lab_type", "code")

    if lab_type in evaluation_service.OBJECTIVE_LAB_TYPES:
        test_cases = exercise.get("test_cases", {})
        user_answers = request.answers or {}
        result = evaluation_service.evaluate_objective_submission(
            lab_type, test_cases, user_answers
        )
    else:
        result = await evaluation_service.evaluate_code_submission(
            title=exercise.get("title", ""),
            description=exercise.get("description", ""),
            starter_code=exercise.get("starter_code", ""),
            test_cases=exercise.get("test_cases", {}),
            user_code=request.code,
            api_key=request.api_key,
            model=request.model,
            base_url=request.base_url,
        )

    # 联动点亮知识节点（通过→点亮，未通过→记薄弱点）
    knowledge_result = None
    if request.node_id:
        try:
            node_uuid = UUID(request.node_id)
            knowledge_result = await knowledge_service.apply_evaluation_result(
                session,
                current_user.id,
                node_uuid,
                result.get("score", 0),
                result.get("status", "error"),
            )
        except Exception as e:
            print(f"[Knowledge Link Error] {e}")

    # 未通过自动进入错题复习队列（快照自请求中的题目 JSON）；
    # 客观题空答卷视为未作答，不计入错题
    review_enqueued = False
    attempted = bool(request.answers) or lab_type not in evaluation_service.OBJECTIVE_LAB_TYPES
    if attempted:
        review_enqueued = await _enqueue_review_on_failure(
            session, str(current_user.id), lab_type, result,
            title=exercise.get("title", "动态练习"),
            content=exercise.get("test_cases") or {},
            answer=exercise.get("answer"),
            explanation=exercise.get("detailed_explanation") or exercise.get("explanation"),
            source_type="dynamic",
            node_id=request.node_id,
        )

    return {
        "status": result.get("status", "error"),
        "score": result.get("score", 0),
        "feedback": result.get("feedback", ""),
        "evaluation_result": result,
        "knowledge": knowledge_result,
        "review_enqueued": review_enqueued,
    }


@router.get("/{lab_id}")
async def get_lab(
    lab_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """获取 Lab 详情（含 starter_code、test_cases）"""
    try:
        parsed_id = UUID(lab_id)
    except ValueError:
        raise HTTPException(400, "Invalid lab_id")

    lab = await lab_service.get_lab(session, parsed_id)
    if not lab:
        raise HTTPException(404, "Lab not found")
    return lab


@router.post("/{lab_id}/submit")
async def submit_lab(
    lab_id: str,
    request: LabSubmitRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """提交答案，自动评测"""
    try:
        parsed_id = UUID(lab_id)
    except ValueError:
        raise HTTPException(400, "Invalid lab_id")

    # Get lab details
    lab = await lab_service.get_lab(session, parsed_id)
    if not lab:
        raise HTTPException(404, "Lab not found")

    # Create submission record
    submission = await lab_service.create_submission(
        session, current_user.id, parsed_id, request.code
    )

    # Evaluate based on lab_type
    if lab.get("lab_type") in evaluation_service.OBJECTIVE_LAB_TYPES:
        # 客观题：服务端程序判分
        test_cases = lab.get("test_cases", {})
        user_answers = request.answers or {}
        result = evaluation_service.evaluate_objective_submission(
            lab.get("lab_type"), test_cases, user_answers
        )
    else:
        # Code: LLM evaluation
        result = await evaluation_service.evaluate_code_submission(
            title=lab.get("title", ""),
            description=lab.get("description", ""),
            starter_code=lab.get("starter_code", ""),
            test_cases=lab.get("test_cases", {}),
            user_code=request.code,
            api_key=request.api_key,
            model=request.model,
            base_url=request.base_url,
        )

    # Update submission with results
    await lab_service.update_submission_result(
        session,
        submission.id,
        status=result.get("status", "error"),
        score=result.get("score", 0),
        evaluation_result=result,
        ai_feedback=result.get("feedback", ""),
    )

    # 联动点亮知识节点（通过）或记录薄弱点（未通过）
    knowledge_result = None
    if lab.get("node_id"):
        try:
            node_uuid = UUID(lab["node_id"])
            knowledge_result = await knowledge_service.apply_evaluation_result(
                session,
                current_user.id,
                node_uuid,
                result.get("score", 0),
                result.get("status", "error"),
            )
        except Exception as e:
            print(f"[Knowledge Link Error] {e}")

    # 未通过自动进入错题复习队列（按 lab_id 去重）；客观题空答卷视为未作答
    review_enqueued = False
    submit_lab_type = lab.get("lab_type") or "code"
    attempted = bool(request.answers) or submit_lab_type not in evaluation_service.OBJECTIVE_LAB_TYPES
    if attempted:
        review_enqueued = await _enqueue_review_on_failure(
            session, str(current_user.id), submit_lab_type, result,
            title=lab.get("title", "未命名题目"),
            content=lab.get("test_cases") or {},
            explanation=lab.get("detailed_explanation"),
            source_type="lab",
            lab_id=str(parsed_id),
            node_id=lab.get("node_id"),
        )

    return {
        "id": str(submission.id),
        "status": result.get("status", "error"),
        "score": result.get("score", 0),
        "feedback": result.get("feedback", ""),
        "evaluation_result": result,
        "knowledge": knowledge_result,
        "review_enqueued": review_enqueued,
    }


@router.get("/{lab_id}/submissions")
async def get_submissions(
    lab_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """获取用户提交历史"""
    try:
        parsed_id = UUID(lab_id)
    except ValueError:
        raise HTTPException(400, "Invalid lab_id")

    return await lab_service.get_submissions(session, current_user.id, parsed_id)
