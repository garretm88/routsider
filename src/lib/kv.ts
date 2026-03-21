import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = import.meta.env.KV_REST_API_URL;
    const token = import.meta.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error(
        "Missing KV_REST_API_URL or KV_REST_API_TOKEN environment variables",
      );
    }
    redis = new Redis({ url, token });
  }
  return redis;
}
