import type { Metadata } from "next";
import { DriveView } from "@/components/drive/DriveView";

export const metadata: Metadata = { title: "Trash" };

export default function TrashPage() {
  return <DriveView view="trash" />;
}
