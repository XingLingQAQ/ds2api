# 心跳配置功能重构计划

## 概述

将心跳配置从"选择curl命令"模式重构为"基于URL的可配置心跳"模式。

**核心变化**：
- ✅ 支持多个URL同时发送心跳
- ✅ 每个URL独立配置间隔时间
- ✅ curl命令作为导入模板，可解析为URL配置
- ✅ 完全替换旧的基于curl选择的方式

## 架构设计

### 数据模型

**新表：heartbeat_url_configs**
```typescript
{
  id: number;
  name: string;                    // URL配置名称
  url: string;                     // 目标URL
  method: string;                  // HTTP方法（GET/POST/PUT/DELETE）
  headers: Record<string, string>; // 请求头（JSONB）
  body: string | null;             // 请求体
  intervalSeconds: number;         // 独立的心跳间隔（10-3600秒）
  isEnabled: boolean;              // 是否启用此配置
  lastSuccessAt: Date | null;      // 统计：上次成功时间
  lastErrorAt: Date | null;        // 统计：上次失败时间
  lastErrorMessage: string | null; // 统计：上次错误信息
  successCount: number;            // 统计：成功次数
  failureCount: number;            // 统计：失败次数
  providerId: number | null;       // 关联的供应商ID（可选）
  model: string | null;            // 模型名称（展示用）
  endpoint: string | null;         // 端点路径（展示用）
  createdAt: Date;
  updatedAt: Date;
}
```

**修改表：heartbeat_settings**
```typescript
{
  id: number;
  enabled: boolean;  // 全局开关（保留）
  // 删除：intervalSeconds, savedCurls, selectedCurlIndex
  createdAt: Date;
  updatedAt: Date;
}
```

### 心跳执行逻辑

**ProviderHeartbeat类重构**：
```typescript
class ProviderHeartbeat {
  // 多定时器管理：Map<configId, timer>
  private static timers: Map<number, NodeJS.Timeout> = new Map();

  // 启动：为每个启用的URL配置创建独立定时器
  static async start() {
    const configs = await findEnabledHeartbeatUrlConfigs();
    for (const config of configs) {
      this.startConfigTimer(config);
    }
  }

  // 停止：清除所有定时器
  static stop() {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  // 单个配置的定时器
  private static startConfigTimer(config: HeartbeatUrlConfig) {
    const interval = setInterval(() => {
      this.sendHeartbeat(config);
    }, config.intervalSeconds * 1000);
    this.timers.set(config.id, interval);
  }

  // 发送心跳并记录成功/失败
  private static async sendHeartbeat(config: HeartbeatUrlConfig) {
    const response = await fetch(config.url, {
      method: config.method,
      headers: config.headers,
      body: config.body,
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      await recordHeartbeatSuccess(config.id);
    } else {
      await recordHeartbeatFailure(config.id, errorMessage);
    }
  }
}
```

### 前端UI设计

**页面布局**：
```
/settings/heartbeat/page.tsx
├── GlobalSettingsCard（全局开关）
├── CurlHistorySection（curl历史记录 + 导入按钮）
└── UrlConfigsSection（URL配置列表 + 新建/编辑/删除）
```

**组件拆分**：
- `global-settings-card.tsx` - 全局开关卡片
- `curl-history-section.tsx` - curl历史记录区域
- `curl-history-card.tsx` - 单个curl历史卡片
- `url-configs-section.tsx` - URL配置列表区域
- `url-config-card.tsx` - 单个URL配置卡片
- `url-config-dialog.tsx` - 新建/编辑对话框
- `_lib/hooks.ts` - 自定义hooks（useHeartbeatPageData）

**curl导入流程**：
1. 用户点击curl历史卡片上的"导入"按钮
2. 使用`parseCurlCommand()`解析curl命令
3. 自动打开新建对话框，表单预填充解析后的数据
4. 用户修改后保存，创建URL配置

## 实施步骤

### 阶段1：数据库和Repository层

1. **修改schema.ts**
   - 添加`heartbeatUrlConfigs`表定义
   - 修改`heartbeatSettings`表定义（删除3个字段）

2. **生成和审查迁移**
   ```bash
   bun run db:generate
   # 检查生成的 drizzle/0061_*.sql
   # 确保数据迁移逻辑正确（将选中的curl转为第一个URL配置）
   ```

3. **创建repository/heartbeat-url-configs.ts**
   - 接口：`HeartbeatUrlConfig`、`CreateHeartbeatUrlConfigInput`、`UpdateHeartbeatUrlConfigInput`
   - 函数：
     - `findAllHeartbeatUrlConfigs()` - 获取所有配置
     - `findEnabledHeartbeatUrlConfigs()` - 获取启用的配置
     - `findHeartbeatUrlConfigById(id)` - 根据ID获取
     - `createHeartbeatUrlConfig(input)` - 创建配置
     - `updateHeartbeatUrlConfig(id, input)` - 更新配置
     - `deleteHeartbeatUrlConfig(id)` - 删除配置
     - `recordHeartbeatSuccess(id)` - 记录成功
     - `recordHeartbeatFailure(id, errorMessage)` - 记录失败

4. **修改repository/heartbeat-settings.ts**
   - 简化为只管理全局开关
   - 删除`savedCurls`和`selectedCurlIndex`相关逻辑
   - 保持`getHeartbeatSettings()`和`updateHeartbeatSettings()`接口

5. **运行迁移**
   ```bash
   bun run db:migrate
   ```

### 阶段2：Action层

6. **创建actions/heartbeat-url-configs.ts**
   - `fetchHeartbeatUrlConfigs()` - 获取所有配置
   - `createHeartbeatUrlConfigAction(input)` - 创建配置
   - `updateHeartbeatUrlConfigAction(id, input)` - 更新配置
   - `deleteHeartbeatUrlConfigAction(id)` - 删除配置
   - 验证规则：
     - 名称不能为空
     - URL不能为空
     - 间隔时间范围：10-3600秒
   - 权限检查：仅admin可操作
   - 副作用：修改配置后重启心跳任务

7. **修改actions/heartbeat-settings.ts**
   - 简化为只管理全局开关
   - 保持`fetchHeartbeatSettings()`和`saveHeartbeatSettings()`
   - 开关变化时重启心跳任务

### 阶段3：心跳执行逻辑

8. **重构lib/provider-heartbeat.ts**
   - 添加`timers: Map<number, NodeJS.Timeout>`
   - 修改`start()`：为每个启用的配置创建定时器
   - 修改`stop()`：清除所有定时器
   - 新增`startConfigTimer(config)`：创建单个配置的定时器
   - 新增`stopConfigTimer(configId)`：停止单个配置的定时器
   - 修改`sendHeartbeat(config)`：发送请求并记录结果
   - 删除curl解析逻辑（不再需要）

9. **修改app/v1/_lib/proxy/forwarder.ts**
   - 删除或注释掉`addSuccessfulCurl()`调用（第357-367行）
   - curl历史功能迁移到独立模块（可选）

### 阶段4：i18n文案

10. **更新翻译文件**
    - `messages/zh-CN/settings/heartbeat.json`
    - `messages/zh-TW/settings/heartbeat.json`
    - `messages/en/settings/heartbeat.json`
    - `messages/ja/settings/heartbeat.json`
    - `messages/ru/settings/heartbeat.json`

    新增key：
    - `section.global.*` - 全局设置区域
    - `section.curlHistory.*` - curl历史区域
    - `section.urlConfigs.*` - URL配置区域
    - `form.name.*` - 配置名称字段
    - `form.url.*` - URL字段
    - `form.method.*` - HTTP方法字段
    - `form.headers.*` - 请求头字段
    - `form.body.*` - 请求体字段
    - `form.isEnabled.*` - 启用开关
    - `form.stats.*` - 统计信息
    - `form.createButton`、`importButton`等

### 阶段5：前端UI

11. **创建组件**
    - `app/[locale]/settings/heartbeat/_components/global-settings-card.tsx`
      - Switch组件：全局开关
      - 说明文字

    - `app/[locale]/settings/heartbeat/_components/curl-history-section.tsx`
      - 区域标题和描述
      - curl历史卡片列表
      - 空状态提示

    - `app/[locale]/settings/heartbeat/_components/curl-history-card.tsx`
      - 显示：供应商名、端点、模型、时间
      - 导入按钮

    - `app/[locale]/settings/heartbeat/_components/url-configs-section.tsx`
      - 区域标题和描述
      - 新建按钮
      - URL配置卡片列表
      - 空状态提示

    - `app/[locale]/settings/heartbeat/_components/url-config-card.tsx`
      - 显示：名称、URL、方法、间隔、启用状态
      - 统计信息：成功次数、失败次数、最后成功/失败时间
      - 编辑按钮、删除按钮
      - Switch组件：快速启用/禁用

    - `app/[locale]/settings/heartbeat/_components/url-config-dialog.tsx`
      - Dialog表单：名称、URL、方法、headers、body、间隔
      - 支持新建和编辑模式
      - headers使用Textarea（JSON格式）
      - body使用Textarea（可选）
      - 验证和错误提示

    - `app/[locale]/settings/heartbeat/_components/heartbeat-skeleton.tsx`
      - 骨架屏加载状态

12. **创建hooks**
    - `app/[locale]/settings/heartbeat/_lib/hooks.ts`
      - `useHeartbeatPageData()`：
        - 加载settings、configs、savedCurls
        - 提供CRUD操作函数
        - 提供importFromCurl函数
        - 统一错误处理和toast提示

13. **重写page.tsx**
    - 使用`useHeartbeatPageData()`
    - 组合所有子组件
    - 加载状态和错误处理

### 阶段6：测试和验证

14. **类型检查和格式化**
    ```bash
    bun run typecheck
    bun run lint:fix
    ```

15. **手动测试流程**
    - [ ] 访问 `/settings/heartbeat` 页面
    - [ ] 创建新的URL配置
    - [ ] 从curl历史导入配置
    - [ ] 编辑配置（修改URL、间隔等）
    - [ ] 启用/禁用单个配置
    - [ ] 启用/禁用全局开关
    - [ ] 删除配置
    - [ ] 检查多个URL同时发送心跳
    - [ ] 检查失败记录和统计信息
    - [ ] 检查国际化（切换语言）

16. **日志验证**
    ```bash
    # 检查心跳日志
    tail -f logs/app.log | grep "ProviderHeartbeat"

    # 应该看到：
    # - "Timer started" - 定时器启动
    # - "Heartbeat sent successfully" - 成功日志
    # - "Heartbeat failed" - 失败日志
    ```

17. **数据库验证**
    ```bash
    bun run db:studio
    # 检查 heartbeat_url_configs 表
    # 确认配置已保存
    # 确认成功/失败统计更新
    ```

## 关键文件清单

### 新建文件
- `src/repository/heartbeat-url-configs.ts` - URL配置Repository
- `src/actions/heartbeat-url-configs.ts` - URL配置Actions
- `src/app/[locale]/settings/heartbeat/_components/global-settings-card.tsx`
- `src/app/[locale]/settings/heartbeat/_components/curl-history-section.tsx`
- `src/app/[locale]/settings/heartbeat/_components/curl-history-card.tsx`
- `src/app/[locale]/settings/heartbeat/_components/url-configs-section.tsx`
- `src/app/[locale]/settings/heartbeat/_components/url-config-card.tsx`
- `src/app/[locale]/settings/heartbeat/_components/url-config-dialog.tsx`
- `src/app/[locale]/settings/heartbeat/_lib/hooks.ts`
- `drizzle/0061_*.sql` - 数据库迁移文件（自动生成）

### 修改文件
- `src/drizzle/schema.ts` - 添加新表，修改旧表
- `src/repository/heartbeat-settings.ts` - 简化逻辑
- `src/actions/heartbeat-settings.ts` - 简化Action
- `src/lib/provider-heartbeat.ts` - 重构心跳执行逻辑
- `src/app/v1/_lib/proxy/forwarder.ts` - 删除curl保存逻辑
- `src/app/[locale]/settings/heartbeat/page.tsx` - 重写UI
- `messages/*/settings/heartbeat.json` - 更新翻译（5种语言）

### 删除文件
- `src/app/[locale]/settings/heartbeat/_components/heartbeat-form.tsx` - 旧表单组件

## 数据迁移策略

**迁移逻辑（在0061_*.sql中）**：
```sql
-- 创建新表
CREATE TABLE heartbeat_url_configs (...);

-- 迁移现有数据
DO $$
DECLARE
  settings_row RECORD;
  selected_curl JSONB;
BEGIN
  SELECT * INTO settings_row FROM heartbeat_settings LIMIT 1;

  IF settings_row.selected_curl_index IS NOT NULL THEN
    selected_curl := settings_row.saved_curls->settings_row.selected_curl_index;

    INSERT INTO heartbeat_url_configs (
      name, url, interval_seconds, is_enabled, ...
    ) VALUES (
      selected_curl->>'providerName',
      selected_curl->>'url',
      settings_row.interval_seconds,
      settings_row.enabled,
      ...
    );
  END IF;
END $$;

-- 删除旧字段
ALTER TABLE heartbeat_settings
  DROP COLUMN interval_seconds,
  DROP COLUMN saved_curls,
  DROP COLUMN selected_curl_index;
```

**回滚能力**：保留旧数据在迁移文件中，可以通过反向迁移恢复。

## 风险和缓解

| 风险 | 缓解措施 |
|------|----------|
| 数据迁移失败 | 1. 迁移前备份数据库<br>2. 在测试环境验证<br>3. 编写回滚脚本 |
| curl解析不完整 | 1. 复用现有`parseCurlCommand`<br>2. 添加解析错误提示<br>3. 允许手动编辑 |
| 多定时器性能问题 | 1. 限制最大配置数量（如20个）<br>2. 添加禁用功能<br>3. 监控日志 |
| 心跳发送失败 | 1. 记录失败日志<br>2. UI显示失败状态<br>3. 支持手动禁用 |

## 验证清单

- [ ] 数据库迁移成功，旧数据已转移
- [ ] 类型检查通过 (`bun run typecheck`)
- [ ] Lint检查通过 (`bun run lint`)
- [ ] 构建成功 (`bun run build`)
- [ ] 可以创建URL配置
- [ ] 可以从curl导入配置
- [ ] 可以编辑和删除配置
- [ ] 全局开关控制所有心跳
- [ ] 多个URL同时发送心跳（检查日志）
- [ ] 失败统计正确记录
- [ ] 所有5种语言显示正常
- [ ] 页面加载和交互流畅

## 预估工作量

- 数据库和Repository层：1-2小时
- Action层：30分钟
- 心跳执行逻辑：1小时
- i18n文案：30分钟
- 前端UI：2-3小时
- 测试和验证：1小时
- **总计：6-8小时**
