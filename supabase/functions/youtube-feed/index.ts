import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

const youtubeChannelLookup = (value: string) => {
  const rawValue = value.trim();
  if (!rawValue) return null;

  const normalized = rawValue.startsWith("http://") || rawValue.startsWith("https://")
    ? new URL(rawValue)
    : null;
  const text = normalized ? normalized.pathname : rawValue;
  const parts = text.split("/").filter(Boolean);
  const lastPart = parts.at(-1) ?? text;

  if (lastPart.startsWith("@")) return { key: "forHandle", value: lastPart };
  if (parts[0] === "channel" && parts[1]) return { key: "id", value: parts[1] };
  if (parts[0] === "user" && parts[1]) return { key: "forUsername", value: parts[1] };
  if (rawValue.startsWith("UC")) return { key: "id", value: rawValue };
  if (rawValue.startsWith("@")) return { key: "forHandle", value: rawValue };

  return { key: "forHandle", value: `@${rawValue}` };
};

const parseISO8601Duration = (duration: string) => {
  if (!duration) return "10:00";
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "10:00";
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatTimeAgo = (dateStr: string | undefined) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return `${interval} year${interval > 1 ? "s" : ""} ago`;

  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return `${interval} month${interval > 1 ? "s" : ""} ago`;

  interval = Math.floor(seconds / 604800);
  if (interval >= 1) return `${interval} week${interval > 1 ? "s" : ""} ago`;

  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return `${interval} day${interval > 1 ? "s" : ""} ago`;

  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return `${interval} hour${interval > 1 ? "s" : ""} ago`;

  interval = Math.floor(seconds / 60);
  if (interval >= 1) return `${interval} minute${interval > 1 ? "s" : ""} ago`;

  return "just now";
};

const chunks = <T,>(items: T[], size: number) => {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json().catch(() => ({}));
    const apiKey = requiredEnv("YOUTUBE_API_KEY");
    const channelValue = typeof payload.channel === "string" && payload.channel.trim()
      ? payload.channel.trim()
      : typeof payload.channelId === "string" && payload.channelId.trim()
        ? payload.channelId.trim()
        : Deno.env.get("YOUTUBE_CHANNEL_ID") ?? "";
    const lookup = youtubeChannelLookup(channelValue);
    if (!lookup) {
      throw new Error("Enter a YouTube channel URL, @handle, or channel ID before fetching content.");
    }

    const channelUrl = new URL("https://youtube.googleapis.com/youtube/v3/channels");
    channelUrl.searchParams.set("part", "contentDetails");
    channelUrl.searchParams.set(lookup.key, lookup.value);
    channelUrl.searchParams.set("key", apiKey);

    const channelRes = await fetch(channelUrl);
    const channelData = await channelRes.json();
    if (!channelRes.ok) {
      throw new Error(channelData.error?.message || "Failed to retrieve YouTube channel.");
    }

    if (!channelData.items?.length) {
      throw new Error(`No YouTube channel found for ${channelValue}. Use the channel URL, @handle, or UC... channel ID.`);
    }

    const uploadsPlaylist = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylist) throw new Error("No uploads playlist associated with this YouTube channel.");

    const items: any[] = [];
    let pageToken = "";

    do {
      const playlistUrl = new URL("https://youtube.googleapis.com/youtube/v3/playlistItems");
      playlistUrl.searchParams.set("part", "snippet,contentDetails");
      playlistUrl.searchParams.set("playlistId", uploadsPlaylist);
      playlistUrl.searchParams.set("maxResults", "50");
      playlistUrl.searchParams.set("key", apiKey);
      if (pageToken) playlistUrl.searchParams.set("pageToken", pageToken);

      const playlistRes = await fetch(playlistUrl);
      const playlistData = await playlistRes.json();
      if (!playlistRes.ok) {
        throw new Error(playlistData.error?.message || "Failed to fetch upload playlist items.");
      }

      items.push(...(playlistData.items ?? []));
      pageToken = playlistData.nextPageToken ?? "";
    } while (pageToken);

    const videoIds = items.map((item: any) => item.contentDetails?.videoId).filter(Boolean);
    const statsMap = new Map<string, { comments: string; duration: string; likes: string; views: string }>();

    for (const videoIdChunk of chunks(videoIds, 50)) {
      const videosUrl = new URL("https://youtube.googleapis.com/youtube/v3/videos");
      videosUrl.searchParams.set("part", "contentDetails,statistics");
      videosUrl.searchParams.set("id", videoIdChunk.join(","));
      videosUrl.searchParams.set("key", apiKey);

      const videosRes = await fetch(videosUrl);
      const videosData = await videosRes.json();
      if (!videosRes.ok) {
        throw new Error(videosData.error?.message || "Failed to retrieve YouTube video statistics.");
      }

      (videosData.items ?? []).forEach((video: any) => {
        statsMap.set(video.id, {
          comments: video.statistics?.commentCount ?? "0",
          duration: parseISO8601Duration(video.contentDetails?.duration),
          likes: video.statistics?.likeCount ?? "0",
          views: video.statistics?.viewCount ?? "0"
        });
      });
    }

    const videos = items.map((item: any) => {
      const videoId = item.contentDetails?.videoId;
      const stats = statsMap.get(videoId) ?? { comments: "0", duration: "10:00", likes: "0", views: "0" };

      return {
        comments: stats.comments,
        duration: stats.duration,
        id: videoId || item.id,
        imageUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? "",
        likes: stats.likes,
        publishedAt: item.snippet?.publishedAt ?? "",
        published: formatTimeAgo(item.snippet?.publishedAt),
        title: item.snippet?.title ?? "Untitled Video",
        views: stats.views
      };
    });

    return jsonResponse({ channel: channelValue, videos });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not load YouTube feed." }, 400);
  }
});
