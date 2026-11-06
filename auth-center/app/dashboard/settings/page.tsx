import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { ProfileForms } from "@/app/components/ProfileForms";
import { StotpPanel } from "@/app/components/StotpPanel";
import { bindingView, getBinding } from "@/lib/stotp-store";
import { stotpConfigured, stotpEnforce } from "@/lib/stotp";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard/settings");
  const binding = getBinding(user.id);
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
      />
      <StotpPanel
        binding={binding ? bindingView(binding) : null}
        enabled={stotpConfigured()}
        enforce={stotpEnforce()}
      />
    </>
  );
}
