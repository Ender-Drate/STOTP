import type { OAuthClient } from "./db";
import { parseScopes } from "./oidc";

export interface ClientView {
  id: number;
  clientId: string;
  name: string;
  description: string | null;
  redirectUris: string[];
  scopes: string[];
  isPublic: boolean;
  status: "active" | "disabled";
  ownerId: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export function serializeClient(client: OAuthClient): ClientView {
  return {
    id: client.id,
    clientId: client.client_id,
    name: client.name,
    description: client.description,
    redirectUris: (() => {
      try {
        return JSON.parse(client.redirect_uris) as string[];
      } catch {
        return [];
      }
    })(),
    scopes: parseScopes(client.scopes),
    isPublic: client.is_public === 1,
    status: client.status,
    ownerId: client.owner_id,
    createdAt: client.created_at,
    lastUsedAt: client.last_used_at,
  };
}
