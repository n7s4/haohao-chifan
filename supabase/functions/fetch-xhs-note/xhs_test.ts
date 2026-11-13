import { assert, assertEquals } from "jsr:@std/assert@1";

import { signTicket, verifyTicket } from "../_shared/ticket.ts";
import { interpretTask } from "./asr.ts";
import { cleanDesc, extractShareUrl, isAllowedHost, noteToText, parseNotePage, transcriptText } from "./xhs.ts";

Deno.test("extractShareUrl 从整段分享文案里挑出小红书链接", () => {
  const share = "【番茄炒蛋 - 小美 | 小红书】 😆 abcd 😆 http://xhslink.com/a/AbC123，复制本条信息，打开【小红书】App查看精彩内容！";
  assertEquals(extractShareUrl(share)?.toString(), "http://xhslink.com/a/AbC123");
  const shareCn = "可乐鸡翅 今天做一道新手也能轻松成功的可乐鸡翅。 鸡... https://xhslink.cn/o/4RVWkBPogvq 先复制这段口令，再去【小红书】打开笔记~";
  assertEquals(extractShareUrl(shareCn)?.toString(), "https://xhslink.cn/o/4RVWkBPogvq");
  assertEquals(
    extractShareUrl("https://www.xiaohongshu.com/explore/66a1b2c3d4e5f60718293a4b?xsec_token=x")?.hostname,
    "www.xiaohongshu.com",
  );
});

Deno.test("extractShareUrl 拒绝非小红书域名（不做任意 URL 代理）", () => {
  assertEquals(extractShareUrl("https://example.com/a"), null);
  assertEquals(extractShareUrl("https://xiaohongshu.com.evil.com/a"), null);
  assertEquals(extractShareUrl("https://evil.com/?u=https"), null);
  assertEquals(extractShareUrl("没有链接"), null);
  assert(!isAllowedHost(new URL("ftp://xhslink.com/a")));
});

const desktopState = {
  note: {
    noteDetailMap: {
      "66a1b2c3d4e5f60718293a4b": {
        comments: { list: [] },
        note: {
          type: "normal",
          title: "番茄炒蛋",
          desc: "鸡蛋 3 个 番茄 2 个\n先炒蛋再炒番茄 #家常菜[话题]# [笑哭R]",
          imageList: [
            { urlDefault: "http://sns-webpic-qc.xhscdn.com/a.jpg", urlPre: "http://x/pre.jpg" },
            { infoList: [{ imageScene: "WB_PRV", url: "http://x/prv.jpg" }, { imageScene: "WB_DFT", url: "http://sns-webpic-qc.xhscdn.com/b.jpg" }] },
          ],
        },
      },
    },
  },
};

Deno.test("parseNotePage 读桌面页 __INITIAL_STATE__（含 undefined 字面量）", () => {
  const raw = JSON.stringify(desktopState).replace('"comments":{"list":[]}', '"comments":{"list":[],"cursor":undefined}');
  const html = `<html><script>window.__INITIAL_STATE__=${raw}</script></html>`;
  const result = parseNotePage(html);
  assertEquals(result.kind, "note");
  if (result.kind !== "note") return;
  assertEquals(result.note.title, "番茄炒蛋");
  assertEquals(result.note.text, "鸡蛋 3 个 番茄 2 个\n先炒蛋再炒番茄 #家常菜");
  assertEquals(result.note.imageUrls, [
    "https://sns-webpic-qc.xhscdn.com/a.jpg",
    "https://sns-webpic-qc.xhscdn.com/b.jpg",
  ]);
  assertEquals(result.note.isVideo, false);
  assertEquals(result.note.videoUrl, null);
});

Deno.test("parseNotePage 读视频笔记的视频地址", () => {
  const state = {
    noteData: {
      data: {
        noteData: {
          type: "video",
          title: "红烧肉",
          desc: "看视频",
          imageList: [{ url: "https://sns-webpic-qc.xhscdn.com/cover.jpg" }],
          video: { media: { stream: { h264: [{ masterUrl: "http://sns-video-bd.xhscdn.com/v.mp4" }] } } },
        },
      },
    },
  };
  const result = parseNotePage(`<script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script>`);
  assertEquals(result.kind, "note");
  if (result.kind !== "note") return;
  assertEquals(result.note.isVideo, true);
  assertEquals(result.note.videoUrl, "https://sns-video-bd.xhscdn.com/v.mp4");
});

Deno.test("parseNotePage 视频只有 originVideoKey 时拼 CDN 地址", () => {
  const state = { n: { type: "video", desc: "x", imageList: [], video: { consumer: { originVideoKey: "pre_post/abc" } } } };
  const result = parseNotePage(`<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`);
  assertEquals(result.kind === "note" && result.note.videoUrl, "https://sns-video-bd.xhscdn.com/pre_post/abc");
});

Deno.test("parseNotePage 没有 state 时退回 og meta", () => {
  const html = `<head>
    <meta name="og:title" content="葱油拌面 - 小红书">
    <meta name="description" content="小葱 一把 &amp; 酱油 2 勺">
    <meta name="og:image" content="http://sns-webpic-qc.xhscdn.com/c.jpg">
  </head>`;
  const result = parseNotePage(html);
  assertEquals(result.kind, "note");
  if (result.kind !== "note") return;
  assertEquals(result.note.title, "葱油拌面");
  assertEquals(result.note.text, "小葱 一把 & 酱油 2 勺");
  assertEquals(result.note.imageUrls, ["https://sns-webpic-qc.xhscdn.com/c.jpg"]);
});

Deno.test("parseNotePage 识别删除页和登录墙", () => {
  assertEquals(parseNotePage("<div>当前笔记暂时无法浏览</div>").kind, "unavailable");
  assertEquals(parseNotePage("<html><title>小红书</title><body>登录</body></html>").kind, "blocked");
});

Deno.test("cleanDesc / noteToText", () => {
  assertEquals(cleanDesc("#早餐[话题]# #快手菜[话题]#\n好吃[哭惹R]"), "#早餐 #快手菜\n好吃");
  assertEquals(noteToText({ title: "A", text: "B", imageUrls: [], videoUrl: null, isVideo: false }), "A\nB");
  assertEquals(noteToText({ title: "A", text: "A 的做法", imageUrls: [], videoUrl: null, isVideo: false }), "A 的做法");
});

Deno.test("interpretTask 区分进行中、文件级失败和成功", () => {
  assertEquals(interpretTask({ output: { task_status: "RUNNING" } }), { state: "running" });
  assertEquals(
    interpretTask({
      output: {
        task_status: "SUCCEEDED",
        results: [{ subtask_status: "FAILED", code: "InvalidFile.DownloadFailed" }],
      },
    }),
    { state: "failed", reason: "InvalidFile.DownloadFailed" },
  );
  assertEquals(
    interpretTask({
      output: { task_status: "SUCCEEDED", results: [{ subtask_status: "SUCCEEDED", transcription_url: "https://r/x.json" }] },
    }),
    { state: "ready", url: "https://r/x.json" },
  );
  assertEquals(interpretTask({ output: { task_status: "FAILED", code: "Throttling" } }), { state: "failed", reason: "Throttling" });
});

Deno.test("transcriptText 拼接各声道文本", () => {
  assertEquals(transcriptText({ transcripts: [{ text: " 先放油 " }, { text: "" }, { text: "再放糖" }] }), "先放油\n再放糖");
  assertEquals(transcriptText({}), "");
  assertEquals(
    transcriptText({
      transcripts: [{ text: "全文", sentences: [{ begin_time: 3794, text: "打五个鸡蛋。" }, { begin_time: 75_200, text: " 下锅 " }] }],
    }),
    "[0:03] 打五个鸡蛋。\n[1:15] 下锅",
  );
});

Deno.test("票据：签发、校验、过期、篡改、换人", async () => {
  const secret = "test-secret";
  const now = 1_000_000;
  const ticket = await signTicket({ kind: "import", sub: "u1", exp: now + 1000 }, secret);
  assert(await verifyTicket(ticket, { kind: "import", sub: "u1" }, secret, now));
  assertEquals(await verifyTicket(ticket, { kind: "import", sub: "u2" }, secret, now), null);
  assertEquals(await verifyTicket(ticket, { kind: "asr", sub: "u1" }, secret, now), null);
  assertEquals(await verifyTicket(ticket, { kind: "import", sub: "u1" }, secret, now + 2000), null);
  assertEquals(await verifyTicket(ticket, { kind: "import", sub: "u1" }, "other", now), null);
  const [body, sig] = ticket.split(".");
  assertEquals(await verifyTicket(`${body}x.${sig}`, { kind: "import", sub: "u1" }, secret, now), null);
  assertEquals(await verifyTicket(42, { kind: "import", sub: "u1" }, secret, now), null);
});
