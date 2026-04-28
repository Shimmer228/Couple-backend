import fs from "fs";
import path from "path";

const uploadsDirectory = path.join(process.cwd(), "uploads");
const avatarsDirectory = path.join(uploadsDirectory, "avatars");

const normalizePublicBaseUrl = (value: string) => value.replace(/\/+$/, "");

export const ensureAvatarUploadDir = () => {
  fs.mkdirSync(avatarsDirectory, { recursive: true });
};

export const buildAvatarUrl = (filename: string) => {
  const relativePath = `/uploads/avatars/${filename}`;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();

  if (!publicBaseUrl) {
    return relativePath;
  }

  return `${normalizePublicBaseUrl(publicBaseUrl)}${relativePath}`;
};

export const deleteLocalAvatarFile = (avatarUrl: string | null | undefined) => {
  if (!avatarUrl) {
    return;
  }

  const relativeUrl = avatarUrl
    .replace(normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL?.trim() || ""), "")
    .trim();

  if (!relativeUrl.startsWith("/uploads/avatars/")) {
    return;
  }

  const relativePath = relativeUrl.replace(/^\/+/, "");
  const absolutePath = path.join(process.cwd(), relativePath);

  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
};
