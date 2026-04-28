import multer from "multer";
import { NextFunction, Request, Response } from "express";
import path from "path";
import { ensureAvatarUploadDir } from "../utils/avatar-storage";

ensureAvatarUploadDir();

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, path.join(process.cwd(), "uploads", "avatars"));
  },
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}${extension}`;
    callback(null, uniqueName);
  },
});

const avatarUpload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("INVALID_AVATAR_FILE"));
      return;
    }

    callback(null, true);
  },
});

export const avatarUploadSingle = (req: Request, res: Response, next: NextFunction) => {
  avatarUpload.single("avatar")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Avatar file must be 2MB or smaller" });
    }

    if (error instanceof Error && error.message === "INVALID_AVATAR_FILE") {
      return res.status(400).json({ message: "Only JPEG, PNG, and WEBP images are allowed" });
    }

    if (error) {
      console.error("Avatar upload middleware error:", error);
      return res.status(500).json({ message: "Failed to upload avatar" });
    }

    next();
  });
};
