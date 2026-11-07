import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await currentUser();
  redirect(user ? "/dashboard" : "/login");
}
