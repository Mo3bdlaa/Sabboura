import { DriveShell } from "@/components/drive/DriveShell";

export default function DriveLayout({ children }: LayoutProps<"/">) {
  return <DriveShell>{children}</DriveShell>;
}
