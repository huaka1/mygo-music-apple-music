// What the app takes from a plugin, by the JSON names of MyGo Music's
// internal/music/music.go. Times are in milliseconds.

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
}

export interface Album {
  id: string;
  name: string;
  imageUrl?: string;
  artists?: Artist[];
  released?: string;
  saved?: boolean;
}

export interface Track {
  id: string;
  name: string;
  artists?: Artist[];
  album: Album;
  duration: number;
  url?: string;
  unavailable?: boolean;
  // 播客单集：属于哪个节目、简介和发布时间
  showId?: string;
  description?: string;
  published?: string;
}

export interface Playlist {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  owner?: string;
  trackCount?: number;
  mine?: boolean;
  saved?: boolean;
  tracks?: Track[];
}

export interface Station {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
}

// 播客节目，它的单集是 Track
export interface Show {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  publisher?: string;
  episodeCount?: number;
  subscribed?: boolean;
}

// 节目详情页：节目本身和一页单集
export interface ShowPage {
  show: Show;
  episodes: Track[];
  more: boolean;
}

export interface Section {
  title?: string;
  tracks?: Track[];
  albums?: Album[];
  artists?: Artist[];
  playlists?: Playlist[];
  stations?: Station[];
  shows?: Show[];
  morePage?: string;
  empty?: string;
}

export interface Browse {
  title?: string;
  subtitle?: string;
  sections?: Section[];
}

export interface AlbumPage {
  album: Album;
  tracks: Track[];
}

export interface ArtistPage {
  artist: Artist;
  tracks: Track[];
  albums: Album[];
}

export interface Account {
  id: string;
  name: string;
  imageUrl?: string;
}

export type SearchKind = "tracks" | "albums" | "artists" | "playlists" | "shows";

export interface SearchResult {
  tracks?: Track[];
  albums?: Album[];
  artists?: Artist[];
  playlists?: Playlist[];
  shows?: Show[];
  more: boolean;
}

export interface Stream {
  url: string;
  type: string;
  quality?: string;
  bitRate?: number;
}

export interface LyricWord {
  start: number;
  end: number;
  text: string;
}

export interface LyricLine {
  start: number;
  end: number;
  text: string;
  translation?: string;
  words?: LyricWord[];
}

export interface Lyrics {
  lines: LyricLine[];
}
