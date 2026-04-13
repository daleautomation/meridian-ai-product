// Meridian AI — live Reddit r/WatchExchange ingestion.
//
// Fetches the newest posts from r/WatchExchange via Reddit's public JSON
// endpoint (no API key required). Maps each post to
// RawRedditWatchExchangeListing, then normalizes via the existing adapter.
//
// Safe: returns [] on any fetch/parse failure. Never crashes ingestion.

import type {
  NormalizedWatchRecord,
  RawRedditWatchExchangeListing,
} from "@/lib/ingestion/types";
import { normalizeRedditListings } from "./redditAdapter";

const REDDIT_URL =
  "https://www.reddit.com/r/Watchexchange/new.json?limit=25";

const USER_AGENT = "meridian-ai:watches-ingestion:v1 (by /u/meridian-bot)";

// Reddit's JSON listing shape (only the fields we use)
type RedditPost = {
  kind: string;
  data: {
    id: string;
    title: string;
    selftext: string;
    author: string;
    created_utc: number;
    score: number;
    num_comments: number;
    link_flair_text: string | null;
    url: string;
    is_self: boolean;
    // author metadata (not always present on listing endpoint)
    total_karma?: number;
    created?: number; // author account creation, sometimes in t3 data
  };
};

type RedditListing = {
  kind: "Listing";
  data: {
    children: RedditPost[];
    after: string | null;
  };
};

function parsePrice(title: string): number | undefined {
  const m = title.match(/\$[\s]?([\d,]+)/);
  if (m) {
    const price = parseInt(m[1].replace(/,/g, ""), 10);
    if (Number.isFinite(price) && price > 50) return price;
  }
  return undefined;
}

function isWTS(post: RedditPost["data"]): boolean {
  const title = post.title.toUpperCase();
  const flair = (post.link_flair_text ?? "").toUpperCase();

  // Must be [WTS]
  if (!title.includes("[WTS]") && flair !== "WTS") return false;

  // Skip SOLD
  if (flair === "SOLD" || title.includes("[SOLD]")) return false;

  return true;
}

function toRaw(post: RedditPost["data"]): RawRedditWatchExchangeListing {
  return {
    postId: post.id,
    title: post.title,
    body: post.selftext,
    author: post.author,
    authorKarma: post.total_karma,
    flair: post.link_flair_text ?? undefined,
    priceUsd: parsePrice(post.title),
    timestamp: new Date(post.created_utc * 1000).toISOString(),
    upvotes: post.score,
    commentCount: post.num_comments,
    // postId is used by redditAdapter to construct the listing URL
  };
}

/**
 * Fetch live r/WatchExchange posts and return normalized records.
 * Returns [] on any failure — never throws.
 */
export async function fetchRedditWatchExchange(
  ownerId: string = "dylan"
): Promise<NormalizedWatchRecord[]> {
  try {
    const res = await fetch(REDDIT_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (!res.ok) {
      console.warn(
        `[reddit-live] fetch failed: ${res.status} ${res.statusText}`
      );
      return [];
    }

    const listing: RedditListing = await res.json();

    if (listing?.kind !== "Listing" || !Array.isArray(listing.data?.children)) {
      console.warn("[reddit-live] unexpected response shape");
      return [];
    }

    const wtsPosts = listing.data.children
      .filter((child) => child.kind === "t3" && isWTS(child.data))
      .map((child) => toRaw(child.data));

    if (wtsPosts.length === 0) return [];

    const normalized = normalizeRedditListings(wtsPosts, ownerId);

    console.log(
      `[reddit-live] fetched ${listing.data.children.length} posts → ${wtsPosts.length} WTS → ${normalized.length} normalized`
    );

    return normalized;
  } catch (e) {
    // Network error, timeout, parse error — all safe
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[reddit-live] ${msg}`);
    return [];
  }
}
