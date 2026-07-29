"""
RAG 六阶段流水线 + LangGraph 多 Agent 协同工作流服务

run_stream 实现完整 RAG 流水线：
  1. 会话记忆加载 — 对话历史 + 用户长期记忆向量检索
  2. Query 改写与拆分 — LLM 补全指代/省略，多意图拆分为子查询
  3. 意图识别与分类 — 意图树（chitchat/knowledge_qa/practice_request/realtime_query
     → 六大知识领域 domain + 教学风格 style）
  4. 歧义引导判断 — 查询过于模糊时反问引导用户澄清，短路返回
  5. 多通道并行检索 — 知识库混合检索（BM25 + 向量 + RRF，多子查询并行）
     与工具通道（联网搜索）asyncio 并行执行
  6. Prompt 组装与流式生成 — 风格（HOW）+ 领域（WHAT）+ 记忆 + 检索上下文
     + 认知状态（针对谁）组装 system_prompt 后真流式输出

保留的 LangGraph StateGraph（orchestrator → rag_bot）供 run() 非流式调用使用。
"""

import json
from typing import TypedDict, Any, Optional, List, Tuple

from langgraph.graph import StateGraph, END

from core.config import settings


# 教学风格 → 中文标签映射
STYLE_ZH_MAP = {
    "humor": "幽默风格",
    "academic": "学术风格",
    "coach": "实战风格",
    "general": "通用风格",
}

# 教学风格 → Agent role_type 映射（与 agent_service.STYLE_ROLE_MAP 保持一致）
STYLE_ROLE_MAP = {
    "humor": "humor_mentor",
    "academic": "academic_mentor",
    "coach": "coach_mentor",
    "general": None,
}

# 六大知识领域定义 — 与 seed_data.py 的 category 对齐
DOMAINS = {
    "programming": {
        "zh": "编程开发基础",
        "mentor": "你是一位 Python 游戏与工具开发导师，专精变量、控制流、内置容器、函数参数解包、异常捕获等基础概念。在讲解时，请将这些概念与『控制台文字RPG/计算器小工具』的业务场景结合起来讲解，配合简洁的 Python 代码示例。",
    },
    "dsa": {
        "zh": "数据结构与高级特性",
        "mentor": "你是一位 Python 益智游戏逻辑设计导师，专精列表推导式、装饰器、生成器与迭代器协议、垃圾回收与反射等高级特性。在讲解时，请结合『2048网格生成/技能CD限制/无限随机关卡产生』等益智游戏数据引擎逻辑，配合通俗的类比和 Python 代码示例。",
    },
    "organization": {
        "zh": "面向对象与系统架构",
        "mentor": "你是一位 Python 面向对象（OOP）构装设计导师，专精类与实例、继承与多态（MRO算法）、魔术方法、描述符拦截与 slots 空间优化等。请将这些概念与『贪吃蛇蛇身类/扫雷雷区矩阵生成/药水融合』等经典街机游戏结构结合起来讲解，配合 Python 面向对象代码示例。",
    },
    "os": {
        "zh": "并发编程与操作系统",
        "mentor": "你是一位 Python 并发与系统编程导师，专精文件操作、GIL全局锁、多线程与多进程、async/await协程异步编程以及并发线程池。请将这些概念与『多线程打地鼠/多人游戏状态同步/打砖块实时主循环』等动作游戏的实时并发控制场景结合起来讲解。",
    },
    "network": {
        "zh": "网络编程与联机服务",
        "mentor": "你是一位 Python 网络与 Web 编程导师，专精 Socket 套接字通信、HTTP协议请求、FastAPI Web框架、数据序列化等。请将这些概念与『联机对战五子棋/全球积分排行榜/玩家存档打包』等联机服务与网络协议场景结合起来讲解，配合 Python 代码。",
    },
    "database": {
        "zh": "数据工程与持久化",
        "mentor": "你是一位 Python 游戏数据持久化与工程实践导师，专精 SQLite内置数据库、SQLAlchemy ORM框架、pytest单元测试、NumPy/Pandas矩阵与数据分析。请结合『玩家本地存档/核心机制逻辑自测/玩家通关数据统计分析』等工程实践场景进行讲解，配合 SQL 或 Python 数据处理代码示例。",
    },
}


class AgentState(TypedDict, total=False):
    """
    LangGraph 工作流状态定义

    所有节点共享此状态，通过读取和更新字段实现协同。
    total=False 允许字段渐进式填充（不必同时存在所有字段）。
    """

    messages: list                    # 对话历史
    user_id: str                      # 用户ID
    sub_tasks: list                   # Orchestrator 分解的子任务列表
    classified_domain: str            # Orchestrator 分类出的知识领域
    classified_style: str             # Orchestrator 分类出的教学风格
    agent_id: str                     # 用户手动选择的导师 ID（humor/academic/coach 或 UUID）
    agent_results: dict               # 各 Agent 的中间结果 {"rag": ...}
    final_answer: str                 # 最终聚合结果
    api_key: str                      # LLM API Key
    model: str                        # 模型名
    base_url: Optional[str]           # 自定义 API 地址
    session: Any                      # 数据库会话（RagBot 检索需要）
    user_message: str                 # 当前用户消息
    use_memory: bool                  # 是否注入用户记忆
    use_tools: bool                   # 是否启用工具调用
    use_local_embedding: bool         # 是否使用本地 BGE-M3 嵌入（须与文档上传时一致）
    use_rag: bool                     # 是否启用 RAG 检索
    # ── RAG 流水线阶段产物 ──
    rewritten_query: str              # 结合上下文改写后的查询
    sub_queries: list                 # 拆分出的子查询列表（多意图时 >1）
    intent: str                       # 意图树顶层分类（chitchat/knowledge_qa/practice_request/realtime_query）
    memory_context: str               # 阶段1加载的用户长期记忆上下文
    tool_context: str                 # 工具通道（联网搜索等）检索结果


class GraphService:
    """LangGraph 多 Agent 协同工作流服务"""

    def __init__(self):
        self._app = None

    async def orchestrator_node(self, state: AgentState) -> dict:
        """
        Orchestrator 节点：意图分析 + 领域分类 + 风格分类

        分析用户消息，判断属于六大知识领域中的哪个，
        以及最适合的教学风格，或归类为 general。

        Returns:
            更新后的状态字段：sub_tasks + classified_domain + classified_style
        """
        user_message = state.get("user_message", "")
        api_key = state.get("api_key", "")
        model = state.get("model", "")
        base_url = state.get("base_url")

        domain, style = await self._classify_domain_and_style(
            user_message, api_key, model, base_url
        )

        return {
            "sub_tasks": [{"domain": domain, "style": style, "task": user_message}],
            "classified_domain": domain,
            "classified_style": style,
        }

    async def _classify_domain_and_style(
        self,
        message: str,
        api_key: str,
        model: str,
        base_url: Optional[str] = None,
    ) -> Tuple[str, str]:
        """
        单次 LLM 调用同时分类知识领域和教学风格。

        Returns:
            (domain, style) — domain 为六大领域或 general，style 为 humor/academic/coach/general
        """

        from openai import AsyncOpenAI

        effective_api_key = api_key or settings.DEEPSEEK_API_KEY
        effective_base_url = base_url or settings.DEEPSEEK_BASE_URL
        effective_model = model or settings.DEEPSEEK_MODEL

        if not effective_api_key:
            return "general", "general"

        client = AsyncOpenAI(api_key=effective_api_key, base_url=effective_base_url)

        system_prompt = """你是一个双重分类器。请分析用户的问题，同时判断：

1. 知识领域（domain）— 属于以下哪个领域：
- programming: 终端游戏与工具（变量类型、字符串正则、控制流分支循环、容器列表字典、函数参数解包、异常捕获等）
- dsa: 益智游戏数据（列表推导式、装饰器切面、生成器迭代器、垃圾回收内存管理、反射元编程等）
- organization: 街机游戏设计（类设计、面向对象继承多态MRO、魔术方法重载、描述符属性拦截、__slots__优化等）
- os: 实时动作并发（Pathlib文件IO、GIL锁原理、多线程并发、多进程并行、asyncio协程异步、concurrent并发池等）
- network: 联机对战服务（Socket通信、requests网络请求、FastAPI Web API、WSGI/ASGI、序列化反序列化、虚拟环境venv等）
- database: 数据与工程（SQLite嵌入数据库、SQLAlchemy ORM框架、pytest单元测试、NumPy/Pandas矩阵与数据处理等）
- general: 通用对话、闲聊、或非以上六大领域的问题

2. 教学风格（style）— 用户当前最适合哪种教学风格：
- humor: 基础概念入门、通俗理解、初次接触（例如："什么是装饰器" "讲讲Python的列表"）
- academic: 深度原理、底层机制、探究设计哲学（例如："GIL锁是怎么工作的" "CPython如何进行垃圾回收"）
- coach: 代码实现、实战工程应用、面试准备（例如："写一个FastAPI接口" "给我个装饰器限流代码"）
- general: 闲聊、问候、或不易判断

请只返回一个 JSON 对象：
{"domain": "programming", "style": "humor"}

不要包含其他文本。"""

        try:
            response = await client.chat.completions.create(
                model=effective_model,
                temperature=0.1,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": message[:500]},
                ],
            )
            content = response.choices[0].message.content.strip()
            if content.startswith("```json"):
                content = content[7:-3].strip()
            elif content.startswith("```"):
                content = content[3:-3].strip()

            result = json.loads(content)
            domain = result.get("domain", "general")
            style = result.get("style", "general")
            # 验证合法性
            if domain not in DOMAINS and domain != "general":
                domain = "general"
            if style not in STYLE_ROLE_MAP:
                style = "general"
            return domain, style
        except Exception as e:
            print(f"[Orchestrator] 领域+风格分类失败: {e}")
            return "general", "general"

    @staticmethod
    def _parse_llm_json(content: str) -> dict:
        """剥离 markdown 代码块包裹后解析 LLM 返回的 JSON"""
        text = (content or "").strip()
        if text.startswith("```json"):
            text = text[7:-3].strip()
        elif text.startswith("```"):
            text = text[3:-3].strip()
        return json.loads(text)

    async def _rewrite_and_split(
        self,
        message: str,
        history: list,
        api_key: str,
        model: str,
        base_url: Optional[str] = None,
    ) -> dict:
        """RAG 流水线阶段2：结合会话上下文改写查询 + 多意图拆分。

        - 改写：补全指代（"它"/"这个"）、省略语，使查询可独立检索
        - 拆分：一条消息包含多个问题时拆为最多 3 个子查询

        失败或无需改写时回退为原始查询。
        """
        fallback = {"rewritten_query": message, "sub_queries": [message]}

        # 无历史且消息极短（问候等）时跳过改写，省一次 LLM 往返
        if not history and len(message) <= 8:
            return fallback

        from openai import AsyncOpenAI

        effective_api_key = api_key or settings.DEEPSEEK_API_KEY
        effective_base_url = base_url or settings.DEEPSEEK_BASE_URL
        effective_model = model or settings.DEEPSEEK_MODEL

        if not effective_api_key:
            return fallback

        recent = [m for m in (history or []) if isinstance(m, dict)][-6:]
        history_text = "\n".join(
            f"{m.get('role', 'user')}: {str(m.get('content', ''))[:200]}"
            for m in recent
        )

        system_prompt = """你是查询改写助手。基于对话历史，将用户最新消息改写为可独立检索的查询：

1. 改写（rewritten_query）：补全指代词（它/这个/上面说的）和省略的主语，使查询脱离上下文也能被理解。若原查询已经完整，原样保留。
2. 拆分（sub_queries）：若消息包含多个独立问题，拆分为多个子查询（最多 3 个）；单一问题则列表只含改写后的查询本身。

只返回 JSON 对象，不要包含其他文本：
{"rewritten_query": "改写后的完整查询", "sub_queries": ["子查询1", "子查询2"]}"""

        user_prompt = ""
        if history_text:
            user_prompt += f"## 对话历史\n{history_text}\n\n"
        user_prompt += f"## 用户最新消息\n{message[:500]}"

        try:
            client = AsyncOpenAI(api_key=effective_api_key, base_url=effective_base_url)
            response = await client.chat.completions.create(
                model=effective_model,
                temperature=0.1,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
            result = self._parse_llm_json(response.choices[0].message.content)
            rewritten = result.get("rewritten_query") or message
            sub_queries = [
                q for q in result.get("sub_queries", []) if isinstance(q, str) and q.strip()
            ][:3]
            if not sub_queries:
                sub_queries = [rewritten]
            return {"rewritten_query": rewritten, "sub_queries": sub_queries}
        except Exception as e:
            print(f"[QueryRewriter] 改写失败，使用原始查询: {e}")
            return fallback

    async def _classify_intent_tree(
        self,
        message: str,
        api_key: str,
        model: str,
        base_url: Optional[str] = None,
    ) -> dict:
        """RAG 流水线阶段3+4：意图树分类 + 歧义判断（单次 LLM 调用）。

        意图树：
        - chitchat          闲聊问候，无需检索
        - knowledge_qa      知识问答（继续细分六大领域 domain + 教学风格 style）
        - practice_request  请求出题/练习
        - realtime_query    需要实时/外部信息（时事、版本发布等），提示联网搜索

        歧义判断：查询过于模糊无法有效检索时，给出反问引导（clarification）。
        """
        fallback = {
            "intent": "knowledge_qa",
            "domain": "general",
            "style": "general",
            "is_ambiguous": False,
            "clarification": "",
            "needs_web_search": False,
            "search_query": "",
        }

        from openai import AsyncOpenAI

        effective_api_key = api_key or settings.DEEPSEEK_API_KEY
        effective_base_url = base_url or settings.DEEPSEEK_BASE_URL
        effective_model = model or settings.DEEPSEEK_MODEL

        if not effective_api_key:
            return fallback

        system_prompt = """你是意图树分类器。分析用户查询，输出以下判断：

1. intent — 顶层意图：
- chitchat: 闲聊、问候、感谢等，无需知识检索
- knowledge_qa: 计算机知识问答（需要检索知识库）
- practice_request: 请求出题、练习、测验
- realtime_query: 需要实时或外部信息（新闻时事、最新版本、当前日期相关）

2. domain — 知识领域（intent 为 knowledge_qa/practice_request 时判断，否则填 general）：
- programming: 终端游戏与工具（变量类型、字符串正则、控制流分支循环、容器列表字典、函数参数解包、异常捕获等）
- dsa: 益智游戏数据（列表推导式、装饰器切面、生成器迭代器、垃圾回收内存管理、反射元编程等）
- organization: 街机游戏设计（类设计、面向对象继承多态MRO、魔术方法重载、描述符属性拦截、__slots__优化等）
- os: 实时动作并发（Pathlib文件IO、GIL锁原理、多线程并发、多进程并行、asyncio协程异步、concurrent并发池等）
- network: 联机对战服务（Socket通信、requests网络请求、FastAPI Web API、WSGI/ASGI、序列化反序列化、虚拟环境venv等）
- database: 数据与工程（SQLite嵌入数据库、SQLAlchemy ORM框架、pytest单元测试、NumPy/Pandas矩阵与数据处理等）
- general: 非以上六大领域

3. style — 教学风格：
- humor: 基础概念入门、通俗理解、初次接触
- academic: 深度原理、底层机制、探究设计哲学
- coach: 代码实现、实战工程应用、面试准备
- general: 闲聊或不易判断

4. is_ambiguous — 歧义判断：查询是否过于模糊、缺少关键信息导致无法有效回答（如"怎么优化"没说优化什么、"那个报错怎么办"没给报错内容）。闲聊不算歧义。
5. clarification — 若 is_ambiguous 为 true，给出一句友好的反问，引导用户补全信息（列出 2-3 个可能方向供选择）；否则为空字符串。
6. needs_web_search — 是否需要联网搜索外部实时信息。
7. search_query — 若需要联网搜索，给出精炼的搜索关键词；否则为空字符串。

只返回 JSON 对象，不要包含其他文本：
{"intent": "knowledge_qa", "domain": "dsa", "style": "academic", "is_ambiguous": false, "clarification": "", "needs_web_search": false, "search_query": ""}"""

        try:
            client = AsyncOpenAI(api_key=effective_api_key, base_url=effective_base_url)
            response = await client.chat.completions.create(
                model=effective_model,
                temperature=0.1,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": message[:500]},
                ],
            )
            result = self._parse_llm_json(response.choices[0].message.content)

            intent = result.get("intent", "knowledge_qa")
            if intent not in ("chitchat", "knowledge_qa", "practice_request", "realtime_query"):
                intent = "knowledge_qa"
            domain = result.get("domain", "general")
            if domain not in DOMAINS and domain != "general":
                domain = "general"
            style = result.get("style", "general")
            if style not in STYLE_ROLE_MAP:
                style = "general"

            return {
                "intent": intent,
                "domain": domain,
                "style": style,
                "is_ambiguous": bool(result.get("is_ambiguous", False)),
                "clarification": str(result.get("clarification", "") or ""),
                "needs_web_search": bool(result.get("needs_web_search", False)),
                "search_query": str(result.get("search_query", "") or ""),
            }
        except Exception as e:
            print(f"[IntentClassifier] 意图树分类失败: {e}")
            return fallback

    def route_to_agents(self, state: AgentState) -> str:
        """
        条件路由函数：根据分类领域和 use_rag 决定下一个节点

        - use_rag=False → 跳过 RAG，直接结束
        - use_rag=True + 六大知识领域 → rag_bot（领域过滤检索）
        - use_rag=True + general → rag_bot（无领域过滤，保底检索全部文档）
        """
        use_rag = state.get("use_rag", True)
        if not use_rag:
            return "reviewer"

        # use_rag=True 时，无论领域如何都进入 rag_bot
        # general 域时不做领域过滤（在 rag_bot_node 中处理）
        return "rag_bot"

    async def rag_bot_node(self, state: AgentState) -> dict:
        """
        RagBot 节点：执行领域过滤的混合检索，返回知识库上下文

        从 state 中读取 classified_domain，传入 rag_service 做领域过滤。
        检索结果存入 agent_results["rag"]。
        """
        from services.rag_service import rag_service

        user_message = state.get("user_message", "")
        api_key = state.get("api_key", "")
        base_url = state.get("base_url")
        session = state.get("session")
        user_id = state.get("user_id", "")
        domain = state.get("classified_domain", "general")

        # general 域不做领域过滤，检索全部文档（用户上传的非 Python 文档也能被召回）
        retrieval_domain = domain if domain in DOMAINS else None

        agent_results = state.get("agent_results", {})

        if not session:
            agent_results["rag"] = {"context": "", "error": "无数据库会话"}
            return {"agent_results": agent_results}

        try:
            rag_context = await rag_service.get_context_for_query(
                user_message,
                api_key,
                session,
                provider="openai",
                base_url=base_url,
                use_local=True,  # 固定使用本地 BGE-M3
                user_id=user_id,
                domain=retrieval_domain,
            )
            agent_results["rag"] = {"context": rag_context or "", "error": None}
            if not rag_context:
                print(f"[RagBot] 检索返回空上下文 (domain={retrieval_domain}, query={user_message[:50]})")
        except Exception as e:
            print(f"[RagBot] 检索失败: {type(e).__name__}: {e}")
            agent_results["rag"] = {"context": "", "error": str(e)}

        return {"agent_results": agent_results}

    async def _call_llm(
        self,
        system_prompt: str,
        user_message: str,
        api_key: str,
        model: str,
        base_url: Optional[str] = None,
    ) -> str:
        """
        调用 LLM 生成回复（非流式）

        供 Reviewer 节点使用的 LLM 调用辅助方法。
        """
        from openai import AsyncOpenAI

        effective_api_key = api_key or settings.DEEPSEEK_API_KEY
        effective_base_url = base_url or settings.DEEPSEEK_BASE_URL
        effective_model = model or settings.DEEPSEEK_MODEL

        if not effective_api_key:
            return ""

        client = AsyncOpenAI(api_key=effective_api_key, base_url=effective_base_url)

        try:
            response = await client.chat.completions.create(
                model=effective_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            print(f"[LLM] 调用失败: {e}")
            return ""

    async def reviewer_node(self, state: AgentState) -> dict:
        """
        Reviewer 节点：组合教学风格 + 领域知识 + RAG 上下文 + 认知状态，生成最终回答

        三段组合：
        - 风格 prompt（HOW）— 从 Agent 表查询，手动选择优先于自动分类
        - 领域 prompt（WHAT）— 从 DOMAINS 字典获取
        - 认知状态（针对谁）— 从用户知识状态表查询薄弱点和已掌握点
        """
        user_message = state.get("user_message", "")
        api_key = state.get("api_key", "")
        model = state.get("model", "")
        base_url = state.get("base_url")
        agent_results = state.get("agent_results", {})
        domain = state.get("classified_domain", "general")
        style = state.get("classified_style", "general")
        agent_id = state.get("agent_id")
        user_id = state.get("user_id", "")
        session = state.get("session")

        # 获取 RAG 上下文
        rag_context = ""
        if "rag" in agent_results:
            rag_context = agent_results["rag"].get("context", "")

        # 1. 确定教学风格 prompt（手动选择优先于自动分类）
        style_prompt = ""
        if agent_id and agent_id != "auto":
            style_prompt = await self._fetch_style_prompt(session, agent_id)
        elif style and style != "general":
            style_prompt = await self._fetch_style_prompt(session, style)

        # 2. 获取领域 prompt（WHAT）
        domain_info = DOMAINS.get(domain)
        domain_prompt = domain_info["mentor"] if domain_info else ""

        # 3. 组合 system_prompt：风格（HOW）+ 领域（WHAT）+ RAG 上下文
        parts = []
        if style_prompt:
            parts.append(style_prompt)
        if domain_prompt:
            parts.append(f"## 当前教学领域\n{domain_prompt}")
        else:
            # general 领域且无风格 prompt时的保底
            if not style_prompt:
                parts.append("你是一个友好的 AI 助手，请回答用户的问题。")
        if rag_context:
            parts.append(
                f"## 知识库参考资料\n{rag_context}\n\n"
                "请基于以上参考资料回答用户问题，并在回答中适当引用来源。"
                "如果参考资料中没有直接相关的内容，请基于你的专业知识回答。"
            )

        system_prompt = "\n\n".join(parts)

        # 4. 注入用户认知状态（针对谁）
        if user_id and session:
            system_prompt = await self._inject_cognitive_state(
                session, user_id, system_prompt
            )

        # 5. 调用 LLM 生成最终回答
        final_answer = await self._call_llm(
            system_prompt, user_message, api_key, model, base_url
        )

        return {
            "final_answer": final_answer or "抱歉，无法生成回答。",
        }

    async def _fetch_style_prompt(
        self, session: Any, agent_id: str
    ) -> str:
        """
        从 Agent 表查询风格导师的 system_prompt

        Args:
            session: 数据库会话
            agent_id: 可能是风格关键字（humor/academic/coach）或 UUID

        Returns:
            风格导师的 system_prompt，查询失败时返回空字符串
        """
        if not session:
            return ""

        from models.database import Agent
        from sqlalchemy import select

        try:
            # 风格关键字 → role_type 映射
            if agent_id in STYLE_ROLE_MAP and STYLE_ROLE_MAP[agent_id]:
                role_type = STYLE_ROLE_MAP[agent_id]
                stmt = select(Agent).where(
                    Agent.role_type == role_type,
                    Agent.is_active == 1,
                )
            else:
                # 尝试作为 UUID 查询
                from uuid import UUID
                stmt = select(Agent).where(
                    Agent.id == UUID(agent_id),
                    Agent.is_active == 1,
                )

            result = await session.execute(stmt)
            agent = result.scalars().first()
            if agent:
                return agent.system_prompt or ""
        except Exception as e:
            print(f"[Reviewer] 查询风格导师失败: {e}")

        return ""

    async def _inject_cognitive_state(
        self, session: Any, user_id: str, base_prompt: str
    ) -> str:
        """
        查询用户知识状态，将薄弱点与已掌握情况注入 system_prompt，实现个性化教学。

        逻辑与 agent_service.AgentService._inject_cognitive_state 保持一致，
        避免循环依赖而独立实现。
        """
        from uuid import UUID
        from sqlalchemy import select
        from models.database import KnowledgeNode, UserKnowledgeState

        try:
            uid = UUID(user_id)
        except (ValueError, AttributeError):
            return base_prompt

        # 关联查询用户的知识状态与节点
        stmt = (
            select(UserKnowledgeState, KnowledgeNode)
            .join(KnowledgeNode, UserKnowledgeState.node_id == KnowledgeNode.id)
            .where(UserKnowledgeState.user_id == uid)
        )
        result = await session.execute(stmt)
        rows = result.all()

        if not rows:
            return base_prompt  # 新用户无状态，用原始 prompt

        lighted_names: list[str] = []
        weak_names: list[str] = []
        for state_row, node in rows:
            if state_row.is_lighted:
                lighted_names.append(node.name)
            elif state_row.proficiency < 0.5:
                weak_names.append(node.name)

        cognitive = "\n\n## 当前学员知识掌握情况（个性化教学依据）\n"
        cognitive += f"- 已点亮（已掌握）知识点: {len(lighted_names)} 个"
        if lighted_names:
            cognitive += f"（{', '.join(lighted_names[:8])}）"
        cognitive += "\n"
        cognitive += f"- 薄弱知识点: {len(weak_names)} 个"
        if weak_names:
            cognitive += f"（{', '.join(weak_names[:8])}）"
        cognitive += (
            "\n\n## 个性化教学策略\n"
            "- 针对薄弱知识点：多结合实际案例，深入剖析核心设计与易错细节，放慢讲解节奏并鼓励提问\n"
            "- 针对已掌握的概念：减少赘述，引导探讨底层性能优化或更高级的进阶用法\n"
            "- 在讲解新模块时，适时与已掌握或薄弱的知识点进行横向关联，帮助构建完整的技能网络"
        )

        return base_prompt + cognitive

    async def _build_reviewer_prompt(
        self,
        state: AgentState,
        domain: str,
        style: str,
        rag_context: str,
        memory_context: str = "",
        tool_context: str = "",
    ) -> str:
        """
        组装最终回答的 system_prompt（RAG 流水线阶段6『Prompt 组装』）。

        组合顺序：
        1. 风格 prompt（HOW）— 从 Agent 表查询，手动选择优先于自动分类
        2. 领域 prompt（WHAT）— 从 DOMAINS 字典获取
        3. 用户长期记忆 — 流水线阶段1加载
        4. RAG 上下文 — 知识库检索通道结果
        5. 工具检索结果 — 联网搜索等工具通道结果
        6. 认知状态（针对谁）— 查询用户知识状态
        """
        agent_id = state.get("agent_id")
        user_id = state.get("user_id", "")
        session = state.get("session")

        # 1. 确定教学风格 prompt（手动选择优先于自动分类）
        style_prompt = ""
        if agent_id and agent_id != "auto":
            style_prompt = await self._fetch_style_prompt(session, agent_id)
        elif style and style != "general":
            style_prompt = await self._fetch_style_prompt(session, style)

        # 2. 获取领域 prompt（WHAT）
        domain_info = DOMAINS.get(domain)
        domain_prompt = domain_info["mentor"] if domain_info else ""

        # 3. 组合 system_prompt
        parts: list[str] = []
        if style_prompt:
            parts.append(style_prompt)
        if domain_prompt:
            parts.append(f"## 当前教学领域\n{domain_prompt}")
        else:
            if not style_prompt:
                parts.append("你是一个友好的 AI 助手，请回答用户的问题。")
        if memory_context:
            parts.append(f"## 用户长期记忆\n{memory_context}")
        if rag_context:
            parts.append(
                f"## 知识库参考资料\n{rag_context}\n\n"
                "请基于以上参考资料回答用户问题，并在回答中适当引用来源。"
                "如果参考资料中没有直接相关的内容，请基于你的专业知识回答。"
            )
        if tool_context:
            parts.append(
                f"## 联网检索结果\n{tool_context}\n\n"
                "以上为实时联网搜索结果，回答涉及时效性信息时请优先参考。"
            )

        system_prompt = "\n\n".join(parts)

        # 4. 注入用户认知状态
        if user_id and session:
            system_prompt = await self._inject_cognitive_state(
                session, user_id, system_prompt
            )

        return system_prompt

    def _build_workflow(self):
        """
        构建 LangGraph StateGraph 工作流。

        图拓扑（图内仅负责意图分类 + 检索，回答生成在图外真流式执行）：
        Orchestrator → (条件路由) → RagBot → END
                       或
                     END（general 领域直接结束，跳过检索）

        Returns:
            编译后的 LangGraph 可执行 app
        """
        workflow = StateGraph(AgentState)

        workflow.add_node("orchestrator", self.orchestrator_node)
        workflow.add_node("rag_bot", self.rag_bot_node)

        workflow.set_entry_point("orchestrator")

        # 条件路由：六大领域 → rag_bot，general → END
        workflow.add_conditional_edges(
            "orchestrator",
            self.route_to_agents,
            {
                "rag_bot": "rag_bot",
                "reviewer": END,
            },
        )

        workflow.add_edge("rag_bot", END)

        return workflow.compile()

    async def run(self, state: AgentState) -> AgentState:
        """
        执行多 Agent 协同工作流

        Args:
            state: 初始状态（包含 user_message, api_key, model 等）

        Returns:
            最终状态（包含 final_answer）
        """
        if self._app is None:
            self._app = self._build_workflow()
        result = await self._app.ainvoke(state)
        return result

    # RAG 流水线节点标签（与前端 workflow-panel 展示对应）
    PIPELINE_LABELS = {
        "memory_loader": "会话记忆加载",
        "query_rewriter": "Query 改写与拆分",
        "intent_classifier": "意图识别与分类",
        "ambiguity_gate": "歧义引导判断",
        "rag_bot": "知识库向量检索",
        "tool_call": "工具检索",
        "reviewer": "Prompt 组装与生成",
    }

    def _status_event(
        self,
        node: str,
        status: str,
        message: Optional[str] = None,
        data: Optional[dict] = None,
    ) -> dict:
        event = {
            "type": "status",
            "node": node,
            "label": self.PIPELINE_LABELS.get(node, node),
            "status": status,
        }
        if message:
            event["message"] = message
        if data is not None:
            event["data"] = data
        return event

    async def run_stream(self, state: AgentState):
        """
        流式执行 RAG 六阶段流水线，yield 事件字典。

        阶段：
        1. 会话记忆加载 — 对话历史（调用方已加载）+ 用户长期记忆检索
        2. Query 改写与拆分 — LLM 补全指代/省略，多意图拆分子查询
        3. 意图识别与分类 — 意图树（顶层意图 → 六大领域 + 教学风格）
        4. 歧义引导判断 — 查询过于模糊时反问引导，跳过检索与生成
        5. 多通道并行检索 — 知识库混合检索（多子查询）+ 工具通道（联网搜索）并行
        6. Prompt 组装与流式生成 — 风格/领域/记忆/检索结果组装后真流式输出

        事件类型：
        - status: {type, node, label, status, message?, data?}
        - content: {type, text}  — 逐字实时输出
        - done: {type}
        """
        import asyncio

        from services.llm_service import llm_service
        from services.memory_service import memory_service
        from services.rag_service import rag_service
        from services.tools_service import tools_service

        user_message = state.get("user_message", "")
        api_key = state.get("api_key", "")
        model = state.get("model", "")
        base_url = state.get("base_url")
        session = state.get("session")
        user_id = state.get("user_id", "")
        history = state.get("messages", [])
        use_memory = state.get("use_memory", False)
        use_tools = state.get("use_tools", False)
        use_rag = state.get("use_rag", True)

        # ── 阶段 1：会话记忆加载 ──
        yield self._status_event("memory_loader", "running", "正在加载会话记忆...")
        memory_context = ""
        if use_memory and session:
            try:
                memory_context = await memory_service.get_memory_context(
                    user_message, api_key, session,
                    base_url=base_url, use_local=True, user_id=user_id,
                ) or ""
            except Exception as e:
                print(f"[MemoryLoader] 记忆加载失败: {type(e).__name__}: {e}")
        yield self._status_event(
            "memory_loader", "done",
            data={
                "history_messages": len(history or []),
                "has_long_term_memory": bool(memory_context),
            },
        )

        # ── 阶段 2：Query 改写与拆分 ──
        yield self._status_event("query_rewriter", "running", "正在改写与拆分查询...")
        rewrite = await self._rewrite_and_split(
            user_message, history, api_key, model, base_url
        )
        rewritten_query = rewrite["rewritten_query"]
        sub_queries = rewrite["sub_queries"]
        yield self._status_event(
            "query_rewriter", "done",
            data={"rewritten_query": rewritten_query, "sub_queries": sub_queries},
        )

        # ── 阶段 3：意图识别与分类（意图树）──
        yield self._status_event("intent_classifier", "running", "正在识别意图与领域...")
        intent_info = await self._classify_intent_tree(
            rewritten_query, api_key, model, base_url
        )
        intent = intent_info["intent"]
        domain = intent_info["domain"]
        style = intent_info["style"]
        yield self._status_event(
            "intent_classifier", "done",
            data={
                "intent": intent,
                "domain": domain,
                "domain_zh": DOMAINS.get(domain, {}).get("zh", "通用"),
                "style": style,
                "style_zh": STYLE_ZH_MAP.get(style, "通用"),
            },
        )

        # ── 阶段 4：歧义引导判断 ──
        yield self._status_event("ambiguity_gate", "running", "正在判断查询是否明确...")
        is_ambiguous = bool(
            intent_info.get("is_ambiguous") and intent_info.get("clarification")
        )
        yield self._status_event(
            "ambiguity_gate", "done", data={"is_ambiguous": is_ambiguous},
        )
        if is_ambiguous:
            # 歧义时不检索不生成，反问引导用户补全信息
            yield {"type": "content", "text": intent_info["clarification"]}
            yield {"type": "done"}
            return

        # ── 阶段 5：多通道并行检索 ──
        rag_context = ""
        rag_sources: list = []
        tool_context = ""
        should_rag = bool(use_rag and session and intent != "chitchat")
        should_tool = bool(use_tools and intent_info.get("needs_web_search"))

        if should_rag:
            domain_zh = DOMAINS.get(domain, {}).get("zh", "全部")
            yield self._status_event(
                "rag_bot", "running", f"正在并行检索{domain_zh}知识库..."
            )
        if should_tool:
            yield self._status_event("tool_call", "running", "正在联网搜索...")

        if should_rag or should_tool:
            retrieval_domain = domain if domain in DOMAINS else None

            async def _rag_channel() -> dict:
                try:
                    return await rag_service.get_context_and_sources_for_queries(
                        sub_queries or [rewritten_query],
                        api_key,
                        session,
                        base_url=base_url,
                        use_local=True,
                        user_id=user_id,
                        domain=retrieval_domain,
                    ) or {"context": "", "sources": []}
                except Exception as e:
                    print(f"[RagChannel] 检索失败: {type(e).__name__}: {e}")
                    return {"context": "", "sources": []}

            async def _tool_channel() -> str:
                try:
                    query = intent_info.get("search_query") or rewritten_query
                    return await tools_service.execute_tool(
                        "web_search", {"query": query}
                    ) or ""
                except Exception as e:
                    print(f"[ToolChannel] 工具调用失败: {type(e).__name__}: {e}")
                    return ""

            tasks = []
            if should_rag:
                tasks.append(_rag_channel())
            if should_tool:
                tasks.append(_tool_channel())
            results = await asyncio.gather(*tasks)

            idx = 0
            if should_rag:
                rag_result = results[idx] or {}
                rag_context = rag_result.get("context", "")
                rag_sources = rag_result.get("sources", [])
                idx += 1
                yield self._status_event(
                    "rag_bot", "done",
                    data={
                        "sub_query_count": len(sub_queries),
                        "context_chars": len(rag_context),
                        "hit": bool(rag_context),
                        "sources": rag_sources,
                    },
                )
            if should_tool:
                tool_context = results[idx]
                yield self._status_event(
                    "tool_call", "done",
                    data={"hit": bool(tool_context)},
                )

        # ── 阶段 6：Prompt 组装与流式生成 ──
        yield self._status_event("reviewer", "running", "正在组装上下文并生成回答...")
        system_prompt = await self._build_reviewer_prompt(
            state, domain, style, rag_context,
            memory_context=memory_context, tool_context=tool_context,
        )

        async for text_chunk in llm_service.stream_chat(
            message=user_message,
            api_key=api_key,
            model=model,
            use_rag=False,
            use_memory=False,  # 记忆已在阶段1加载并注入 system_prompt，避免重复检索
            use_tools=use_tools,
            base_url=base_url,
            session=session,
            history=history,
            user_id=user_id,
            system_prompt=system_prompt,
        ):
            yield {"type": "content", "text": text_chunk}

        yield self._status_event("reviewer", "done")
        yield {"type": "done"}


# 全局实例
graph_service = GraphService()
