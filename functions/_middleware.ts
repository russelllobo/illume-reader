// @ts-nocheck

const REDIRECT_HOSTS = new Set(["illume.russell.systems", "russell.systems"]);
const CANONICAL_ORIGIN = "https://illumereader.com";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();

  if (REDIRECT_HOSTS.has(host)) {
    return Response.redirect(`${CANONICAL_ORIGIN}${url.pathname}${url.search}`, 301);
  }

  return context.next();
}
