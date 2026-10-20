/**
 * -------------------------------------------------------------------------
 * @file   avatar.ts
 * @brief  Maps a user's stored avatar choice to a DiceBear Gaze image URL.
 *
 * @description
 *  Every avatar is a DiceBear Gaze face. Each face comes from a seed: by
 *  default the opaque user id, or a random seed the user picked in Account
 *  Settings. A picked seed is stored in the user's `image` field as a token
 *  such as `dicebear:gaze:k3x9q2m7ab`.
 *
 * @remarks
 *  The `image` field is writable through the public auth API, so it is
 *  untrusted. Only a short alphanumeric seed is ever read back from it, and
 *  the URL's host and style are fixed here; any other stored value,
 *  including a raw URL, falls back to the user id. No email or name is sent
 *  to DiceBear.
 *
 * @see
 *  https://www.dicebear.com/styles/gaze/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
const tokenPrefix = "dicebear:gaze:";

/** Random seeds are lowercase alphanumeric; user ids add dashes. */
const seedPattern = /^[A-Za-z0-9-]{1,64}$/;

/** Reads a stored `image` value; anything unrecognized is the user id. */
export function avatarSeedFromImage(image: string | null | undefined, userId: string): string {
  const seed = image?.startsWith(tokenPrefix) ? image.slice(tokenPrefix.length) : "";
  return seedPattern.test(seed) ? seed : userId;
}

/** The value to store in the user's `image` field for a seed. */
export function avatarImageToken(seed: string): string {
  return `${tokenPrefix}${seed}`;
}

export function avatarUrl(seed: string): string {
  return `https://api.dicebear.com/10.x/gaze/svg?seed=${encodeURIComponent(seed)}`;
}

/** A fresh 10-character seed from the platform's secure random source. */
export function randomAvatarSeed(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/** Up to two initials, shown while the avatar image loads or if it fails. */
export function avatarInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
