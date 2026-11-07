import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { SmtpSettingsForm } from "@/app/components/SmtpSettingsForm";

export const dynamic = "force-dynamic";

export default async function SmtpPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard/smtp");
  if (!isSuperAdmin(user)) {
    return (
      <div className="card card-pad">
        <div className="card-title">需要权限</div>
        <p className="muted small" style={{ marginTop: 6 }}>仅最高管理员可以配置 SMTP。</p>
      </div>
    );
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">邮件服务</h1>
          <p className="page-desc">SMTP 配置与测试</p>
        </div>
      </div>
      <SmtpSettingsForm defaultTo={user.email} />
    </>
  );
}
