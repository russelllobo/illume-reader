// @ts-nocheck

const REDIRECT_HOSTS = new Set(["illume.russell.systems", "russell.systems"]);
const CANONICAL_ORIGIN = "https://illumereader.com";
const IOS_AUTH_CALLBACK = "com.russellsystems.illume://auth-callback";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();

  if (REDIRECT_HOSTS.has(host)) {
    return Response.redirect(`${CANONICAL_ORIGIN}${url.pathname}${url.search}`, 301);
  }

  if (url.pathname === "/auth/native-callback") {
    const callbackURL = new URL(IOS_AUTH_CALLBACK);
    url.searchParams.forEach((value, key) => {
      callbackURL.searchParams.set(key, value);
    });
    return Response.redirect(callbackURL.toString(), 302);
  }

  return context.next();
}
