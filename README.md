# 好好吃饭

一个管「今天吃什么、怎么做、去买什么」的做饭 App，也是朋友之间分享家常菜的小社区。

用 Expo / React Native 写的 Android 应用（iOS 代码同样可以跑），后端是 Supabase。本地优先：不登录也能完整使用，登录后数据在多台设备间同步。

## 下载

Android 安装包：[haohao-chifan-1.0.0.apk](https://github.com/n7s4/haohao-chifan/releases/latest/download/haohao-chifan-1.0.0.apk)（[所有版本](https://github.com/n7s4/haohao-chifan/releases)）

下载后直接安装。如果手机拦截"未知来源"，在设置里允许浏览器或文件管理器安装应用。装好之后，新版本会通过热更新自动推送，下次打开 App 时生效。

## 功能

### 找菜、做菜

- **发现页**：内置菜谱和社区菜谱两个视图，按分类、热量筛选。
- **减脂餐专题**：15 道内置减脂菜，分早餐、正餐、加餐，标注热量和蛋白质、碳水、脂肪（数值为估算）。
- **菜谱详情**：按份数换算食材用量，可以收藏、打分、加入一周计划。
- **烹饪模式**：一步一屏，分步计时器，计时结束发系统通知；做饭时屏幕常亮；中途退出后能恢复到原来那一步。

### 计划和采购

- **一周菜单**：按天、按餐排菜，一键清空某天。
- **采购清单**：根据本周菜单自动汇总食材，可以勾选、改数量、手动加减，没买完的会带到下一周。

### 自己的菜谱

- **新建菜谱**：手动填写，支持封面图和步骤图。
- **AI 导入**：贴一段笔记文字、截图或小红书链接，自动解析成菜谱草稿；视频笔记会截取画面帮你补图。改好再保存。
- **备份**：导出、导入本地数据。

### 账号和同步

- 邮箱注册登录。游客数据在首次登录时可以合并进账号。
- 计划、收藏、采购清单、自建菜谱等在云端同步；离线时的改动先进队列，联网后再推上去。

### 社区

- 把自建菜发布到社区，可以随时更新或撤回。
- 点赞、收藏、评论（支持一层回复），也可以把别人的菜存成自己的私有菜谱。
- 昵称、头像，个人主页。
- 关注、粉丝列表，拉黑，举报菜谱、评论、用户。

### 私信和群聊

- 一对一私信。对方没回关时只能先发一条，防止骚扰；拉黑后双方都发不了。
- 群聊：最多 50 人，只能拉互相关注的人。群主可以改群名、移出成员；群主退群后自动转给其他成员。
- 消息实时到达，有未读角标和已读状态，可以举报消息。

### 热更新

接入 EAS Update。只改 JS 和资源时直接推送，用户下次打开 App 就是新版本，不用重新安装。

## 技术栈

| 层 | 用了什么 |
| --- | --- |
| App | Expo SDK 58、React Native 0.88、React 19、TypeScript（strict） |
| 路由 | expo-router（文件路由、typed routes） |
| 动画和手势 | Reanimated 4、react-native-gesture-handler、react-native-keyboard-controller |
| 本地存储 | AsyncStorage |
| 后端 | Supabase：Postgres + RLS、Auth、Storage、Realtime、Edge Functions |
| AI 导入 | Edge Function 调用 DeepSeek 解析菜谱；阿里云百炼 Paraformer 转写视频配音 |
| 测试 | Deno 单元测试、pgTAP 数据库测试 |
| 构建和发布 | EAS Build（APK）、EAS Update |

## 目录结构

```text
src/
  app/                  页面（expo-router 文件路由）
    (tabs)/             底部标签：发现、计划、新建、收藏、我的
    recipe/ cook/       菜谱详情、烹饪模式
    community/ user/    社区菜谱详情、用户主页和关注列表
    messages/           会话列表、私信、群聊
    shopping-list.tsx   采购清单
    fat-loss.tsx        减脂餐专题
    account.tsx sign-in.tsx blocked.tsx ...
  components/           界面组件
  lib/
    sync/               云端同步：离线队列、拉取、合并（说明见 src/lib/sync/README.md）
    community/          社区、关注、私信的接口和纯逻辑（附单元测试）
    supabase.ts         Supabase 客户端和登录
    importRecipe.ts     AI 导入
    cookSession.ts cookNotify.ts  烹饪会话和计时通知
  state/                全局 store
  data/                 内置菜谱、分类、减脂餐数据
supabase/
  migrations/           数据库迁移 001–010
  tests/                pgTAP 测试
  functions/            Edge Functions：import-recipe、fetch-xhs-note
docs/                   运维文档和设计文档
```

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 Supabase（可选）

在项目根目录建 `.env.local`：

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<你的项目>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>   # 也可以用 EXPO_PUBLIC_SUPABASE_ANON_KEY
```

不配置也能运行，只是登录、同步、社区、私信这些云端功能会关掉。所有 `.env*` 文件都在 `.gitignore` 里，不要提交。

### 3. 启动

```bash
npx expo start
```

推荐装开发版客户端（`eas build --profile development`）调试。通知、热更新等原生能力在 Expo Go 里不完整。

### 4. 数据库

迁移文件在 `supabase/migrations/`，按编号顺序执行，每个都可以重复执行。

```bash
supabase start        # 本地起一套 Supabase（需要 Docker）
supabase db reset     # 按顺序应用全部迁移
supabase test db      # 跑 supabase/tests 里的 pgTAP 测试
supabase stop
```

AI 导入要用的 Edge Function 密钥：

```bash
supabase secrets set DEEPSEEK_API_KEY=...       # 必填，菜谱解析
supabase secrets set DASHSCOPE_API_KEY=...      # 可选，视频配音转写
# 可选：DEEPSEEK_MODEL、DASHSCOPE_BASE_URL、IMPORT_TICKET_SECRET
```

## 检查和测试

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint
npm run test:unit     # Deno 单元测试（社区、关注、私信逻辑）
supabase test db      # 数据库权限和规则测试
```

## 构建和发布

| 场景 | 命令 |
| --- | --- |
| 打安装包（内部分发 APK） | `npx eas-cli build --profile preview --platform android` |
| 推送热更新 | 见 [docs/ota-updates.md](docs/ota-updates.md) |

`runtimeVersion` 用的是 `fingerprint` 策略。加原生库、改 app.json 的权限或插件、改 `package.json` 的 scripts 都会改变指纹，这时旧安装包收不到热更新，需要重新打包。

## 文档

- [热更新发布](docs/ota-updates.md)
- [社区管理 SQL](docs/community-admin.md)：处理举报、下架菜谱、隐藏评论
- [真机验证清单](docs/real-device-checklist.md)
- [云端同步说明](src/lib/sync/README.md)
- [设计文档](docs/superpowers/specs/)：小红书导入、社区、减脂餐、关注和私信

## 许可证

[MIT](LICENSE)
