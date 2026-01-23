# DeepSeek2API

[![](https://img.shields.io/github/license/iidamie/deepseek2api.svg)](LICENSE)
![](https://img.shields.io/github/stars/iidamie/deepseek2api.svg)
![](https://img.shields.io/github/forks/iidamie/deepseek2api.svg)

支持高速流式输出、支持多轮对话、支持R1深度思考，多路账号支持。

与ChatGPT接口完全兼容。

## 目录

* [免责声明](#免责声明)
* [接入准备](#接入准备)
  * [多账号接入](#多账号接入)
* [Vercel部署](#Vercel部署)
* [接口列表](#接口列表)
  * [模型列表](#模型列表)
  * [对话补全](#对话补全)
* [注意事项](#注意事项)
  * [Nginx反代优化](#Nginx反代优化)
  * [Token统计](#Token统计)
* [Star History](#star-history)
* [鸣谢](#鸣谢)

## 免责声明

**逆向API是不稳定的，建议前往DeepSeek官方 https://platform.deepseek.com/ 付费使用API，避免封禁的风险。**

**本组织和个人不接受任何资金捐助和交易，此项目是纯粹研究交流学习性质！**

**仅限自用，禁止对外提供服务或商用，避免对官方造成服务压力，否则风险自担！**

**仅限自用，禁止对外提供服务或商用，避免对官方造成服务压力，否则风险自担！**

**仅限自用，禁止对外提供服务或商用，避免对官方造成服务压力，否则风险自担！**

## 接入准备

一个或多个 DeepSeek 账号

### 多账号接入

目前同个账号同时只能有*一路*输出，你可以通过提供多个账号并使用。

每次请求服务会从中挑选一个。

## Vercel部署

> [!NOTE]
> Vercel免费账户的请求响应超时时间为10秒，但接口响应通常较久，可能会遇到Vercel返回的504超时错误！

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/import/project?template=https://github.com/iidamie/deepseek2api)

### 部署步骤

1. **点击上方按钮一键部署到 Vercel**

2. **配置方式选择（二选一）**

#### 方式 A：使用配置文件（推荐用于开发测试）

部署完成后，返回你的 Github 仓库，创建/编辑 `config.json` 文件（可参考 `config.example.json`）：

```json
{
  "keys": [
    "your-api-key-1",
    "your-api-key-2"
  ],
  "accounts": [
    {
      "email": "example1@example.com",
      "password": "password1",
      "token": ""
    },
    {
      "email": "example2@example.com",
      "password": "password2",
      "token": ""
    },
    {
      "mobile": "12345678901",
      "password": "password3",
      "token": ""
    }
  ]
}
```

配置完成后，返回 Vercel 控制台，点击 "Redeploy" 重新部署即可。

> [!WARNING]  
> 一定要是私库，防止信息泄露！

#### 方式 B：使用环境变量（推荐用于生产环境）

在 Vercel 控制台的 Settings → Environment Variables 中添加以下环境变量：

- **环境变量名**：`DS2API_CONFIG_JSON` 或 `CONFIG_JSON`
- **环境变量值**：配置内容的 JSON 字符串（可选：使用 base64 编码）

**JSON 字符串示例**：
```json
{"keys":["your-api-key-1"],"accounts":[{"email":"example@example.com","password":"your-password","token":""}]}
```

**Base64 编码示例**（Linux/Mac）：
```bash
echo '{"keys":["your-api-key-1"],"accounts":[{"email":"example@example.com","password":"your-password","token":""}]}' | base64
```

添加环境变量后，在 Vercel 控制台重新部署即可。

### 配置说明

* `keys` - 你的 API 鉴权密钥（可设置多个）
* `accounts` - DeepSeek 账号列表，支持多个账号轮换，避免单账号受限
* 支持使用 `email` 或 `mobile` 登录
* `token` 字段可以留空，系统会在首次使用时自动登录并填充（注意：Vercel 环境下 token 无法回写）

### 注意事项

- 推荐使用**环境变量**方式配置，更加安全
- 如使用配置文件方式，确保你的 GitHub 仓库是**私有仓库**
- Vercel 免费版有请求时长限制（10秒），如遇 504 错误属正常现象
- Vercel 环境下文件系统是只读的，token 自动更新功能可能受限

## 接口列表

目前支持与openai兼容的 `/v1/chat/completions` 接口，可自行使用与openai或其他兼容的客户端接入接口。

### 模型列表

获取模型列表接口

**GET /v1/models**

响应数据:
```json
{
  "data": [
    {
      "created": 1677610602,
      "id": "deepseek-chat",
      "object": "model",
      "owned_by": "deepseek",
      "permission": []
    },
    {
      "created": 1677610602,
      "id": "deepseek-reasoner",
      "object": "model",
      "owned_by": "deepseek",
      "permission": []
    },
    {
      "created": 1677610602,
      "id": "deepseek-chat-search",
      "object": "model",
      "owned_by": "deepseek",
      "permission": []
    },
    {
      "created": 1677610602,
      "id": "deepseek-reasoner-search",
      "object": "model",
      "owned_by": "deepseek",
      "permission": []
    }
  ],
  "object": "list"
}
```

### 对话补全

对话补全接口，与openai的 [chat-completions-api](https://platform.openai.com/docs/guides/text-generation/chat-completions-api) 兼容。

**POST /v1/chat/completions**

header 需要设置 Authorization 头部：

```
Authorization: Bearer [userToken value or keys]
```

请求数据：
```json
{
    // model名称
    // 默认：deepseek-chat 或 deepseek-v3
    // 深度思考：deepseek-reasoner 或 deepseek-r1
    // 联网搜索：deepseek-chat-search 或 deepseek-v3-search
    // 联网搜索 + 深度思考：deepseek-reasoner-search 或 deepseek-r1-search
    "model": "deepseek-chat",
    // 多轮对话基于消息合并实现，某些场景可能导致能力下降且受单轮最大token数限制
    "messages": [
        {
            "role": "user",
            "content": "你是谁？"
        }
    ],
    // 如果使用流式响应请设置为true，默认false
    "stream": false
}
```

响应数据：
```json
{
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": {
        "content": "您好！我是由中国的深度求索（DeepSeek）公司开发的智能助手DeepSeek-R1。如您有任何任何问题，我会尽我所能为您提供帮助。",
        "reasoning_content": "您好！我是由中国的深度求索（DeepSeek）公司开发的智能助手DeepSeek-R1。如您有任何任何问题，我会尽我所能为您提供帮助。\n",
        "role": "assistant"
      }
    }
  ],
  "created": 1738598554,
  "id": "bc223da6-f091-4687-9f59-b9f2a917bd49",
  "model": "deepseek-r1",
  "object": "chat.completion",
  "usage": {
    "completion_tokens": 37,
    "prompt_tokens": 1,
    "total_tokens": 38
  }
}
```

## 注意事项

### Nginx反代优化

如果您正在使用Nginx反向代理deepseek2api，请添加以下配置项优化流的输出效果，优化体验感。

```nginx
# 关闭代理缓冲。当设置为off时，Nginx会立即将客户端请求发送到后端服务器，并立即将从后端服务器接收到的响应发送回客户端。
proxy_buffering off;
# 启用分块传输编码。分块传输编码允许服务器为动态生成的内容分块发送数据，而不需要预先知道内容的大小。
chunked_transfer_encoding on;
# 开启TCP_NOPUSH，这告诉Nginx在数据包发送到客户端之前，尽可能地发送数据。这通常在sendfile使用时配合使用，可以提高网络效率。
tcp_nopush on;
# 开启TCP_NODELAY，这告诉Nginx不延迟发送数据，立即发送小数据包。在某些情况下，这可以减少网络的延迟。
tcp_nodelay on;
# 设置保持连接的超时时间，这里设置为120秒。如果在这段时间内，客户端和服务器之间没有进一步的通信，连接将被关闭。
keepalive_timeout 120;
```

### Token统计

符合 OPENAI 接口规范

示例:
```json
"usage": {
  "completion_tokens": 37,
  "prompt_tokens": 1,
  "total_tokens": 38
}
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=iidamie/deepseek2api&type=Date)](https://star-history.com/#iidamie/deepseek2api&Date)

## 鸣谢

本项目部分代码参考了 [LLM-Red-Team/deepseek-free-api](https://github.com/LLM-Red-Team/deepseek-free-api)，在此表示感谢
