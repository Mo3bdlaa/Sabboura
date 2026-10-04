import type { Metadata } from "next";
import { DriveView } from "@/components/drive/DriveView";

export const metadata: Metadata = { title: "Starred" };

export default function StarredPage() {
  return <DriveView view="starred" />;
}
