import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "college-bus-tracking-secret-key-2026";

export interface JwtPayload {
  id: number;
  role: string;
  email: string;
  name: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "365d" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}
