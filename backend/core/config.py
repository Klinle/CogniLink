from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/knowledge_assistant"

    # JWT 安全密钥（从 .env 读取；服务启动时校验非空，见 main.py）
    SECRET_KEY: str = ""

    # 种子超级管理员初始密码（生产环境务必通过 .env 覆盖）
    ADMIN_INITIAL_PASSWORD: str = "123456"

    # DeepSeek 默认配置（系统级：记忆提取、摘要生成等，从 .env 读取）
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_MODEL: str = "deepseek-v4-flash"

    class Config:
        env_file = ".env"

settings = Settings()
