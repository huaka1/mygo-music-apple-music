// 播客：离线对着一个假的 Apple Podcasts 目录测搜索、节目页、订阅和播放。
import assert from "node:assert/strict";
import { test } from "node:test";

// 一天后过期的开发者令牌，未登录，所以目录走 us 区
const jwt = `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 86400 }))}.y`;
const storage = new Map<string, unknown>([["devToken", jwt]]);
(globalThis as any).host = {
  platform: "linux",
  arch: "x64",
  storage: {
    get: (k: string) => storage.get(k),
    set: (k: string, v: unknown) => void storage.set(k, v),
    remove: (k: string) => void storage.delete(k),
  },
  setting: () => "",
  t: (text: string) => text,
  language: () => "en",
};

const art = { url: "https://is1-ssl.mzstatic.com/image/thumb/a.png/{w}x{h}bb.{f}" };
const podcastRes = {
  id: "100",
  type: "podcasts",
  attributes: { name: "The Show", artistName: "Host", artwork: art, trackCount: 3, description: { standard: "About" } },
};
// 生成一集，第 3 集是视频播客
const episodeRes = (n: number) => ({
  id: String(200 + n),
  type: "podcast-episodes",
  attributes: {
    name: `Ep ${n}`,
    artistName: "Host",
    durationInMilliseconds: 60000,
    releaseDateTime: "2026-10-21T00:00:00Z",
    description: { standard: `Ep ${n} notes` },
    assetUrl: n === 2 ? `https://cdn.example.com/${n}.mp3?x=1` : `https://cdn.example.com/${n}.m4a`,
    mediaKind: n === 3 ? "video" : "audio",
  },
});

const asked: { url: URL; headers: Record<string, string> }[] = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
// 假的 amp-api.podcasts.apple.com
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  asked.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
  assert.equal(url.host, "amp-api.podcasts.apple.com");
  const path = url.pathname;
  if (path === "/v1/catalog/us/podcasts/100") return json({ data: [podcastRes] });
  if (path === "/v1/catalog/us/podcasts/100/episodes") {
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return json({
      data: offset ? [episodeRes(3)] : [episodeRes(1), episodeRes(2)],
      next: offset ? undefined : "/next",
    });
  }
  if (path === "/v1/catalog/us/podcast-episodes/209") return json({ data: [episodeRes(9)] });
  if (path === "/v1/catalog/us/search") return json({ results: { podcasts: { data: [podcastRes], next: "/more" } } });
  if (path === "/v1/catalog/us/charts")
    return json({ results: { podcasts: [{ displayName: "Top", data: [podcastRes] }] } });
  return new Response("", { status: 404 });
}) as typeof fetch;

const pc = await import("../src/podcasts.ts");
const { search } = await import("../src/search.ts");

test("搜索 shows 走播客目录，贴链接直接给那个节目", async () => {
  const found = await search({ query: "show", kind: "shows" });
  assert.equal(found.shows?.[0].name, "The Show");
  assert.equal(found.shows?.[0].imageUrl, "https://is1-ssl.mzstatic.com/image/thumb/a.png/{size}x{size}bb.jpg");
  assert.equal(found.more, true);
  const linked = await search({ query: "https://podcasts.apple.com/cn/podcast/the-show/id100?i=5", kind: "shows" });
  assert.deepEqual(
    linked.shows?.map((s) => s.id),
    ["100"],
  );
  // 不带用户令牌
  assert.ok(asked.every((a) => !("media-user-token" in a.headers)));
});

test("节目页：单集带 pe: 前缀、节目信息，视频单集标为放不了", async () => {
  const page = await pc.show({ id: "100" });
  assert.equal(page.show.publisher, "Host");
  assert.equal(page.more, true);
  const [ep] = page.episodes;
  assert.equal(ep.id, "pe:201");
  assert.equal(ep.showId, "100");
  assert.equal(ep.album.name, "The Show");
  assert.equal(ep.description, "Ep 1 notes");
  assert.equal(ep.published, "2026-10-21T00:00:00Z");
  assert.equal(ep.unavailable, false);
  const next = await pc.show({ id: "100", offset: 2 });
  assert.equal(next.episodes[0].unavailable, true);
  assert.equal(next.more, false);
});

test("播放：用列表里见过的地址，没见过的再查，格式看扩展名", async () => {
  await pc.show({ id: "100" });
  const before = asked.length;
  assert.deepEqual(await pc.stream({ id: "pe:201" }), { url: "https://cdn.example.com/1.m4a", type: "m4a" });
  assert.deepEqual(await pc.stream({ id: "pe:202" }), { url: "https://cdn.example.com/2.mp3?x=1", type: "mp3" });
  assert.equal(asked.length, before);
  assert.deepEqual(await pc.stream({ id: "pe:209" }), { url: "https://cdn.example.com/9.m4a", type: "m4a" });
  assert.ok(pc.isEpisodeID("pe:209"));
  assert.ok(!pc.isEpisodeID("1783644604"));
});

test("订阅存在本地，节目页会标出已订阅", async () => {
  assert.deepEqual(pc.shows(), []);
  await pc.subscribeShow({ id: "100", on: true });
  assert.deepEqual(
    pc.shows().map((s) => [s.id, s.subscribed]),
    [["100", true]],
  );
  assert.equal((await pc.show({ id: "100" })).show.subscribed, true);
  await pc.subscribeShow({ id: "100", on: false });
  assert.deepEqual(pc.shows(), []);
});

test("排行榜", async () => {
  const top = await pc.topShows(10);
  assert.equal(top.title, "Top");
  assert.equal(top.shows[0].id, "100");
});
