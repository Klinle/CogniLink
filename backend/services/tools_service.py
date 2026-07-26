"""
Agent Tool Service - Provides tools for LLM agent to use
Includes: Web search, calculator, datetime, etc.
"""

import ast
import json
import math
import re
from typing import Dict, Any, List, Callable, Optional
from datetime import datetime
from urllib.parse import quote_plus
import asyncio


class Tool:
    """Tool definition"""

    def __init__(
        self,
        name: str,
        description: str,
        parameters: Dict[str, Any],
        func: Callable[..., Any]
    ):
        self.name = name
        self.description = description
        self.parameters = parameters
        self.func = func

    def to_dict(self) -> Dict[str, Any]:
        """Convert to OpenAI function calling format"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters
            }
        }


class ToolsService:
    """Service to manage and execute tools"""

    def __init__(self):
        self.tools: Dict[str, Tool] = {}
        self._register_default_tools()

    def _register_default_tools(self):
        """Register default tools"""
        self.register_tool(
            name="get_current_datetime",
            description="Get the current date and time",
            parameters={
                "type": "object",
                "properties": {
                    "timezone": {
                        "type": "string",
                        "description": "Timezone (e.g., 'UTC', 'Asia/Shanghai'). Defaults to local time."
                    }
                },
                "required": []
            },
            func=self._get_current_datetime
        )

        self.register_tool(
            name="calculator",
            description="Perform mathematical calculations",
            parameters={
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Mathematical expression to evaluate (e.g., '2 + 2', 'sin(30)', 'sqrt(16)')"
                    }
                },
                "required": ["expression"]
            },
            func=self._calculator
        )

        self.register_tool(
            name="web_search",
            description="Search the web for information",
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    },
                    "num_results": {
                        "type": "integer",
                        "description": "Number of results to return (1-10)",
                        "default": 5
                    }
                },
                "required": ["query"]
            },
            func=self._web_search
        )

    def register_tool(
        self,
        name: str,
        description: str,
        parameters: Dict[str, Any],
        func: Callable[..., Any]
    ):
        """Register a new tool"""
        self.tools[name] = Tool(name, description, parameters, func)

    def get_tools(self) -> List[Dict[str, Any]]:
        """Get all tools in OpenAI format"""
        return [tool.to_dict() for tool in self.tools.values()]

    def get_tool(self, name: str) -> Optional[Tool]:
        """Get a specific tool"""
        return self.tools.get(name)

    async def execute_tool(self, name: str, arguments: Dict[str, Any]) -> str:
        """Execute a tool with given arguments"""
        tool = self.tools.get(name)
        if not tool:
            return f"Error: Tool '{name}' not found"

        try:
            result = await tool.func(**arguments) if asyncio.iscoroutinefunction(tool.func) else tool.func(**arguments)
            return json.dumps(result, ensure_ascii=False) if isinstance(result, dict) else str(result)
        except Exception as e:
            return f"Error executing tool '{name}': {str(e)}"

    # Tool implementations
    def _get_current_datetime(self, timezone: str = None) -> Dict[str, Any]:
        """Get current datetime"""
        now = datetime.now()
        return {
            "datetime": now.isoformat(),
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "timezone": timezone or "local"
        }

    # AST 安全求值白名单（防止 eval 注入以及超大幂运算阻塞事件循环）
    _CALC_MAX_EXPR_LENGTH = 200
    _CALC_MAX_POW_EXPONENT = 128
    _CALC_MAX_POW_BASE = 1e15

    _CALC_FUNCS: Dict[str, Callable[[float], float]] = {
        'sqrt': math.sqrt,
        'sin': math.sin,
        'cos': math.cos,
        'tan': math.tan,
        'log': math.log,
        'log10': math.log10,
        'exp': math.exp,
        'abs': abs,
        'round': round,
    }
    _CALC_NAMES: Dict[str, float] = {
        'pi': math.pi,
        'e': math.e,
    }

    def _safe_eval_node(self, node: ast.AST) -> float:
        """递归求值 AST 节点，仅允许数字、四则运算、幂、取模和白名单函数"""
        if isinstance(node, ast.Expression):
            return self._safe_eval_node(node.body)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return node.value
            raise ValueError("Only numeric constants are allowed")
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = self._safe_eval_node(node.operand)
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp):
            left = self._safe_eval_node(node.left)
            right = self._safe_eval_node(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.FloorDiv):
                return left // right
            if isinstance(node.op, ast.Mod):
                return left % right
            if isinstance(node.op, ast.Pow):
                # 限制幂运算规模，防止同步大数计算冻结事件循环
                if abs(right) > self._CALC_MAX_POW_EXPONENT or abs(left) > self._CALC_MAX_POW_BASE:
                    raise ValueError("Exponentiation operands too large")
                return left ** right
            raise ValueError("Unsupported operator")
        if isinstance(node, ast.Call):
            if (
                isinstance(node.func, ast.Name)
                and node.func.id in self._CALC_FUNCS
                and not node.keywords
                and len(node.args) == 1
            ):
                return self._CALC_FUNCS[node.func.id](self._safe_eval_node(node.args[0]))
            raise ValueError("Unsupported function call")
        if isinstance(node, ast.Name):
            if node.id in self._CALC_NAMES:
                return self._CALC_NAMES[node.id]
            raise ValueError(f"Unknown name: {node.id}")
        raise ValueError("Unsupported expression")

    def _calculator(self, expression: str) -> Dict[str, Any]:
        """Safe calculator - AST-whitelisted math evaluation (no eval)"""
        if len(expression) > self._CALC_MAX_EXPR_LENGTH:
            return {"error": "Expression too long"}

        allowed_pattern = r'^[\d\+\-\*\/\%\(\)\.\,\s\^sinocstalgrpeq0-9]+$'
        if not re.match(allowed_pattern, expression.lower()):
            return {"error": "Invalid characters in expression"}

        try:
            # Replace ^ with ** for power
            expr = expression.replace('^', '**')
            tree = ast.parse(expr, mode="eval")
            result = self._safe_eval_node(tree)
            return {
                "expression": expression,
                "result": result
            }
        except ZeroDivisionError:
            return {"error": "Division by zero"}
        except Exception as e:
            return {"error": f"Calculation error: {str(e)}"}

    async def _web_search(self, query: str, num_results: int = 5) -> Dict[str, Any]:
        """Web search using DuckDuckGo"""
        try:
            # Use DuckDuckGo HTML search (no API key required)
            import aiohttp

            search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"

            async with aiohttp.ClientSession() as session:
                async with session.get(
                    search_url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0"
                    },
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status == 200:
                        html = await response.text()

                        # Parse results
                        from bs4 import BeautifulSoup
                        soup = BeautifulSoup(html, 'html.parser')
                        results = []

                        for result in soup.find_all('div', class_='result')[:num_results]:
                            title_elem = result.find('a', class_='result__a')
                            snippet_elem = result.find('a', class_='result__snippet')

                            if title_elem and snippet_elem:
                                results.append({
                                    "title": title_elem.get_text(strip=True),
                                    "url": title_elem.get('href', ''),
                                    "snippet": snippet_elem.get_text(strip=True)
                                })

                        return {
                            "query": query,
                            "results": results
                        }
                    else:
                        return {"error": f"Search failed with status {response.status}"}

        except ImportError:
            return {"error": "Web search requires 'aiohttp' and 'beautifulsoup4' packages"}
        except Exception as e:
            return {"error": f"Search error: {str(e)}"}


# Global instance
tools_service = ToolsService()
