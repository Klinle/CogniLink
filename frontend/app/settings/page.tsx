'use client';

import { useState, useEffect } from 'react';
import {
  useSettingsStore,
  SUPPORTED_MODELS,
  PROVIDERS,
  getModelsByProvider,
} from '@/stores/settings';
import {
  Settings,
  Bot,
  Key,
  SlidersHorizontal,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Globe,
  ExternalLink,
} from 'lucide-react';
import UserLayout from '@/components/user-layout';
import { useRouter } from 'next/navigation';

type TabId = 'models' | 'providers' | 'features';

const TABS: { id: TabId; label: string; icon: typeof Bot }[] = [
  { id: 'models', label: '模型选择', icon: Bot },
  { id: 'providers', label: 'API 配置', icon: Key },
  { id: 'features', label: '功能开关', icon: SlidersHorizontal },
];

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-black transition-colors ${
        checked
          ? 'bg-amber-400 dark:bg-amber-500'
          : 'bg-zinc-200 dark:bg-zinc-700'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full border-2 border-black bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();

  // 鉴权检查
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('cognilink_token');
      if (!token) {
        router.push('/login');
      }
    }
  }, [router]);

  const {
    model,
    setModel,
    apiKeys,
    baseUrls,
    setApiKey,
    setBaseUrl,
    selectedProvider,
    setSelectedProvider,
    getEffectiveApiKey,
    useRAG,
    setUseRAG,
    useMemory,
    setUseMemory,
    useTools,
    setUseTools,
    useLocalEmbedding,
    setUseLocalEmbedding,
  } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<TabId>('models');
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(
    selectedProvider
  );

  const handleModelSelect = (modelId: string) => {
    setModel(modelId);
    const modelConfig = SUPPORTED_MODELS.find((m) => m.id === modelId);
    if (modelConfig) {
      setSelectedProvider(modelConfig.provider);
    }
  };

  const toggleShowKey = (providerId: string) => {
    setShowKey((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const currentModel = SUPPORTED_MODELS.find((m) => m.id === model);
  const currentProviderName =
    PROVIDERS.find((p) => p.id === (currentModel?.provider || selectedProvider))
      ?.name || selectedProvider;
  const hasApiKey = Boolean(getEffectiveApiKey());

  const featureRows = [
    {
      key: 'rag',
      title: '知识库检索',
      description: '回答时检索你上传的教材并标注来源页码',
      checked: useRAG,
      onChange: setUseRAG,
    },
    {
      key: 'memory',
      title: '长期记忆',
      description: '把对话里的重要信息记成便签，越聊越懂你',
      checked: useMemory,
      onChange: setUseMemory,
    },
    {
      key: 'tools',
      title: '联网搜索',
      description: '遇到时效性问题时自动联网查证',
      checked: useTools,
      onChange: setUseTools,
    },
    {
      key: 'localEmbedding',
      title: '本地嵌入',
      description: '用本机 BGE-M3 生成向量，文档内容不出电脑（需 Ollama）',
      checked: useLocalEmbedding,
      onChange: setUseLocalEmbedding,
    },
  ];

  const inputClass =
    'w-full border-2 border-black rounded-xl bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-bold text-black dark:text-white placeholder:text-zinc-400 placeholder:font-semibold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-none transition-all';

  return (
    <UserLayout activePath="/settings">
      <div className="flex-1 overflow-y-auto bg-[#fdfaf2] dark:bg-[#181611] bg-[linear-gradient(rgba(139,90,43,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(139,90,43,0.02)_1px,transparent_1px)] bg-[size:24px_24px]">
        <div className="max-w-5xl mx-auto p-4 md:p-8">
          {/* 页头 */}
          <div className="mb-6">
            <h1 className="text-3xl font-black tracking-tight text-black dark:text-white flex items-center gap-2">
              <Settings className="h-8 w-8 text-amber-500" />
              设置
            </h1>
            <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mt-1">
              选模型、填密钥、开功能，全部只保存在你自己的浏览器里
            </p>
          </div>

          {/* 档案夹标签条 */}
          <div className="flex gap-1 -mb-[2px] relative z-10">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2.5 rounded-t-2xl border-2 border-black font-black text-sm transition-colors inline-flex items-center gap-1.5 ${
                    active
                      ? 'bg-white dark:bg-zinc-900 border-b-white dark:border-b-zinc-900 text-black dark:text-white'
                      : 'bg-amber-100 dark:bg-zinc-800 text-zinc-500 hover:bg-amber-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* 档案夹面板 */}
          <div className="bg-white dark:bg-zinc-900 border-2 border-black rounded-b-3xl rounded-tr-3xl p-5 md:p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            {/* Tab 1: 模型选择 */}
            {activeTab === 'models' && (
              <div>
                <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-4">
                  挑一个模型当你的答疑主力，点卡片即可切换
                </p>

                {/* 厂商筛选 chips */}
                <div className="flex flex-wrap gap-2 mb-5">
                  <button
                    onClick={() => setSelectedProvider('')}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border-2 border-black text-[11px] font-bold shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] transition-colors ${
                      selectedProvider === ''
                        ? 'bg-amber-300 dark:bg-amber-600 text-black dark:text-white'
                        : 'bg-white dark:bg-zinc-800 text-black dark:text-white hover:bg-amber-100 dark:hover:bg-zinc-700'
                    }`}
                  >
                    全部
                  </button>
                  {PROVIDERS.map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => setSelectedProvider(provider.id)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border-2 border-black text-[11px] font-bold shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] transition-colors ${
                        selectedProvider === provider.id
                          ? 'bg-amber-300 dark:bg-amber-600 text-black dark:text-white'
                          : 'bg-white dark:bg-zinc-800 text-black dark:text-white hover:bg-amber-100 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {provider.name}
                    </button>
                  ))}
                </div>

                {/* 模型列表 */}
                <div className="space-y-3">
                  {(selectedProvider
                    ? getModelsByProvider(selectedProvider)
                    : SUPPORTED_MODELS
                  ).map((m) => {
                    const selected = model === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => handleModelSelect(m.id)}
                        className={`w-full text-left border-2 border-black rounded-2xl p-4 transition-all ${
                          selected
                            ? 'bg-amber-100 dark:bg-amber-700/40 shadow-none translate-x-[1px] translate-y-[1px]'
                            : 'bg-white dark:bg-zinc-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-black dark:text-white">
                                {m.name}
                              </span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border-2 border-black text-[11px] font-bold shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] bg-sky-100 dark:bg-sky-800 text-black dark:text-white">
                                {PROVIDERS.find((p) => p.id === m.provider)?.name}
                              </span>
                            </div>
                            <div className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mt-1">
                              {m.description}
                              {m.contextWindow && (
                                <span className="ml-2">
                                  · {(m.contextWindow / 1000).toFixed(0)}K 上下文
                                </span>
                              )}
                            </div>
                          </div>
                          {selected && (
                            <div className="w-7 h-7 shrink-0 rounded-full border-2 border-black bg-amber-300 dark:bg-amber-500 flex items-center justify-center">
                              <Check className="h-4 w-4 text-black" strokeWidth={3} />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {selectedProvider &&
                    getModelsByProvider(selectedProvider).length === 0 && (
                      <div className="border-2 border-black border-dashed rounded-2xl p-6 text-center">
                        <p className="text-sm font-bold text-black dark:text-white">
                          这家厂商暂时没有内置模型
                        </p>
                        <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mt-1">
                          点上面的“全部”看看其他可用模型
                        </p>
                      </div>
                    )}
                </div>
              </div>
            )}

            {/* Tab 2: API 配置 */}
            {activeTab === 'providers' && (
              <div>
                <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-4">
                  填上你要用的厂商密钥，密钥只存在本机浏览器，不会上传服务器
                </p>

                <div className="space-y-4">
                  {PROVIDERS.map((provider) => {
                    const expanded = expandedProvider === provider.id;
                    return (
                      <div
                        key={provider.id}
                        className="bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-0 overflow-hidden"
                      >
                        <button
                          onClick={() =>
                            setExpandedProvider(expanded ? null : provider.id)
                          }
                          className="w-full flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-amber-50 dark:hover:bg-zinc-800"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-black text-black dark:text-white">
                              {provider.name}
                            </span>
                            {apiKeys[provider.id] && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border-2 border-black text-[11px] font-bold shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] bg-green-200 dark:bg-green-700 text-black dark:text-white">
                                <Check className="h-3 w-3" strokeWidth={3} />
                                已配置
                              </span>
                            )}
                          </div>
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-black dark:text-white transition-transform ${
                              expanded ? 'rotate-180' : ''
                            }`}
                          />
                        </button>

                        {expanded && (
                          <div className="px-4 py-4 border-t-2 border-black space-y-4">
                            {/* API Key */}
                            <div className="space-y-1.5">
                              <label
                                htmlFor={`key-${provider.id}`}
                                className="text-sm font-black text-black dark:text-white"
                              >
                                {provider.keyName}
                              </label>
                              <div className="relative">
                                <input
                                  id={`key-${provider.id}`}
                                  type={showKey[provider.id] ? 'text' : 'password'}
                                  placeholder={`输入 ${provider.keyName}`}
                                  value={apiKeys[provider.id] || ''}
                                  onChange={(e) =>
                                    setApiKey(provider.id, e.target.value)
                                  }
                                  className={`${inputClass} pr-10`}
                                />
                                <button
                                  type="button"
                                  onClick={() => toggleShowKey(provider.id)}
                                  aria-label={
                                    showKey[provider.id] ? '隐藏密钥' : '显示密钥'
                                  }
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-black dark:hover:text-white"
                                >
                                  {showKey[provider.id] ? (
                                    <EyeOff className="h-4 w-4" />
                                  ) : (
                                    <Eye className="h-4 w-4" />
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* Base URL */}
                            <div className="space-y-1.5">
                              <label
                                htmlFor={`url-${provider.id}`}
                                className="text-sm font-black text-black dark:text-white"
                              >
                                Base URL（可选）
                              </label>
                              <div className="relative">
                                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                                <input
                                  id={`url-${provider.id}`}
                                  placeholder={provider.baseUrlPlaceholder}
                                  value={baseUrls[provider.id] || ''}
                                  onChange={(e) =>
                                    setBaseUrl(provider.id, e.target.value)
                                  }
                                  className={`${inputClass} pl-9`}
                                />
                              </div>
                              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                                仅在使用代理或自定义端点时需要填写
                              </p>
                            </div>

                            {/* 获取 Key 外链 */}
                            <a
                              href={getApiKeyUrl(provider.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-black bg-white dark:bg-zinc-800 text-black dark:text-white font-black text-sm shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
                            >
                              去官网获取 {provider.keyName}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab 3: 功能开关 */}
            {activeTab === 'features' && (
              <div>
                <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-4">
                  按需打开学习助理的各项能力
                </p>

                <div className="space-y-3">
                  {featureRows.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center justify-between gap-4 border-2 border-black rounded-2xl p-4 bg-white dark:bg-zinc-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <div>
                        <div className="font-black text-black dark:text-white">
                          {row.title}
                        </div>
                        <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {row.description}
                        </p>
                      </div>
                      <Toggle
                        checked={row.checked}
                        onChange={row.onChange}
                        label={row.title}
                      />
                    </div>
                  ))}
                </div>

                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mt-4">
                  这些开关即时生效，并保存在本机浏览器，不会同步到服务器。
                </p>
              </div>
            )}
          </div>

          {/* 当前配置摘要 */}
          <div className="mt-6 bg-white dark:bg-zinc-900 border-2 border-black rounded-3xl p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h3 className="font-black text-black dark:text-white mb-3">
              当前配置
            </h3>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div className="font-semibold text-zinc-500 dark:text-zinc-400">
                模型{' '}
                <span className="font-black text-black dark:text-white">
                  {currentModel?.name || model}
                </span>
              </div>
              <div className="font-semibold text-zinc-500 dark:text-zinc-400">
                厂商{' '}
                <span className="font-black text-black dark:text-white">
                  {currentProviderName}
                </span>
              </div>
              <div className="flex items-center gap-2 font-semibold text-zinc-500 dark:text-zinc-400">
                API 状态
                {hasApiKey ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border-2 border-black text-[11px] font-bold shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] bg-green-200 dark:bg-green-700 text-black dark:text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                    已配置
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border-2 border-black text-[11px] font-bold shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] bg-red-200 dark:bg-red-800 text-black dark:text-white">
                      未配置
                    </span>
                    <button
                      onClick={() => setActiveTab('providers')}
                      className="font-black text-black dark:text-white underline underline-offset-2 hover:text-amber-600 dark:hover:text-amber-400"
                    >
                      去 API 配置页填写
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </UserLayout>
  );
}

function getApiKeyUrl(providerId: string): string {
  const urls: Record<string, string> = {
    openai: 'https://platform.openai.com/api-keys',
    anthropic: 'https://console.anthropic.com/settings/keys',
    google: 'https://aistudio.google.com/app/apikey',
    deepseek: 'https://platform.deepseek.com/api_keys',
    alibaba: 'https://dashscope.console.aliyun.com/apiKey',
    zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
    moonshot: 'https://platform.moonshot.cn/console/api-keys',
    cohere: 'https://dashboard.cohere.com/api-keys',
    mistral: 'https://console.mistral.ai/api-keys/',
  };
  return urls[providerId] || '#';
}
