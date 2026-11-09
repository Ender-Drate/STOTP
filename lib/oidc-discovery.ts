import { PUBLIC_URL } from "./config";
import { SUPPORTED_SCOPES } from "./oidc";

export function discoveryDocument(): Record<string, unknown> {
  const base = PUBLIC_URL;
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    userinfo_endpoint: `${base}/api/oauth/userinfo`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    jwks_uri: `${base}/api/oauth/jwks`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    code_challenge_methods_supported: ["S256"],
    claims_supported: [
      "sub", "name", "preferred_username", "email", "email_verified",
      "picture", "permissions", "iss", "aud", "iat", "exp", "auth_time",
      "azp", "at_hash",
    ],
    userinfo_signing_alg_values_supported: ["none"],
  };
}
