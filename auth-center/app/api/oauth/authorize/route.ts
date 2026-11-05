import { NextRequest, NextResponse } from "next/server";
import { AUTH_CODE_TTL, PUBLIC_URL } from "@/lib/config";
import { randomToken, sha256 } from "@/lib/crypto";
import { getDb, nowSec } from "@/lib/db";
import { errorResponse, HttpError, assertSameOrigin } from "@/lib/http";
import {
  consentScope,
  errorRedirect,
  parseScopes,
  saveConsent,
  scopeAllowed,
  validateAuthorize,
  type AuthorizeInput,
} from "@/lib/oidc";
import { currentUser } from "@/lib/session";
import type { User } from "@/lib/db";

export const runtime = "nodejs";

function issueCode(user: User, input: AuthorizeInput): string {
  const code = randomToken(32);
  getDb().prepare(
    `INSERT INTO auth_codes(code_hash, client_id, user_id, redirect_uri, scope,
       code_challenge, nonce, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(sha256(code), input.client.client_id, user.id, input.redirectUri,
    input.scopes.join(" "), input.codeChallenge, input.nonce,
    nowSec() + AUTH_CODE_TTL, nowSec());
  return code;
}

function redirectWithCode(input: AuthorizeInput, code: string): NextResponse {
  const target = new URL(input.redirectUri);
  target.searchParams.set("code", code);
  if (input.state) target.searchParams.set("state", input.state);
  return NextResponse.redirect(target.toString(), 303);
}

function consentPath(params: URLSearchParams): string {
  const query = new URLSearchParams(params);
  query.delete("prompt");
  return `/consent?${query.toString()}`;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const input = validateAuthorize(params);
    const user = await currentUser();
    if (!user) {
      const next = `${req.nextUrl.pathname}${req.nextUrl.search}`;
      if (input.prompt === "none") {
        return NextResponse.redirect(
          errorRedirect(input.redirectUri, "login_required", input.state), 303
        );
      }
      return NextResponse.redirect(
        new URL(`/login?next=${encodeURIComponent(next)}`, PUBLIC_URL), 303
      );
    }
    const granted = consentScope(user.id, input.client.client_id);
    const covered = granted
      ? scopeAllowed(input.scopes, parseScopes(granted))
      : false;
    const force = input.prompt === "consent";
    if (!covered || force) {
      if (input.prompt === "none") {
        return NextResponse.redirect(
          errorRedirect(input.redirectUri, "consent_required", input.state), 303
        );
      }
      return NextResponse.redirect(
        new URL(consentPath(params), PUBLIC_URL).toString(), 303
      );
    }
    return redirectWithCode(input, issueCode(user, input));
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        { error: error.code, error_description: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const form = new URLSearchParams(await req.text());
    const params = new URLSearchParams(form);
    const decision = form.get("decision");
    const input = validateAuthorize(params);
    const user = await currentUser();
    if (!user) {
      const next = `/api/oauth/authorize?${params.toString()}`;
      return NextResponse.redirect(
        new URL(`/login?next=${encodeURIComponent(next)}`, PUBLIC_URL), 303
      );
    }
    if (decision !== "allow") {
      return NextResponse.redirect(
        errorRedirect(input.redirectUri, "access_denied", input.state), 303
      );
    }
    saveConsent(user.id, input.client.client_id, input.scopes);
    return redirectWithCode(input, issueCode(user, input));
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        { error: error.code, error_description: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    return errorResponse(error);
  }
}
