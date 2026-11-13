-- 菜谱封面：只存 Storage 相对路径 + 真实像素，不存签名 URL。
alter table public.recipes add column if not exists cover jsonb;

-- 桶上限（客户端会先压到长边 1600 / quality 0.7，正常 300~600KB）：
-- 这里只是最后一层保险，别让一张 HEIC 原图把单文件限制撑爆。
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'recipe-media';
