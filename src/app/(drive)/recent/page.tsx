import type { Metadata } from "next";
import { DriveView } from "@/components/drive/DriveView";

export const metadata: Metadata = { title: "Recent" };

export default function RecentPage() {
  return <DriveView view="recent" />;
}
