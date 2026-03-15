import jwt from 'jsonwebtoken';

const getAccessSecret = () => process.env.JWT_SECRET || 'dev-access-secret';
const getRefreshSecret = () => process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';

export function generateTokens(payload: any) {
  const accessToken = jwt.sign(payload, getAccessSecret(), { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, getRefreshSecret(), { expiresIn: '30d' });
  
  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, getAccessSecret());
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, getRefreshSecret());
}
