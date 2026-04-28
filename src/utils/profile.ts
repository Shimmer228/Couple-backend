export const PRESET_AVATAR_KEYS = ["CAT", "FOX", "BEAR", "STAR", "MOON", "HEART", "SUN"] as const;

export const parseAvatarKey = (value: unknown) => {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();

  if (!normalized) {
    return null;
  }

  if (PRESET_AVATAR_KEYS.includes(normalized as (typeof PRESET_AVATAR_KEYS)[number])) {
    return normalized === "SUN" ? "STAR" : normalized.toLowerCase();
  }

  throw new Error("INVALID_AVATAR_KEY");
};

export const normalizeOptionalNickname = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

type WinnerCandidate = {
  id: string;
  points: number;
  winStreak: number;
};

export const getWeeklyWinnerId = (users: WinnerCandidate[]) => {
  if (users.length < 2) {
    return null;
  }

  const [first, second] = [...users].sort((left, right) => {
    if (right.points !== left.points) {
      return right.points - left.points;
    }

    return right.winStreak - left.winStreak;
  });

  if (!first || !second) {
    return null;
  }

  if (first.points === second.points && first.winStreak === second.winStreak) {
    return null;
  }

  return first.id;
};
