import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/config";
import { HttpError } from "@/lib/http";
import {
  parseScopes,
  SCOPE_LABELS,
  validateAuthorize,
  type AuthorizeInput,
} from "@/lib/oidc";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

interface ConsentSearch {
  [key: string]: string | string[] | undefined;
}

function toParams(search: ConsentSearch): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
  }
  return params;
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">S</div>
          <div className="brand-name">{BRAND.name}</div>
        </div>
        <h1 className="auth-title">无法完成授权</h1>
        <p className="auth-sub">{message}</p>
        <Link className="btn btn-primary" href="/dashboard">返回账户中心</Link>
      </div>
    </div>
  );
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<ConsentSearch>;
}) {
  const search = await searchParams;
  const params = toParams(search);
  let input: AuthorizeInput;
  try {
    input = validateAuthorize(params);
  } catch (error) {
    if (error instanceof HttpError) return <ErrorCard message={error.message} />;
    throw error;
  }

  const user = await currentUser();
  if (!user) {
    const next = `/api/oauth/authorize?${params.toString()}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const scopes = input.scopes.length ? input.scopes : parseScopes(params.get("scope"));
  const hidden: Array<[string, string]> = [
    ["response_type", "code"],
    ["client_id", input.client.client_id],
    ["redirect_uri", input.redirectUri],
    ["scope", scopes.join(" ")],
  ];
  if (input.state) hidden.push(["state", input.state]);
  if (input.codeChallenge) hidden.push(["code_challenge", input.codeChallenge]);
  if (input.codeChallengeMethod) {
    hidden.push(["code_challenge_method", input.codeChallengeMethod]);
  }
  if (input.nonce) hidden.push(["nonce", input.nonce]);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="card-sub">授权确认</div>
          </div>
        </div>
        <h1 className="auth-title">授权 {input.client.name}</h1>
        <p className="auth-sub">
          {input.client.description || "该应用请求访问账户信息。"}
        </p>

        <div className="card card-pad" style={{ marginBottom: 16, boxShadow: "none" }}>
          <div className="card-title" style={{ marginBottom: 8 }}>将获得以下权限</div>
          <ul className="consent-list">
            {scopes.map((scope) => (
              <li key={scope}>
                <span className="consent-scope">{scope}</span>
                <span>{SCOPE_LABELS[scope] || scope}</span>
              </li>
            ))}
          </ul>
          <div className="hint">
            同意后可在「我的授权」中随时撤销。密码不会共享。
          </div>
        </div>

        <form method="post" action="/api/oauth/authorize">
          {hidden.map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <div className="btn-row">
            <button className="btn btn-primary" style={{ flex: 1, height: 42 }}
              name="decision" value="allow" type="submit">
              允许访问
            </button>
            <button className="btn btn-ghost" style={{ flex: 1, height: 42 }}
              name="decision" value="deny" type="submit">
              拒绝
            </button>
          </div>
        </form>
        <div className="auth-foot">
          当前登录：{user.display_name || user.username}
        </div>
      </div>
    </div>
  );
}
