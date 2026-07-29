"""
graph_service 测试 — 六大知识领域意图分析 + RAG 检索工作流
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from services.graph_service import AgentState, GraphService, graph_service, DOMAINS, STYLE_ROLE_MAP, STYLE_ZH_MAP


class TestGraphServiceBasic:
    """graph_service 基础结构测试"""

    def test_module_import(self):
        """测试：模块可正常导入"""
        from services import graph_service as gs_module
        assert gs_module is not None

    def test_agent_state_fields(self):
        """测试：AgentState 包含所有必需字段"""
        annotations = AgentState.__annotations__

        expected_fields = [
            "messages", "user_id", "sub_tasks", "classified_domain",
            "classified_style", "agent_id",
            "agent_results", "final_answer",
            "api_key", "model", "base_url",
            "session", "user_message",
        ]
        for field in expected_fields:
            assert field in annotations, f"AgentState 缺少字段: {field}"

    def test_domains_defined(self):
        """测试：六大领域已定义"""
        assert len(DOMAINS) == 6
        for key, val in DOMAINS.items():
            assert "zh" in val
            assert "mentor" in val

    def test_style_maps_defined(self):
        """测试：教学风格映射已定义"""
        assert len(STYLE_ROLE_MAP) == 4
        assert len(STYLE_ZH_MAP) == 4
        assert STYLE_ROLE_MAP["humor"] == "humor_mentor"
        assert STYLE_ROLE_MAP["academic"] == "academic_mentor"
        assert STYLE_ROLE_MAP["coach"] == "coach_mentor"
        assert STYLE_ROLE_MAP["general"] is None

    def test_graph_service_instance(self):
        """测试：GraphService 可实例化"""
        service = GraphService()
        assert service is not None
        assert service._app is None

    def test_global_instance(self):
        """测试：全局实例 graph_service 存在"""
        assert graph_service is not None
        assert isinstance(graph_service, GraphService)


class TestOrchestratorNode:
    """Orchestrator 意图分类节点测试"""

    @pytest.fixture
    def service(self):
        return GraphService()

    @pytest.mark.asyncio
    async def test_classify_dsa(self, service):
        """测试：数据结构问题分类为 dsa"""
        mock_response = MagicMock()
        mock_response.choices[0].message.content = '{"domain": "dsa", "style": "academic"}'

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("openai.AsyncOpenAI", return_value=mock_client):
            state: AgentState = {
                "user_message": "什么是栈的后进先出？",
                "api_key": "test-key",
                "model": "test-model",
                "base_url": "http://test",
            }
            result = await service.orchestrator_node(state)

        assert result["classified_domain"] == "dsa"
        assert result["classified_style"] == "academic"
        assert len(result["sub_tasks"]) == 1
        assert result["sub_tasks"][0]["domain"] == "dsa"
        assert result["sub_tasks"][0]["style"] == "academic"

    @pytest.mark.asyncio
    async def test_classify_os(self, service):
        """测试：操作系统问题分类为 os"""
        mock_response = MagicMock()
        mock_response.choices[0].message.content = '{"domain": "os"}'

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("openai.AsyncOpenAI", return_value=mock_client):
            state: AgentState = {
                "user_message": "进程和线程的区别是什么？",
                "api_key": "test-key",
                "model": "test-model",
                "base_url": "http://test",
            }
            result = await service.orchestrator_node(state)

        assert result["classified_domain"] == "os"

    @pytest.mark.asyncio
    async def test_classify_general(self, service):
        """测试：通用问题分类为 general"""
        mock_response = MagicMock()
        mock_response.choices[0].message.content = '{"domain": "general"}'

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("openai.AsyncOpenAI", return_value=mock_client):
            state: AgentState = {
                "user_message": "今天天气怎么样？",
                "api_key": "test-key",
                "model": "test-model",
                "base_url": "http://test",
            }
            result = await service.orchestrator_node(state)

        assert result["classified_domain"] == "general"

    @pytest.mark.asyncio
    async def test_no_api_key_fallback(self, service):
        """测试：无 API Key 时回退到 general"""
        state: AgentState = {
            "user_message": "你好",
            "api_key": "",
            "model": "",
            "base_url": None,
        }
        result = await service.orchestrator_node(state)

        assert result["classified_domain"] == "general"
        assert result["classified_style"] == "general"

    @pytest.mark.asyncio
    async def test_llm_error_fallback(self, service):
        """测试：LLM 调用失败时回退到 general"""
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("API Error"),
        )

        with patch("openai.AsyncOpenAI", return_value=mock_client):
            state: AgentState = {
                "user_message": "问题",
                "api_key": "test-key",
                "model": "test-model",
                "base_url": "http://test",
            }
            result = await service.orchestrator_node(state)

        assert result["classified_domain"] == "general"
        assert result["classified_style"] == "general"

    @pytest.mark.asyncio
    async def test_invalid_domain_fallback(self, service):
        """测试：LLM 返回无效领域时回退到 general"""
        mock_response = MagicMock()
        mock_response.choices[0].message.content = '{"domain": "invalid_domain"}'

        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        with patch("openai.AsyncOpenAI", return_value=mock_client):
            state: AgentState = {
                "user_message": "问题",
                "api_key": "test-key",
                "model": "test-model",
                "base_url": "http://test",
            }
            result = await service.orchestrator_node(state)

        assert result["classified_domain"] == "general"
        assert result["classified_style"] == "general"


class TestRouteToAgents:
    """条件路由函数测试"""

    @pytest.fixture
    def service(self):
        return GraphService()

    def test_route_dsa_to_rag_bot(self, service):
        """测试：dsa 领域路由到 rag_bot"""
        state: AgentState = {"classified_domain": "dsa"}
        assert service.route_to_agents(state) == "rag_bot"

    def test_route_programming_to_rag_bot(self, service):
        """测试：programming 领域路由到 rag_bot"""
        state: AgentState = {"classified_domain": "programming"}
        assert service.route_to_agents(state) == "rag_bot"

    def test_route_network_to_rag_bot(self, service):
        """测试：network 领域路由到 rag_bot"""
        state: AgentState = {"classified_domain": "network"}
        assert service.route_to_agents(state) == "rag_bot"

    def test_route_general_to_rag_bot_fallback(self, service):
        """测试：general 领域在 use_rag=True 时也进入 rag_bot（无领域过滤保底检索）"""
        state: AgentState = {"classified_domain": "general"}
        assert service.route_to_agents(state) == "rag_bot"

    def test_route_use_rag_false_to_reviewer(self, service):
        """测试：use_rag=False 时跳过检索直接路由到 reviewer"""
        state: AgentState = {"classified_domain": "general", "use_rag": False}
        assert service.route_to_agents(state) == "reviewer"

    def test_route_all_six_domains(self, service):
        """测试：六大领域全部路由到 rag_bot"""
        for domain in DOMAINS:
            state: AgentState = {"classified_domain": domain}
            assert service.route_to_agents(state) == "rag_bot"


class TestRagBotNode:
    """RagBot 检索节点测试"""

    @pytest.fixture
    def service(self):
        return GraphService()

    @pytest.mark.asyncio
    async def test_normal_retrieval(self, service):
        """测试：正常检索返回知识库上下文"""
        mock_rag = MagicMock()
        mock_rag.get_context_for_query = AsyncMock(
            return_value="知识库检索到的内容",
        )

        with patch("services.rag_service.rag_service", mock_rag):
            state: AgentState = {
                "user_message": "什么是栈？",
                "api_key": "test-key",
                "base_url": "http://test",
                "session": MagicMock(),
                "user_id": "user-123",
            }
            result = await service.rag_bot_node(state)

        assert "agent_results" in result
        assert result["agent_results"]["rag"]["context"] == "知识库检索到的内容"
        assert result["agent_results"]["rag"]["error"] is None

    @pytest.mark.asyncio
    async def test_no_session(self, service):
        """测试：无数据库会话返回错误信息"""
        state: AgentState = {
            "user_message": "问题",
            "api_key": "test-key",
            "session": None,
        }
        result = await service.rag_bot_node(state)

        assert result["agent_results"]["rag"]["context"] == ""
        assert "无数据库会话" in result["agent_results"]["rag"]["error"]

    @pytest.mark.asyncio
    async def test_retrieval_error(self, service):
        """测试：检索异常返回错误信息"""
        mock_rag = MagicMock()
        mock_rag.get_context_for_query = AsyncMock(
            side_effect=Exception("DB Error"),
        )

        with patch("services.rag_service.rag_service", mock_rag):
            state: AgentState = {
                "user_message": "问题",
                "api_key": "test-key",
                "session": MagicMock(),
                "user_id": "user-123",
            }
            result = await service.rag_bot_node(state)

        assert result["agent_results"]["rag"]["context"] == ""
        assert "DB Error" in result["agent_results"]["rag"]["error"]

    @pytest.mark.asyncio
    async def test_empty_context(self, service):
        """测试：检索返回空上下文时正常处理"""
        mock_rag = MagicMock()
        mock_rag.get_context_for_query = AsyncMock(return_value=None)

        with patch("services.rag_service.rag_service", mock_rag):
            state: AgentState = {
                "user_message": "无关问题",
                "api_key": "test-key",
                "session": MagicMock(),
                "user_id": "user-123",
            }
            result = await service.rag_bot_node(state)

        assert result["agent_results"]["rag"]["context"] == ""
        assert result["agent_results"]["rag"]["error"] is None


class TestReviewerNode:
    """Reviewer 节点测试"""

    @pytest.fixture
    def service(self):
        return GraphService()

    @pytest.mark.asyncio
    async def test_domain_answer_with_rag(self, service):
        """测试：六大领域问题使用领域导师风格 + RAG 上下文"""
        with patch.object(
            service, "_call_llm", new_callable=AsyncMock,
            return_value="数据结构回答",
        ) as mock_llm:
            state: AgentState = {
                "user_message": "什么是栈？",
                "api_key": "test-key",
                "model": "test-model",
                "classified_domain": "dsa",
                "agent_results": {
                    "rag": {"context": "栈是后进先出的数据结构", "error": None},
                },
            }
            result = await service.reviewer_node(state)

        assert result["final_answer"] == "数据结构回答"
        # 验证 system_prompt 包含领域导师风格
        call_args = mock_llm.call_args
        system_prompt = call_args[0][0]
        assert "益智游戏数据" in system_prompt
        # 验证 RAG 上下文已注入
        assert "栈是后进先出" in system_prompt
        assert "知识库参考资料" in system_prompt

    @pytest.mark.asyncio
    async def test_general_answer(self, service):
        """测试：通用问题不注入 RAG 上下文"""
        with patch.object(
            service, "_call_llm", new_callable=AsyncMock,
            return_value="通用回答",
        ) as mock_llm:
            state: AgentState = {
                "user_message": "你好",
                "api_key": "test-key",
                "model": "test-model",
                "classified_domain": "general",
                "agent_results": {},
            }
            result = await service.reviewer_node(state)

        assert result["final_answer"] == "通用回答"
        # 验证 system_prompt 是通用助手
        call_args = mock_llm.call_args
        system_prompt = call_args[0][0]
        assert "AI 助手" in system_prompt
        assert "知识库参考资料" not in system_prompt

    @pytest.mark.asyncio
    async def test_domain_without_rag_context(self, service):
        """测试：六大领域但无 RAG 上下文时仍使用领域导师风格"""
        with patch.object(
            service, "_call_llm", new_callable=AsyncMock,
            return_value="回答",
        ) as mock_llm:
            state: AgentState = {
                "user_message": "什么是进程？",
                "api_key": "test-key",
                "model": "test-model",
                "classified_domain": "os",
                "agent_results": {
                    "rag": {"context": "", "error": None},
                },
            }
            result = await service.reviewer_node(state)

        assert result["final_answer"] == "回答"
        call_args = mock_llm.call_args
        system_prompt = call_args[0][0]
        assert "并发与系统编程" in system_prompt
        assert "知识库参考资料" not in system_prompt

    @pytest.mark.asyncio
    async def test_empty_llm_response(self, service):
        """测试：LLM 返回空内容时返回默认回答"""
        with patch.object(
            service, "_call_llm", new_callable=AsyncMock,
            return_value="",
        ):
            state: AgentState = {
                "user_message": "问题",
                "api_key": "test-key",
                "model": "test-model",
                "classified_domain": "dsa",
                "agent_results": {},
            }
            result = await service.reviewer_node(state)

        assert "抱歉" in result["final_answer"]


class TestBuildWorkflow:
    """StateGraph 工作流构建与集成测试"""

    def test_workflow_compiles(self):
        """测试：工作流可以正常编译"""
        service = GraphService()
        app = service._build_workflow()
        assert app is not None

    @pytest.mark.asyncio
    async def test_rag_path_execution(self):
        """测试：use_rag=True 路径完整执行（orchestrator → rag_bot → END）"""
        service = GraphService()

        with patch.object(
            service, "orchestrator_node", new_callable=AsyncMock,
        ) as mock_orc, patch.object(
            service, "rag_bot_node", new_callable=AsyncMock,
        ) as mock_rag:
            mock_orc.return_value = {
                "sub_tasks": [{"domain": "dsa", "task": "test"}],
                "classified_domain": "dsa",
            }
            mock_rag.return_value = {
                "agent_results": {"rag": {"context": "RAG content", "error": None}},
            }

            app = service._build_workflow()
            state: AgentState = {
                "user_message": "什么是栈？",
                "api_key": "test-key",
                "model": "test-model",
                "use_rag": True,
            }
            result = await app.ainvoke(state)

        mock_orc.assert_called_once()
        mock_rag.assert_called_once()
        assert result["agent_results"]["rag"]["context"] == "RAG content"

    @pytest.mark.asyncio
    async def test_no_rag_path_execution(self):
        """测试：use_rag=False 路径跳过检索（orchestrator → END）"""
        service = GraphService()

        with patch.object(
            service, "orchestrator_node", new_callable=AsyncMock,
        ) as mock_orc, patch.object(
            service, "rag_bot_node", new_callable=AsyncMock,
        ) as mock_rag:
            mock_orc.return_value = {
                "sub_tasks": [{"domain": "general", "task": "你好"}],
                "classified_domain": "general",
            }

            app = service._build_workflow()
            state: AgentState = {
                "user_message": "你好",
                "api_key": "test-key",
                "model": "test-model",
                "use_rag": False,
            }
            result = await app.ainvoke(state)

        mock_orc.assert_called_once()
        # use_rag=False 不经过 rag_bot
        mock_rag.assert_not_called()
        assert result.get("classified_domain") == "general"


def _fake_llm_stream(*chunks):
    """构造可替换 llm_service.stream_chat 的异步生成器工厂"""
    def _factory(*args, **kwargs):
        async def _gen():
            for c in chunks:
                yield c
        return _gen()
    return _factory


def _intent(**overrides) -> dict:
    """意图树分类结果模板"""
    result = {
        "intent": "knowledge_qa",
        "domain": "dsa",
        "style": "academic",
        "is_ambiguous": False,
        "clarification": "",
        "needs_web_search": False,
        "search_query": "",
    }
    result.update(overrides)
    return result


class TestRunStream:
    """run_stream() RAG 六阶段流水线测试"""

    @pytest.fixture
    def service(self):
        return GraphService()

    def _base_state(self, **overrides) -> AgentState:
        state: AgentState = {
            "user_message": "什么是生成器？",
            "api_key": "test-key",
            "model": "test-model",
            "base_url": "http://test",
            "session": MagicMock(),
            "user_id": "user-123",
            "messages": [],
            "use_rag": True,
            "use_memory": False,
            "use_tools": False,
        }
        state.update(overrides)
        return state

    async def _collect(self, service, state):
        events = []
        async for event in service.run_stream(state):
            events.append(event)
        return events

    @pytest.mark.asyncio
    async def test_full_pipeline_events(self, service):
        """知识问答：六阶段全部执行，status 事件按阶段顺序出现"""
        from services.llm_service import llm_service
        from services.rag_service import rag_service

        with patch.object(
            service, "_rewrite_and_split", new_callable=AsyncMock,
            return_value={"rewritten_query": "Python 生成器是什么", "sub_queries": ["Python 生成器是什么"]},
        ), patch.object(
            service, "_classify_intent_tree", new_callable=AsyncMock,
            return_value=_intent(),
        ), patch.object(
            service, "_build_reviewer_prompt", new_callable=AsyncMock,
            return_value="SYSTEM",
        ), patch.object(
            rag_service, "get_context_and_sources_for_queries", new_callable=AsyncMock,
            return_value={
                "context": "知识库上下文",
                "sources": [{
                    "document_id": "doc-1", "title": "Python 教程",
                    "page_number": 42, "chunk_id": "chunk-1",
                }],
            },
        ), patch.object(
            llm_service, "stream_chat", new=_fake_llm_stream("最终", "回答"),
        ):
            events = await self._collect(service, self._base_state())

        node_seq = [(e["node"], e["status"]) for e in events if e["type"] == "status"]
        assert node_seq == [
            ("memory_loader", "running"), ("memory_loader", "done"),
            ("query_rewriter", "running"), ("query_rewriter", "done"),
            ("intent_classifier", "running"), ("intent_classifier", "done"),
            ("ambiguity_gate", "running"), ("ambiguity_gate", "done"),
            ("rag_bot", "running"), ("rag_bot", "done"),
            ("reviewer", "running"), ("reviewer", "done"),
        ]
        contents = [e["text"] for e in events if e["type"] == "content"]
        assert "".join(contents) == "最终回答"
        assert events[-1]["type"] == "done"
        # T3 溯源：rag_bot done 事件携带结构化来源列表
        rag_done = next(
            e for e in events
            if e["type"] == "status" and e["node"] == "rag_bot" and e["status"] == "done"
        )
        assert rag_done["data"]["sources"][0]["title"] == "Python 教程"
        assert rag_done["data"]["sources"][0]["page_number"] == 42

    @pytest.mark.asyncio
    async def test_ambiguous_query_short_circuits(self, service):
        """歧义查询：反问引导用户，不检索不生成"""
        from services.rag_service import rag_service

        clarification = "你想优化什么？代码性能、数据库查询还是页面加载速度？"
        rag_mock = AsyncMock()
        with patch.object(
            service, "_rewrite_and_split", new_callable=AsyncMock,
            return_value={"rewritten_query": "怎么优化", "sub_queries": ["怎么优化"]},
        ), patch.object(
            service, "_classify_intent_tree", new_callable=AsyncMock,
            return_value=_intent(
                domain="general", style="general",
                is_ambiguous=True, clarification=clarification,
            ),
        ), patch.object(rag_service, "get_context_and_sources_for_queries", rag_mock):
            events = await self._collect(
                service, self._base_state(user_message="怎么优化")
            )

        contents = [e["text"] for e in events if e["type"] == "content"]
        assert contents == [clarification]
        nodes = [e.get("node") for e in events if e["type"] == "status"]
        assert "rag_bot" not in nodes
        assert "reviewer" not in nodes
        rag_mock.assert_not_called()
        assert events[-1]["type"] == "done"

    @pytest.mark.asyncio
    async def test_chitchat_skips_retrieval(self, service):
        """闲聊意图：跳过知识库检索直接生成"""
        from services.llm_service import llm_service
        from services.rag_service import rag_service

        rag_mock = AsyncMock()
        with patch.object(
            service, "_rewrite_and_split", new_callable=AsyncMock,
            return_value={"rewritten_query": "你好", "sub_queries": ["你好"]},
        ), patch.object(
            service, "_classify_intent_tree", new_callable=AsyncMock,
            return_value=_intent(intent="chitchat", domain="general", style="general"),
        ), patch.object(
            service, "_build_reviewer_prompt", new_callable=AsyncMock,
            return_value="SYSTEM",
        ), patch.object(
            rag_service, "get_context_and_sources_for_queries", rag_mock,
        ), patch.object(
            llm_service, "stream_chat", new=_fake_llm_stream("你好！"),
        ):
            events = await self._collect(
                service, self._base_state(user_message="你好")
            )

        nodes = [e.get("node") for e in events if e["type"] == "status"]
        assert "rag_bot" not in nodes
        assert "reviewer" in nodes
        rag_mock.assert_not_called()
        contents = [e["text"] for e in events if e["type"] == "content"]
        assert "".join(contents) == "你好！"

    @pytest.mark.asyncio
    async def test_web_search_channel_runs_parallel(self, service):
        """realtime_query + use_tools：工具通道与知识库通道并行执行并注入 Prompt"""
        from services.llm_service import llm_service
        from services.rag_service import rag_service
        from services.tools_service import tools_service

        with patch.object(
            service, "_rewrite_and_split", new_callable=AsyncMock,
            return_value={"rewritten_query": "Python 3.13 新特性", "sub_queries": ["Python 3.13 新特性"]},
        ), patch.object(
            service, "_classify_intent_tree", new_callable=AsyncMock,
            return_value=_intent(
                intent="realtime_query", domain="programming", style="coach",
                needs_web_search=True, search_query="Python 3.13 release notes",
            ),
        ), patch.object(
            service, "_build_reviewer_prompt", new_callable=AsyncMock,
            return_value="SYSTEM",
        ) as mock_prompt, patch.object(
            rag_service, "get_context_and_sources_for_queries", new_callable=AsyncMock,
            return_value={"context": "知识库上下文", "sources": []},
        ), patch.object(
            tools_service, "execute_tool", new_callable=AsyncMock,
            return_value="搜索结果摘要",
        ) as mock_tool, patch.object(
            llm_service, "stream_chat", new=_fake_llm_stream("回答"),
        ):
            events = await self._collect(
                service, self._base_state(use_tools=True)
            )

        nodes = [e.get("node") for e in events if e["type"] == "status"]
        assert "rag_bot" in nodes
        assert "tool_call" in nodes
        mock_tool.assert_awaited_once_with(
            "web_search", {"query": "Python 3.13 release notes"}
        )
        prompt_kwargs = mock_prompt.call_args.kwargs
        assert prompt_kwargs["tool_context"] == "搜索结果摘要"

    @pytest.mark.asyncio
    async def test_use_rag_false_skips_rag(self, service):
        """use_rag=False：不执行知识库检索"""
        from services.llm_service import llm_service
        from services.rag_service import rag_service

        rag_mock = AsyncMock()
        with patch.object(
            service, "_rewrite_and_split", new_callable=AsyncMock,
            return_value={"rewritten_query": "什么是栈", "sub_queries": ["什么是栈"]},
        ), patch.object(
            service, "_classify_intent_tree", new_callable=AsyncMock,
            return_value=_intent(),
        ), patch.object(
            service, "_build_reviewer_prompt", new_callable=AsyncMock,
            return_value="SYSTEM",
        ), patch.object(
            rag_service, "get_context_and_sources_for_queries", rag_mock,
        ), patch.object(
            llm_service, "stream_chat", new=_fake_llm_stream("回答"),
        ):
            events = await self._collect(
                service, self._base_state(use_rag=False)
            )

        nodes = [e.get("node") for e in events if e["type"] == "status"]
        assert "rag_bot" not in nodes
        rag_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_pipeline_labels_zh(self, service):
        """事件包含中文阶段标签"""
        from services.llm_service import llm_service
        from services.rag_service import rag_service

        with patch.object(
            service, "_rewrite_and_split", new_callable=AsyncMock,
            return_value={"rewritten_query": "q", "sub_queries": ["q"]},
        ), patch.object(
            service, "_classify_intent_tree", new_callable=AsyncMock,
            return_value=_intent(),
        ), patch.object(
            service, "_build_reviewer_prompt", new_callable=AsyncMock,
            return_value="SYSTEM",
        ), patch.object(
            rag_service, "get_context_and_sources_for_queries", new_callable=AsyncMock,
            return_value={"context": "", "sources": []},
        ), patch.object(
            llm_service, "stream_chat", new=_fake_llm_stream("ans"),
        ):
            events = await self._collect(service, self._base_state())

        labels = {e["node"]: e["label"] for e in events if e["type"] == "status"}
        assert labels["memory_loader"] == "会话记忆加载"
        assert labels["query_rewriter"] == "Query 改写与拆分"
        assert labels["intent_classifier"] == "意图识别与分类"
        assert labels["ambiguity_gate"] == "歧义引导判断"
        assert labels["rag_bot"] == "知识库向量检索"
        assert labels["reviewer"] == "Prompt 组装与生成"
