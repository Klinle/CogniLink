"""API 层安全回归测试：鉴权覆盖 + 路由注册顺序 + 计算器安全求值

这些测试不依赖数据库：鉴权失败发生在依赖解析阶段（HTTPBearer），
不会真正触达 PostgreSQL。
"""
import uuid

import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from main import app
from services.tools_service import tools_service

DOC_ID = str(uuid.uuid4())

# 未携带 Bearer Token 时必须被拒绝的端点（历史上曾无鉴权）
PROTECTED_ENDPOINTS = [
    ("GET", f"/api/documents/{DOC_ID}/content"),
    ("GET", f"/api/documents/{DOC_ID}/preview-info"),
    ("GET", f"/api/documents/{DOC_ID}/file"),
    ("GET", f"/api/documents/{DOC_ID}"),
    ("GET", f"/api/documents/{DOC_ID}/status"),
    ("POST", f"/api/documents/{DOC_ID}/reprocess"),
    ("GET", "/api/documents/kb"),
    ("GET", "/api/memories/settings"),
    ("POST", "/api/memories/settings"),
    ("GET", "/api/memories/settings/check-topic?topic=python"),
    # M1 学习闭环新增端点
    ("GET", "/api/reviews/today"),
    ("GET", "/api/reviews/stats"),
    ("GET", "/api/reviews"),
    ("POST", f"/api/reviews/{DOC_ID}/answer"),
    ("POST", f"/api/reviews/{DOC_ID}/graduate"),
    ("DELETE", f"/api/reviews/{DOC_ID}"),
    ("GET", "/api/onboarding/status"),
    ("POST", "/api/onboarding/complete"),
    ("GET", "/api/onboarding/questions?domain=programming"),
    ("POST", "/api/onboarding/diagnose"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", PROTECTED_ENDPOINTS)
async def test_endpoint_requires_auth(method, path):
    """未认证请求必须返回 401/403，而不是泄露数据"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if method == "POST" and path == "/api/memories/settings":
            resp = await client.post(path, json={})
        else:
            resp = await client.request(method, path)
    assert resp.status_code in (401, 403), (
        f"{method} {path} 未鉴权却返回 {resp.status_code}"
    )


def _api_route_paths() -> list:
    """按匹配顺序扁平化路由表。

    FastAPI 0.139+ 将 include_router 包装为 _IncludedRouter 惰性节点，
    子路由不再平铺进 app.routes，需通过 original_router 展开。
    """
    paths = []
    for route in app.routes:
        if isinstance(route, APIRoute):
            paths.append(route.path)
            continue
        original = getattr(route, "original_router", None)
        for sub in getattr(original, "routes", None) or []:
            if isinstance(sub, APIRoute):
                paths.append(sub.path)
    return paths


def _first_route_index(path: str) -> int:
    paths = _api_route_paths()
    assert path in paths, f"路由 {path} 未注册"
    return paths.index(path)


class TestRouteOrder:
    """静态路径必须注册在同级路径参数路由之前，否则会被遮蔽"""

    def test_conversations_search_before_dynamic(self):
        assert _first_route_index("/api/conversations/search") < _first_route_index(
            "/api/conversations/{conversation_id}"
        )

    def test_documents_kb_before_dynamic(self):
        assert _first_route_index("/api/documents/kb") < _first_route_index(
            "/api/documents/{document_id}"
        )


class TestCalculatorSafety:
    """计算器 AST 安全求值：正常运算可用，攻击面被拒绝"""

    def test_basic_arithmetic(self):
        assert tools_service._calculator("2+3*4")["result"] == 14

    def test_power_and_functions(self):
        assert tools_service._calculator("2^10")["result"] == 1024
        assert tools_service._calculator("sqrt(16)")["result"] == 4.0

    def test_constants(self):
        result = tools_service._calculator("pi*2")["result"]
        assert abs(result - 6.283185) < 1e-5

    def test_rejects_huge_exponent(self):
        """超大幂运算会同步阻塞事件循环，必须直接拒绝"""
        result = tools_service._calculator("9^9^9^9")
        assert "error" in result

    def test_rejects_invalid_characters(self):
        assert "error" in tools_service._calculator("__import__('os')")

    def test_rejects_overlong_expression(self):
        assert "error" in tools_service._calculator("1+" * 200 + "1")

    def test_division_by_zero(self):
        assert "error" in tools_service._calculator("1/0")
