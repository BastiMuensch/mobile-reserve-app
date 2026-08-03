import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SchulamtLayoutClient } from "@/components/schulamt/SchulamtLayoutClient";

export default async function SchulamtLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user || user.role !== "SCHULAMT") {
    redirect("/");
  }

  return <SchulamtLayoutClient schulamtId={user.id}>{children}</SchulamtLayoutClient>;
}
