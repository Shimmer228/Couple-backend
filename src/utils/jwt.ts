import jwt, { JwtPayload } from "jsonwebtoken";

export type AuthTokenPayload = JwtPayload & {
  userId: string;
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return secret;
};

export const generateToken = (userId: string) => {
  return jwt.sign({ userId }, getJwtSecret(), {
    expiresIn: "7d",
  });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
};
