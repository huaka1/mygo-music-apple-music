// 播客：Apple Podcasts 的目录（amp-api.podcasts.apple.com），和 music.apple.com
// 用同一个开发者令牌，不登录也能查。单集在 MyGo 里就是一首 Track，id 带 pe:
// 前缀，和歌曲的纯数字 id 区分开；歌词、播放记录和预取都只认纯数字 id，会自动跳过它。
// 单集的音频是节目方原始的 mp3 / m4a，不加密，直接交给 app 播放。
// 订阅存在插件本地，不同步到 Apple 账号。

import { first, query, request, storefront, type Params } from "./api.ts";
import { art } from "./artwork.ts";
import { PODCASTS_AMP } from "./constants.ts";
import type { Body, PodcastChartsBody, Resource } from "./types/apple.ts";
import type { SearchResult, Show, ShowPage, Stream, Track } from "./types/music.ts";
import { fail, isCatalogID, t } from "./util.ts";

const EPISODE = "pe:";
const PAGE = 50;
const SUBSCRIBED = "podcastShows";

/** 是否为播客单集的 id */
export const isEpisodeID = (id: string): boolean => id.startsWith(EPISODE) && isCatalogID(id.slice(EPISODE.length));

/** 查播客目录。不带用户令牌：Podcasts 不认 Music 的登录时，不至于让人重新登录 Music */
async function podcastCatalog<T = Body>(path: string, params?: Params): Promise<T | null> {
  return request<T>(`${PODCASTS_AMP}/v1/catalog/${await storefront()}${path}${query(params)}`, { user: false });
}

// 列表里见过的单集音频地址，播放时不用再查一次
const assets = new Map<string, string>();

/** 记下单集的音频地址，最多留 3000 个 */
function noteAsset(id: string, url: string | undefined): void {
  if (!url) return;
  assets.delete(id);
  assets.set(id, url);
  if (assets.size > 3000) assets.delete(assets.keys().next().value!);
}

/** 本地存的订阅节目 */
const subscribed = (): Show[] => host.storage.get<Show[]>(SUBSCRIBED) ?? [];

/** 是否订阅了这个节目 */
const isSubscribed = (id: string): boolean => subscribed().some((s) => s.id === id);

/** Apple 的节目转成 MyGo 的 Show */
export function toShow(item: Resource): Show {
  const a = item.attributes ?? {};
  return {
    id: String(item.id),
    name: a.name ?? "",
    imageUrl: art(a.artwork),
    description: a.description?.standard || a.description?.short || "",
    publisher: a.artistName ?? "",
    episodeCount: a.trackCount || undefined,
    subscribed: isSubscribed(String(item.id)),
  };
}

/** Apple 的单集转成 MyGo 的 Track，节目信息从所属节目带进来 */
export function toEpisode(item: Resource, show: Show): Track {
  const a = item.attributes ?? {};
  noteAsset(item.id, a.assetUrl);
  const publisher = a.artistName || show.publisher || "";
  return {
    id: EPISODE + item.id,
    name: a.name ?? "",
    artists: publisher ? [{ id: `name:${publisher}`, name: publisher }] : [],
    album: { id: "", name: show.name, imageUrl: art(a.artwork) ?? show.imageUrl },
    duration: a.durationInMilliseconds ?? 0,
    url: a.url,
    // 视频播客和没有音频地址的单集放不了
    unavailable: !a.assetUrl || a.mediaKind === "video",
    showId: show.id,
    description: a.description?.standard || a.description?.short || "",
    published: a.releaseDateTime,
  };
}

/** 节目信息 */
async function podcast(id: string): Promise<Show> {
  if (!isCatalogID(id)) throw fail("unavailable", t("Apple Podcasts doesn't have this"));
  return toShow(first(await podcastCatalog(`/podcasts/${id}`)));
}

/** 订阅的节目，给侧边栏的「播客」页 */
export function shows(): Show[] {
  return subscribed().map((s) => ({ ...s, subscribed: true }));
}

/** 节目详情和一页单集，最新的在前 */
export async function show({ id, offset = 0 }: { id: string; offset?: number }): Promise<ShowPage> {
  const [info, page] = await Promise.all([
    podcast(id),
    podcastCatalog(`/podcasts/${id}/episodes`, { limit: PAGE, offset: offset || undefined }),
  ]);
  // 订阅的节目顺便更新一下本地存的信息，比如集数和封面
  if (info.subscribed)
    host.storage.set(
      SUBSCRIBED,
      subscribed().map((s) => (s.id === id ? info : s)),
    );
  return { show: info, episodes: (page?.data ?? []).map((e) => toEpisode(e, info)), more: !!page?.next };
}

/** 订阅或取消订阅，存在本地 */
export async function subscribeShow({ id, on }: { id: string; on: boolean }): Promise<void> {
  const rest = subscribed().filter((s) => s.id !== id);
  if (!on) {
    host.storage.set(SUBSCRIBED, rest);
    return;
  }
  host.storage.set(SUBSCRIBED, [{ ...(await podcast(id)), subscribed: true }, ...rest]);
}

/** 搜节目；贴一个 podcasts.apple.com 的链接则直接给那个节目 */
export async function searchShows(term: string, offset = 0): Promise<SearchResult> {
  const linked = parsePodcastURL(term);
  if (linked) return { shows: offset ? [] : [await podcast(linked)], more: false };
  const body = await podcastCatalog<{ results?: Record<string, Body | undefined> }>("/search", {
    term,
    types: "podcasts",
    limit: 25,
    offset: offset || undefined,
  });
  const r = body?.results?.podcasts;
  return { shows: (r?.data ?? []).map(toShow), more: !!r?.next };
}

/** podcasts.apple.com 链接里的节目 id */
export function parsePodcastURL(text: string): string | null {
  return text.trim().match(/podcasts\.apple\.com\/(?:[a-z]{2}\/)?podcast\/(?:[^/?#]+\/)?id(\d+)/)?.[1] ?? null;
}

/** 播客排行榜，失败时给空 */
export async function topShows(limit: number): Promise<{ title: string; shows: Show[] }> {
  const chart = (await podcastCatalog<PodcastChartsBody>("/charts", { types: "podcasts", limit }).catch(() => null))
    ?.results?.podcasts?.[0];
  return { title: chart?.displayName || t("Top Podcasts"), shows: (chart?.data ?? []).map(toShow) };
}

/** 音频地址的格式，看路径的扩展名，认不出的按 mp3 */
export function audioType(url: string): string {
  let ext = "";
  try {
    ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
  } catch {
    // 不是合法地址，按 mp3
  }
  if (ext === "m4a" || ext === "mp4" || ext === "m4b") return "m4a";
  if (ext === "aac" || ext === "flac" || ext === "ogg" || ext === "wav") return ext;
  return "mp3";
}

/** 播放单集：直接给节目方的音频地址 */
export async function stream({ id }: { id: string }): Promise<Stream> {
  const raw = id.slice(EPISODE.length);
  let url = assets.get(raw);
  if (!url) {
    const a = first(await podcastCatalog(`/podcast-episodes/${raw}`)).attributes;
    if (a?.mediaKind === "video") throw fail("unavailable", t("Video podcasts don't play here"));
    url = a?.assetUrl;
    noteAsset(raw, url);
  }
  if (!url) throw fail("unavailable", t("This episode has no audio"));
  return { url, type: audioType(url) };
}
