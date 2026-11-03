# 云端同步层（Ethan）

本地 AsyncStorage blob 仍是唯一真源；这一层只负责**把本地改动推上去、把云端改动拉下来**。
UI 和 store 的形状完全不变，不存在「表 → state」的直搬。

## 文件

| 文件 | 职责 |
| --- | --- |
| `../supabase.ts` | 单例 client、`getCurrentUserId()`、邮箱登录/注册/登出 |
| `ids.ts` | 确定性 uuid：同一业务键恒定同一个 id |
| `outbox.ts` | 离线队列：入队、合并、退避重试、丢弃不可重试错误 |
| `mutations.ts` | 业务语义 → 表格行的映射，store 只调这几个函数 |
| `pull.ts` | 拉云端快照（plan / prefs / items / cook_log） |
| `merge.ts` | 快照 → 本地 blob，队列里未推送的键一律以本地为准 |
| `engine.ts` | `syncNow()` 总入口 + 前后台/联网触发 |

## store 接线（已完成）

`src/state/store.tsx` 已经全部接好，这里是接线方式，改 store 时对照着看：

- `userIdRef` 存当前登录用户；`null` 即游客态，`pushRemote()` 直接返回，**不发任何请求**。
- 登录态来源有两个：启动时 `getCurrentUserId()` 探一次，之后订阅 `onAuthStateChange`。登录页在别的屏，store 不用重启就能跟上，`sessionVersion` 变化会重跑同步。
- 8 个写操作各自在改完本地之后调一次 `pushRemote`：`setMeal` / `clearDay`（每个已占用餐位写一条 tombstone）/ `toggleFavorite` / `rateRecipe` / `setServings` / `toggleChecked` / `setQty` / `addManualItem` / `removeManualItem`（tombstone）/ `removeItem` / `restoreRemoved` / `logCooked`。

派生食材（按本周菜单现算）也能移除：本地记在 `removed[weekKey::id]`，云端写 `deleted: true` 的 tombstone；
pull 时 `merge.ts` 把派生行的 `deleted` 翻回 `removed`，否则下次拉取或下周重排同一道菜它会自己长回来。
- 同步循环：`ready` 之后跑一次 `syncNow(applyRemote, localSnapshot())`，再用 `watchForeground` 在回前台 / 联网时补一次。

```ts
syncNow((next) => {
  // 同步在途时用户可能又改了本地，这时丢弃本次合并，否则会把刚做的操作回滚
  if (cancelled || mutationCount.current !== before) return;
  applyRemote(next);
}, localSnapshot());
```

`mutationCount` 每次本地写都 +1，是防「异步合并覆盖用户刚做的操作」的唯一保险。

## 首次登录：本地优先

新用户云端是空的，直接 pull 会把本地攒了几周的菜单整个盖掉。所以 `engine.ts` 在第一次同步前做了 `bootstrap`：

1. `isSeeded(userId)` —— 按 userId 记在 AsyncStorage，只做一次；
2. `hasRemoteData()` —— 云端三张表 count 都为 0 才算空；
3. 云端空且本地有数据 → `seedFromLocal()` 把整份本地状态铺进队列，随后正常 flush；
4. `markSeeded()`。

全部是幂等 upsert，标记写失败最多重复推一次，不会产生重复行。

## 两个容易踩的点

1. **部分更新只带改动的列。** `shopping_items.name` 是 `not null`，派生条目的 id 就是 `${name}|${unit}`，`buildDerivedItemRow` 会拆回来补齐；勾选和数量各自只在本次改动时才进 payload，所以「先勾选再改数量」不会把勾选抹回 false。
2. **`enqueue` 按列合并而不是整行替换。** 同 key 的两条改动 `{favorite:true}` + `{rating:5}` 合并成 `{favorite:true,rating:5}`，保留原 `queuedAt`，并把 `attempts` 重置为 0（重试次数只对同一次改动有意义）。

## 与 schema 的约定（依赖 002_key_fixes.sql）

- `recipes` / `shopping_items`：`onConflict: 'user_id,id'`。
- `meal_plan_entries`：`onConflict: 'id'`。live 唯一索引是**部分索引**（`where deleted = false`），PostgREST 的 `on_conflict` 推断不到它，所以 id 由 `planEntryId(userId, dayKey, slot)` 确定性生成；清空餐位写 `deleted = true` 的 tombstone，永不物理删除。
- `recipe_prefs`：`onConflict: 'user_id,recipe_id'`，只带本次改动的列，避免把其它列覆盖成默认值。
- `cook_log`：`onConflict: 'id'`，id 由 `(userId, recipeId, cookedOn)` 确定性生成，重复记录天然幂等。
- 所有行都带 `updated_at`；服务端触发器 `touch_updated_at()` 会覆盖它，客户端时钟不准也不会影响「后写赢」。
