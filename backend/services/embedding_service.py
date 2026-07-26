from typing import List, Optional

# BGE-M3 输出维度，须与 models/database.py 中 Vector(EMBEDDING_DIM) 保持一致
EMBEDDING_DIM = 1024


class EmbeddingService:
    """本地 Ollama BGE-M3 嵌入服务。

    文档上传与检索必须使用同一嵌入模型（维度一致），因此当前固定走本地
    Ollama。api_key / provider / base_url 参数仅保留接口兼容，实际不使用。
    """

    # Local Ollama settings
    OLLAMA_BASE_URL = "http://localhost:11434"
    OLLAMA_EMBEDDING_MODEL = "bge-m3"

    async def get_embeddings(
        self,
        texts: List[str],
        api_key: str = "",
        provider: str = "openai",
        base_url: Optional[str] = None,
        use_local: bool = True
    ) -> List[List[float]]:
        """Get embeddings for a list of texts via local Ollama BGE-M3."""
        return await self._get_ollama_embeddings(
            texts, self.OLLAMA_BASE_URL, self.OLLAMA_EMBEDDING_MODEL
        )

    async def get_single_embedding(
        self,
        text: str,
        api_key: str = "",
        provider: str = "openai",
        base_url: Optional[str] = None,
        use_local: bool = True
    ) -> List[float]:
        """Get embedding for a single text (固定使用本地 BGE-M3)"""
        embeddings = await self.get_embeddings([text], api_key, provider, base_url, use_local)
        return embeddings[0]

    async def _get_ollama_embeddings(
        self,
        texts: List[str],
        base_url: str,
        model: str = "bge-m3"
    ) -> List[List[float]]:
        """Get embeddings from Ollama API (batch-concurrent for BGE-M3).

        Ollama's /api/embeddings endpoint accepts a single prompt at a time,
        so we fire concurrent requests to maximize throughput.
        """
        import aiohttp
        import asyncio

        # Normalize base URL
        if base_url.endswith('/v1'):
            api_url = base_url.replace('/v1', '/api/embeddings')
        else:
            api_url = f"{base_url.rstrip('/')}/api/embeddings"

        # Limit concurrency to avoid overwhelming the Ollama server
        MAX_CONCURRENT = 10
        semaphore = asyncio.Semaphore(MAX_CONCURRENT)

        try:
            async with aiohttp.ClientSession() as session:
                async def _embed_one(text: str) -> List[float]:
                    async with semaphore:
                        async with session.post(
                            api_url,
                            json={"model": model, "prompt": text}
                        ) as resp:
                            if resp.status == 200:
                                data = await resp.json()
                                return data['embedding']
                            else:
                                error_text = await resp.text()
                                raise RuntimeError(f"Ollama embedding error: {error_text}")

                embeddings = await asyncio.gather(*[_embed_one(t) for t in texts])
        except aiohttp.ClientConnectorError as e:
            raise RuntimeError(
                f"无法连接本地 Ollama 服务（{base_url}）。"
                "请确认已安装 Ollama 并创建 bge-m3 模型（见 CLAUDE.md 的 BGE-M3 部署步骤），"
                "否则文档上传与 RAG 检索无法生成向量。"
            ) from e

        return list(embeddings)


embedding_service = EmbeddingService()
