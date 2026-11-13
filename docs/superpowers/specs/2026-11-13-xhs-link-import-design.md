# 小红书链接导入（含视频配音转写）设计

日期：2026-11-13

## 目标

新建菜谱的 AI 导入面板支持粘贴小红书分享链接：服务端抓取笔记正文、图片；视频笔记的配音用阿里云百炼 Paraformer 录音文件识别转成文字。抓到的内容先回填到现有的「笔记文字」和「截图」里，用户可改，再点「开始解析」走现有 `import-recipe`。

## 流程（方案 C：两段式）

1. 客户端「粘贴小红书链接」→ `POST fetch-xhs-note { url }`。
2. `fetch-xhs-note`：
   - 校验链接域名（`xhslink.com` / `xiaohongshu.com`），展开短链，抓笔记页 HTML。
   - 从 `window.__INITIAL_STATE__` 取标题、正文、图片、视频地址；取不到时退回 `og:*` meta。
   - 视频笔记：向百炼提交转写任务（`paraformer-v2`，`file_urls` 直接填视频 CDN 地址，`X-DashScope-Async: enable`），**不等结果**，把 task id 签进 `transcriptTicket` 返回。
   - 扣一次配额，返回 `importTicket`（HMAC，绑定用户 id，30 分钟有效）。
   - 返回 `{ note: { title, text, imageUrls, isVideo, sourceUrl }, importTicket, transcript: { ticket } | { skipped: reason } }`。
3. 客户端回填正文和图片；有 `transcriptTicket` 时每 3 秒 `POST fetch-xhs-note { transcriptTicket }` 查询，最多 5 分钟。转写到手后以「【视频配音】」前缀追加到文字框。百炼文档说转写「通常数分钟内」，所以不能在一个请求里同步等。
4. 用户点「开始解析」→ `import-recipe { text, images, imageUrls, importTicket, sourceUrl }`。
   - 带有效 `importTicket` 时不再扣配额，失败也不退（因为没扣）。
   - `imageUrls` 由函数带小红书 Referer 下载并转 base64，复用现有大小上限。
   - 模型没给 `sourceUrl` 时用请求里的 `sourceUrl`。

## 错误处理

| 场景 | code | 行为 |
|---|---|---|
| 非小红书链接 | `invalid_link` | 报错 |
| 登录墙 / 反爬 / 解析不到笔记 | `fetch_blocked` | 报错，引导截图或贴正文 |
| 笔记删除 / 私密 | `note_unavailable` | 报错 |
| 未配 `DASHSCOPE_API_KEY` | — | `transcript.skipped = "not_configured"`，正文图片照常回填 |
| 提交转写失败 | — | `transcript.skipped = "failed"` |
| 转写任务失败（含百炼下载视频失败）/ 超时 | — | 客户端提示「配音没识别出来，可以手动补做法」 |

抓取失败退还配额；转写失败不退（正文图片已经交付）。

## 配额

`importTicket` = base64url(`{sub, exp}`) + HMAC-SHA256，密钥 `IMPORT_TICKET_SECRET`，未设置时回退 `SUPABASE_SERVICE_ROLE_KEY`。30 分钟内同一用户可凭票免扣解析（已知的放宽，第一版接受）。

## 配置

- `supabase secrets set DASHSCOPE_API_KEY=sk-...`
- 可选 `DASHSCOPE_BASE_URL`（默认 `https://dashscope.aliyuncs.com`，北京地域；也可填工作空间域名 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`）。Paraformer 文档只列了北京地域。
- 可选 `IMPORT_TICKET_SECRET`。

## 已知风险

- 小红书页面结构、反爬随时可能变，解析器做成独立纯函数并有单测，坏了只改一处。
- 视频 CDN 若校验 Referer，百炼下载会失败（`InvalidFile.DownloadFailed`）。第一版降级为「配音没识别出来」，若实测频繁失败，再加「函数下载 → Supabase Storage 签名链接 → 交给百炼」的兜底。

## 测试

- Deno 单测：链接校验、`__INITIAL_STATE__` / og 解析、票据签发校验、转写结果解析。
- 集成：本地 `supabase functions serve` 跑一条图文、一条视频笔记（需要百炼 key 和真实链接）。
- 客户端：`tsc --noEmit`、`expo lint`，Expo Go 走通「链接 → 回填 → 解析 → 草稿」。

## 变更（2026-11-13）：改为手机抓取页面

线上实测：Supabase 函数在新加坡，访问小红书超时（`timeout`）；Supabase 没有中国大陆区域。

- 手机用 iPhone Safari UA 打开分享链接（桌面 UA 会跳 `/login`，微信 UA 会跳微信授权），用共享的 `fetch-xhs-note/xhs.ts` 解析。
- `fetch-xhs-note` 不再抓页面，只接收 `{ note }`：校验字段（来源链接必须是小红书域名，图片/视频地址必须是 `https://*.xhscdn.com`，限长），然后扣配额、签 importTicket、提交百炼转写。
- 解析失败在手机上就报错，不扣次数。
- 笔记图片也改为在手机上带 Referer 下载转 base64，不再让 `import-recipe` 从新加坡拉国内 CDN（`import-recipe` 仍保留 `imageUrls` 入参，兼容旧客户端）。
- 已知限制：视频地址仍由北京的百炼去下载；Web 端受 CORS 限制，读不了小红书链接。

## 变更（2026-11-13）：视频笔记的步骤图与转写结果

- 百炼转写结果文件在北京 OSS，新加坡函数下载常超时：函数先试 4 秒，拉不到就返回 `{status:"ready", url}`，由手机下载并提取文字（共用 `xhs.ts` 的 `transcriptText`）。
- 转写文字按句输出「[分:秒] 句子」。`import-recipe` 为每一步返回 `videoAt`（秒），手机用 `expo-video-thumbnails` 按该时间截帧，压缩后作为没配到图的步骤的步骤图。
