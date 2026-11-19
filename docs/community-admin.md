# 社区管理 SQL

社区没有后台页面，管理员在 Supabase Dashboard 的 SQL Editor 里（以 `postgres` 角色）处理。
客户端（`anon` / `authenticated`）对 `community_reports` 没有 select / update 权限，所以举报只能在这里看。

约定：

- 下面的 `<...>` 是占位符，执行前替换成真实 uuid。
- 菜谱 `status`：`published`（公开）/ `withdrawn`（作者撤回）/ `removed`（管理员下架）。客户端不能把 `removed` 改回去，也不能碰 `removed` 的行，只有管理员能改。
- 评论有两个互不相干的开关：`hidden` 是管理员隐藏（本文用的）；`deleted` 是用户侧软删除（评论者本人或菜的作者删除，同时清空 body 并让 `comment_count` 减 1），管理员不要用它来隐藏评论。
- 隐藏一条顶层评论后，它下面的回复也会一并看不到（回复的可见性依赖父评论）。
- `hidden` 不会改 `comment_count`（只有 `deleted` 触发计数），隐藏后该菜的评论数不变，这是预期行为。

## 1. 查看未处理举报

关联出被举报的菜名 / 评论内容、评论所属的菜、举报人昵称：

```sql
select
  r.id                                  as report_id,
  r.created_at,
  r.reason,                             -- ad / unfriendly / irrelevant / other
  case when r.community_recipe_id is not null then '菜谱' else '评论' end as target_type,
  coalesce(cr.name, pc.name)            as recipe_name,      -- 被举报的菜名（评论则为所属菜名）
  cr.status                             as recipe_status,
  c.id                                  as comment_id,
  c.body                                as comment_body,     -- 被举报的评论内容
  c.hidden                              as comment_hidden,
  c.deleted                             as comment_deleted,
  pp.nickname                           as reporter_nickname
from public.community_reports r
left join public.community_recipes  cr on cr.id = r.community_recipe_id
left join public.community_comments c  on c.id  = r.comment_id
left join public.community_recipes  pc on pc.id = c.community_recipe_id
left join public.public_profiles    pp on pp.user_id = r.reporter_id
where r.resolved = false
order by r.created_at;
```

## 2. 下架菜谱

```sql
update public.community_recipes
   set status = 'removed'
 where id = '<community_recipe_id>'
returning id, name, status;
```

下架后：公开列表、详情、评论都看不到；作者仍能在自己的发布记录里看到这条（`removed`），但不能再改它，也不能往它的目录上传图片。

## 3. 隐藏评论

```sql
update public.community_comments
   set hidden = true
 where id = '<comment_id>'
returning id, hidden, left(body, 30) as body;
```

撤销隐藏：把 `hidden` 改回 `false`。

## 4. 把举报标记为已处理

按举报 id：

```sql
update public.community_reports
   set resolved = true
 where id = '<report_id>'
returning id, reason, resolved;
```

某个目标的举报一次性处理（处理完菜或评论后用）：

```sql
update public.community_reports
   set resolved = true
 where resolved = false
   and (community_recipe_id = '<community_recipe_id>' or comment_id = '<comment_id>')
returning id, reason;
```

## 5. 恢复被下架的菜谱

```sql
-- 直接恢复公开（published_at 会被触发器刷新为当前时间，排到列表最前）
update public.community_recipes
   set status = 'published'
 where id = '<community_recipe_id>' and status = 'removed'
returning id, name, status, published_at;

-- 更保守：恢复为 withdrawn，由作者自己决定是否重新发布
update public.community_recipes
   set status = 'withdrawn'
 where id = '<community_recipe_id>' and status = 'removed'
returning id, name, status;
```

只在确认误伤或作者已整改时恢复；不确定就用第二条，让作者自己重新发布。

## 6. 查看某道菜最近的评论

含已隐藏 / 已删除的，方便处理举报时看上下文（`hidden` / `deleted` 列直接标明状态）：

```sql
select
  c.id, c.created_at, c.parent_id,
  pp.nickname,
  c.body,
  c.hidden, c.deleted
from public.community_comments c
left join public.public_profiles pp on pp.user_id = c.user_id
where c.community_recipe_id = '<community_recipe_id>'
order by c.created_at desc
limit 50;
```
