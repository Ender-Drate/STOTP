import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { ProfileForms } from "@/app/components/ProfileForms";
import { TotpPanel } from "@/app/components/TotpPanel";
import { PasskeyPanel } from "@/app/components/PasskeyPanel";
import { ProviderLinksPanel } from "@/app/components/ProviderLinksPanel";
import { SessionsPanel } from "@/app/components/SessionsPanel";
import { listPasskeys } from "@/lib/passkeys";
import { listUserProviderLinks } from "@/lib/login-providers";
import { currentSessionId, listUserSessions } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard/settings");
  const sessionId = await currentSessionId();
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-desc">个人资料与账号安全</p>
        </div>
      </div>
      <ProfileForms
        user={{
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          role: user.role,
          createdAt: user.created_at,
        }}
        totpEnabled={Boolean(user.totp_secret)}
      />
      <ProviderLinksPanel links={listUserProviderLinks(user.id).map((item) => ({
        providerId: item.providerId,
        name: item.name,
        iconUrl: item.iconUrl,
        subject: item.subject,
        createdAt: item.createdAt,
      }))} />
      <TotpPanel enabled={Boolean(user.totp_secret)} />
      <PasskeyPanel passkeys={listPasskeys(user.id).map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.created_at,
        lastUsedAt: item.last_used_at,
      }))} totpEnabled={Boolean(user.totp_secret)} />
      <SessionsPanel sessions={listUserSessions(user.id).map((session) => ({
        id: session.id,
        current: session.id === sessionId,
        ip: session.ip,
        userAgent: session.user_agent,
        createdAt: new Date(session.created_at * 1000).toISOString(),
        lastSeenAt: session.last_seen_at
          ? new Date(session.last_seen_at * 1000).toISOString() : null,
        expiresAt: new Date(session.expires_at * 1000).toISOString(),
      }))} />
    </>
  );
}
