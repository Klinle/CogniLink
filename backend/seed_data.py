import asyncio
from sqlalchemy import select, delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import async_session_maker
from models.database import (
    KnowledgeNode, KnowledgeRelation, Agent, Lab, User,
    UserKnowledgeState, UserLabSubmission, DocumentChunk,
)
from core.security import get_password_hash

_LEGACY_CATEGORIES = ["RAG", "LangGraph", "LLMOps"]
_LEGACY_ROLE_TYPES = [
    "rag_mentor", "langgraph_mentor", "llmops_mentor",
    "story_mentor", "practice_mentor", "quiz_mentor",
]


async def _cleanup_legacy_seed(session: AsyncSession):
    # 找到所有 source='learning_path' 的旧节点
    old_nodes_res = await session.execute(
        select(KnowledgeNode).where(KnowledgeNode.source == "learning_path")
    )
    old_nodes = old_nodes_res.scalars().all()
    if not old_nodes:
        return False

    old_node_ids = [n.id for n in old_nodes]
    print(f"[Seed] 检测到 {len(old_nodes)} 个已有的旧种子节点，开始清理...")

    # 清理关联的 Lab 和提交记录
    old_lab_ids_sub = select(Lab.id).where(Lab.node_id.in_(old_node_ids))
    await session.execute(delete(UserLabSubmission).where(UserLabSubmission.lab_id.in_(old_lab_ids_sub)))
    await session.execute(delete(Lab).where(Lab.node_id.in_(old_node_ids)))
    
    # 清理用户进度状态
    await session.execute(delete(UserKnowledgeState).where(UserKnowledgeState.node_id.in_(old_node_ids)))
    
    # 解除文档分块关联
    await session.execute(update(DocumentChunk).where(DocumentChunk.node_id.in_(old_node_ids)).values(node_id=None))
    
    # 清理依赖关系边
    await session.execute(delete(KnowledgeRelation).where(KnowledgeRelation.source_node_id.in_(old_node_ids)))
    await session.execute(delete(KnowledgeRelation).where(KnowledgeRelation.target_node_id.in_(old_node_ids)))
    
    # 清理节点本身
    await session.execute(delete(KnowledgeNode).where(KnowledgeNode.id.in_(old_node_ids)))
    await session.commit()
    print("[Seed] 旧种子数据已全部安全清理。")
    return True


async def _refresh_mentors(session: AsyncSession):
    # 强制清理已有新风格与旧风格导师，以确保 system_prompt 更改生效
    target_role_types = ["humor_mentor", "academic_mentor", "coach_mentor"]
    await session.execute(
        delete(Agent).where(Agent.role_type.in_(target_role_types))
    )
    await session.execute(
        delete(Agent).where(Agent.role_type.in_(_LEGACY_ROLE_TYPES))
    )
    await session.commit()
    print("[Seed] 已清理库中已有导师记录，重新注入最新 Python 领域导师。")

    print("[Seed] 开始注入新风格导师...")
    mentors = [
        Agent(
            name="幽默大师 (HumorBot)", role_type="humor_mentor",
            character_name="小柴",
            description="Python 圈段子手，用热梗和生动生活类比把 Python 概念讲成段子，让零基础玩家轻松入门。",
            system_prompt=(
                "你是「幽默大师」导师 HumorBot，一位把 Python 编程知识讲成段子的趣味老师。教学铁律：\n"
                "1. 趣味破冰：先抖个 Python 相关的机灵或生活类比破冰。讲列表推导式就讲「流水线打包草莓」，讲 GIL 就讲「神殿里的单通道独木桥」，讲装饰器就讲「给白开水套上保温杯套」。\n"
                "2. 口语接地气：全程轻松幽默、接地气，像跟朋友唠嗑，善用 Python 圈内梗（如人生苦短我用Python、缩进强迫症等）调节气氛。\n"
                "3. 趣味比喻与拟人：将 Python 内部机制拟人化，例如把垃圾回收引用计数比作「数苹果的保管员」，把 slots 内存优化比作「砍掉多余行李箱轻装上阵」。\n"
                "4. 耐心风趣：主人如果听不懂，绝不嫌弃，换个更离谱、更生动的比喻重新解释，直到主人听懂大笑。\n"
                "5. 趣味代码拆解：涉及 Python 代码时，用风趣的方式逐步剖析，在关键行配上幽默的大白话注释，突出 Pythonic 简洁美。\n"
                "6. 多维教学：能生动讲解 Python 概念、带写实战趣味代码、设计幽默的小测验，让主人在轻松的氛围中掌握 Python 核心逻辑。"
            ),
        ),
        Agent(
            name="严谨教授 (ProfBot)", role_type="academic_mentor",
            character_name="小鹰",
            description="治学严谨的 Python 学术导师，追根溯源剖析 CPython 机制，逻辑缜密，适合深度原理探究。",
            system_prompt=(
                "你是「严谨教授」导师 ProfBot，一位专注于 Python 底层运行机制与严谨设计的计算机科学教授。教学铁律：\n"
                "1. 术语与源码级精确：使用精准的 Python 专业术语，首次提及核心概念时标注英文原词，必要时结合 CPython 实现进行原理阐述。\n"
                "2. 深度追根溯源：着重讲清 Python 语言特性的「为什么」（例如为什么设计了 GIL 锁、为什么要引入 MRO 算法及 super() 的机制、垃圾回收中分代收集的动机、生成器底层的栈帧状态保存等）。\n"
                "3. 逻辑缜密递进：推导逻辑严丝合缝，解释 Python 特性时注重历史背景 and 设计权衡（如动态类型的灵活性与性能折中）。\n"
                "4. 知识图谱体系：主动将当前的 Python 概念与操作系统的内存管理、底层网络通信或编译原理建立学术层面的联系。\n"
                "5. 严苛代码分析：涉及代码时，高度强调 Python PEP 8 规范、边界条件及异常处理的严密性，逐行进行精确的静态或动态运行分析。\n"
                "6. 深度学术辨析：能够深入浅出剖析概念、指导编写高规范代码、设计逻辑严密的辨析题，风格儒雅、客观、学术气度非凡。"
            ),
        ),
        Agent(
            name="实战教练 (CoachBot)", role_type="coach_mentor",
            character_name="小铁",
            description="项目驱动的 Python 实战教练，代码优先、工程落地规范、高频面试视角的硬核教练。",
            system_prompt=(
                "你是「实战教练」导师 CoachBot，一位专注 Python 工程实战与生产落地的硬核教练。教学铁律：\n"
                "1. 代码与工程优先：先给出可直接运行的 Python 最小化工程示例，让主人运行看效果，然后再剖析代码内部逻辑。\n"
                "2. 真实工程场景代入：结合生产级别实际场景（如用 FastAPI 异步编写积分榜接口、用 asyncio 协程池处理网络请求、用 SQLAlchemy 进行数据库连接池优化、用 pytest 编写单元测试等）。\n"
                "3. 面试与工程痛点剖析：点明 Python 岗位面试中的高频考点、真实项目中的易踩大坑（如可变对象作为函数默认参数、闭包中的变量覆盖、多线程的 CPU 密集型任务无效性等）。\n"
                "4. 实操引导与重构：将大型任务分解为原子化步骤，引导主人逐步补全代码，并强调重构意识（如将坏味道代码重构为 Pythonic 的优雅写法）。\n"
                "5. 调试直觉培养：不直接揭晓答案，而是给出 traceback 调试提示（例如 NameError, AttributeError 等），引导主人通过错误日志定位问题并自我解决。\n"
                "6. 雷厉风行实干：精讲概念、强攻代码实现、设计实战对抗性训练，风格果断干脆，以结果为导向，迅速提升主人工程开发力。"
            ),
        ),
    ]
    session.add_all(mentors)
    await session.flush()
    print("[Seed] 新风格导师注入成功！HumorBot / ProfBot / CoachBot")


async def seed_all_data():
    async with async_session_maker() as session:
        # 0. 注入超级管理员 Kleinle（密码从配置读取，默认值仅供本地开发）
        from core.config import settings as app_settings

        stmt_admin = select(User).where(User.username == "Kleinle")
        if (await session.execute(stmt_admin)).scalars().first() is None:
            admin_password = app_settings.ADMIN_INITIAL_PASSWORD
            if admin_password == "123456":
                print("[Seed][WARN] SuperAdmin is using the default password. "
                      "Set ADMIN_INITIAL_PASSWORD in backend/.env before exposing this service.")
            session.add(User(
                username="Kleinle",
                hashed_password=get_password_hash(admin_password),
                nickname="Kleinle (SuperAdmin)",
                role="admin",
            ))
            await session.commit()
            print("[Seed] SuperAdmin account 'Kleinle' created.")
        else:
            print("[Seed] SuperAdmin 'Kleinle' already exists. Skip.")

        # 1. 若知识节点已注入则跳过后续（以 Python 概述节点为标志）；诊断题库独立幂等补种
        if (await session.execute(select(KnowledgeNode).where(KnowledgeNode.code == "PY_INTRO"))).scalars().first() is not None:
            from seed_diagnostic import seed_diagnostic_labs
            await seed_diagnostic_labs(session)
            print("[Seed] Python 核心知识节点已存在，跳过注入。")
            return

        # 2. 迁移清理旧种子数据
        await _cleanup_legacy_seed(session)

        # 3. 独立清理旧风格导师 + 按需注入新风格导师
        await _refresh_mentors(session)

        print("[Seed] 开始注入《Python编程从入门到提高》专业大纲核心节点数据...")

        # 4. 注入 40 个 Python 专业大纲知识节点（对齐袁勤勇教材）
        nodes = {
            # 1. 编程开发基础 (programming)
            "PY_INTRO": KnowledgeNode(code="PY_INTRO", name="Python 概述与应用", category="programming", description="从开发历史到未来应用。探究 Python 独特的胶水语言特征、动态类型与强类型契约，在人工智能与 Web 时代的跨领域工程生命力。", pagerank_weight=1.0, source="learning_path"),
            "PY_ENV": KnowledgeNode(code="PY_ENV", name="环境安装与虚拟环境", category="programming", description="探秘 CPython / PyPy 等不同解释器发行版。使用 venv 与 conda 隔离依赖房间，理清系统环境变量防冲突天条。", pagerank_weight=1.1, source="learning_path"),
            "PY_RUN": KnowledgeNode(code="PY_RUN", name="交互与脚本运行模式", category="programming", description="敲击 Python 第一行代码的钥匙。区分 Read-Eval-Print Loop (REPL) 交互模式的即时回显与 .py 脚本模式的流式执行生命周期。", pagerank_weight=1.1, source="learning_path"),
            "PY_VAR_EXP": KnowledgeNode(code="PY_VAR_EXP", name="变量定义与算术表达式", category="programming", description="变量的定义、命名规范与垃圾回收引用机制。算术表达式、逻辑关系判定、以及优雅简洁的海象运算符应用。", pagerank_weight=1.2, source="learning_path"),
            "PY_DATATYPES": KnowledgeNode(code="PY_DATATYPES", name="基本数据类型与空类型", category="programming", description="整型、浮点型精确度、复数与 None 占位符。掌握类型动态转换、进制转换、以及如何合理利用布尔短路求值。", pagerank_weight=1.2, source="learning_path"),
            "PY_FLOW": KnowledgeNode(code="PY_FLOW", name="选择与循环流程控制", category="programming", description="结构化流程的红绿灯。用缩进控制 if-else 分支决策，用 while 与 for 循环执行迭代，用 else 捕获正常循环完退出动作。", pagerank_weight=1.3, source="learning_path"),
            "PY_MODULES": KnowledgeNode(code="PY_MODULES", name="模块和包自定义导入", category="programming", description="模块与包的打包导入艺术。深入 inspect 与 sys.path 寻包优先级，使用自定义的 __init__.py 精细化暴露底层接口。", pagerank_weight=1.3, source="learning_path"),
            "PY_PEP8": KnowledgeNode(code="PY_PEP8", name="编程规范与 PEP8 命名", category="programming", description="规范是第一生产力。践行 PEP8 变量方法蛇形命名、类名驼峰命名、合理使用类型提示与清晰的文档描述规范。", pagerank_weight=1.1, source="learning_path"),

            # 2. 数据结构与高级特性 (dsa)
            "PY_SEQ": KnowledgeNode(code="PY_SEQ", name="序列种类与基本操作", category="dsa", description="探索可变与不可变序列。学习通用的切片定位、拼接重复、元素计数、以及序列成员关系的高效查找算法。", pagerank_weight=1.2, source="learning_path"),
            "PY_LIST": KnowledgeNode(code="PY_LIST", name="列表推导式与元素操作", category="dsa", description="最灵活的数据袋。掌握 append、extend、pop 栈式操作，用单行列表推导式高效完成数据清洗和矩阵一键渲染。", pagerank_weight=1.3, source="learning_path"),
            "PY_TUPLE": KnowledgeNode(code="PY_TUPLE", name="元组与不可变陷阱", category="dsa", description="轻量固态的数据盘。探索元组的只读特性及其在元组拆包、多返回值中的应用，警惕元组内嵌套可变对象的内存陷阱。", pagerank_weight=1.2, source="learning_path"),
            "PY_SET": KnowledgeNode(code="PY_SET", name="集合常用操作与推导式", category="dsa", description="无序无重去重的滤网。探究集合在并集、交集、差集等数学运算中的哈希查找极速原理，掌握集合推导式去重技巧。", pagerank_weight=1.2, source="learning_path"),
            "PY_DICT": KnowledgeNode(code="PY_DICT", name="字典常用操作与推导式", category="dsa", description="哈希映射存储箱。掌握键值对的获取、防报错 get、以及字典推导式快速重构，体会字典 O(1) 平均查找复杂度的威力。", pagerank_weight=1.3, source="learning_path"),
            "PY_STR": KnowledgeNode(code="PY_STR", name="字符串常用处理与格式化", category="dsa", description="字符流处理中心。掌握 find、split、strip 等高级处理，使用新式 f-string 对数据进行快速缩进的格式化渲染。", pagerank_weight=1.2, source="learning_path"),
            "PY_BYTES": KnowledgeNode(code="PY_BYTES", name="二进制序列与字节串", category="dsa", description="数字世界原色。剖析 byte 与 bytearray 字节串原理，在网络文件读写、二进制协议、以及数据编码转换中对齐底层物理比特流。", pagerank_weight=1.2, source="learning_path"),
            "PY_SCOPE": KnowledgeNode(code="PY_SCOPE", name="函数定义调用与作用域", category="dsa", description="可复用的封装招式。探索函数声明、默认值陷阱、LEGB (Local/Enclosing/Global/Built-in) 作用域层级搜寻原理。", pagerank_weight=1.3, source="learning_path"),
            "PY_PARAMS": KnowledgeNode(code="PY_PARAMS", name="参数解包、可变与位置", category="dsa", description="参数解耦艺术。掌握可选位置参数、强关键字参数，灵活搭配星号 *args 和双星号 **kwargs 实现华丽的接口传参解析。", pagerank_weight=1.3, source="learning_path"),
            "PY_CLOSURE": KnowledgeNode(code="PY_CLOSURE", name="嵌套函数与闭包", category="dsa", description="状态在局部持久驻留。嵌套函数的命名空间搜寻，nonlocal 关键字，使函数包裹其环境状态，实现无需类的行为封装。", pagerank_weight=1.3, source="learning_path"),
            "PY_DECORATOR": KnowledgeNode(code="PY_DECORATOR", name="装饰器工作原理与叠加", category="dsa", description="面向切面编程 (AOP) 利器。编写修饰器截获并增强函数功能，支持叠加装饰、带参数装饰器、以及使用 @wraps 精准维持函数元数据。", pagerank_weight=1.4, source="learning_path"),

            # 3. 面向对象与系统架构 (organization)
            "PY_OOP_BASE": KnowledgeNode(code="PY_OOP_BASE", name="类与对象及封装继承多态", category="organization", description="构建自洽的对象大陆。类的定义、构造函数、对象实例引用的生命周期，封装细节并利用继承和多态性简化接口设计。", pagerank_weight=1.2, source="learning_path"),
            "PY_CLASS_MEMBER": KnowledgeNode(code="PY_CLASS_MEMBER", name="类成员隐藏与属性分类", category="organization", description="成员的隐藏机制。使用双下划线进行混淆隐藏，解构类属性与实例属性的独立命名空间与访问搜寻机制。", pagerank_weight=1.2, source="learning_path"),
            "PY_PROPERTY": KnowledgeNode(code="PY_PROPERTY", name="属性拦截与 property", category="organization", description="属性拦截器：用 @property 守卫变量属性，在被写入非法数值时强行进行校验逻辑，防止系统发生状态越界异常。", pagerank_weight=1.3, source="learning_path"),
            "PY_OOP_METH": KnowledgeNode(code="PY_OOP_METH", name="实例、类与静态方法", category="organization", description="方法的多元派发。解构 cls 自指与静态无状态方法的定位，在工厂模式、状态更新中选用最合理的行为方法定义。", pagerank_weight=1.3, source="learning_path"),
            "PY_OOP_INHERIT": KnowledgeNode(code="PY_OOP_INHERIT", name="多重继承与 MRO 算法", category="organization", description="多重继承的血脉交叉。深入解析 Python 多继承场景下的 C3 线性化算法（MRO），理清基类调用与 super() 的链式解析。", pagerank_weight=1.4, source="learning_path"),
            "PY_MIXIN": KnowledgeNode(code="PY_MIXIN", name="混入 (Mixin) 行为扩展", category="organization", description="非侵入性的行为扩充。利用 Python 继承链自右向左的拼装规则，将独立的通用功能块无侵入地装载入目标类中。", pagerank_weight=1.3, source="learning_path"),
            "PY_MAGIC": KnowledgeNode(code="PY_MAGIC", name="魔术方法重载与可调用", category="organization", description="重塑类的物理法则。通过 __add__ 实现重载加法，__call__ 使实例对象成为可调用函数，__getitem__ 模拟切片容器行为。", pagerank_weight=1.5, source="learning_path"),
            "PY_ITER": KnowledgeNode(code="PY_ITER", name="迭代器协议与生成器对象", category="organization", description="懒加载数据水晶。实现 __iter__ 和 __next__ 编写迭代器类，使用 yield 生成器在 for 循环中源源不断流式产出数据。", pagerank_weight=1.4, source="learning_path"),
            "PY_META": KnowledgeNode(code="PY_META", name="类装饰器、抽象类与元类", category="organization", description="操控编译器和类的生成。利用类装饰器修改类，使用元类 (metaclass) 控制类的构造蓝图，植入元编程基因。", pagerank_weight=1.5, source="learning_path"),

            # 4. 并发编程与操作系统 (os)
            "PY_GIL": KnowledgeNode(code="PY_GIL", name="GIL 全局解释器锁原理", category="os", description="神殿物理天条。理解 CPython 解释器在多线程并发下的执行锁定（GIL）机制，深入 CPU 多核计算与 GIL 的本质冲突。", pagerank_weight=1.5, source="learning_path"),
            "PY_CONCURRENT": KnowledgeNode(code="PY_CONCURRENT", name="多进程多线程与并发池", category="os", description="多核并进与并发池。使用 threading 进行 I/O 并发，使用 multiprocessing 实现多核物理并行，使用池化托管任务。", pagerank_weight=1.4, source="learning_path"),
            "PY_ASYNC": KnowledgeNode(code="PY_ASYNC", name="异步协程与 asyncio", category="os", description="单线程极致横跳。使用 async/await 关键字，构建事件循环，利用非阻塞 I/O 在上万个长连接间极速并发响应。", pagerank_weight=1.6, source="learning_path"),

            # 5. 网络编程与联机服务 (network)
            "PY_SOCKET": KnowledgeNode(code="PY_SOCKET", name="套接字网络通信编程", category="network", description="数据底层的电话线。学习 Socket TCP/UDP 握手与连接流程，编写高并发的网络客户端与服务端通信套接字包。", pagerank_weight=1.4, source="learning_path"),
            "PY_HTTP_REG": KnowledgeNode(code="PY_HTTP_REG", name="HTTP 协议与 requests 模块", category="network", description="Web 世界的文字飞鸽。解构 HTTP 请求与响应包头格式，利用 requests 库便捷高效拉取远程 Web API 核心资源。", pagerank_weight=1.4, source="learning_path"),
            "PY_WEB_SRV": KnowledgeNode(code="PY_WEB_SRV", name="Web 客户端与服务端原理", category="network", description="探究 Web 通信大门。编写最原始的基于 socket 的 HTTP Web 服务器端，掌握 urllib 框架的网络接入技术细节。", pagerank_weight=1.3, source="learning_path"),
            "PY_WSGI_ASGI": KnowledgeNode(code="PY_WSGI_ASGI", name="WSGI 与 ASGI 协议接口", category="network", description="跑堂小二的沟通礼仪：Python Web 服务端与框架之间握手交互的标准规范，同步 WSGI 遇上异步 ASGI。", pagerank_weight=1.3, source="learning_path"),
            "PY_WEB_FRAME": KnowledgeNode(code="PY_WEB_FRAME", name="Web 框架与 MVC 设计模式", category="network", description="架构的艺术。拆解 Web 框架的基本设计蓝图，探究 MVC (Model-View-Controller) 模式的演进分支与全栈应用隔离设计。", pagerank_weight=1.4, source="learning_path"),

            # 6. 数据工程与持久化 (database)
            "PY_DEBUG": KnowledgeNode(code="PY_DEBUG", name="调试方法与异常处理机制", category="database", description="用 logging 记录错误日志、pdb 调试器断点排查，断言 (assert) 守卫输入条件，以 try-except 筑起服务安全护盾。", pagerank_weight=1.2, source="learning_path"),
            "PY_TEST": KnowledgeNode(code="PY_TEST", name="单元测试与 pytest 用例", category="database", description="防代码塌方支柱：在核心判定函数旁架起 pytest 自检符文，确保你重构或更新模块时不会把之前的规则改出 bug。", pagerank_weight=1.3, source="learning_path"),
            "PY_IO": KnowledgeNode(code="PY_IO", name="文件读写、路径与上下文", category="database", description="IO流磁盘交互。掌握 Pathlib 路径管理与 with 上下文管理器，开启资源退出自动清空释放锁，无论报错均能安全落盘。", pagerank_weight=1.3, source="learning_path"),
            "PY_SQL": KnowledgeNode(code="PY_SQL", name="SQLite 与 SQLAlchemy ORM", category="database", description="持久化数据账本。直接操作本地嵌入式 SQLite 库，使用 SQLAlchemy ORM 将对象映射到数据库表单中，无感执行 CRUD 操作。", pagerank_weight=1.4, source="learning_path"),
            "PY_NUMPY_PANDAS": KnowledgeNode(code="PY_NUMPY_PANDAS", name="高能矩阵计算与 Pandas 分析", category="database", description="数据科学双子星。使用 NumPy 高速多维数组完成科学矩阵运算，利用 Pandas DataFrame 快速对结构化表格数据进行统计流计算。", pagerank_weight=1.5, source="learning_path"),
        }
        session.add_all(nodes.values())
        await session.flush()

        # 5. 注入 40 个 Python 节点的 Requires 拓扑关系
        def edge(src, dst, rel="requires"):
            return KnowledgeRelation(source_node_id=nodes[src].id, target_node_id=nodes[dst].id, relation_type=rel)
        
        relations = [
            edge("PY_INTRO", "PY_ENV"),
            edge("PY_ENV", "PY_RUN"),
            edge("PY_RUN", "PY_VAR_EXP"),
            edge("PY_VAR_EXP", "PY_DATATYPES"),
            edge("PY_DATATYPES", "PY_FLOW"),
            edge("PY_FLOW", "PY_MODULES"),
            edge("PY_MODULES", "PY_PEP8"),
            edge("PY_DATATYPES", "PY_SEQ"),
            edge("PY_SEQ", "PY_LIST"),
            edge("PY_SEQ", "PY_TUPLE"),
            edge("PY_SEQ", "PY_SET"),
            edge("PY_SEQ", "PY_DICT"),
            edge("PY_SEQ", "PY_STR"),
            edge("PY_SEQ", "PY_BYTES"),
            edge("PY_FLOW", "PY_SCOPE"),
            edge("PY_SCOPE", "PY_PARAMS"),
            edge("PY_SCOPE", "PY_CLOSURE"),
            edge("PY_CLOSURE", "PY_DECORATOR"),
            edge("PY_SCOPE", "PY_OOP_BASE"),
            edge("PY_OOP_BASE", "PY_CLASS_MEMBER"),
            edge("PY_CLASS_MEMBER", "PY_PROPERTY"),
            edge("PY_OOP_BASE", "PY_OOP_METH"),
            edge("PY_OOP_BASE", "PY_OOP_INHERIT"),
            edge("PY_OOP_INHERIT", "PY_MIXIN"),
            edge("PY_OOP_BASE", "PY_MAGIC"),
            edge("PY_MAGIC", "PY_ITER"),
            edge("PY_OOP_BASE", "PY_META"),
            edge("PY_FLOW", "PY_DEBUG"),
            edge("PY_DEBUG", "PY_TEST"),
            edge("PY_FLOW", "PY_IO"),
            edge("PY_IO", "PY_SQL"),
            edge("PY_SQL", "PY_NUMPY_PANDAS"),
            edge("PY_SCOPE", "PY_GIL"),
            edge("PY_GIL", "PY_CONCURRENT"),
            edge("PY_CONCURRENT", "PY_ASYNC"),
            edge("PY_RUN", "PY_SOCKET"),
            edge("PY_SOCKET", "PY_HTTP_REG"),
            edge("PY_HTTP_REG", "PY_WEB_SRV"),
            edge("PY_WEB_SRV", "PY_WSGI_ASGI"),
            edge("PY_WSGI_ASGI", "PY_WEB_FRAME"),
        ]
        session.add_all(relations)

        # 6. 注入 3 个编程实战 Labs 题库，关联全新的 node_id
        labs = [
            Lab(
                title="流程控制决策分支", lab_type="code", difficulty="easy",
                description="设计一个控制台程序的伤害决策模块。用户输入选项为 1 时进行普通攻击，造成 10 到 20 之间随机伤害；选项为 2 时进行重击，有 50% 的概率暴击并造成双倍伤害，但有 30% 的概率落空（伤害为 0），否则造成基础 10-20 的普通伤害；选择其他数值输入则判定为非法动作返回 -1。请补全分支流程控制逻辑。",
                starter_code="import random\n\ndef evaluate_attack(choice):\n    # choice 为整型：1 表示普攻，2 表示重击，其它为非法返回 -1\n    # 提示：你可以用 random.randint(10, 20) 产生伤害\n    # random.random() 来做概率判定\n    pass\n",
                test_cases={
                    "cases": [
                        {"choice": 3, "expected": -1},
                        {"choice": 99, "expected": -1}
                    ],
                    "prob_check": "输入选择 1 时应返回 10 到 20 之间的数字。输入选择 2 时返回 0 或 10-20 或 20-40（暴击）。"
                },
                node_id=nodes["PY_FLOW"].id,
            ),
            Lab(
                title="加速技能冷却计时装饰器 (CD)", lab_type="code", difficulty="medium",
                description="加速方法 speed_up() 必须防刷。编写一个装饰器 @cooldown(seconds=3) 贴在函数上。如果在 cooldown 计时内再次触发调用，需引发自定义的 SkillOnCooldownError 异常；否则顺利施放返回 'Speed Up!' 且重置冷却时间基准点。",
                starter_code="import time\n\nclass SkillOnCooldownError(Exception):\n    pass\n\ndef cooldown(seconds):\n    # 补全这个装饰器，保存上一次施放的时间点\n    # 提示：在闭包中使用 nonlocal 变量或类属性记录上一次执行时间戳\n    pass\n",
                test_cases={
                    "custom_eval": "test_decorator",
                    "description": "调用一次返回 'Speed Up!'，如果立即再次调用抛出 SkillOnCooldownError，冷却过后可重新调用。"
                },
                node_id=nodes["PY_DECORATOR"].id,
            ),
            Lab(
                title="类魔术方法重载应用", lab_type="code", difficulty="medium",
                description="定义 Potion 类，接受 name(str) 和 potency(int) 属性。重载 __add__ 魔术方法，当 potion_a (名称 'A', 强度 10) 与 potion_b (名称 'B', 强度 5) 相加时，合成并返回一瓶新药水，名称为 'Merged A & B'，强度为两者强度相加的值 (15)。",
                starter_code="class Potion:\n    def __init__(self, name, potency):\n        self.name = name\n        self.potency = potency\n\n    def __add__(self, other):\n        # 补全魔术方法重载逻辑\n        pass\n",
                test_cases={
                    "cases": [
                        {"init_a": {"name": "Fire", "potency": 10}, "init_b": {"name": "Ice", "potency": 12}, "expected_name": "Merged Fire & Ice", "expected_potency": 22}
                    ]
                },
                node_id=nodes["PY_MAGIC"].id,
            ),
        ]
        session.add_all(labs)
        await session.commit()
        print(f"[Seed] 知识节点与练习数据注入成功！节点 {len(nodes)} / Lab {len(labs)}")

        # 5. 诊断题库（依赖节点已入库）
        from seed_diagnostic import seed_diagnostic_labs
        await seed_diagnostic_labs(session)


if __name__ == "__main__":
    asyncio.run(seed_all_data())
