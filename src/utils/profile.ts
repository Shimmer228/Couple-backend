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
  weeklyPointsEarned: number;
};

export const getWeeklyWinnerId = (users: WinnerCandidate[]) => {
  if (users.length < 2) {
    return null;
  }

  const [first, second] = [...users].sort((left, right) => {
    return right.weeklyPointsEarned - left.weeklyPointsEarned;
  });

  if (!first || !second) {
    return null;
  }

  if (first.weeklyPointsEarned === second.weeklyPointsEarned) {
    return null;
  }

  return first.id;
};
