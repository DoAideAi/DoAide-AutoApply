/**
 * A Gmail compose window, pre-filled.
 *
 * The way out for a draft while Google's verification of the Gmail scopes is
 * pending: nothing can send on the user's behalf, but Gmail itself will open a
 * compose window with the recipient, subject and body already in place, and
 * the user presses Send there. Each value is percent-encoded on its own —
 * `URLSearchParams` would turn spaces into `+`, which a body full of prose
 * should not have to survive.
 */
export function gmailComposeUrl({ to, subject, body }) {
  const params = [
    ["view", "cm"],
    ["to", to],
    ["su", subject],
    ["body", body],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `https://mail.google.com/mail/?${params}`;
}
