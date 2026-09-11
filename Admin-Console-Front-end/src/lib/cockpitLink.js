import { runtimeConfig } from "@/shared/config";

export function buildCockpitUrl(session, baseUrl = runtimeConfig.cockpitUrl) {
  if (!session?.token || !session?.livekit_url || !session?.room) {
    throw new Error("Session cockpit incomplète");
  }
  if (!baseUrl) throw new Error("URL du cockpit non configurée");

  const url = new URL(baseUrl);
  const fragment = new URLSearchParams({
    token: session.token,
    url: session.livekit_url,
    room: session.room,
  });
  url.hash = fragment.toString();
  return url.toString();
}
