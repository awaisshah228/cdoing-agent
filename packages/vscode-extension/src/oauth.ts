/**
 * VS Code Extension OAuth — thin wrapper around @cdoing/core OAuth
 *
 * Re-exports all shared OAuth functions from core.
 * No duplicate logic — credential storage, PKCE, token management all live in @cdoing/core.
 */

// Re-export everything from core so existing imports keep working
export {
  saveOAuthTokens,
  loadOAuthTokens,
  clearOAuthTokens,
  isOAuthExpired,
  refreshAccessToken,
  resolveOAuthToken,
  generateOAuthUrl,
  exchangeOAuthCode,
  getOAuthStatus,
} from "@cdoing/core";
export type { OAuthTokens } from "@cdoing/core";

import { fullLogout } from "@cdoing/core";

/** VS Code-specific logout — clears OAuth tokens + stored API keys */
export function oauthLogout(): void {
  fullLogout();
}
